'use strict';

/**
 * Display Publisher
 * 
 * Wraps MQTT publish operations for display updates.
 * Features:
 *   - Throttling (max 10 updates/sec)
 *   - Queue management
 *   - Content caching (avoid redundant updates)
 * 
 * @author Kira Holt
 */

class DisplayPublisher {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} mqttClient - MqttClient instance
     * @param {string|null} deviceId - Target device ID (null = use from method calls)
     */
    constructor(adapter, mqttClient, deviceId = null) {
        this.adapter = adapter;
        this.mqttClient = mqttClient;
        this.deviceId = deviceId; // Target device (can be set per-call)
        
        /** @type {number} Throttle interval in ms (default 100ms = 10 updates/sec) */
        this.throttleMs = adapter.config.performance?.renderThrottle || 100;
        
        /** @type {number} Last update timestamp */
        this.lastUpdate = 0;
        
        /** @type {Array<object>} Update queue */
        this.queue = [];
        
        /** @type {number} Max queue size */
        this.maxQueueSize = adapter.config.performance?.maxQueueSize || 100;
        
        /** @type {object|null} Last published content */
        this.lastContent = null;
        
        /** @type {boolean} Processing flag */
        this.processing = false;
    }
    
    /**
     * Set target device ID for all subsequent publishes
     * @param {string} deviceId - Device ID
     */
    setDevice(deviceId) {
        this.deviceId = deviceId;
    }
    
    /**
     * Publish full display update (all 14 lines)
     * @param {Array<object>} lines - Array of 14 line objects {text, color}
     * @returns {Promise<void>}
     */
    async publishFullDisplay(lines) {
        if (!Array.isArray(lines) || lines.length !== 14) {
            this.adapter.log.error(`Invalid lines array: expected 14, got ${lines?.length}`);
            return;
        }
        
        const payload = {
            lines: lines.map(line => {
                const entry = {
                    text: this.padOrTruncate(line.text || '', 24),
                    color: this.validateColor(line.color || 'white')
                };
                if (line.segments && Array.isArray(line.segments)) {
                    entry.segments = line.segments.map(seg => ({
                        text: seg.text || '',
                        color: this.validateColor(seg.color || 'white')
                    }));
                }
                return entry;
            }),
            timestamp: Date.now()
        };
        
        // Check if content changed
        if (this.isSameContent(payload)) {
            this.adapter.log.debug('Display content unchanged, skipping update');
            return;
        }
        
        // Add to queue
        this.enqueue({
            type: 'full',
            payload
        });
        
        // Process queue
        await this.processQueue();
    }
    
    /**
     * Publish single line update
     * @param {number} lineNumber - Line number (1-14)
     * @param {string} text - Line text (24 chars)
     * @param {string} color - Color name
     * @returns {Promise<void>}
     */
    async publishLine(lineNumber, text, color) {
        if (lineNumber < 1 || lineNumber > 14) {
            this.adapter.log.error(`Invalid line number: ${lineNumber}`);
            return;
        }
        
        const payload = {
            lineNumber,
            text: this.padOrTruncate(text || '', 24),
            color: this.validateColor(color || 'white'),
            timestamp: Date.now()
        };
        
        // Add to queue
        this.enqueue({
            type: 'line',
            payload
        });
        
        // Process queue
        await this.processQueue();
    }
    
    /**
     * Publish display clear
     * @returns {Promise<void>}
     */
    async publishClear() {
        const payload = {
            timestamp: Date.now()
        };
        
        // Add to queue
        this.enqueue({
            type: 'clear',
            payload
        });
        
        // Clear cache
        this.lastContent = null;
        
        // Process queue
        await this.processQueue();
    }
    
    /**
     * Add update to queue
     * @param {object} update - Update object
     */
    enqueue(update) {
        if (this.queue.length >= this.maxQueueSize) {
            this.adapter.log.warn(`Queue full (${this.maxQueueSize}), dropping oldest update`);
            this.queue.shift();
        }
        
        this.queue.push(update);
        this.adapter.log.debug(`Enqueued ${update.type} update (queue size: ${this.queue.length})`);
    }
    
    /**
     * Process update queue
     * @returns {Promise<void>}
     */
    async processQueue() {
        if (this.processing) {
            return; // Already processing
        }
        
        this.processing = true;
        
        try {
            while (this.queue.length > 0) {
                const now = Date.now();
                const timeSinceLastUpdate = now - this.lastUpdate;
                
                // Throttle check
                if (timeSinceLastUpdate < this.throttleMs) {
                    const delay = this.throttleMs - timeSinceLastUpdate;
                    this.adapter.log.debug(`Throttling: waiting ${delay}ms`);
                    await this.sleep(delay);
                }
                
                // Get next update
                const update = this.queue.shift();
                
                // Publish to MQTT
                await this.publishToMqtt(update);
                
                this.lastUpdate = Date.now();
            }
        } finally {
            this.processing = false;
        }
    }
    
    /**
     * Publish update to MQTT
     * @param {object} update - Update object
     * @returns {Promise<void>}
     */
    async publishToMqtt(update) {
        if (!this.deviceId) {
            this.adapter.log.debug('No deviceId set for DisplayPublisher (waiting for device connection)');
            return;
        }
        
        const topicMap = {
            'full': 'display/set',
            'line': 'display/line',
            'clear': 'display/clear'
        };
        
        const topicSuffix = topicMap[update.type];
        if (!topicSuffix) {
            this.adapter.log.error(`Unknown update type: ${update.type}`);
            return;
        }
        
        // Build device-scoped topic: {deviceId}/display/set
        const topic = `${this.deviceId}/${topicSuffix}`;
        const payload = JSON.stringify(update.payload);
        
        try {
            await this.mqttClient.publish(topic, payload, { qos: 1, retain: true });
            
            // Update cache for full display updates
            if (update.type === 'full') {
                this.lastContent = update.payload;
            }
            
            this.adapter.log.debug(`Published ${update.type} update to ${topic}`);
        } catch (error) {
            this.adapter.log.error(`Failed to publish ${update.type} update to ${topic}: ${error.message}`);
        }
    }
    
    /**
     * Check if content is same as last published
     * @param {object} payload - Display payload
     * @returns {boolean}
     */
    isSameContent(payload) {
        if (!this.lastContent || !this.lastContent.lines) {
            return false;
        }
        
        for (let i = 0; i < 14; i++) {
            const lastLine = this.lastContent.lines[i];
            const newLine = payload.lines[i];
            
            if (lastLine.text !== newLine.text || lastLine.color !== newLine.color) {
                return false;
            }
            // Compare segments if present
            const lastSeg = JSON.stringify(lastLine.segments || null);
            const newSeg = JSON.stringify(newLine.segments || null);
            if (lastSeg !== newSeg) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Pad or truncate text to exact length
     * @param {string} text - Input text
     * @param {number} length - Target length
     * @returns {string}
     */
    padOrTruncate(text, length) {
        if (text.length > length) {
            return text.substring(0, length);
        }
        return text.padEnd(length, ' ');
    }
    
    /**
     * Validate color name
     * @param {string} color - Color name
     * @returns {string}
     */
    validateColor(color) {
        const validColors = ['white', 'amber', 'cyan', 'green', 'magenta', 'red', 'yellow', 'grey', 'blue'];
        return validColors.includes(color) ? color : 'white';
    }
    
    /**
     * Sleep for specified milliseconds
     * @param {number} ms - Milliseconds
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get queue size
     * @returns {number}
     */
    getQueueSize() {
        return this.queue.length;
    }
    
    /**
     * Clear queue
     */
    clearQueue() {
        this.queue = [];
        this.adapter.log.debug('Queue cleared');
    }
}

module.exports = DisplayPublisher;
