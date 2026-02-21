# MCDU Smart Home Controller - Progress Tracker

**Last Updated:** 2026-02-21
**Status:** Datapoint LSK Interaction working — toggle booleans, write values from scratchpad

---

## Project Status Overview

The project follows two levels of phasing:

1. **Project Phases** (1, 2, 2.5, 3, 3a, 3b) -- from hardware bring-up to ioBroker adapter creation
2. **Adapter Implementation Phases** (1-5) -- the internal phases of the ioBroker adapter itself (defined in `IMPLEMENTATION-PLAN.md`)

| Project Phase | Status | Completion |
|---------------|--------|------------|
| Phase 1: Hardware Testing | DONE | 2026-02-14 |
| Phase 2: Node.js Driver | DONE | 2026-02-14 |
| Phase 2.5: Physical Mapping | DONE | 2026-02-14 |
| Phase 3: Architecture Decision | DONE | 2026-02-14 |
| Phase 3a: RasPi MQTT Client | DONE | 2026-02-14 |
| Phase 3b: ioBroker Adapter | IN PROGRESS | ongoing |

| Adapter Phase (within 3b) | Status | Completion |
|----------------------------|--------|------------|
| Phase 1: Foundation (scaffold, MQTT, state tree) | DONE | 2026-02-16 |
| Phase 2: Input System (scratchpad, validation, confirmation) | DONE | 2026-02-16 |
| Phase 3: Business Logic (rendering, function keys, pagination) | DONE | 2026-02-19 |
| Phase 2 (Adapter): Admin UI Redesign + Left/Right Line Model | DONE | 2026-02-19 |
| Phase 4: Template System Enhancement | NOT STARTED | -- |
| Phase 5: Testing and Hardware Deployment | NOT STARTED | -- |

**Total Tests:** 191 (180 unit + 11 integration, all passing)

---

## Datapoint LSK Interaction (2026-02-21)

Metadata-driven LSK interaction — no manual `editable` flags needed. The adapter reads `obj.common.write`, `obj.common.type`, `obj.common.min/max` from ioBroker object metadata.

### Feature: Metadata-driven toggle/write (commit 2112a2a)
- `datapointMeta` Map cache in main.js, populated from ioBroker object metadata
- Boolean datapoints → immediate toggle on LSK press (no scratchpad)
- Number/string datapoints → validate scratchpad content, write to ioBroker
- Read-only datapoints → LSK does nothing
- Airbus error pattern: FORMAT ERROR / ENTRY OUT OF RANGE shown in scratchpad (white)
- CLR after error → restores rejected input for editing
- Simplified state machine: NORMAL↔INPUT only (removed EDIT mode)

### Fix: Admin UI stale button targets (commits ba7ede3, 09e5e5f)
- Admin UI saves `button.type='datapoint'` with empty/stale target
- `isActionableButton()` requires truthy target for datapoint/navigation buttons
- Datapoint display takes priority over datapoint button (prevents stale target execution)

### Fix: Display glitch after value write (commit 9574871)
- Removed GESPEICHERT success message — raced with full page render via onStateChange
- Removed all write-only runtime states (eliminated "has no existing object" warnings)
- Removed vestigial per-line display state writes from PageRenderer

### Fix: Button debounce (commit 2e56811)
- Increased debounce from 200ms to 300ms — DOT button bounced at 243ms
- Removed per-line display state writes from PageRenderer (db0d375)

### Files Modified
- `main.js` — datapointMeta cache, removed uptime interval, removed runtime state init
- `lib/input/InputModeManager.js` — complete rewrite for metadata-driven LSK
- `lib/input/ScratchpadManager.js` — Airbus error pattern, removed runtime state writes
- `lib/rendering/PageRenderer.js` — removed edit indicators, removed per-line state writes
- `lib/mqtt/ButtonSubscriber.js` — increased debounce, removed runtime state writes
- `test/unit/inputModeManager.test.js` — NEW, 24 tests
- `test/unit/ScratchpadManager.test.js` — 4 new Airbus error pattern tests
- `docs/PAGE-CONFIGURATION-GUIDE.md` — rewritten for current left/right model

