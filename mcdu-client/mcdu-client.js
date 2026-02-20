#!/usr/bin/env node
/**
 * MCDU MQTT Client - Phase 3a
 * 
 * Hardware bridge between WINWING MCDU-32-CAPTAIN and MQTT broker.
 * Optimized for Raspberry Pi 1 Model B Rev 2 (ARMv6, 512MB RAM).
 * 
 * Contract: See ../PHASE3A-SPEC.md for MQTT topics and message formats.
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// Import hardware driver (from Phase 2)
const { MCDU } = require('./lib/mcdu');

// Import button mapping (from Phase 2.5)
const BUTTON_MAP = require('./lib/button-map.json');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // MQTT Broker
  mqtt: {
    broker: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clientId: process.env.MQTT_CLIENT_ID || `mcdu-client-${require('os').hostname()}`,
    keepalive: parseInt(process.env.MQTT_KEEPALIVE) || 60,
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'mcdu'
  },
  
  // Hardware
  hardware: {
    vendorId: parseInt(process.env.MCDU_VENDOR_ID || '0x4098'),
    productId: parseInt(process.env.MCDU_PRODUCT_ID || '0xbb36')
  },
  
  // Performance (Pi 1 optimizations)
  performance: {
    buttonPollRate: parseInt(process.env.BUTTON_POLL_RATE) || 50,      // Hz
    displayThrottle: parseInt(process.env.DISPLAY_THROTTLE) || 100,    // ms
    ledThrottle: parseInt(process.env.LED_THROTTLE) || 50              // ms
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',      // debug|info|warn|error
    logButtons: process.env.LOG_BUTTONS === 'true'
  },
  
  // Mock mode (for testing without hardware)
  mockMode: process.env.MOCK_MODE === 'true'
};

// ============================================================================
// LOGGING
// ============================================================================

const LOG_LEVELS = {debug: 0, info: 1, warn: 2, error: 3};
const currentLevel = LOG_LEVELS[CONFIG.logging.level] || LOG_LEVELS.info;

const log = {
  debug: (...args) => currentLevel <= LOG_LEVELS.debug && console.log('[DEBUG]', new Date().toISOString(), ...args),
  info: (...args) => currentLevel <= LOG_LEVELS.info && console.log('[INFO]', new Date().toISOString(), ...args),
  warn: (...args) => currentLevel <= LOG_LEVELS.warn && console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => console.error('[ERROR]', new Date().toISOString(), ...args)
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

// Display cache (14 lines × 24 chars)
const displayCache = {
  lines: Array(14).fill(null).map(() => ({
    text: '                        ', // 24 spaces
    color: 'white'
  })),
  lastUpdate: 0
};

// LED cache (11 LEDs)
const ledCache = {
  FAIL: false,
  FM: false,
  MCDU: false,
  MENU: false,
  FM1: false,
  IND: false,
  RDY: false,
  STATUS: false,
  FM2: false,
  BACKLIGHT: true,      // Default on
  SCREEN_BACKLIGHT: true // Default on
};

// Statistics
const stats = {
  startTime: Date.now(),
  buttonsSent: 0,
  displaysRendered: 0,
  mqttMessagesReceived: 0,
  errors: 0
};

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Pad or truncate text to exactly 24 characters
 */
function padOrTruncate(text, length = 24) {
  if (!text) return ' '.repeat(length);
  if (text.length > length) return text.substring(0, length);
  return text.padEnd(length, ' ');
}

/**
 * Validate color name
 */
function validateColor(color) {
  const validColors = ['white', 'amber', 'cyan', 'green', 'magenta', 'red', 'yellow', 'grey'];
  return validColors.includes(color) ? color : 'white';
}

/**
 * Build MQTT topic with prefix and deviceId
 * Format: mcdu/{deviceId}/{suffix}
 */
function topic(suffix) {
  return `${CONFIG.mqtt.topicPrefix}/${CONFIG.mqtt.clientId}/${suffix}`;
}

