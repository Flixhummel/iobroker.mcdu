'use strict';

/**
 * Button Subscriber
 * 
 * Subscribes to button events from MQTT and handles them.
 * Features:
 *   - Map LSK buttons to page lines (LSK1 → row 1/2, LSK2 → row 3/4, etc.)
 *   - Execute button actions (navigation only for now)
 *   - Trigger page switches
 * 
 * @author Kira Holt
 */

class ButtonSubscriber {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} mqttClient - MqttClient instance
     * @param {object|null} inputModeManager - InputModeManager instance (optional)
     */
    constructor(adapter, mqttClient, inputModeManager = null) {
        this.adapter = adapter;
        this.mqttClient = mqttClient;
        this.inputModeManager = inputModeManager;
        
        /** @type {object|null} ConfirmationDialog instance */
        this.confirmationDialog = null;
        
        /** @type {boolean} Log button events */
        this.logButtons = adapter.config.debug?.logButtons || false;
        
        /** @type {Map<string, number>} Button to row mapping */
        this.buttonRowMap = this.buildButtonRowMap();
        
        /** @type {Map<string, string>} Keypad key to character mapping */
        this.keypadMap = this.buildKeypadMap();
        
        /** @type {number} Debounce timestamp (to prevent rapid button presses) */
        this.lastButtonPress = 0;
        
        /** @type {number} Debounce interval in ms */
        this.debounceMs = 100;
    }
    
    /**
     * Build keypad key to character mapping
     * @returns {Map<string, string>}
     */
    buildKeypadMap() {
        const map = new Map();
        
        // Numeric keys
        for (let i = 0; i <= 9; i++) {
            map.set(`KEY_${i}`, String(i));
        }
        
        // Alphabetic keys (if available)
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (const letter of letters) {
            map.set(`KEY_${letter}`, letter);
        }
        
        // Special characters
        map.set('KEY_DOT', '.');
        map.set('KEY_SLASH', '/');
        map.set('KEY_SPACE', ' ');
        map.set('KEY_PLUS', '+');
        map.set('KEY_MINUS', '-');
        map.set('KEY_UNDERSCORE', '_');
        
        return map;
    }
    
    /**
     * Build button to row mapping
     * LSK1L/LSK1R → row 1
     * LSK2L/LSK2R → row 3
     * LSK3L/LSK3R → row 5
     * LSK4L/LSK4R → row 7
     * LSK5L/LSK5R → row 9
     * LSK6L/LSK6R → row 11
     * @returns {Map<string, number>}
     */
    buildButtonRowMap() {
        const map = new Map();
        
        for (let i = 1; i <= 6; i++) {
            const row = (i * 2) - 1; // LSK1→1, LSK2→3, LSK3→5, etc.
            map.set(`LSK${i}L`, row);
            map.set(`LSK${i}R`, row);
        }
        
        return map;
    }
    
    /**
     * Subscribe to button events
     * @returns {Promise<void>}
     */
    async subscribe() {
        this.adapter.log.debug('Subscribing to button events from all devices...');
        
        // Subscribe with wildcard (+) to receive events from all devices
        // Pattern: mcdu/+/buttons/event matches mcdu/{any-deviceId}/buttons/event
        await this.mqttClient.subscribe('+/buttons/event', this.handleButtonEvent.bind(this));
        await this.mqttClient.subscribe('+/buttons/keypad', this.handleKeypadEvent.bind(this));
        
        this.adapter.log.info('✅ Subscribed to button events (all devices)');
    }
    
    /**
     * Handle button event from MQTT
     * @param {string} topic - MQTT topic (e.g. "mcdu/mcdu-client-pi/buttons/event")
     * @param {Buffer} message - MQTT message
     */
    async handleButtonEvent(topic, message) {
        try {
            // Extract deviceId from topic: mcdu/{deviceId}/buttons/event
            const topicParts = topic.split('/');
            const deviceId = topicParts[topicParts.length - 3]; // mcdu/{deviceId}/buttons/event
            
            const event = JSON.parse(message.toString());
            const { button, action, timestamp } = event;
            
            if (!deviceId) {
                this.adapter.log.warn(`Could not extract deviceId from topic: ${topic}`);
                return;
            }
            
            if (this.logButtons) {
                this.adapter.log.debug(`Button: ${button} ${action} (${timestamp})`);
            }
            
            // Only handle press events (ignore release)
            if (action !== 'press') {
                return;
            }
            
            // Debounce: Ignore rapid button presses (< 100ms apart)
            const now = Date.now();
            if (now - this.lastButtonPress < this.debounceMs) {
                this.adapter.log.debug(`Button ${button} debounced`);
                return;
            }
            this.lastButtonPress = now;
            
            // Phase 4.1: Update runtime states for button tracking
            await this.adapter.setStateAsync('runtime.lastButtonPress', button, true);
            await this.adapter.setStateAsync('runtime.lastButtonTime', timestamp, true);
            
            // Priority 1: Check if confirmation dialog is active
            if (this.confirmationDialog && this.confirmationDialog.isActive()) {
                // Confirmation dialog is active - only handle confirmation keys
                if (button === 'OVFY' || button === 'LSK6L' || button === 'LSK6R') {
                    await this.confirmationDialog.handleResponse(button);
                } else {
                    this.adapter.log.debug(`Button ${button} ignored - confirmation active`);
                }
                return;
            }
            
            // Priority 2: Normal button handling
            // Handle LSK buttons
            if (button.startsWith('LSK')) {
                await this.handleLskButton(button);
            }
            // Handle CLR key (context-aware)
            else if (button === 'CLR') {
                await this.handleCLRKey();
            }
            // Handle OVFY key (confirm)
            else if (button === 'OVFY') {
                await this.handleOVFYKey();
            }
            // Handle function keys (e.g., MENU, DIR, etc.)
            else if (this.isFunctionKey(button)) {
                await this.handleFunctionKey(button);
            }
            // Other buttons
            else {
                this.adapter.log.debug(`Button ${button} not handled`);
            }
            
        } catch (error) {
            this.adapter.log.error(`Error handling button event: ${error.message}`);
        }
    }
    
    /**
     * Handle keypad event (0-9, A-Z, special chars)
     * @param {string} topic - MQTT topic
     * @param {Buffer} message - MQTT message
     */
    async handleKeypadEvent(topic, message) {
        try {
            const event = JSON.parse(message.toString());
            const { key, state, timestamp } = event;
            
            if (this.logButtons) {
                this.adapter.log.debug(`Keypad: ${key} ${state} (${timestamp})`);
            }
            
            // Only handle press events
            if (state !== 'pressed') {
                return;
            }
            
            // Map key to character
            const char = this.keypadMap.get(key);
            if (!char) {
                this.adapter.log.debug(`Unknown keypad key: ${key}`);
                return;
            }
            
            // Delegate to InputModeManager if available
            if (this.inputModeManager) {
                await this.inputModeManager.handleKeyInput(char);
            } else {
                this.adapter.log.warn('InputModeManager not available - keypad input ignored');
            }
            
        } catch (error) {
            this.adapter.log.error(`Error handling keypad event: ${error.message}`);
        }
    }
    
    /**
     * Handle CLR key press (context-aware)
     * @returns {Promise<void>}
     */
    async handleCLRKey() {
        if (this.inputModeManager) {
            await this.inputModeManager.handleCLR();
        } else {
            // Fallback: navigate back
            const previousPageState = await this.adapter.getStateAsync('runtime.previousPage');
            if (previousPageState && previousPageState.val) {
                await this.adapter.switchToPage(previousPageState.val);
            }
        }
    }
    
    /**
     * Handle OVFY key press (confirm)
     * Priority:
     *   1. If confirmation active → handled above (never reaches here)
     *   2. If soft confirmation shortcut → confirm
     *   3. Otherwise → log (no action)
     * @returns {Promise<void>}
     */
    async handleOVFYKey() {
        // OVFY shortcuts soft confirmations (already handled above if confirmation active)
        // If no confirmation active, OVFY has no action in normal mode
        this.adapter.log.debug('OVFY pressed (no active confirmation)');
    }
    
    /**
     * Handle LSK button press
     * @param {string} button - Button name (e.g., "LSK1L")
     * @returns {Promise<void>}
     */
    async handleLskButton(button) {
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
        
        // Map button to row
        const row = this.buttonRowMap.get(button);
        if (!row) {
            this.adapter.log.warn(`Unknown LSK button: ${button}`);
            return;
        }
        
        // Find line config
        const lineConfig = pageConfig.lines?.find(l => l.row === row);
        if (!lineConfig) {
            this.adapter.log.debug(`No line config for row ${row}`);
            return;
        }
        
        // Determine button side (left or right)
        const side = button.endsWith('L') ? 'left' : 'right';
        
        // If InputModeManager available, delegate LSK handling
        if (this.inputModeManager) {
            await this.inputModeManager.handleLSK(side, row);
        } else {
            // Fallback: Execute button action directly (Phase 1 behavior)
            const buttonConfig = this.getButtonConfig(lineConfig, side);

            if (!buttonConfig || buttonConfig.type === 'empty') {
                this.adapter.log.debug(`Button ${button} not configured`);
                return;
            }

            await this.executeButtonAction(buttonConfig);
        }
    }
    
    /**
     * Handle function key press (MENU, DIR, INIT, PREV_PAGE, NEXT_PAGE, etc.)
     * @param {string} button - Button name
     * @returns {Promise<void>}
     */
    async handleFunctionKey(button) {
        this.adapter.log.debug(`Function key: ${button}`);

        // Clear edit mode for all function keys (except PREV/NEXT PAGE)
        if (button !== 'PREV_PAGE' && button !== 'NEXT_PAGE') {
            if (this.inputModeManager) {
                const currentMode = this.inputModeManager.getMode();
                if (currentMode === 'edit') {
                    await this.inputModeManager.setState('normal');
                    this.adapter.log.debug(`${button} cleared edit mode`);
                }
            }
        }

        // PREV_PAGE and NEXT_PAGE: hardcoded pagination logic (not configurable)
        if (button === 'PREV_PAGE') {
            this.adapter.log.debug('PREV_PAGE key');
            if (this.adapter.pageRenderer && this.adapter.pageRenderer.currentPageOffset > 0) {
                this.adapter.pageRenderer.currentPageOffset--;
                await this.adapter.renderCurrentPage();
            } else {
                await this.adapter.navigatePrevious();
            }
            return;
        }
        if (button === 'NEXT_PAGE') {
            this.adapter.log.debug('NEXT_PAGE key');
            if (this.adapter.pageRenderer &&
                this.adapter.pageRenderer.currentPageOffset < this.adapter.pageRenderer.totalPages - 1) {
                this.adapter.pageRenderer.currentPageOffset++;
                await this.adapter.renderCurrentPage();
            } else {
                await this.adapter.navigateNext();
            }
            return;
        }

        // Config-driven function key handling
        const functionKeys = this.adapter.config.functionKeys || [];
        const keyConfig = functionKeys.find(fk => fk.key === button);

        if (!keyConfig || !keyConfig.enabled) {
            this.adapter.log.debug(`Function key ${button} not configured or disabled`);
            return;
        }

        switch (keyConfig.action) {
            case 'navigateHome':
                this.adapter.log.info(`${button} key - navigating to home page`);
                await this.adapter.navigateHome();
                break;

            case 'gotoPage':
                if (keyConfig.targetPageId) {
                    this.adapter.log.info(`${button} key - navigating to ${keyConfig.targetPageId}`);
                    await this.adapter.switchToPage(keyConfig.targetPageId);
                } else {
                    this.adapter.log.debug(`${button} key - no target page configured`);
                }
                break;

            case 'directAccess':
                this.adapter.log.info(`${button} key - direct page access`);
                if (this.inputModeManager) {
                    const content = this.inputModeManager.getScratchpad().getContent();
                    if (content) {
                        const targetPage = this.adapter.config.pages?.find(
                            p => p.id === content || p.id === content.toLowerCase()
                        );
                        if (targetPage) {
                            this.inputModeManager.getScratchpad().clear();
                            await this.adapter.switchToPage(targetPage.id);
                        } else {
                            await this.inputModeManager.getScratchpad().renderError('PAGE NOT FOUND');
                        }
                    } else {
                        this.adapter.log.debug(`${button} pressed with empty scratchpad`);
                    }
                }
                break;

            default:
                this.adapter.log.debug(`Unknown action for ${button}: ${keyConfig.action}`);
                break;
        }
    }
    
    /**
     * Execute button action
     * @param {object} buttonConfig - Button configuration
     * @returns {Promise<void>}
     */
    async executeButtonAction(buttonConfig) {
        await this.adapter.executeButtonAction(buttonConfig);
    }
    
    /**
     * Check if button is a function key
     * @param {string} button - Button name
     * @returns {boolean}
     */
    isFunctionKey(button) {
        const functionKeys = [
            'DIR', 'PROG', 'PERF', 'INIT', 'FPLN', 'RAD', 'FUEL', 'SEC', 'ATC', 'MENU', 'AIRPORT',
            'PREV_PAGE', 'NEXT_PAGE'
        ];
        return functionKeys.includes(button);
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
     * Get button config from a line config (supports both old and new format)
     * @param {object} lineConfig - Line configuration
     * @param {string} side - 'left' or 'right'
     * @returns {object|null} Button configuration
     */
    getButtonConfig(lineConfig, side) {
        // New format: left.button / right.button
        if (lineConfig.left || lineConfig.right) {
            return side === 'left'
                ? lineConfig.left?.button
                : lineConfig.right?.button;
        }
        // Old format: leftButton / rightButton
        return side === 'left' ? lineConfig.leftButton : lineConfig.rightButton;
    }
    
    /**
     * Set InputModeManager (for dependency injection)
     * @param {object} inputModeManager - InputModeManager instance
     */
    setInputModeManager(inputModeManager) {
        this.inputModeManager = inputModeManager;
        this.adapter.log.debug('InputModeManager injected into ButtonSubscriber');
    }
    
    /**
     * Set ConfirmationDialog (for dependency injection)
     * @param {object} confirmationDialog - ConfirmationDialog instance
     */
    setConfirmationDialog(confirmationDialog) {
        this.confirmationDialog = confirmationDialog;
        this.adapter.log.debug('ConfirmationDialog injected into ButtonSubscriber');
    }
}

module.exports = ButtonSubscriber;
