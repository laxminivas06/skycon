/**
 * AERORECON — Resilient Cloud & Local API Client
 * 
 * Provides unified, resilient request handling for Ground Station API endpoints:
 * 1. Primary: Relative path (e.g. /api/missions/active), routed through Netlify / Vite proxy.
 * 2. Fallback: Direct Render production cloud backend (https://dronebackend-ppgp.onrender.com/api/...)
 *    if the reverse proxy returns 502 Bad Gateway (e.g. during Render free-tier cold starts) or fails.
 * 3. Short-circuit: If Netlify proxy recently failed with 502, bypasses proxy to directly query Render
 *    to avoid flooding the browser console with 502 Bad Gateway errors.
 * 4. Background Wakeup: Pings /health on app launch to preemptively warm up the Render container.
 */

const RENDER_PROD_API_BASE = 'https://dronebackend-ppgp.onrender.com';

let directRenderUntil = 0;

export async function fetchWithFallback(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const isNetlifyOrRemote = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');

  // If proxy recently failed with 502/503/504, go directly to Render backend
  if (isNetlifyOrRemote && Date.now() < directRenderUntil) {
    try {
      const directUrl = `${RENDER_PROD_API_BASE}${cleanEndpoint}`;
      return await fetch(directUrl, options);
    } catch (err) {
      // Fallback to standard request below
    }
  }

  // 1. Try local / proxy endpoint first
  try {
    const res = await fetch(cleanEndpoint, options);
    
    // If Netlify proxy returns 502/503/504, attempt direct Render fallback and remember for 30s
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      if (isNetlifyOrRemote) {
        directRenderUntil = Date.now() + 30000;
        const directUrl = `${RENDER_PROD_API_BASE}${cleanEndpoint}`;
        try {
          const directRes = await fetch(directUrl, options);
          return directRes;
        } catch {
          return res;
        }
      }
    }
    return res;
  } catch (err) {
    // If network failed on proxy, try direct Render backend
    if (isNetlifyOrRemote) {
      directRenderUntil = Date.now() + 30000;
      const directUrl = `${RENDER_PROD_API_BASE}${cleanEndpoint}`;
      return await fetch(directUrl, options);
    }
    throw err;
  }
}

let isWokenUp = false;
export function wakeUpBackend(): void {
  if (typeof window === 'undefined' || isWokenUp) return;
  isWokenUp = true;
  // Fire-and-forget background ping to Render /health to warm up cold container
  try {
    fetch(`${RENDER_PROD_API_BASE}/health`, { mode: 'cors' }).catch(() => {});
  } catch {}
}

// Automatically wake up backend once when client module loads
wakeUpBackend();
