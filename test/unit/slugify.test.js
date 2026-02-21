'use strict';

const { expect } = require('chai');
const { slugifyPageId } = require('../../lib/utils/slugify');

describe('slugifyPageId', () => {
    it('should lowercase and keep alphanumeric', () => {
        expect(slugifyPageId('Hauptmenu')).to.equal('hauptmenu');
    });

    it('should replace spaces with dashes', () => {
        expect(slugifyPageId('Wohnzimmer Licht')).to.equal('wohnzimmer-licht');
    });

    it('should map German umlauts', () => {
        expect(slugifyPageId('Küche')).to.equal('kueche');
        expect(slugifyPageId('Böden')).to.equal('boeden');
        expect(slugifyPageId('Türen')).to.equal('tueren');
        expect(slugifyPageId('Straße')).to.equal('strasse');
    });

    it('should strip special characters', () => {
        expect(slugifyPageId('Küche & Bad')).to.equal('kueche-bad');
        expect(slugifyPageId('Test (1)')).to.equal('test-1');
    });

    it('should trim leading/trailing dashes', () => {
        expect(slugifyPageId('--test--')).to.equal('test');
        expect(slugifyPageId('  spaces  ')).to.equal('spaces');
    });

    it('should collapse multiple non-alphanumeric chars to single dash', () => {
        expect(slugifyPageId('a   b')).to.equal('a-b');
        expect(slugifyPageId('a---b')).to.equal('a-b');
    });

    it('should return empty string for empty input', () => {
        expect(slugifyPageId('')).to.equal('');
    });

    it('should handle all-special-char input', () => {
        expect(slugifyPageId('!@#$%')).to.equal('');
    });

    it('should handle numbers', () => {
        expect(slugifyPageId('Raum 42')).to.equal('raum-42');
    });
});
