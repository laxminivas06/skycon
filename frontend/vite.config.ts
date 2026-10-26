import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'http';
import https from 'https';
import { URL } from 'url';

function ipCamProxyPlugin(): Plugin {
  return {
    name: 'ipcam-proxy-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const parsed = new URL(req.url, 'http://localhost:5173');

        // Handle CORS preflight
        if (req.method === 'OPTIONS' && (parsed.pathname === '/api/ipcam/proxy' || parsed.pathname === '/api/ipcam/ptz')) {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.end();
          return;
        }

        // 1. IP Camera Snapshot & Video Proxy (Zero CORS bypass)
        if (parsed.pathname === '/api/ipcam/proxy') {
          const targetUrl = parsed.searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: 'Missing target url parameter' }));
            return;
          }

          try {
            const client = targetUrl.startsWith('https://') ? https : http;
            const proxyReq = client.get(targetUrl, { timeout: 3500 }, (proxyRes) => {
              res.statusCode = proxyRes.statusCode || 200;
              res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
              proxyRes.pipe(res);
            });
            proxyReq.on('error', (err) => {
              if (res.headersSent) return;
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: `Cannot reach phone camera: ${err.message}` }));
            });
            proxyReq.on('timeout', () => {
              proxyReq.destroy();
              if (res.headersSent) return;
              res.statusCode = 504;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: 'Camera connection timed out' }));
            });
          } catch (e: any) {
            if (res.headersSent) return;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        // 2. IP Camera Remote PTZ Zoom Control Endpoint
        if (parsed.pathname === '/api/ipcam/ptz') {
          const targetBase = parsed.searchParams.get('target');
          const zoomVal = parseInt(parsed.searchParams.get('zoom') || '0', 10);
          const triggerFocus = parsed.searchParams.get('focus') === '1';

          if (!targetBase) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ error: 'Missing target camera address' }));
            return;
          }

          const cleanBase = targetBase.replace(/\/+$/, '');
          const zoomUrl = `${cleanBase}/ptz?zoom=${Math.max(0, Math.min(100, zoomVal))}`;
          const client = cleanBase.startsWith('https://') ? https : http;

          try {
            client.get(zoomUrl, { timeout: 1500 }, () => {}).on('error', () => {});
            if (triggerFocus) {
              client.get(`${cleanBase}/focus`, { timeout: 1500 }, () => {}).on('error', () => {});
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ success: true, zoom: zoomVal }));
          } catch {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({ success: false }));
          }
          return;
        }

        next();
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), ipCamProxyPlugin()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api/recon': {
        target: 'http://localhost:8443',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8443',
        ws: true
      }
    }
  }
});
