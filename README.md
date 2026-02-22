![Logo](admin/mcdu.png)
# ioBroker.mcdu

[![NPM version](https://img.shields.io/npm/v/iobroker.mcdu.svg)](https://www.npmjs.com/package/iobroker.mcdu)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mcdu.svg)](https://www.npmjs.com/package/iobroker.mcdu)
![Number of Installations](https://iobroker.live/badges/mcdu-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/mcdu-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.mcdu.png?downloads=true)](https://nodei.co/npm/iobroker.mcdu/)

**Tests:** ![Test and Release](https://github.com/Flixhummel/mcdu/workflows/Test%20and%20Release/badge.svg)

## MCDU Smart Home Adapter for ioBroker

Control your smart home through a WINWING MCDU-32-CAPTAIN aviation cockpit display via MQTT. The adapter provides an authentic airline-style interface with scratchpad input, page navigation, confirmation dialogs, and a 14x24 character display with 8 colors.

### Architecture

```
ioBroker Adapter (main.js)  <-->  MQTT Broker  <-->  RasPi Client (mcdu-client/)  <-->  USB HID Hardware
```

The ioBroker adapter runs all business logic (page rendering, input handling, validation). The Raspberry Pi client is a "dumb terminal" that bridges MQTT messages to the USB HID hardware -- it contains no business logic.

### Features

- **14x24 character display** with 8 colors (white, amber, cyan, green, magenta, red, yellow, grey)
- **73 buttons** including 12 Line Select Keys, 12 function keys, full alphanumeric keypad
- **11 LEDs** (9 indicators + 2 backlights with BRT/DIM brightness control)
- **Per-line color control**: independent colLabel and colData colors, per-page status bar color
- **Aviation-style input**: scratchpad on line 14, LSK-based field selection, OVFY confirmation
- **Page system**: configurable pages with sub-labels, automatic pagination, layout types (menu/data/list)
- **Function keys**: 11 configurable keys (MENU, INIT, DIR, FPLN, PERF, etc.) with per-device mapping
- **Navigation**: parent hierarchy, breadcrumb status bar, circular SLEW, CLR-to-parent
- **Validation engine**: keystroke, format, range, and business logic validation levels
- **Confirmation dialogs**: soft (LSK or OVFY) and hard (OVFY only) for critical actions
- **Multi-device support**: multiple MCDUs via per-device MQTT topic namespaces
- **32 automation states**: LED control, scratchpad, notifications, button triggers from ioBroker scripts

### Development Status

| Phase | Status |
|-------|--------|
| Adapter Foundation (MQTT, state tree, display) | Done |
| Input System (scratchpad, validation, confirmation) | Done |
| Business Logic (rendering, pagination, function keys) | Done |
| Admin UI Redesign + Left/Right Line Model | Done |
| UX Phases A-C (function keys, navigation, layout types) | Done |
| Display Enhancement (color split, brightness, device states) | Done |
| Hardware Deployment Testing | Not started |

191 tests passing (180 unit + 11 integration).

### Recommended Hardware (mcdu-client)

The mcdu-client is a lightweight Node.js process (~50-100MB RAM) that bridges MQTT to USB HID. It needs WiFi, a USB Host port with libusb support, and enough USB power for the MCDU (~500mA).

| Board | Price | WiFi | USB Host | Verdict |
|-------|-------|------|----------|---------|
| **Raspberry Pi 4 (1-2GB)** | $35-45 | Dual-band | 4x USB-A | **Recommended** -- best balance of price, power, and simplicity |
| Raspberry Pi 3B+ | ~$35 | Dual-band | 4x USB-A | Proven (current dev setup), slightly slower |
| Raspberry Pi 5 | $50-80 | Dual-band | 4x USB-A | Good, but needs official 27W PSU for full USB power output |
| Raspberry Pi Zero 2 W | ~$15 | 2.4GHz | OTG adapter needed | Cheap but fiddly single-port OTG setup |
| ESP32-S3 | $5-15 | Yes | USB OTG | Cannot run Node.js -- would require full C++ rewrite |

**Key constraint**: The WinWing MCDU firmware requires SET_REPORT control transfers (not interrupt OUT). On Linux, the mcdu-client uses the `usb` npm package (libusb) with `controlTransfer(0x21, 0x09, ...)` to achieve this. All Raspberry Pi models support this out of the box.

### Quick Start (Development)

```bash
npm install
npm test          # Run all 191 tests
npm run lint      # ESLint
npm run check     # Lint + test combined
```

For detailed documentation, see [docs/](docs/README.md).

For the implementation plan, see [docs/implementation/IMPLEMENTATION-PLAN.md](docs/implementation/IMPLEMENTATION-PLAN.md).

### Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests (mocha) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:watch` | Watch mode for unit tests |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run check` | Lint + test combined |

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (Flixhummel) initial release

## License
MIT License

Copyright (c) 2026 Flixhummel <hummelimages@googlemail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.