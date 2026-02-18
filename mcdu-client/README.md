# MCDU MQTT Client

**Phase 3a:** Hardware bridge between WINWING MCDU-32-CAPTAIN and MQTT broker.

## Overview

This client acts as a "dumb terminal" that:
- Reads button presses from MCDU hardware
- Publishes button events to MQTT
- Subscribes to display/LED commands from MQTT
- Sends updates to MCDU hardware

**Architecture:**
```
┌─────────────────┐      MQTT       ┌──────────────────┐
│   ioBroker      │ ◄─────────────► │  mcdu-client.js  │
│   (Phase 3b)    │   (topics)      │   (this file)    │
└─────────────────┘                 └──────────────────┘
                                            │
                                            │ USB HID
                                            ▼
                                    ┌──────────────┐
                                    │  MCDU-32-    │
                                    │  CAPTAIN     │
                                    └──────────────┘
```

**Optimized for:** Raspberry Pi 1 Model B Rev 2 (ARMv6, 512MB RAM)

## Installation

### 1. Prerequisites

```bash
# Raspberry Pi OS Lite (Legacy, 32-bit) recommended
# Node.js v12.x (last ARMv6-compatible version)

curl -sL https://deb.nodesource.com/setup_12.x | sudo bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should be v12.x
```

### 2. Install Dependencies

```bash
cd /home/pi/mcdu-client
npm install
```

### 3. Copy Hardware Driver

```bash
# Copy mcdu.js and button-map.json from Phase 2
cp ../nodejs-test/mcdu.js .
cp ../nodejs-test/button-map.json .
```

### 4. Configure

```bash
cp config.env.template config.env
nano config.env  # Edit MQTT broker URL, credentials, etc.
```

**Minimum required:**
```bash
MQTT_BROKER=mqtt://192.168.1.100:1883
```

## Usage

### Run Manually

```bash
# Load config from config.env
export $(cat config.env | xargs)

# Start client
node mcdu-client.js
```

### Run with systemd (Recommended)

```bash
# Copy service file
sudo cp mcdu-client.service /etc/systemd/system/

# Enable and start
sudo systemctl enable mcdu-client
sudo systemctl start mcdu-client

# Check status
sudo systemctl status mcdu-client

# View logs
sudo journalctl -u mcdu-client -f
```

### Mock Mode (Testing without Hardware)

```bash
# Test MQTT connectivity without MCDU connected
MOCK_MODE=true node mcdu-client.js

# Generates fake button events every 5 seconds
# Logs received MQTT messages
```

## MQTT Topics

See **[../PHASE3A-SPEC.md](../PHASE3A-SPEC.md)** for complete specification.

### Commands (Subscribe - Client Receives)

| Topic | Purpose | Example |
|-------|---------|---------|
| `mcdu/display/set` | Full display update (14 lines) | `{"lines":[{"text":"LINE 1","color":"white"},...]}` |
| `mcdu/display/line` | Single line update | `{"lineNumber":1,"text":"HELLO","color":"amber"}` |
| `mcdu/display/clear` | Clear display | `{}` |
| `mcdu/leds/set` | Set all LEDs | `{"leds":{"RDY":true,"FAIL":false,...}}` |
| `mcdu/leds/single` | Set single LED | `{"name":"RDY","state":true}` |
| `mcdu/status/ping` | Health check | `{"requestId":"uuid"}` |

### Events (Publish - Client Sends)

| Topic | Purpose | Example |
|-------|---------|---------|
| `mcdu/buttons/event` | Button press/release | `{"button":"LSK1L","action":"press","timestamp":...}` |
| `mcdu/status/online` | Online/offline status (LWT) | `{"status":"online","hostname":"raspberrypi",...}` |
| `mcdu/status/pong` | Health check response | `{"requestId":"uuid","uptime":3600,...}` |
| `mcdu/status/error` | Hardware errors | `{"error":"Device disconnected","code":"...",...}` |

## Testing

### 1. MQTT Connectivity (No MCDU)

```bash
# Terminal 1: Start in mock mode
MOCK_MODE=true node mcdu-client.js

# Terminal 2: Send test display update
mosquitto_pub -h localhost -t mcdu/display/line -m '{"lineNumber":1,"text":"HELLO MCDU","color":"amber"}'

# Terminal 3: Monitor button events (mock generates events every 5s)
mosquitto_sub -h localhost -t mcdu/buttons/event -v
```

**Success:** Client connects, receives messages, publishes mock events.

### 2. Hardware Integration (MCDU Connected)