// ============================================================================
// MQTT CLIENT
// ============================================================================

let mqttClient = null;

function connectMQTT() {
  log.info('Connecting to MQTT broker:', CONFIG.mqtt.broker);
  
  const options = {
    clientId: CONFIG.mqtt.clientId,
    keepalive: CONFIG.mqtt.keepalive,
    clean: true,
    will: {
      topic: topic('status/online'),
      payload: JSON.stringify({status: 'offline', timestamp: Date.now()}),
      qos: 1,
      retain: true
    }
  };
  
  // Add credentials if provided
  if (CONFIG.mqtt.username) {
    options.username = CONFIG.mqtt.username;
    options.password = CONFIG.mqtt.password;
  }
  
  mqttClient = mqtt.connect(CONFIG.mqtt.broker, options);
  
  mqttClient.on('connect', () => {
    log.info('MQTT connected');
    
    // Publish online status
    mqttClient.publish(topic('status/online'), JSON.stringify({
      status: 'online',
      hostname: require('os').hostname(),
      clientId: CONFIG.mqtt.clientId,
      version: '1.0.0',
      mockMode: CONFIG.mockMode,
      timestamp: Date.now()
    }), {qos: 1, retain: true});
    
    // Announce device to adapter (Phase 1: Device Registration)
    const deviceAnnouncement = {
      deviceId: CONFIG.mqtt.clientId,
      hostname: require('os').hostname(),
      ipAddress: getLocalIPAddress(),
      version: '1.0.0',
      timestamp: Date.now()
    };
    
    mqttClient.publish(topic('status/announce'), JSON.stringify(deviceAnnouncement), {qos: 1});
    log.info('📡 Device announced:', deviceAnnouncement.deviceId);
    
    // Subscribe to command topics
    const topics = [
      topic('display/set'),
      topic('display/line'),
      topic('display/clear'),
      topic('leds/set'),
      topic('leds/single'),
      topic('status/ping')
    ];
    
    mqttClient.subscribe(topics, {qos: 1}, (err) => {
      if (err) {
        log.error('Subscribe failed:', err);
      } else {
        log.info('Subscribed to topics:', topics);
      }
    });
  });
  
  mqttClient.on('message', handleMQTTMessage);
  
  mqttClient.on('error', (err) => {
    log.error('MQTT error:', err.message);
  });
  
  mqttClient.on('offline', () => {
    log.warn('MQTT offline, will auto-reconnect...');
  });
  
  mqttClient.on('reconnect', () => {
    log.info('MQTT reconnecting...');
  });
}

// ============================================================================
// MQTT MESSAGE HANDLERS
// ============================================================================

function handleMQTTMessage(topicStr, message) {
  stats.mqttMessagesReceived++;
  
  // Parse JSON
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (e) {
    log.error('Invalid JSON on', topicStr, ':', message.toString());
    return;
  }
  
  // Route to handler
  // Topic format: mcdu/{deviceId}/{command}
  // Extract command part (everything after deviceId)
  const parts = topicStr.split('/');
  const suffix = parts.slice(2).join('/'); // Skip prefix and deviceId
  
  switch (suffix) {
    case 'display/set':
      handleDisplaySet(data);
      break;
    case 'display/line':
      handleDisplayLine(data);
      break;
    case 'display/clear':
      handleDisplayClear(data);
      break;
    case 'leds/set':
      handleLEDsSet(data);
      break;
    case 'leds/single':
      handleLEDSingle(data);
      break;
    case 'status/ping':
      handleStatusPing(data);
      break;
    default:
      log.warn('Unknown topic:', topicStr);
  }
}

/**
 * Handle mcdu/display/set - full display update (14 lines)
 */
