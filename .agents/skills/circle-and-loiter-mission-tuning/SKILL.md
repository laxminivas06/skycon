---
name: circle-and-loiter-mission-tuning
description: >-
  Calibrate and tune autonomous circle test missions, loiter tests, and radius/altitude parameters for the SAE India drone. Use when the user wants to configure, test, adjust speed, diameter, or troubleshoot circular path and position hold behavior.
---

# Autonomous Circle & Loiter Mission Tuning Runbook

This skill outlines how to configure, calibrate, and safely execute Autonomous Circle and Loiter missions.

## Overview
The Circle Mission is used to demonstrate stable circular trajectory tracking and payload inspection.
The Loiter Mission verifies altitude holding (typically 5m AGL) and GPS position lock stability.

## Key Configuration Parameters
In [`circleTestService.ts`](file:///c:/Antigravityyyyy/rishitdrone/saeindia/src/services/circleTestService.ts):
- `circleDiameterMeters`: 6m to 50m (default 10m).
- `targetAltitudeMeters`: 3m to 15m (default 5m).
- `flightSpeedMps`: 1.5 to 3.0 m/s (default 2.0 m/s).
- `laps`: 1 to 3 laps (default 1).
- `direction`: `CW` (Clockwise) or `CCW` (Counter-Clockwise).
- `altitudeTolerance`: 0.8m to 1.2m (recommended: 1.0m to account for barometer drift).

## Circle Waypoint Generation
Waypoints are generated using local WGS-84 tangent plane projections:
$$\Delta \text{East} = R \sin(\theta), \quad \Delta \text{North} = R \cos(\theta)$$
$$\Delta \text{Lat} = \frac{\Delta \text{North}}{R_{\text{earth}}} \times \frac{180}{\pi}, \quad \Delta \text{Lon} = \frac{\Delta \text{East}}{R_{\text{earth}} \cos(\text{Lat})} \times \frac{180}{\pi}$$
The system generates 16 discrete waypoints along the circumference to ensure smooth circular curvature.

## Pre-Flight Checklist Before Starting Circle Test
1. **GPS 3D Fix**: Verify GPS fix type is `3D_FIX` or better, with HDOP $\le$ 2.0 and $\ge$ 8 satellites visible.
2. **Home Point Lock**: Confirm Home reference coordinates are non-zero and displayed on the tactical map.
3. **Flight Mode Transition**:
   - Step 1: Arm in `GUIDED` mode.
   - Step 2: Command Takeoff (`MAV_CMD_NAV_TAKEOFF`) to `targetAltitude`.
   - Step 3: Monitor climb until `altitude >= targetAltitude - 1.0m` OR vertical speed stabilizes.
   - Step 4: Step sequentially through the 16 waypoints.
   - Step 5: Reposition over Home and descend (`LAND`).

## Safe Abort Procedure
If wind gust or unexpected trajectory occurs:
1. Hit **ABORT** on the GCS interface.
2. The service immediately switches Pixhawk flight mode to **`LOITER`** to arrest all horizontal and vertical motion.
3. If necessary, switch the physical RC transmitter switch to `LOITER` or `ALT_HOLD` to take manual stick control.
