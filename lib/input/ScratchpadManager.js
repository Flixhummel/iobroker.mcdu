'use strict';

/**
 * Scratchpad Manager
 * 
 * Manages Line 14 scratchpad input buffer for MCDU.
 * Handles character input, validation state, and visual feedback.
 * 
 * Features:
 *   - Store scratchpad content (string buffer)
 *   - Append characters from keypad events
 *   - Clear scratchpad (CLR key)
 *   - Validate format (numeric, text, time)
 *   - Visual representation with asterisk: "22.5*"
 *   - Color based on validation state (white/green/red/amber)
 * 
 * @author Kira Holt
 */

class ScratchpadManager {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} displayPublisher - DisplayPublisher instance
     */
    constructor(adapter, displayPublisher) {
        this.adapter = adapter;
        this.displayPublisher = displayPublisher;
        
        /** @type {string} Scratchpad content buffer */
        this.content = '';
        
        /** @type {boolean} Validation state */
        this.isValid = true;
        
        /** @type {string} Validation error message */
        this.errorMessage = null;
        
        /** @type {string} Current color (white|green|red|amber) */
        this.color = 'white';
        
        /** @type {number} Maximum scratchpad length */
        this.maxLength = 20;
        
        /** @type {string} Placeholder when empty */
        this.placeholder = '____________________';

        /** @type {NodeJS.Timeout|null} Render debounce timer */
        this.renderTimer = null;

        /** @type {number} Render debounce interval (ms) */
        this.renderDebounceMs = 80;

        /** @type {boolean} "Scratchpad full" error currently showing */
        this.fullErrorShowing = false;

        this.adapter.log.debug('ScratchpadManager initialized');
    }
    
    /**
     * Append character to scratchpad
     * @param {string} char - Character to append
     * @returns {boolean} True if appended, false if rejected
     */
    append(char) {
        // Check length limit
        if (this.content.length >= this.maxLength) {
            this.adapter.log.debug(`Scratchpad full (max ${this.maxLength} chars)`);
            return false;
        }
        
        // Append character
        this.content += char;
        this.adapter.log.debug(`Scratchpad append: "${char}" → "${this.content}"`);
        
        // Update ioBroker state
        this.adapter.setStateAsync('runtime.scratchpad', this.content, true);
        
        // Reset validation state (will be validated on LSK press)
        this.isValid = true;
        this.color = 'white';
        this.errorMessage = null;
        
        return true;
    }
    
    /**
     * Clear scratchpad content
     */
    clear() {
        this.content = '';
        this.isValid = true;
        this.color = 'white';
        this.errorMessage = null;
        this.fullErrorShowing = false;

        this.adapter.log.debug('Scratchpad cleared');

        // Update ioBroker state
        this.adapter.setStateAsync('runtime.scratchpad', '', true);
        this.adapter.setStateAsync('runtime.scratchpadValid', true, true);
    }
    
    /**
     * Get scratchpad content
     * @returns {string}
     */
    getContent() {
        return this.content;
    }
    
    /**
     * Set scratchpad content (for copy-to-scratchpad)
     * @param {string} value - Value to set
     */
    set(value) {
        this.content = String(value);
        this.isValid = true;
        this.color = 'amber'; // Amber indicates editing existing value
        this.errorMessage = null;
        
        this.adapter.log.debug(`Scratchpad set: "${value}"`);
        
        // Update ioBroker state
        this.adapter.setStateAsync('runtime.scratchpad', this.content, true);
    }
    
    /**
     * Check if scratchpad has content
     * @returns {boolean}
     */
    hasContent() {
        return this.content.length > 0;
    }
    
    /**
     * Get display representation (with asterisk)
     * @returns {string}
     */
    getDisplay() {
        if (this.content.length === 0) {
            return this.placeholder;
        }
        
        // Show content with asterisk indicator
        return `${this.content}*`;
    }
    
    /**
     * Get scratchpad color based on validation state
     * @returns {string}
     */
    getColor() {
        return this.color;
    }
    
    /**
     * Set validation state
     * @param {boolean} isValid - Is content valid?
     * @param {string|null} errorMessage - Error message if invalid
     */
    setValid(isValid, errorMessage = null) {
        this.isValid = isValid;
        this.errorMessage = errorMessage;
        
        // Update color based on validation state
        if (isValid) {
            this.color = 'green'; // Valid input
        } else {
            this.color = 'red'; // Invalid input
        }
        
        this.adapter.log.debug(`Scratchpad validation: ${isValid ? 'VALID' : 'INVALID'} ${errorMessage || ''}`);
        
        // Update ioBroker state
        this.adapter.setStateAsync('runtime.scratchpadValid', isValid, true);
    }
    
    /**
     * Get validation state
     * @returns {boolean}
     */
    getValid() {
        return this.isValid;
    }
    
    /**
     * Get error message
     * @returns {string|null}
     */
    getErrorMessage() {
        return this.errorMessage;
    }
    
    /**
     * Validate scratchpad content for a field
     * @param {object} fieldConfig - Field configuration with validation rules
     * @returns {object} Validation result {valid: boolean, error: string|null}
     */
    validate(fieldConfig) {
        // Handle null/undefined fieldConfig
        if (!fieldConfig) {
            return { valid: true, error: null };
        }
        
        const value = this.content;
        const rules = fieldConfig.validation || {};
        const inputType = fieldConfig.inputType || 'text';
        
        // Required check
        if (rules.required && value.length === 0) {
            return { valid: false, error: 'PFLICHTFELD' };
        }
        
        // Skip format validation if empty and not required
        if (value.length === 0) {
            return { valid: true, error: null };
        }
        
        // Format validation by input type
        if (inputType === 'numeric') {
            // Validate numeric format with comprehensive edge case handling
            const formatValidation = this.validateNumericFormat(value);
            if (!formatValidation.valid) {
                return formatValidation;
            }
            
            const num = parseFloat(value);
            
            // Range validation
            if (rules.min !== undefined && num < rules.min) {
                return { valid: false, error: `MINIMUM ${rules.min}` };
            }
            
            if (rules.max !== undefined && num > rules.max) {
                return { valid: false, error: `MAXIMUM ${rules.max}` };
            }
            
            // Step validation
            if (rules.step !== undefined) {
                const minVal = rules.min || 0;
                const remainder = (num - minVal) % rules.step;
                // Floating point tolerance: use 1% of step size or 0.001, whichever is smaller
                const tolerance = Math.min(rules.step * 0.01, 0.001);
                if (Math.abs(remainder) > tolerance && Math.abs(remainder - rules.step) > tolerance) {
                    return { valid: false, error: `SCHRITT ${rules.step}` };
                }
            }
        }
        
        else if (inputType === 'time') {
            // Time format validation (HH:MM)
            // Strict validation: hours 00-23, minutes 00-59, exactly 2 digits each
            // Rejects: 25:99 (invalid ranges), 8:3 (missing zero-padding), 8:30 (incomplete hour)
            const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
            if (!timeRegex.test(value)) {
                return { valid: false, error: 'FORMAT: HH:MM' };
            }
        }
        
        else if (inputType === 'text') {
            // Text length validation
            if (rules.maxLength && value.length > rules.maxLength) {
                return { valid: false, error: `MAX ${rules.maxLength} ZEICHEN` };
            }
            
            // Pattern validation (regex)
            if (rules.pattern) {
                const regex = new RegExp(rules.pattern);
                if (!regex.test(value)) {
                    return { valid: false, error: 'UNGÜLTIGES FORMAT' };
                }
            }
        }
        
        else if (inputType === 'select') {
            // Option validation
            if (rules.options && Array.isArray(rules.options)) {
                if (!rules.options.includes(value)) {
                    return { valid: false, error: 'UNGÜLTIGE AUSWAHL' };
                }
            }
        }
        
        // All validations passed
        return { valid: true, error: null };
    }
    
    /**
     * Validate numeric format with comprehensive edge case handling
     * 
     * Edge cases handled:
     *   - Multiple decimal points: "22.5.5" → INVALID
     *   - Standalone decimal: "." → INVALID
     *   - Trailing decimal only: "22." → INVALID
     *   - Leading decimal only: ".5" → INVALID
     *   - Scientific notation: "1e5" → INVALID (not supported in MCDU context)
     *   - Leading zeros: "0123" → INVALID (ambiguous, could be octal)
     *   - Valid cases: "22.5", "-10.5", "0", "-0", "22", "-22"
     * 
     * @param {string} value - Value to validate
     * @returns {object} Validation result {valid: boolean, error: string|null}
     */
    validateNumericFormat(value) {
        // Edge case: Check for multiple decimal points
        // Example: "22.5.5" should be rejected
        const decimalCount = (value.match(/\./g) || []).length;
        if (decimalCount > 1) {
            return { valid: false, error: 'UNGÜLTIGES FORMAT' };
        }
        
        // Edge case: Check for scientific notation
        // Example: "1e5", "2E10" should be rejected (not supported in MCDU)
        if (/[eE]/.test(value)) {
            return { valid: false, error: 'UNGÜLTIGES FORMAT' };
        }
        
        // Edge case: Check for leading zeros (ambiguous, could be octal)
        // Example: "0123" should be rejected, but "0", "0.5" are valid
        if (/^-?0\d+/.test(value)) {
            return { valid: false, error: 'UNGÜLTIGES FORMAT' };
        }
        
        // Main numeric format validation
        // Updated regex: requires at least one digit before or after decimal
        // Valid: "22", "22.5", "-22.5", "0", "-0"
        // Invalid: ".", "22.", ".5" (incomplete decimal notation)
        if (!/^-?\d+(\.\d+)?$/.test(value)) {
            // Allow intermediate states during input: "-" alone is valid (user typing negative number)
            if (value === '-') {
                return { valid: true, error: null };
            }
            return { valid: false, error: 'UNGÜLTIGES FORMAT' };
        }
        
        // Final check: Ensure parseFloat works and returns a valid number
        const num = parseFloat(value);
        if (isNaN(num)) {
            return { valid: false, error: 'UNGÜLTIGES FORMAT' };
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Render scratchpad to Line 14 via MQTT (debounced)
     * Coalesces rapid calls so only the latest state is published.
     * @param {string|null} overrideColor - Override color (optional)
     * @returns {Promise<void>}
     */
    async render(overrideColor = null) {
        // Cancel any pending render
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
        }

        return new Promise((resolve) => {
            this.renderTimer = setTimeout(async () => {
                this.renderTimer = null;
                const display = this.getDisplay();
                const color = overrideColor || this.getColor();

                this.adapter.log.debug(`Rendering scratchpad Line 14: "${display}" (${color})`);

                await this.displayPublisher.publishLine(14, display, color);
                resolve();
            }, this.renderDebounceMs);
        });
    }
    
    /**
     * Show error message on Line 13 (temporary, 3 seconds)
     * @param {string} message - Error message
     * @returns {Promise<void>}
     */
    async renderError(message) {
        this.adapter.log.debug(`Showing error on Line 13: ${message}`);
        
        // Publish error to Line 13
        await this.displayPublisher.publishLine(13, `ERR ${message}`, 'red');
        
        // Auto-clear after 3 seconds
        setTimeout(async () => {
            // Re-render current page to restore Line 13
            await this.adapter.renderCurrentPage();
        }, 3000);
    }
    
    /**
     * Show success message on Line 13 (temporary, 2 seconds)
     * @param {string} message - Success message
     * @returns {Promise<void>}
     */
    async renderSuccess(message = 'OK GESPEICHERT') {
        this.adapter.log.debug(`Showing success on Line 13: ${message}`);
        
        // Publish success to Line 13
        await this.displayPublisher.publishLine(13, message, 'green');
        
        // Auto-clear after 2 seconds
        setTimeout(async () => {
            // Re-render current page to restore Line 13
            await this.adapter.renderCurrentPage();
        }, 2000);
    }
    
    /**
     * Show placeholder when scratchpad is empty
     * @returns {Promise<void>}
     */
    async renderPlaceholder() {
        await this.render('white');
    }
}

