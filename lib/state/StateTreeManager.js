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
        
        await this.createInfoObjects();
        await this.createDevicesChannel();
        await this.createPagesObjects();
        await this.createRuntimeObjects();
        await this.createControlObjects();
        
        // Phase 4.1: Automation States
        await this.createLEDObjects();
        await this.createScratchpadObjects();
        await this.createNotificationObjects();
        await this.createActionObjects();
        
        this.adapter.log.info('✅ Object tree created (with automation states)');
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
     * Create device objects for a specific device
     * @param {string} deviceId - Device ID
     * @param {object} deviceInfo - Device information
     * @returns {Promise<void>}
     */
    async createDeviceObjects(deviceId, deviceInfo) {
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}`, {
            type: 'channel',
            common: {
                name: deviceInfo.hostname || deviceId,
                role: 'device'
            },
            native: {
                deviceId,
                hostname: deviceInfo.hostname,
                ipAddress: deviceInfo.ipAddress
            }
        });
        
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.online`, {
            type: 'state',
            common: {
                name: 'Online',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        
        await this.adapter.setObjectNotExistsAsync(`devices.${deviceId}.lastSeen`, {
            type: 'state',
            common: {
                name: 'Last Seen',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });
        
        await this.adapter.setStateAsync(`devices.${deviceId}.online`, true, true);
        await this.adapter.setStateAsync(`devices.${deviceId}.lastSeen`, Date.now(), true);
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
