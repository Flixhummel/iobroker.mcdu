'use strict';

/**
 * Confirmation Dialog System
 * 
 * Manages confirmation dialogs with three types:
 *   - Soft confirmation: LSK or OVFY accepted
 *   - Hard confirmation: OVFY only
 *   - Countdown confirmation: With timer, auto-executes
 * 
 * Dialog Structure (14 lines, overrides current page):
 *   Line 1:  ACTION TITLE
 *   Line 2:  ⚠️  WARNING (if hard)
 *   Line 3:  ---
 *   Line 4-10: Details (what will happen)
 *   Line 11: ---
 *   Line 12: INSTRUCTION (if hard: "DRÜCKE OVFY")
 *   Line 13: < NEIN / ABBRECHEN     JA* / BESTÄTIGEN*
 *   Line 14: (empty - scratchpad ignored during confirmation)
 * 
 * @author Kira Holt
 */

class ConfirmationDialog {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} displayPublisher - DisplayPublisher instance
     */
    constructor(adapter, displayPublisher) {
        this.adapter = adapter;
        this.displayPublisher = displayPublisher;
        
        /** @type {boolean} Is dialog currently active? */
        this.active = false;
        
        /** @type {string|null} Dialog type: soft|hard|countdown */
        this.dialogType = null;
        
        /** @type {string|null} Action title */
        this.title = null;
        
        /** @type {string|null} Warning message (for hard confirmations) */
        this.warning = null;
        
        /** @type {string[]} Details lines */
        this.details = [];
        
        /** @type {function|null} Confirmation callback */
        this.onConfirm = null;
        
        /** @type {function|null} Cancellation callback */
        this.onCancel = null;
        
        /** @type {number|null} Countdown timer handle */
        this.countdownTimer = null;
        
        /** @type {number|null} Countdown remaining seconds */
        this.countdownSeconds = null;
        
        /** @type {number} Display columns */
        this.columns = adapter.config.display?.columns || 24;
        
        this.adapter.log.debug('ConfirmationDialog initialized');
    }
    
    /**
     * Show soft confirmation dialog
     * Accepts both LSK (left = cancel, right = confirm) and OVFY (confirm)
     * 
     * @param {string} title - Action title (e.g., "GERÄT AUSSCHALTEN")
     * @param {string|string[]} details - Details to show (string or array of lines)
     * @param {function} onConfirm - Callback on confirmation
     * @param {function} onCancel - Callback on cancellation
     * @returns {Promise<void>}
     */
    async showSoftConfirmation(title, details, onConfirm, onCancel) {
        this.adapter.log.info(`Showing soft confirmation: ${title}`);
        
        // Clear any existing dialog
        await this.clear();
        
        // Setup dialog state
        this.active = true;
        this.dialogType = 'soft';
        this.title = title;
        this.warning = null;
        this.details = Array.isArray(details) ? details : [details];
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        
        // Update runtime state
        await this.adapter.setStateAsync('runtime.confirmationPending', true, true);
        
        // Render dialog
        await this.renderDialog();
    }
    
    /**
     * Show hard confirmation dialog
     * Accepts OVFY only (no LSK shortcut)
     * 
     * @param {string} title - Action title (e.g., "ALLE DATEN LÖSCHEN")
     * @param {string} warning - Warning message (e.g., "ACHTUNG: NICHT RÜCKGÄNGIG")
     * @param {string|string[]} details - Details to show
     * @param {function} onConfirm - Callback on confirmation
     * @returns {Promise<void>}
     */
    async showHardConfirmation(title, warning, details, onConfirm) {
        this.adapter.log.warn(`Showing hard confirmation: ${title}`);
        
        // Clear any existing dialog
        await this.clear();
        
        // Setup dialog state
        this.active = true;
        this.dialogType = 'hard';
        this.title = title;
        this.warning = warning;
        this.details = Array.isArray(details) ? details : [details];
        this.onConfirm = onConfirm;
        this.onCancel = null; // Hard confirmations cannot be canceled via LSK
        
        // Update runtime state
        await this.adapter.setStateAsync('runtime.confirmationPending', true, true);
        
        // Render dialog
        await this.renderDialog();
    }
    
    /**
     * Show countdown confirmation dialog
     * Auto-executes after countdown expires, can be canceled with LSK or OVFY to confirm early
     * 
     * @param {string} title - Action title
     * @param {number} seconds - Countdown duration in seconds
     * @param {function} onConfirm - Callback on confirmation
     * @param {function} onCancel - Callback on cancellation
     * @returns {Promise<void>}
     */
    async showCountdownConfirmation(title, seconds, onConfirm, onCancel) {
        this.adapter.log.info(`Showing countdown confirmation: ${title} (${seconds}s)`);
        
        // Clear any existing dialog
        await this.clear();
        
        // Setup dialog state
        this.active = true;
        this.dialogType = 'countdown';
        this.title = title;
        this.warning = null;
        this.countdownSeconds = seconds;
        this.details = [`Automatische Ausführung in ${seconds} Sekunden`];
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        
        // Update runtime state
        await this.adapter.setStateAsync('runtime.confirmationPending', true, true);
        
        // Start countdown timer
        this.startCountdown();
        
        // Render dialog
        await this.renderDialog();
    }
    
    /**
     * Start countdown timer
     */
    startCountdown() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
        }
        
        this.countdownTimer = setInterval(async () => {
            this.countdownSeconds--;
            
            // Update details with remaining time
            this.details = [`Automatische Ausführung in ${this.countdownSeconds} Sekunden`];
            
            // Re-render dialog with updated countdown
            await this.renderDialog();
            
            // Check if countdown expired
            if (this.countdownSeconds <= 0) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
                
                // Auto-confirm
                this.adapter.log.info('Countdown expired - auto-confirming');
                await this.confirm();
            }
        }, 1000);
    }
    
    /**
     * Handle user response to confirmation dialog
     * 
     * @param {string} key - Key pressed (LSK6L|LSK6R|OVFY)
     * @returns {Promise<void>}
     */
    async handleResponse(key) {
        if (!this.active) {
            this.adapter.log.debug('No active confirmation dialog');
            return;
        }
        
        this.adapter.log.debug(`Confirmation response: ${key} (type: ${this.dialogType})`);
        
        // Handle based on dialog type
        if (this.dialogType === 'hard') {
            // Hard confirmation: only OVFY accepted
            if (key === 'OVFY') {
                await this.confirm();
            } else {
                this.adapter.log.debug('Hard confirmation requires OVFY key');
                // Show brief error feedback
                await this.showInstruction('NUR OVFY-TASTE!', 'red', 1000);
            }
        }
        else if (this.dialogType === 'soft' || this.dialogType === 'countdown') {
            // Soft/countdown: LSK6R or OVFY confirms, LSK6L cancels
            if (key === 'LSK6R' || key === 'OVFY') {
                await this.confirm();
            }
            else if (key === 'LSK6L') {
                await this.cancel();
            }
        }
    }
    
    /**
     * Confirm action
     * @returns {Promise<void>}
     */
    async confirm() {
        this.adapter.log.info('Confirmation accepted');
        
        // Stop countdown if active
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
        
        // Execute callback
        if (this.onConfirm) {
            try {
                await this.onConfirm();
            } catch (error) {
                this.adapter.log.error(`Confirmation callback failed: ${error.message}`);
            }
        }
        
        // Clear dialog
        await this.clear();
    }
    
    /**
     * Cancel action
     * @returns {Promise<void>}
     */
    async cancel() {
        this.adapter.log.info('Confirmation canceled');
        
        // Stop countdown if active
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
        
        // Execute callback
        if (this.onCancel) {
            try {
                await this.onCancel();
            } catch (error) {
                this.adapter.log.error(`Cancellation callback failed: ${error.message}`);
            }
        }
        
        // Clear dialog
        await this.clear();
    }
    
    /**
     * Clear dialog and restore page
     * @returns {Promise<void>}
     */
    async clear() {
        if (!this.active) {
            return;
        }
        
        this.adapter.log.debug('Clearing confirmation dialog');
        
        // Stop countdown if active
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }
        
        // Reset state
        this.active = false;
        this.dialogType = null;
        this.title = null;
        this.warning = null;
        this.details = [];
        this.onConfirm = null;
        this.onCancel = null;
        this.countdownSeconds = null;
        
        // Update runtime state
        await this.adapter.setStateAsync('runtime.confirmationPending', false, true);
        
        // Re-render current page
        await this.adapter.renderCurrentPage();
    }
    
    /**
     * Render confirmation dialog to display
     * @returns {Promise<void>}
     */
    async renderDialog() {
        if (!this.active) {
            return;
        }
        
        const lines = [];
        
        // Line 1: Title (centered, white)
        lines.push({
            text: this.centerText(this.title || ''),
            color: 'white'
        });
        
        // Line 2: Warning (centered, red) or empty
        if (this.warning) {
            lines.push({
                text: this.centerText(`⚠️  ${this.warning}`),
                color: 'red'
            });
        } else {
            lines.push({
                text: this.padText(''),
                color: 'white'
            });
        }
        
        // Line 3: Separator
        lines.push({
            text: this.padText('─'.repeat(this.columns)),
            color: 'white'
        });
        
        // Lines 4-10: Details (7 lines available)
        const detailLines = this.formatDetails(this.details, 7);
        for (const line of detailLines) {
            lines.push({
                text: this.padText(line),
                color: 'white'
            });
        }
        
        // Line 11: Separator
        lines.push({
            text: this.padText('─'.repeat(this.columns)),
            color: 'white'
        });
        
        // Line 12: Instruction
        let instruction = '';
        if (this.dialogType === 'hard') {
            instruction = 'DRÜCKE OVFY ZUR BESTÄTIGUNG';
        } else if (this.dialogType === 'countdown') {
            instruction = 'OVFY = SOFORT | < = ABBRECHEN';
        } else {
            instruction = 'LSK ODER OVFY ZUR AUSWAHL';
        }
        lines.push({
            text: this.centerText(instruction),
            color: 'amber'
        });
        
        // Line 13: Options
        let options = '';
        if (this.dialogType === 'hard') {
            options = this.centerText('NUR OVFY-TASTE');
        } else {
            options = this.formatOptions();
        }
        lines.push({
            text: options,
            color: 'green'
        });
        
        // Line 14: Empty (scratchpad line)
        lines.push({
            text: this.padText(''),
            color: 'white'
        });
        
        // Publish to display
        await this.displayPublisher.publishFullDisplay(lines);
        
        this.adapter.log.debug('Confirmation dialog rendered');
    }
    
    /**
     * Format details lines to fit available space
     * @param {string[]} details - Details array
     * @param {number} maxLines - Maximum lines available
     * @returns {string[]}
     */
    formatDetails(details, maxLines) {
        const result = [];
        
        for (const detail of details) {
            if (result.length >= maxLines) {
                break;
            }
            
            // Word wrap if needed
            const wrapped = this.wordWrap(detail, this.columns);
            for (const line of wrapped) {
                if (result.length >= maxLines) {
                    break;
                }
                result.push(line);
            }
        }
        
        // Pad with empty lines if needed
        while (result.length < maxLines) {
            result.push('');
        }
        
        return result;
    }
    
    /**
     * Word wrap text to column width
     * @param {string} text - Text to wrap
     * @param {number} width - Column width
     * @returns {string[]}
     */
    wordWrap(text, width) {
        if (text.length <= width) {
            return [text];
        }
        
        const lines = [];
        let remaining = text;
        
        while (remaining.length > width) {
            // Find last space within width
            let breakAt = remaining.lastIndexOf(' ', width);
            if (breakAt === -1) {
                breakAt = width; // Hard break if no space found
            }
            
            lines.push(remaining.substring(0, breakAt).trim());
            remaining = remaining.substring(breakAt).trim();
        }
        
        if (remaining.length > 0) {
            lines.push(remaining);
        }
        
        return lines;
    }
    
    /**
     * Format options line (LSK6L = NEIN, LSK6R = JA)
     * @returns {string}
     */
    formatOptions() {
        const cancel = '< NEIN / ABBRECHEN';
        const confirm = 'JA* / BESTÄTIGEN*';
        
        // Calculate spacing
        const totalLen = cancel.length + confirm.length;
        const spacing = Math.max(1, this.columns - totalLen);
        
        return cancel + ' '.repeat(spacing) + confirm;
    }
    
    /**
     * Center text within column width
     * @param {string} text - Text to center
     * @returns {string}
     */
    centerText(text) {
        if (text.length >= this.columns) {
            return text.substring(0, this.columns);
        }
        
        const padding = this.columns - text.length;
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        
        return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    }
    
    /**
     * Pad text to column width
     * @param {string} text - Text to pad
     * @returns {string}
     */
    padText(text) {
        if (text.length >= this.columns) {
            return text.substring(0, this.columns);
        }
        return text.padEnd(this.columns, ' ');
    }
    
    /**
     * Show brief instruction/error message (temporary overlay on Line 12)
     * @param {string} message - Message to show
     * @param {string} color - Message color
     * @param {number} durationMs - Duration in milliseconds
     * @returns {Promise<void>}
     */
    async showInstruction(message, color, durationMs) {
        // Publish single line update
        await this.displayPublisher.publishLine(12, this.centerText(message), color);
        
        // Restore original dialog after delay
        setTimeout(async () => {
            await this.renderDialog();
        }, durationMs);
    }
    
    /**
     * Check if dialog is currently active
     * @returns {boolean}
     */
    isActive() {
        return this.active;
    }
    
    /**
     * Check if confirmation is pending (alias for isActive)
     * @returns {boolean}
     */
    isPending() {
        return this.active;
    }
    
    /**
     * Get dialog type
     * @returns {string|null}
     */
    getType() {
        return this.dialogType;
    }
}