---

## Bug Fixes (2026-02-19, commit 298ede5)

Three critical bugs were identified and fixed during integration testing.

### Bug Fix 1: MQTT Topic Prefix Check (lib/mqtt/MqttClient.js)

**Root cause:** The `topic.startsWith(this.topicPrefix)` check in `publish()`, `subscribe()`, and `unsubscribe()` could match device IDs that happened to start with the prefix string. For example, a device ID of `mcdu-client-mcdu-pi` starts with `mcdu` (the topicPrefix), so the prefix was not added, resulting in the wrong topic `mcdu-client-mcdu-pi/display/set` instead of the correct `mcdu/mcdu-client-mcdu-pi/display/set`.

**Fix:** Changed all three methods to check `topic.startsWith(\`${this.topicPrefix}/\`)` (with trailing slash). This ensures the prefix check only matches when the topic actually begins with the full prefix segment, not just a partial string match.

**Affected lines:** publish (line 171), subscribe (line 203), unsubscribe (line 243).

### Bug Fix 2: Admin UI jsonConfig Errors (admin/jsonConfig.json)

**Root cause:** Multiple unsupported ioBroker jsonConfig features were used, causing errors in the Admin UI:
- `"pattern"` property is not valid on `text` type inputs
- `"disabled": "${!data.selectedDevice}"` -- the `!` negation operator is not supported in jsonConfig expressions
- `"hidden": "${data.left.display.type === 'empty'}"` -- nested panel paths do not resolve in table context
- `"jsonData": "...${JSON.stringify(data.pages)}"` -- JavaScript functions are not supported in jsonConfig expressions

**Fix:** Removed all unsupported properties and expressions. Changed `saveDevicePages` to use `useNative: true` instead of embedding JS functions in jsonData expressions.

### Bug Fix 3: main.js handleSaveDevicePages

**Root cause:** The `handleSaveDevicePages` sendTo handler only supported receiving `{deviceId, pages}` directly, but the Admin UI with `useNative: true` sends the entire native config object.

**Fix:** Updated the handler to support both formats -- direct `{deviceId, pages}` and `useNative` format (entire native config with `selectedDevice` and `pages` fields).

---

## What Was Completed in Adapter Phase 2: Admin UI Redesign (2026-02-19)

The Admin UI was completely redesigned with a 3-tab layout and a new left/right line data model.

### Left/Right Line Data Model

- **Old format:** `{ row, subLabel, leftButton, display, rightButton }`
- **New format:** `{ row, left: { label, display, button }, right: { label, display, button } }`
- Backward compatibility via `lib/utils/lineNormalizer.js` (converts old to new on-the-fly)
- Left content: left-aligned chars 1-12 (or full 24 if right side is empty)
- Right content: right-aligned chars 13-24 (or full 24 if left side is empty)

### Per-Device Page Storage

- Pages stored in `devices.{deviceId}.config.pages` (JSON state in ioBroker)
- sendTo commands: `loadDevicePages`, `saveDevicePages`
- Migration: on first device connect, copies `native.pages` to the device state
- Active device pages loaded into `config.pages` on connect/reconnect

### Admin UI Tabs

1. **General Settings** -- MQTT broker configuration
2. **Device and Pages** -- device selector, load/save, pages accordion with left/right line editor
3. **Advanced and About** -- performance settings, adapter info

### Key Files Modified

