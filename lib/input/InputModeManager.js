'use strict';

/**
 * Input Mode Manager
 *
 * Manages input mode state machine for MCDU input system.
 * Simplified state transitions: NORMAL ↔ INPUT only.
 *
 * Features:
 *   - Track current mode (normal, input)
 *   - Handle keypad character input (0-9, A-Z)
 *   - Manage scratchpad content
 *   - Handle LSK press: metadata-driven toggle/write from ioBroker object metadata
 *   - Handle CLR key (context-aware clearing with Airbus error recovery)
 *
 * State Machine:
 *   NORMAL → INPUT: User types character
 *   INPUT → NORMAL: Successful value write or CLR clears scratchpad
 *
 * LSK on Datapoint (metadata-driven):
 *   1. Look up adapter.datapointMeta for source
 *   2. NOT writable → ignore
 *   3. Boolean → toggle immediately (no scratchpad)
 *   4. Number/String + scratchpad content → validate & write
 *   5. Number/String + scratchpad empty → ignore
 *
 * @author Kira Holt
 */

class InputModeManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} scratchpadManager - ScratchpadManager instance
     * @param {object|null} validationEngine - ValidationEngine instance (optional)
     */
    constructor(adapter, scratchpadManager, validationEngine = null) {
        this.adapter = adapter;
        this.scratchpadManager = scratchpadManager;
        this.validationEngine = validationEngine;

        /** @type {string} Current mode: normal|input */
        this.mode = 'normal';

        /** @type {number} Timestamp of mode change (for timeout) */
        this.modeChangeTime = Date.now();

        /** @type {number} Last CLR press timestamp (for double-CLR detection) */
        this.lastCLRPress = 0;

        /** @type {number} Double-CLR window in ms */
        this.doubleCLRWindow = 1000; // 1 second

        this.adapter.log.debug('InputModeManager initialized');
    }

    /**
     * Handle keypad character input (0-9, A-Z, special chars)
     * @param {string} char - Character pressed
     * @returns {Promise<void>}
     */
    async handleKeyInput(char) {
        this.adapter.log.debug(`Key input: "${char}" (mode: ${this.mode})`);

        // Transition: NORMAL → INPUT (first character typed)
        if (this.mode === 'normal') {
            this.mode = 'input';
            this.modeChangeTime = Date.now();
            this.scratchpadManager.append(char);

            // Update runtime state
            await this.adapter.setStateAsync('runtime.mode', 'input', true);

            // Render scratchpad
            await this.scratchpadManager.render();

            this.adapter.log.info('Mode: NORMAL → INPUT');
            return;
        }

        // Stay in INPUT mode, append character
        if (this.mode === 'input') {
            // Refresh timeout on every keystroke
            this.modeChangeTime = Date.now();

            const appended = this.scratchpadManager.append(char);

            if (!appended) {
                // Scratchpad full — show error once (not on every bounce)
                if (!this.scratchpadManager.fullErrorShowing) {
                    this.scratchpadManager.fullErrorShowing = true;
                    await this.scratchpadManager.renderError('SCRATCHPAD VOLL');
                }
                return;
            }

            // Render scratchpad
            await this.scratchpadManager.render();
        }
    }

    /**
     * Handle CLR key press (context-aware with double-CLR detection)
     * Priority:
     *   0. Double-CLR (within 1 second) → Emergency exit to home
     *   1. Clear scratchpad if it has content (Airbus: restores rejected input first)
     *   2. Navigate to parent page
     * @returns {Promise<void>}
     */
    async handleCLR() {
        this.adapter.log.debug(`CLR pressed (mode: ${this.mode}, scratchpad: "${this.scratchpadManager.getContent()}")`);

        const now = Date.now();

        // Priority 0: Double-CLR detection
        if (this.lastCLRPress > 0 && now - this.lastCLRPress < this.doubleCLRWindow) {
            this.adapter.log.warn('Double-CLR detected - emergency exit to home page');
            await this.emergencyExit();
            this.lastCLRPress = 0;
            return;
        }

        // Priority 1: Clear scratchpad if it has content (or error is showing)
        if (this.scratchpadManager.hasContent() || this.scratchpadManager.errorShowing) {
            this.lastCLRPress = now;
            this.scratchpadManager.clear();
            await this.scratchpadManager.render();

            // If scratchpad is now empty, return to NORMAL mode
            if (!this.scratchpadManager.hasContent()) {
                this.mode = 'normal';
                await this.adapter.setStateAsync('runtime.mode', 'normal', true);
            }
            this.adapter.log.info('Scratchpad cleared');
            return;
        }

        // Priority 2: Navigate to parent page
        if (this.mode === 'normal' || this.mode === 'input') {
            const currentPageState = await this.adapter.getStateAsync('runtime.currentPage');
            const currentPageId = currentPageState?.val;
            if (currentPageId) {
                const pages = this.adapter.config.pages || [];
                const currentPage = pages.find(p => p.id === currentPageId);
                if (currentPage && currentPage.parent) {
                    const parentPage = pages.find(p => p.id === currentPage.parent);
                    if (parentPage) {
                        this.lastCLRPress = now;
                        await this.adapter.switchToPage(parentPage.id);
                        this.adapter.log.info(`Navigate to parent: ${parentPage.id}`);
                        return;
                    }
                }
            }
        }

        // CLR did nothing meaningful
        this.adapter.log.debug('CLR: no action taken (empty scratchpad, no parent)');
    }

    /**
     * Emergency exit to home page (double-CLR)
     * @returns {Promise<void>}
     */
    async emergencyExit() {
        // Clear all active states
        this.scratchpadManager.clear();
        this.mode = 'normal';
        await this.adapter.setStateAsync('runtime.mode', 'normal', true);

        // Show visual feedback
        await this.scratchpadManager.renderError('← ZURUECK ZU HAUPTMENUE', 'amber', 500);

        // Jump to first page (home)
        const firstPage = this.adapter.config.pages?.[0];
        if (firstPage) {
            await this.adapter.switchToPage(firstPage.id);
            this.adapter.log.info('Emergency exit to home page');
        }
    }

    /**
     * Handle LSK press (Line Select Key)
     * Metadata-driven behavior:
     *   - Datapoint display + boolean → toggle
     *   - Datapoint display + number/string + scratchpad content → validate & write
     *   - Navigation button → execute navigation
     *   - No button and no datapoint → ignore
     *
     * @param {string} side - Button side: left|right
     * @param {number} lineNumber - Line number (1-13)
     * @returns {Promise<void>}
     */
    async handleLSK(side, lineNumber) {
        this.adapter.log.debug(`LSK pressed: ${side} line ${lineNumber} (mode: ${this.mode})`);

        // Get current page
        const currentPageState = await this.adapter.getStateAsync('runtime.currentPage');
        const currentPageId = currentPageState?.val;

        if (!currentPageId) {
            this.adapter.log.warn('No current page set');
            return;
        }

        // Find page config
        const pageConfig = this.findPageConfig(currentPageId);
        if (!pageConfig) {
            this.adapter.log.error(`Page config not found: ${currentPageId}`);
            return;
        }

        // Find line config
        const lineConfig = pageConfig.lines?.find(l => l.row === lineNumber);
        if (!lineConfig) {
            this.adapter.log.debug(`No line config for row ${lineNumber}`);
            return;
        }

        // Get field config (supports both old and new line format)
        let buttonField = null;
        let displayField = null;

        // New format: left.button / right.button / left.display / right.display
        if (lineConfig.left || lineConfig.right) {
            const sideConfig = side === 'left' ? lineConfig.left : lineConfig.right;
            if (sideConfig?.button && sideConfig.button.type !== 'empty' && this.isActionableButton(sideConfig.button)) {
                buttonField = sideConfig.button;
            }
            if (sideConfig?.display && sideConfig.display.type !== 'empty') {
                displayField = sideConfig.display;
            }
        } else {
            // Old format
            if (side === 'left' && lineConfig.leftButton) {
                buttonField = lineConfig.leftButton;
            } else if (side === 'right' && lineConfig.rightButton) {
                buttonField = lineConfig.rightButton;
            }
            if (lineConfig.display) {
                displayField = lineConfig.display;
            }
        }

        // Priority 1: If there's a navigation/datapoint button, execute it
        if (buttonField && buttonField.type !== 'empty') {
            await this.executeFieldAction(buttonField);
            return;
        }

        // Priority 2: If display is a datapoint, use metadata-driven interaction
        if (displayField && displayField.type === 'datapoint' && displayField.source) {
            await this.handleDatapointLSK(displayField);
            return;
        }

        this.adapter.log.debug(`No actionable field for ${side} on line ${lineNumber}`);
    }

    /**
     * Handle LSK on a datapoint display field using ioBroker metadata
     * @param {object} displayField - Display config with type='datapoint' and source
     * @returns {Promise<void>}
     */
    async handleDatapointLSK(displayField) {
        const source = displayField.source;
        const meta = this.adapter.datapointMeta?.get(source);

        if (!meta) {
            this.adapter.log.debug(`No metadata for ${source}, ignoring LSK`);
            return;
        }

        // Not writable → ignore (read-only sensor)
        if (!meta.write) {
            this.adapter.log.debug(`${source} is read-only, ignoring LSK`);
            return;
        }

        // Boolean → toggle immediately
        if (meta.type === 'boolean') {
            await this.toggleBoolean(source);
            return;
        }

        // Number or String → write from scratchpad
        if (meta.type === 'number' || meta.type === 'string') {
            if (!this.scratchpadManager.hasContent()) {
                this.adapter.log.debug('Scratchpad empty, nothing to write');
                return;
            }
            await this.writeFromScratchpad(source, meta);
            return;
        }

        this.adapter.log.debug(`Unsupported datapoint type "${meta.type}" for ${source}`);
    }

    /**
     * Toggle a boolean datapoint
     * @param {string} source - ioBroker state ID
     * @returns {Promise<void>}
     */
    async toggleBoolean(source) {
        try {
            const state = await this.adapter.getForeignStateAsync(source);
            const newVal = !state?.val;
            await this.adapter.setForeignStateAsync(source, newVal);
            this.adapter.log.info(`Toggled ${source}: ${newVal}`);

            // Re-render to show updated value
            await this.adapter.renderCurrentPage();
        } catch (error) {
            this.adapter.log.error(`Failed to toggle ${source}: ${error.message}`);
        }
    }

    /**
     * Validate scratchpad content against metadata and write to datapoint
     * @param {string} source - ioBroker state ID
     * @param {object} meta - Datapoint metadata {type, min, max, unit, states}
     * @returns {Promise<void>}
     */
    async writeFromScratchpad(source, meta) {
        const content = this.scratchpadManager.getContent();

        if (meta.type === 'number') {
            // Validate numeric format
            const num = parseFloat(content);
            if (isNaN(num)) {
                await this.scratchpadManager.showError('FORMAT ERROR');
                return;
            }

            // Range validation
            if (meta.min !== undefined && meta.min !== null && num < meta.min) {
                await this.scratchpadManager.showError('ENTRY OUT OF RANGE');
                return;
            }
            if (meta.max !== undefined && meta.max !== null && num > meta.max) {
                await this.scratchpadManager.showError('ENTRY OUT OF RANGE');
                return;
            }

            // Write number
            try {
                await this.adapter.setForeignStateAsync(source, num);
                this.adapter.log.info(`Written ${source}: ${num}`);
                this.scratchpadManager.clear();
                // Clear doesn't reset mode when savedContent is null and no error
                this.mode = 'normal';
                await this.adapter.setStateAsync('runtime.mode', 'normal', true);
                await this.scratchpadManager.renderSuccess('GESPEICHERT');
                await this.adapter.renderCurrentPage();
            } catch (error) {
                this.adapter.log.error(`Failed to write ${source}: ${error.message}`);
                await this.scratchpadManager.showError('SCHREIBFEHLER');
            }
        } else if (meta.type === 'string') {
            // Write string as-is
            try {
                await this.adapter.setForeignStateAsync(source, content);
                this.adapter.log.info(`Written ${source}: "${content}"`);
                this.scratchpadManager.clear();
                this.mode = 'normal';
                await this.adapter.setStateAsync('runtime.mode', 'normal', true);
                await this.scratchpadManager.renderSuccess('GESPEICHERT');
                await this.adapter.renderCurrentPage();
            } catch (error) {
                this.adapter.log.error(`Failed to write ${source}: ${error.message}`);
                await this.scratchpadManager.showError('SCHREIBFEHLER');
            }
        }
    }

    /**
     * Check if a button config is actually actionable (has a real target).
     * The Admin UI saves button.type = 'datapoint' even when only the display
     * is a datapoint and no button target is set. Such buttons are not actionable.
     * @param {object} button - Button configuration
     * @returns {boolean}
     */
    isActionableButton(button) {
        if (!button || button.type === 'empty') return false;
        // Navigation and datapoint buttons need a target to be actionable
        if (button.type === 'navigation' || button.type === 'datapoint') {
            return !!button.target;
        }
        return true;
    }

    /**
     * Execute field action (navigation, toggle, etc.)
     * @param {object} field - Field configuration
     * @returns {Promise<void>}
     */
    async executeFieldAction(field) {
        this.adapter.log.debug(`Execute field action: ${field.type} ${field.action}`);

        // Delegate to adapter's executeButtonAction
        await this.adapter.executeButtonAction(field);
    }

    /**
     * Get current mode
     * @returns {string}
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get scratchpad manager
     * @returns {object}
     */
    getScratchpad() {
        return this.scratchpadManager;
    }

    /**
     * Set mode (for external control)
     * @param {string} newMode - New mode
     */
    async setState(newMode) {
        this.mode = newMode;
        this.modeChangeTime = Date.now();
        await this.adapter.setStateAsync('runtime.mode', newMode, true);

        this.adapter.log.debug(`Mode changed to: ${newMode}`);
    }

    /**
     * Get current state (for debugging)
     * @returns {object}
     */
    getState() {
        return {
            mode: this.mode,
            scratchpadContent: this.scratchpadManager.getContent(),
            scratchpadValid: this.scratchpadManager.getValid()
        };
    }

    /**
     * Check for timeout — no-op in simplified model (no edit mode timeout)
     * Kept for backward compatibility with the periodic check interval.
     * @returns {Promise<void>}
     */
    async checkTimeout() {
        // No timeout in simplified model — scratchpad persists until CLR
    }

    /**
     * Find page configuration by ID
     * @param {string} pageId - Page ID
     * @returns {object|null}
     */
    findPageConfig(pageId) {
        const pages = this.adapter.config.pages || [];
        return pages.find(p => p.id === pageId) || null;
    }

    /**
     * Set validation engine (for dependency injection)
     * @param {object} validationEngine - ValidationEngine instance
     */
    setValidationEngine(validationEngine) {
        this.validationEngine = validationEngine;
        this.adapter.log.debug('ValidationEngine injected into InputModeManager');
    }
}

module.exports = InputModeManager;
