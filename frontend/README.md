# SAE INDIA Drone Tactical Ground Station (Frontend)

The **SAE INDIA Autonomous Drone Ground Station & CV Telemetry Dashboard** is a high-performance React 18 + Vite web application styled with Tailwind CSS and tactical dark-mode HUD aesthetics.

It is fully configured for deployment on **Netlify**.

---

## Deployment on Netlify

### Method 1: Git Integration (Recommended)
1. Push this repository to GitHub.
2. In your [Netlify Dashboard](https://app.netlify.com/):
   - Click **Add new site** $\to$ **Import an existing project**.
   - Select **GitHub** and authorize your repo: `https://github.com/RISHITBARLA/saeindia.git`.
3. Configure the build settings:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/dist` (or `dist` if base directory is set to `frontend`)
4. Netlify will automatically detect [`frontend/netlify.toml`](./netlify.toml) and configure:
   - Node 20 runtime
   - SPA client routing fallback (`/* -> /index.html 200`)
   - HTTPS camera and geolocation permissions for QR code scanner & Leaflet drone tracking
5. Click **Deploy site**.

### Method 2: Netlify CLI
```bash
cd frontend
npm install -g netlify-cli
ntl init
ntl deploy --prod
```

---

## Environment Variables (Optional)

Configure in Netlify Site Settings $\to$ **Environment variables**:
- `VITE_RELAY_URL`: URL of your Render backend relay (e.g. `wss://saeindia-szj0.onrender.com/ws` or `https://saeindia-szj0.onrender.com`)
- `VITE_RELAY_TOKEN`: Secret handshake token (e.g. `<your_secure_relay_token>`)

---

## Local Development

```bash
cd frontend
npm install
npm run dev
```
Local development server will launch at `http://localhost:5173`.
