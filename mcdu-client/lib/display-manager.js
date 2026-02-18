/**
 * Display Manager - Buffers display changes and updates MCDU hardware
 */

class DisplayManager {
    constructor(mcdu) {
        this.mcdu = mcdu;
        this.lines = Array(14).fill('');
        this.colors = Array(14).fill('W');
        this.defaultColor = 'W';
    }

    /**
     * Set text for a specific line (buffered)
     */
    setLine(lineNum, text) {
        if (lineNum < 0 || lineNum >= 14) {
            console.warn(`Invalid line number: ${lineNum}`);
            return;
        }

        this.lines[lineNum] = text;
    }

    /**
     * Set color for a specific line (buffered)
     */
    setColor(lineNum, color) {
        if (lineNum < 0 || lineNum >= 14) {
            console.warn(`Invalid line number: ${lineNum}`);
            return;
        }

        // Validate color
        const validColors = ['L', 'A', 'W', 'B', 'G', 'M', 'R', 'Y', 'E'];
        const upperColor = color.toUpperCase();
        
        if (validColors.includes(upperColor)) {
            this.colors[lineNum] = upperColor;
        } else {
            console.warn(`Invalid color: ${color}, using default 'W'`);
            this.colors[lineNum] = 'W';
        }
    }

    /**
     * Apply all buffered changes to MCDU hardware
     */
    update() {
        try {
            // Update all lines in the MCDU's internal buffer
            for (let i = 0; i < 14; i++) {
                // Note: MCDU driver's setLine handles padding/truncating to 24 chars
                this.mcdu.setLine(i, this.lines[i], this.colors[i]);
            }

            // Push buffer to hardware
            // Using the first line's color as the default display color
            this.mcdu.updateDisplay(this.colors[0] || this.defaultColor);
            
            console.log('Display updated');
        } catch (err) {
            console.error('Error updating display:', err.message);
        }
    }

    /**
     * Clear entire display and reset buffer
     */
    clear() {
        try {
            this.lines = Array(14).fill('');
            this.colors = Array(14).fill('W');
            this.mcdu.clear();
            console.log('Display cleared');
        } catch (err) {
            console.error('Error clearing display:', err.message);
        }
    }

    /**
     * Get current line text (for debugging)
     */
    getLine(lineNum) {
        return this.lines[lineNum] || '';
    }

    /**
     * Get current line color (for debugging)
     */
    getColor(lineNum) {
        return this.colors[lineNum] || 'W';
    }

    /**
     * Get entire display state (for debugging)
     */
    getState() {
        return {
            lines: this.lines.slice(),
            colors: this.colors.slice()
        };
    }
}

module.exports = DisplayManager;