function handleDisplaySet(data) {
  // Validate
  if (!Array.isArray(data.lines) || data.lines.length !== 14) {
    log.error('Invalid display/set: lines must be array of 14');
    return;
  }
  
  log.info('Display set received:', data.lines.length, 'lines, line0:', (data.lines[0] && data.lines[0].text || '').trim());
  
  // Update cache and set lines
  data.lines.forEach((line, i) => {
    const text = padOrTruncate(line.text, 24);
    const color = validateColor(line.color);
    
    displayCache.lines[i] = {text, color};
    
    if (!CONFIG.mockMode) {
      mcdu.setLine(i, text, color);
    }
  });
  
  // Render (throttled)
  updateDisplay();
}

/**
 * Handle mcdu/display/line - single line update
 * Supports both simple (text + color) and segments (array of {text, color})
 */
function handleDisplayLine(data) {
  // Validate
  if (data.lineNumber < 1 || data.lineNumber > 14) {
    log.error('Invalid lineNumber:', data.lineNumber);
    return;
  }
  
  const idx = data.lineNumber - 1;
  
  // Check if segments mode (multi-color per line)
  if (data.segments && Array.isArray(data.segments)) {
    log.debug('Display line (segments):', data.lineNumber, data.segments.length, 'segments');
    
    // Validate segments
    const validSegments = data.segments.map(seg => ({
      text: seg.text || '',
      color: validateColor(seg.color)
    }));
    
    // Cache as segments (for display state tracking)
    displayCache.lines[idx] = {segments: validSegments};
    
    if (!CONFIG.mockMode) {
      mcdu.setLine(idx, validSegments);
    }
  } else {
    // Simple mode: single color for entire line (backward compatible)
    log.debug('Display line:', data.lineNumber, data.text);
    
    const text = padOrTruncate(data.text, 24);
    const color = validateColor(data.color);
    
    displayCache.lines[idx] = {text, color};
    
    if (!CONFIG.mockMode) {
      mcdu.setLine(idx, text, color);
    }
  }
  
  // Render (throttled)
  updateDisplay();
}

/**
 * Handle mcdu/display/clear - clear all lines
 */
function handleDisplayClear(data) {
  log.debug('Display clear');
  
  // Reset cache
  displayCache.lines.forEach((line, i) => {
    displayCache.lines[i] = {
      text: '                        ',
      color: 'white'
    };
  });
  
  if (!CONFIG.mockMode) {
    mcdu.clear();
  }
  
  stats.displaysRendered++;
}

/**
 * Handle mcdu/leds/set - set all LEDs
 */
function handleLEDsSet(data) {
  // Debug: log raw received data
  console.log('[DEBUG] handleLEDsSet received:', JSON.stringify(data));
  
  // Validate
  if (!data.leds || typeof data.leds !== 'object') {
    log.error('Invalid leds/set: leds must be an object, received:', JSON.stringify(data));
    return;
  }
  
  log.debug('LEDs set:', data.leds);
  
  // Update cache (merge with existing state)
  // Supports both boolean (true/false) and numeric (0-255) values
  Object.keys(data.leds).forEach(led => {
    if (ledCache.hasOwnProperty(led)) {
      const value = data.leds[led];
      if (typeof value === 'boolean') {
        ledCache[led] = value;
      } else if (typeof value === 'number') {
        ledCache[led] = Math.max(0, Math.min(255, value));
      } else {
        ledCache[led] = false;
      }
    } else {
      log.warn('Unknown LED:', led);
    }
  });
  
  // Send to hardware (throttled)
  updateLEDs();
}

/**
 * Handle mcdu/leds/single - set single LED
 */
function handleLEDSingle(data) {
  // Debug: log raw received data
  console.log('[DEBUG] handleLEDSingle received:', JSON.stringify(data));
  
  // Validate
  if (!data.name || !ledCache.hasOwnProperty(data.name)) {
    log.warn('Unknown LED:', data.name, 'received:', JSON.stringify(data));
    return;
  }
  
  // Support both state (boolean) and brightness (0-255)
  let value;
  if (data.brightness !== undefined) {
    // Brightness mode: numeric 0-255
    value = Math.max(0, Math.min(255, parseInt(data.brightness)));
    log.debug('LED single (brightness):', data.name, value);
  } else if (data.state !== undefined) {
    // State mode: boolean true/false
    value = !!data.state;
    log.debug('LED single (state):', data.name, value);
  } else {
    log.warn('LED single missing state or brightness');
    return;
  }
  
  // Update cache
  ledCache[data.name] = value;
  
  // Send to hardware (throttled)
  updateLEDs();
}

