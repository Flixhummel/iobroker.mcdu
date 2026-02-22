'use strict';

const { expect } = require('chai');
const ScratchpadManager = require('../../lib/input/ScratchpadManager');
const ConfirmationDialog = require('../../lib/input/ConfirmationDialog');
const { createMockAdapter, createMockDisplayPublisher } = require('./testHelper');

describe('ASCII-Safe Messages', () => {
    describe('ScratchpadManager', () => {
        let adapter;
        let displayPublisher;
        let scratchpad;

        beforeEach(() => {
            adapter = createMockAdapter();
            displayPublisher = createMockDisplayPublisher();
            scratchpad = new ScratchpadManager(adapter, displayPublisher);
        });

        it('should use "ERR" prefix in renderError instead of emoji', async () => {
            await scratchpad.renderError('TEST FAILURE');

            const published = displayPublisher._publishedLines;
            expect(published).to.have.length(1);
            expect(published[0].text).to.equal('ERR TEST FAILURE');
            expect(published[0].color).to.equal('red');
            expect(published[0].lineNum).to.equal(13);
        });

        it('should not contain emoji in error messages', async () => {
            await scratchpad.renderError('VALIDATION FAILED');

            const text = displayPublisher._publishedLines[0].text;
            // Check no unicode emoji characters
            expect(text).to.not.match(/[\u{1F600}-\u{1F64F}]/u);
            expect(text).to.not.include('\u274C'); // ❌
            expect(text).to.not.include('\u2705'); // ✅
        });

        it('should use "OK GESPEICHERT" in renderSuccess', async () => {
            await scratchpad.renderSuccess();

            const published = displayPublisher._publishedLines;
            expect(published).to.have.length(1);
            expect(published[0].text).to.equal('OK GESPEICHERT');
            expect(published[0].color).to.equal('green');
        });

        it('should not contain emoji in success messages', async () => {
            await scratchpad.renderSuccess('OK DONE');

            const text = displayPublisher._publishedLines[0].text;
            expect(text).to.not.include('\u2713'); // ✓
            expect(text).to.not.include('\u2705'); // ✅
        });

        it('should accept custom success message', async () => {
            await scratchpad.renderSuccess('OK UPDATED');

            expect(displayPublisher._publishedLines[0].text).to.equal('OK UPDATED');
        });
    });

    describe('ConfirmationDialog', () => {
        let adapter;
        let displayPublisher;
        let dialog;

        beforeEach(() => {
            adapter = createMockAdapter();
            displayPublisher = createMockDisplayPublisher();
            dialog = new ConfirmationDialog(adapter, displayPublisher);
        });

        it('should use "!!" prefix for warnings instead of emoji', async () => {
            await dialog.showHardConfirmation(
                'DELETE ALL',
                'DANGER ZONE',
                ['This will delete everything'],
                async () => {}
            );

            const lines = displayPublisher._published[0];
            // Line 2 (index 1) should have warning with "!!" prefix
            const warningLine = lines[1];
            expect(warningLine.text).to.include('!! DANGER ZONE');
            expect(warningLine.color).to.equal('red');
        });

        it('should not contain emoji in warning text', async () => {
            await dialog.showHardConfirmation(
                'TEST',
                'WARNING TEXT',
                ['Details'],
                async () => {}
            );

            const lines = displayPublisher._published[0];
            const warningLine = lines[1];
            expect(warningLine.text).to.not.include('\u26A0'); // ⚠️
            expect(warningLine.text).to.not.match(/[\u{1F600}-\u{1F64F}]/u);
        });

        it('should render soft confirmation without warning line', async () => {
            await dialog.showSoftConfirmation(
                'CONFIRM ACTION',
                ['Turn off lights'],
                async () => {},
                async () => {}
            );

            const lines = displayPublisher._published[0];
            // Line 2 should be empty (no warning for soft confirmation)
            expect(lines[1].text.trim()).to.equal('');
        });
    });

    describe('Display-Safe Characters', () => {
        it('should only use ASCII-safe characters in ScratchpadManager placeholder', () => {
            const adapter = createMockAdapter();
            const displayPublisher = createMockDisplayPublisher();
            const scratchpad = new ScratchpadManager(adapter, displayPublisher);

            const placeholder = scratchpad.placeholder;
            // All chars should be printable ASCII (32-126) or underscore
            for (const char of placeholder) {
                expect(char.charCodeAt(0)).to.be.at.least(32);
                expect(char.charCodeAt(0)).to.be.at.most(126);
            }
        });

        it('should show plain content in scratchpad display', () => {
            const adapter = createMockAdapter();
            const displayPublisher = createMockDisplayPublisher();
            const scratchpad = new ScratchpadManager(adapter, displayPublisher);

            scratchpad.append('2');
            scratchpad.append('2');
            scratchpad.append('.');
            scratchpad.append('5');

            expect(scratchpad.getDisplay()).to.equal('22.5');
        });
    });
});