- `lib/utils/lineNormalizer.js` -- NEW: old/new format conversion
- `lib/rendering/PageRenderer.js` -- left/right column composition
- `lib/mqtt/ButtonSubscriber.js` -- getButtonConfig() supports both formats
- `lib/input/InputModeManager.js` -- handleLSK() supports both formats
- `main.js` -- loadDevicePages/saveDevicePages handlers, migration logic
- `lib/state/StateTreeManager.js` -- createDeviceConfig()
- `admin/jsonConfig.json` -- 3-tab device-centric layout
- `io-package.json` -- native.pages migrated to new format
- `lib/templates/*.json` -- all migrated to left/right model

---

## What Was Completed in Adapter Phase 3 (2026-02-19)

Adapter Phase 3 focused on advanced rendering, navigation, and display polish. All steps (3.1 through 3.8) are complete.

### Step 3.1: Even Row Sub-Labels

**File:** `lib/rendering/PageRenderer.js`

Even display rows (2, 4, 6, 8, 10) now render cyan sub-labels sourced from the next odd row's `subLabel` field. If no sub-label is configured, the even row remains blank with cyan color. This follows real MCDU conventions where label rows sit above their data rows.

### Step 3.2: Status Bar (Row 13)

**File:** `lib/rendering/PageRenderer.js`

Row 13 is now a dedicated status bar and is no longer page-configurable. It shows:
- Page name (left-aligned)
- Pagination indicator "X/Y" (center, only when page count > 1)
- Current time HH:MM (right-aligned)
- All in cyan

New method: `renderStatusBar(pageId)`.

### Step 3.3: Function Key Handling

**File:** `lib/mqtt/ButtonSubscriber.js`

Full `handleFunctionKey()` implementation with switch/case routing:

| Key | Action |
|-----|--------|
| MENU | Navigate to home page |
| INIT | Navigate to status page |
| DIR | Use scratchpad content as page ID for direct navigation |
| PREV_PAGE | Previous pagination sub-page or sequential page |
| NEXT_PAGE | Next pagination sub-page or sequential page |
| FPLN | Navigate to scenes page |
| PERF | Navigate to performance page |

PREV_PAGE and NEXT_PAGE were added to the function keys list. All function keys except PREV/NEXT clear edit mode on activation.

### Step 3.4: Page Pagination

**File:** `lib/rendering/PageRenderer.js`

Pages with more than 6 display items are automatically split into sub-pages:
- New properties: `currentPageOffset`, `totalPages`
- Paginated items are remapped to display rows [1, 3, 5, 7, 9, 11]
- Status bar (row 13) shows "X/Y" page indicator when `totalPages > 1`
- Pagination filter collects all items with display content, not just those on standard odd rows

### Step 3.5: Live Data Re-Rendering

**File:** `main.js`

Added a periodic re-render timer that refreshes the current page at a configurable interval:
- Config key: `config.performance.reRenderInterval`
- Default: 30000 ms (30 seconds)
- Timer is cleaned up in `onUnload()`

### Step 3.6: Startup Splash Screen

**File:** `main.js`

New `showSplashScreen(deviceId)` method displays a branded splash on device connection:
- "MCDU SMART HOME" (cyan)
- "INITIALIZING" (amber)
- Version number and current time (white)
- Displayed for 3 seconds before the first page renders
- Called from `handleDeviceAnnouncement()` for both new and reconnecting devices

### Step 3.7: ASCII-Safe Messages

**Files:** `lib/input/ScratchpadManager.js`, `lib/input/InputModeManager.js`, `lib/input/ConfirmationDialog.js`

All user-facing messages now use only ASCII characters compatible with the MCDU's limited character set:
- `renderError()` uses "ERR" prefix instead of a cross mark symbol
- `renderSuccess()` uses "OK GESPEICHERT" instead of a check mark symbol
- `insertFromScratchpad()` success message changed to "OK GESPEICHERT"
- Confirmation warning lines use "!!" prefix instead of a warning symbol

### Step 3.8: Unit Tests

