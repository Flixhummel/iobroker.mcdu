#!/bin/bash
#
# Node.js v12 Installation for ARMv6 (Raspberry Pi 1)
# Run this script ON THE RASPBERRY PI (not on Mac)
#

set -e  # Exit on error

echo "=== Node.js v12 Installation for ARMv6 ==="
echo ""

# Check architecture
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"

if [ "$ARCH" != "armv6l" ]; then
    echo "⚠️  Warning: This script is designed for ARMv6 (Raspberry Pi 1)"
    echo "   Detected: $ARCH"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Node.js version for ARMv6
NODE_VERSION="v10.24.1"  # Last version with ARMv6 support
NODE_DISTRO="linux-armv6l"
NODE_TARBALL="node-${NODE_VERSION}-${NODE_DISTRO}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

echo ""
echo "Installing Node.js ${NODE_VERSION} for ${NODE_DISTRO}..."
echo "Download URL: $NODE_URL"
echo ""

# Create temp directory
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

# Download Node.js binary
echo "Downloading Node.js tarball..."
wget "$NODE_URL"

# Extract
echo "Extracting..."
tar -xJf "$NODE_TARBALL"

# Install to /usr/local
echo "Installing to /usr/local..."
cd "node-${NODE_VERSION}-${NODE_DISTRO}"
sudo cp -R * /usr/local/

# Cleanup
cd ~
rm -rf "$TMP_DIR"

# Verify installation
echo ""
echo "Verifying installation..."
node --version
npm --version

echo ""
echo "✅ Node.js installation complete!"
echo ""
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""
echo "Next steps:"
echo "1. cd /home/pi/mcdu-client"
echo "2. npm install"
echo "3. ./install.sh"