/**
 * Handle mcdu/status/ping - health check
 */
function handleStatusPing(data) {
  log.debug('Status ping:', data.requestId);
  
  // Respond with pong
  mqttClient.publish(topic('status/pong'), JSON.stringify({
    requestId: data.requestId,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    buttonsSent: stats.buttonsSent,
    displaysRendered: stats.displaysRendered,
    mqttMessagesReceived: stats.mqttMessagesReceived,
    errors: stats.errors,
    timestamp: Date.now()
  }), {qos: 0});
}

// ============================================================================
// HARDWARE UPDATES (THROTTLED)
// ============================================================================

/**
 * Update display (throttled to 100ms)
 */
function updateDisplay() {
  const now = Date.now();
  if (now - displayCache.lastUpdate < CONFIG.performance.displayThrottle) {
    log.debug('Display throttled');
    return;
  }
  
  if (!CONFIG.mockMode) {
    mcdu.updateDisplay();
  }
  
  displayCache.lastUpdate = now;
  stats.displaysRendered++;
  
  log.info('Display rendered (writes:', stats.displaysRendered, ')');
}

let lastLEDUpdate = 0;

/**
 * Update LEDs (throttled to 50ms)
 */
function updateLEDs() {
  console.log('[DEBUG] updateLEDs called, ledCache:', JSON.stringify(ledCache));
  
  const now = Date.now();
  if (now - lastLEDUpdate < CONFIG.performance.ledThrottle) {
    log.debug('LED throttled');
    return;
  }
  
  console.log('[DEBUG] Calling mcdu.setAllLEDs with:', JSON.stringify(ledCache));
  
  if (!CONFIG.mockMode) {
    mcdu.setAllLEDs(ledCache);
  }
  
  lastLEDUpdate = now;
  
  log.debug('LEDs updated');
  console.log('[DEBUG] LEDs sent to hardware');
}

// ============================================================================
// HARDWARE (MCDU DRIVER)
// ============================================================================

let mcdu = null;

function connectMCDU() {
  if (CONFIG.mockMode) {
    log.info('MOCK MODE: Skipping MCDU hardware connection');
    startMockButtonEvents();
    return;
  }
  
  log.info('Connecting to MCDU hardware...');
  
  try {
    mcdu = new MCDU();
    mcdu.connect();
    
    log.info('MCDU device connected (VID:', CONFIG.hardware.vendorId.toString(16), 'PID:', CONFIG.hardware.productId.toString(16) + ')');
    
    // Initialize display — send init packets (0xf0).
    // Do NOT call clear() here — the firmware only accepts one full display write
    // per connection. We save that write for the first MQTT display/set message,
    // which will naturally replace the WinWing boot logo.
    mcdu.initDisplay();
    log.info('Display initialized (14 lines x 24 chars)');

    // Set initial LEDs (backlights on, others off) — LED packets (0x02) work immediately
    mcdu.setAllLEDs(ledCache);
    log.info('LEDs initialized');

    // Delay button reading by 3s to allow the first display/set message to render
    // without USB bandwidth contention from the HID read loop.
    setTimeout(function() {
      mcdu.startButtonReading((buttonCodes) => {
        for (const code of buttonCodes) {
          const buttonName = getButtonName(code);
          if (buttonName) {
            handleButtonEvent(buttonName, 'press');
          }
        }
      }, CONFIG.performance.buttonPollRate);
      log.info('Button reading started (' + CONFIG.performance.buttonPollRate + 'Hz)');
    }, 3000);
    
  } catch (err) {
    log.error('Failed to connect to MCDU:', err.message);
    publishError('Failed to connect to MCDU', 'DEVICE_NOT_FOUND', err);
    
    // Retry in 5 seconds
    setTimeout(connectMCDU, 5000);
  }
}

