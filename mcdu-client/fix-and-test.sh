#!/bin/bash
#
# Fix paths and test MCDU client
# Run this ON THE RASPBERRY PI
#

set -e

echo "=== Fixing MCDU Client Paths ==="

# Fix require paths in mcdu-client.js
cd /home/pi/mcdu-client

echo "Updating require paths..."
sed -i "s|require('../nodejs-test/mcdu')|require('./lib/mcdu')|g" mcdu-client.js
sed -i "s|require('../nodejs-test/button-map.json')|require('./lib/button-map.json')|g" mcdu-client.js

echo "✓ Paths fixed"

# Verify the fix
echo ""
echo "Verifying fix..."
if grep -q "require('./lib/mcdu')" mcdu-client.js; then
    echo "✓ mcdu path correct"
else
    echo "❌ mcdu path not fixed"
    exit 1
fi

if grep -q "require('./lib/button-map.json')" mcdu-client.js; then
    echo "✓ button-map path correct"
else
    echo "❌ button-map path not fixed"
    exit 1
fi

echo ""
echo "=== Testing MCDU Client (Mock Mode) ==="
echo "Starting client for 5 seconds..."
echo ""

# Run in mock mode for 5 seconds
timeout 5 node mcdu-client.js 2>&1 &
PID=$!

# Wait a moment for startup
sleep 2

# Check if process is running
if ps -p $PID > /dev/null; then
    echo "✅ Client is running!"
    echo ""
    echo "Stopping test..."
    kill $PID 2>/dev/null || true
    wait $PID 2>/dev/null || true
else
    echo "❌ Client failed to start"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Connect MCDU via USB"
echo "2. Run: node mcdu-client.js"
echo "3. Test with mosquitto_pub/sub from another machine"
echo ""
