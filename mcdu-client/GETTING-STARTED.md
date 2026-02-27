# Getting Started: MCDU Client on Raspberry Pi

Setup guide for running the mcdu-client on a fresh Raspberry Pi with Pi OS Lite (64-bit).

## Prerequisites

- Raspberry Pi 4 (or 3B+) with **Pi OS Lite 64-bit**
- WinWing MCDU-32-CAPTAIN connected via USB
- ioBroker instance with the mcdu adapter running on your network

## 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
node --version  # should show v20.x
```

## 2. Clone and Install

```bash
cd ~
git clone https://github.com/Flixhummel/ioBroker.mcdu.git
cd ioBroker.mcdu/mcdu-client
./install.sh
```

The install script will:
- Run `npm install` (prebuilt binaries, no compiler needed)
- Create `config.env` from template
- Install a udev rule for USB access (Linux only)
- Optionally install a systemd service

## 3. Configure

```bash
nano config.env
```

Set `MQTT_BROKER` to your ioBroker IP:
```
MQTT_BROKER=mqtt://10.10.5.65:1883
```

## 4. Start

```bash
sudo systemctl start mcdu-client
```

Or run directly:
```bash
node mcdu-client.js
```

## 5. Verify

```bash
sudo journalctl -u mcdu-client -f
```

You should see the client connect to MQTT and render the display.

## Updating

```bash
cd ~/ioBroker.mcdu/mcdu-client
git pull
npm install
sudo systemctl restart mcdu-client
```

## Troubleshooting

### HID device not found

```bash
# Check the MCDU is connected
lsusb | grep 4098

# Check hidraw device exists
ls -la /dev/hidraw*

# Check udev rule
cat /etc/udev/rules.d/99-winwing-mcdu.rules

# Check group membership (log out/in after install.sh)
id -nG | grep plugdev
```

### Display stuck on WinWing boot screen

The firmware only accepts init packets once per USB power cycle. Unplug and replug the USB cable, then restart the service.

### MQTT connection refused

```bash
# Test connectivity to your broker
mosquitto_pub -h YOUR_BROKER_IP -t test -m "hello"
```