/**
 * Reverse button map (code → name)
 */
const BUTTON_CODE_TO_NAME = {};
for (const [name, code] of Object.entries(BUTTON_MAP)) {
  BUTTON_CODE_TO_NAME[code] = name;
}

/**
 * Get button name from code
 * @param {number} code - Button code
 * @returns {string|null} - Button name or null
 */
function getButtonName(code) {
  return BUTTON_CODE_TO_NAME[code] || null;
}

/**
 * Handle button press/release events from hardware
 */
function handleButtonEvent(button, action) {
  if (CONFIG.logging.logButtons) {
    log.debug('Button:', button, action);
  }
  
  // Publish to MQTT
  mqttClient.publish(topic('buttons/event'), JSON.stringify({
    button,
    action,
    timestamp: Date.now()
  }), {qos: 1});
  
  stats.buttonsSent++;
}

/**
 * Mock button events (for testing without hardware)
 */
function startMockButtonEvents() {
  log.info('Starting mock button events (every 5 seconds)');
  
  const mockButtons = ['LSK1L', 'LSK1R', 'DIR', 'PROG', 'A', 'B', '1', '2'];
  let idx = 0;
  
  setInterval(() => {
    const button = mockButtons[idx % mockButtons.length];
    handleButtonEvent(button, 'press');
    setTimeout(() => handleButtonEvent(button, 'release'), 100);
    idx++;
  }, 5000);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get local IP address
 * @returns {string} IP address or 'unknown'
 */
function getLocalIPAddress() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'unknown';
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Publish error to MQTT
 */
function publishError(message, code, err) {
  stats.errors++;
  
  mqttClient.publish(topic('status/error'), JSON.stringify({
    error: message,
    code: code || 'UNKNOWN',
    stack: err ? err.stack : undefined,
    timestamp: Date.now()
  }), {qos: 1});
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  
  log.info('Shutting down...');
  
  // CRITICAL: Stop button reading FIRST to clean up the node-hid read thread.
  // If the process exits with an active data listener, node-hid's read thread
  // can corrupt the USB endpoint state, making the display unresponsive on next open.
  if (!CONFIG.mockMode && mcdu) {
    try {
      mcdu.stopButtonReading();
      log.info('Button reading stopped');

      // Turn off LEDs — do NOT send display data (0xf2) before exit.
      mcdu.setAllLEDs({
        FAIL: false,
        FM: false,
        MCDU: false,
        MENU: false,
        FM1: false,
        IND: false,
        RDY: false,
        STATUS: false,
        FM2: false,
        BACKLIGHT: true,
        SCREEN_BACKLIGHT: true
      });
    } catch (err) {
      log.error('Error during shutdown cleanup:', err.message);
    }
  }
  
  // Publish offline status
  if (mqttClient) {
    mqttClient.publish(topic('status/online'), JSON.stringify({
      status: 'offline',
      timestamp: Date.now()
    }), {qos: 1, retain: true}, () => {
      mqttClient.end(false, () => {
        log.info('MQTT disconnected');
        process.exit(0);
      });
    });
    
    // Force exit after 2 seconds if MQTT doesn't disconnect
    setTimeout(() => {
      log.warn('Forced exit after timeout');
      process.exit(1);
    }, 2000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err);
  publishError('Uncaught exception', 'UNCAUGHT_EXCEPTION', err);
  shutdown();
});

// ============================================================================
// MAIN
// ============================================================================

function main() {
  log.info('=== MCDU MQTT Client v1.0.0 ===');
  log.info('Platform:', require('os').platform(), require('os').arch());
  log.info('Node.js:', process.version);
  log.info('Hostname:', require('os').hostname());
  log.info('Mock mode:', CONFIG.mockMode);
  log.info('===============================');
  
  // Connect to MQTT broker
  connectMQTT();
  
  // Connect to MCDU hardware
  connectMCDU();
  
  log.info('Startup complete');
}

// Start
main();
