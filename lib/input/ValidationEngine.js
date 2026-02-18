'use strict';

/**
 * Validation Engine
 * 
 * Multi-level validation for MCDU input system.
 * Provides format, range, and business logic validation.
 * 
 * Validation Levels:
 *   Level 2: Format validation (numeric, time, text patterns)
 *   Level 3: Range validation (min/max, step constraints)
 *   Level 4: Business logic validation (custom rules)
 * 
 * @author Kira Holt
 */

class ValidationEngine {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        
        /** @type {Map<string, function>} Custom validators */
        this.customValidators = new Map();
        
        // Register built-in custom validators
        this.registerBuiltInValidators();
        
        /** @type {object} Error message templates */
        this.errorMessages = {
            required: 'PFLICHTFELD',
            invalidFormat: 'UNGÜLTIGES FORMAT',
            invalidNumber: 'UNGÜLTIGE ZAHL',
            invalidTime: 'FORMAT: HH:MM',
            invalidDate: 'FORMAT: DD.MM.YYYY',
            invalidChars: 'UNGÜLTIGE ZEICHEN',
            tooShort: 'ZU KURZ',
            tooLong: 'ZU LANG',
            belowMin: 'MINIMUM',
            aboveMax: 'MAXIMUM',
            invalidStep: 'SCHRITT',
            invalidOption: 'UNGÜLTIGE AUSWAHL',
            notFound: 'NICHT GEFUNDEN',
            alreadyExists: 'BEREITS VORHANDEN'
        };
        
