# MCDU MQTT Client - Deployment Checklist

Use this checklist when deploying to Raspberry Pi for the first time.

---

## Pre-Deployment

### On Development Machine

- [ ] **Verify all files exist**
  ```bash
  cd mcdu-client
  ls -la
  # Should see: mcdu-client.js, lib/, package.json, README.md, etc.
  ```

- [ ] **Create deployment package**
  ```bash
  tar -czf mcdu-client.tar.gz \
    --exclude node_modules \
    --exclude config.json \
    --exclude .git \
    .
  ```

- [ ] **Verify package size** (should be ~50 KB)
  ```bash
  ls -lh mcdu-client.tar.gz
  ```

### Raspberry Pi Preparation

- [ ] **Pi is accessible via SSH**
  ```bash
  ssh pi@192.168.x.x
  ```

- [ ] **Pi has internet connection**
  ```bash
  ping -c 3 google.com
  ```

- [ ] **MCDU is connected via USB**
  ```bash
  lsusb | grep 4098
  # Should show: ID 4098:bb36
  ```

---

## Deployment Steps

### 1. System Setup

- [ ] **Update system**
  ```bash
  sudo apt update
  sudo apt upgrade -y
  ```

- [ ] **Install Node.js**
  ```bash
  sudo apt install -y nodejs npm
  node --version  # Should be v12+
  ```

- [ ] **Install Mosquitto**
  ```bash
  sudo apt install -y mosquitto mosquitto-clients
  sudo systemctl enable mosquitto
  sudo systemctl start mosquitto
  ```

- [ ] **Verify Mosquitto is running**
  ```bash
  sudo systemctl status mosquitto
  # Should be "active (running)"
  ```

### 2. File Transfer

- [ ] **Copy package to Pi**
  ```bash
  # On dev machine:
  scp mcdu-client.tar.gz pi@192.168.x.x:~
  ```

- [ ] **Extract on Pi**
  ```bash
  # On Pi:
  mkdir -p ~/mcdu-client
  tar -xzf mcdu-client.tar.gz -C ~/mcdu-client
  cd ~/mcdu-client
  ```

- [ ] **Verify extraction**
  ```bash
  ls -la
  # Should see all files
  ```

### 3. Configuration

- [ ] **Install Node.js dependencies**
  ```bash
  npm install
  # Should install mqtt and node-hid
  ```

- [ ] **Create config file**
  ```bash
  cp config.json.example config.json
  ```

- [ ] **Edit config** (if needed)
  ```bash
  nano config.json
  # Change device.id if you want a different name
  ```

- [ ] **Make test script executable**
  ```bash
  chmod +x test-mqtt.sh
  ```

### 4. USB Permissions

- [ ] **Add user to input group**
  ```bash
  sudo usermod -a -G input $USER
  ```

- [ ] **Log out and back in** (for group to take effect)
  ```bash
  exit
  ssh pi@192.168.x.x
  ```

- [ ] **Verify group membership**
  ```bash
  groups
  # Should include "input"
  ```

### 5. Initial Testing

- [ ] **Test MQTT broker**
  ```bash
  # Terminal 1:
  mosquitto_sub -h localhost -t test -v
  
  # Terminal 2:
  mosquitto_pub -h localhost -t test -m "hello"
  
  # Should see "test hello" in Terminal 1
  ```

- [ ] **Test run the client**
  ```bash
  cd ~/mcdu-client
  npm start
  ```

- [ ] **Verify startup messages**
  - ✅ Connected to MCDU-32-CAPTAIN
  - ✅ Display initialized
  - ✅ Hardware initialized
  - ✅ Connected to MQTT broker
  - ✅ Subscribed to topics
  - ✅ Ready

- [ ] **Test button presses** (in another terminal)
  ```bash
  mosquitto_sub -h localhost -t "mcdu/+/button/#" -v
  # Press buttons on MCDU - should see messages
  ```

- [ ] **Test display update** (in another terminal)
  ```bash
  ./test-mqtt.sh test-display
  # Display should show test content
  ```

- [ ] **Test LED control**
  ```bash
  ./test-mqtt.sh test-leds
  # LEDs should flash on/off
  ```

- [ ] **Stop test run**
  ```bash
  # In terminal running npm start:
  Ctrl+C
  # Should see graceful shutdown
  ```

### 6. Service Installation

- [ ] **Install systemd service**
  ```bash
  sudo cp mcdu-client.service /etc/systemd/system/
  ```

- [ ] **Reload systemd**
  ```bash
  sudo systemctl daemon-reload
  ```

- [ ] **Enable service** (start on boot)
  ```bash
  sudo systemctl enable mcdu-client
  ```

- [ ] **Start service**
  ```bash
  sudo systemctl start mcdu-client
  ```

- [ ] **Check service status**
  ```bash
  sudo systemctl status mcdu-client
  # Should be "active (running)"
  ```

- [ ] **View logs**
  ```bash
  sudo journalctl -u mcdu-client -n 50 --no-pager
  # Should see startup messages
  ```

- [ ] **Test button events** (with service running)
  ```bash
  mosquitto_sub -h localhost -t "mcdu/+/button/#" -v
  # Press buttons - should see events
  ```

### 7. Reconnection Testing

