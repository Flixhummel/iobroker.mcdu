# MCDU Smart Home Controller - Status Summary

**Last Updated:** 2026-02-22
**Overall Status:** Display Enhancement complete -- 191 tests passing (180 unit + 11 integration)

---

## Quick Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Hardware** | DONE | MCDU-32-CAPTAIN fully functional |
| **Node.js Driver** | DONE | mcdu.js with per-line colors + brightness |
| **RasPi MQTT Client** | DONE | Running on Pi 1 Model B Rev 2 |
| **MQTT Integration** | DONE | Broker: 10.10.5.149:1883 |
| **ioBroker Adapter Foundation** | DONE | main.js, state tree, MQTT client |
| **Input System** | DONE | Scratchpad, validation, confirmation dialogs |
| **Business Logic (Phase 3)** | DONE | Rendering, pagination, function keys, splash |
| **Admin UI Redesign** | DONE | 4-tab layout, left/right line model |
| **UX Phases A-C** | DONE | Function keys, navigation, layout types |
| **Display Enhancement** | DONE | colLabel/colData, BRT/DIM, device states |
| **Unit Tests** | DONE | 191 tests passing |
| **Template Enhancement** | NOT STARTED | Phase 4 |
| **Hardware Deployment Test** | NOT STARTED | Phase 5 |

---

## What Was Just Completed (2026-02-19)

Adapter Phase 3: Business Logic -- all 8 steps implemented.

### Rendering Improvements
- **Even Row Sub-Labels** (Step 3.1): Sub-labels on rows 2/4/6/8/10 in `colLabel` color (defaults to device `defaultColor`)
- **Status Bar** (Step 3.2): Row 1 dedicated to breadcrumb + HH:MM time (colors from `pageNameColor` + `defaultColor`)
- **Page Pagination** (Step 3.4): Auto-splits pages with >6 items into sub-pages with X/Y indicator

### Navigation and Input
- **Function Key Handling** (Step 3.3): MENU, INIT, DIR, PREV_PAGE, NEXT_PAGE, FPLN, PERF all routed
- **ASCII-Safe Messages** (Step 3.7): All messages use ASCII-only characters for MCDU compatibility

### System Features
- **Live Data Re-Rendering** (Step 3.5): Periodic timer refreshes display (default 30s, configurable)
- **Startup Splash Screen** (Step 3.6): Branded splash for 3 seconds on device connection

### Testing
- **Unit Tests** (Step 3.8): 59 new tests across 3 new test files, total now 109

---

## Current Architecture

```
+-----------------------------------------------------------+
|                    ioBroker Server                         |
|                                                           |
|  +-------------------------------------------------+     |
|  |  iobroker.mcdu adapter (main.js)                |     |
|  |                                                 |     |
|  |  lib/mqtt/          - MQTT client, button sub   |     |
|  |  lib/rendering/     - Page renderer, display    |     |
|  |  lib/input/         - Scratchpad, validation    |     |
|  |  lib/state/         - State tree management     |     |
|  |  lib/templates/     - Template loader           |     |
|  +-----------------------+-------------------------+     |
+--------------------------|------------------------------+
                           | MQTT (10.10.5.149:1883)
                           |
              +------------+------------+
              |   Mosquitto Broker      |
              +------------+------------+
                           |
              +------------+---------------------------+
              |  Raspberry Pi 1 Model B Rev 2          |
              |  IP: 10.10.2.190                       |
              |                                        |
              |  mcdu-client.js (systemd service)      |
              |    - MQTT client                       |
              |    - Display rendering                 |
              |    - Button polling (50Hz)             |
              |    - LED control                       |
              |              |                         |
              |              | USB HID                 |
              |              v                         |
              |    MCDU-32-CAPTAIN Hardware             |
              |    14x24 display, 73 buttons, 11 LEDs  |
              +----------------------------------------+
```

---

## Adapter Module Overview