New test files created with comprehensive coverage:

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/testHelper.js` | -- | Mock adapter, display publisher, MQTT client helpers |
| `test/unit/pageRenderer.test.js` | 30 | Sub-labels, status bar, pagination, alignment, rendering |
| `test/unit/buttonSubscriber.test.js` | 19 | Button mapping, keypad, function keys, event handling |
| `test/unit/asciiSafeMessages.test.js` | 10 | ASCII-safe error, success, and warning messages |

Additionally, a pre-existing require path bug in `test/unit/ScratchpadManager.test.js` was fixed.

**Test totals:** 109 tests, all passing.

---

## Previously Completed Adapter Phases

### Adapter Phase 1: Foundation (2026-02-16)

Scaffold and core infrastructure:
- ioBroker adapter structure (`main.js`, `io-package.json`, `package.json`)
- `lib/mqtt/MqttClient.js` -- MQTT broker connection with auto-reconnect
- `lib/mqtt/ButtonSubscriber.js` -- Button event subscription and LSK row mapping
- `lib/state/StateTreeManager.js` -- ioBroker object tree, device registration
- `lib/rendering/PageRenderer.js` -- Page config to 14x24 char display lines
- `lib/rendering/DisplayPublisher.js` -- MQTT display publishing with throttling
- Admin UI (`admin/jsonConfig.json`) with translations (en/de)

### Adapter Phase 2: Input System (2026-02-16)

Full aviation-style input system:
- `lib/input/ScratchpadManager.js` -- Line 14 scratchpad buffer
- `lib/input/InputModeManager.js` -- State machine: normal, input, edit, confirm
- `lib/input/ConfirmationDialog.js` -- Soft confirm (LSK) vs hard confirm (OVFY)
- `lib/input/ValidationEngine.js` -- Multi-level validation (keystroke, format, range, business)
- `lib/templates/TemplateLoader.js` -- Pre-built page templates and template merging

### Adapter Phase 4.1: Automation States (2026-02-16)

32 new ioBroker states for external automation:
- LED control states (11 LEDs)
- Scratchpad control states (4)
- Notification states (5)
- Button trigger states (3)
- Navigation states (4)
- Extended runtime states (5)

---

## Remaining Work

### Adapter Phase 4: Template System Enhancement

- State ID mapping (connecting display fields to real ioBroker state IDs)
- Template preview functionality
- Not yet started.

### Hardware Deployment (Phase 5 in IMPLEMENTATION-PLAN.md)

- Deploy and test on ioBroker dev server (iobroker-dev, 10.10.5.65)
- Deploy and test on Raspberry Pi (mcdu-pi, 10.10.2.190)
- End-to-end integration testing with real MCDU hardware

---

## Files Modified in Bug Fix Session (2026-02-19, commit 298ede5)

### Modified
- `lib/mqtt/MqttClient.js` -- MQTT topic prefix check (trailing slash fix)
- `admin/jsonConfig.json` -- Removed unsupported jsonConfig properties/expressions
- `main.js` -- handleSaveDevicePages dual-format support

---

## Files Modified in Phase 2 Admin UI Session (2026-02-19)

### Modified
- `lib/rendering/PageRenderer.js` -- left/right column composition
- `lib/mqtt/ButtonSubscriber.js` -- getButtonConfig() both formats
- `lib/input/InputModeManager.js` -- handleLSK() both formats
- `main.js` -- loadDevicePages/saveDevicePages, migration
- `lib/state/StateTreeManager.js` -- createDeviceConfig()
- `admin/jsonConfig.json` -- 3-tab device-centric layout
- `io-package.json` -- native.pages new format
- `lib/templates/*.json` -- all migrated to left/right model

### Created
- `lib/utils/lineNormalizer.js` -- old/new format conversion

---

## Files Modified in Phase 3 Session (2026-02-19)

### Modified
- `lib/rendering/PageRenderer.js` -- Sub-labels, status bar, pagination
- `lib/mqtt/ButtonSubscriber.js` -- Function key handling
- `lib/input/ScratchpadManager.js` -- ASCII-safe messages
- `lib/input/InputModeManager.js` -- ASCII-safe messages
- `lib/input/ConfirmationDialog.js` -- ASCII-safe messages
- `main.js` -- Splash screen, live re-render timer

### Created
- `test/unit/testHelper.js` -- Shared test mocks and helpers
- `test/unit/pageRenderer.test.js` -- PageRenderer unit tests (30)
- `test/unit/buttonSubscriber.test.js` -- ButtonSubscriber unit tests (19)
- `test/unit/asciiSafeMessages.test.js` -- ASCII-safe message tests (10)

---

## Earlier Project Phases (Hardware and Client)

### Phase 1: Hardware Testing (2026-02-14, 2h)

- Protocol reverse-engineered for WINWING MCDU-32-CAPTAIN
- Display: 14 lines x 24 chars, 8 colors verified
- Buttons: 73 buttons detected
- LEDs: 11 LEDs working
- Key discovery: 18 init packets needed to wake display

### Phase 2: Node.js Driver (2026-02-14, 4h)

- Full-screen buffer approach (all 14 lines sent at once)
- `mcdu.js` driver with display, button, and LED APIs
- All 8 colors working
- Critical insight from alha847/winwing_mcdu repository

### Phase 2.5: Physical Mapping (2026-02-14, 20min)

- 73 buttons mapped to standard MCDU labels
- 11 LEDs mapped (names match protocol exactly)
- `button-map.json` created

### Phase 3: Architecture Decision (2026-02-14, 30min)

- MQTT-based hybrid architecture chosen
- RasPi = dumb terminal, ioBroker = smart server
- Modeled after Zigbee/Tasmota patterns

### Phase 3a: RasPi MQTT Client (2026-02-14, 3h)

- `mcdu-client/mcdu-client.js` -- complete implementation (~550 lines)
- Systemd service, auto-reconnect, mock mode
- Deployed and running on Pi 1 Model B Rev 2
- 5 critical bugs fixed during deployment

---

## Key Files Reference

### Adapter Core
- `main.js` -- Adapter entry point
- `lib/mqtt/MqttClient.js` -- MQTT connection
- `lib/mqtt/ButtonSubscriber.js` -- Button event handling
- `lib/state/StateTreeManager.js` -- ioBroker state tree
- `lib/rendering/PageRenderer.js` -- Display rendering
- `lib/rendering/DisplayPublisher.js` -- MQTT display publishing
- `lib/input/ScratchpadManager.js` -- Scratchpad buffer
- `lib/input/InputModeManager.js` -- Input state machine
- `lib/input/ConfirmationDialog.js` -- Confirmation dialogs
- `lib/input/ValidationEngine.js` -- Input validation
- `lib/templates/TemplateLoader.js` -- Template management

### RasPi Client
- `mcdu-client/mcdu-client.js` -- Main client
- `mcdu-client/lib/mcdu.js` -- Hardware driver

### Tests
- `test/unit/pageRenderer.test.js` -- 30 tests
- `test/unit/buttonSubscriber.test.js` -- 19 tests
- `test/unit/asciiSafeMessages.test.js` -- 10 tests
- `test/unit/ScratchpadManager.test.js` -- Scratchpad tests

### Configuration
- `io-package.json` -- Adapter metadata and native config defaults
- `admin/jsonConfig.json` -- Admin UI schema

---

## References

**Hardware:**
- WinWing MCDU-32-CAPTAIN (VendorID 0x4098, ProductID 0xbb36)

**Code References:**
- [schenlap/winwing_mcdu](https://github.com/schenlap/winwing_mcdu) -- Python reference (init sequence)
- [alha847/winwing_mcdu](https://github.com/alha847/winwing_mcdu) -- Full-screen buffer approach

**ioBroker:**
- [Adapter Development Guide](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [JSON Config Documentation](https://github.com/ioBroker/adapter-react-v5)
