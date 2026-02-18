'use strict';

/**
 * MCDU Smart Home Control Adapter
 * 
 * Controls smart home devices using WINWING MCDU hardware via MQTT.
 * Architecture: ioBroker Adapter ↔ MQTT Broker ↔ RasPi Client ↔ MCDU Hardware
 * 
 * @author Kira Holt <kiraholtvi@gmail.com>
 * @license MIT
 */

const utils = require('@iobroker/adapter-core');
const MqttClient = require('./lib/mqtt/MqttClient');
const StateTreeManager = require('./lib/state/StateTreeManager');
const PageRenderer = require('./lib/rendering/PageRenderer');
const DisplayPublisher = require('./lib/rendering/DisplayPublisher');
const ButtonSubscriber = require('./lib/mqtt/ButtonSubscriber');

// Phase 2: Input System
const ScratchpadManager = require('./lib/input/ScratchpadManager');
const InputModeManager = require('./lib/input/InputModeManager');
const ValidationEngine = require('./lib/input/ValidationEngine');

// Phase 3: Confirmation System
const ConfirmationDialog = require('./lib/input/ConfirmationDialog');

// Phase 4: Template System
const TemplateLoader = require('./lib/templates/TemplateLoader');

class McduAdapter extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'mcdu',
        });
        
        /** @type {MqttClient|null} */
        this.mqttClient = null;
        
        /** @type {StateTreeManager|null} */
        this.stateManager = null;
        
        /** @type {PageRenderer|null} */
        this.pageRenderer = null;
        
        /** @type {DisplayPublisher|null} */
        this.displayPublisher = null;
        
        /** @type {ButtonSubscriber|null} */
        this.buttonSubscriber = null;
        
        /** @type {ScratchpadManager|null} */
        this.scratchpadManager = null;
        
        /** @type {InputModeManager|null} */
        this.inputModeManager = null;
        
        /** @type {ValidationEngine|null} */
        this.validationEngine = null;
        
        /** @type {ConfirmationDialog|null} */
        this.confirmationDialog = null;
        
        /** @type {TemplateLoader|null} */
        this.templateLoader = null;
        
        /** @type {Map<string, any>} Page cache */
        this.pageCache = new Map();
        
        /** @type {Set<string>} Subscribed state IDs */
        this.subscriptions = new Set();
        
        /** @type {Map<string, object>} Device registry */
        this.deviceRegistry = new Map();
        
        /** @type {NodeJS.Timeout|null} Timeout check interval */
        this.timeoutCheckInterval = null;
        
        // Bind event handlers
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    
    /**
     * Called when adapter is started
     */
    async onReady() {
        this.log.info('MCDU Adapter starting...');
        
        // Prevent duplicate initialization if onReady() is called multiple times
        if (this.mqttClient && this.mqttClient.connected) {
            this.log.warn('Adapter already initialized, skipping duplicate onReady()');
            return;
        }
        
        try {
            // Phase 1: Setup object tree
            this.log.debug('Setting up object tree...');
            this.stateManager = new StateTreeManager(this);
            await this.stateManager.setupObjectTree();
            
            // Phase 2: Connect to MQTT broker
            this.log.debug('Connecting to MQTT broker...');
            if (!this.mqttClient) {
                this.mqttClient = new MqttClient(this, this.config.mqtt);
            }
            await this.mqttClient.connect();
            
            // Phase 3: Initialize rendering components
            this.log.debug('Initializing rendering components...');
            this.displayPublisher = new DisplayPublisher(this, this.mqttClient);
            this.pageRenderer = new PageRenderer(this, this.displayPublisher);
            
            // Phase 3.1: Initialize confirmation system (Phase 3)
            this.log.debug('Initializing confirmation system...');
            this.confirmationDialog = new ConfirmationDialog(this, this.displayPublisher);
            this.log.info('✅ Confirmation system initialized');
            
            // Phase 3.5: Initialize input system (Phase 2)
            this.log.debug('Initializing input system...');
            
            // Create ScratchpadManager
            this.scratchpadManager = new ScratchpadManager(this, this.displayPublisher);
            
            // Create ValidationEngine
            this.validationEngine = new ValidationEngine(this);
            
            // Create InputModeManager
            this.inputModeManager = new InputModeManager(this, this.scratchpadManager, this.validationEngine);
            
            // Inject scratchpadManager into PageRenderer
            this.pageRenderer.setScratchpadManager(this.scratchpadManager);
            
            this.log.info('✅ Input system initialized');
            
            // Phase 4: Initialize template system
            this.log.debug('Initializing template system...');
            this.templateLoader = new TemplateLoader(this);
            this.log.info('✅ Template system initialized');
            
            // Phase 3.6: Setup periodic timeout check (5 seconds)
            this.timeoutCheckInterval = setInterval(() => {
                if (this.inputModeManager) {
                    this.inputModeManager.checkTimeout().catch(error => {
                        this.log.error(`Timeout check failed: ${error.message}`);
                    });
                }
            }, 5000);
            
            this.log.debug('Timeout check interval started');
            
            // Phase 4: Setup button event handling
            this.log.debug('Setting up button event handling...');
            this.buttonSubscriber = new ButtonSubscriber(this, this.mqttClient);
            
            // Inject InputModeManager into ButtonSubscriber
            this.buttonSubscriber.setInputModeManager(this.inputModeManager);
            
            // Inject ConfirmationDialog into ButtonSubscriber
            this.buttonSubscriber.setConfirmationDialog(this.confirmationDialog);
            
            await this.buttonSubscriber.subscribe();
            
            // Phase 5: Subscribe to data sources
            this.log.debug('Subscribing to data sources...');
            await this.subscribeToDataSources();
            
            // Phase 6: Initialize runtime state
            this.log.debug('Initializing runtime state...');
            await this.initializeRuntime();
            
            // Phase 7: Render initial display
            this.log.info('Rendering initial display...');
            await this.renderCurrentPage();
            
            // Phase 4.1: Subscribe to automation states
            this.log.debug('Subscribing to automation states...');
            this.subscribeStates('leds.*');
            this.subscribeStates('scratchpad.*');
            this.subscribeStates('notifications.*');
            this.subscribeStates('actions.*');
            
            // Phase 4.1: Start uptime counter
            this.startTime = Date.now();
            this.uptimeInterval = setInterval(() => {
                const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
                this.setStateAsync('runtime.uptime', uptimeSeconds, true);
            }, 60000); // Update every minute
            
            this.log.info('✅ MCDU Adapter ready!');
            
        } catch (error) {
            this.log.error(`❌ Startup failed: ${error.message}`);
            this.log.error(error.stack);
        }
    }
    
    /**
     * Subscribe to all data sources configured in pages
     */
    async subscribeToDataSources() {
        const pages = this.config.pages || [];
        let count = 0;
        
        for (const page of pages) {
            const lines = page.lines || [];
            for (const line of lines) {
                // Subscribe to display data source
                if (line.display?.type === 'datapoint' && line.display.source) {
                    const stateId = line.display.source;
                    if (!this.subscriptions.has(stateId)) {
                        this.subscribeForeignStates(stateId);
                        this.subscriptions.add(stateId);
                        count++;
                    }
                }
                
                // Subscribe to button targets (for monitoring)
                if (line.leftButton?.target && line.leftButton.type === 'datapoint') {
                    const stateId = line.leftButton.target;
                    if (!this.subscriptions.has(stateId)) {
                        this.subscribeForeignStates(stateId);
                        this.subscriptions.add(stateId);
                        count++;
                    }
                }
                
                if (line.rightButton?.target && line.rightButton.type === 'datapoint') {
                    const stateId = line.rightButton.target;
                    if (!this.subscriptions.has(stateId)) {
                        this.subscribeForeignStates(stateId);
                        this.subscriptions.add(stateId);
                        count++;
                    }
                }
            }
        }
        
        this.log.info(`Subscribed to ${count} data sources`);
    }
    
    /**
     * Initialize runtime state
     */
    async initializeRuntime() {
        // Set first page as current if not already set
        const currentPageState = await this.getStateAsync('runtime.currentPage');
        if (!currentPageState || !currentPageState.val) {
            const firstPage = this.config.pages?.[0];
            if (firstPage) {
                await this.setStateAsync('runtime.currentPage', firstPage.id, true);
                await this.setStateAsync(`pages.${firstPage.id}.active`, true, true);
                this.log.debug(`Set initial page: ${firstPage.id}`);
            }
        }
        
        // Set initial mode
        await this.setStateAsync('runtime.mode', 'normal', true);
        
        // Initialize scratchpad state
        await this.setStateAsync('runtime.scratchpad', '', true);
        await this.setStateAsync('runtime.scratchpadValid', true, true);
        await this.setStateAsync('runtime.selectedLine', null, true);
        
        // Initialize confirmation state
        await this.setStateAsync('runtime.confirmationPending', false, true);
    }
    
    /**
     * Render current page and send to MCDU
     * Error boundary: Catches and logs rendering errors without crashing
     */
    async renderCurrentPage() {
        try {
            const currentPageState = await this.getStateAsync('runtime.currentPage');
            const currentPageId = currentPageState?.val;
            
            if (!currentPageId) {
                this.log.warn('No current page to render');
                return;
            }
            
            if (!this.pageRenderer) {
                this.log.error('PageRenderer not initialized');
                return;
            }
            
            await this.pageRenderer.renderPage(currentPageId);
            
        } catch (error) {
            this.log.error(`Failed to render current page: ${error.message}`);
            this.log.error(error.stack);
            
            // Fallback: Try to render a blank display to avoid frozen screen
            try {
                if (this.displayPublisher) {
                    const blankLines = Array(14).fill({ text: ' '.repeat(24), color: 'white' });
                    await this.displayPublisher.publishFullDisplay(blankLines);
                    this.log.debug('Blank display rendered as fallback');
                }
            } catch (fallbackError) {
                this.log.error(`Fallback rendering also failed: ${fallbackError.message}`);
            }
        }
    }
    
    /**
     * Switch to a different page
     * Error boundary: Handles page switch errors gracefully
     * @param {string} pageId - Target page ID
     */
    async switchToPage(pageId) {
        try {
            this.log.info(`Switching to page: ${pageId}`);
            
            // Validate page exists
            const pageConfig = this.config.pages?.find(p => p.id === pageId);
            if (!pageConfig) {
                this.log.error(`Page not found: ${pageId}`);
                return;
            }
            
            // Store previous page for back navigation
            const currentPageState = await this.getStateAsync('runtime.currentPage');
            const previousPage = currentPageState?.val;
            
            if (previousPage && previousPage !== pageId) {
                await this.setStateAsync('runtime.previousPage', previousPage, true);
                await this.setStateAsync(`pages.${previousPage}.active`, false, true);
            }
            
            // Set new page
            await this.setStateAsync('runtime.currentPage', pageId, true);
            await this.setStateAsync(`pages.${pageId}.active`, true, true);
            
            // Clear page cache to force re-render
            this.pageCache.delete(pageId);
            
            // Render new page
            await this.renderCurrentPage();
            
        } catch (error) {
            this.log.error(`Failed to switch to page ${pageId}: ${error.message}`);
            this.log.error(error.stack);
        }
    }
    
    /**
     * Execute button action
     * Error boundary: Handles action execution errors gracefully
     * @param {object} buttonConfig - Button configuration
     */
    async executeButtonAction(buttonConfig) {
        try {
            if (!buttonConfig) {
                this.log.warn('No button config provided');
                return;
            }
            
            const { type, action, target } = buttonConfig;
            
            if (type === 'navigation' && action === 'goto') {
                // Switch to target page
                await this.switchToPage(target);
            }
            else if (type === 'datapoint') {
                if (!target) {
                    this.log.error('Button action missing target');
                    return;
                }
                
                if (action === 'toggle') {
                    // Toggle boolean state
                    const state = await this.getForeignStateAsync(target);
                    const newVal = !state?.val;
                    await this.setForeignStateAsync(target, newVal);
                    this.log.debug(`Toggled ${target}: ${newVal}`);
                }
                else if (action === 'increment') {
                    // Increment numeric state
                    const state = await this.getForeignStateAsync(target);
                    const newVal = (parseFloat(state?.val) || 0) + 1;
                    await this.setForeignStateAsync(target, newVal);
                    this.log.debug(`Incremented ${target}: ${newVal}`);
                }
                else if (action === 'decrement') {
                    // Decrement numeric state
                    const state = await this.getForeignStateAsync(target);
                    const newVal = (parseFloat(state?.val) || 0) - 1;
                    await this.setForeignStateAsync(target, newVal);
                    this.log.debug(`Decremented ${target}: ${newVal}`);
                }
                else {
                    this.log.warn(`Unknown action: ${action}`);
                }
            }
            else {
                this.log.warn(`Unknown button type: ${type}`);
            }
            
        } catch (error) {
            this.log.error(`Failed to execute button action: ${error.message}`);
            this.log.error(error.stack);
        }
    }
    
    /**
     * State change handler
     * @param {string} id - State ID
     * @param {ioBroker.State | null | undefined} state - State object
     */
    async onStateChange(id, state) {
        if (!state || state.ack) return;
        
        try {
            // Handle control states
            if (id === `${this.namespace}.control.switchPage`) {
                await this.switchToPage(state.val);
                await this.setStateAsync('control.switchPage', state.val, true);
            }
            else if (id === `${this.namespace}.control.goBack`) {
                const previousPageState = await this.getStateAsync('runtime.previousPage');
                if (previousPageState?.val) {
                    await this.switchToPage(previousPageState.val);
                }
                await this.setStateAsync('control.goBack', false, true);
            }
            else if (id === `${this.namespace}.control.refresh`) {
                await this.renderCurrentPage();
                await this.setStateAsync('control.refresh', false, true);
            }
            
            // Phase 4.1: Extended navigation controls
            else if (id === `${this.namespace}.control.nextPage`) {
                if (state.val === true) {
                    await this.navigateNext();
                    await this.setStateAsync('control.nextPage', false, true);
                }
            }
            else if (id === `${this.namespace}.control.previousPage`) {
                if (state.val === true) {
                    await this.navigatePrevious();
                    await this.setStateAsync('control.previousPage', false, true);
                }
            }
            else if (id === `${this.namespace}.control.homePage`) {
                if (state.val === true) {
                    await this.navigateHome();
                    await this.setStateAsync('control.homePage', false, true);
                }
            }
            
            // Phase 4.1: LED changes
            else if (id.startsWith(`${this.namespace}.leds.`)) {
                const ledName = id.split('.').pop();
                await this.handleLEDChange(ledName, state.val);
                await this.setStateAsync(id, state.val, true);
            }
            
            // Phase 4.1: Scratchpad changes
            else if (id === `${this.namespace}.scratchpad.content`) {
                this.scratchpadManager.set(state.val);
                await this.setStateAsync(id, state.val, true);
                // Update validation states
                await this.updateScratchpadValidation();
            }
            else if (id === `${this.namespace}.scratchpad.clear`) {
                if (state.val === true) {
                    this.scratchpadManager.clear();
                    await this.setStateAsync('scratchpad.content', '', true);
                    await this.setStateAsync('scratchpad.valid', true, true);
                    await this.setStateAsync('scratchpad.validationError', '', true);
                    await this.setStateAsync(id, false, true);
                }
            }
            
            // Phase 4.1: Notification changes
            else if (id === `${this.namespace}.notifications.message`) {
                if (state.val) {
                    await this.showNotification();
                    await this.setStateAsync(id, state.val, true);
                }
            }
            else if (id === `${this.namespace}.notifications.clear`) {
                if (state.val === true) {
                    await this.clearNotification();
                    await this.setStateAsync(id, false, true);
                }
            }
            
            // Phase 4.1: Button triggers
            else if (id === `${this.namespace}.actions.pressButton`) {
                if (state.val) {
                    await this.triggerButton(state.val);
                    await this.setStateAsync(id, '', true);
                }
            }
            else if (id === `${this.namespace}.actions.confirmAction`) {
                if (state.val === true) {
                    await this.triggerOVFY();
                    await this.setStateAsync(id, false, true);
                }
            }
            else if (id === `${this.namespace}.actions.cancelAction`) {
                if (state.val === true) {
                    await this.triggerCLR();
                    await this.setStateAsync(id, false, true);
                }
            }
            
            // Handle data source changes
            if (this.subscriptions.has(id)) {
                // Re-render current page
                this.log.debug(`Data source changed: ${id}, re-rendering page`);
                await this.renderCurrentPage();
            }
        } catch (error) {
            this.log.error(`Error handling state change ${id}: ${error.message}`);
        }
    }
    
    /**
     * Navigate to next page in sequence
     */
    async navigateNext() {
        const pages = this.config.pages || [];
        const currentPageState = await this.getStateAsync('runtime.currentPage');
        const currentIndex = pages.findIndex(p => p.id === currentPageState?.val);
        
        if (currentIndex >= 0 && currentIndex < pages.length - 1) {
            const nextPage = pages[currentIndex + 1];
            await this.switchToPage(nextPage.id);
        }
    }
    
    /**
     * Navigate to previous page in sequence
     */
    async navigatePrevious() {
        const pages = this.config.pages || [];
        const currentPageState = await this.getStateAsync('runtime.currentPage');
        const currentIndex = pages.findIndex(p => p.id === currentPageState?.val);
        
        if (currentIndex > 0) {
            const prevPage = pages[currentIndex - 1];
            await this.switchToPage(prevPage.id);
        }
    }
    
    /**
     * Navigate to home page (first page)
     */
    async navigateHome() {
        const pages = this.config.pages || [];
        if (pages.length > 0) {
            await this.switchToPage(pages[0].id);
        }
    }
    
    /**
     * Handle LED state change
     * @param {string} ledName - LED name
     * @param {boolean|number} value - New value
     */
    async handleLEDChange(ledName, value) {
        // Convert boolean to number
        let brightness = value;
        if (typeof value === 'boolean') {
            brightness = value ? 255 : 0;
        }
        
        // Publish to MQTT
        const topic = `${this.config.mqtt.topicPrefix}/leds/single`;
        const payload = {
            name: ledName,
            brightness: brightness,
            timestamp: Date.now()
        };
        
        this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
        this.log.debug(`LED ${ledName} set to ${brightness}`);
    }
    
    /**
     * Update scratchpad validation states
     */
    async updateScratchpadValidation() {
        // Basic validation - content exists and is within limits
        const content = this.scratchpadManager.getContent();
        const isValid = content.length > 0 && content.length <= this.scratchpadManager.maxLength;
        const error = !isValid && content.length > 0 ? 
            `Content too long (max ${this.scratchpadManager.maxLength})` : '';
        
        await this.setStateAsync('scratchpad.valid', isValid, true);
        await this.setStateAsync('scratchpad.validationError', error, true);
    }
    
    /**
     * Show notification on display
     */
    async showNotification() {
        const message = await this.getStateAsync('notifications.message');
        const type = await this.getStateAsync('notifications.type');
        const duration = await this.getStateAsync('notifications.duration');
        const line = await this.getStateAsync('notifications.line');
        
        // Color mapping
        const colorMap = {
            'info': 'white',
            'warning': 'amber',
            'error': 'red',
            'success': 'green'
        };
        
        const color = colorMap[type?.val] || 'white';
        const lineNum = line?.val || 13;
        const durationMs = duration?.val || 3000;
        
        // Publish notification line
        const topicPrefix = this.config.mqtt?.topicPrefix || 'mcdu';
        const payload = {
            line: lineNum,
            content: message.val,
            color: color,
            duration: durationMs
        };
        
        this.mqttClient.publish(
            `${topicPrefix}/display/line`,
            JSON.stringify(payload),
            { qos: 1 }
        );
        
        this.log.info(`Notification shown: ${message.val} (${type?.val})`);
        
        // Auto-clear after duration
        setTimeout(() => {
            this.clearNotification();
        }, durationMs);
    }
    
    /**
     * Clear notification from display
     */
    async clearNotification() {
        await this.setStateAsync('notifications.message', '', true);
        await this.renderCurrentPage(); // Restore normal page
    }
    
    /**
     * Trigger button press programmatically
     * @param {string} buttonName - Button name (e.g., "LSK1L")
     */
    async triggerButton(buttonName) {
        // Simulate button event
        const event = {
            button: buttonName,
            action: 'press',
            deviceId: 'script-trigger',
            timestamp: Date.now()
        };
        
        // Convert to MQTT message format
        const message = Buffer.from(JSON.stringify(event));
        const topic = `${this.config.mqtt.topicPrefix}/buttons/event`;
        
        await this.buttonSubscriber.handleButtonEvent(topic, message);
        this.log.debug(`Button triggered: ${buttonName}`);
    }
    
    /**
     * Trigger OVFY (confirm) key
     */
    async triggerOVFY() {
        // Check if confirmation is pending
        if (this.confirmationDialog && this.confirmationDialog.isPending()) {
            await this.confirmationDialog.handleResponse('OVFY');
        } else {
            this.log.warn('No confirmation pending - OVFY ignored');
        }
    }
    
    /**
     * Trigger CLR (cancel) key
     */
    async triggerCLR() {
        await this.inputModeManager.handleCLR();
    }
    
    /**
     * Handle messages from admin UI (sendTo commands)
     * @param {object} obj - Message object
     */
    onMessage(obj) {
        if (!obj || !obj.command) {
            return;
        }
        
        this.log.debug(`Received admin message: ${obj.command}`);
        
        try {
            switch (obj.command) {
                case 'loadTemplate':
                    this.handleLoadTemplate(obj);
                    break;
                    
                case 'getPageList':
                    this.handleGetPageList(obj);
                    break;
                    
                default:
                    this.log.warn(`Unknown command: ${obj.command}`);
                    this.sendTo(obj.from, obj.command, { error: 'Unknown command' }, obj.callback);
            }
        } catch (error) {
            this.log.error(`Error handling message ${obj.command}: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }
    
    /**
     * Handle loadTemplate command from admin UI
     * @param {object} obj - Message object with templateId
     */
    handleLoadTemplate(obj) {
        const templateId = obj.message?.templateId;
        
        if (!templateId) {
            this.sendTo(obj.from, obj.command, { error: 'No templateId provided' }, obj.callback);
            return;
        }
        
        if (!this.templateLoader) {
            this.sendTo(obj.from, obj.command, { error: 'Template loader not initialized' }, obj.callback);
            return;
        }
        
        const template = this.templateLoader.getTemplate(templateId);
        
        if (!template) {
            this.sendTo(obj.from, obj.command, { error: 'Template not found' }, obj.callback);
            return;
        }
        
        // Return template pages to admin UI
        this.sendTo(obj.from, obj.command, {
            success: true,
            template: {
                name: template.name,
                description: template.description,
                pages: template.pages
            }
        }, obj.callback);
        
        this.log.info(`Template '${template.name}' loaded successfully`);
    }
    
    /**
     * Handle getPageList command from admin UI (for parent page dropdown)
     * @param {object} obj - Message object
     */
    handleGetPageList(obj) {
        const pages = this.config.pages || [];
        
        // Build list of page options for dropdown
        const pageList = pages.map(p => ({
            label: p.name || p.id,
            value: p.id
        }));
        
        this.sendTo(obj.from, obj.command, pageList, obj.callback);
        this.log.debug(`Returned page list: ${pageList.length} pages`);
    }
    
    /**
     * Called when adapter shuts down
     * Comprehensive cleanup to prevent memory leaks
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info('Shutting down MCDU Adapter...');
            
            // Phase 1: Clear all intervals and timeouts
            if (this.timeoutCheckInterval) {
                clearInterval(this.timeoutCheckInterval);
                this.timeoutCheckInterval = null;
                this.log.debug('Timeout check interval cleared');
            }
            
            if (this.uptimeInterval) {
                clearInterval(this.uptimeInterval);
                this.uptimeInterval = null;
                this.log.debug('Uptime interval cleared');
            }
            
            // Phase 2: Clear confirmation dialog countdown timers
            if (this.confirmationDialog) {
                this.confirmationDialog.clear().catch(error => {
                    this.log.error(`Failed to clear confirmation dialog: ${error.message}`);
                });
            }
            
            // Phase 3: Disconnect MQTT client gracefully
            if (this.mqttClient) {
                this.mqttClient.disconnect();
                this.log.debug('MQTT client disconnected');
            }
            
            // Phase 4: Clear page cache to free memory
            if (this.pageCache) {
                this.pageCache.clear();
                this.log.debug('Page cache cleared');
            }
            
            // Phase 5: Clear subscriptions set
            if (this.subscriptions) {
                this.subscriptions.clear();
                this.log.debug('Subscriptions cleared');
            }
            
            // Phase 6: Clear device registry
            if (this.deviceRegistry) {
                this.deviceRegistry.clear();
                this.log.debug('Device registry cleared');
            }
            
            this.log.info('✅ MCDU Adapter shut down complete');
            callback();
            
        } catch (e) {
            this.log.error(`Error during shutdown: ${e.message}`);
            callback();
        }
    }
}

// Export adapter instance
if (require.main !== module) {
    // Export the constructor
    module.exports = (options) => new McduAdapter(options);
} else {
    // Start the instance directly
    new McduAdapter();
}