- [ ] **Test MQTT reconnect**
  ```bash
  # Stop Mosquitto
  sudo systemctl stop mosquitto
  
  # Wait 10s, check logs
  sudo journalctl -u mcdu-client -n 20 --no-pager
  # Should see "MQTT connection offline"
  
  # Restart Mosquitto
  sudo systemctl start mosquitto
  
  # Check logs again
  sudo journalctl -u mcdu-client -n 20 --no-pager
  # Should see "Reconnecting..." and "Connected"
  ```

- [ ] **Test MCDU reconnect** (optional)
  ```bash
  # Unplug MCDU USB
  # Wait 10s, check logs
  sudo journalctl -u mcdu-client -n 20 --no-pager
  # Should see "hardware-disconnected" status
  
  # Plug back in
  # Check logs
  sudo journalctl -u mcdu-client -n 20 --no-pager
  # Should see reconnection attempts and success
  ```

### 8. Reboot Test

- [ ] **Reboot Pi**
  ```bash
  sudo reboot
  ```

- [ ] **After reboot, verify service started**
  ```bash
  sudo systemctl status mcdu-client
  # Should be "active (running)"
  ```

- [ ] **Check logs**
  ```bash
  sudo journalctl -u mcdu-client -b
  # Should see clean startup
  ```

- [ ] **Test functionality**
  ```bash
  # Test buttons
  mosquitto_sub -h localhost -t "mcdu/+/button/#" -v
  
  # Test display
  ./test-mqtt.sh test-display
  ```

---

## Post-Deployment

### Documentation

- [ ] **Document Pi IP address**
  ```bash
  hostname -I
  ```

- [ ] **Document device ID** (from config.json)
  ```bash
  cat config.json | grep '"id"'
  ```

- [ ] **Note MQTT topics**
  - Button events: `mcdu/{deviceId}/button/#`
  - Display: `mcdu/{deviceId}/display/#`
  - LEDs: `mcdu/{deviceId}/led/#`
  - Status: `mcdu/{deviceId}/status`

### Monitoring Setup

- [ ] **Create monitoring script** (optional)
  ```bash
  # Create ~/monitor-mcdu.sh:
  #!/bin/bash
  echo "=== Service Status ==="
  sudo systemctl status mcdu-client | grep Active
  echo ""
  echo "=== Last 10 Log Lines ==="
  sudo journalctl -u mcdu-client -n 10 --no-pager
  ```

- [ ] **Add to crontab** (optional - health check)
  ```bash
  # Check every 5 minutes, log if service is down
  */5 * * * * systemctl is-active mcdu-client || echo "MCDU client down!" | mail -s "Alert" you@email.com
  ```

### Backup

- [ ] **Backup configuration**
  ```bash
  cp ~/mcdu-client/config.json ~/mcdu-client-config-backup.json
  ```

- [ ] **Document setup in notes**
  - Pi hostname/IP
  - Installation date
  - Node.js version
  - Any custom configuration

---

## Troubleshooting Reference

### Service Issues

**Service won't start:**
```bash
# Check logs
sudo journalctl -u mcdu-client -n 50 --no-pager

# Check service file
sudo systemctl cat mcdu-client

# Test manually
cd ~/mcdu-client
npm start
```

**Service starts but crashes:**
```bash
# Check full logs since boot
sudo journalctl -u mcdu-client -b

# Check for USB permissions
groups | grep input

# Check MCDU connected
lsusb | grep 4098
```

### MQTT Issues

**Can't publish/subscribe:**
```bash
# Test Mosquitto
mosquitto_pub -h localhost -t test -m "test"
mosquitto_sub -h localhost -t test

# Check Mosquitto running
sudo systemctl status mosquitto

# Check Mosquitto logs
sudo journalctl -u mosquitto -n 50 --no-pager
```

### Hardware Issues

**MCDU not detected:**
```bash
# List USB devices
lsusb

# Check for 4098:bb36
lsusb | grep 4098

# Check USB permissions
ls -l /dev/hidraw*

# Try as root (temporary test)
sudo npm start
```

---

## Success Criteria

After deployment, you should have:

✅ **Service running automatically** on boot  
✅ **Button presses publish** to MQTT  
✅ **Display updates** from MQTT commands  
✅ **LED control** working via MQTT  
✅ **Auto-reconnection** working (MQTT & hardware)  
✅ **Heartbeat** publishing every 30s  
✅ **Status messages** showing "online"  

---

## Quick Commands Reference

```bash
# Service management
sudo systemctl status mcdu-client
sudo systemctl restart mcdu-client
sudo systemctl stop mcdu-client
sudo journalctl -u mcdu-client -f

# Testing
cd ~/mcdu-client
./test-mqtt.sh monitor-buttons
./test-mqtt.sh test-display
./test-mqtt.sh test-leds

# MQTT monitoring
mosquitto_sub -h localhost -t "mcdu/+/#" -v
mosquitto_sub -h localhost -t "mcdu/+/button/#" -v
mosquitto_sub -h localhost -t "mcdu/+/status" -v

# USB check
lsusb | grep 4098
```

---

**Deployment Date:** ___________  
**Pi IP:** ___________  
**Device ID:** ___________  
**Deployed By:** ___________  

✅ **Deployment Complete!**
