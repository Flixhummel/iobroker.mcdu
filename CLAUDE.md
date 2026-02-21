# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ioBroker adapter (`iobroker.mcdu`) that controls smart home devices through WINWING MCDU-32-CAPTAIN aviation cockpit hardware via MQTT. Pure JavaScript, no build step.

**Three-tier architecture:**
```
ioBroker Adapter (main.js)  ↔  MQTT Broker  ↔  RasPi Client (mcdu-client/)  ↔  USB HID Hardware
```

The adapter runs all business logic. The Raspberry Pi client (`mcdu-client/mcdu-client.js`) is a "dumb terminal" that only bridges MQTT ↔ USB HID — it has no business logic.

## Commands

```bash
npm test                  # Run all tests (mocha)
npm run test:unit         # Unit tests only (test/unit/**)
npm run test:integration  # Integration tests only
npm run test:package      # Package validation tests
npm run test:watch        # Watch mode for unit tests
npm run lint              # ESLint
npm run lint:fix          # ESLint with auto-fix
npm run check             # Lint + test combined
```

No build step — `main.js` is the adapter entry point, run directly by ioBroker.

## Architecture

### Core Modules (lib/)

| Module | Purpose |
|--------|---------|
| `lib/mqtt/MqttClient.js` | MQTT broker connection, pub/sub, auto-reconnect |
| `lib/mqtt/ButtonSubscriber.js` | Button event subscription, LSK→row mapping, action execution |
| `lib/state/StateTreeManager.js` | ioBroker object tree creation, device registration |
| `lib/rendering/PageRenderer.js` | Page config → 14×24 char display lines, sprintf formatting |
| `lib/rendering/DisplayPublisher.js` | MQTT display publishing with throttling (max 10/sec) |
| `lib/input/ScratchpadManager.js` | Line 14 scratchpad buffer, char input, validation display |
| `lib/input/InputModeManager.js` | State machine: normal → input → edit → confirm |
| `lib/input/ConfirmationDialog.js` | Soft confirm (LSK) vs hard confirm (OVFY) dialogs |
| `lib/input/ValidationEngine.js` | Multi-level validation (keystroke → format → range → business) |
| `lib/templates/TemplateLoader.js` | Pre-built page templates, template merging |

### MQTT Topic Convention

Topics follow the pattern `mcdu/{deviceId}/...`:
- `buttons/event` — button presses (client → adapter)
- `display/set`, `display/line` — screen updates (adapter → client)
- `leds/set`, `leds/single` — LED control (adapter → client)
- `status/online`, `status/ping`, `status/pong` — health/presence

### ioBroker State Tree

Per-device state trees under `mcdu.0.devices.{deviceId}/`. The adapter subscribes to patterns like `devices.*.leds.*`, `devices.*.scratchpad.*`, etc.

### Display Constraints

- 14 lines × 24 characters, 8 colors
- 73 buttons (LSK 1-6 left/right, function keys, keypad, controls)
- LSK buttons map to odd display rows (LSK1→row1, LSK2→row3, etc.)

## Development Rules

1. **No backward-compatibility migrations.** We are in active development. There is ONE current config format. If existing stored configuration doesn't match the current format, show a clear error message in the Admin UI — do NOT silently migrate. The developer will manually recreate configs when the format changes.

2. **Keep code simple and clean.** No migration layers, no old-format detection, no backward-compat shims. One format, one code path.

3. **Do NOT deploy to the Raspberry Pi** unless explicitly asked. We develop and test locally on Mac (MCDU plugged into Mac via USB). Only deploy to mcdu-pi when the user specifically requests it.

## Configuration

- `io-package.json` — adapter metadata, native config defaults (MQTT broker, display/LED throttling, page definitions)
- `admin/jsonConfig.json` — Admin UI schema for adapter settings
- ESLint uses `@iobroker/eslint-config`; Prettier uses `@iobroker/prettier-config` with double quotes

## Testing

Tests use Mocha + Chai + Sinon. Test files are excluded from ESLint. The `@iobroker/testing` package provides adapter-specific test utilities.

## Remote Infrastructure

### ioBroker Dev-Server (LXC Container)
- SSH: `iobroker-dev` (fhummel@10.10.5.65)
- MCP Server: `iobroker-dev` (ssh-mcp)
- Adapter directory: `~/ioBroker.mcdu`
- Admin UI: http://10.10.5.65:8081/#tab-instances/config/system.adapter.mcdu.0
- Logs: `~/ioBroker.mcdu/.dev-server/default/log/iobroker.current.log`

#### Dev-Server Deploy Workflow (CRITICAL)

**NEVER use `dev-server watch`** — it spawns two adapter processes that fight over MQTT.

**Always use `dev-server run`** + the deploy script:

1. **First start** (or after full restart):
   ```bash
   cd ~/ioBroker.mcdu && nohup dev-server run > /tmp/dev-server.log 2>&1 &
   ```

2. **After code changes** (git pull or file edits):
   ```bash
   cd ~/ioBroker.mcdu && git pull && ./deploy-to-devserver.sh
   ```
   This script copies `main.js`, `lib/`, `admin/jsonConfig.json`, `io-package.json`, `package.json` into `.dev-server/default/node_modules/iobroker.mcdu/` and restarts the adapter process.

3. **Why this is needed**: `dev-server run` copies adapter files into `.dev-server/default/node_modules/iobroker.mcdu/` once at startup. After that, `git pull` only updates `~/ioBroker.mcdu/` — the running copy is NOT updated. You MUST use `deploy-to-devserver.sh` to sync changes.

4. **Full restart** (only if js-controller is stuck):
   ```bash
   ps aux | grep -E '(io\.mcdu|js-controller|dev-server)' | grep -v grep | awk '{print $2}' | xargs kill
   sleep 3 && rm -rf ~/ioBroker.mcdu/.dev-server/default/*.lock
   cd ~/ioBroker.mcdu && nohup dev-server run > /tmp/dev-server.log 2>&1 &
   ```

5. **Verify**: Always confirm exactly ONE `io.mcdu.0` process. Multiple = MQTT flapping.

### Raspberry Pi (mcdu-client)
- SSH: `mcdu-pi` (pi@10.10.2.190)
- MCP Server: `mcdu-pi` (ssh-mcp)
- Client directory: `/home/pi/mcdu-client`
- Service: `mcdu-client.service` (systemd)
- Logs: `sudo journalctl -u mcdu-client -f`
- Deploy only after successful test on iobroker-dev
