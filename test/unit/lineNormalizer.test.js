'use strict';

const { expect } = require('chai');
const { flattenLine, unflattenLine } = require('../../lib/utils/lineNormalizer');

describe('lineNormalizer', () => {
    describe('flattenLine() with datapoint display', () => {
        it('should extract source/format/unit from left datapoint display', () => {
            const line = {
                row: 3,
                left: {
                    label: 'TEMP',
                    display: {
                        type: 'datapoint',
                        text: '',
                        color: 'green',
                        source: '0_userdata.0.mcdu_test.temperature_living',
                        format: '%.1f',
                        unit: '°C'
                    },
                    button: { type: 'datapoint', target: '' }
                },
                right: {
                    label: '',
                    display: { type: 'empty' },
                    button: { type: 'empty' }
                }
            };

            const flat = flattenLine(line);
            expect(flat.leftSource).to.equal('0_userdata.0.mcdu_test.temperature_living');
            expect(flat.leftFormat).to.equal('%.1f');
            expect(flat.leftUnit).to.equal('°C');
        });

        it('should extract source/format/unit from right datapoint display', () => {
            const line = {
                row: 5,
                left: {
                    label: '',
                    display: { type: 'empty' },
                    button: { type: 'empty' }
                },
                right: {
                    label: 'POWER',
                    display: {
                        type: 'datapoint',
                        text: '',
                        color: 'amber',
                        source: '0_userdata.0.mcdu_test.power_total',
                        format: '%d',
                        unit: 'W'
                    },
                    button: { type: 'datapoint', target: '' }
                }
            };

            const flat = flattenLine(line);
            expect(flat.rightSource).to.equal('0_userdata.0.mcdu_test.power_total');
            expect(flat.rightFormat).to.equal('%d');
            expect(flat.rightUnit).to.equal('W');
        });

        it('should default source/format/unit to empty string for non-datapoint lines', () => {
            const line = {
                row: 3,
                left: {
                    label: 'MENU',
                    display: { type: 'label', text: 'KLIMA' },
                    button: { type: 'navigation', target: 'klima-main' }
                },
                right: {
                    label: '',
                    display: { type: 'empty' },
                    button: { type: 'empty' }
                }
            };

            const flat = flattenLine(line);
            expect(flat.leftSource).to.equal('');
            expect(flat.leftFormat).to.equal('');
            expect(flat.leftUnit).to.equal('');
        });
    });

    describe('unflattenLine() with datapoint type', () => {
        it('should create datapoint display type when buttonType=datapoint and source set', () => {
            const flat = {
                slot: 1,
                leftLabel: 'TEMP',
                leftText: '',
                leftColor: 'green',
                leftButtonType: 'datapoint',
                leftTarget: '',
                leftSource: '0_userdata.0.mcdu_test.temperature_living',
                leftFormat: '%.1f',
                leftUnit: '°C',
                rightLabel: '',
                rightText: '',
                rightColor: '',
                rightButtonType: 'empty',
                rightTarget: '',
                rightSource: '',
                rightFormat: '',
                rightUnit: ''
            };

            const nested = unflattenLine(flat);
            expect(nested.left.display.type).to.equal('datapoint');
            expect(nested.left.display.source).to.equal('0_userdata.0.mcdu_test.temperature_living');
            expect(nested.left.display.format).to.equal('%.1f');
            expect(nested.left.display.unit).to.equal('°C');
        });

        it('should set datapoint type even without source when buttonType=datapoint', () => {
            const flat = {
                slot: 2,
                leftLabel: '',
                leftText: 'some text',
                leftColor: '',
                leftButtonType: 'datapoint',
                leftTarget: '',
                leftSource: '',
                leftFormat: '',
                leftUnit: '',
                rightLabel: '',
                rightText: '',
                rightColor: '',
                rightButtonType: 'empty',
                rightTarget: '',
                rightSource: '',
                rightFormat: '',
                rightUnit: ''
            };

            const nested = unflattenLine(flat);
            expect(nested.left.display.type).to.equal('datapoint');
            expect(nested.left.display.source).to.equal('');
            expect(nested.left.display.text).to.equal('');
        });

        it('should set datapoint type when buttonType=datapoint, no source, no text', () => {
            const flat = {
                slot: 3,
                leftLabel: '',
                leftText: '',
                leftColor: '',
                leftButtonType: 'datapoint',
                leftTarget: '',
                leftSource: '',
                leftFormat: '',
                leftUnit: '',
                rightLabel: '',
                rightText: '',
                rightColor: '',
                rightButtonType: 'empty',
                rightTarget: '',
                rightSource: '',
                rightFormat: '',
                rightUnit: ''
            };

            const nested = unflattenLine(flat);
            expect(nested.left.display.type).to.equal('datapoint');
            expect(nested.left.display.source).to.equal('');
        });

        it('should handle right-side datapoint', () => {
            const flat = {
                slot: 1,
                leftLabel: '',
                leftText: '',
                leftColor: '',
                leftButtonType: 'empty',
                leftTarget: '',
                leftSource: '',
                leftFormat: '',
                leftUnit: '',
                rightLabel: 'POWER',
                rightText: '',
                rightColor: 'amber',
                rightButtonType: 'datapoint',
                rightTarget: '',
                rightSource: '0_userdata.0.mcdu_test.power_total',
                rightFormat: '%d',
                rightUnit: 'W'
            };

            const nested = unflattenLine(flat);
            expect(nested.right.display.type).to.equal('datapoint');
            expect(nested.right.display.source).to.equal('0_userdata.0.mcdu_test.power_total');
            expect(nested.right.display.format).to.equal('%d');
            expect(nested.right.display.unit).to.equal('W');
        });
    });

    describe('round-trip: flatten(unflatten(flat))', () => {
        it('should preserve datapoint fields through round-trip', () => {
            const original = {
                slot: 1,
                leftLabel: 'TEMP',
                leftText: '',
                leftColor: 'green',
                leftButtonType: 'datapoint',
                leftTarget: '',
                leftSource: '0_userdata.0.mcdu_test.temperature_living',
                leftFormat: '%.1f',
                leftUnit: '°C',
                rightLabel: '',
                rightText: '',
                rightColor: '',
                rightButtonType: 'empty',
                rightTarget: '',
                rightSource: '',
                rightFormat: '',
                rightUnit: ''
            };

            const nested = unflattenLine(original);
            const roundTripped = flattenLine(nested);

            expect(roundTripped.leftSource).to.equal(original.leftSource);
            expect(roundTripped.leftFormat).to.equal(original.leftFormat);
            expect(roundTripped.leftUnit).to.equal(original.leftUnit);
            expect(roundTripped.leftButtonType).to.equal(original.leftButtonType);
            expect(roundTripped.slot).to.equal(original.slot);
        });

        it('should preserve navigation fields through round-trip', () => {
            const original = {
                slot: 2,
                leftLabel: 'MENU',
                leftText: 'KLIMA',
                leftColor: '',
                leftButtonType: 'navigation',
                leftTarget: 'klima-main',
                leftSource: '',
                leftFormat: '',
                leftUnit: '',
                rightLabel: '',
                rightText: '',
                rightColor: '',
                rightButtonType: 'empty',
                rightTarget: '',
                rightSource: '',
                rightFormat: '',
                rightUnit: ''
            };

            const nested = unflattenLine(original);
            const roundTripped = flattenLine(nested);

            expect(roundTripped.leftButtonType).to.equal('navigation');
            expect(roundTripped.leftTarget).to.equal('klima-main');
            expect(roundTripped.leftSource).to.equal('');
        });
    });
});