| Module | File | Purpose |
|--------|------|---------|
| MQTT Client | `lib/mqtt/MqttClient.js` | Broker connection, pub/sub, auto-reconnect |
| Button Subscriber | `lib/mqtt/ButtonSubscriber.js` | Button events, LSK mapping, function keys |
| State Tree | `lib/state/StateTreeManager.js` | ioBroker object tree, device registration |
| Page Renderer | `lib/rendering/PageRenderer.js` | Page config to 14x24 display, sub-labels, pagination |
| Display Publisher | `lib/rendering/DisplayPublisher.js` | MQTT display publishing, throttled (max 10/sec) |
| Scratchpad | `lib/input/ScratchpadManager.js` | Line 14 buffer, char input, validation display |
| Input Mode | `lib/input/InputModeManager.js` | State machine: normal, input, edit, confirm |
| Confirmation | `lib/input/ConfirmationDialog.js` | Soft (LSK) vs hard (OVFY) confirmation dialogs |
| Validation | `lib/input/ValidationEngine.js` | Keystroke, format, range, business validation |
| Templates | `lib/templates/TemplateLoader.js` | Pre-built page templates, template merging |

---

## Test Summary

```
npm test    -- runs all 191 tests (180 unit + 11 integration)

test/unit/pageRenderer.test.js       30 tests  (sub-labels, status bar, pagination)
test/unit/buttonSubscriber.test.js   19 tests  (button mapping, keypad, function keys)
test/unit/asciiSafeMessages.test.js  10 tests  (ASCII-safe messages)
test/unit/inputModeManager.test.js   24 tests  (metadata-driven LSK)
test/unit/ScratchpadManager.test.js  (scratchpad operations)
test/integration/                    (adapter startup tests)
test/package/                        (package validation)
```

---

## What Remains

### Adapter Phase 4: Admin UI Redesign
- Restructure `admin/jsonConfig.json` for better usability
- Not yet started

### Adapter Phase 4 (continued): Template System Enhancement
- State ID mapping (display fields to real ioBroker state IDs)
- Template preview functionality
- Not yet started

### Adapter Phase 5: Hardware Deployment and Testing
- Deploy to ioBroker dev server (iobroker-dev, SSH 10.10.5.65)
- Deploy to Raspberry Pi (mcdu-pi, SSH 10.10.2.190)
- End-to-end integration testing with real MCDU hardware
- Not yet started

---

## Technical Specs

### Hardware
- **Device:** WINWING MCDU-32-CAPTAIN
- **Vendor ID:** 0x4098 / **Product ID:** 0xbb36
- **Display:** 14 lines x 24 characters, 8 colors
- **Buttons:** 73 (12 LSK, 12 function, 26 letters, 10 numbers, 13 control)
- **LEDs:** 11 (9 indicators + 2 backlights)

### Display Constraints
- 14 lines x 24 characters
- 8 colors: white, amber, cyan, green, magenta, red, yellow, grey
- LSK buttons map to odd display rows (LSK1=row1, LSK2=row3, etc.)
- Row 13 reserved for status bar
- Row 14 reserved for scratchpad

### MQTT Topics (per device)
- `mcdu/{deviceId}/buttons/event` -- button presses (client to adapter)
- `mcdu/{deviceId}/display/set` -- full screen update (adapter to client)
- `mcdu/{deviceId}/display/line` -- single line update (adapter to client)
- `mcdu/{deviceId}/leds/set` -- all LEDs (adapter to client)
- `mcdu/{deviceId}/leds/single` -- single LED (adapter to client)
- `mcdu/{deviceId}/status/online` -- device presence (LWT)
- `mcdu/{deviceId}/status/ping` / `pong` -- health check

### Performance
- Button latency: <100ms (press to MQTT publish)
- Display latency: <50ms (MQTT receive to hardware)
- Display throttle: 100ms (max 10 updates/sec)
- Re-render interval: 30s (configurable)

---

## Commands

```bash
npm test                  # Run all 109 tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:watch        # Watch mode for unit tests
npm run lint              # ESLint
npm run check             # Lint + test combined
```
