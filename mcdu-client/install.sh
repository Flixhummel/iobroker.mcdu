#!/bin/bash
#
# MCDU MQTT Client - Installation Script
# For Raspberry Pi 4 (64-bit) with Pi OS Lite
#

set -e

echo "=== MCDU MQTT Client Installation ==="
echo ""

# Check Node.js >= 18
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found!"
    echo ""
    echo "Install Node.js 20 LTS:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ERROR: Node.js >= 18 required (found $(node --version))"
    echo ""
    echo "Install Node.js 20 LTS:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

echo "Node.js $(node --version)"

# Check we're in the right directory
if [ ! -f "mcdu-client.js" ]; then
    echo "ERROR: mcdu-client.js not found!"
    echo "Run this script from the mcdu-client/ directory"
    exit 1
fi

# Install npm dependencies (prebuilds for node-hid, no compile needed)
echo ""
echo "Installing npm dependencies..."
npm install

# Create config.env if it doesn't exist
if [ ! -f "config.env" ]; then
    echo ""
    echo "Creating config.env from template..."
    cp config.env.template config.env
    echo "config.env created -- edit it to set MQTT_BROKER"
else
    echo ""
    echo "config.env already exists (not overwriting)"
fi

# Install udev rule for WinWing MCDU hidraw access
if [ "$(uname)" = "Linux" ]; then
    echo ""
    echo "Installing udev rule for WinWing MCDU..."
    cat <<'UDEV' | sudo tee /etc/udev/rules.d/99-winwing-mcdu.rules > /dev/null
# WinWing MCDU-32-CAPTAIN: allow plugdev group access to hidraw device
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="4098", ATTRS{idProduct}=="bb36", MODE="0660", GROUP="plugdev"
UDEV
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "udev rule installed"

    # Ensure current user is in plugdev group
    if ! id -nG | grep -qw plugdev; then
        echo ""
        echo "Adding $(whoami) to plugdev group..."
        sudo usermod -aG plugdev "$(whoami)"
        echo "Group added -- log out and back in for it to take effect"
    fi
fi

# Offer systemd service installation
echo ""
read -p "Install systemd service (auto-start on boot)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Installing systemd service..."

    CURRENT_DIR=$(pwd)
    NODE_PATH=$(which node)

    sed \
        -e "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|" \
        -e "s|EnvironmentFile=.*|EnvironmentFile=$CURRENT_DIR/config.env|" \
        -e "s|ExecStart=.*|ExecStart=$NODE_PATH $CURRENT_DIR/mcdu-client.js|" \
        -e "s|User=.*|User=$(whoami)|" \
        mcdu-client.service > /tmp/mcdu-client.service

    sudo cp /tmp/mcdu-client.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable mcdu-client

    echo "Service installed and enabled"
    echo ""
    echo "  Start:  sudo systemctl start mcdu-client"
    echo "  Status: sudo systemctl status mcdu-client"
    echo "  Logs:   sudo journalctl -u mcdu-client -f"
else
    echo "Skipping systemd installation"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit config.env -- set MQTT_BROKER to your ioBroker IP"
echo "  2. Test: node mcdu-client.js"
echo "  3. Start service: sudo systemctl start mcdu-client"
echo ""
