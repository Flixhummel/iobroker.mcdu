'use strict';

/**
 * Input Mode Manager
 * 
 * Manages input mode state machine for MCDU input system.
 * State transitions: normal → input → edit → confirm
 * 
 * Features:
 *   - Track current mode (normal, input, edit, confirm)
 *   - Handle keypad character input (0-9, A-Z)
 *   - Manage scratchpad content
 *   - Handle LSK press context (copy vs insert)
 *   - Handle CLR key (context-aware clearing)
 * 
 * State Machine:
 *   NORMAL → INPUT: User types character
 *   INPUT → NORMAL: LSK inserts valid scratchpad
 *   INPUT → EDIT: LSK copies field to scratchpad
 *   EDIT → NORMAL: LSK confirms change
 *   ANY → NORMAL: CLR clears scratchpad or exits
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
        
        /** @type {string} Current mode: normal|input|edit|confirm */
        this.mode = 'normal';
        
        /** @type {number|null} Currently selected line (1-13) */
        this.selectedLine = null;
        
        /** @type {string|null} Selected field side: left|right|display */
        this.selectedSide = null;
        
        /** @type {object|null} Edit field configuration */
        this.editField = null;
        
        /** @type {number} Timestamp of mode change (for timeout) */
        this.modeChangeTime = Date.now();
        
        /** @type {number} Edit mode timeout in ms */
        this.editTimeout = 60000; // 60 seconds
        
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
        
        // Stay in INPUT or EDIT mode, append character
        if (this.mode === 'input' || this.mode === 'edit') {
            const appended = this.scratchpadManager.append(char);
            
            if (!appended) {
                // Scratchpad full - show error
                await this.scratchpadManager.renderError('SCRATCHPAD VOLL');
                return;
            }
            
            // Validate scratchpad if field selected
            if (this.editField && this.validationEngine) {
                const result = await this.validationEngine.validate(
                    this.scratchpadManager.getContent(),
                    this.editField,
                    this.adapter
                );
                
                this.scratchpadManager.setValid(result.valid, result.error);
            }
            
            // Render scratchpad
            await this.scratchpadManager.render();
        }
    }
    
    /**
     * Handle CLR key press (context-aware with double-CLR detection)
     * Priority:
     *   0. Double-CLR (within 1 second) → Emergency exit to HAUPTMENÜ
     *   1. Clear scratchpad if it has content
     *   2. Exit edit mode
     *   3. Navigate back one level
     * @returns {Promise<void>}
     */
    async handleCLR() {
        this.adapter.log.debug(`CLR pressed (mode: ${this.mode}, scratchpad: "${this.scratchpadManager.getContent()}")`);
        
        const now = Date.now();
        
        // Priority 0: Double-CLR detection
        if (now - this.lastCLRPress < this.doubleCLRWindow) {
            this.adapter.log.warn('Double-CLR detected - emergency exit to home page');
            await this.emergencyExit();
            this.lastCLRPress = 0; // Reset to prevent triple-CLR
            return;
        }
        
        // Update last CLR press timestamp
        this.lastCLRPress = now;
        
        // Priority 1: Clear scratchpad if it has content
        if (this.scratchpadManager.hasContent()) {
            this.scratchpadManager.clear();
            await this.scratchpadManager.render();
            this.adapter.log.info('Scratchpad cleared');
            return;
        }
        
        // Priority 2: Exit edit mode
        if (this.mode === 'edit') {
            await this.exitEditMode();
            this.adapter.log.info('Mode: EDIT → NORMAL');
            return;
        }
        
        // Priority 3: Navigate to parent page (if current page has a parent)
        if (this.mode === 'normal' || this.mode === 'input') {
            const currentPageState = await this.adapter.getStateAsync('runtime.currentPage');
            const currentPageId = currentPageState?.val;
            if (currentPageId) {
                const pages = this.adapter.config.pages || [];
                const currentPage = pages.find(p => p.id === currentPageId);
                if (currentPage && currentPage.parent) {
                    const parentPage = pages.find(p => p.id === currentPage.parent);
                    if (parentPage) {
                        await this.adapter.switchToPage(parentPage.id);
                        this.adapter.log.info(`Navigate to parent: ${parentPage.id}`);
                    }
                }
            }
        }
    }
    
    /**
     * Emergency exit to home page (double-CLR)
     * @returns {Promise<void>}
     */
    async emergencyExit() {
        // Clear all active states
        this.scratchpadManager.clear();
        await this.exitEditMode();
        
        // Show visual feedback
        await this.scratchpadManager.renderError('← ZURÜCK ZU HAUPTMENÜ', 'amber', 500);
        
        // Jump to first page (home/hauptmenü)
        const firstPage = this.adapter.config.pages?.[0];
        if (firstPage) {
            await this.adapter.switchToPage(firstPage.id);
            this.adapter.log.info('Emergency exit to home page');
        }
    }
    
    /**
     * Handle LSK press (Line Select Key)
     * Context-aware behavior:
     *   - Scratchpad has content → INSERT
     *   - Scratchpad empty, field editable → COPY
     *   - Field not editable → Execute action (navigation, toggle)
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
        let field = null;
        let fieldSide = null;

        // New format: left.button / right.button
        if (lineConfig.left || lineConfig.right) {
            const sideConfig = side === 'left' ? lineConfig.left : lineConfig.right;
            if (sideConfig?.button && sideConfig.button.type !== 'empty') {
                field = sideConfig.button;
                fieldSide = side;
            } else if (sideConfig?.display && sideConfig.display.type !== 'empty') {
                field = sideConfig.display;
                fieldSide = side;
            }
        } else {
            // Old format: leftButton / rightButton / display
            if (side === 'left' && lineConfig.leftButton) {
                field = lineConfig.leftButton;
                fieldSide = 'left';
            } else if (side === 'right' && lineConfig.rightButton) {
                field = lineConfig.rightButton;
                fieldSide = 'right';
            } else if (lineConfig.display) {
                field = lineConfig.display;
                fieldSide = 'display';
            }
        }
        
        if (!field || field.type === 'empty') {
            this.adapter.log.debug(`No field for ${side} on line ${lineNumber}`);
            return;
        }
        
        // Case 1: Scratchpad has content → INSERT
        if (this.scratchpadManager.hasContent() && field.editable) {
            await this.insertFromScratchpad(field, lineNumber, fieldSide);
            return;
        }
        
        // Case 2: Scratchpad empty, field editable → COPY
        if (!this.scratchpadManager.hasContent() && field.editable) {
            await this.copyToScratchpad(field, lineNumber, fieldSide);
            return;
        }
        
        // Case 3: Field not editable → Execute action
        if (!field.editable) {
            await this.executeFieldAction(field);
            return;
        }
    }
    
    /**
     * Insert scratchpad content into field (with validation)
     * @param {object} field - Field configuration
     * @param {number} lineNumber - Line number
     * @param {string} fieldSide - Field side
     * @returns {Promise<void>}
     */
    async insertFromScratchpad(field, lineNumber, fieldSide) {
        this.adapter.log.debug(`Insert from scratchpad to ${fieldSide} line ${lineNumber}`);
        
        // Validate scratchpad content
        let validation = { valid: true, error: null };
        
        if (this.validationEngine) {
            validation = await this.validationEngine.validate(
                this.scratchpadManager.getContent(),
                field,
                this.adapter
            );
        } else {
            // Fallback to scratchpad's own validation
            validation = this.scratchpadManager.validate(field);
        }
        
        if (!validation.valid) {
            // Show error, stay in INPUT mode
            this.scratchpadManager.setValid(false, validation.error);
            await this.scratchpadManager.render();
            await this.scratchpadManager.renderError(validation.error);
            this.adapter.log.warn(`Validation failed: ${validation.error}`);
            return;
        }
        
        // Convert scratchpad to appropriate type
        let value = this.scratchpadManager.getContent();
        if (field.inputType === 'numeric') {
            value = parseFloat(value);
        }
        
        // Write to ioBroker state
        if (field.source) {
            try {
                await this.adapter.setForeignStateAsync(field.source, value);
                this.adapter.log.info(`Value written to ${field.source}: ${value}`);
                
                // Clear scratchpad
                this.scratchpadManager.clear();
                
                // Return to NORMAL mode
                this.mode = 'normal';
                this.selectedLine = null;
                this.selectedSide = null;
                this.editField = null;
                
                await this.adapter.setStateAsync('runtime.mode', 'normal', true);
                await this.adapter.setStateAsync('runtime.editActive', false, true);
                
                // Show success feedback
                await this.scratchpadManager.renderSuccess('OK GESPEICHERT');
                
                // Re-render page to show new value
                await this.adapter.renderCurrentPage();
                
                this.adapter.log.info('Mode: INPUT → NORMAL (insert successful)');
                
            } catch (error) {
                this.adapter.log.error(`Failed to write value: ${error.message}`);
                await this.scratchpadManager.renderError('FEHLER BEIM SPEICHERN');
            }
        }
    }
    
    /**
     * Copy field value to scratchpad
     * @param {object} field - Field configuration
     * @param {number} lineNumber - Line number
     * @param {string} fieldSide - Field side
     * @returns {Promise<void>}
     */
    async copyToScratchpad(field, lineNumber, fieldSide) {
        this.adapter.log.debug(`Copy to scratchpad from ${fieldSide} line ${lineNumber}`);
        
        if (!field.source) {
            this.adapter.log.warn('Field has no data source to copy');
            return;
        }
        
        try {
            // Read current value from ioBroker
            const state = await this.adapter.getForeignStateAsync(field.source);
            const value = state?.val;
            
            if (value === null || value === undefined) {
                this.scratchpadManager.set('');
            } else {
                // Format value for editing
                if (field.inputType === 'numeric') {
                    this.scratchpadManager.set(String(value));
                } else {
                    this.scratchpadManager.set(String(value));
                }
            }
            
            // Enter EDIT mode
            this.mode = 'edit';
            this.selectedLine = lineNumber;
            this.selectedSide = fieldSide;
            this.editField = field;
            this.modeChangeTime = Date.now();
            
            await this.adapter.setStateAsync('runtime.mode', 'edit', true);
            await this.adapter.setStateAsync('runtime.editActive', true, true);
            await this.adapter.setStateAsync('runtime.selectedLine', lineNumber, true);
            
            // Render scratchpad (amber for editing)
            await this.scratchpadManager.render('amber');
            
            // Re-render page with edit indicators
            await this.adapter.renderCurrentPage();
            
            this.adapter.log.info('Mode: NORMAL → EDIT (value copied to scratchpad)');
            
        } catch (error) {
            this.adapter.log.error(`Failed to copy value: ${error.message}`);
            await this.scratchpadManager.renderError('FEHLER BEIM LESEN');
        }
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
     * Exit edit mode (cancel editing)
     * @returns {Promise<void>}
     */
    async exitEditMode() {
        this.mode = 'normal';
        this.selectedLine = null;
        this.selectedSide = null;
        this.editField = null;
        
        await this.adapter.setStateAsync('runtime.mode', 'normal', true);
        await this.adapter.setStateAsync('runtime.editActive', false, true);
        await this.adapter.setStateAsync('runtime.selectedLine', null, true);
        
        // Clear scratchpad
        this.scratchpadManager.clear();
        await this.scratchpadManager.render();
        
        // Re-render page to remove edit indicators
        await this.adapter.renderCurrentPage();
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
     * Get selected field
     * @returns {object|null}
     */
    getSelectedField() {
        return this.editField;
    }
    
    /**
     * Set mode (for external control)
     * @param {string} newMode - New mode
     */
    async setState(newMode) {
        this.mode = newMode;
        this.modeChangeTime = Date.now();
        await this.adapter.setStateAsync('runtime.mode', newMode, true);
        
        // Phase 4.1: Track edit mode state
        const isEditActive = (newMode === 'edit');
        await this.adapter.setStateAsync('runtime.editActive', isEditActive, true);
        
        this.adapter.log.debug(`Mode changed to: ${newMode}`);
    }
    
    /**
     * Get current state (for debugging)
     * @returns {object}
     */
    getState() {
        return {
            mode: this.mode,
            selectedLine: this.selectedLine,
            selectedSide: this.selectedSide,
            scratchpadContent: this.scratchpadManager.getContent(),
            scratchpadValid: this.scratchpadManager.getValid()
        };
    }
    
    /**
     * Check for edit mode timeout and auto-cancel
     * Should be called periodically (e.g., every 5 seconds via setInterval)
     * @returns {Promise<void>}
     */
    async checkTimeout() {
        if (this.mode === 'edit' || this.mode === 'input') {
            const elapsed = Date.now() - this.modeChangeTime;
            if (elapsed > this.editTimeout) {
                this.adapter.log.warn('Edit mode timeout - auto-canceling');
                
                // Clear scratchpad and exit edit mode
                this.scratchpadManager.clear();
                await this.exitEditMode();
                
                // Show timeout message (amber, 2 seconds)
                await this.scratchpadManager.renderError('TIMEOUT - BEARBEITUNG ABGEBROCHEN', 'amber', 2000);
            }
        }
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

/**
 * STATE MACHINE TRANSITIONS (Unit Test Examples):
 * 
 * Test 1: NORMAL → INPUT (user types)
 *   mode = 'normal', scratchpad = ''
 *   handleKeyInput('2') → mode = 'input', scratchpad = '2'
 * 
 * Test 2: INPUT → NORMAL (valid insert)
 *   mode = 'input', scratchpad = '22.5'
 *   handleLSK('left', 2) with editable field
 *     → validate → insert → mode = 'normal', scratchpad = ''
 * 
 * Test 3: INPUT → INPUT (invalid insert)
 *   mode = 'input', scratchpad = '35' (out of range)
 *   handleLSK('left', 2)
 *     → validate fails → scratchpad RED, error shown
 *     → mode stays 'input', scratchpad = '35'
 * 
 * Test 4: NORMAL → EDIT (copy to scratchpad)
 *   mode = 'normal', scratchpad = ''
 *   handleLSK('left', 2) with editable field showing '21.0'
 *     → copy value → mode = 'edit', scratchpad = '21.0' (amber)
 * 
 * Test 5: CLR clears scratchpad
 *   mode = 'input', scratchpad = '22.5'
 *   handleCLR() → scratchpad = '', mode = 'input'
 * 
 * Test 6: CLR exits edit mode
 *   mode = 'edit', scratchpad = ''
 *   handleCLR() → mode = 'normal'
 * 
 * Test 7: Edit timeout
 *   mode = 'edit', modeChangeTime = now - 61000 (61 seconds ago)
 *   checkTimeout() → mode = 'normal', error shown
 */
