'use strict';

/**
 * Generate a URL-friendly slug from a page name.
 * Maps German umlauts, strips non-alphanumeric chars, lowercases.
 * @param {string} name - Page name
 * @returns {string} Slugified ID
 */
function slugifyPageId(name) {
    return name
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

module.exports = { slugifyPageId };
