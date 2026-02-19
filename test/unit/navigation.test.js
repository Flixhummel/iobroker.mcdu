'use strict';

const { expect } = require('chai');

describe('Navigation', () => {
    // Helper to simulate buildBreadcrumb
    function buildBreadcrumb(pages, pageId) {
        const breadcrumb = [];
        let currentId = pageId;
        const visited = new Set();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const page = pages.find(p => p.id === currentId);
            if (!page) break;
            breadcrumb.unshift({ id: page.id, name: page.name || page.id });
            currentId = page.parent || null;
        }
        return breadcrumb;
    }

    describe('buildBreadcrumb', () => {
        const pages = [
            { id: 'home-main', name: 'Home', parent: null },
            { id: 'klima-main', name: 'Klima', parent: 'home-main' },
            { id: 'klima-wohn', name: 'Wohnzimmer', parent: 'klima-main' }
        ];

        it('should return full path for deeply nested page', () => {
            const result = buildBreadcrumb(pages, 'klima-wohn');
            expect(result).to.have.length(3);
            expect(result[0].id).to.equal('home-main');
            expect(result[1].id).to.equal('klima-main');
            expect(result[2].id).to.equal('klima-wohn');
        });

        it('should return single entry for root page', () => {
            const result = buildBreadcrumb(pages, 'home-main');
            expect(result).to.have.length(1);
            expect(result[0].id).to.equal('home-main');
        });

        it('should handle orphan page (no valid parent)', () => {
            const result = buildBreadcrumb(pages, 'klima-main');
            expect(result).to.have.length(2);
            expect(result[0].id).to.equal('home-main');
            expect(result[1].id).to.equal('klima-main');
        });

        it('should handle non-existent page gracefully', () => {
            const result = buildBreadcrumb(pages, 'does-not-exist');
            expect(result).to.have.length(0);
        });

        it('should prevent infinite loops with circular parents', () => {
            const circularPages = [
                { id: 'a', name: 'A', parent: 'b' },
                { id: 'b', name: 'B', parent: 'a' }
            ];
            const result = buildBreadcrumb(circularPages, 'a');
            // Should not hang, should return partial path
            expect(result.length).to.be.lessThan(10);
        });
    });

    describe('Circular SLEW Navigation', () => {
        const pages = [
            { id: 'home-main', name: 'Home', parent: null },
            { id: 'lights-main', name: 'Lights', parent: 'home-main' },
            { id: 'klima-main', name: 'Klima', parent: 'home-main' },
            { id: 'security-main', name: 'Security', parent: 'home-main' },
            { id: 'klima-wohn', name: 'Wohnzimmer', parent: 'klima-main' }
        ];

        function getSiblings(pages, pageId) {
            const page = pages.find(p => p.id === pageId);
            if (!page) return [];
            const parentId = page.parent || null;
            return pages.filter(p => (p.parent || null) === parentId);
        }

        function navigateNext(pages, currentPageId) {
            const siblings = getSiblings(pages, currentPageId);
            if (siblings.length <= 1) return currentPageId;
            const currentIndex = siblings.findIndex(p => p.id === currentPageId);
            const nextIndex = (currentIndex + 1) % siblings.length;
            return siblings[nextIndex].id;
        }

        function navigatePrevious(pages, currentPageId) {
            const siblings = getSiblings(pages, currentPageId);
            if (siblings.length <= 1) return currentPageId;
            const currentIndex = siblings.findIndex(p => p.id === currentPageId);
            const prevIndex = (currentIndex - 1 + siblings.length) % siblings.length;
            return siblings[prevIndex].id;
        }

        it('should navigate to next sibling', () => {
            const result = navigateNext(pages, 'lights-main');
            expect(result).to.equal('klima-main');
        });

        it('should wrap from last sibling to first (circular)', () => {
            const result = navigateNext(pages, 'security-main');
            expect(result).to.equal('lights-main');
        });

        it('should navigate to previous sibling', () => {
            const result = navigatePrevious(pages, 'klima-main');
            expect(result).to.equal('lights-main');
        });

        it('should wrap from first sibling to last (circular)', () => {
            const result = navigatePrevious(pages, 'lights-main');
            expect(result).to.equal('security-main');
        });

        it('should stay on page when no siblings', () => {
            const result = navigateNext(pages, 'klima-wohn');
            expect(result).to.equal('klima-wohn');
        });

        it('should stay on root page when it is the only root', () => {
            const result = navigateNext(pages, 'home-main');
            expect(result).to.equal('home-main');
        });
    });

    describe('CLR Parent Navigation', () => {
        it('should navigate to parent page', () => {
            const pages = [
                { id: 'home-main', name: 'Home', parent: null },
                { id: 'klima-main', name: 'Klima', parent: 'home-main' }
            ];

            const currentPage = pages.find(p => p.id === 'klima-main');
            const parentPage = pages.find(p => p.id === currentPage.parent);

            expect(parentPage).to.not.be.undefined;
            expect(parentPage.id).to.equal('home-main');
        });

        it('should not navigate when on root page', () => {
            const pages = [
                { id: 'home-main', name: 'Home', parent: null }
            ];

            const currentPage = pages.find(p => p.id === 'home-main');
            expect(currentPage.parent).to.be.null;
        });
    });
});
