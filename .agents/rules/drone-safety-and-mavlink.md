# Drone Safety & MAVLink Communication Rules

## Strict Safety Constraints
1. **Never Command In-Air Disarm**:
   - `sendDisarmCommand` must only pass forced disarm (`param2 = 21196.0`) if the vehicle is strictly confirmed landed or the operator has provided double confirmation in an emergency. Safe disarm (`param2 = 0.0`) is the default.
2. **Altitude Tolerance & Level-Off Checks**:
   - Never assume altitude reaches an exact numerical target (e.g. `altitude >= targetAltitude`).
   - Barometers in ground effect or after heat soak drift by 0.5m–1.5m.
   - Any state transition waiting for a takeoff climb must accept either:
     - `altitude >= targetAltitude - 1.0m` (relaxed threshold), OR
     - `altitude >= targetAltitude * 0.75` AND `Math.abs(verticalSpeed) < 0.25 m/s` (drone leveled off and stopped climbing).
3. **Valid Geodesic Coordinates Only**:
   - Check `Math.abs(lat) > 0.0001 && Math.abs(lon) > 0.0001` before sending any waypoint or home point.
   - Reject `0, 0` or NaN or uninitialized coordinates immediately with an audible warning.
4. **Debounce Command Buttons**:
   - MAVLink commands (`ARM`, `DISARM`, `TAKEOFF`, `RTL`, `MODE`) must enforce in-flight debouncing flags to prevent operators from spamming serial buffers.
5. **Heartbeat & Fail-Safe Watchdogs**:
   - If telemetry heartbeats stop streaming for > 3.0 seconds, transition the UI to `CONNECTION_LOST` and display diagnostic connection indicators.
   - When commanding RTL, account for ArduPilot's `RTL_ALT` (default 15m), which commands a vertical climb before lateral travel.
