#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Simple translation management script
 * Syncs all translation files to ensure all keys exist in all languages
 */

const i18nDir = path.join(__dirname, '..', 'admin', 'i18n');
const languages = ['en', 'de'];

function loadTranslations(lang) {
    const filePath = path.join(i18nDir, `${lang}.json`);
    if (!fs.existsSync(filePath)) {
        console.log(`Creating new translation file: ${lang}`);
        return {};
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveTranslations(lang, data) {
    const filePath = path.join(i18nDir, `${lang}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`Saved: ${filePath}`);
}

function getAllKeys(translations) {
    const keys = new Set();
    Object.values(translations).forEach((trans) => {
        Object.keys(trans).forEach((key) => keys.add(key));
    });
    return Array.from(keys).sort();
}

function syncTranslations() {
    console.log('Loading translations...');

    // Load all translations
    const translations = {};
    languages.forEach((lang) => {
        translations[lang] = loadTranslations(lang);
    });

    // Get all unique keys
    const allKeys = getAllKeys(translations);
    console.log(`Found ${allKeys.length} translation keys`);

    // Ensure all languages have all keys
    let updated = false;
    languages.forEach((lang) => {
        allKeys.forEach((key) => {
            if (!(key in translations[lang])) {
                // Use English as fallback, or key itself
                translations[lang][key] = translations['en']?.[key] || `[${key}]`;
                console.log(`Added missing key "${key}" to ${lang}`);
                updated = true;
            }
        });
    });

    if (updated) {
        // Save all translations
        languages.forEach((lang) => {
            saveTranslations(lang, translations[lang]);
        });
        console.log('✅ Translations synced successfully');
    } else {
        console.log('✅ All translations are already in sync');
    }
}

// Run sync
syncTranslations();
