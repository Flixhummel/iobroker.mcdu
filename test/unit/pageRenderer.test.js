'use strict';

const { expect } = require('chai');
const PageRenderer = require('../../lib/rendering/PageRenderer');
const { createMockAdapter, createMockDisplayPublisher } = require('./testHelper');

describe('PageRenderer', () => {
    let adapter;
    let displayPublisher;
    let renderer;

    beforeEach(() => {
        adapter = createMockAdapter({
            pages: [
                {
                    id: 'home-main',
                    name: 'Home',
                    lines: [
                        {
                            row: 3,
                            left: { label: '', display: { type: 'label', text: 'WELCOME', color: 'white' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 5,
                            left: { label: 'TEMPERATUR', display: { type: 'label', text: '21.5 C', color: 'white' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 7,
                            left: { label: '', display: { type: 'label', text: 'LIGHTS', color: 'white' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                },
                {
                    id: 'long-page',
                    name: 'Long List',
                    lines: [
                        { row: 101, left: { label: '', display: { type: 'label', text: 'ITEM 1' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 102, left: { label: '', display: { type: 'label', text: 'ITEM 2' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 103, left: { label: '', display: { type: 'label', text: 'ITEM 3' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 104, left: { label: '', display: { type: 'label', text: 'ITEM 4' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 105, left: { label: '', display: { type: 'label', text: 'ITEM 5' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 106, left: { label: '', display: { type: 'label', text: 'ITEM 6' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 107, left: { label: '', display: { type: 'label', text: 'ITEM 7' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 108, left: { label: '', display: { type: 'label', text: 'ITEM 8' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } },
                        { row: 109, left: { label: '', display: { type: 'label', text: 'ITEM 9' }, button: { type: 'empty' } }, right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } } }
                    ]
                },
                {
                    id: 'sub-labels-page',
                    name: 'Sub Labels',
                    lines: [
                        {
                            row: 3,
                            left: { label: '', display: { type: 'label', text: 'TITLE' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 5,
                            left: { label: 'WOHNZIMMER', display: { type: 'label', text: '21.5 C' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 7,
                            left: { label: 'KUECHE', display: { type: 'label', text: '19.0 C' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 9,
                            left: { label: '', display: { type: 'label', text: 'NO SUB' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                },
                {
                    id: 'left-right-page',
                    name: 'Left Right',
                    lines: [
                        {
                            row: 3,
                            left: { label: 'LINKS', display: { type: 'label', text: 'Decke', color: 'white' }, button: { type: 'empty' } },
                            right: { label: 'RECHTS', display: { type: 'label', text: 'AN', color: 'green' }, button: { type: 'empty' } }
                        },
                        {
                            row: 5,
                            left: { label: '', display: { type: 'label', text: 'Only Left', color: 'white' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        },
                        {
                            row: 7,
                            left: { label: '', display: { type: 'empty' }, button: { type: 'empty' } },
                            right: { label: '', display: { type: 'label', text: 'Only Right', color: 'amber' }, button: { type: 'empty' } }
                        }
                    ]
                },
                {
                    id: 'old-format-page',
                    name: 'Old Format',
                    lines: [
                        {
                            row: 1,
                            subLabel: 'LEGACY',
                            display: { type: 'label', label: 'OLD FORMAT' },
                            leftButton: { type: 'empty' },
                            rightButton: { type: 'empty' }
                        }
                    ]
                }
            ]
        });
        displayPublisher = createMockDisplayPublisher();
        renderer = new PageRenderer(adapter, displayPublisher);
    });

    describe('Even Row Sub-Labels', () => {
        it('should render sub-labels on even rows for the next odd row', async () => {
            await renderer.renderPage('sub-labels-page');

            const lines = displayPublisher._published[0];
            // Row 4 (index 3) should have sub-label for row 5
            expect(lines[3].text).to.include('WOHNZIMMER');
            expect(lines[3].color).to.equal('cyan');

            // Row 6 (index 5) should have sub-label for row 7
            expect(lines[5].text).to.include('KUECHE');
            expect(lines[5].color).to.equal('cyan');
        });

        it('should render blank even rows when no sub-label is defined', async () => {
            await renderer.renderPage('sub-labels-page');

            const lines = displayPublisher._published[0];
            // Row 8 (index 7) — row 9 has no left.label
            expect(lines[7].text.trim()).to.equal('');
            expect(lines[7].color).to.equal('cyan');
        });

        it('should render all even rows (2,4,6,8,10,12) as cyan', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            const evenIndices = [1, 3, 5, 7, 9, 11]; // rows 2,4,6,8,10,12
            for (const idx of evenIndices) {
                expect(lines[idx].color).to.equal('cyan');
            }
        });

        it('should render both left and right sub-labels', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            // Row 2 (index 1) renders sub-label for row 3
            // Row 3 has left.label='LINKS' and right.label='RECHTS'
            expect(lines[1].text).to.include('LINKS');
            expect(lines[1].text).to.include('RECHTS');

            // Row 3 (index 2) should have left-right content
            const row3 = lines[2];
            expect(row3.text).to.include('Decke');
            expect(row3.text).to.include('AN');
        });
    });

    describe('Left/Right Column Rendering', () => {
        it('should compose left and right content in 24 chars', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            const row3 = lines[2]; // Row 3 (index 2)
            expect(row3.text.length).to.equal(24);
            // Left 12 chars should contain "Decke"
            const leftHalf = row3.text.substring(0, 12);
            expect(leftHalf).to.include('Decke');
            // Right 12 chars should contain "AN"
            const rightHalf = row3.text.substring(12);
            expect(rightHalf).to.include('AN');
        });

        it('should return segments when left and right colors differ', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            const row3 = lines[2]; // Row 3: left=white, right=green
            expect(row3.segments).to.be.an('array').with.length(2);
            expect(row3.segments[0].color).to.equal('white');
            expect(row3.segments[1].color).to.equal('green');
            expect(row3.segments[0].text).to.include('Decke');
            expect(row3.segments[1].text).to.include('AN');
        });

        it('should not return segments when only one side has content', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            const row5 = lines[4]; // Row 5: only left
            expect(row5.segments).to.be.undefined;
            const row7 = lines[6]; // Row 7: only right
            expect(row7.segments).to.be.undefined;
        });

        it('should not return segments when both sides have same color', async () => {
            adapter.config.pages.push({
                id: 'same-color-page',
                name: 'Same Color',
                lines: [
                    {
                        row: 3,
                        left: { label: '', display: { type: 'label', text: 'LEFT', color: 'green' }, button: { type: 'empty' } },
                        right: { label: '', display: { type: 'label', text: 'RIGHT', color: 'green' }, button: { type: 'empty' } }
                    }
                ]
            });

            await renderer.renderPage('same-color-page');

            const lines = displayPublisher._published[displayPublisher._published.length - 1];
            const row3 = lines[2];
            expect(row3.segments).to.be.undefined;
            expect(row3.color).to.equal('green');
        });

        it('should use full width when only left has content', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            const row5 = lines[4]; // Row 5 (index 4)
            expect(row5.text).to.include('Only Left');
            expect(row5.text.length).to.equal(24);
        });

        it('should right-align when only right has content', async () => {
            await renderer.renderPage('left-right-page');

            const lines = displayPublisher._published[0];
            const row7 = lines[6]; // Row 7 (index 6)
            expect(row7.text).to.include('Only Right');
            // Should be right-aligned
            expect(row7.text.trimStart()).to.equal('Only Right');
        });
    });

    describe('Status Bar (Row 1)', () => {
        it('should render status bar on row 1 (index 0)', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            const statusBar = lines[0];
            expect(statusBar.color).to.equal('cyan');
            expect(statusBar.text).to.include('HOME');
        });

        it('should include HH:MM time in status bar', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            const statusBar = lines[0];
            expect(statusBar.text).to.match(/\d{2}:\d{2}/);
        });

        it('should show page indicator when paginated', async () => {
            await renderer.renderPage('long-page');

            const lines = displayPublisher._published[0];
            const statusBar = lines[0];
            expect(statusBar.text).to.include('1/2');
        });

        it('should not show page indicator for single-page content', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            const statusBar = lines[0];
            expect(statusBar.text).to.not.match(/\d+\/\d+/);
        });

        it('should be exactly 24 characters wide', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            const statusBar = lines[0];
            expect(statusBar.text.length).to.equal(24);
        });
    });

    describe('renderStatusBar()', () => {
        it('should use page name in uppercase', () => {
            const result = renderer.renderStatusBar('home-main');
            expect(result.text).to.include('HOME');
            expect(result.color).to.equal('cyan');
        });

        it('should fallback to pageId if no name', () => {
            adapter.config.pages.push({ id: 'no-name-page', lines: [] });
            const result = renderer.renderStatusBar('no-name-page');
            expect(result.text).to.include('NO-NAME-PAGE');
        });

        it('should truncate long page names', () => {
            adapter.config.pages.push({ id: 'x', name: 'A Very Long Page Name That Exceeds', lines: [] });
            const result = renderer.renderStatusBar('x');
            expect(result.text.length).to.equal(24);
        });
    });

    describe('Breadcrumb Status Bar', () => {
        it('should show breadcrumb chain for nested pages', () => {
            adapter.breadcrumb = [
                { id: 'home-main', name: 'Home' },
                { id: 'klima-main', name: 'Klima' }
            ];
            const result = renderer.renderStatusBar('klima-main');
            expect(result.text).to.include('HOME > KLIMA');
            expect(result.color).to.equal('cyan');
        });

        it('should show just page name for root page', () => {
            adapter.breadcrumb = [{ id: 'home-main', name: 'Home' }];
            const result = renderer.renderStatusBar('home-main');
            expect(result.text).to.include('HOME');
            expect(result.color).to.equal('cyan');
        });

        it('should truncate long breadcrumbs', () => {
            adapter.breadcrumb = [
                { id: 'home', name: 'Hauptmenue' },
                { id: 'beleuchtung', name: 'Beleuchtung' },
                { id: 'wohnzimmer', name: 'Wohnzimmer' }
            ];
            const result = renderer.renderStatusBar('wohnzimmer');
            expect(result.text.length).to.equal(24);
        });

        it('should fall back to page name when no breadcrumb', () => {
            adapter.breadcrumb = undefined;
            const result = renderer.renderStatusBar('home-main');
            expect(result.text).to.include('HOME');
        });
    });

    describe('Pagination', () => {
        it('should paginate pages with >6 items', async () => {
            await renderer.renderPage('long-page');

            expect(renderer.totalPages).to.equal(2);
            expect(renderer.currentPageOffset).to.equal(0);
        });

        it('should not paginate pages with <=6 items', async () => {
            await renderer.renderPage('home-main');

            expect(renderer.totalPages).to.equal(1);
            expect(renderer.currentPageOffset).to.equal(0);
        });

        it('should render first 6 items on page 1', async () => {
            await renderer.renderPage('long-page');

            const lines = displayPublisher._published[0];
            // oddRows[0]=3 → index 2, oddRows[5]=13 → index 12
            expect(lines[2].text).to.include('ITEM 1');
            expect(lines[12].text).to.include('ITEM 6');
        });

        it('should render remaining items on page 2', async () => {
            renderer.currentPageOffset = 1;
            await renderer.renderPage('long-page');

            const lines = displayPublisher._published[0];
            // oddRows[0]=3 → index 2, oddRows[1]=5 → index 4, oddRows[2]=7 → index 6
            expect(lines[2].text).to.include('ITEM 7');
            expect(lines[4].text).to.include('ITEM 8');
            expect(lines[6].text).to.include('ITEM 9');
        });

        it('should clamp currentPageOffset to valid range', async () => {
            renderer.currentPageOffset = 99;
            await renderer.renderPage('long-page');

            expect(renderer.currentPageOffset).to.equal(1);
        });

        it('should reset pagination for non-paginated pages', async () => {
            renderer.currentPageOffset = 5;
            renderer.totalPages = 10;

            await renderer.renderPage('home-main');

            expect(renderer.totalPages).to.equal(1);
            expect(renderer.currentPageOffset).to.equal(0);
        });
    });

    describe('padOrTruncate', () => {
        it('should pad short text', () => {
            expect(renderer.padOrTruncate('abc', 6)).to.equal('abc   ');
        });

        it('should truncate long text', () => {
            expect(renderer.padOrTruncate('abcdef', 3)).to.equal('abc');
        });

        it('should return exact-length text unchanged', () => {
            expect(renderer.padOrTruncate('abc', 3)).to.equal('abc');
        });
    });

    describe('alignText', () => {
        it('should left-align by default', () => {
            const result = renderer.alignText('hi', 'left', 10);
            expect(result).to.equal('hi        ');
        });

        it('should right-align', () => {
            const result = renderer.alignText('hi', 'right', 10);
            expect(result).to.equal('        hi');
        });

        it('should center-align', () => {
            const result = renderer.alignText('hi', 'center', 10);
            expect(result).to.equal('    hi    ');
        });
    });

    describe('Navigation Indicators', () => {
        it('should add < > indicators on lines with navigation buttons', async () => {
            const pages = [
                {
                    id: 'test-nav',
                    name: 'Test Nav',
                    lines: [
                        {
                            row: 3,
                            left: {
                                label: '',
                                display: { type: 'label', text: 'LIGHTS' },
                                button: { type: 'navigation', action: 'goto', target: 'lights' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                }
            ];
            adapter.config.pages = pages;
            adapter.breadcrumb = [{ id: 'test-nav', name: 'Test Nav' }];

            await renderer.renderPage('test-nav');
            const display = displayPublisher._published[displayPublisher._published.length - 1];
            // Row 3 = index 2
            expect(display[2].text).to.match(/^</);
            expect(display[2].text).to.match(/>$/);
        });

        it('should NOT add < > indicators on lines without navigation buttons', async () => {
            const pages = [
                {
                    id: 'test-no-nav',
                    name: 'Test No Nav',
                    lines: [
                        {
                            row: 3,
                            left: {
                                label: '',
                                display: { type: 'label', text: 'INFO TEXT' },
                                button: { type: 'empty' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                }
            ];
            adapter.config.pages = pages;
            adapter.breadcrumb = [{ id: 'test-no-nav', name: 'Test No Nav' }];

            await renderer.renderPage('test-no-nav');
            const display = displayPublisher._published[displayPublisher._published.length - 1];
            // Row 3 = index 2
            expect(display[2].text).to.not.match(/^</);
        });

        it('should NOT add < > indicators on datapoint buttons', async () => {
            const pages = [
                {
                    id: 'test-dp',
                    name: 'Test DP',
                    lines: [
                        {
                            row: 3,
                            left: {
                                label: 'TEMP',
                                display: { type: 'datapoint', source: 'test.temp' },
                                button: { type: 'datapoint', target: 'test.temp' }
                            },
                            right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                        }
                    ]
                }
            ];
            adapter.config.pages = pages;
            adapter.breadcrumb = [{ id: 'test-dp', name: 'Test DP' }];

            await renderer.renderPage('test-dp');
            const display = displayPublisher._published[displayPublisher._published.length - 1];
            // Row 3 = index 2
            expect(display[2].text).to.not.match(/^</);
        });

        it('should add scroll indicators when paginated', async () => {
            const lines = [];
            for (let i = 1; i <= 9; i++) {
                lines.push({
                    row: 100 + i,
                    left: { label: '', display: { type: 'label', text: `ITEM ${i}` }, button: { type: 'empty' } },
                    right: { label: '', display: { type: 'empty' }, button: { type: 'empty' } }
                });
            }
            const pages = [{ id: 'test-scroll', name: 'Test Scroll', lines }];
            adapter.config.pages = pages;
            adapter.breadcrumb = [{ id: 'test-scroll', name: 'Test Scroll' }];

            // Page 1: should show v indicator at bottom but no ^ at top
            await renderer.renderPage('test-scroll');
            let display = displayPublisher._published[displayPublisher._published.length - 1];
            expect(display[1].text).to.not.include('^');
            expect(display[11].text).to.include('v');

            // Page 2: should show ^ at top but no v at bottom
            renderer.currentPageOffset = 1;
            await renderer.renderPage('test-scroll');
            display = displayPublisher._published[displayPublisher._published.length - 1];
            expect(display[1].text).to.include('^');
            expect(display[11].text).to.not.include('v');
        });
    });

    describe('Rendering Output', () => {
        it('should produce exactly 14 lines', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            expect(lines).to.have.length(14);
        });

        it('should have all lines at 24 chars', async () => {
            await renderer.renderPage('home-main');

            const lines = displayPublisher._published[0];
            for (const line of lines) {
                expect(line.text.length).to.equal(24);
            }
        });

        it('should render error page for unknown page ID', async () => {
            await renderer.renderPage('nonexistent');

            const lines = displayPublisher._published[0];
            const hasError = lines.some(l => l.text.includes('NICHT GEFUNDEN') && l.color === 'red');
            expect(hasError).to.be.true;
        });
    });
});
