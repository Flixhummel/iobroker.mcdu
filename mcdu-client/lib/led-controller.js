/**
 * LED Controller - Controls MCDU LEDs
 */

class LEDController {
    constructor(mcdu) {
        this.mcdu = mcdu;
        
        // Valid LED names from MCDU driver
        this.validLEDs = [
            'BACKLIGHT',
            'SCREEN_BACKLIGHT',
            'FAIL',
            'FM',
            'MCDU',
            'MENU',
            'FM1',
            'IND',
            'RDY',
            'STATUS',
            'FM2'
        ];
    }

    /**
     * Set brightness for a specific LED
     * @param {string} ledName - LED name (e.g., "FAIL", "RDY")
     * @param {number} brightness - Brightness value (0-255)
     */
    set(ledName, brightness) {
        try {
            // Validate LED name
            const upperLedName = ledName.toUpperCase();
            if (!this.validLEDs.includes(upperLedName)) {
                console.warn(`Unknown LED: ${ledName}. Valid LEDs: ${this.validLEDs.join(', ')}`);
                return;
            }

            // Validate brightness
            const bright = parseInt(brightness, 10);
            if (isNaN(bright) || bright < 0 || bright > 255) {
                console.warn(`Invalid brightness for ${ledName}: ${brightness} (must be 0-255)`);
                return;
            }

            // Set LED
            this.mcdu.setLED(upperLedName, bright);
            console.log(`LED ${ledName} set to ${bright}`);
        } catch (err) {
            console.error(`Error setting LED ${ledName}:`, err.message);
        }
    }

    /**
     * Set all LEDs to the same brightness
     * @param {number} brightness - Brightness value (0-255)
     */
    setAll(brightness) {
        try {
            const bright = parseInt(brightness, 10);
            if (isNaN(bright) || bright < 0 || bright > 255) {
                console.warn(`Invalid brightness: ${brightness} (must be 0-255)`);
                return;
            }

            this.mcdu.setAllLEDs(bright);
            console.log(`All LEDs set to ${bright}`);
        } catch (err) {
            console.error('Error setting all LEDs:', err.message);
        }
    }

    /**
     * Turn off a specific LED
     * @param {string} ledName - LED name
     */
    off(ledName) {
        this.set(ledName, 0);
    }

    /**
     * Turn on a specific LED to full brightness
     * @param {string} ledName - LED name
     */
    on(ledName) {
        this.set(ledName, 255);
    }

    /**
     * Turn off all LEDs
     */
    allOff() {
        this.setAll(0);
    }

    /**
     * Turn on all LEDs to full brightness
     */
    allOn() {
        this.setAll(255);
    }

    /**
     * Get list of valid LED names
     */
    getValidLEDs() {
        return this.validLEDs.slice();
    }
}

module.exports = LEDController;
