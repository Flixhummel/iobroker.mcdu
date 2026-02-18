'use strict';

/**
 * Page Renderer
 * 
 * Renders page configuration to MCDU display format.
 * Features:
 *   - Fetch data from ioBroker states
 *   - Format values with sprintf
 *   - Apply alignment (left/center/right)
 *   - Simple color coding (white for all, no dynamic colors yet)
 *   - Reserve Line 14 for scratchpad
 * 
 * @author Kira Holt
 */

const sprintf = require('sprintf-js').sprintf;

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
        
        /** @type {number} Display rows */
        this.rows = adapter.config.display?.rows || 14;
        
        /** @type {string} Default color */
        this.defaultColor = adapter.config.display?.defaultColor || 'white';
        
        /** @type {Map<string, object>} Page cache */
        this.pageCache = new Map();
        
        /** @type {number} Cache TTL in ms */
        this.cacheTtl = 1000; // 1 second
    }
    
    /**
     * Render complete page
     * Error boundary: Handles page rendering errors gracefully
     * @param {string} pageId - Page ID
     * @returns {Promise<void>}
     */
    async renderPage(pageId) {
        try {
            this.adapter.log.debug(`Rendering page: ${pageId}`);
            
            // Find page config
            const pageConfig = this.findPageConfig(pageId);
            if (!pageConfig) {
                this.adapter.log.error(`Page config not found: ${pageId}`);
                // Render error page
                await this.renderErrorPage('SEITE NICHT GEFUNDEN');
                return;
            }
            
            // Edge case: Empty page (no lines configured)
            if (!pageConfig.lines || pageConfig.lines.length === 0) {
                this.adapter.log.warn(`Page ${pageId} has no lines configured`);
                await this.renderEmptyPage();
                return;
            }
            
            // Render all lines
            const lines = [];
            
            for (let row = 1; row <= this.rows; row++) {
                try {
                    const lineConfig = pageConfig.lines?.find(l => l.row === row);
                    const lineContent = await this.renderLine(pageId, lineConfig, row);
                    lines.push(lineContent);
                } catch (lineError) {
                    // Skip line on error, log warning
                    this.adapter.log.warn(`Failed to render line ${row}: ${lineError.message}`);
                    lines.push({
                        text: this.padOrTruncate('-- FEHLER --', this.columns),
                        color: 'red'
                    });
                }
            }
            
            // Publish full display
            await this.displayPublisher.publishFullDisplay(lines);
            
            this.adapter.log.debug(`Page rendered: ${pageId}`);
            
        } catch (error) {
            this.adapter.log.error(`Failed to render page ${pageId}: ${error.message}`);
            this.adapter.log.error(error.stack);
            
            // Fallback: Render error page
            await this.renderErrorPage('RENDERFEHLER');
        }
    }
    
    /**
     * Render empty page with message
     * @returns {Promise<void>}
     */
    async renderEmptyPage() {
        const lines = [];
        
        // Line 1-6: Empty
        for (let i = 1; i <= 6; i++) {
            lines.push({
                text: this.padOrTruncate('', this.columns),
                color: 'white'
            });
        }
        
        // Line 7: Message
        lines.push({
            text: this.padOrTruncate('    KEINE INHALTE', this.columns),
            color: 'amber'
        });
        
        // Line 8-14: Empty
        for (let i = 8; i <= 14; i++) {
            lines.push({
                text: this.padOrTruncate('', this.columns),
                color: 'white'
            });
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
        
        // Line 1-6: Empty
        for (let i = 1; i <= 6; i++) {
            lines.push({
                text: this.padOrTruncate('', this.columns),
                color: 'white'
            });
        }
        
        // Line 7: Error message
        lines.push({
            text: this.padOrTruncate(`    ${message}`, this.columns),
            color: 'red'
        });
        
        // Line 8-14: Empty
        for (let i = 8; i <= 14; i++) {
            lines.push({
                text: this.padOrTruncate('', this.columns),
                color: 'white'
            });
        }
        
        await this.displayPublisher.publishFullDisplay(lines);
    }
    
    /**
     * Render single line
     * @param {string} pageId - Page ID
     * @param {object|null} lineConfig - Line configuration
     * @param {number} row - Row number
     * @returns {Promise<object>} Line object {text, color}
     */
    async renderLine(pageId, lineConfig, row) {
        // Line 14 reserved for scratchpad - delegate to ScratchpadManager
        if (row === 14) {
            if (this.scratchpadManager) {
                const display = this.scratchpadManager.getDisplay();
                const color = this.scratchpadManager.getColor();
                return {
                    text: this.padOrTruncate(display, this.columns),
                    color: color
                };
            } else {
                // Fallback if scratchpad not available
                return {
                    text: this.padOrTruncate('____________________', this.columns),
                    color: 'white'
                };
            }
        }
        
        // Empty line
        if (!lineConfig || !lineConfig.display || lineConfig.display.type === 'empty') {
            return {
                text: this.padOrTruncate('', this.columns),
                color: this.defaultColor
            };
        }
        
        const display = lineConfig.display;
        let text = '';
        let color = display.color || this.defaultColor;
        
        // Static label
        if (display.type === 'label') {
            text = display.label || '';
        }
        
        // Dynamic datapoint
        else if (display.type === 'datapoint') {
            const result = await this.renderDatapoint(display, row);
            text = result.text;
            color = result.color;
        }
        
        // Apply alignment
        text = this.alignText(text, display.align || 'left', this.columns);
        
        // Update line state
        await this.adapter.setStateAsync(`pages.${pageId}.lines.${row}.display`, text, true);
        
        return { text, color };
    }
    
    /**
     * Render datapoint (fetch value and format)
     * @param {object} displayConfig - Display configuration
     * @param {number} row - Row number
     * @returns {Promise<object>} {text: string, color: string}
     */
    async renderDatapoint(displayConfig, row) {
        const { source, label, format, unit, editable } = displayConfig;
        
        if (!source) {
            return { text: label || '', color: displayConfig.color || this.defaultColor };
        }
        
        try {
            // Fetch state value
            const state = await this.adapter.getForeignStateAsync(source);
            
            // Edge case: State not found (missing data source)
            if (!state) {
                this.adapter.log.warn(`Data source not found: ${source}`);
                const prefix = label ? `${label} ` : '';
                return { 
                    text: `${prefix}---`, 
                    color: 'amber' 
                };
            }
            
            const value = state.val;
            
            // Edge case: Check device online status (if quality exists)
            if (state.q !== undefined && state.q !== 0x00) {
                // Quality not good (device offline, communication error, etc.)
                this.adapter.log.debug(`Data source ${source} has quality issue: 0x${state.q.toString(16)}`);
                const prefix = label ? `${label} ` : '';
                return { 
                    text: `${prefix}OFFLINE`, 
                    color: 'amber' 
                };
            }
            
            // Format value
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
                
                // Edge case: Display overflow - truncate gracefully
                if (formattedValue.length > this.columns - 5) { // Reserve space for label/unit
                    formattedValue = formattedValue.substring(0, this.columns - 8) + '...';
                    this.adapter.log.debug(`Value truncated for ${source}: too long`);
                }
            } else {
                formattedValue = '---';
            }
            
            // Build content with label and unit
            const prefix = label ? `${label} ` : '';
            const suffix = unit ? unit : '';
            let content = `${prefix}${formattedValue}${suffix}`;
            
            // Edge case: Total content overflow - truncate
            if (content.length > this.columns) {
                content = content.substring(0, this.columns - 3) + '...';
            }
            
            // Determine color (evaluate color rules if defined)
            let color = displayConfig.color || this.defaultColor;
            
            if (displayConfig.colorRules && Array.isArray(displayConfig.colorRules)) {
                const ruleColor = this.evaluateColorRules(value, displayConfig.colorRules);
                if (ruleColor) {
                    color = ruleColor;
                }
            }
            
            // Add edit indicators if field is editable
            if (editable) {
                const isEditActive = await this.isEditActive(row);
                const indicator = this.addEditIndicator(content, true, isEditActive);
                content = indicator.text;
                color = indicator.color;
            }
            
            return { text: content, color: color };
            
        } catch (error) {
            this.adapter.log.error(`Error rendering datapoint ${source}: ${error.message}`);
            return { text: `${label || ''} ERR`, color: 'red' };
        }
    }
    
    /**
     * Add edit indicator to field content
     * @param {string} content - Field content
     * @param {boolean} isEditable - Is field editable?
     * @param {boolean} isActive - Is field currently being edited?
     * @returns {object} {text: string, color: string}
     */
    addEditIndicator(content, isEditable, isActive) {
        if (!isEditable) {
            return { text: content, color: this.defaultColor };
        }
        
        if (isActive) {
            // Field currently being edited → brackets + amber
            return {
                text: `[${content}]`,
                color: 'amber'
            };
        } else {
            // Editable but not active → arrow + amber
            return {
                text: `${content} ←`,
                color: 'amber'
            };
        }
    }
    
    /**
     * Check if a line is currently being edited
     * @param {number} row - Row number
     * @returns {Promise<boolean>}
     */
    async isEditActive(row) {
        const selectedLineState = await this.adapter.getStateAsync('runtime.selectedLine');
        return selectedLineState?.val === row;
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
        // Remove existing padding
        text = text.trim();
        
        if (text.length >= width) {
            return text.substring(0, width);
        }
        
        const padding = width - text.length;
        
        if (align === 'center') {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
        }
        else if (align === 'right') {
            return ' '.repeat(padding) + text;
        }
        else {
            // left (default)
            return text + ' '.repeat(padding);
        }
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
     * Invalidate page cache
     * @param {string} pageId - Page ID
     */
    invalidateCache(pageId) {
        this.pageCache.delete(pageId);
        this.adapter.log.debug(`Cache invalidated for page: ${pageId}`);
    }
    
    /**
     * Clear all caches
     */
    clearCache() {
        this.pageCache.clear();
        this.adapter.log.debug('All page caches cleared');
    }
    
    /**
     * Evaluate color rules for a value
     * Rules are evaluated in order, first match wins
     * 
     * @param {any} value - Value to evaluate
     * @param {Array} colorRules - Array of color rules {condition: string, color: string}
     * @returns {string|null} Color name or null if no rule matches
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
     * Supports: <, >, <=, >=, ==, !=, &&, ||
     * 
     * @param {any} value - Value to evaluate
     * @param {string} condition - Condition string (e.g., "< 18", ">= 18 && < 22")
     * @returns {boolean}
     */
    evaluateCondition(value, condition) {
        try {
            // Convert value to number if possible
            const numValue = parseFloat(value);
            const isNumeric = !isNaN(numValue);
            
            // Replace value placeholder with actual value
            // Support both numeric and string comparisons
            let expression = condition;
            
            // Replace comparison operators with safe comparisons
            if (isNumeric) {
                // For numeric values, replace operators
                expression = expression.replace(/([<>=!]+)\s*(\d+\.?\d*)/g, (match, op, compareValue) => {
                    return `${numValue} ${op} ${compareValue}`;
                });
            } else {
                // For string values, only support == and !=
                expression = expression.replace(/==\s*["']?([^"'\s]+)["']?/g, (match, compareValue) => {
                    return `"${value}" === "${compareValue}"`;
                });
                expression = expression.replace(/!=\s*["']?([^"'\s]+)["']?/g, (match, compareValue) => {
                    return `"${value}" !== "${compareValue}"`;
                });
            }
            
            // Evaluate expression using Function (safer than eval)
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
        this.adapter.log.debug('ScratchpadManager injected into PageRenderer');
    }
}

module.exports = PageRenderer;
