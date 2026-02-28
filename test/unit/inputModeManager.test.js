'use strict';

const { expect } = require('chai');
const InputModeManager = require('../../lib/input/InputModeManager');
const ScratchpadManager = require('../../lib/input/ScratchpadManager');
const { createMockAdapter, createMockDisplayPublisher } = require('./testHelper');

describe('InputModeManager', () => {
    let adapter, displayPublisher, scratchpad, inputManager;

    beforeEach(() => {
        adapter = createMockAdapter({
            pages: [
                {
                    id: 'test-page',
                    name: 'Test',
                    lines: [
                        {
                            row: 3,
                            left: {
                                label: 'TEMP',
                                display: { type: 'datapoint', source: 'test.temperature', format: '%.1f', unit: '°C' },
                                button: { type: 'empty' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 5,
                            left: {
                                label: 'LICHT',
                                display: { type: 'datapoint', source: 'test.light', format: '%s' },
                                button: { type: 'empty' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 7,
                            left: {
                                label: 'KLIMA',
                                display: { type: 'label', text: 'KLIMA' },
                                button: { type: 'navigation', action: 'goto', target: 'klima-page' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 9,
                            left: {
                                label: 'SENSOR',
                                display: { type: 'datapoint', source: 'test.sensor' },
                                button: { type: 'empty' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 11,
                            left: {
                                label: 'STATUS',
                                display: { type: 'datapoint', source: 'test.status' },
                                button: { type: 'empty' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                }
            ]
        });

        // Set up datapoint metadata cache
        adapter.datapointMeta = new Map();
        adapter.datapointMeta.set('test.temperature', {
            write: true, type: 'number', min: 5, max: 30, unit: '°C', states: undefined
        });
        adapter.datapointMeta.set('test.light', {
            write: true, type: 'boolean', min: undefined, max: undefined, unit: '', states: undefined
        });
        adapter.datapointMeta.set('test.sensor', {
            write: false, type: 'number', min: undefined, max: undefined, unit: '°C', states: undefined
        });
        adapter.datapointMeta.set('test.status', {
            write: true, type: 'string', min: undefined, max: undefined, unit: '', states: undefined
        });

        // Set foreign state defaults
        adapter._setForeignState('test.temperature', 21.5);
        adapter._setForeignState('test.light', true);
        adapter._setForeignState('test.sensor', 19.8);
        adapter._setForeignState('test.status', 'OK');

        // Set current page
        adapter._states['runtime.currentPage'] = { val: 'test-page' };

        displayPublisher = createMockDisplayPublisher();
        scratchpad = new ScratchpadManager(adapter, displayPublisher);
        inputManager = new InputModeManager(adapter, scratchpad);
    });

    describe('Mode Management', () => {
        it('should start in normal mode', () => {
            expect(inputManager.getMode()).to.equal('normal');
        });

        it('should transition to input mode on first key press', async () => {
            await inputManager.handleKeyInput('2');
            expect(inputManager.getMode()).to.equal('input');
            expect(scratchpad.getContent()).to.equal('2');
        });

        it('should stay in input mode on subsequent key presses', async () => {
            await inputManager.handleKeyInput('2');
            await inputManager.handleKeyInput('1');
            expect(inputManager.getMode()).to.equal('input');
            expect(scratchpad.getContent()).to.equal('21');
        });
    });

    describe('Boolean Toggle (LSK)', () => {
        it('should toggle boolean datapoint on LSK press', async () => {
            // Press LSK on line 5 (boolean light)
            await inputManager.handleLSK('left', 5);

            // Should have toggled from true to false
            expect(adapter._foreignStates['test.light'].val).to.equal(false);
        });

        it('should toggle boolean regardless of scratchpad content', async () => {
            scratchpad.append('1');
            scratchpad.append('2');

            // Even with scratchpad content, boolean should toggle (scratchpad ignored for booleans)
            await inputManager.handleLSK('left', 5);
            expect(adapter._foreignStates['test.light'].val).to.equal(false);
        });
    });

    describe('Number Write from Scratchpad', () => {
        it('should write number from scratchpad to datapoint', async () => {
            // Type "22.5" into scratchpad
            await inputManager.handleKeyInput('2');
            await inputManager.handleKeyInput('2');
            await inputManager.handleKeyInput('.');
            await inputManager.handleKeyInput('5');

            // Press LSK on line 3 (temperature setpoint)
            await inputManager.handleLSK('left', 3);

            // Should have written 22.5
            expect(adapter._foreignStates['test.temperature'].val).to.equal(22.5);
            // Scratchpad should be cleared
            expect(scratchpad.getContent()).to.equal('');
            // Mode should return to normal
            expect(inputManager.getMode()).to.equal('normal');
        });

        it('should show FORMAT ERROR for non-numeric input', async () => {
            scratchpad.set('ABC');

            await inputManager.handleLSK('left', 3);

            // Should show error in scratchpad
            expect(scratchpad.errorShowing).to.be.true;
            expect(scratchpad.getContent()).to.equal('FORMAT ERROR');
            expect(scratchpad.savedContent).to.equal('ABC');
        });

        it('should show ENTRY OUT OF RANGE for value below min', async () => {
            scratchpad.set('2');

            await inputManager.handleLSK('left', 3);

            expect(scratchpad.errorShowing).to.be.true;
            expect(scratchpad.getContent()).to.equal('ENTRY OUT OF RANGE');
            expect(scratchpad.savedContent).to.equal('2');
        });

        it('should show ENTRY OUT OF RANGE for value above max', async () => {
            scratchpad.set('999');

            await inputManager.handleLSK('left', 3);

            expect(scratchpad.errorShowing).to.be.true;
            expect(scratchpad.getContent()).to.equal('ENTRY OUT OF RANGE');
            expect(scratchpad.savedContent).to.equal('999');
        });

        it('should do nothing when scratchpad is empty for number field', async () => {
            await inputManager.handleLSK('left', 3);

            // Temperature should remain unchanged
            expect(adapter._foreignStates['test.temperature'].val).to.equal(21.5);
        });
    });

    describe('String Write from Scratchpad', () => {
        it('should write string from scratchpad to datapoint', async () => {
            scratchpad.set('ALARM');

            await inputManager.handleLSK('left', 11);

            expect(adapter._foreignStates['test.status'].val).to.equal('ALARM');
            expect(scratchpad.getContent()).to.equal('');
            expect(inputManager.getMode()).to.equal('normal');
        });
    });

    describe('Read-Only Datapoints', () => {
        it('should show error on LSK for read-only datapoint', async () => {
            scratchpad.set('99');

            await inputManager.handleLSK('left', 9);

            // Sensor value should remain unchanged
            expect(adapter._foreignStates['test.sensor'].val).to.equal(19.8);
            // Scratchpad should show error message
            expect(scratchpad.getContent()).to.equal('SCHREIBGESCHUETZT');
        });
    });

    describe('Navigation Buttons', () => {
        it('should execute navigation action when button is present', async () => {
            let switchedTo = null;
            adapter.executeButtonAction = async (field) => {
                switchedTo = field.target;
            };

            await inputManager.handleLSK('left', 7);

            expect(switchedTo).to.equal('klima-page');
        });
    });

    describe('Admin UI button.type quirk', () => {
        it('should treat datapoint button with empty target as non-actionable', async () => {
            // Admin UI saves button.type='datapoint' even when only display is datapoint
            adapter.config.pages[0].lines[0].left.button = { type: 'datapoint', target: '' };
            // display is still the datapoint with source
            scratchpad.set('22');

            await inputManager.handleLSK('left', 3);

            // Should use handleDatapointLSK (display takes priority) and write value
            expect(adapter._foreignStates['test.temperature'].val).to.equal(22);
        });

        it('should prefer datapoint display over stale datapoint button target', async () => {
            // Admin UI leaves old button target when display source is changed
            adapter.config.pages[0].lines[0].left.button = { type: 'datapoint', target: 'old.stale.state' };
            // display correctly points to temperature
            scratchpad.set('25');

            await inputManager.handleLSK('left', 3);

            // Should use metadata-driven path (display), not the stale button target
            expect(adapter._foreignStates['test.temperature'].val).to.equal(25);
        });

        it('should treat navigation button with empty target as non-actionable', () => {
            const result = inputManager.isActionableButton({ type: 'navigation', target: '' });
            expect(result).to.be.false;
        });

        it('should treat button with valid target as actionable', () => {
            const result = inputManager.isActionableButton({ type: 'navigation', target: 'some-page' });
            expect(result).to.be.true;
        });

        it('should treat empty button as non-actionable', () => {
            const result = inputManager.isActionableButton({ type: 'empty' });
            expect(result).to.be.false;
        });
    });

    describe('Airbus Error Pattern (CLR)', () => {
        it('should restore rejected input on CLR after error', async () => {
            scratchpad.set('999');

            // Trigger out-of-range error
            await inputManager.handleLSK('left', 3);
            expect(scratchpad.errorShowing).to.be.true;
            expect(scratchpad.getContent()).to.equal('ENTRY OUT OF RANGE');

            // CLR should restore "999"
            scratchpad.clear();
            expect(scratchpad.getContent()).to.equal('999');
            expect(scratchpad.errorShowing).to.be.false;
        });

        it('should clear completely on second CLR after error recovery', async () => {
            scratchpad.set('999');

            // Trigger error
            await inputManager.handleLSK('left', 3);

            // First CLR: restore "999"
            scratchpad.clear();
            expect(scratchpad.getContent()).to.equal('999');

            // Second CLR: clear for real
            scratchpad.clear();
            expect(scratchpad.getContent()).to.equal('');
        });
    });

    describe('CLR Navigation', () => {
        it('should clear scratchpad before navigating', async () => {
            await inputManager.handleKeyInput('5');
            expect(scratchpad.hasContent()).to.be.true;

            await inputManager.handleCLR();

            // Scratchpad cleared but no navigation (no parent)
            expect(scratchpad.hasContent()).to.be.false;
        });

        it('should navigate to parent on CLR when scratchpad empty', async () => {
            adapter.config.pages.push({ id: 'parent-page', name: 'Parent', lines: [] });
            adapter.config.pages[0].parent = 'parent-page';

            let navigatedTo = null;
            adapter.switchToPage = async (id) => { navigatedTo = id; };

            await inputManager.handleCLR();
            expect(navigatedTo).to.equal('parent-page');
        });
    });

    describe('checkTimeout', () => {
        it('should be a no-op (simplified model)', async () => {
            inputManager.mode = 'input';
            inputManager.modeChangeTime = Date.now() - 120000; // 2 minutes ago
            await inputManager.checkTimeout();
            // Mode should remain unchanged
            expect(inputManager.getMode()).to.equal('input');
        });
    });

    describe('getState', () => {
        it('should return current state info', async () => {
            await inputManager.handleKeyInput('5');
            const state = inputManager.getState();
            expect(state.mode).to.equal('input');
            expect(state.scratchpadContent).to.equal('5');
            expect(state.scratchpadValid).to.be.true;
        });
    });
});
