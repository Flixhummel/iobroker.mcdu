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

// Line format conversion (flat ↔ nested for Admin UI)
const { flattenPages, unflattenPages } = require('./lib/utils/lineNormalizer');

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

        /** @type {Array<{id: string, name: string}>} Current breadcrumb path */
        this.breadcrumb = [];

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
            // Restore function keys from io-package.json defaults if adapter config has none
            // (can happen when Admin UI previously saved empty function keys via useNative)
            if (!this.config.functionKeys || this.config.functionKeys.length === 0) {
                const ioPackage = require('./io-package.json');
                const defaultFks = ioPackage.native?.functionKeys;
                if (Array.isArray(defaultFks) && defaultFks.length > 0) {
                    this.config.functionKeys = defaultFks;
                    this.log.info(`Restored ${defaultFks.length} default function keys from io-package.json`);
                }
            }

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
            
            // Recover known devices from ioBroker object tree (survives adapter restarts)
            await this.recoverKnownDevices();

            // Phase 3.7: Subscribe to device announcements (all devices)
            this.log.debug('Subscribing to device announcements...');
            // Wildcard pattern: mcdu/+/status/announce
            await this.mqttClient.subscribe('+/status/announce', (topic, message) => {
                this.handleDeviceAnnouncement(message).catch(error => {
                    this.log.error(`Failed to handle device announcement: ${error.message}`);
                });
            });
            this.log.info('✅ Device announcement subscription active (all devices)');
            
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
            
            // Phase 4.1: Subscribe to automation states (per-device)
            this.log.debug('Subscribing to automation states (all devices)...');
            this.subscribeStates('devices.*.leds.*');
            this.subscribeStates('devices.*.scratchpad.*');
            this.subscribeStates('devices.*.notifications.*');
            this.subscribeStates('devices.*.actions.*');
            this.subscribeStates('devices.*.control.*');
            this.subscribeStates('devices.*.config.*');
            
            // Phase 4.1: Start uptime counter
            this.startTime = Date.now();
            this.uptimeInterval = setInterval(() => {
                const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
                this.setStateAsync('runtime.uptime', uptimeSeconds, true);
            }, 60000); // Update every minute

            // Live data re-render timer (status bar time + datapoint refresh)
            const reRenderInterval = this.config.performance?.reRenderInterval || 30000;
            this.reRenderInterval = setInterval(() => {
                this.renderCurrentPage().catch(error => {
                    this.log.error(`Periodic re-render failed: ${error.message}`);
                });
            }, reRenderInterval);
            this.log.debug(`Live re-render interval started (${reRenderInterval}ms)`);
            
            this.log.info('✅ MCDU Adapter ready!');
            
        } catch (error) {
            this.log.error(`❌ Startup failed: ${error.message}`);
            this.log.error(error.stack);
        }
    }
    
    /**
     * Subscribe to all data sources configured in pages
     * Supports both old (leftButton/display/rightButton) and new (left/right) line format
     */
    async subscribeToDataSources() {
        const pages = this.config.pages || [];
        let count = 0;

        const subscribeTo = (stateId) => {
            if (stateId && !this.subscriptions.has(stateId)) {
                this.subscribeForeignStates(stateId);
                this.subscriptions.add(stateId);
                count++;
            }
        };

        for (const page of pages) {
            const lines = page.lines || [];
            for (const line of lines) {
                // New format: left/right sides
                if (line.left || line.right) {
                    for (const side of [line.left, line.right]) {
                        if (!side) continue;
                        if (side.display?.type === 'datapoint' && side.display.source) {
                            subscribeTo(side.display.source);
                        }
                        if (side.button?.type === 'datapoint' && side.button.target) {
                            subscribeTo(side.button.target);
                        }
                    }
                } else {
                    // Old format
                    if (line.display?.type === 'datapoint' && line.display.source) {
                        subscribeTo(line.display.source);
                    }
                    if (line.leftButton?.target && line.leftButton.type === 'datapoint') {
                        subscribeTo(line.leftButton.target);
                    }
                    if (line.rightButton?.target && line.rightButton.type === 'datapoint') {
                        subscribeTo(line.rightButton.target);
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
        // Set first page as current if not set or if current page no longer exists
        const currentPageState = await this.getStateAsync('runtime.currentPage');
        const currentPageId = currentPageState?.val;
        const pages = this.config.pages || [];
        const currentPageExists = currentPageId && pages.some(p => p.id === currentPageId);

        if (!currentPageExists) {
            const firstPage = pages[0];
            if (firstPage) {
                await this.setStateAsync('runtime.currentPage', firstPage.id, true);
                await this.setStateAsync(`pages.${firstPage.id}.active`, true, true);
                this.log.info(`Reset current page to ${firstPage.id} (previous "${currentPageId || ''}" not found in ${pages.length} pages)`);
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

            // Build and store breadcrumb
            this.breadcrumb = this.buildBreadcrumb(pageId);

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

            if (type === 'navigation') {
                // Switch to target page (action 'goto' is optional/default)
                if (target) {
                    await this.switchToPage(target);
                } else {
                    this.log.warn('Navigation button has no target page');
                }
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
            
            // Phase 4.1: LED changes (per-device)
            else if (id.includes('.devices.') && id.includes('.leds.')) {
                // Extract: mcdu.0.devices.mcdu-client-mcdu-pi.leds.FAIL
                const parts = id.split('.');
                const deviceIdIndex = parts.indexOf('devices') + 1;
                const deviceId = parts[deviceIdIndex];
                const ledName = parts[parts.length - 1];
                
                await this.handleLEDChange(deviceId, ledName, state.val);
                await this.setStateAsync(id.replace(`${this.namespace}.`, ''), state.val, true);
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
        const currentPageId = currentPageState?.val;
        const currentPage = pages.find(p => p.id === currentPageId);

        if (!currentPage) return;

        // Find siblings (pages with same parent)
        const parentId = currentPage.parent || null;
        const siblings = pages.filter(p => (p.parent || null) === parentId);

        if (siblings.length <= 1) return; // No siblings to navigate to

        const currentIndex = siblings.findIndex(p => p.id === currentPageId);
        // Circular: wrap from last to first
        const nextIndex = (currentIndex + 1) % siblings.length;
        await this.switchToPage(siblings[nextIndex].id);
    }

    /**
     * Navigate to previous page in sequence (circular within siblings)
     */
    async navigatePrevious() {
        const pages = this.config.pages || [];
        const currentPageState = await this.getStateAsync('runtime.currentPage');
        const currentPageId = currentPageState?.val;
        const currentPage = pages.find(p => p.id === currentPageId);

        if (!currentPage) return;

        // Find siblings (pages with same parent)
        const parentId = currentPage.parent || null;
        const siblings = pages.filter(p => (p.parent || null) === parentId);

        if (siblings.length <= 1) return; // No siblings

        const currentIndex = siblings.findIndex(p => p.id === currentPageId);
        // Circular: wrap from first to last
        const prevIndex = (currentIndex - 1 + siblings.length) % siblings.length;
        await this.switchToPage(siblings[prevIndex].id);
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
     * Build breadcrumb path for a page by walking parent chain
     * @param {string} pageId - Current page ID
     * @returns {Array<{id: string, name: string}>} Breadcrumb path from root to current
     */
    buildBreadcrumb(pageId) {
        const pages = this.config.pages || [];
        const breadcrumb = [];
        let currentId = pageId;
        const visited = new Set(); // Prevent infinite loops

        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const page = pages.find(p => p.id === currentId);
            if (!page) break;
            breadcrumb.unshift({ id: page.id, name: page.name || page.id });
            currentId = page.parent || null;
        }

        return breadcrumb;
    }

    /**
     * Show startup splash screen on device connect
     * Displays for 3 seconds, then navigates to home page
     * @param {string} deviceId - Device ID
     * @returns {Promise<void>}
     */
    async showSplashScreen(deviceId) {
        if (!this.displayPublisher) return;

        const version = require('./package.json').version || '0.0.0';
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const blank = { text: ' '.repeat(24), color: 'white' };
        const lines = [
            { text: '    MCDU SMART HOME     ', color: 'cyan' },    // 1
            blank,                                                     // 2
            blank,                                                     // 3
            blank,                                                     // 4
            blank,                                                     // 5
            blank,                                                     // 6
            { text: '     INITIALIZING       ', color: 'amber' },   // 7
            blank,                                                     // 8
            blank,                                                     // 9
            blank,                                                     // 10
            blank,                                                     // 11
            blank,                                                     // 12
            { text: `   v${version}   ${time}  `.substring(0, 24).padEnd(24), color: 'white' }, // 13
            { text: '________________________', color: 'white' },   // 14
        ];

        await this.displayPublisher.publishFullDisplay(lines);
        this.log.info(`Splash screen shown on ${deviceId}`);

        // After 3 seconds, render home page
        setTimeout(async () => {
            try {
                this.displayPublisher.lastContent = null; // Force re-render
                await this.renderCurrentPage();
            } catch (error) {
                this.log.error(`Post-splash render failed: ${error.message}`);
            }
        }, 3000);
    }

    /**
     * Handle LED state change
     * @param {string} ledName - LED name
     * @param {boolean|number} value - New value
     */
    async handleLEDChange(deviceId, ledName, value) {
        // Convert value to number
        let brightness = value;
        
        // Handle booleans
        if (typeof value === 'boolean') {
            brightness = value ? 255 : 0;
        }
        // Handle strings (from UI)
        else if (typeof value === 'string') {
            if (value === 'true' || value === '1') {
                brightness = 255;
            } else if (value === 'false' || value === '0') {
                brightness = 0;
            } else {
                brightness = parseInt(value, 10) || 0;
            }
        }
        // Ensure it's a number
        else {
            brightness = parseInt(value, 10) || 0;
        }
        
        // Clamp to 0-255
        brightness = Math.max(0, Math.min(255, brightness));
        
        // Publish to MQTT (device-specific topic)
        const topic = `${this.config.mqtt.topicPrefix}/${deviceId}/leds/single`;
        const payload = {
            name: ledName,
            brightness: brightness,
            timestamp: Date.now()
        };
        
        this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
        this.log.info(`LED ${ledName} on device ${deviceId} set to ${brightness}`);
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
        
        // Publish notification line via DisplayPublisher (device-scoped topic)
        await this.displayPublisher.publishLine(lineNum, message.val, color);
        
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
        const activeDeviceId = this.displayPublisher.deviceId || 'script-trigger';
        const topic = `${this.config.mqtt?.topicPrefix || 'mcdu'}/${activeDeviceId}/buttons/event`;
        
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
                case 'browsePages':
                    this.handleGetPageList(obj);
                    break;
                
                case 'browseDevices':
                    this.handleBrowseDevices(obj);
                    break;

                case 'loadDevicePages':
                    this.handleLoadDevicePages(obj);
                    break;

                case 'saveDevicePages':
                    this.handleSaveDevicePages(obj);
                    break;

                case 'loadFunctionKeys':
                    this.handleLoadFunctionKeys(obj);
                    break;
                case 'saveFunctionKeys':
                    this.handleSaveFunctionKeys(obj);
                    break;

                case 'browseStates':
                    this.handleBrowseStates(obj);
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
    async handleLoadTemplate(obj) {
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

        // Flatten template pages for Admin UI
        const flatPages = flattenPages(template.pages || []);

        // Return as native-shaped object so admin can merge it
        this.sendTo(obj.from, obj.command, {
            native: { pages: flatPages }
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
     * Handle browseDevices command from admin UI
     * Returns list of all registered MCDU devices
     * @param {object} obj - Message object
     */
    async handleBrowseDevices(obj) {
        try {
            // Query device-type objects (not channels — sub-channels are type channel, devices are type device)
            const devices = await this.getObjectViewAsync('system', 'device', {
                startkey: `${this.namespace}.devices`,
                endkey: `${this.namespace}.devices\u9999`
            });

            const deviceList = [];

            if (devices && devices.rows) {
                for (const row of devices.rows) {
                    const parts = row.id.split('.');
                    if (parts.length < 4) {
                        continue;
                    }
                    const deviceId = parts[3];

                    // Get hostname from native data (more reliable than state)
                    const hostname = row.value?.native?.hostname || 'unknown';

                    deviceList.push({
                        label: `${deviceId} (${hostname})`,
                        value: deviceId
                    });
                }
            }

            this.log.info(`browseDevices: Found ${deviceList.length} devices: ${JSON.stringify(deviceList)}`);
            this.sendTo(obj.from, obj.command, deviceList, obj.callback);
            
        } catch (error) {
            this.log.error(`Error in browseDevices: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }
    
    /**
     * Handle loadDevicePages command from admin UI
     * Reads per-device page config from ioBroker object and returns it
     * @param {object} obj - Message object with deviceId
     */
    async handleLoadDevicePages(obj) {
        try {
            const deviceId = obj.message?.deviceId;
            if (!deviceId) {
                this.sendTo(obj.from, obj.command, { error: 'No deviceId provided' }, obj.callback);
                return;
            }

            const stateId = `devices.${deviceId}.config.pages`;
            const state = await this.getStateAsync(stateId);
            let pages = [];

            if (state && state.val) {
                try {
                    pages = JSON.parse(state.val);
                } catch (e) {
                    this.log.warn(`Invalid JSON in ${stateId}: ${e.message}`);
                    pages = [];
                }
            }

            // Flatten lines for Admin UI table
            const flatPages = flattenPages(pages);

            // Also load function keys for this device (fall back to adapter config)
            const fkStateId = `devices.${deviceId}.config.functionKeys`;
            const fkState = await this.getStateAsync(fkStateId);
            let functionKeys = [];
            if (fkState && fkState.val) {
                try {
                    functionKeys = JSON.parse(fkState.val);
                } catch (e) {
                    this.log.warn(`Invalid JSON in ${fkStateId}: ${e.message}`);
                }
            }
            // Fall back to adapter config if device has no FK
            if (!Array.isArray(functionKeys) || functionKeys.length === 0) {
                functionKeys = this.config.functionKeys || [];
                this.log.info(`loadDevicePages: Using adapter config FK (${functionKeys.length} keys) for device ${deviceId}`);
            }

            this.log.info(`loadDevicePages: Loaded ${pages.length} pages for device ${deviceId}`);
            // Return data in response — jsonConfig sendTo shows this as result
            // Also return as native-shaped object so admin can merge it
            this.sendTo(obj.from, obj.command, {
                native: { pages: flatPages, functionKeys }
            }, obj.callback);
        } catch (error) {
            this.log.error(`Error in loadDevicePages: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }

    /**
     * Handle saveDevicePages command from admin UI
     * Writes page config to per-device ioBroker object
     * @param {object} obj - Message object with deviceId and pages
     */
    async handleSaveDevicePages(obj) {
        try {
            // jsonData sends the full form data as obj.message (all native config fields)
            // Also support direct {deviceId, pages} for programmatic calls
            let deviceId, pages, functionKeys;

            const msg = obj.message || {};
            if (msg.selectedDevice) {
                // From Admin UI jsonData — full form data with selectedDevice, pages, functionKeys, etc.
                deviceId = msg.selectedDevice;
                pages = msg.pages;
                functionKeys = msg.functionKeys;
            } else if (msg.deviceId) {
                // Direct programmatic call
                deviceId = msg.deviceId;
                pages = msg.pages;
                functionKeys = msg.functionKeys;
            }

            this.log.info(`saveDevicePages: deviceId=${deviceId}, pages=${Array.isArray(pages) ? pages.length : 'N/A'}, fk=${Array.isArray(functionKeys) ? functionKeys.length : 'N/A'}`);

            if (!deviceId) {
                this.sendTo(obj.from, obj.command, { error: 'No device selected' }, obj.callback);
                return;
            }
            if (!Array.isArray(pages)) {
                this.sendTo(obj.from, obj.command, { error: 'pages must be an array' }, obj.callback);
                return;
            }

            // Convert flat lines (from Admin UI) back to nested format for storage
            const nestedPages = unflattenPages(pages);

            const stateId = `devices.${deviceId}.config.pages`;
            await this.setStateAsync(stateId, JSON.stringify(nestedPages), true);

            // Update active config if this is the active device
            if (this.displayPublisher && this.displayPublisher.deviceId === deviceId) {
                this.config.pages = nestedPages;
                await this.renderCurrentPage();
            }

            // Also save function keys if present
            if (Array.isArray(functionKeys)) {
                const fkStateId = `devices.${deviceId}.config.functionKeys`;
                await this.setStateAsync(fkStateId, JSON.stringify(functionKeys), true);
                if (this.displayPublisher && this.displayPublisher.deviceId === deviceId) {
                    this.config.functionKeys = functionKeys;
                }
                this.log.info(`saveDevicePages: Also saved ${functionKeys.length} function keys for device ${deviceId}`);
            }

            this.log.info(`saveDevicePages: Saved ${nestedPages.length} pages for device ${deviceId}`);
            this.sendTo(obj.from, obj.command, { success: true }, obj.callback);
        } catch (error) {
            this.log.error(`Error in saveDevicePages: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }

    /**
     * Handle loadFunctionKeys command from admin UI
     * @param {object} obj - Message object with deviceId
     */
    async handleLoadFunctionKeys(obj) {
        try {
            const deviceId = obj.message?.deviceId;
            if (!deviceId) {
                this.sendTo(obj.from, obj.command, { error: 'No deviceId provided' }, obj.callback);
                return;
            }
            const stateId = `devices.${deviceId}.config.functionKeys`;
            const state = await this.getStateAsync(stateId);
            let functionKeys = [];
            if (state && state.val) {
                try {
                    functionKeys = JSON.parse(state.val);
                } catch (e) {
                    this.log.warn(`Invalid JSON in ${stateId}: ${e.message}`);
                }
            }
            this.log.info(`loadFunctionKeys: Loaded ${functionKeys.length} keys for device ${deviceId}`);
            this.sendTo(obj.from, obj.command, { functionKeys }, obj.callback);
        } catch (error) {
            this.log.error(`Error in loadFunctionKeys: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }

    /**
     * Handle saveFunctionKeys command from admin UI
     * @param {object} obj - Message object with deviceId and functionKeys
     */
    async handleSaveFunctionKeys(obj) {
        try {
            let deviceId, functionKeys;
            if (obj.message?.deviceId) {
                deviceId = obj.message.deviceId;
                functionKeys = obj.message.functionKeys;
            } else {
                deviceId = obj.message?.selectedDevice;
                functionKeys = obj.message?.functionKeys;
            }
            if (!deviceId) {
                this.sendTo(obj.from, obj.command, { error: 'No device selected' }, obj.callback);
                return;
            }
            if (!Array.isArray(functionKeys)) {
                this.sendTo(obj.from, obj.command, { error: 'functionKeys must be an array' }, obj.callback);
                return;
            }
            const stateId = `devices.${deviceId}.config.functionKeys`;
            await this.setStateAsync(stateId, JSON.stringify(functionKeys), true);
            if (this.displayPublisher && this.displayPublisher.deviceId === deviceId) {
                this.config.functionKeys = functionKeys;
            }
            this.log.info(`saveFunctionKeys: Saved ${functionKeys.length} keys for device ${deviceId}`);
            this.sendTo(obj.from, obj.command, { success: true }, obj.callback);
        } catch (error) {
            this.log.error(`Error in saveFunctionKeys: ${error.message}`);
            this.sendTo(obj.from, obj.command, { error: error.message }, obj.callback);
        }
    }

    /**
     * Handle browseStates command from admin UI
     * Returns list of all ioBroker states for selection in UI
     * @param {object} obj - Message object with optional filter
     */
    async handleBrowseStates(obj) {
        try {
            const { filter, type } = obj.message || {};
            
            this.log.debug(`Browsing states with filter: ${filter || 'none'}, type: ${type || 'all'}`);
            
            // Get all objects from ioBroker
            const allObjects = await this.getForeignObjectsAsync('*', 'state');
            
            let states = [];
            
            for (const [id, stateObj] of Object.entries(allObjects)) {
                // Skip adapter's own states
                if (id.startsWith(`${this.namespace}.`)) {
                    continue;
                }
                
                // Build state info
                const stateInfo = {
                    id: id,
                    name: stateObj.common?.name || id,
                    type: stateObj.common?.type || 'mixed',
                    role: stateObj.common?.role || 'state',
                    unit: stateObj.common?.unit || '',
                    read: stateObj.common?.read !== false,
                    write: stateObj.common?.write !== false,
                    min: stateObj.common?.min,
                    max: stateObj.common?.max,
                    states: stateObj.common?.states
                };
                
                // Apply type filter if specified
                if (type && stateObj.common?.type !== type) {
                    continue;
                }
                
                // Apply text filter if specified
                if (filter) {
                    const searchText = filter.toLowerCase();
                    if (!id.toLowerCase().includes(searchText) && 
                        !(stateInfo.name && stateInfo.name.toLowerCase().includes(searchText))) {
                        continue;
                    }
                }
                
                states.push(stateInfo);
            }
            
            // Sort by ID
            states.sort((a, b) => a.id.localeCompare(b.id));
            
            // Limit results to prevent UI overload
            const maxResults = 500;
            if (states.length > maxResults) {
                this.log.debug(`Limiting results from ${states.length} to ${maxResults}`);
                states = states.slice(0, maxResults);
            }
            
            this.log.debug(`Returning ${states.length} states`);
            
            this.sendTo(obj.from, obj.command, {
                success: true,
                states: states,
                total: states.length,
                limited: states.length >= maxResults
            }, obj.callback);
            
        } catch (error) {
            this.log.error(`Error browsing states: ${error.message}`);
            this.sendTo(obj.from, obj.command, { 
                success: false,
                error: error.message 
            }, obj.callback);
        }
    }
    
    /**
     * Recover known devices from ioBroker object tree on adapter startup.
     * This ensures the adapter works without requiring the mcdu-client to re-announce.
     */
    async recoverKnownDevices() {
        try {
            const startkey = `${this.namespace}.devices`;
            const endkey = `${this.namespace}.devices\u9999`;
            const devices = await this.getObjectViewAsync('system', 'device', {
                startkey,
                endkey
            });
            this.log.info(`recoverKnownDevices: got ${devices?.rows?.length || 0} device objects`);

            if (!devices || !devices.rows) {
                return;
            }

            for (const row of devices.rows) {
                const id = row.id || row.value?._id;
                if (!id) {
                    continue;
                }
                // Extract deviceId from mcdu.0.devices.{deviceId}
                const parts = id.split('.');
                if (parts.length < 4) {
                    continue;
                }
                const deviceId = parts[3];
                const native = row.value?.native || {};

                this.deviceRegistry.set(deviceId, {
                    deviceId,
                    hostname: native.hostname || 'unknown',
                    ipAddress: native.ipAddress || 'unknown',
                    version: native.version || 'unknown',
                    firstSeen: native.firstSeen || Date.now(),
                    lastSeen: Date.now()
                });

                // Load device pages into active config
                await this.loadDevicePagesIntoConfig(deviceId);

                // Set device for display publishing
                this.displayPublisher.setDevice(deviceId);

                this.log.info(`♻️ Recovered device: ${deviceId} (${native.hostname || 'unknown'})`);
            }

            if (this.deviceRegistry.size > 0) {
                this.log.info(`✅ Recovered ${this.deviceRegistry.size} device(s) from object tree`);
            }
        } catch (error) {
            this.log.warn(`Could not recover devices: ${error.message}`);
        }
    }

    /**
     * Handle device announcement from MCDU client
     * @param {Buffer} message - MQTT message buffer
     */
    async handleDeviceAnnouncement(message) {
        try {
            const announcement = JSON.parse(message.toString());
            const { deviceId, hostname, ipAddress, version } = announcement;
            
            if (!deviceId) {
                this.log.warn('Device announcement missing deviceId');
                return;
            }
            
            this.log.info(`📡 Device announcement: ${deviceId} (${hostname || 'unknown'} @ ${ipAddress || 'unknown'})`);
            
            // Check if device is already registered
            const existingDevice = this.deviceRegistry.get(deviceId);
            
            if (existingDevice) {
                // Update existing device
                existingDevice.lastSeen = Date.now();
                existingDevice.hostname = hostname || existingDevice.hostname;
                existingDevice.ipAddress = ipAddress || existingDevice.ipAddress;
                existingDevice.version = version || existingDevice.version;
                
                this.log.debug(`Updated existing device: ${deviceId}`);

                // Load device pages into active config
                await this.loadDevicePagesIntoConfig(deviceId);

                // Set device for display publishing and show splash
                this.displayPublisher.setDevice(deviceId);
                this.displayPublisher.lastContent = null;
                await this.showSplashScreen(deviceId);

                // Update lastSeen state
                await this.setStateAsync(`devices.${deviceId}.lastSeen`, Date.now(), true);
                
            } else {
                // Register new device
                this.deviceRegistry.set(deviceId, {
                    deviceId,
                    hostname: hostname || 'unknown',
                    ipAddress: ipAddress || 'unknown',
                    version: version || 'unknown',
                    firstSeen: Date.now(),
                    lastSeen: Date.now()
                });
                
                this.log.info(`✅ New device registered: ${deviceId}`);
                
                // Create ioBroker objects for device
                await this.stateManager.createDeviceObjects(deviceId, {
                    hostname: hostname || 'unknown',
                    ipAddress: ipAddress || 'unknown',
                    version: version || 'unknown'
                });
                
                this.log.debug(`Created ioBroker objects for device ${deviceId}`);

                // Migration: if device has no pages yet, copy from native.pages
                await this.migrateDevicePages(deviceId);
                await this.migrateDeviceFunctionKeys(deviceId);

                // Load device pages into active config
                await this.loadDevicePagesIntoConfig(deviceId);

                // Set device for display publishing and show splash
                this.displayPublisher.setDevice(deviceId);
                this.displayPublisher.lastContent = null;
                await this.showSplashScreen(deviceId);
            }
            
            // Update devices online count
            const onlineCount = this.deviceRegistry.size;
            await this.setStateAsync('info.devicesOnline', onlineCount, true);
            this.log.debug(`Devices online: ${onlineCount}`);
            
        } catch (error) {
            this.log.error(`Error handling device announcement: ${error.message}`);
            this.log.debug(error.stack);
        }
    }
    
    /**
     * Migrate native.pages to device's config.pages (one-time migration)
     * @param {string} deviceId - Device ID
     */
    async migrateDevicePages(deviceId) {
        try {
            const state = await this.getStateAsync(`devices.${deviceId}.config.pages`);
            const hasDevicePages = state && state.val && state.val !== '[]';

            if (!hasDevicePages && this.config.pages && this.config.pages.length > 0) {
                // native.pages may be flat format (from Admin UI) — convert to nested for storage
                const nestedPages = unflattenPages(this.config.pages);
                this.log.info(`Migrating ${nestedPages.length} pages from native.pages to device ${deviceId}`);
                await this.setStateAsync(
                    `devices.${deviceId}.config.pages`,
                    JSON.stringify(nestedPages),
                    true
                );
            }
        } catch (error) {
            this.log.error(`Migration failed for device ${deviceId}: ${error.message}`);
        }
    }

    /**
     * Migrate native.functionKeys to device's config.functionKeys (one-time migration)
     * @param {string} deviceId - Device ID
     */
    async migrateDeviceFunctionKeys(deviceId) {
        try {
            const state = await this.getStateAsync(`devices.${deviceId}.config.functionKeys`);
            const hasDeviceFks = state && state.val && state.val !== '[]';
            if (!hasDeviceFks && this.config.functionKeys && this.config.functionKeys.length > 0) {
                this.log.info(`Migrating function keys to device ${deviceId}`);
                await this.setStateAsync(
                    `devices.${deviceId}.config.functionKeys`,
                    JSON.stringify(this.config.functionKeys),
                    true
                );
            }
        } catch (error) {
            this.log.error(`Function key migration failed for ${deviceId}: ${error.message}`);
        }
    }

    /**
     * Load device's pages into active config
     * @param {string} deviceId - Device ID
     */
    async loadDevicePagesIntoConfig(deviceId) {
        try {
            const state = await this.getStateAsync(`devices.${deviceId}.config.pages`);
            if (state && state.val) {
                const pages = JSON.parse(state.val);
                if (Array.isArray(pages) && pages.length > 0) {
                    this.config.pages = pages;
                    this.log.info(`Loaded ${pages.length} pages from device ${deviceId}`);
                }
            }

            // Also load function keys (fall back to native if device has none)
            const fkState = await this.getStateAsync(`devices.${deviceId}.config.functionKeys`);
            let fks = [];
            if (fkState && fkState.val) {
                try {
                    fks = JSON.parse(fkState.val);
                } catch (e) {
                    this.log.warn(`Invalid function keys JSON for device ${deviceId}: ${e.message}`);
                }
            }
            if (Array.isArray(fks) && fks.length > 0) {
                this.config.functionKeys = fks;
                this.log.info(`Loaded ${fks.length} function keys from device ${deviceId}`);
            } else if (this.config.functionKeys && this.config.functionKeys.length > 0) {
                // Device has no FK stored — keep native defaults and persist them
                this.log.info(`No function keys on device ${deviceId}, using native defaults and persisting`);
                await this.setStateAsync(
                    `devices.${deviceId}.config.functionKeys`,
                    JSON.stringify(this.config.functionKeys),
                    true
                );
            }
        } catch (error) {
            this.log.error(`Failed to load pages from device ${deviceId}: ${error.message}`);
        }
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

            if (this.reRenderInterval) {
                clearInterval(this.reRenderInterval);
                this.reRenderInterval = null;
                this.log.debug('Re-render interval cleared');
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