module.exports = ScratchpadManager;

/**
 * UNIT TEST EXAMPLES (for future implementation):
 * 
 * Test 1: Append characters
 *   scratchpad.append('2') → content = "2"
 *   scratchpad.append('2') → content = "22"
 *   scratchpad.append('.') → content = "22."
 *   scratchpad.append('5') → content = "22.5"
 *   scratchpad.getDisplay() → "22.5*"
 * 
 * Test 2: Clear scratchpad
 *   scratchpad.content = "22.5"
 *   scratchpad.clear() → content = "", color = 'white'
 *   scratchpad.getDisplay() → "____"
 * 
 * Test 3: Validate numeric
 *   scratchpad.content = "22.5"
 *   scratchpad.validate({inputType: 'numeric', validation: {min: 16, max: 30}})
 *     → {valid: true, error: null}
 *   scratchpad.content = "35"
 *   scratchpad.validate({inputType: 'numeric', validation: {min: 16, max: 30}})
 *     → {valid: false, error: 'MAXIMUM 30'}
 * 
 * Test 4: Validate time
 *   scratchpad.content = "08:30"
 *   scratchpad.validate({inputType: 'time'})
 *     → {valid: true, error: null}
 *   scratchpad.content = "25:99"
 *   scratchpad.validate({inputType: 'time'})
 *     → {valid: false, error: 'FORMAT: HH:MM'}
 * 
 * Test 5: Set validation state
 *   scratchpad.setValid(true) → color = 'green'
 *   scratchpad.setValid(false, 'MAXIMUM 30') → color = 'red', errorMessage = 'MAXIMUM 30'
 */