module.exports = ConfirmationDialog;

/**
 * USAGE EXAMPLES:
 * 
 * Example 1: Soft confirmation (device toggle)
 * 
 * await confirmationDialog.showSoftConfirmation(
 *     'GERÄT AUSSCHALTEN',
 *     ['Wohnzimmer Licht', 'Wird ausgeschaltet'],
 *     async () => {
 *         // Confirm callback
 *         await adapter.setForeignStateAsync('light.0.living.power', false);
 *     },
 *     async () => {
 *         // Cancel callback
 *         adapter.log.info('User canceled');
 *     }
 * );
 * 
 * Example 2: Hard confirmation (delete all)
 * 
 * await confirmationDialog.showHardConfirmation(
 *     'ALLE SZENEN LÖSCHEN',
 *     'ACHTUNG: NICHT RÜCKGÄNGIG',
 *     ['Alle gespeicherten Szenen', 'werden gelöscht', '', 'Fortfahren?'],
 *     async () => {
 *         // Confirm callback
 *         await adapter.setStateAsync('scenes.list', [], true);
 *         adapter.log.warn('All scenes deleted');
 *     }
 * );
 * 
 * Example 3: Countdown confirmation (scheduled action)
 * 
 * await confirmationDialog.showCountdownConfirmation(
 *     'HEIZUNG ABSCHALTEN',
 *     10, // 10 seconds
 *     async () => {
 *         // Confirm callback
 *         await adapter.setForeignStateAsync('heating.0.power', false);
 *         adapter.log.info('Heating turned off');
 *     },
 *     async () => {
 *         // Cancel callback
 *         adapter.log.info('Heating shutdown canceled');
 *     }
 * );
 * 
 * 
 * UNIT TEST EXAMPLES:
 * 
 * Test 1: Soft confirmation - LSK6R confirms
 *   showSoftConfirmation('TEST', ['Details'], confirmFn, cancelFn)
 *   handleResponse('LSK6R') → confirmFn called, dialog cleared
 * 
 * Test 2: Soft confirmation - LSK6L cancels
 *   showSoftConfirmation('TEST', ['Details'], confirmFn, cancelFn)
 *   handleResponse('LSK6L') → cancelFn called, dialog cleared
 * 
 * Test 3: Soft confirmation - OVFY confirms
 *   showSoftConfirmation('TEST', ['Details'], confirmFn, cancelFn)
 *   handleResponse('OVFY') → confirmFn called, dialog cleared
 * 
 * Test 4: Hard confirmation - OVFY only
 *   showHardConfirmation('TEST', 'WARNING', ['Details'], confirmFn)
 *   handleResponse('LSK6R') → error message, no confirm
 *   handleResponse('OVFY') → confirmFn called, dialog cleared
 * 
 * Test 5: Countdown - auto-execute
 *   showCountdownConfirmation('TEST', 2, confirmFn, cancelFn)
 *   Wait 2 seconds → confirmFn called, dialog cleared
 * 
 * Test 6: Countdown - early cancel
 *   showCountdownConfirmation('TEST', 10, confirmFn, cancelFn)
 *   handleResponse('LSK6L') immediately → cancelFn called, timer stopped
 * 
 * Test 7: Countdown - early confirm
 *   showCountdownConfirmation('TEST', 10, confirmFn, cancelFn)
 *   handleResponse('OVFY') immediately → confirmFn called, timer stopped
 */
