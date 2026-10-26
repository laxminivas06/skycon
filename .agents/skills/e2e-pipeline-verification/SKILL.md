---
name: e2e-pipeline-verification
description: >-
  Verify and test the end-to-end communication and telemetry pipeline from Pixhawk to ESP32-S3, Relay Server, and GCS Web/Android client. Use when verifying connectivity, testing relay servers, or troubleshooting packet forwarding.
---

# End-to-End Pipeline Verification Runbook

This skill outlines how to run and verify the full MAVLink communication pipeline.

## System Topology
```text
Pixhawk (TELEM2 UART @ 57600)
    ↕ (GPIO 17 TX / GPIO 18 RX)
ESP32-S3 Firmware (esp32_cloud_relay_client.ino)
    ↕ (WSS over Wi-Fi Hotspot)
Secure Cloud Relay (relay-server/server.js on Render / Port 8443)
    ↕ (WSS with Token Auth)
Browser / Android Ground Station App (Capacitor / Vite)
```

## Running Automated End-to-End Tests
Run the automated verification script:
```powershell
node test-e2e.cjs
```
This script:
1. Spawns the cloud relay on a local port.
2. Connects a simulated browser WebSocket client.
3. Spawns the local connector simulating the ESP32.
4. Transmits a binary MAVLink heartbeat uplink packet.
5. Verifies downlink control and binary telemetry forwarding.

## Verification Checklist
1. **Relay Server Health Check**:
   - Query `http://<relay-host>:<port>/health`.
   - Response must return `{"status": "ok", "service": "SAE INDIA MAVLink Secure WSS Relay"}`.
2. **ESP32 Connection Verification**:
   - Check ESP32 serial monitor in Arduino IDE at 115200 baud.
   - Verify Wi-Fi connected with assigned IP and WebSocket connected: `[WSS] Connected to relay endpoint!`.
3. **Web GCS Telemetry Verification**:
   - Open Web App dashboard.
   - Pixhawk status card must show `PIXHAWK_CONNECTED` with incoming packet counter incrementing.
