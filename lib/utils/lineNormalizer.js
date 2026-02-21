'use strict';

/**
 * Line Normalizer
 *
 * Converts between old line format (leftButton/display/rightButton)
 * and new left/right column model.
 *
 * Old format:
 *   { row, subLabel, leftButton, display, rightButton }
 *
 * New format:
 *   { row, left: { label, display, button }, right: { label, display, button } }
 */

// --- Slot ↔ Row mapping helpers ---
const OLD_DATA_ROWS = new Set([1, 3, 5, 7, 9, 11]);
const NEW_DATA_ROWS = new Set([3, 5, 7, 9, 11, 13]);
const OLD_TO_NEW_ROW = { 1: 3, 3: 5, 5: 7, 7: 9, 9: 11, 11: 13 };

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
    return NEW_DATA_ROWS.has(row);
}

function migrateOldRows(lines) {
    if (!Array.isArray(lines)) return lines;
    // Row 1 is unique to old format (new format uses row 1 for status bar, not data)
    const hasRow1 = lines.some(l => l && l.row === 1);
    if (!hasRow1) return lines;
    return lines.map(l => {
        if (!l || OLD_TO_NEW_ROW[l.row] === undefined) return l;
        return { ...l, row: OLD_TO_NEW_ROW[l.row] };
    });
}

const EMPTY_SIDE = {
    label: '',
    display: { type: 'empty' },
    button: { type: 'empty' }
};

/**
 * Detect whether a line config uses the old format
 * @param {object} lineConfig - Line configuration
 * @returns {boolean}
 */
function isOldFormat(lineConfig) {
    return lineConfig && (
        lineConfig.hasOwnProperty('display') ||
        lineConfig.hasOwnProperty('leftButton') ||
        lineConfig.hasOwnProperty('rightButton') ||
        lineConfig.hasOwnProperty('subLabel')
    ) && !lineConfig.hasOwnProperty('left') && !lineConfig.hasOwnProperty('right');
}

/**
 * Normalize a line config to the new left/right format.
 * If already in new format, returns as-is. If old format, converts.
 * @param {object} lineConfig - Line configuration (old or new format)
 * @returns {object} Normalized line config in new format
 */
function normalizeLine(lineConfig) {
    if (!lineConfig) return null;

    // Already in new format
    if (lineConfig.left || lineConfig.right) {
        return {
            row: lineConfig.row,
            left: { ...EMPTY_SIDE, ...lineConfig.left },
            right: { ...EMPTY_SIDE, ...lineConfig.right }
        };
    }

    // Convert old format to new
    const left = {
        label: lineConfig.subLabel || '',
        display: { type: 'empty' },
        button: lineConfig.leftButton || { type: 'empty' }
    };

    const right = {
        label: '',
        display: { type: 'empty' },
        button: lineConfig.rightButton || { type: 'empty' }
    };

    // Map old single `display` field to left side by default
    if (lineConfig.display && lineConfig.display.type !== 'empty') {
        const display = { ...lineConfig.display };
        // Support both 'label' and 'text' field names
        if (display.label && !display.text) {
            display.text = display.label;
        }
        left.display = display;
    }

    return {
        row: lineConfig.row,
        left,
        right
    };
}

/**
 * Normalize all lines in a page config
 * @param {object} pageConfig - Page configuration
 * @returns {object} Page config with normalized lines
 */
function normalizePageLines(pageConfig) {
    if (!pageConfig || !pageConfig.lines) return pageConfig;

    return {
        ...pageConfig,
        lines: pageConfig.lines.map(normalizeLine)
    };
}

/**
 * Get display text from a display config (supports both 'text' and 'label' fields)
 * @param {object} displayConfig - Display configuration
 * @returns {string}
 */
function getDisplayText(displayConfig) {
    if (!displayConfig) return '';
    return displayConfig.text || displayConfig.label || '';
}

/**
 * Flatten a nested line config to flat format for Admin UI table.
 * Nested: { row, left: { label, display: { type, text, color }, button: { type, target } }, right: {...} }
 * Flat: { row, leftLabel, leftDisplayType, leftText, leftColor, leftButtonType, leftTarget, right... }
 * @param {object} line - Nested line config
 * @returns {object} Flat line config
 */
function flattenLine(line) {
    if (!line) return null;

    // Ensure normalized first
    const n = normalizeLine(line);

    // Convert row to slot for Admin UI
    const slot = isDataRow(n.row) ? dataRowToSlot(n.row) : 1;

    return {
        slot: slot,
        leftLabel: n.left?.label || '',
        leftDisplayType: n.left?.display?.type || 'empty',
        leftText: getDisplayText(n.left?.display) || '',
        leftColor: n.left?.display?.color || '',
        leftButtonType: n.left?.button?.type || 'empty',
        leftTarget: n.left?.button?.target || '',
        rightLabel: n.right?.label || '',
        rightDisplayType: n.right?.display?.type || 'empty',
        rightText: getDisplayText(n.right?.display) || '',
        rightColor: n.right?.display?.color || '',
        rightButtonType: n.right?.button?.type || 'empty',
        rightTarget: n.right?.button?.target || ''
    };
}

/**
 * Convert a flat line config back to nested format.
 * @param {object} flat - Flat line config
 * @returns {object} Nested line config
 */
function unflattenLine(flat) {
    if (!flat) return null;

    // Determine row from slot or legacy row field
    let row;
    if (flat.slot !== undefined && flat.slot !== null) {
        row = slotToDataRow(Number(flat.slot));
    } else if (flat.row !== undefined) {
        row = Number(flat.row);
    } else {
        row = 3; // default slot 1
    }

    // Infer displayType from text content if not explicitly set
    const leftDisplayType = flat.leftDisplayType || (flat.leftText ? 'label' : 'empty');
    const rightDisplayType = flat.rightDisplayType || (flat.rightText ? 'label' : 'empty');

    return {
        row: row,
        left: {
            label: flat.leftLabel || '',
            display: {
                type: leftDisplayType,
                text: flat.leftText || '',
                color: flat.leftColor || ''
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
                text: flat.rightText || '',
                color: flat.rightColor || ''
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
    isOldFormat,
    normalizeLine,
    normalizePageLines,
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
    migrateOldRows,
    OLD_DATA_ROWS,
    NEW_DATA_ROWS,
    OLD_TO_NEW_ROW
};