```bash
# Terminal 1: Start client
node mcdu-client.js

# Terminal 2: Send display update
mosquitto_pub -h localhost -t mcdu/display/set -m '{
  "lines": [
    {"text":"LINE 1 TEXT HERE      ","color":"white"},
    {"text":"LINE 2 TEXT HERE      ","color":"amber"},
    {"text":"LINE 3 TEXT HERE      ","color":"cyan"},
    ...
  ]
}'

# Terminal 3: Monitor button events (press physical buttons)
mosquitto_sub -h localhost -t mcdu/buttons/event -v

# Terminal 4: Control LEDs
mosquitto_pub -h localhost -t mcdu/leds/set -m '{"leds":{"RDY":true,"FAIL":false}}'
```

**Success:** Display updates, buttons work, LEDs respond.

### 3. Performance Test (Pi 1)

```bash
# Stress test: 600 display updates (10/sec for 60 seconds)
for i in {1..600}; do
  mosquitto_pub -h localhost -t mcdu/display/line -m "{\"lineNumber\":1,\"text\":\"UPDATE $i\",\"color\":\"white\"}"
  sleep 0.1
done

# Monitor CPU/memory
htop
```

**Expected:** CPU <80%, memory stable, buttons still responsive.

### 4. Stability Test (24h)

```bash
# Run in background
nohup node mcdu-client.js > /dev/null 2>&1 &

# Send test message every 5 minutes
watch -n 300 'mosquitto_pub -h localhost -t mcdu/display/line -m "{\"lineNumber\":14,\"text\":\"ALIVE $(date +%H:%M)\",\"color\":\"green\"}"'

# Check uptime
mosquitto_pub -h localhost -t mcdu/status/ping -m '{"requestId":"test"}'
mosquitto_sub -h localhost -t mcdu/status/pong -C 1 -v
```

**Success:** Runs 24h without crashes, no memory leaks, auto-reconnects if broker restarts.

## Configuration Reference

See `config.env.template` for all options.

**Performance tuning (Pi 1):**
- `BUTTON_POLL_RATE=50` - Lower = less CPU (default: 50Hz, standard: 100Hz)
- `DISPLAY_THROTTLE=100` - Max 10 updates/sec (prevents flood)
- `LED_THROTTLE=50` - Max 20 updates/sec

**Logging:**
- `LOG_LEVEL=debug` - Verbose (shows all MQTT messages, throttling, etc.)
- `LOG_LEVEL=info` - Normal (startup, connect, errors)
- `LOG_BUTTONS=true` - Log every button press/release (very noisy)

## Troubleshooting

### "Cannot find module 'mqtt'"

```bash
npm install
```

### "HID device not found"

```bash
# Check USB connection
lsusb | grep 4098

# Should show: Bus 001 Device 005: ID 4098:bb36
```

### "MQTT connection refused"

```bash
# Check broker is running
systemctl status mosquitto

# Check firewall
sudo ufw status

# Test broker
mosquitto_pub -h localhost -t test -m "hello"
mosquitto_sub -h localhost -t test -C 1
```

### Display shows text in wrong position

- This client uses full-screen buffer approach (sends all 14 lines at once)
- Tested and working on macOS (Phase 2)
- Should work identically on Pi 1 with same hardware

### High CPU usage on Pi 1

- Lower `BUTTON_POLL_RATE` to 30-40Hz
- Increase `DISPLAY_THROTTLE` to 200ms
- Check for MQTT message flood (ioBroker sending too fast)

### Memory leak (increasing RAM over time)

- Check for orphaned button event listeners
- Monitor with: `watch -n 1 'ps aux | grep node'`
- Restart service if needed: `sudo systemctl restart mcdu-client`

## Architecture Notes

**Stateless Design:**
- No business logic in client (all in ioBroker adapter)
- No template rendering (ioBroker builds display pages)
- No button handlers (ioBroker decides what buttons do)

**Cached State:**
- Display: 14 lines cached locally (avoid redundant HID writes)
- LEDs: 11 states cached (only send changed LEDs)

**Throttling:**
- Display: Max 10 updates/sec (even if MQTT floods faster)
- LEDs: Max 20 updates/sec
- Buttons: Polled at 50Hz (100Hz on more powerful hardware)

**Error Recovery:**
- HID disconnect: Auto-reconnect every 5 seconds
- MQTT disconnect: mqtt.js auto-reconnects with exponential backoff
- Invalid JSON: Log and ignore (don't crash)

## Next Steps (Phase 3b)

After this client is tested and working:
1. Build ioBroker adapter
2. Implement template system
3. Add state subscriptions
4. JSON Config UI
5. End-to-end integration testing

---

**Contract:** See [PHASE3A-SPEC.md](../PHASE3A-SPEC.md) for complete MQTT specification.

**License:** MIT  
**Author:** Felix Hummel
