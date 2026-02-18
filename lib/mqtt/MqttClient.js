'use strict';

/**
 * MQTT Client
 * 
 * Manages connection to MQTT broker and provides pub/sub interface.
 * Handles reconnection and error recovery.
 * 
 * @author Kira Holt
 */

const mqtt = require('mqtt');

class MqttClient {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - MQTT configuration
     * @param {string} config.broker - Broker address
     * @param {number} config.port - Broker port
     * @param {string} [config.username] - Username
     * @param {string} [config.password] - Password
     * @param {string} [config.topicPrefix] - Topic prefix
     */
    constructor(adapter, config) {
        this.adapter = adapter;
        this.config = config || {};
        this.client = null;
        this.connected = false;
        this.topicPrefix = config.topicPrefix || 'mcdu';
    }
    
    /**
     * Connect to MQTT broker
     * @returns {Promise<void>}
     */
    async connect() {
        // Prevent multiple simultaneous connections
        if (this.client && this.connected) {
            this.adapter.log.debug('MQTT already connected, skipping reconnect');
            return Promise.resolve();
        }
        
        // Disconnect existing client if any (cleanup before reconnect)
        if (this.client) {
            this.adapter.log.debug('Disconnecting existing MQTT client before reconnect');
            this.client.end(true); // force=true for immediate close
            this.client = null;
        }
        
        return new Promise((resolve, reject) => {
            const url = `mqtt://${this.config.broker}:${this.config.port}`;
            
            this.adapter.log.info(`Connecting to MQTT broker: ${url}`);
            
            const options = {
                clientId: `iobroker-mcdu-${this.adapter.instance}`,
                keepalive: 60,
                clean: true,
                reconnectPeriod: 5000  // Auto-reconnect every 5 seconds on disconnect
            };
            
            // Only add credentials if they're provided (non-empty strings)
            if (this.config.username && this.config.username.trim() !== '') {
                options.username = this.config.username;
            }
            if (this.config.password && this.config.password.trim() !== '') {
                options.password = this.config.password;
            }
            
            // Add will message
            options.will = {
                topic: `${this.topicPrefix}/adapter/status`,
                payload: JSON.stringify({
                    status: 'offline',
                    timestamp: Date.now()
                }),
                qos: 1,
                retain: true
            };
            
            this.adapter.log.debug(`MQTT options: ${JSON.stringify({
                ...options,
                password: options.password ? '***' : undefined,
                will: 'configured'
            })}`);
            
            this.client = mqtt.connect(url, options);
            
            this.client.on('connect', async () => {
                this.adapter.log.info('✅ MQTT connected!');
                this.connected = true;
                
                await this.adapter.setStateAsync('info.connection', true, true);
                
                // Publish adapter online status
                this.publish(
                    `${this.topicPrefix}/adapter/status`,
                    JSON.stringify({
                        status: 'online',
                        version: this.adapter.version,
                        timestamp: Date.now()
                    }),
                    { qos: 1, retain: true }
                );
                
                resolve();
            });
            
            this.client.on('error', (error) => {
                this.adapter.log.error(`MQTT error: ${error.message}`);
                this.connected = false;
                this.adapter.setStateAsync('info.connection', false, true);
                reject(error);
            });
            
            this.client.on('close', () => {
                this.adapter.log.warn('MQTT connection closed');
                this.connected = false;
                this.adapter.setStateAsync('info.connection', false, true);
            });
            
            this.client.on('reconnect', () => {
                this.adapter.log.debug('MQTT reconnecting...');
            });
            
            this.client.on('offline', () => {
                this.adapter.log.warn('MQTT offline');
                this.connected = false;
                this.adapter.setStateAsync('info.connection', false, true);
            });
        });
    }
    
    /**
     * Disconnect from MQTT broker
     */
    disconnect() {
        if (this.client && this.connected) {
            this.adapter.log.info('Disconnecting from MQTT broker...');
            
            // Publish offline status
            this.publish(
                `${this.topicPrefix}/adapter/status`,
                JSON.stringify({
                    status: 'offline',
                    timestamp: Date.now()
                }),
                { qos: 1, retain: true }
            );
            
            this.client.end();
            this.connected = false;
        }
    }
    
