'use strict';

/**
 * Line Normalizer
 *
 * Handles conversion between nested line format (used in storage/rendering)
 * and flat format (used in Admin UI table).
 *
 * Nested format:
 *   { row, left: { label, display: { type, text, colLabel, colData }, button: { type, target } }, right: {...} }
 *
 * Flat format (Admin UI):
 *   { slot, leftLabel, leftText, leftColLabel, leftColData, leftButtonType, leftTarget, right... }
 */

// --- Slot ↔ Row mapping ---
// Slots 1-6 map to display rows 3,5,7,9,11,13 (odd rows, row 1 = status bar)
const DATA_ROWS = new Set([3, 5, 7, 9, 11, 13]);

function slotToDataRow(slot) {
    return slot * 2 + 1; // slot 1→3, 2→5, 3→7, 4→9, 5→11, 6→13
}

function slotToSubLabelRow(slot) {
    return slot * 2; // slot 1→2, 2→4, 3→6, 4→8, 5→10, 6→12
}

function dataRowToSlot(row) {
    return (row - 1) / 2; // row 3→1, 5→2, 7→3, 9→4, 11→5, 13→6
}

function isDataRow(row) {
    return DATA_ROWS.has(row);
}

const EMPTY_SIDE = {
    label: '',
    display: { type: 'empty' },
    button: { type: 'empty' }
};

/**
 * Ensure a line config has the expected left/right structure.
 * @param {object} lineConfig - Line configuration
 * @returns {object|null} Normalized line config
 */
function normalizeLine(lineConfig) {
    if (!lineConfig) return null;

    return {
        row: lineConfig.row,
        left: { ...EMPTY_SIDE, ...lineConfig.left },
        right: { ...EMPTY_SIDE, ...lineConfig.right }
    };
}

/**
 * Get display text from a display config
 * @param {object} displayConfig - Display configuration
 * @returns {string}
 */
function getDisplayText(displayConfig) {
    if (!displayConfig) return '';
    return displayConfig.text || displayConfig.label || '';
}

/**
 * Flatten a nested line config to flat format for Admin UI table.
 * @param {object} line - Nested line config
 * @returns {object} Flat line config
 */
function flattenLine(line) {
    if (!line) return null;

    const n = normalizeLine(line);
    const slot = isDataRow(n.row) ? dataRowToSlot(n.row) : 1;

    return {
        slot: slot,
        leftLabel: n.left?.label || '',
        leftText: getDisplayText(n.left?.display) || '',
        leftColLabel: n.left?.display?.colLabel || '',
        leftColData: n.left?.display?.colData || n.left?.display?.color || '',
        leftButtonType: n.left?.button?.type || 'empty',
        leftTarget: n.left?.button?.target || '',
        leftSource: n.left?.display?.source || '',
        leftFormat: n.left?.display?.format || '',
        leftUnit: n.left?.display?.unit || '',
        rightLabel: n.right?.label || '',
        rightText: getDisplayText(n.right?.display) || '',
        rightColLabel: n.right?.display?.colLabel || '',
        rightColData: n.right?.display?.colData || n.right?.display?.color || '',
        rightButtonType: n.right?.button?.type || 'empty',
        rightTarget: n.right?.button?.target || '',
        rightSource: n.right?.display?.source || '',
        rightFormat: n.right?.display?.format || '',
        rightUnit: n.right?.display?.unit || ''
    };
}

/**
 * Convert a flat line config back to nested format.
 * @param {object} flat - Flat line config
 * @returns {object} Nested line config
 */
function unflattenLine(flat) {
    if (!flat) return null;

    const row = (flat.slot !== undefined && flat.slot !== null)
        ? slotToDataRow(Number(flat.slot))
        : 3;

    const leftDisplayType = flat.leftButtonType === 'datapoint'
        ? 'datapoint'
        : (flat.leftText ? 'label' : 'empty');
    const rightDisplayType = flat.rightButtonType === 'datapoint'
        ? 'datapoint'
        : (flat.rightText ? 'label' : 'empty');

    return {
        row: row,
        left: {
            label: flat.leftLabel || '',
            display: {
                type: leftDisplayType,
                text: leftDisplayType === 'datapoint' ? '' : (flat.leftText || ''),
                colLabel: flat.leftColLabel || '',
                colData: flat.leftColData || '',
                ...(leftDisplayType === 'datapoint' && {
                    source: flat.leftSource || '',
                    format: flat.leftFormat || '',
                    unit: flat.leftUnit || ''
                })
            },
            button: {
                type: flat.leftButtonType || 'empty',
                target: flat.leftTarget || ''
            }
        },
        right: {
            label: flat.rightLabel || '',
            display: {
                type: rightDisplayType,
                text: rightDisplayType === 'datapoint' ? '' : (flat.rightText || ''),
                colLabel: flat.rightColLabel || '',
                colData: flat.rightColData || '',
                ...(rightDisplayType === 'datapoint' && {
                    source: flat.rightSource || '',
                    format: flat.rightFormat || '',
                    unit: flat.rightUnit || ''
                })
            },
            button: {
                type: flat.rightButtonType || 'empty',
                target: flat.rightTarget || ''
            }
        }
    };
}

/**
 * Flatten all lines in all pages (for sending to Admin UI)
 * @param {Array} pages - Array of page configs with nested lines
 * @returns {Array} Pages with flat lines
 */
function flattenPages(pages) {
    if (!Array.isArray(pages)) return pages;
    return pages.map(page => ({
        ...page,
        lines: Array.isArray(page.lines) ? page.lines.map(flattenLine) : []
    }));
}

/**
 * Convert flat lines back to nested in all pages (from Admin UI)
 * @param {Array} pages - Array of page configs with flat lines
 * @returns {Array} Pages with nested lines
 */
function unflattenPages(pages) {
    if (!Array.isArray(pages)) return pages;
    return pages.map(page => ({
        ...page,
        lines: Array.isArray(page.lines) ? page.lines.map(unflattenLine) : []
    }));
}

module.exports = {
    normalizeLine,
    getDisplayText,
    flattenLine,
    unflattenLine,
    flattenPages,
    unflattenPages,
    EMPTY_SIDE,
    slotToDataRow,
    slotToSubLabelRow,
    dataRowToSlot,
    isDataRow,
    DATA_ROWS
};
