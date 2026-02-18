'use strict';

/**
 * Template loader for pre-built MCDU configurations
 * 
 * Provides access to built-in page templates for quick setup.
 * Templates can be loaded via admin UI to populate page configurations.
 * 
 * @author Kira Holt <kiraholtvi@gmail.com>
 */

class TemplateLoader {
    /**
     * @param {object} adapter - ioBroker adapter instance
     */
    constructor(adapter) {
        this.adapter = adapter;
        this.templates = this.loadTemplates();
    }
    
    /**
     * Load all built-in templates
     * @returns {object} Map of template ID to template data
     */
    loadTemplates() {
        const templates = {};
        
        try {
            templates['home'] = require('./home-automation.json');
            templates['climate'] = require('./climate-control.json');
            templates['lights'] = require('./lighting.json');
            
            this.adapter.log.debug(`Loaded ${Object.keys(templates).length} templates`);
        } catch (err) {
            this.adapter.log.error(`Failed to load templates: ${err.message}`);
        }
        
        return templates;
    }
    
    /**
     * Get template by ID
     * @param {string} templateId - Template identifier
     * @returns {object|null} Template data or null if not found
     */
    getTemplate(templateId) {
        const template = this.templates[templateId];
        
        if (!template) {
            this.adapter.log.warn(`Template '${templateId}' not found`);
            return null;
        }
        
        this.adapter.log.info(`Loading template: ${template.name}`);
        return template;
    }
    
    /**
     * Get list of available templates (for UI dropdown)
     * @returns {Array<object>} Array of template metadata
     */
    getTemplateList() {
        return Object.keys(this.templates).map(id => ({
            id: id,
            name: this.templates[id].name,
            description: this.templates[id].description,
            preview: this.templates[id].preview || null
        }));
    }
    
    /**
     * Merge template pages into existing configuration
     * @param {Array} existingPages - Current page configuration
     * @param {string} templateId - Template to merge
     * @returns {Array} Updated page configuration
     */
    mergeTemplate(existingPages, templateId) {
        const template = this.getTemplate(templateId);
        
        if (!template) {
            throw new Error(`Template '${templateId}' not found`);
        }
        
        // Get existing page IDs
        const existingIds = new Set(existingPages.map(p => p.id));
        
        // Add template pages that don't already exist
        const newPages = template.pages.filter(p => !existingIds.has(p.id));
        
        this.adapter.log.info(`Merging template '${template.name}': ${newPages.length} new pages`);
        
        return [...existingPages, ...newPages];
    }
}

module.exports = TemplateLoader;
