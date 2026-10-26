---
name: drone-flight-diagnostics
description: >-
  Diagnose flight controller issues, telemetry failures, altitude climb deadlocks, MAVLink command rejections, and Pixhawk pre-arm checks. Use when the user reports issues during flight, takeoff, circling, loiter, or MAVLink communication with Pixhawk.
---

# Drone Flight Diagnostics & Troubleshooting Runbook

This skill guides the diagnosis and resolution of autonomous flight issues in the SAE India drone system.

## 1. Drone Just Going Up / Not Circling (Altitude Trigger Deadlock)
### Symptoms
- Drone arms and takes off.
- Reaches or exceeds target altitude, but never starts flying the circle or waypoints.
- Drone keeps climbing vertically or holds position indefinitely without starting the mission.

### Root Causes
1. **Strict Altitude Threshold**: `circleTestService.ts` or `missionEngine.ts` requires `telem.altitude >= (targetAlt - tolerance)`. If baro drifts and stops at 4.3m when 4.5m is required, the orbit never triggers.
2. **ArduPilot `RTL_ALT`**: If RTL or failsafe triggers, ArduPilot will climb vertically to `RTL_ALT` (default 15m) before horizontal flight.
3. **RC Throttle Stick**: In GUIDED mode, if the physical RC throttle stick is > 50%, ArduPilot interprets it as manual climb demand.
4. **`MAV_CMD_DO_REPOSITION` Rejection**: If waypoint commands sent via `COMMAND_LONG` are rejected by Pixhawk, horizontal waypoints are ignored while altitude is held.

### Diagnostic & Verification Steps
1. Inspect live telemetry stream: Check if `telem.altitude` reaches the threshold and verify `telem.verticalSpeed`.
2. Inspect [`circleTestService.ts`](file:///c:/Antigravityyyyy/rishitdrone/saeindia/src/services/circleTestService.ts) and verify the altitude check includes a level-off check (`Math.abs(verticalSpeed) < 0.25`).
3. Check Pixhawk parameter `RTL_ALT` in Mission Planner or QGC. Set to `500` (5m) or `0` for low-altitude field tests.
4. Check that physical RC throttle is centered at 50% once airborne in GUIDED mode.

---

## 2. Pixhawk Pre-Arm Check Rejections
### Symptoms
- Motors do not spin when arming is commanded.
- Status message shows `ARM COMMAND REJECTED`.

### Diagnostic Steps
1. Check MAVLink `STATUSTEXT` messages in [`mavlinkService.ts`](file:///c:/Antigravityyyyy/rishitdrone/saeindia/src/services/mavlinkService.ts).
2. Common ArduPilot Pre-Arm failures:
   - **Bad Compass Health / Variance**: Perform onboard compass calibration in Mission Planner or move away from metal.
   - **GPS Fix**: Needs 3D fix with HDOP < 2.0 and at least 6 satellites before arming in GUIDED mode.
   - **Safety Switch**: Verify physical Pixhawk safety switch is solid red (pressed).
   - **Baro Glitch**: Wait 30 seconds after powering on before arming for baro reference to stabilize.

---

## 3. Telemetry Stream Stoppage or Latency Spikes
### Symptoms
- Telemetry numbers freeze or update intermittently.
- Heartbeat indicator in Header flashes yellow/red.

### Diagnostic Steps
1. Check ESP32-S3 UART baud rate: Pixhawk `SERIAL2_BAUD` must be `57` (57600 baud) and `SERIAL2_PROTOCOL` = `2` (MAVLink 2).
2. Check ESP32 Wi-Fi signal: Ensure phone hotspot is within 15 meters without metal obstructions.
3. Check WebSocket connection in console for dropped frames or buffer overflow.
