/**
 * IP Camera & Scanner Coordination Service
 * Manages Phone IP Camera stream configuration, connectivity status,
 * optical & digital zoom coordination, and real-time QR scanning.
 */

import { decodeQRFromImageData, QRDecodeResult } from './qrDecoderService';
import { audioService } from './audioService';
import { reconDetectionService } from './reconDetectionService';

export type IpCameraStatus = 'OFF' | 'CONNECTING' | 'LIVE' | 'DISCONNECTED';
export type CameraSourceMode = 'DRONE_CORE' | 'PHONE_IP_CAM';
export type IpCameraPreset = 'IP_WEBCAM_ANDROID' | 'DROIDCAM' | 'ESP32_CAM' | 'CUSTOM';

export interface IpCameraConfig {
  preset: IpCameraPreset;
  ip: string;
  port: number;
  path: string;
  snapshotPath: string;
  fullUrl: string;
  useProxy: boolean;
}

export interface QRBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IpCameraDetection {
  qrResult: QRDecodeResult;
  boundingBox: QRBoundingBox;
  confidence: number;
  timestamp: number;
  photoDataUrl?: string;
}

export type ZoomListener = (zoom: number, isSweeping: boolean, isLocked: boolean) => void;
export type StatusListener = (status: IpCameraStatus) => void;
export type ToggleListener = (enabled: boolean) => void;
export type UrlListener = (url: string) => void;
export type DetectionListener = (detection: IpCameraDetection | null) => void;
export type ConfigListener = (config: IpCameraConfig) => void;
export type SourceModeListener = (mode: CameraSourceMode) => void;

const STORAGE_KEY_ENABLED = 'drone_ip_camera_enabled';
const STORAGE_KEY_URL = 'drone_video_stream_url';
const STORAGE_KEY_SCANNER = 'drone_scanner_enabled';
const STORAGE_KEY_CONFIG = 'drone_ip_camera_config_v2';
const STORAGE_KEY_SOURCE_MODE = 'drone_camera_source_mode';

const DEFAULT_CONFIG: IpCameraConfig = {
  preset: 'IP_WEBCAM_ANDROID',
  ip: '192.168.1.5',
  port: 8080,
  path: '/video',
  snapshotPath: '/shot.jpg',
  fullUrl: 'http://192.168.1.5:8080/video',
  useProxy: true
};

class IpCameraService {
  private enabled: boolean = false;
  private scannerEnabled: boolean = true;
  private sourceMode: CameraSourceMode = 'PHONE_IP_CAM';
  private config: IpCameraConfig = { ...DEFAULT_CONFIG };
  private status: IpCameraStatus = 'OFF';
  private currentZoom: number = 1.0;
  private isAutoZoomSweeping: boolean = false;
  private isZoomLocked: boolean = false;
  private lockedQrCode: string | null = null;
  private latestDetection: IpCameraDetection | null = null;

  // Active scan worker state
  private scanIntervalId: any = null;
  private isScanProcessing: boolean = false;
  private activeMediaElement: HTMLImageElement | HTMLVideoElement | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private lastDetectedText: string | null = null;
  private lastDetectTimestamp: number = 0;

  // Listeners
  private statusListeners: Set<StatusListener> = new Set();
  private toggleListeners: Set<ToggleListener> = new Set();
  private scannerListeners: Set<ToggleListener> = new Set();
  private urlListeners: Set<UrlListener> = new Set();
  private zoomListeners: Set<ZoomListener> = new Set();
  private detectionListeners: Set<DetectionListener> = new Set();
  private configListeners: Set<ConfigListener> = new Set();
  private sourceModeListeners: Set<SourceModeListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      // 1. Load config
      try {
        const storedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (storedConfig) {
          const parsed = JSON.parse(storedConfig);
          this.config = { ...DEFAULT_CONFIG, ...parsed };
        }
      } catch {
        this.config = { ...DEFAULT_CONFIG };
      }

