# SAE India Autonomous Drone Mission & Telemetry System — Project Rules & Context

## Project Mission & Overview
This workspace hosts the **SAE INDIA Autonomous Drone Rescue & QR Mission System** (`saeindia`).
The primary competition objective is:
1. **Search & Rescue Navigation**: Autonomous takeoff, search pattern generation (Grid, Spiral, Perimeter, Adaptive), and flight controller navigation.
2. **Computer Vision & Target Tracking**: Onboard detection of target boxes (cardboard brown, white top-face cuboid), visual servoing, and decoding 2-digit QR codes matching regex `^\d{2}$`.
3. **P2P Runner Handshake**: Instant direct dispatch of the decoded 2-digit rescue code to a designated Field Runner device (~10–15m away) and cryptographic ACK confirmation.
4. **Autonomous Return-to-Launch**: Immediate transition to RTL upon Runner ACK confirmation or safe mission completion.

---

## Architecture & Codebase Guidelines

### 1. Flight Controller & MAVLink Standards (`mavlinkService.ts`)
- **Autopilot Target**: ArduPilot Copter / Pixhawk 2.4.8 (TELEM2 @ 57600 baud).
- **Flight Modes**: Always use correct ArduPilot custom mode integers and names:
  - `STABILIZE` (0), `ALT_HOLD` (2), `AUTO` (3), `GUIDED` (4), `LOITER` (5), `RTL` (6), `CIRCLE` (7), `LAND` (9), `POSHOLD` (16).
- **Repositioning & Waypoints**:
  - For GUIDED waypoints, use `MAV_CMD_DO_REPOSITION` (192) or upload waypoint sequences using standard ArduPilot `MISSION_ITEM_INT` (73) with frame `MAV_FRAME_GLOBAL_RELATIVE_ALT_INT` (6).
  - Never pass `0, 0` coordinates or unverified null coordinates to navigation commands. Always validate coordinates using geodesic checks (`Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001`).
- **Altitude Handling & Tolerance**:
  - Telemetry altitude comes from `GLOBAL_POSITION_INT.relative_alt` (relative to home) and `VFR_HUD.alt`.
  - When awaiting altitude transitions (e.g. from takeoff to orbit/search), **never use zero or rigid strict tolerances (like < 0.2m)**. Real-world barometers drift. Use at least **±1.0m** tolerance OR a leveled-off climb rate check (`Math.abs(verticalSpeed) < 0.25 m/s`) to prevent altitude deadlocks.
- **Failsafe & RTL Altitudes**:
  - Pixhawk's `RTL_ALT` default is 15m. Always ensure mission target altitude and RTL behavior accounts for this vertical climb before horizontal movement.

### 2. Autonomous State Machine (`missionEngine.ts`, `circleTestService.ts`)
- Maintain predictable state transitions with clear watchdog timeouts.
- State machines must clean up all interval timers (`clearTimeout`, `clearInterval`) on abort, reset, or completion.
- Always provide manual operator abort capabilities that fall back safely to `LOITER` or `LAND` if airborne.

### 3. Vision & Detection Pipeline (`boxDetectionService.ts`, `visionService.ts`)
- Target Box detection requires multi-frame verification (minimum 3 consecutive frames) before acquiring lock.
- Apply Exponential Moving Average (EMA) smoothing across bounding boxes to filter camera jitter.
- QR codes MUST validate strictly against regex `^\d{2}$` (exactly two digits).
- Audio cues (`audioService`) and haptic feedback accompany major vision milestones (box locked, QR decoded, ACK received).

### 4. Telemetry Transports (`frontend/src/services/transports/`)
- Support hybrid communication paths:
  1. Direct ESP32-S3 WebSocket (`ws://<ip>:8080/ws`) on local field hotspot.
  2. Production Cloud Secure Relay (`wss://<relay-url>/ws`) deployed on Render (`backend/server.js`) with authentication token.
  3. Android USB Host OTG Serial (`AndroidUsbTransport`) for tethered operation.
  4. WebSerial / WebUSB for Chromium browser direct serial.
- Always implement automatic reconnection with exponential backoff and packet stream heartbeat watchdogs.

### 5. Frontend & UI Conventions (`frontend/`)
- Built with React 18, TypeScript, Tailwind CSS, Lucide icons, Leaflet, and Capacitor. Configured for Netlify deployment via `frontend/netlify.toml`.
- Tactical Dark Mode (`bg-sae-dark`, neon accents `sky-400`, `amber-400`, `emerald-400`).
- Ensure all interactive controls feature explicit tactile feedback, disabling during in-flight commands to prevent duplicate execution.

### 6. Deployment Architecture
- **Frontend (Netlify)**: Located in `frontend/`. Deploys via `npm run build` with output in `frontend/dist`. Single-Page Application redirects managed via `netlify.toml` and `public/_redirects`.
- **Backend (Render)**: Located in `backend/`. Deploys via `render.yaml` blueprint with health check at `/health` and WebSocket relay at `/ws`.

