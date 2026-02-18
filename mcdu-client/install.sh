#!/bin/bash
#
# MCDU MQTT Client - Installation Script
# For Raspberry Pi 1 Model B Rev 2
#

set -e  # Exit on error

echo "=== MCDU MQTT Client Installation ==="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found!"
    echo "Install with: curl -sL https://deb.nodesource.com/setup_12.x | sudo bash - && sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✓ Node.js detected: $NODE_VERSION"

# Check we're in the right directory
if [ ! -f "mcdu-client.js" ]; then
    echo "ERROR: mcdu-client.js not found!"
    echo "Run this script from the mcdu-client/ directory"
    exit 1
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
npm install

# Create symlinks to hardware driver (from Phase 2)
echo ""
echo "Creating symlinks to hardware driver..."

if [ ! -f "../nodejs-test/mcdu.js" ]; then
    echo "ERROR: ../nodejs-test/mcdu.js not found!"
    echo "Make sure you have the complete project directory structure"
    exit 1
fi

ln -sf ../nodejs-test/mcdu.js ./mcdu.js
ln -sf ../nodejs-test/button-map.json ./button-map.json

echo "✓ Symlinks created"

# Create config.env if it doesn't exist
if [ ! -f "config.env" ]; then
    echo ""
    echo "Creating config.env from template..."
    cp config.env.template config.env
    echo "✓ config.env created"
    echo ""
    echo "⚠️  IMPORTANT: Edit config.env and set MQTT_BROKER at minimum!"
    echo "   nano config.env"
else
    echo ""
    echo "✓ config.env already exists (not overwriting)"
fi

# Check if systemd service should be installed
echo ""
read -p "Install systemd service (auto-start on boot)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Installing systemd service..."
    
    # Update WorkingDirectory in service file to current directory
    CURRENT_DIR=$(pwd)
    sed "s|WorkingDirectory=.*|WorkingDirectory=$CURRENT_DIR|g" mcdu-client.service > /tmp/mcdu-client.service
    sed -i "s|EnvironmentFile=.*|EnvironmentFile=$CURRENT_DIR/config.env|g" /tmp/mcdu-client.service
    sed -i "s|ExecStart=.*|ExecStart=$(which node) $CURRENT_DIR/mcdu-client.js|g" /tmp/mcdu-client.service
    
    sudo cp /tmp/mcdu-client.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable mcdu-client
    
    echo "✓ Service installed and enabled"
    echo ""
    echo "Start with: sudo systemctl start mcdu-client"
    echo "Status: sudo systemctl status mcdu-client"
    echo "Logs: sudo journalctl -u mcdu-client -f"
else
    echo "Skipping systemd installation"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit config.env (set MQTT_BROKER at minimum)"
echo "2. Test in mock mode: MOCK_MODE=true node mcdu-client.js"
echo "3. Run with hardware: node mcdu-client.js"
echo "4. Test MQTT: mosquitto_pub -h localhost -t mcdu/display/line -m '{\"lineNumber\":1,\"text\":\"HELLO\",\"color\":\"amber\"}'"
echo ""
