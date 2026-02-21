'use strict';

const { expect } = require('chai');
const ButtonSubscriber = require('../../lib/mqtt/ButtonSubscriber');
const { createMockAdapter, createMockMqttClient } = require('./testHelper');

describe('ButtonSubscriber', () => {
    let adapter;
    let mqttClient;
    let subscriber;

    beforeEach(() => {
        adapter = createMockAdapter({
            pages: [
                {
                    id: 'home-main',
                    name: 'Home',
                    lines: [
                        {
                            row: 3,
                            left: {
                                label: '',
                                display: { type: 'label', text: 'LIGHTS' },
                                button: { type: 'navigation', action: 'goto', target: 'lights-main' }
                            },
                            right: {
                                label: '',
                                display: { type: 'empty' },
                                button: { type: 'empty' }
                            }
                        },
                        {
                            row: 5,
                            left: {
                                label: '',
                                display: { type: 'label', text: 'CLIMATE' },
                                button: { type: 'empty' }
                            },
                            right: {
                                label: '',
                                display: { type: 'empty' },
                                button: { type: 'navigation', action: 'goto', target: 'climate-main' }
                            }
                        }
                    ]
                },
                {
                    id: 'old-format-page',
                    name: 'Old Format',
                    lines: [
                        {
                            row: 3,
                            leftButton: { type: 'navigation', action: 'goto', target: 'lights-main' },
                            display: { type: 'label', label: 'LIGHTS' },
                            rightButton: { type: 'empty' }
                        }
                    ]
                },
                { id: 'lights-main', name: 'Lights', lines: [] },
                { id: 'climate-main', name: 'Climate', lines: [] },
                { id: 'status-main', name: 'Status', lines: [] },
                { id: 'scenes-main', name: 'Scenes', lines: [] }
            ]
        });
        mqttClient = createMockMqttClient();
        subscriber = new ButtonSubscriber(adapter, mqttClient);
    });

    describe('Button Row Mapping', () => {
        it('should map LSK1L to row 3', () => {
            expect(subscriber.buttonRowMap.get('LSK1L')).to.equal(3);
        });

        it('should map LSK1R to row 3', () => {
            expect(subscriber.buttonRowMap.get('LSK1R')).to.equal(3);
        });

        it('should map LSK6L to row 13', () => {
            expect(subscriber.buttonRowMap.get('LSK6L')).to.equal(13);
        });

        it('should map all 12 LSK buttons', () => {
            expect(subscriber.buttonRowMap.size).to.equal(12);
        });

        it('should follow LSK-to-odd-row formula', () => {
            for (let i = 1; i <= 6; i++) {
                const expectedRow = (i * 2) + 1;
                expect(subscriber.buttonRowMap.get(`LSK${i}L`)).to.equal(expectedRow);
                expect(subscriber.buttonRowMap.get(`LSK${i}R`)).to.equal(expectedRow);
            }
        });
    });

    describe('getButtonConfig', () => {
        it('should get left button from new format', () => {
            const lineConfig = {
                row: 1,
                left: { button: { type: 'navigation', action: 'goto', target: 'test' } },
                right: { button: { type: 'empty' } }
            };
            const result = subscriber.getButtonConfig(lineConfig, 'left');
            expect(result.type).to.equal('navigation');
            expect(result.target).to.equal('test');
        });

        it('should get right button from new format', () => {
            const lineConfig = {
                row: 1,
                left: { button: { type: 'empty' } },
                right: { button: { type: 'datapoint', action: 'toggle', target: 'state.0' } }
            };
            const result = subscriber.getButtonConfig(lineConfig, 'right');
            expect(result.type).to.equal('datapoint');
        });

        it('should get left button from old format', () => {
            const lineConfig = {
                row: 1,
                leftButton: { type: 'navigation', action: 'goto', target: 'old-target' },
                rightButton: { type: 'empty' }
            };
            const result = subscriber.getButtonConfig(lineConfig, 'left');
            expect(result.type).to.equal('navigation');
            expect(result.target).to.equal('old-target');
        });

        it('should get right button from old format', () => {
            const lineConfig = {
                row: 1,
                leftButton: { type: 'empty' },
                rightButton: { type: 'datapoint', action: 'toggle', target: 'old-state' }
            };
            const result = subscriber.getButtonConfig(lineConfig, 'right');
            expect(result.type).to.equal('datapoint');
        });
    });

    describe('Keypad Mapping', () => {
        it('should map numeric keys 0-9', () => {
            for (let i = 0; i <= 9; i++) {
                expect(subscriber.keypadMap.get(`KEY_${i}`)).to.equal(String(i));
            }
        });

        it('should map alphabetic keys', () => {
            expect(subscriber.keypadMap.get('KEY_A')).to.equal('A');
            expect(subscriber.keypadMap.get('KEY_Z')).to.equal('Z');
        });

        it('should map special characters', () => {
            expect(subscriber.keypadMap.get('KEY_DOT')).to.equal('.');
            expect(subscriber.keypadMap.get('KEY_SLASH')).to.equal('/');
            expect(subscriber.keypadMap.get('KEY_SPACE')).to.equal(' ');
        });
    });

    describe('Function Key Detection', () => {
        it('should recognize MENU as function key', () => {
            expect(subscriber.isFunctionKey('MENU')).to.be.true;
        });

        it('should recognize INIT as function key', () => {
            expect(subscriber.isFunctionKey('INIT')).to.be.true;
        });

        it('should recognize DIR as function key', () => {
            expect(subscriber.isFunctionKey('DIR')).to.be.true;
        });

        it('should recognize PREV_PAGE and NEXT_PAGE', () => {
            expect(subscriber.isFunctionKey('PREV_PAGE')).to.be.true;
            expect(subscriber.isFunctionKey('NEXT_PAGE')).to.be.true;
        });

        it('should recognize FPLN and PERF', () => {
            expect(subscriber.isFunctionKey('FPLN')).to.be.true;
            expect(subscriber.isFunctionKey('PERF')).to.be.true;
        });

        it('should not recognize LSK as function key', () => {
            expect(subscriber.isFunctionKey('LSK1L')).to.be.false;
        });

        it('should not recognize CLR as function key', () => {
            expect(subscriber.isFunctionKey('CLR')).to.be.false;
        });

        it('should not recognize OVFY as function key', () => {
            expect(subscriber.isFunctionKey('OVFY')).to.be.false;
        });
    });

    describe('handleFunctionKey', () => {
        it('should call navigateHome on MENU when configured', async () => {
            adapter.config.functionKeys = [
                { key: 'MENU', enabled: true, action: 'navigateHome', targetPageId: '' }
            ];
            let called = false;
            adapter.navigateHome = async () => { called = true; };

            await subscriber.handleFunctionKey('MENU');
            expect(called).to.be.true;
        });

        it('should navigate to configured target page on INIT', async () => {
            adapter.config.functionKeys = [
                { key: 'INIT', enabled: true, action: 'gotoPage', targetPageId: 'status-main' }
            ];
            let switchedTo = null;
            adapter.switchToPage = async (id) => { switchedTo = id; };

            await subscriber.handleFunctionKey('INIT');
            expect(switchedTo).to.equal('status-main');
        });

        it('should not navigate when key is disabled', async () => {
            adapter.config.functionKeys = [
                { key: 'FUEL', enabled: false, action: 'gotoPage', targetPageId: 'energie-main' }
            ];
            let switchedTo = null;
            adapter.switchToPage = async (id) => { switchedTo = id; };

            await subscriber.handleFunctionKey('FUEL');
            expect(switchedTo).to.equal(null);
        });

        it('should handle missing functionKeys config gracefully', async () => {
            adapter.config.functionKeys = undefined;
            // Should not throw
            await subscriber.handleFunctionKey('FUEL');
        });

        it('should still handle PREV_PAGE for pagination', async () => {
            adapter.pageRenderer = { currentPageOffset: 1, totalPages: 3 };
            let rendered = false;
            adapter.renderCurrentPage = async () => { rendered = true; };

            await subscriber.handleFunctionKey('PREV_PAGE');
            expect(rendered).to.be.true;
            expect(adapter.pageRenderer.currentPageOffset).to.equal(0);
        });

        it('should still handle NEXT_PAGE for pagination', async () => {
            adapter.pageRenderer = { currentPageOffset: 0, totalPages: 3 };
            let rendered = false;
            adapter.renderCurrentPage = async () => { rendered = true; };

            await subscriber.handleFunctionKey('NEXT_PAGE');
            expect(rendered).to.be.true;
            expect(adapter.pageRenderer.currentPageOffset).to.equal(1);
        });

        it('should handle directAccess action with scratchpad content', async () => {
            adapter.config.functionKeys = [
                { key: 'DIR', enabled: true, action: 'directAccess', targetPageId: '' }
            ];
            let switchedTo = null;
            adapter.switchToPage = async (id) => { switchedTo = id; };

            let cleared = false;
            const inputModeManager = {
                getMode: () => 'normal',
                setState: async () => {},
                getScratchpad: () => ({
                    getContent: () => 'lights-main',
                    clear: () => { cleared = true; },
                    renderError: async () => {}
                })
            };
            subscriber.setInputModeManager(inputModeManager);

            await subscriber.handleFunctionKey('DIR');
            expect(switchedTo).to.equal('lights-main');
            expect(cleared).to.be.true;
        });
    });

    describe('handleButtonEvent', () => {
        it('should ignore release events', async () => {
            let actionCalled = false;
            adapter.switchToPage = async () => { actionCalled = true; };

            const topic = 'mcdu/test-device/buttons/event';
            const message = Buffer.from(JSON.stringify({
                button: 'MENU',
                action: 'release',
                timestamp: Date.now()
            }));

            await subscriber.handleButtonEvent(topic, message);
            expect(actionCalled).to.be.false;
        });

        it('should extract deviceId from topic', async () => {
            adapter.config.functionKeys = [
                { key: 'MENU', enabled: true, action: 'navigateHome', targetPageId: '' }
            ];
            const topic = 'mcdu/my-device-123/buttons/event';
            const message = Buffer.from(JSON.stringify({
                button: 'MENU',
                action: 'press',
                timestamp: Date.now()
            }));

            let homeCalled = false;
            adapter.navigateHome = async () => { homeCalled = true; };

            await subscriber.handleButtonEvent(topic, message);
            expect(homeCalled).to.be.true;
        });

        it('should debounce rapid presses', async () => {
            let callCount = 0;
            adapter.navigateHome = async () => { callCount++; };

            const topic = 'mcdu/test-device/buttons/event';
            const msg = () => Buffer.from(JSON.stringify({
                button: 'MENU',
                action: 'press',
                timestamp: Date.now()
            }));

            subscriber.lastButtonPress = Date.now(); // simulate recent press

            await subscriber.handleButtonEvent(topic, msg());
            expect(callCount).to.equal(0); // debounced
        });
    });

    describe('Subscribe', () => {
        it('should subscribe to button events and keypad events', async () => {
            await subscriber.subscribe();

            expect(mqttClient._subscriptions).to.have.length(2);
            expect(mqttClient._subscriptions[0].topic).to.equal('+/buttons/event');
            expect(mqttClient._subscriptions[1].topic).to.equal('+/buttons/keypad');
        });
    });

    describe('Edit Mode Clearing', () => {
        it('should clear edit mode on function keys except PREV/NEXT PAGE', async () => {
            adapter.config.functionKeys = [
                { key: 'MENU', enabled: true, action: 'navigateHome', targetPageId: '' }
            ];
            const inputModeManager = {
                getMode: () => 'edit',
                setState: async () => {},
                getScratchpad: () => ({ getContent: () => '', clear: () => {} })
            };
            subscriber.setInputModeManager(inputModeManager);

            let modeSet = null;
            inputModeManager.setState = async (mode) => { modeSet = mode; };

            adapter.navigateHome = async () => {};
            await subscriber.handleFunctionKey('MENU');
            expect(modeSet).to.equal('normal');
        });

        it('should NOT clear edit mode on PREV_PAGE', async () => {
            const inputModeManager = {
                getMode: () => 'edit',
                setState: async () => {},
                getScratchpad: () => ({ getContent: () => '', clear: () => {} })
            };
            subscriber.setInputModeManager(inputModeManager);

            let modeSet = null;
            inputModeManager.setState = async (mode) => { modeSet = mode; };

            adapter.pageRenderer = { currentPageOffset: 0, totalPages: 1 };
            adapter.renderCurrentPage = async () => {};
            adapter.navigatePrevious = async () => {};

            await subscriber.handleFunctionKey('PREV_PAGE');
            expect(modeSet).to.be.null; // not called
        });
    });
});