      // 2. Legacy / direct stream URL fallback
      const storedUrl = localStorage.getItem(STORAGE_KEY_URL);
      if (storedUrl && storedUrl.trim()) {
        this.config.fullUrl = storedUrl.trim();
        const parsedParts = this.parseUrl(storedUrl.trim());
        if (parsedParts) {
          this.config.ip = parsedParts.ip;
          this.config.port = parsedParts.port;
          this.config.path = parsedParts.path;
        }
      }

      // 3. Enabled state
      const storedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED);
      this.enabled = storedEnabled === 'true';

      // 4. Scanner active state
      const storedScanner = localStorage.getItem(STORAGE_KEY_SCANNER);
      this.scannerEnabled = storedScanner !== 'false';

      // 5. Source mode
      const storedMode = localStorage.getItem(STORAGE_KEY_SOURCE_MODE) as CameraSourceMode;
      if (storedMode === 'DRONE_CORE' || storedMode === 'PHONE_IP_CAM') {
        this.sourceMode = storedMode;
      }

      this.status = this.enabled ? 'CONNECTING' : 'OFF';

      // Prepare offscreen canvas
      if (typeof document !== 'undefined') {
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      // Listen to cross-tab storage events
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY_ENABLED) {
          this.setIpCameraEnabled(e.newValue === 'true', false);
        } else if (e.key === STORAGE_KEY_URL && e.newValue) {
          this.setStreamUrl(e.newValue, false);
        } else if (e.key === STORAGE_KEY_SCANNER) {
          this.setScannerEnabled(e.newValue !== 'false', false);
        } else if (e.key === STORAGE_KEY_SOURCE_MODE && e.newValue) {
          this.setSourceMode(e.newValue as CameraSourceMode, false);
        }
      });
    }
  }

  // =========================================================================
  // URL HELPERS & PRESETS
  // =========================================================================

  public parseUrl(url: string): { ip: string; port: number; path: string } | null {
    try {
      const match = url.match(/^https?:\/\/([^:/]+)(?::(\d+))?(\/.*)?$/i);
      if (match) {
        return {
          ip: match[1] || '192.168.1.5',
          port: match[2] ? parseInt(match[2], 10) : 8080,
          path: match[3] || '/video'
        };
      }
    } catch {
      // fallback
    }
    return null;
  }

  public buildUrl(ip: string, port: number, path: string): string {
    const cleanIp = ip.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `http://${cleanIp}:${port}${cleanPath}`;
  }

  public applyPreset(preset: IpCameraPreset, currentIp?: string): IpCameraConfig {
    const ip = currentIp || this.config.ip || '192.168.1.5';
    let port = 8080;
    let path = '/video';
    let snapshotPath = '/shot.jpg';

    switch (preset) {
      case 'IP_WEBCAM_ANDROID':
        port = 8080;
        path = '/video';
        snapshotPath = '/shot.jpg';
        break;
      case 'DROIDCAM':
        port = 4747;
        path = '/video';
        snapshotPath = '/cam/1/frame.jpg';
        break;
      case 'ESP32_CAM':
        port = 81;
        path = '/stream';
        snapshotPath = '/capture';
        break;
      case 'CUSTOM':
      default:
        port = this.config.port || 8080;
        path = this.config.path || '/video';
        snapshotPath = this.config.snapshotPath || '/shot.jpg';
        break;
    }

    const fullUrl = this.buildUrl(ip, port, path);
    const newConfig: IpCameraConfig = {
      ...this.config,
      preset,
      ip,
      port,
      path,
      snapshotPath,
      fullUrl
    };

    this.setConfig(newConfig);
    return newConfig;
  }

  public getEffectiveStreamUrl(): string {
    const raw = this.config.fullUrl;
    if (!raw) return '';
    if (this.config.useProxy && typeof window !== 'undefined') {
      return `/api/ipcam/proxy?url=${encodeURIComponent(raw)}`;
    }
    return raw;
  }

  public getSnapshotUrl(): string {
    const base = `http://${this.config.ip}:${this.config.port}`;
    const snap = this.config.snapshotPath.startsWith('/')
      ? `${base}${this.config.snapshotPath}`
      : `${base}/${this.config.snapshotPath}`;
    if (this.config.useProxy && typeof window !== 'undefined') {
      return `/api/ipcam/proxy?url=${encodeURIComponent(snap)}`;
    }
    return snap;
  }

  // =========================================================================
  // CONNECTION TEST & DIAGNOSTICS
  // =========================================================================

  public async testConnection(targetUrl?: string): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }> {
    const urlToTest = targetUrl || this.getEffectiveStreamUrl();
    if (!urlToTest) {
      return { ok: false, latencyMs: 0, error: 'Empty stream URL' };
    }

    const t0 = performance.now();
    try {
      // Test through snapshot or proxy endpoint with short timeout
      const probeUrl = urlToTest.includes('/api/ipcam/proxy')
        ? `${urlToTest}&_test=${Date.now()}`
        : `/api/ipcam/proxy?url=${encodeURIComponent(targetUrl || this.config.fullUrl)}&_test=${Date.now()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(probeUrl, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latencyMs = Math.round(performance.now() - t0);
      if (resp.ok) {
        return { ok: true, latencyMs };
      } else {
        const errorText = await resp.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          error: errorText || `HTTP status ${resp.status} (${resp.statusText})`
        };
      }
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0);
      if (err.name === 'AbortError') {
        return { ok: false, latencyMs, error: 'Connection timed out after 4000ms. Check IP and Wi-Fi.' };
      }
      return {
        ok: false,
        latencyMs,
        error: err?.message || 'Could not reach phone camera. Verify phone is on same Wi-Fi.'
      };
    }
  }

  // =========================================================================
  // CONFIG & STATE GETTERS / SETTERS
  // =========================================================================

  public getConfig(): IpCameraConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<IpCameraConfig>, persist: boolean = true) {
    this.config = { ...this.config, ...newConfig };
    if (!this.config.fullUrl || newConfig.ip || newConfig.port || newConfig.path) {
      this.config.fullUrl = this.buildUrl(this.config.ip, this.config.port, this.config.path);
    }
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
      localStorage.setItem(STORAGE_KEY_URL, this.config.fullUrl);
    }
    this.notifyConfig();
    this.notifyUrl();
  }

  public isIpCameraEnabled(): boolean {
    return this.enabled;
  }

  public isScannerEnabled(): boolean {
    return this.scannerEnabled;
  }

  public getStreamUrl(): string {
    return this.config.fullUrl;
  }

  public getStatus(): IpCameraStatus {
    return this.status;
  }

  public getSourceMode(): CameraSourceMode {
    return this.sourceMode;
  }

  public setSourceMode(mode: CameraSourceMode, persist: boolean = true) {
    if (this.sourceMode === mode) return;
    this.sourceMode = mode;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_SOURCE_MODE, mode);
    }
    this.sourceModeListeners.forEach((fn) => {
      try { fn(mode); } catch {}
    });
  }

  public setIpCameraEnabled(enabled: boolean, persist: boolean = true) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
    }
    this.status = enabled ? 'CONNECTING' : 'OFF';
    if (!enabled) {
      this.stopScanning();
      this.latestDetection = null;
      this.notifyDetection(null);
    }
    this.notifyToggle();
    this.notifyStatus();
  }

  public setScannerEnabled(enabled: boolean, persist: boolean = true) {
    if (this.scannerEnabled === enabled) return;
    this.scannerEnabled = enabled;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_SCANNER, String(enabled));
    }
    if (!enabled) {
      this.latestDetection = null;
      this.notifyDetection(null);
    }
    this.notifyScanner();
  }

  public setStreamUrl(url: string, persist: boolean = true) {
    const trimmed = url.trim();
    if (!trimmed || this.config.fullUrl === trimmed) return;
    this.config.fullUrl = trimmed;
    const parts = this.parseUrl(trimmed);
    if (parts) {
      this.config.ip = parts.ip;
      this.config.port = parts.port;
      this.config.path = parts.path;
    }
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_URL, trimmed);
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    }
    if (this.enabled) {
      this.status = 'CONNECTING';
      this.notifyStatus();
    }
    this.notifyConfig();
    this.notifyUrl();
  }

  public setStatus(status: IpCameraStatus) {
    if (this.status === status) return;
    this.status = status;
    this.notifyStatus();
  }

  // =========================================================================
  // ZOOM MANAGEMENT (DIGITAL & REMOTE HARDWARE PTZ)
  // =========================================================================

  public getZoom(): number {
    return this.currentZoom;
  }

  public isAutoZoom(): boolean {
    return this.isAutoZoomSweeping;
  }

  public isLocked(): boolean {
    return this.isZoomLocked;
  }

  public getLockedCode(): string | null {
    return this.lockedQrCode;
  }

  public setZoom(zoom: number, dispatchHardware: boolean = true) {
    const clamped = Math.max(1.0, Math.min(4.0, Math.round(zoom * 10) / 10));
    if (this.currentZoom === clamped) return;
    this.currentZoom = clamped;
    this.notifyZoom();

    if (dispatchHardware && this.config.ip) {
      const base = `http://${this.config.ip}:${this.config.port}`;
      this.sendPtzZoom(base, clamped, false);
    }
  }

  public stepZoom(delta: number) {
    this.setZoom(this.currentZoom + delta);
  }

  public setAutoZoomSweeping(sweeping: boolean) {
    if (this.isAutoZoomSweeping === sweeping) return;
    this.isAutoZoomSweeping = sweeping;
    if (sweeping) {
      this.isZoomLocked = false;
      this.lockedQrCode = null;
    }
    this.notifyZoom();
  }

  public lockZoom(qrCode: string) {
    this.isZoomLocked = true;
    this.isAutoZoomSweeping = false;
    this.lockedQrCode = qrCode;
    this.notifyZoom();
  }

  public unlockZoom() {
    this.isZoomLocked = false;
    this.lockedQrCode = null;
    this.notifyZoom();
  }

  public triggerFocus(): Promise<boolean> {
    const base = `http://${this.config.ip}:${this.config.port}`;
    return this.sendPtzZoom(base, this.currentZoom, true);
  }

  /**
   * Dispatches Remote Hardware PTZ Zoom to Phone (IP Webcam app)
   * Dispatches via direct fetch as well as through Vite relay proxy.
   */
  public async sendPtzZoom(phoneBaseUrl: string, zoomRatio: number, triggerFocus: boolean = false): Promise<boolean> {
    const cleanBase = phoneBaseUrl.trim().replace(/\/+$/, '');
    // 1.0x -> 0%, 4.0x -> 100%
    const zoomPercent = Math.max(0, Math.min(100, Math.round(((zoomRatio - 1.0) / 3.0) * 100)));

    // 1. Send direct to phone (for local network direct access)
    try {
      const directUrl = `${cleanBase}/ptz?zoom=${zoomPercent}`;
      const img = new Image();
      img.src = `${directUrl}&_t=${Date.now()}`;
      if (triggerFocus) {
        const focusImg = new Image();
        focusImg.src = `${cleanBase}/focus?_t=${Date.now()}`;
      }
    } catch {
      // Ignored
    }

    // 2. Also dispatch via Vite backend relay proxy (guarantees CORS bypass)
    try {
      const relayUrl = `/api/ipcam/ptz?target=${encodeURIComponent(cleanBase)}&zoom=${zoomPercent}&focus=${triggerFocus ? 1 : 0}`;
      fetch(relayUrl).catch(() => {});
    } catch {
      // Ignored
    }
    return true;
  }

  // =========================================================================
  // CONTINUOUS QR CODE SCANNER ENGINE
  // =========================================================================

  public attachScanner(element: HTMLImageElement | HTMLVideoElement): () => void {
    this.activeMediaElement = element;
    this.startScanning();
    return () => {
      if (this.activeMediaElement === element) {
        this.activeMediaElement = null;
        this.stopScanning();
      }
    };
  }

  public startScanning() {
    if (this.scanIntervalId) return;
    this.scanIntervalId = setInterval(() => this.processNextFrame(), 200); // 5 Hz scanning
  }

  public stopScanning() {
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
  }

  public getLatestDetection(): IpCameraDetection | null {
    return this.latestDetection;
  }

  private async processNextFrame() {
    if (!this.enabled || !this.scannerEnabled || this.isScanProcessing) return;
    if (!this.activeMediaElement || !this.offscreenCanvas || !this.offscreenCtx) return;

    const el = this.activeMediaElement;
    let width = 0;
    let height = 0;

    if (el instanceof HTMLImageElement) {
      if (!el.complete || el.naturalWidth <= 0) return;
      width = el.naturalWidth;
      height = el.naturalHeight;
    } else if (el instanceof HTMLVideoElement) {
      if (el.readyState < 2 || el.videoWidth <= 0) return;
      width = el.videoWidth;
      height = el.videoHeight;
    }

    if (width <= 0 || height <= 0) return;

    this.isScanProcessing = true;
    try {
      // Limit processing resolution to max 1280x720 for ultra-fast, smooth decode
      const maxDim = 1280;
      let targetW = width;
      let targetH = height;
      if (targetW > maxDim || targetH > maxDim) {
        const scale = maxDim / Math.max(targetW, targetH);
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetH * scale);
      }

      if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
        this.offscreenCanvas.width = targetW;
        this.offscreenCanvas.height = targetH;
      }

      this.offscreenCtx.drawImage(el, 0, 0, targetW, targetH);

      // Attempt reading image data
      let imageData: ImageData;
      try {
        imageData = this.offscreenCtx.getImageData(0, 0, targetW, targetH);
      } catch (e: any) {
        // If tainted canvas due to direct CORS, notify and suggest proxy
        if (e.name === 'SecurityError' && !this.config.useProxy) {
          console.warn('[IP CAMERA] Canvas tainted by direct CORS. Enabling Zero-CORS proxy...');
          this.setConfig({ useProxy: true });
        }
        return;
      }

      // Run QR Decoder Engine
      const qrResult = await decodeQRFromImageData(imageData);
      if (qrResult && qrResult.text) {
        const payload = qrResult.text.trim();
        const now = Date.now();

        // Calculate bounding box in pixel coordinates
        const bBox = this.extractBoundingBox(qrResult.points, targetW, targetH);

        const detection: IpCameraDetection = {
          qrResult,
          boundingBox: bBox,
          confidence: qrResult.isValidTwoDigit ? 0.98 : 0.90,
          timestamp: now
        };

        this.latestDetection = detection;
        this.notifyDetection(detection);

        // Sound, haptics, and recon record dispatch
        const isNewTarget = payload !== this.lastDetectedText || (now - this.lastDetectTimestamp > 3000);
        if (isNewTarget) {
          this.lastDetectedText = payload;
          this.lastDetectTimestamp = now;

          // Tactical audio and vibration
          audioService.playQrDetected();
          audioService.playTargetLock();
          audioService.triggerHaptic('success');

          // Auto-lock zoom if enabled
          if (this.isAutoZoomSweeping) {
            this.lockZoom(payload);
          }

          // Generate snapshot thumbnail data URL
          let photoDataUrl = '';
          try {
            photoDataUrl = this.offscreenCanvas.toDataURL('image/jpeg', 0.88);
            detection.photoDataUrl = photoDataUrl;
          } catch {}

          // Record in Ground Station Recon Detection Service
          reconDetectionService.handleRawDetectionEvent({
            photoDataUrl,
            thumbnailDataUrl: photoDataUrl,
            rawImageData: imageData,
            initialPayload: payload,
            boundingBox: bBox
          });
        }
      } else {
        // Clear active bounding box after 1.5 seconds if target is lost
        if (this.latestDetection && (Date.now() - this.latestDetection.timestamp > 1500)) {
          this.latestDetection = null;
          this.notifyDetection(null);
        }
      }
    } catch {
      // scan error handled
    } finally {
      this.isScanProcessing = false;
    }
  }

  private extractBoundingBox(points: any, frameWidth: number, frameHeight: number): QRBoundingBox {
    if (!points) {
      return {
        x: Math.round(frameWidth * 0.25),
        y: Math.round(frameHeight * 0.25),
        width: Math.round(frameWidth * 0.5),
        height: Math.round(frameHeight * 0.5)
      };
    }

    // jsQR format: { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner }
    if (points.topLeftCorner && points.topRightCorner && points.bottomRightCorner && points.bottomLeftCorner) {
      const minX = Math.max(0, Math.min(points.topLeftCorner.x, points.bottomLeftCorner.x));
      const maxX = Math.min(frameWidth, Math.max(points.topRightCorner.x, points.bottomRightCorner.x));
      const minY = Math.max(0, Math.min(points.topLeftCorner.y, points.topRightCorner.y));
      const maxY = Math.min(frameHeight, Math.max(points.bottomLeftCorner.y, points.bottomRightCorner.y));

      return {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.max(20, Math.round(maxX - minX)),
        height: Math.max(20, Math.round(maxY - minY))
      };
    }

    // zxing-wasm format: [{x, y}, ...] or {topLeft, topRight, ...}
    if (points.topLeft && points.bottomRight) {
      const minX = Math.max(0, Math.min(points.topLeft.x, points.bottomLeft?.x ?? points.topLeft.x));
      const maxX = Math.min(frameWidth, Math.max(points.topRight?.x ?? points.bottomRight.x, points.bottomRight.x));
      const minY = Math.max(0, Math.min(points.topLeft.y, points.topRight?.y ?? points.topLeft.y));
      const maxY = Math.min(frameHeight, Math.max(points.bottomLeft?.y ?? points.bottomRight.y, points.bottomRight.y));

      return {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.max(20, Math.round(maxX - minX)),
        height: Math.max(20, Math.round(maxY - minY))
      };
    }

    return {
      x: Math.round(frameWidth * 0.3),
      y: Math.round(frameHeight * 0.3),
      width: Math.round(frameWidth * 0.4),
      height: Math.round(frameHeight * 0.4)
    };
  }

  // =========================================================================
  // SUBSCRIPTIONS
  // =========================================================================

  public subscribeStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  public subscribeToggle(fn: ToggleListener): () => void {
    this.toggleListeners.add(fn);
    fn(this.enabled);
    return () => this.toggleListeners.delete(fn);
  }

  public subscribeScanner(fn: ToggleListener): () => void {
    this.scannerListeners.add(fn);
    fn(this.scannerEnabled);
    return () => this.scannerListeners.delete(fn);
  }

  public subscribeUrl(fn: UrlListener): () => void {
    this.urlListeners.add(fn);
    fn(this.config.fullUrl);
    return () => this.urlListeners.delete(fn);
  }

  public subscribeZoom(fn: ZoomListener): () => void {
    this.zoomListeners.add(fn);
    fn(this.currentZoom, this.isAutoZoomSweeping, this.isZoomLocked);
    return () => this.zoomListeners.delete(fn);
  }

  public subscribeDetection(fn: DetectionListener): () => void {
    this.detectionListeners.add(fn);
    fn(this.latestDetection);
    return () => this.detectionListeners.delete(fn);
  }

  public subscribeConfig(fn: ConfigListener): () => void {
    this.configListeners.add(fn);
    fn(this.config);
    return () => this.configListeners.delete(fn);
  }

  public subscribeSourceMode(fn: SourceModeListener): () => void {
    this.sourceModeListeners.add(fn);
    fn(this.sourceMode);
    return () => this.sourceModeListeners.delete(fn);
  }

  private notifyStatus() {
    this.statusListeners.forEach((fn) => {
      try { fn(this.status); } catch {}
    });
  }

  private notifyToggle() {
    this.toggleListeners.forEach((fn) => {
      try { fn(this.enabled); } catch {}
    });
  }

  private notifyScanner() {
    this.scannerListeners.forEach((fn) => {
      try { fn(this.scannerEnabled); } catch {}
    });
  }

  private notifyUrl() {
    this.urlListeners.forEach((fn) => {
      try { fn(this.config.fullUrl); } catch {}
    });
  }

  private notifyZoom() {
    this.zoomListeners.forEach((fn) => {
      try { fn(this.currentZoom, this.isAutoZoomSweeping, this.isZoomLocked); } catch {}
    });
  }

  private notifyDetection(detection: IpCameraDetection | null) {
    this.detectionListeners.forEach((fn) => {
      try { fn(detection); } catch {}
    });
  }

  private notifyConfig() {
    this.configListeners.forEach((fn) => {
      try { fn(this.config); } catch {}
    });
  }
}

export const ipCameraService = new IpCameraService();
