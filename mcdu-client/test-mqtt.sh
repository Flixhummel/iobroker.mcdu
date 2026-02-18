#!/bin/bash

# MQTT Testing Helper Script
# Quick commands for testing the MCDU MQTT client

DEVICE_ID=${DEVICE_ID:-"raspi-kitchen"}
MQTT_HOST=${MQTT_HOST:-"localhost"}

echo "╔═══════════════════════════════════════╗"
echo "║   MCDU MQTT Test Helper              ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "Device ID: $DEVICE_ID"
echo "MQTT Host: $MQTT_HOST"
echo ""

function show_help() {
    echo "Usage: ./test-mqtt.sh [command]"
    echo ""
    echo "Commands:"
    echo "  monitor-buttons   - Monitor button presses"
    echo "  monitor-status    - Monitor status messages"
    echo "  monitor-heartbeat - Monitor heartbeat"
    echo "  monitor-all       - Monitor all topics"
    echo "  test-display      - Send test display content"
    echo "  test-leds         - Test all LEDs"
    echo "  clear-display     - Clear display"
    echo "  help              - Show this help"
    echo ""
}

function monitor_buttons() {
    echo "Monitoring button presses (Ctrl+C to stop)..."
    mosquitto_sub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/button/#" -v
}

function monitor_status() {
    echo "Monitoring status (Ctrl+C to stop)..."
    mosquitto_sub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/status" -v
}

function monitor_heartbeat() {
    echo "Monitoring heartbeat (Ctrl+C to stop)..."
    mosquitto_sub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/heartbeat" -v
}

function monitor_all() {
    echo "Monitoring all topics (Ctrl+C to stop)..."
    mosquitto_sub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/#" -v
}

function test_display() {
    echo "Sending test display content..."
    
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line0" -m "╔════════════════════╗"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line1" -m "  MCDU MQTT CLIENT  "
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line2" -m "╚════════════════════╝"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line3" -m ""
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line4" -m "Status: ONLINE"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/color4" -m "G"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line5" -m ""
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line6" -m "Solar Power: 5.2 kW"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/color6" -m "Y"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line7" -m "Grid Feed: 3.1 kW"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line8" -m ""
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line9" -m "Heating: ON"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/color9" -m "R"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line10" -m "Temp: 21.5°C"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line11" -m ""
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line12" -m "Press buttons to test"
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/line13" -m ""
    
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/update" -m ""
    
    echo "✓ Test display content sent"
}

function test_leds() {
    echo "Testing all LEDs..."
    
    echo "  Turning all LEDs on..."
    for led in FAIL FM MCDU MENU FM1 IND RDY STATUS FM2; do
        mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/led/$led" -m "255"
        sleep 0.2
    done
    
    echo "  Waiting 2 seconds..."
    sleep 2
    
    echo "  Turning all LEDs off..."
    for led in FAIL FM MCDU MENU FM1 IND RDY STATUS FM2; do
        mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/led/$led" -m "0"
        sleep 0.2
    done
    
    echo "✓ LED test complete"
}

function clear_display() {
    echo "Clearing display..."
    mosquitto_pub -h $MQTT_HOST -t "mcdu/$DEVICE_ID/display/clear" -m ""
    echo "✓ Display cleared"
}

# Main
case "$1" in
    monitor-buttons)
        monitor_buttons
        ;;
    monitor-status)
        monitor_status
        ;;
    monitor-heartbeat)
        monitor_heartbeat
        ;;
    monitor-all)
        monitor_all
        ;;
    test-display)
        test_display
        ;;
    test-leds)
        test_leds
        ;;
    clear-display)
        clear_display
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