        this.adapter.log.debug('ValidationEngine initialized');
    }
    
    /**
     * Register built-in custom validators
     * These are example validators that demonstrate business logic validation
     */
    registerBuiltInValidators() {
        // Example 1: Heating target < Cooling target
        this.registerCustomValidator('validateHeatingTarget', this.validateHeatingTarget.bind(this));
        
        // Example 2: Schedule time not in past
        this.registerCustomValidator('validateScheduleTime', this.validateScheduleTime.bind(this));
        
        // Example 3: Door unlock with alarm check
        this.registerCustomValidator('validateDoorUnlock', this.validateDoorUnlock.bind(this));
        
        this.adapter.log.debug('Built-in custom validators registered');
    }
    
    /**
     * Example Custom Validator 1: Heating Target
     * Validates that heating target is below cooling target
     * 
     * @param {object} field - Field configuration
     * @param {any} value - Value to validate
     * @param {object} adapter - Adapter instance
     * @returns {Promise<object>} {valid: boolean, error: string|null}
     */
    async validateHeatingTarget(field, value, adapter) {
        try {
            // Check if cooling target state exists
            const coolingSource = field.validation?.compareWith || 'climate.0.cooling.target';
            const coolingState = await adapter.getForeignStateAsync(coolingSource);
            
            if (!coolingState || coolingState.val === null || coolingState.val === undefined) {
                // No cooling target set - allow heating target
                return { valid: true, error: null };
            }
            
            const coolingTarget = parseFloat(coolingState.val);
            const heatingTarget = parseFloat(value);
            
            if (heatingTarget >= coolingTarget) {
                return {
                    valid: false,
                    error: `MAX KÜHLUNG: ${coolingTarget}°C`
                };
            }
            
            return { valid: true, error: null };
            
        } catch (error) {
            adapter.log.error(`validateHeatingTarget failed: ${error.message}`);
            // Fail-safe: allow value if validation fails
            return { valid: true, error: null };
        }
    }
    
    /**
     * Example Custom Validator 2: Schedule Time
     * Validates that scheduled time is not in the past (for today)
     * 
     * @param {object} field - Field configuration
     * @param {any} value - Value to validate (HH:MM format)
     * @param {object} adapter - Adapter instance
     * @returns {Promise<object>} {valid: boolean, error: string|null}
     */
    async validateScheduleTime(field, value, adapter) {
        try {
            // Parse time value (format: HH:MM)
            const [hour, minute] = value.split(':').map(Number);
            
            if (isNaN(hour) || isNaN(minute)) {
                return { valid: false, error: 'UNGÜLTIGE ZEIT' };
            }
            
            // Create date object for schedule time (today)
            const now = new Date();
            const scheduleTime = new Date();
            scheduleTime.setHours(hour, minute, 0, 0);
            
            // Check if schedule time is in the past
            if (scheduleTime < now) {
                return {
                    valid: false,
                    error: 'ZEIT IN VERGANGENHEIT'
                };
            }
            
            return { valid: true, error: null };
            
        } catch (error) {
            adapter.log.error(`validateScheduleTime failed: ${error.message}`);
            return { valid: true, error: null };
        }
    }
    
    /**
     * Example Custom Validator 3: Door Unlock
     * Validates that alarm is disarmed before allowing door unlock
     * 
     * @param {object} field - Field configuration
     * @param {any} value - Value to validate (boolean, true = unlock)
     * @param {object} adapter - Adapter instance
     * @returns {Promise<object>} {valid: boolean, error: string|null}
     */
    async validateDoorUnlock(field, value, adapter) {
        try {
            // Only validate if trying to unlock (value = true)
            if (!value) {
                return { valid: true, error: null };
            }
            
            // Check alarm state
            const alarmSource = field.validation?.checkAlarm || 'alarm.0.armed';
            const alarmState = await adapter.getForeignStateAsync(alarmSource);
            
            if (!alarmState) {
                // Alarm state not found - allow unlock (fail-safe)
                adapter.log.warn(`Alarm state not found: ${alarmSource}`);
                return { valid: true, error: null };
            }
            
            // Check if alarm is armed
            if (alarmState.val === true) {
                return {
                    valid: false,
                    error: 'ALARM AKTIV - ZUERST DEAKTIVIEREN'
                };
            }
            
            return { valid: true, error: null };
            
        } catch (error) {
            adapter.log.error(`validateDoorUnlock failed: ${error.message}`);
            return { valid: true, error: null };
        }
    }
    
    /**
     * Complete validation chain (runs all levels)
     * @param {string} value - Value to validate
     * @param {object} field - Field configuration
     * @param {object} adapter - Adapter instance (for business logic access)
     * @returns {Promise<object>} {valid: boolean, error: string|null}
     */
    async validate(value, field, adapter) {
        // Level 2: Format validation
        const formatResult = this.validateFormat(value, field.inputType || 'text');
        if (!formatResult.valid) {
            return formatResult;
        }
        
        // Convert to appropriate type for range validation
        let typedValue = value;
        if (field.inputType === 'numeric') {
            typedValue = parseFloat(value);
        }
        
        // Level 3: Range validation
        const rangeResult = this.validateRange(typedValue, field.validation || {});
        if (!rangeResult.valid) {
            return rangeResult;
        }
        
        // Level 4: Business logic validation (if custom validator specified)
        if (field.validation?.custom) {
            const businessResult = await this.validateBusinessLogic(field, typedValue, adapter);
            if (!businessResult.valid) {
                return businessResult;
            }
        }
        
        // All validations passed
        return { valid: true, error: null };
    }
    
    /**
     * Level 2: Format Validation
     * Checks if value matches expected format for input type
     * 
     * @param {string} value - Value to validate
     * @param {string} inputType - Input type (numeric|time|text|select|date)
     * @returns {object} {valid: boolean, error: string|null}
     */
    validateFormat(value, inputType) {
        switch (inputType) {
            case 'numeric':
                return this.validateNumericFormat(value);
            
            case 'time':
                return this.validateTimeFormat(value);
            
            case 'date':
                return this.validateDateFormat(value);
            
            case 'text':
                return this.validateTextFormat(value);
            
            case 'select':
                // Format validation not applicable for select (validated in range check)
                return { valid: true, error: null };
            
            default:
                // Unknown input type - default to text validation
                return this.validateTextFormat(value);
        }
    }
    
    /**
     * Validate numeric format
     * @param {string} value - Value to validate
     * @returns {object}
     */
    validateNumericFormat(value) {
        // Allow empty string (checked in required validation)
        if (value === '') {
            return { valid: true, error: null };
        }
        
        // Check if valid number
        const num = parseFloat(value);
        if (isNaN(num)) {
            return { valid: false, error: this.errorMessages.invalidNumber };
        }
        
        // Check for invalid patterns (multiple decimals, trailing dots, etc.)
        if (!/^-?\d+\.?\d*$/.test(value)) {
            return { valid: false, error: this.errorMessages.invalidFormat };
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Validate time format (HH:MM)
     * @param {string} value - Value to validate
     * @returns {object}
     */
    validateTimeFormat(value) {
        if (value === '') {
            return { valid: true, error: null };
        }
        
        // Time format: HH:MM (24-hour)
        const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
        if (!timeRegex.test(value)) {
            return { valid: false, error: this.errorMessages.invalidTime };
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Validate date format (DD.MM.YYYY)
     * @param {string} value - Value to validate
     * @returns {object}
     */
    validateDateFormat(value) {
        if (value === '') {
            return { valid: true, error: null };
        }
        
        // Date format: DD.MM.YYYY
        const dateRegex = /^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.\d{4}$/;
        if (!dateRegex.test(value)) {
            return { valid: false, error: this.errorMessages.invalidDate };
        }
        
        // Additional check: valid date (no 31.02.2026, etc.)
        const [day, month, year] = value.split('.').map(Number);
        const date = new Date(year, month - 1, day);
        
        if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
            return { valid: false, error: 'UNGÜLTIGES DATUM' };
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Validate text format
     * @param {string} value - Value to validate
     * @returns {object}
     */
    validateTextFormat(value) {
        // Check for control characters (invalid in text)
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x1F\x7F]/.test(value)) {
            return { valid: false, error: this.errorMessages.invalidChars };
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Level 3: Range Validation
     * Checks if value is within allowed range/constraints
     * 
     * @param {any} value - Value to validate (typed)
     * @param {object} rules - Validation rules
     * @returns {object} {valid: boolean, error: string|null}
     */
    validateRange(value, rules) {
        // Required check
        if (rules.required && (value === '' || value === null || value === undefined)) {
            return { valid: false, error: this.errorMessages.required };
        }
        
        // Skip range checks if empty and not required
        if (value === '' || value === null || value === undefined) {
            return { valid: true, error: null };
        }
        
        // Numeric range validation
        if (typeof value === 'number') {
            // Minimum value
            if (rules.min !== undefined && value < rules.min) {
                return { valid: false, error: `${this.errorMessages.belowMin} ${rules.min}` };
            }
            
            // Maximum value
            if (rules.max !== undefined && value > rules.max) {
                return { valid: false, error: `${this.errorMessages.aboveMax} ${rules.max}` };
            }
            
            // Step constraint
            if (rules.step !== undefined) {
                const minVal = rules.min || 0;
                const remainder = (value - minVal) % rules.step;
                if (Math.abs(remainder) > 0.001) { // Floating point tolerance
                    return { valid: false, error: `${this.errorMessages.invalidStep} ${rules.step}` };
                }
            }
        }
        
        // Text length validation
        if (typeof value === 'string') {
            // Minimum length
            if (rules.minLength && value.length < rules.minLength) {
                return { valid: false, error: `${this.errorMessages.tooShort} (MIN ${rules.minLength})` };
            }
            
            // Maximum length
            if (rules.maxLength && value.length > rules.maxLength) {
                return { valid: false, error: `${this.errorMessages.tooLong} (MAX ${rules.maxLength})` };
            }
            
            // Pattern validation (regex)
            if (rules.pattern) {
                const regex = new RegExp(rules.pattern);
                if (!regex.test(value)) {
                    return { valid: false, error: this.errorMessages.invalidFormat };
                }
            }
            
            // Options validation (select)
            if (rules.options && Array.isArray(rules.options)) {
                if (!rules.options.includes(value)) {
                    return { valid: false, error: this.errorMessages.invalidOption };
                }
            }
        }
        
        return { valid: true, error: null };
    }
    
    /**
     * Level 4: Business Logic Validation
     * Custom validation based on application logic
     * 
     * @param {object} field - Field configuration
     * @param {any} value - Value to validate
     * @param {object} adapter - Adapter instance (for state access)
     * @returns {Promise<object>} {valid: boolean, error: string|null}
     */
    async validateBusinessLogic(field, value, adapter) {
        const validatorName = field.validation?.custom;
        
        if (!validatorName) {
            return { valid: true, error: null };
        }
        
        // Check if custom validator exists
        const validator = this.customValidators.get(validatorName);
        if (!validator) {
            adapter.log.warn(`Custom validator not found: ${validatorName}`);
            return { valid: true, error: null }; // Don't block if validator missing
        }
        
        try {
            // Execute custom validator
            const result = await validator(field, value, adapter);
            return result;
        } catch (error) {
            adapter.log.error(`Custom validator ${validatorName} failed: ${error.message}`);
            return { valid: false, error: 'VALIDIERUNGSFEHLER' };
        }
    }
    
    /**
     * Register custom validator
     * @param {string} name - Validator name
     * @param {function} fn - Validator function (async, returns {valid, error})
     */
    registerCustomValidator(name, fn) {
        this.customValidators.set(name, fn);
        this.adapter.log.debug(`Custom validator registered: ${name}`);
    }
    
    /**
     * Get error message for error code
     * @param {string} errorCode - Error code
     * @param {object} context - Context data (min, max, etc.)
     * @returns {string}
     */
    getErrorMessage(errorCode, context = {}) {
        const template = this.errorMessages[errorCode] || 'FEHLER';
        
        // Apply context variables
        let message = template;
        if (context.min !== undefined) {
            message = `${message} ${context.min}`;
        }
        if (context.max !== undefined) {
            message = `${message} ${context.max}`;
        }
        if (context.step !== undefined) {
            message = `${message} ${context.step}`;
        }
        
        return message;
    }
}

module.exports = ValidationEngine;

/**
 * EXAMPLE CUSTOM VALIDATORS:
 * 
 * Example 1: Heating target < Cooling target
 * 
 * validationEngine.registerCustomValidator('validateHeatingTarget', async (field, value, adapter) => {
 *     // Check if heating target exceeds cooling target
 *     const coolingTarget = await adapter.getForeignStateAsync('climate.0.cooling.target');
 *     
 *     if (coolingTarget && value >= coolingTarget.val) {
 *         return { 
 *             valid: false, 
 *             error: `MAX KÜHLUNG: ${coolingTarget.val}°C` 
 *         };
 *     }
 *     
 *     return { valid: true, error: null };
 * });
 * 
 * Example 2: Schedule time not in past
 * 
 * validationEngine.registerCustomValidator('validateScheduleTime', async (field, value, adapter) => {
 *     const [hour, minute] = value.split(':').map(Number);
 *     const now = new Date();
 *     const scheduleTime = new Date();
 *     scheduleTime.setHours(hour, minute, 0, 0);
 *     
 *     if (scheduleTime < now) {
 *         return { 
 *             valid: false, 
 *             error: 'ZEIT IN VERGANGENHEIT' 
 *         };
 *     }
 *     
 *     return { valid: true, error: null };
 * });
 * 
 * Example 3: Unique scene name
 * 
 * validationEngine.registerCustomValidator('validateUniqueName', async (field, value, adapter) => {
 *     const scenes = await adapter.getStateAsync('scenes.list');
 *     const sceneNames = scenes?.val || [];
 *     
 *     if (sceneNames.includes(value)) {
 *         return { 
 *             valid: false, 
 *             error: 'NAME BEREITS VERGEBEN' 
 *         };
 *     }
 *     
 *     return { valid: true, error: null };
 * });
 * 
 * 
 * UNIT TEST EXAMPLES:
 * 
 * Test 1: Numeric format
 *   validateFormat('22.5', 'numeric') → {valid: true}
 *   validateFormat('22.5.5', 'numeric') → {valid: false, error: 'UNGÜLTIGES FORMAT'}
 * 
 * Test 2: Numeric range
 *   validateRange(22.5, {min: 16, max: 30}) → {valid: true}
 *   validateRange(35, {min: 16, max: 30}) → {valid: false, error: 'MAXIMUM 30'}
 * 
 * Test 3: Time format
 *   validateFormat('08:30', 'time') → {valid: true}
 *   validateFormat('25:99', 'time') → {valid: false, error: 'FORMAT: HH:MM'}
 * 
 * Test 4: Text length
 *   validateRange('Hello', {maxLength: 10}) → {valid: true}
 *   validateRange('This is too long', {maxLength: 10}) → {valid: false, error: 'ZU LANG (MAX 10)'}
 * 
 * Test 5: Step constraint
 *   validateRange(22.5, {min: 16, max: 30, step: 0.5}) → {valid: true}
 *   validateRange(22.3, {min: 16, max: 30, step: 0.5}) → {valid: false, error: 'SCHRITT 0.5'}
 */
