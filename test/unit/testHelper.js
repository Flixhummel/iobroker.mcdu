'use strict';

/**
 * Test helper - mock adapter and display publisher for unit tests
 */

function createMockAdapter(config = {}) {
    const states = {};
    const foreignStates = {};

    return {
        config: {
            display: { columns: 24, rows: 14, defaultColor: 'white' },
            pages: config.pages || [],
            mqtt: { topicPrefix: 'mcdu' },
            debug: {},
            performance: {},
            ...config,
        },
        namespace: 'mcdu.0',
        log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
        },
        setStateAsync: async (id, val, ack) => {
            states[id] = { val, ack };
        },
        getStateAsync: async (id) => {
            return states[id] || null;
        },
        setForeignStateAsync: async (id, val) => {
            foreignStates[id] = { val, ack: false };
        },
        getForeignStateAsync: async (id) => {
            return foreignStates[id] || null;
        },
        renderCurrentPage: async () => {},
        switchToPage: async () => {},
        navigateHome: async () => {},
        executeButtonAction: async () => {},
        subscribeForeignStates: () => {},
        subscribeStates: () => {},
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        setInterval: (cb, ms) => setInterval(cb, ms),
        clearTimeout: (id) => clearTimeout(id),
        clearInterval: (id) => clearInterval(id),
        // Test helpers
        _states: states,
        _foreignStates: foreignStates,
        _setForeignState: (id, val, q) => {
            foreignStates[id] = { val, ack: true, q: q || 0x00 };
        },
    };
}

function createMockDisplayPublisher() {
    const published = [];
    const publishedLines = [];

    return {
        publishFullDisplay: async (lines) => {
            published.push(lines);
        },
        publishLine: async (lineNum, text, color) => {
            publishedLines.push({ lineNum, text, color });
        },
        lastContent: null,
        deviceId: 'test-device',
        setDevice: () => {},
        // Test helpers
        _published: published,
        _publishedLines: publishedLines,
    };
}

function createMockMqttClient() {
    const subscriptions = [];
    const published = [];

    return {
        subscribe: async (topic, handler) => {
            subscriptions.push({ topic, handler });
        },
        publish: (topic, payload, opts) => {
            published.push({ topic, payload, opts });
        },
        connected: true,
        _subscriptions: subscriptions,
        _published: published,
    };
}

module.exports = {
    createMockAdapter,
    createMockDisplayPublisher,
    createMockMqttClient,
};
