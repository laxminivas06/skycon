/**
 * IP Camera & Scanner Coordination Service
 * Manages IP Camera stream URL, ON/OFF power state, camera connectivity status,
 * and Scanner active state across Drone Core and Ground Station.
 */

export type IpCameraStatus = 'OFF' | 'CONNECTING' | 'LIVE' | 'DISCONNECTED';
export type ZoomListener = (zoom: number, isSweeping: boolean, isLocked: boolean) => void;

type StatusListener = (status: IpCameraStatus) => void;
type ToggleListener = (enabled: boolean) => void;
type UrlListener = (url: string) => void;

const STORAGE_KEY_ENABLED = 'drone_ip_camera_enabled';
const STORAGE_KEY_URL = 'drone_video_stream_url';
const STORAGE_KEY_SCANNER = 'drone_scanner_enabled';
const DEFAULT_URL = 'http://192.168.11.208:8080/video';

class IpCameraService {
  private enabled: boolean = false;
  private scannerEnabled: boolean = true;
  private streamUrl: string = DEFAULT_URL;
  private status: IpCameraStatus = 'OFF';
  private currentZoom: number = 1.0;
  private isAutoZoomSweeping: boolean = false;
  private isZoomLocked: boolean = false;
  private lockedQrCode: string | null = null;

  private statusListeners: Set<StatusListener> = new Set();
  private toggleListeners: Set<ToggleListener> = new Set();
  private scannerListeners: Set<ToggleListener> = new Set();
  private urlListeners: Set<UrlListener> = new Set();
  private zoomListeners: Set<ZoomListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      const storedEnabled = localStorage.getItem(STORAGE_KEY_ENABLED);
      // Default to false as required (user turns IP Camera ON when required)
      this.enabled = storedEnabled === 'true';

      const storedUrl = localStorage.getItem(STORAGE_KEY_URL);
      if (storedUrl && storedUrl.trim()) {
        this.streamUrl = storedUrl.trim();
      }

      const storedScanner = localStorage.getItem(STORAGE_KEY_SCANNER);
      this.scannerEnabled = storedScanner !== 'false';

      this.status = this.enabled ? 'CONNECTING' : 'OFF';

      // Listen to cross-tab storage events if multiple tabs/windows open
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY_ENABLED) {
          const isEn = e.newValue === 'true';
          this.setIpCameraEnabled(isEn, false);
        } else if (e.key === STORAGE_KEY_URL && e.newValue) {
          this.setStreamUrl(e.newValue, false);
        } else if (e.key === STORAGE_KEY_SCANNER) {
          const isScan = e.newValue !== 'false';
          this.setScannerEnabled(isScan, false);
        }
      });
    }
  }

  public isIpCameraEnabled(): boolean {
    return this.enabled;
  }

  public isScannerEnabled(): boolean {
    return this.scannerEnabled;
  }

  public getStreamUrl(): string {
    return this.streamUrl;
  }

  public getStatus(): IpCameraStatus {
    return this.status;
  }

  public setIpCameraEnabled(enabled: boolean, persist: boolean = true) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
    }
    this.status = enabled ? 'CONNECTING' : 'OFF';
    this.notifyToggle();
    this.notifyStatus();
  }

  public setScannerEnabled(enabled: boolean, persist: boolean = true) {
    if (this.scannerEnabled === enabled) return;
    this.scannerEnabled = enabled;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_SCANNER, String(enabled));
    }
    this.notifyScanner();
  }

  public setStreamUrl(url: string, persist: boolean = true) {
    const trimmed = url.trim();
    if (!trimmed || this.streamUrl === trimmed) return;
    this.streamUrl = trimmed;
    if (persist && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_URL, trimmed);
    }
    if (this.enabled) {
      this.status = 'CONNECTING';
      this.notifyStatus();
    }
    this.notifyUrl();
  }

  public setStatus(status: IpCameraStatus) {
    if (this.status === status) return;
    this.status = status;
    this.notifyStatus();
  }

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
    fn(this.streamUrl);
    return () => this.urlListeners.delete(fn);
  }

  private notifyStatus() {
    this.statusListeners.forEach((fn) => {
      try {
        fn(this.status);
      } catch (err) {
        console.error('Error in statusListener', err);
      }
    });
  }

  private notifyToggle() {
    this.toggleListeners.forEach((fn) => {
      try {
        fn(this.enabled);
      } catch (err) {
        console.error('Error in toggleListener', err);
      }
    });
  }

  private notifyScanner() {
    this.scannerListeners.forEach((fn) => {
      try {
        fn(this.scannerEnabled);
      } catch (err) {
        console.error('Error in scannerListener', err);
      }
    });
  }

  private notifyUrl() {
    this.urlListeners.forEach((fn) => {
      try {
        fn(this.streamUrl);
      } catch (err) {
        console.error('Error in urlListener', err);
      }
    });
  }

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

  public setZoom(zoom: number) {
    const clamped = Math.max(1.0, Math.min(4.0, Math.round(zoom * 10) / 10));
    if (this.currentZoom === clamped) return;
    this.currentZoom = clamped;
    this.notifyZoom();
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

  public subscribeZoom(fn: ZoomListener): () => void {
    this.zoomListeners.add(fn);
    fn(this.currentZoom, this.isAutoZoomSweeping, this.isZoomLocked);
    return () => this.zoomListeners.delete(fn);
  }

  private notifyZoom() {
    this.zoomListeners.forEach((fn) => {
      try {
        fn(this.currentZoom, this.isAutoZoomSweeping, this.isZoomLocked);
      } catch (err) {
        console.error('Error in zoomListener', err);
      }
    });
  }

  /**
   * Dispatches Remote Hardware PTZ Zoom to Samsung S24 (IP Webcam app)
   * Controls optical and digital camera zoom hardware directly on phone.
   */
  public async sendPtzZoom(phoneBaseUrl: string, zoomRatio: number, triggerFocus: boolean = false): Promise<boolean> {
    const cleanBase = phoneBaseUrl.trim().replace(/\/+$/, '');
    const zoomPercent = Math.max(0, Math.min(100, Math.round(((zoomRatio - 1.0) / 3.0) * 100)));

    // 1. Send direct to phone
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

    // 2. Also dispatch via backend relay proxy
    try {
      const relayUrl = `/api/ipcam/ptz?target=${encodeURIComponent(cleanBase)}&zoom=${zoomPercent}&focus=${triggerFocus ? 1 : 0}`;
      fetch(relayUrl).catch(() => {});
    } catch {
      // Ignored
    }
    return true;
  }
}

export const ipCameraService = new IpCameraService();
