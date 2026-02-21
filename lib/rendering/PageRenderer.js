'use strict';

/**
 * Page Renderer
 *
 * Renders page configuration to MCDU display format.
 * Supports left/right column model (new) and single-display model (legacy).
 * Features:
 *   - Left/right column display composition
 *   - Fetch data from ioBroker states
 *   - Format values with sprintf
 *   - Sub-labels (left.label / right.label on even rows)
 *   - Reserve Line 14 for scratchpad
 *
 * @author Kira Holt
 */

const sprintf = require('sprintf-js').sprintf;
const { normalizeLine, getDisplayText } = require('../utils/lineNormalizer');

class PageRenderer {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} displayPublisher - DisplayPublisher instance
     * @param {object|null} scratchpadManager - ScratchpadManager instance (optional)
     */
    constructor(adapter, displayPublisher, scratchpadManager = null) {
        this.adapter = adapter;
        this.displayPublisher = displayPublisher;
        this.scratchpadManager = scratchpadManager;

        /** @type {number} Display columns */
        this.columns = adapter.config.display?.columns || 24;

        /** @type {number} Half-width for left/right columns */
        this.halfWidth = Math.floor(this.columns / 2);

        /** @type {number} Display rows */
        this.rows = adapter.config.display?.rows || 14;

        /** @type {string} Default color */
        this.defaultColor = adapter.config.display?.defaultColor || 'white';

        /** @type {Map<string, object>} Page cache */
        this.pageCache = new Map();

        /** @type {number} Cache TTL in ms */
        this.cacheTtl = 1000; // 1 second

        /** @type {number} Current page offset for pagination */
        this.currentPageOffset = 0;

        /** @type {number} Total pages for pagination */
        this.totalPages = 1;
    }

    /**
     * Render complete page
     * @param {string} pageId - Page ID
     * @returns {Promise<void>}
     */
    async renderPage(pageId) {
        try {
            this.adapter.log.debug(`Rendering page: ${pageId}`);

            const pageConfig = this.findPageConfig(pageId);
            if (!pageConfig) {
                this.adapter.log.error(`Page config not found: ${pageId}`);
                await this.renderErrorPage('SEITE NICHT GEFUNDEN');
                return;
            }

            if (!pageConfig.lines || pageConfig.lines.length === 0) {
                this.adapter.log.warn(`Page ${pageId} has no lines configured`);
                await this.renderEmptyPage();
                return;
            }

            // Normalize all lines to current format
            const normalizedLines = pageConfig.lines.map(l => normalizeLine(l));

            // Pagination: collect items with display content on either side
            const oddRows = [3, 5, 7, 9, 11, 13];
            const allOddItems = normalizedLines.filter(l => this.lineHasDisplay(l));
            const itemsPerPage = 6;

            if (allOddItems.length > itemsPerPage) {
                this.totalPages = Math.ceil(allOddItems.length / itemsPerPage);
                this.currentPageOffset = Math.min(this.currentPageOffset, this.totalPages - 1);
            } else {
                this.totalPages = 1;
                this.currentPageOffset = 0;
            }

            // Build paginated line map
            const paginatedMap = new Map();
            if (this.totalPages > 1) {
                const startIdx = this.currentPageOffset * itemsPerPage;
                const pageItems = allOddItems.slice(startIdx, startIdx + itemsPerPage);
                pageItems.forEach((item, i) => {
                    paginatedMap.set(oddRows[i], item);
                });
            }

            const lines = [];

            for (let row = 1; row <= this.rows; row++) {
                try {
                    // Even rows (2,4,6,8,10,12): render sub-labels for the NEXT odd row
                    if (row % 2 === 0 && row >= 2 && row <= 12) {
                        const nextOddRow = row + 1;
                        const nextLineConfig = this.totalPages > 1
                            ? paginatedMap.get(nextOddRow)
                            : normalizedLines.find(l => l.row === nextOddRow);
                        lines.push(this.renderSubLabel(nextLineConfig));
                        continue;
                    }

                    // Row 1: persistent status bar
                    if (row === 1) {
                        lines.push(this.renderStatusBar(pageId));
                        continue;
                    }

                    // For odd rows, use paginated map if pagination active
                    const lineConfig = this.totalPages > 1 && oddRows.includes(row)
                        ? paginatedMap.get(row) || null
                        : normalizedLines.find(l => l.row === row);
                    const lineContent = await this.renderLine(pageId, lineConfig, row);
                    lines.push(lineContent);
                } catch (lineError) {
                    this.adapter.log.warn(`Failed to render line ${row}: ${lineError.message}`);
                    lines.push({
                        text: this.padOrTruncate('-- FEHLER --', this.columns),
                        color: 'red'
                    });
                }
            }

            // Scroll indicators when paginated
            if (this.totalPages > 1) {
                if (this.currentPageOffset > 0) {
                    lines[1] = { text: this.padOrTruncate('                      ^', this.columns), color: 'cyan' };
                }
                if (this.currentPageOffset < this.totalPages - 1) {
                    lines[11] = { text: this.padOrTruncate('                      v', this.columns), color: 'cyan' };
                }
            }

            await this.displayPublisher.publishFullDisplay(lines);
            this.adapter.log.debug(`Page rendered: ${pageId}`);

        } catch (error) {
            this.adapter.log.error(`Failed to render page ${pageId}: ${error.message}`);
            this.adapter.log.error(error.stack);
            await this.renderErrorPage('RENDERFEHLER');
        }
    }

    /**
     * Get effective display type — coerces 'empty' to 'label' when text is present.
     * Handles admin UI saving type='empty' even though text was entered.
     * @param {object|null} displayConfig
     * @returns {string}
     */
    effectiveDisplayType(displayConfig) {
        if (!displayConfig) return 'empty';
        if (displayConfig.type && displayConfig.type !== 'empty') return displayConfig.type;
        if (displayConfig.text || displayConfig.label) return 'label';
        return 'empty';
    }

    /**
     * Check if a normalized line has any display content
     * @param {object} line - Normalized line config
     * @returns {boolean}
     */
    lineHasDisplay(line) {
        if (!line) return false;
        const leftHas = this.effectiveDisplayType(line.left?.display) !== 'empty';
        const rightHas = this.effectiveDisplayType(line.right?.display) !== 'empty';
        return leftHas || rightHas;
    }

    /**
     * Render sub-label row (even rows) for left.label + right.label
     * @param {object|null} lineConfig - Normalized line config for the next odd row
     * @returns {object} Line object {text, color}
     */
    renderSubLabel(lineConfig) {
        const leftLabel = lineConfig?.left?.label || '';
        const rightLabel = lineConfig?.right?.label || '';
        const leftColLabel = lineConfig?.left?.display?.colLabel || 'cyan';
        const rightColLabel = lineConfig?.right?.display?.colLabel || 'cyan';

        let text;
        if (leftLabel && rightLabel) {
            // Both sides: left-align left label, right-align right label
            const rightPart = `${rightLabel}`;
            const gap = this.columns - leftLabel.length - rightPart.length;
            text = leftLabel + ' '.repeat(Math.max(0, gap)) + rightPart;
        } else if (leftLabel) {
            text = leftLabel;
        } else if (rightLabel) {
            text = rightLabel;
            text = ' '.repeat(this.columns - text.length) + text;
        } else {
            text = '';
        }

        const result = {
            text: this.padOrTruncate(text, this.columns),
            color: leftColLabel
        };

        // Per-side label colors: emit segments when left and right differ
        if (leftLabel && rightLabel && leftColLabel !== rightColLabel) {
            const leftText = leftLabel.padEnd(this.halfWidth);
            const rightText = rightLabel.padStart(this.halfWidth);
            result.segments = [
                { text: leftText, color: leftColLabel },
                { text: rightText, color: rightColLabel }
            ];
        }

        return result;
    }

    /**
     * Render empty page with message
     * @returns {Promise<void>}
     */
    async renderEmptyPage() {
        const lines = [];
        for (let i = 1; i <= 6; i++) {
            lines.push({ text: this.padOrTruncate('', this.columns), color: 'white' });
        }
        lines.push({ text: this.padOrTruncate('    KEINE INHALTE', this.columns), color: 'amber' });
        for (let i = 8; i <= 14; i++) {
            lines.push({ text: this.padOrTruncate('', this.columns), color: 'white' });
        }
        await this.displayPublisher.publishFullDisplay(lines);
    }

    /**
     * Render error page with message
     * @param {string} message - Error message
     * @returns {Promise<void>}
     */
    async renderErrorPage(message) {
        const lines = [];
        for (let i = 1; i <= 6; i++) {
            lines.push({ text: this.padOrTruncate('', this.columns), color: 'white' });
        }
        lines.push({ text: this.padOrTruncate(`    ${message}`, this.columns), color: 'red' });
        for (let i = 8; i <= 14; i++) {
            lines.push({ text: this.padOrTruncate('', this.columns), color: 'white' });
        }
        await this.displayPublisher.publishFullDisplay(lines);
    }

    /**
     * Render status bar for row 13
     * @param {string} pageId - Current page ID
     * @returns {object} Line object {text, color}
     */
    sanitizeAscii(text) {
        return text
            .replace(/[äàáâãåÄÀÁÂÃÅ]/g, c => c === c.toUpperCase() ? 'A' : 'a')
            .replace(/[éèêëÉÈÊË]/g, c => c === c.toUpperCase() ? 'E' : 'e')
            .replace(/[íìîïÍÌÎÏ]/g, c => c === c.toUpperCase() ? 'I' : 'i')
            .replace(/[öóòôõÖÓÒÔÕ]/g, c => c === c.toUpperCase() ? 'O' : 'o')
            .replace(/[üúùûÜÚÙÛ]/g, c => c === c.toUpperCase() ? 'U' : 'u')
            .replace(/ß/g, 'ss')
            .replace(/[^\x00-\x7F°Δ←↑→↓▶◀□◇]/g, '?');
    }

    renderStatusBar(pageId) {
        // Build breadcrumb display from adapter's breadcrumb array
        const breadcrumb = this.adapter.breadcrumb || [];
        let breadcrumbText;

        if (breadcrumb.length > 1) {
            // Show breadcrumb chain: "HOME > KLIMA > WOHN"
            breadcrumbText = breadcrumb.map(b => this.sanitizeAscii(b.name.toUpperCase())).join(' > ');
        } else {
            // Single page (root) - just show page name
            const pageConfig = this.findPageConfig(pageId);
            breadcrumbText = this.sanitizeAscii((pageConfig?.name || pageId).toUpperCase());
        }

        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const pageOffset = this.currentPageOffset || 0;
        const totalPages = this.totalPages || 1;
        const pageIndicator = totalPages > 1 ? ` ${pageOffset + 1}/${totalPages}` : '';

        const rightPart = `${pageIndicator} ${time}`;
        const maxNameLen = this.columns - rightPart.length;

        // Truncation strategy for breadcrumb
        if (breadcrumbText.length > maxNameLen && breadcrumb.length > 2) {
            // Try shortening intermediate segments to first 4 chars
            const shortened = breadcrumb.map((b, i) => {
                if (i === 0 || i === breadcrumb.length - 1) return this.sanitizeAscii(b.name.toUpperCase());
                const name = this.sanitizeAscii(b.name.toUpperCase());
                return name.length > 4 ? name.substring(0, 4) : name;
            }).join(' > ');
            breadcrumbText = shortened;
        }

        // Final truncation if still too long
        const truncatedName = breadcrumbText.length > maxNameLen
            ? breadcrumbText.substring(0, maxNameLen)
            : breadcrumbText;

        const padding = this.columns - truncatedName.length - rightPart.length;
        const statusText = truncatedName + ' '.repeat(Math.max(0, padding)) + rightPart;

        const pageConfig = this.findPageConfig(pageId);
        const nameColor = pageConfig?.pageNameColor || this.defaultColor;
        const timeColor = this.defaultColor;

        const result = {
            text: this.padOrTruncate(statusText, this.columns),
            color: nameColor
        };

        // Emit segments when page name color differs from time color
        if (nameColor !== timeColor) {
            const namePartLen = truncatedName.length + Math.max(0, padding);
            const namePart = statusText.substring(0, namePartLen);
            const timePart = statusText.substring(namePartLen);
            result.segments = [
                { text: namePart, color: nameColor },
                { text: timePart, color: timeColor }
            ];
        }

        return result;
    }

    /**
     * Render single line with left/right column composition
     * @param {string} pageId - Page ID
     * @param {object|null} lineConfig - Normalized line configuration
     * @param {number} row - Row number
     * @returns {Promise<object>} Line object {text, color}
     */
    async renderLine(pageId, lineConfig, row) {
        // Line 14 reserved for scratchpad
        if (row === 14) {
            if (this.scratchpadManager) {
                return {
                    text: this.padOrTruncate(this.scratchpadManager.getDisplay(), this.columns),
                    color: this.scratchpadManager.getColor()
                };
            }
            return {
                text: this.padOrTruncate('____________________', this.columns),
                color: 'white'
            };
        }

        // Normalize if needed (handles both old and new format)
        const normalized = lineConfig ? normalizeLine(lineConfig) : null;

        // Empty line
        if (!normalized || !this.lineHasDisplay(normalized)) {
            return {
                text: this.padOrTruncate('', this.columns),
                color: this.defaultColor
            };
        }

        // Render left and right sides independently
        const leftResult = await this.renderSideDisplay(normalized.left?.display, row);
        const rightResult = await this.renderSideDisplay(normalized.right?.display, row);

        const leftHasContent = leftResult.text.trim().length > 0;
        const rightHasContent = rightResult.text.trim().length > 0;

        let text;
        let color;

        let segments = null;

        if (leftHasContent && rightHasContent) {
            // Both sides: left gets first half, right gets second half
            const leftText = leftResult.text.substring(0, this.halfWidth).padEnd(this.halfWidth);
            const rightText = rightResult.text.substring(0, this.halfWidth).padStart(this.halfWidth);
            text = leftText + rightText;
            color = leftResult.color;

            // Per-side colors: when left and right differ, emit segments
            if (leftResult.color !== rightResult.color) {
                segments = [
                    { text: leftText, color: leftResult.color },
                    { text: rightText, color: rightResult.color }
                ];
            }
        } else if (leftHasContent) {
            // Only left: use full width, left-aligned
            text = this.alignText(leftResult.text, normalized.left?.display?.align || 'left', this.columns);
            color = leftResult.color;
        } else if (rightHasContent) {
            // Only right: use full width, right-aligned
            text = this.alignText(rightResult.text, normalized.right?.display?.align || 'right', this.columns);
            color = rightResult.color;
        } else {
            text = this.padOrTruncate('', this.columns);
            color = this.defaultColor;
        }

        // Ensure exact width
        text = this.padOrTruncate(text, this.columns);

        const result = { text, color };
        if (segments) {
            result.segments = segments;
        }
        return result;
    }

    /**
     * Render one side's display config to text + color
     * @param {object|null} displayConfig - Display configuration (left or right side)
     * @param {number} row - Row number
     * @returns {Promise<object>} {text: string, color: string}
     */
    async renderSideDisplay(displayConfig, row) {
        const type = this.effectiveDisplayType(displayConfig);
        if (type === 'empty') {
            return { text: '', color: this.defaultColor };
        }

        let text = '';
        let color = displayConfig.colData || this.defaultColor;

        if (type === 'label') {
            text = getDisplayText(displayConfig);
        } else if (type === 'datapoint') {
            const result = await this.renderDatapoint(displayConfig, row);
            text = result.text;
            color = result.color;
        }

        return { text, color };
    }

    /**
     * Render datapoint (fetch value and format)
     * @param {object} displayConfig - Display configuration
     * @param {number} row - Row number
     * @returns {Promise<object>} {text: string, color: string}
     */
    async renderDatapoint(displayConfig, row) {
        const { source, format, unit } = displayConfig;
        const label = getDisplayText(displayConfig);

        if (!source) {
            return { text: label || '', color: displayConfig.colData || this.defaultColor };
        }

        try {
            const state = await this.adapter.getForeignStateAsync(source);

            if (!state) {
                this.adapter.log.warn(`Data source not found: ${source}`);
                const prefix = label ? `${label} ` : '';
                return { text: `${prefix}---`, color: 'amber' };
            }

            const value = state.val;

            if (state.q !== undefined && state.q !== 0x00) {
                this.adapter.log.debug(`Data source ${source} has quality issue: 0x${state.q.toString(16)}`);
                const prefix = label ? `${label} ` : '';
                return { text: `${prefix}OFFLINE`, color: 'amber' };
            }

            let formattedValue = '';
            if (value !== null && value !== undefined) {
                if (format) {
                    try {
                        formattedValue = sprintf(format, value);
                    } catch (error) {
                        this.adapter.log.error(`Format error on ${source}: ${error.message}`);
                        formattedValue = String(value);
                    }
                } else {
                    formattedValue = String(value);
                }

                if (formattedValue.length > this.columns - 5) {
                    formattedValue = formattedValue.substring(0, this.columns - 8) + '...';
                }
            } else {
                formattedValue = '---';
            }

            const prefix = label ? `${label} ` : '';
            const suffix = unit ? ` ${unit}` : '';
            let content = `${prefix}${formattedValue}${suffix}`;

            if (content.length > this.columns) {
                content = content.substring(0, this.columns - 3) + '...';
            }

            let color = displayConfig.colData || this.defaultColor;

            if (displayConfig.colorRules && Array.isArray(displayConfig.colorRules)) {
                const ruleColor = this.evaluateColorRules(value, displayConfig.colorRules);
                if (ruleColor) {
                    color = ruleColor;
                }
            }

            return { text: content, color: color };

        } catch (error) {
            this.adapter.log.error(`Error rendering datapoint ${source}: ${error.message}`);
            return { text: `${label || ''} ERR`, color: 'red' };
        }
    }

    /**
     * Find page configuration by ID
     * @param {string} pageId - Page ID
     * @returns {object|null}
     */
    findPageConfig(pageId) {
        const pages = this.adapter.config.pages || [];
        return pages.find(p => p.id === pageId) || null;
    }

    /**
     * Align text within column width
     * @param {string} text - Input text
     * @param {string} align - Alignment (left|center|right)
     * @param {number} width - Column width
     * @returns {string}
     */
    alignText(text, align, width) {
        text = text.trim();

        if (text.length >= width) {
            return text.substring(0, width);
        }

        const padding = width - text.length;

        if (align === 'center') {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
        } else if (align === 'right') {
            return ' '.repeat(padding) + text;
        }
        // left (default)
        return text + ' '.repeat(padding);
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

    invalidateCache(pageId) {
        this.pageCache.delete(pageId);
    }

    clearCache() {
        this.pageCache.clear();
    }

    /**
     * Evaluate color rules for a value
     * @param {any} value - Value to evaluate
     * @param {Array} colorRules - Array of color rules
     * @returns {string|null}
     */
    evaluateColorRules(value, colorRules) {
        for (const rule of colorRules) {
            if (this.evaluateCondition(value, rule.condition)) {
                return rule.color;
            }
        }
        return null;
    }

    /**
     * Evaluate condition string against a value
     * @param {any} value - Value to evaluate
     * @param {string} condition - Condition string
     * @returns {boolean}
     */
    evaluateCondition(value, condition) {
        try {
            const numValue = parseFloat(value);
            const isNumeric = !isNaN(numValue);
            let expression = condition;

            if (isNumeric) {
                expression = expression.replace(/([<>=!]+)\s*(\d+\.?\d*)/g, (match, op, compareValue) => {
                    return `${numValue} ${op} ${compareValue}`;
                });
            } else {
                expression = expression.replace(/==\s*["']?([^"'\s]+)["']?/g, (match, compareValue) => {
                    return `"${value}" === "${compareValue}"`;
                });
                expression = expression.replace(/!=\s*["']?([^"'\s]+)["']?/g, (match, compareValue) => {
                    return `"${value}" !== "${compareValue}"`;
                });
            }

            // eslint-disable-next-line no-new-func
            const result = new Function(`return ${expression}`)();
            return Boolean(result);

        } catch (error) {
            this.adapter.log.error(`Color rule evaluation failed for condition "${condition}": ${error.message}`);
            return false;
        }
    }

    /**
     * Set scratchpad manager (for dependency injection)
     * @param {object} scratchpadManager - ScratchpadManager instance
     */
    setScratchpadManager(scratchpadManager) {
        this.scratchpadManager = scratchpadManager;
    }
}

module.exports = PageRenderer;
