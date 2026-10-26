# SAE INDIA MAVLink Relay Server (Backend)

The **SAE INDIA Autonomous Drone Mission Relay Server** is a lightweight, low-latency WebSocket & HTTP relay designed for deployment on **Render** (or any Node.js hosting platform).

It bridges telemetry and MAVLink binary frames between:
1. **Drone Telemetry Source**: ESP32-S3 wireless bridge or local connector
2. **Ground Station Web Client**: Netlify frontend, Chrome/Edge browser, or Android Capacitor APK

---

## Deployment on Render

### Method 1: Render Blueprint (Recommended)
1. Push this repository to GitHub.
2. In Render Dashboard, click **New +** $\to$ **Blueprint**.
3. Select your repository. Render will automatically detect [`render.yaml`](./render.yaml).
4. Click **Apply**.

### Method 2: Manual Web Service
1. In Render Dashboard, click **New +** $\to$ **Web Service**.
2. Connect your GitHub repository: `https://github.com/GudlaVishal-23/seasphndrone.git`.
3. Set the configuration:
   - **Name**: `saeindia-relay-server`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. Add Environment Variables:
   - `PORT`: `10000` (or leave default assigned by Render)
   - `RELAY_TOKEN`: `<your_secure_relay_token>` (or your chosen secure token)

---

## Endpoints

- **`GET /health`**: Health check probe returning JSON server status, uptime, and active connections.
- **`GET /`**: Diagnostic status dashboard with packet throughput and connected endpoints.
- **`WS /ws?token=<RELAY_TOKEN>`**: Authenticated WebSocket duplex channel for telemetry and MAVLink frames.
