# MCDU MQTT Client - Quick Start Guide

Get your MCDU smart home controller up and running in 5 minutes!

## Prerequisites Checklist

- [ ] Raspberry Pi with Raspberry Pi OS installed
- [ ] WinWing MCDU-32-CAPTAIN connected via USB
- [ ] Network connection (for MQTT)
- [ ] SSH access to the Pi (or keyboard/monitor)

## Installation Steps

### 1. Install System Dependencies (2 minutes)

```bash
# Update package list
sudo apt update

# Install Node.js, npm, and Mosquitto MQTT broker
sudo apt install -y nodejs npm mosquitto mosquitto-clients

# Verify installation
node --version   # Should be v12 or higher
npm --version
```

### 2. Transfer Project Files (1 minute)

```bash
# On your development machine, create a tarball
cd /path/to/mcdu-client
tar -czf mcdu-client.tar.gz .

# Copy to Raspberry Pi (replace with your Pi's IP)
scp mcdu-client.tar.gz pi@192.168.1.100:~

# On the Raspberry Pi
cd ~
tar -xzf mcdu-client.tar.gz -C mcdu-client
cd mcdu-client
```

Or use Git:
```bash
git clone <your-repo-url> ~/mcdu-client
cd ~/mcdu-client
```

### 3. Install Node.js Dependencies (1 minute)

```bash
npm install
```

### 4. Configure (30 seconds)

```bash
# Copy example config
cp config.json.example config.json

# Edit (only if needed - defaults work for local setup)
nano config.json
```

**Default config works if:**
- Mosquitto is running on the same Pi
- You're okay with device ID "raspi-kitchen"

### 5. Test Run (30 seconds)

```bash
npm start
```

**You should see:**
```
╔═══════════════════════════════════════╗
║   MCDU MQTT Client v1.0.0            ║
║   Smart Home Controller              ║
╚═══════════════════════════════════════╝
...
✓ Connected to MCDU-32-CAPTAIN
✓ Hardware initialized
✓ Connected to MQTT broker
=== Ready ===
```

**Press any button on the MCDU** - you should see:
```
Button pressed: LSK1L (0)
```

Press `Ctrl+C` to stop.

### 6. Test MQTT Communication (1 minute)

Open a **second terminal** on the Pi:

```bash
# Monitor button presses
mosquitto_sub -h localhost -t "mcdu/raspi-kitchen/button/#" -v
```

Press buttons on the MCDU - you should see messages like:
```
mcdu/raspi-kitchen/button/LSK1L {"pressed":true,"timestamp":1707912345}
```

Open a **third terminal** and test display:

```bash
# Send display text
mosquitto_pub -h localhost -t "mcdu/raspi-kitchen/display/line0" -m "HELLO WORLD"
mosquitto_pub -h localhost -t "mcdu/raspi-kitchen/display/line1" -m "Testing 1-2-3"
mosquitto_pub -h localhost -t "mcdu/raspi-kitchen/display/update" -m ""
```

**The MCDU display should update!** ✅

### 7. Install as System Service (1 minute)

```bash
# Stop test run (Ctrl+C in first terminal)

# Install service
sudo cp mcdu-client.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mcdu-client
sudo systemctl start mcdu-client

# Check status
sudo systemctl status mcdu-client
```

**Service should be active (running)** ✅

---

## Quick Test Commands

Use the included test helper:

```bash
# Monitor all button presses
./test-mqtt.sh monitor-buttons

# Send test display content
./test-mqtt.sh test-display

# Test all LEDs
./test-mqtt.sh test-leds

# Clear display
./test-mqtt.sh clear-display

# Monitor all MQTT traffic
./test-mqtt.sh monitor-all
```

---

## Troubleshooting

### "Failed to connect to MCDU"

**Check USB connection:**
```bash
lsusb | grep 4098
```
Should show: `ID 4098:bb36`

**Add USB permissions:**
```bash
sudo usermod -a -G input $USER
# Log out and back in, or reboot
```

### "MQTT connection failed"

**Check Mosquitto is running:**
```bash
sudo systemctl status mosquitto
sudo systemctl start mosquitto
```

### "npm: command not found"

**Install Node.js and npm:**
```bash
sudo apt update
sudo apt install -y nodejs npm
```

### Display not updating

**Did you send the update command?**
```bash
# Always send update after setting lines
mosquitto_pub -h localhost -t "mcdu/raspi-kitchen/display/update" -m ""
```

---

## What's Next?

Your MCDU MQTT client is now running! 🎉

**Next steps:**
1. **Phase 3b:** Install ioBroker adapter to control the MCDU from ioBroker
2. **Phase 3c:** Create display templates (solar, heating, weather, etc.)
3. **Phase 3d:** Build web UI for template management

For full documentation, see **README.md**.

---

## Quick Reference

### MQTT Topics

**Display:**
```bash
mcdu/{deviceId}/display/line0-13    # Set line text
mcdu/{deviceId}/display/color0-13   # Set line color (W/R/G/B/Y/M/A)
mcdu/{deviceId}/display/update      # Commit changes
mcdu/{deviceId}/display/clear       # Clear all
```

**LEDs:**
```bash
mcdu/{deviceId}/led/{ledName}       # Set brightness (0-255)
# LED names: FAIL, FM, MCDU, MENU, FM1, IND, RDY, STATUS, FM2
```

**Button Events (published by client):**
```bash
mcdu/{deviceId}/button/{label}      # Button press
# Labels: LSK1L-6L, LSK1R-6R, DIR, PROG, A-Z, 0-9, etc.
```

**Status:**
```bash
mcdu/{deviceId}/status              # online/offline/hardware-disconnected
mcdu/{deviceId}/heartbeat           # Heartbeat (every 30s)
```

---

**Happy automating! 🏠✈️**
