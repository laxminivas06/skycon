# 🛸 SAE INDIA Autonomous Drone Rescue & Mission System

Full-stack autonomous drone telemetry, computer vision target acquisition, and field rescue system built for the **SAE INDIA Autonomous Drone Competition**.

---

## 📁 Monorepo Architecture

This repository is split into dedicated, decoupled directories for seamless deployment on **Netlify** (frontend) and **Render** (backend):

```
saeindia/
├── frontend/               # 🌐 Frontend React 18 + Vite Web App (Deployed on Netlify)
│   ├── src/                # Ground Station HUD, MAVLink services, CV pipeline
│   ├── public/             # Static assets, audio alerts, Netlify _redirects
│   ├── netlify.toml        # Netlify SPA redirects & security headers
│   ├── vite.config.ts      # Vite configuration
│   └── package.json        # Frontend dependencies
│
├── backend/                # ⚡ Backend WebSocket & HTTP Relay (Deployed on Render)
│   ├── server.js           # WSS binary packet forwarder & telemetry bridge
│   ├── render.yaml         # Render Blueprint configuration
│   └── package.json        # Backend dependencies
│
├── android/                # 📱 Capacitor Android Studio native project
├── esp32-firmware/         # 📡 ESP32-S3 Wi-Fi / UART bridge firmware
├── tests/                  # 🧪 Comprehensive 49-point automated test suite
├── netlify.toml            # Root Netlify configuration (points to frontend/)
├── render.yaml             # Root Render blueprint (points to backend/)
└── package.json            # Root workspace orchestrator
```

---

## 🚀 Deployment Instructions

### 1. Deploy Frontend to Netlify

1. In [Netlify](https://app.netlify.com/), click **Add new site** $\to$ **Import an existing project**.
2. Select your GitHub repository: `https://github.com/RISHITBARLA/saeindia.git`.
3. Netlify automatically reads [`netlify.toml`](./netlify.toml):
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Environment Variables (optional):
   - `VITE_RELAY_URL`: `wss://YOUR_RENDER_URL/ws`
   - `VITE_RELAY_TOKEN`: Your secure relay token
5. Click **Deploy site**.

### 2. Deploy Backend to Render

1. In [Render](https://dashboard.render.com/), click **New +** $\to$ **Blueprint** (or **Web Service**).
2. Connect your GitHub repository: `https://github.com/GudlaVishal-23/seasphndrone.git`.
3. Render automatically reads [`render.yaml`](./render.yaml):
   - **Root directory**: `backend`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Health check path**: `/health`
4. Set Environment Variables:
   - `RELAY_TOKEN`: `<your_secure_relay_token>` (must match frontend `VITE_RELAY_TOKEN`)
   - `PORT`: `10000`
5. Click **Apply / Create Web Service**.

---

## 💻 Local Development

### Root Orchestrator Scripts
```bash
# Run Frontend (Vite on http://localhost:5173)
npm run dev

# Build Frontend (outputs to frontend/dist)
npm run build

# Run Backend Relay Server (port 8443)
npm run start

# Run Comprehensive Function Test Suite (49/49 Tests)
npm test
```

### Developing in Subdirectories
```bash
# Frontend only
cd frontend
npm install
npm run dev

# Backend only
cd backend
npm install
npm start
```
