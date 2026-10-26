# SAE India Autonomous Drone Rescue Mission — Knowledge Base & Memory

## Competition Mission Sequence (24-Step Automation Flow)
1. **System Boot & Link**: ESP32-S3 boots, connects to phone hotspot, initiates WSS to Relay Server.
2. **MAVLink Heartbeat**: Pixhawk streams MAVLink 2.0 packets over TELEM2 (57600 baud) to ESP32.
3. **GCS Link Up**: Ground Station Android / Browser connects to WSS relay, discovers drone.
4. **Pre-Flight Check**: GPS 3D fix verified (Fix $\ge$ 3, Sats $\ge$ 8, HDOP $\le$ 2.0), EKF healthy, Battery $\ge$ 20%.
5. **Home Reference Lock**: Ground Station locks current GPS as Home reference (`setHomePoint`).
6. **Search Area Configuration**: Operator selects search boundary (Rectangle, Polygon, Circle) and altitude.
7. **Operator Authorization**: Arming & autonomous mission start confirmed by operator.
8. **Flight Mode Transition**: Pixhawk flight mode switches to `GUIDED`.
9. **Motor Arming**: `MAV_CMD_COMPONENT_ARM_DISARM` (cmd 400) executed.
10. **Autonomous Takeoff**: `MAV_CMD_NAV_TAKEOFF` (cmd 22) to configured search altitude.
11. **Climb Level-Off**: Drone climbs; telemetry confirms altitude achieved ($\pm 1.0\text{m}$ margin or vertical speed leveling off).
12. **Outbound Search Navigation**: Generates search pattern (Grid / Spiral / Perimeter) and executes waypoints.
13. **Target Box Visual Acquisition**: Onboard camera detects cardboard brown / white top-face cuboid.
14. **Multi-Frame Verification**: Box detector verifies geometric consistency for $\ge 3$ consecutive frames (`LOCKED`).
15. **Visual Servoing Hold**: Drone centers over box top plate using proportional control ($k_p$).
16. **QR Decoding**: Computer vision pipeline decodes target QR code using `jsQR`.
17. **Payload Validation**: Decoded string validates against regex `^\d{2}$` (strictly two digits).
18. **P2P Runner Transmission**: Ground Station / Drone companion transmits 2-digit code to Field Runner device socket.
19. **Runner Visual Display**: Runner device displays oversized digits with zero-touch UI.
20. **Runner ACK Handshake**: Runner device automatically responds with cryptographic ACK packet.
21. **ACK Reception & Alert**: Drone confirms ACK received with audible victory tone and haptics.
22. **Autonomous RTL**: Command authority transfers to RTL; Pixhawk initiates `RTL` flight mode.
23. **Home Arrival & Landing**: Drone navigates back to Home position and descends vertically.
24. **Touchdown & Disarm**: Touchdown detected by ground contact; motors safely disarm.

---

## Pixhawk / ArduPilot Essential Parameters
| Parameter | Recommended Value | Description |
| :--- | :--- | :--- |
| `SERIAL2_PROTOCOL` | `2` | MAVLink 2 protocol on TELEM2 port |
| `SERIAL2_BAUD` | `57` | 57600 baud rate on TELEM2 port |
| `RTL_ALT` | `0` or `500` | 0 = Return at current altitude; 500 = 5m return altitude (prevents unwanted climbs to 15m) |
| `RTL_CLIMB_MIN` | `0` | Minimum climb before returning |
| `FS_GCS_ENABLE` | `0` (testing) / `1` | GCS connection loss failsafe behavior |
| `PILOT_THR_FILT` | `0` | Controls pilot throttle filtering in assisted flight modes |

---

## Hardware Pinout Reference (ESP32-S3 ↔ Pixhawk 2.4.8)
- **Pixhawk TELEM2 Pin 2 (TX)** $\longrightarrow$ **ESP32-S3 GPIO 18 (RX)**
- **Pixhawk TELEM2 Pin 3 (RX)** $\longrightarrow$ **ESP32-S3 GPIO 17 (TX)**
- **Pixhawk TELEM2 Pin 6 (GND)** $\longrightarrow$ **ESP32-S3 GND**
- **ESP32 Power**: 5V supply from external BEC or dedicated USB power.
