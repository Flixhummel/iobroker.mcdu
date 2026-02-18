/**
 * MQTT Handler - Manages MQTT connection and message routing
 */

const mqtt = require('mqtt');
const EventEmitter = require('events');

class MqttHandler extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.deviceId = config.device.id;
        this.client = null;
        this.connected = false;
    }

    connect() {
        console.log(`Connecting to MQTT broker: ${this.config.mqtt.broker}`);
        
        const options = {
            clientId: this.config.mqtt.clientId,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 30000,
            will: {
                topic: `mcdu/${this.deviceId}/status`,
                payload: JSON.stringify({ 
                    state: 'offline',
                    timestamp: Date.now()
                }),
                qos: 1,
                retain: true
            }
        };

        // Add credentials if provided
        if (this.config.mqtt.username) {
            options.username = this.config.mqtt.username;
        }
        if (this.config.mqtt.password) {
            options.password = this.config.mqtt.password;
        }

        this.client = mqtt.connect(this.config.mqtt.broker, options);

        this.client.on('connect', () => this._onConnect());
        this.client.on('message', (topic, message) => this._onMessage(topic, message));
        this.client.on('error', (err) => this._onError(err));
        this.client.on('offline', () => this._onOffline());
        this.client.on('reconnect', () => this._onReconnect());
    }

    _onConnect() {
        console.log('✓ Connected to MQTT broker');
        this.connected = true;

        // Subscribe to all device topics
        const topics = [
            `mcdu/${this.deviceId}/display/#`,
            `mcdu/${this.deviceId}/led/#`,
            `mcdu/${this.deviceId}/config/#`
        ];

        topics.forEach(topic => {
            this.client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`Failed to subscribe to ${topic}:`, err.message);
                } else {
                    console.log(`✓ Subscribed to ${topic}`);
                }
            });
        });

        // Publish online status
        this.publishStatus('online');
        
        this.emit('connected');
    }

    _onMessage(topic, message) {
        const payload = message.toString();
        
        // Parse topic: mcdu/{deviceId}/{category}/{subcategory}
        const parts = topic.split('/');
        if (parts.length < 4) return;

        const category = parts[2];     // display, led, config
        const subcategory = parts[3];  // line0, FAIL, reload, etc.

        try {
            if (category === 'display') {
                this._handleDisplayMessage(subcategory, payload);
            } else if (category === 'led') {
                this._handleLedMessage(subcategory, payload);
            } else if (category === 'config') {
                this._handleConfigMessage(subcategory, payload);
            }
        } catch (err) {
            console.error(`Error handling message on ${topic}:`, err.message);
        }
    }

    _handleDisplayMessage(subcategory, payload) {
        if (subcategory.startsWith('line')) {
            const lineNum = parseInt(subcategory.replace('line', ''), 10);
            if (!isNaN(lineNum) && lineNum >= 0 && lineNum <= 13) {
                this.emit('display-line', lineNum, payload);
            }
        } else if (subcategory.startsWith('color')) {
            const lineNum = parseInt(subcategory.replace('color', ''), 10);
            if (!isNaN(lineNum) && lineNum >= 0 && lineNum <= 13) {
                this.emit('display-color', lineNum, payload);
            }
        } else if (subcategory === 'update') {
            this.emit('display-update');
        } else if (subcategory === 'clear') {
            this.emit('display-clear');
        }
    }

    _handleLedMessage(ledName, payload) {
        const brightness = parseInt(payload, 10);
        if (!isNaN(brightness)) {
            this.emit('led', ledName, brightness);
        }
    }

    _handleConfigMessage(subcategory, payload) {
        if (subcategory === 'reload') {
            this.emit('config-reload');
        }
    }

    _onError(err) {
        console.error('MQTT error:', err.message);
        this.emit('error', err);
    }

    _onOffline() {
        console.log('MQTT connection offline');
        this.connected = false;
        this.emit('offline');
    }

    _onReconnect() {
        console.log('Reconnecting to MQTT broker...');
        this.emit('reconnect');
    }

    publishButton(label, pressed = true) {
        if (!this.connected) return;

        const topic = `mcdu/${this.deviceId}/button/${label}`;
        const payload = JSON.stringify({
            pressed: pressed,
            timestamp: Date.now()
        });

        this.client.publish(topic, payload, { qos: 0 });
    }

    publishStatus(state) {
        if (!this.client) return;

        const topic = `mcdu/${this.deviceId}/status`;
        const payload = JSON.stringify({
            state: state,
            timestamp: Date.now(),
            version: '1.0.0'
        });

        this.client.publish(topic, payload, { qos: 1, retain: true });
    }

    publishHeartbeat() {
        if (!this.connected) return;

        const topic = `mcdu/${this.deviceId}/heartbeat`;
        const payload = JSON.stringify({
            timestamp: Date.now()
        });

        this.client.publish(topic, payload, { qos: 0 });
    }

    disconnect() {
        if (this.client) {
            console.log('Disconnecting from MQTT broker...');
            this.publishStatus('offline');
            this.client.end(false, () => {
                console.log('✓ Disconnected from MQTT broker');
            });
        }
    }
}

module.exports = MqttHandler;
