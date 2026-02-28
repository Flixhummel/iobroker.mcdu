'use strict';

/**
 * State Tree Manager
 * 
 * Creates and manages the ioBroker object tree for MCDU adapter.
 * Structure:
 *   - info/ (connection status, devices online)
 *   - devices/ (connected MCDU devices)
 *   - pages/ (page definitions with line states)
 *   - runtime/ (current page, mode, scratchpad)
 *   - control/ (switchPage, goBack, refresh)
 * 
 * @author Kira Holt
 */

class StateTreeManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
    }
    
    /**
     * Setup complete object tree
     * @returns {Promise<void>}
     */
    async setupObjectTree() {
        this.adapter.log.debug('Creating object tree...');
        
        // Create adapter-level info objects only
        await this.createInfoObjects();
        await this.createDevicesChannel();
        
        // Device-specific objects (pages, leds, scratchpad, etc.) will be created
        // when devices announce themselves via createDeviceObjects()
        
        this.adapter.log.info('✅ Object tree created (device objects created on announcement)');
    }
    
    /**
     * Create info objects (connection status, etc.)
     * @returns {Promise<void>}
     */
    async createInfoObjects() {
        await this.adapter.setObjectNotExistsAsync('info', {
            type: 'channel',
            common: {
                name: 'Information'
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'MQTT Connection',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('info.devicesOnline', {
            type: 'state',
            common: {
                name: 'Devices Online',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                min: 0,
                def: 0
            },
            native: {}
        });
        
        // Initialize
        await this.adapter.setStateAsync('info.connection', false, true);
        await this.adapter.setStateAsync('info.devicesOnline', 0, true);
    }
    
    /**
     * Create devices channel (for connected MCDU devices)
     * @returns {Promise<void>}
     */
    async createDevicesChannel() {
        await this.adapter.setObjectNotExistsAsync('devices', {
            type: 'channel',
            common: {
                name: 'Connected Devices'
            },
            native: {}
        });
    }
    
    /**
     * Create complete device object tree for a specific device
     * Creates all device-specific channels and states
     * @param {string} deviceId - Device ID
     * @param {object} deviceInfo - Device information (hostname, ipAddress, version)
     * @returns {Promise<void>}
     */
    async createDeviceObjects(deviceId, deviceInfo) {
        this.adapter.log.debug(`Creating object tree for device: ${deviceId}`);
        
        // Create device channel
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}`, {
            type: 'device',
            common: {
                name: deviceInfo.hostname || deviceId
            },
            native: {
                deviceId,
                hostname: deviceInfo.hostname,
                ipAddress: deviceInfo.ipAddress,
                version: deviceInfo.version
            }
        });
        
        // === INFO Channel ===
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.info`, {
            type: 'channel',
            common: { name: 'Device Information' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'info.online', {
            name: 'Online',
            type: 'boolean',
            role: 'indicator.connected',
            read: true,
            write: false,
            def: false
        });
        
        await this.createDeviceState(deviceId, 'info.hostname', {
            name: 'Hostname',
            type: 'string',
            role: 'info.name',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'info.ipAddress', {
            name: 'IP Address',
            type: 'string',
            role: 'info.ip',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'info.version', {
            name: 'Client Version',
            type: 'string',
            role: 'info.version',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'info.lastSeen', {
            name: 'Last Seen',
            type: 'number',
            role: 'value.time',
            read: true,
            write: false
        });
        
        // === DISPLAY Channel ===
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.display`, {
            type: 'channel',
            common: { name: 'Display Control' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'display.currentPage', {
            name: 'Current Page',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'display.brightness', {
            name: 'Screen Brightness',
            type: 'number',
            role: 'level.brightness',
            read: true,
            write: true,
            min: 0,
            max: 255,
            def: 200
        });

        await this.createDeviceState(deviceId, 'display.brightnessStep', {
            name: 'BRT/DIM Step Size',
            type: 'number',
            role: 'level',
            read: true,
            write: true,
            min: 1,
            max: 255,
            def: 20
        });

        await this.createDeviceState(deviceId, 'display.render', {
            name: 'Last Rendered Content',
            type: 'string',
            role: 'json',
            read: true,
            write: false
        });
        
        // === LEDs Channel ===
        await this.createDeviceLEDs(deviceId);
        
        // === SCRATCHPAD Channel ===
        await this.createDeviceScratchpad(deviceId);
        
        // === NAVIGATION Channel ===
        await this.createDeviceNavigation(deviceId);
        
        // === NOTIFICATIONS Channel ===
        await this.createDeviceNotifications(deviceId);
        
        // === ACTIONS Channel ===
        await this.createDeviceActions(deviceId);
        
        // === CONFIG Channel ===
        await this.createDeviceConfig(deviceId);

        // === CONTROL Channel ===
        await this.createDeviceControl(deviceId);
        
        // Initialize info states
        await this.adapter.setStateAsync(`devices.${deviceId}.info.online`, true, true);
        await this.adapter.setStateAsync(`devices.${deviceId}.info.hostname`, deviceInfo.hostname || 'unknown', true);
        await this.adapter.setStateAsync(`devices.${deviceId}.info.ipAddress`, deviceInfo.ipAddress || 'unknown', true);
        await this.adapter.setStateAsync(`devices.${deviceId}.info.version`, deviceInfo.version || 'unknown', true);
        await this.adapter.setStateAsync(`devices.${deviceId}.info.lastSeen`, Date.now(), true);
        
        this.adapter.log.info(`✅ Created complete object tree for device: ${deviceId}`);
    }
    
    /**
     * Helper: Create a device-specific state
     * @param {string} deviceId - Device ID
     * @param {string} statePath - State path (e.g. "info.online")
     * @param {object} common - State common object
     */
    async createDeviceState(deviceId, statePath, common) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.${statePath}`, {
            type: 'state',
            common: common,
            native: {}
        });
    }
    
    /**
     * Create LED states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceLEDs(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.leds`, {
            type: 'channel',
            common: { name: 'LED Control' },
            native: {}
        });
        
        const leds = [
            'FAIL', 'FM', 'MCDU', 'MENU', 'FM1', 'IND', 'RDY', 'STATUS', 'FM2'
        ];
        
        for (const led of leds) {
            await this.createDeviceState(deviceId, `leds.${led}`, {
                name: `LED ${led}`,
                type: 'boolean',
                role: 'switch.light',
                read: true,
                write: true,
                def: false
            });
        }
        
        // Backlight LEDs (with brightness)
        await this.createDeviceState(deviceId, 'leds.BACKLIGHT', {
            name: 'Button Backlight',
            type: 'number',
            role: 'level.brightness',
            read: true,
            write: true,
            min: 0,
            max: 255,
            def: 255
        });
        
        await this.createDeviceState(deviceId, 'leds.SCREEN_BACKLIGHT', {
            name: 'Screen Backlight',
            type: 'number',
            role: 'level.brightness',
            read: true,
            write: true,
            min: 0,
            max: 255,
            def: 255
        });
    }
    
    /**
     * Create scratchpad states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceScratchpad(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.scratchpad`, {
            type: 'channel',
            common: { name: 'Scratchpad (Line 14)' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'scratchpad.content', {
            name: 'Scratchpad Content',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: ''
        });
        
        await this.createDeviceState(deviceId, 'scratchpad.valid', {
            name: 'Input Valid',
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
            def: true
        });
        
        await this.createDeviceState(deviceId, 'scratchpad.mode', {
            name: 'Input Mode',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: 'normal',
            states: {
                'normal': 'Normal',
                'input': 'Input',
                'edit': 'Edit',
                'confirm': 'Confirm'
            }
        });
    }
    
    /**
     * Create navigation states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceNavigation(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.navigation`, {
            type: 'channel',
            common: { name: 'Page Navigation' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'navigation.currentPage', {
            name: 'Current Page ID',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'navigation.previousPage', {
            name: 'Previous Page ID',
            type: 'string',
            role: 'text',
            read: true,
            write: false
        });
        
        await this.createDeviceState(deviceId, 'navigation.pageHistory', {
            name: 'Page History',
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            def: '[]'
        });
    }
    
    /**
     * Create notification states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceNotifications(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.notifications`, {
            type: 'channel',
            common: { name: 'Notifications' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'notifications.message', {
            name: 'Notification Message',
            type: 'string',
            role: 'text',
            read: true,
            write: true
        });
        
        await this.createDeviceState(deviceId, 'notifications.type', {
            name: 'Notification Type',
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: 'info',
            states: {
                'info': 'Info',
                'warning': 'Warning',
                'error': 'Error',
                'success': 'Success'
            }
        });
        
        await this.createDeviceState(deviceId, 'notifications.duration', {
            name: 'Display Duration (ms)',
            type: 'number',
            role: 'value',
            read: true,
            write: true,
            def: 3000
        });
        
        await this.createDeviceState(deviceId, 'notifications.clear', {
            name: 'Clear Notification',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false
        });
        
        await this.createDeviceState(deviceId, 'notifications.registered', {
            name: 'Registered Notifications (JSON)',
            type: 'string',
            role: 'json',
            read: true,
            write: false,
            def: '{}' // {notificationId: {message, type, duration}}
        });
    }
    
    /**
     * Create action states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceActions(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.actions`, {
            type: 'channel',
            common: { name: 'Actions (External Control)' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'actions.pressButton', {
            name: 'Simulate Button Press',
            type: 'string',
            role: 'text',
            read: false,
            write: true
        });
        
        await this.createDeviceState(deviceId, 'actions.confirmAction', {
            name: 'Trigger OVFY (Confirm)',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false
        });
        
        await this.createDeviceState(deviceId, 'actions.cancelAction', {
            name: 'Trigger CLR (Cancel)',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false
        });
    }
    
    /**
     * Create config states for a device (per-device page storage)
     * @param {string} deviceId - Device ID
     */
    async createDeviceConfig(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.config`, {
            type: 'channel',
            common: { name: 'Device Configuration' },
            native: {}
        });

        await this.createDeviceState(deviceId, 'config.pages', {
            name: 'Page Configuration (JSON)',
            type: 'string',
            role: 'json',
            read: true,
            write: true,
            def: '[]'
        });

        await this.createDeviceState(deviceId, 'config.defaultColor', {
            name: 'Default Text Color',
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: 'white',
            states: {
                white: 'White',
                green: 'Green',
                blue: 'Blue',
                amber: 'Amber',
                red: 'Red',
                magenta: 'Magenta',
                cyan: 'Cyan',
                yellow: 'Yellow'
            }
        });

        await this.createDeviceState(deviceId, 'config.startPage', {
            name: 'Start Page',
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: ''
        });
    }

    /**
     * Create control states for a device
     * @param {string} deviceId - Device ID
     */
    async createDeviceControl(deviceId) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.control`, {
            type: 'channel',
            common: { name: 'Device Control' },
            native: {}
        });
        
        await this.createDeviceState(deviceId, 'control.switchPage', {
            name: 'Switch to Page ID',
            type: 'string',
            role: 'text',
            read: false,
            write: true
        });
        
        await this.createDeviceState(deviceId, 'control.goBack', {
            name: 'Go Back to Previous Page',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false
        });
        
        await this.createDeviceState(deviceId, 'control.refresh', {
            name: 'Refresh Display',
            type: 'boolean',
            role: 'button',
            read: false,
            write: true,
            def: false
        });
    }
    
    /**
     * Create page objects from configuration
     * @returns {Promise<void>}
     */
    async createPagesObjects() {
        await this.adapter.setObjectNotExistsAsync('pages', {
            type: 'channel',
            common: {
                name: 'Pages'
            },
            native: {}
        });
        
        const pages = this.adapter.config.pages || [];
        
        for (const page of pages) {
            await this.createPageObjects(page);
        }
        
        this.adapter.log.debug(`Created ${pages.length} page objects`);
    }
    
    /**
     * Create objects for a single page
     * @param {object} pageConfig - Page configuration
     * @returns {Promise<void>}
     */
    async createPageObjects(pageConfig) {
        const pageId = pageConfig.id;
        
        // Page channel
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}`, {
            type: 'channel',
            common: {
                name: pageConfig.name,
                role: 'page'
            },
            native: {
                id: pageId,
                parent: pageConfig.parent,
                config: pageConfig
            }
        });
        
        // Page info state
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.info`, {
            type: 'state',
            common: {
                name: 'Page Info',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync(`pages.${pageId}.info`, JSON.stringify({
            id: pageId,
            name: pageConfig.name,
            parent: pageConfig.parent,
            linesCount: pageConfig.lines?.length || 0
        }), true);
        
        // Page active state
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.active`, {
            type: 'state',
            common: {
                name: 'Page Active',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync(`pages.${pageId}.active`, false, true);
        
        // Create lines channel
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.lines`, {
            type: 'channel',
            common: {
                name: 'Lines'
            },
            native: {}
        });
        
        // Create line objects
        const lines = pageConfig.lines || [];
        for (const line of lines) {
            await this.createLineObjects(pageId, line);
        }
    }
    
    /**
     * Create objects for a single line
     * @param {string} pageId - Page ID
     * @param {object} lineConfig - Line configuration
     * @returns {Promise<void>}
     */
    async createLineObjects(pageId, lineConfig) {
        const row = lineConfig.row;
        
        // Line channel
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.lines.${row}`, {
            type: 'channel',
            common: {
                name: `Line ${row}`,
                role: 'line'
            },
            native: {
                row,
                config: lineConfig
            }
        });
        
        // Left button state
        if (lineConfig.leftButton && lineConfig.leftButton.type !== 'empty') {
            await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.lines.${row}.leftButton`, {
                type: 'state',
                common: {
                    name: `Left Button ${row}`,
                    type: 'string',
                    role: 'button',
                    read: true,
                    write: true
                },
                native: {
                    side: 'left',
                    config: lineConfig.leftButton
                }
            });
            
            await this.adapter.setStateAsync(
                `pages.${pageId}.lines.${row}.leftButton`,
                lineConfig.leftButton.label || '',
                true
            );
        }
        
        // Display state
        await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.lines.${row}.display`, {
            type: 'state',
            common: {
                name: `Display ${row}`,
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {
                config: lineConfig.display
            }
        });
        
        await this.adapter.setStateAsync(`pages.${pageId}.lines.${row}.display`, '', true);
        
        // Right button state
        if (lineConfig.rightButton && lineConfig.rightButton.type !== 'empty') {
            await this.adapter.setObjectNotExistsAsync(`pages.${pageId}.lines.${row}.rightButton`, {
                type: 'state',
                common: {
                    name: `Right Button ${row}`,
                    type: 'string',
                    role: 'button',
                    read: true,
                    write: true
                },
                native: {
                    side: 'right',
                    config: lineConfig.rightButton
                }
            });
            
            await this.adapter.setStateAsync(
                `pages.${pageId}.lines.${row}.rightButton`,
                lineConfig.rightButton.label || '',
                true
            );
        }
    }
    
    /**
     * Create runtime objects (current page, mode, etc.)
     * @returns {Promise<void>}
     */
    async createRuntimeObjects() {
        await this.adapter.setObjectNotExistsAsync('runtime', {
            type: 'channel',
            common: {
                name: 'Runtime State'
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('runtime.currentPage', {
            type: 'state',
            common: {
                name: 'Current Page',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('runtime.previousPage', {
            type: 'state',
            common: {
                name: 'Previous Page',
                type: 'string',
                role: 'state',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('runtime.mode', {
            type: 'state',
            common: {
                name: 'Mode',
                type: 'string',
                role: 'state',
                read: true,
                write: false,
                states: {
                    'normal': 'Normal',
                    'input': 'Input',
                    'edit': 'Edit',
                    'confirm': 'Confirm'
                }
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.mode', 'normal', true);
        
        await this.adapter.setObjectNotExistsAsync('runtime.scratchpad', {
            type: 'state',
            common: {
                name: 'Scratchpad',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.scratchpad', '', true);
        
        await this.adapter.setObjectNotExistsAsync('runtime.selectedLine', {
            type: 'state',
            common: {
                name: 'Selected Line',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                min: 0,
                max: 14
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.selectedLine', 0, true);
        
        // Phase 4.1: Extended Runtime States
        await this.adapter.setObjectNotExistsAsync('runtime.editActive', {
            type: 'state',
            common: {
                name: 'Edit Mode Active',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.editActive', false, true);
        
        await this.adapter.setObjectNotExistsAsync('runtime.confirmationPending', {
            type: 'state',
            common: {
                name: 'Confirmation Pending',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.confirmationPending', false, true);
        
        await this.adapter.setObjectNotExistsAsync('runtime.lastButtonPress', {
            type: 'state',
            common: {
                name: 'Last Button',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('runtime.lastButtonTime', {
            type: 'state',
            common: {
                name: 'Last Button Time',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('runtime.uptime', {
            type: 'state',
            common: {
                name: 'Adapter Uptime',
                type: 'number',
                role: 'value.interval',
                read: true,
                write: false,
                unit: 'seconds'
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('runtime.uptime', 0, true);
    }
    
    /**
     * Create control objects (commands)
     * @returns {Promise<void>}
     */
    async createControlObjects() {
        await this.adapter.setObjectNotExistsAsync('control', {
            type: 'channel',
            common: {
                name: 'Control'
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('control.switchPage', {
            type: 'state',
            common: {
                name: 'Switch Page',
                type: 'string',
                role: 'text',
                read: true,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.switchPage');
        
        await this.adapter.setObjectNotExistsAsync('control.goBack', {
            type: 'state',
            common: {
                name: 'Go Back',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.goBack');
        
        await this.adapter.setObjectNotExistsAsync('control.refresh', {
            type: 'state',
            common: {
                name: 'Refresh Display',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.refresh');
        
        // Phase 4.1: Extended Navigation Controls
        await this.adapter.setObjectNotExistsAsync('control.nextPage', {
            type: 'state',
            common: {
                name: 'Next Page',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.nextPage');
        
        await this.adapter.setObjectNotExistsAsync('control.previousPage', {
            type: 'state',
            common: {
                name: 'Previous Page',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.previousPage');
        
        await this.adapter.setObjectNotExistsAsync('control.homePage', {
            type: 'state',
            common: {
                name: 'Go to Home',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        
        this.adapter.subscribeStates('control.homePage');
        
        await this.adapter.setObjectNotExistsAsync('control.pageHistory', {
            type: 'state',
            common: {
                name: 'Page History',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
                def: '[]'
            },
            native: {}
        });
        
        await this.adapter.setStateAsync('control.pageHistory', '[]', true);
    }
    
    /**
     * Create LED control objects
     * @returns {Promise<void>}
     */
    async createLEDObjects() {
        await this.adapter.setObjectNotExistsAsync('leds', {
            type: 'channel',
            common: { name: 'LED Control' },
            native: {}
        });
        
        const leds = [
            'FAIL', 'FM', 'MCDU', 'MENU', 'FM1', 
            'IND', 'RDY', 'STATUS', 'FM2'
        ];
        
        // Boolean/Numeric LEDs (0-255 or true/false)
        for (const led of leds) {
            await this.adapter.setObjectNotExistsAsync(`leds.${led}`, {
                type: 'state',
                common: {
                    name: `LED ${led}`,
                    type: 'mixed',  // Accepts boolean or number
                    role: 'switch',
                    read: true,
                    write: true,
                    def: false
                },
                native: {}
            });
            // Subscribe to state changes
            this.adapter.subscribeStates(`leds.${led}`);
        }
        
        // Brightness LEDs (0-255 only)
        const brightnessLEDs = ['BACKLIGHT', 'SCREEN_BACKLIGHT'];
        for (const led of brightnessLEDs) {
            await this.adapter.setObjectNotExistsAsync(`leds.${led}`, {
                type: 'state',
                common: {
                    name: `${led} Brightness`,
                    type: 'number',
                    role: 'level.dimmer',
                    read: true,
                    write: true,
                    min: 0,
                    max: 255,
                    def: 128
                },
                native: {}
            });
            // Subscribe to state changes
            this.adapter.subscribeStates(`leds.${led}`);
        }
        
        this.adapter.log.debug(`Created ${leds.length + brightnessLEDs.length} LED objects`);
    }
    
    /**
     * Create scratchpad control objects
     * @returns {Promise<void>}
     */
    async createScratchpadObjects() {
        await this.adapter.setObjectNotExistsAsync('scratchpad', {
            type: 'channel',
            common: { name: 'Scratchpad Control' },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('scratchpad.content', {
            type: 'state',
            common: {
                name: 'Scratchpad Content',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
                def: ''
            },
            native: {}
        });
        this.adapter.subscribeStates('scratchpad.content');
        
        await this.adapter.setObjectNotExistsAsync('scratchpad.valid', {
            type: 'state',
            common: {
                name: 'Content Valid',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('scratchpad.validationError', {
            type: 'state',
            common: {
                name: 'Validation Error',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                def: ''
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('scratchpad.clear', {
            type: 'state',
            common: {
                name: 'Clear Scratchpad',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                def: false
            },
            native: {}
        });
        this.adapter.subscribeStates('scratchpad.clear');
        
        this.adapter.log.debug('Created 4 scratchpad objects');
    }
    
    /**
     * Create notification objects
     * @returns {Promise<void>}
     */
    async createNotificationObjects() {
        await this.adapter.setObjectNotExistsAsync('notifications', {
            type: 'channel',
            common: { name: 'Notifications' },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('notifications.message', {
            type: 'state',
            common: {
                name: 'Message',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
                def: ''
            },
            native: {}
        });
        this.adapter.subscribeStates('notifications.message');
        
        await this.adapter.setObjectNotExistsAsync('notifications.type', {
            type: 'state',
            common: {
                name: 'Type',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
                states: {
                    'info': 'Info',
                    'warning': 'Warning',
                    'error': 'Error',
                    'success': 'Success'
                },
                def: 'info'
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('notifications.duration', {
            type: 'state',
            common: {
                name: 'Duration (ms)',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                min: 0,
                def: 3000
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('notifications.line', {
            type: 'state',
            common: {
                name: 'Display Line',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                min: 1,
                max: 13,
                def: 13
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('notifications.clear', {
            type: 'state',
            common: {
                name: 'Clear Notification',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                def: false
            },
            native: {}
        });
        this.adapter.subscribeStates('notifications.clear');
        
        this.adapter.log.debug('Created 5 notification objects');
    }
    
    /**
     * Create action trigger objects
     * @returns {Promise<void>}
     */
    async createActionObjects() {
        await this.adapter.setObjectNotExistsAsync('actions', {
            type: 'channel',
            common: { name: 'Action Triggers' },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync('actions.pressButton', {
            type: 'state',
            common: {
                name: 'Press Button',
                type: 'string',
                role: 'text',
                read: true,
                write: true,
                desc: 'Button name: LSK1L, LSK2R, MENU, etc.'
            },
            native: {}
        });
        this.adapter.subscribeStates('actions.pressButton');
        
        await this.adapter.setObjectNotExistsAsync('actions.confirmAction', {
            type: 'state',
            common: {
                name: 'Confirm (OVFY)',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        this.adapter.subscribeStates('actions.confirmAction');
        
        await this.adapter.setObjectNotExistsAsync('actions.cancelAction', {
            type: 'state',
            common: {
                name: 'Cancel (CLR)',
                type: 'boolean',
                role: 'button',
                read: false,
                write: true
            },
            native: {}
        });
        this.adapter.subscribeStates('actions.cancelAction');
        
        this.adapter.log.debug('Created 3 action trigger objects');
    }
}

module.exports = StateTreeManager;