    /**
     * Publish message to MQTT topic
     * @param {string} topic - Topic name (without prefix)
     * @param {string|Buffer} payload - Message payload
     * @param {object} [options] - Publish options
     * @param {number} [options.qos=1] - QoS level
     * @param {boolean} [options.retain=false] - Retain flag
     * @returns {Promise<void>}
     */
    async publish(topic, payload, options = {}) {
        if (!this.client || !this.connected) {
            this.adapter.log.warn(`Cannot publish to ${topic}: not connected`);
            return;
        }
        
        const fullTopic = topic.startsWith(this.topicPrefix) ? topic : `${this.topicPrefix}/${topic}`;
        const opts = {
            qos: options.qos !== undefined ? options.qos : 1,
            retain: options.retain || false
        };
        
        return new Promise((resolve, reject) => {
            this.client.publish(fullTopic, payload, opts, (err) => {
                if (err) {
                    this.adapter.log.error(`Failed to publish to ${fullTopic}: ${err.message}`);
                    reject(err);
                } else {
                    this.adapter.log.debug(`Published to ${fullTopic}`);
                    resolve();
                }
            });
        });
    }
    
    /**
     * Subscribe to MQTT topic
     * @param {string} topic - Topic name (without prefix)
     * @param {function} handler - Message handler (topic, message) => void
     * @param {object} [options] - Subscribe options
     * @param {number} [options.qos=1] - QoS level
     * @returns {Promise<void>}
     */
    async subscribe(topic, handler, options = {}) {
        if (!this.client) {
            throw new Error('MQTT client not initialized');
        }
        
        const fullTopic = topic.startsWith(this.topicPrefix) ? topic : `${this.topicPrefix}/${topic}`;
        const opts = {
            qos: options.qos !== undefined ? options.qos : 1
        };
        
        return new Promise((resolve, reject) => {
            this.client.subscribe(fullTopic, opts, (err) => {
                if (err) {
                    this.adapter.log.error(`Failed to subscribe to ${fullTopic}: ${err.message}`);
                    reject(err);
                } else {
                    this.adapter.log.debug(`Subscribed to ${fullTopic}`);
                    
                    // Register message handler
                    this.client.on('message', (receivedTopic, message) => {
                        if (receivedTopic === fullTopic || this.topicMatches(receivedTopic, fullTopic)) {
                            try {
                                handler(receivedTopic, message);
                            } catch (error) {
                                this.adapter.log.error(`Error in message handler for ${receivedTopic}: ${error.message}`);
                            }
                        }
                    });
                    
                    resolve();
                }
            });
        });
    }
    
    /**
     * Unsubscribe from MQTT topic
     * @param {string} topic - Topic name (without prefix)
     * @returns {Promise<void>}
     */
    async unsubscribe(topic) {
        if (!this.client) {
            return;
        }
        
        const fullTopic = topic.startsWith(this.topicPrefix) ? topic : `${this.topicPrefix}/${topic}`;
        
        return new Promise((resolve, reject) => {
            this.client.unsubscribe(fullTopic, (err) => {
                if (err) {
                    this.adapter.log.error(`Failed to unsubscribe from ${fullTopic}: ${err.message}`);
                    reject(err);
                } else {
                    this.adapter.log.debug(`Unsubscribed from ${fullTopic}`);
                    resolve();
                }
            });
        });
    }
    
    /**
     * Check if topic matches pattern (supports MQTT wildcards)
     * @param {string} topic - Actual topic
     * @param {string} pattern - Pattern with wildcards (+, #)
     * @returns {boolean}
     */
    topicMatches(topic, pattern) {
        const topicParts = topic.split('/');
        const patternParts = pattern.split('/');
        
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i] === '#') {
                return true; // Multi-level wildcard matches rest
            }
            if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
                return false;
            }
        }
        
        return topicParts.length === patternParts.length;
    }
    
    /**
     * Check if client is connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }
}

module.exports = MqttClient;
