import jsQR from 'jsqr';
import { DecodedQRData, PhotoCaptureEvent } from '../types/mission';
import { audioService } from './audioService';
import { mavlinkService } from './mavlinkService';
import { reconDetectionService } from './reconDetectionService';
import { decodeQRFromImageData } from './qrDecoderService';

export type VisionFilterMode = 'NORMAL' | 'OPENCV_BINARIZED' | 'OPENCV_EDGES' | 'OPENCV_CONTRAST' | 'NIGHT_VISION' | 'CYBER_HUD';

type QRDetectListener = (data: DecodedQRData) => void;
type PhotoCaptureListener = (event: PhotoCaptureEvent, countdownSec: number) => void;
type CameraStateListener = (state: {
  isActive: boolean;
  facingMode: 'environment' | 'user';
  error?: string;
  hasTorch: boolean;
  isTorchOn: boolean;
  hasZoom: boolean;
  hardwareMaxZoom: number;
  currentZoom: number;
  minZoom: number;
  maxZoom: number;
  isAutoZoomEnabled: boolean;
  permissionGranted: boolean;
}) => void;

const PERMISSION_STORAGE_KEY = 'SAE_ANDROID_CAMERA_PERMISSION_V2';

class VisionService {
  private listeners: Set<QRDetectListener> = new Set();
  private photoListeners: Set<PhotoCaptureListener> = new Set();
  private cameraStateListeners: Set<CameraStateListener> = new Set();

  private isScanning: boolean = false;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;

  // Full-resolution original photo capture canvas
  private photoCanvasElement: HTMLCanvasElement | null = null;
  private photoCanvasCtx: CanvasRenderingContext2D | null = null;

  private stream: MediaStream | null = null;
  private isRequestingStream: boolean = false;
  private animFrameId: number | null = null;

  private latestResult: DecodedQRData | null = null;
  private latestVerifiedPhoto: string | null = null;
  private simulatedQrCode: string = '27';
  private useSimulatedFeed: boolean = false;
  private activeFilter: VisionFilterMode = 'NORMAL';

  private currentFacingMode: 'environment' | 'user' = 'environment';
  private isTorchOn: boolean = false;
  private hasTorch: boolean = false;
  private cameraError: string | undefined = undefined;
  private permissionGranted: boolean = false;

  // Strict wide-FOV operation: Locked at 1.0x (No digital/optical zoom sweeping)
  private readonly fixedZoom: number = 1.0;
  private hasHardwareZoom: boolean = false;
  private hardwareMaxZoom: number = 1.0;

  // Event-Driven Capture Engine with Debounce Protection
  private captureIntervalSec: number = 10;
  private countdownSec: number = 10;
  private periodicTimer: any = null;
  private countdownTimer: any = null;
  private photosAnalyzedCount: number = 0;
  private photosPurgedCount: number = 0;
  private latestCaptureEvent: PhotoCaptureEvent | null = null;
  private lastQrAlertTime: number = 0;
  private lastQrNotifyTime: number = 0;
  private lastCaptureTime: number = 0;
  private consecutiveDetectionFrames: number = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      this.canvasElement = document.createElement('canvas');
      this.canvasCtx = this.canvasElement.getContext('2d', { willReadFrequently: true });

      this.photoCanvasElement = document.createElement('canvas');
      this.photoCanvasCtx = this.photoCanvasElement.getContext('2d', { willReadFrequently: true });
    }
    this.checkInitialPermissionState();
  }

  private async checkInitialPermissionState() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(PERMISSION_STORAGE_KEY);
      if (stored === 'true') {
        this.permissionGranted = true;
      }
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (status.state === 'granted') {
          this.permissionGranted = true;
          localStorage.setItem(PERMISSION_STORAGE_KEY, 'true');
        }
      }
    } catch (e) {
      // ignore
    }
  }

  public isPermissionRemembered(): boolean {
    return this.permissionGranted;
  }

  public subscribeQR(fn: QRDetectListener) {
    this.listeners.add(fn);
    if (this.latestResult) fn(this.latestResult);
    return () => this.listeners.delete(fn);
  }

  public subscribePhotoEvents(fn: PhotoCaptureListener) {
    this.photoListeners.add(fn);
    if (this.latestCaptureEvent) {
      fn(this.latestCaptureEvent, this.countdownSec);
    }
    return () => this.photoListeners.delete(fn);
  }

  public subscribeCameraState(fn: CameraStateListener) {
    this.cameraStateListeners.add(fn);
    fn(this.getCameraState());
    return () => this.cameraStateListeners.delete(fn);
  }

  public getCameraState() {
    return {
      isActive: !!this.stream && this.isScanning,
      facingMode: this.currentFacingMode,
      error: this.cameraError,
      hasTorch: this.hasTorch,
      isTorchOn: this.isTorchOn,
      hasZoom: false, // Locked wide-angle FOV
      hardwareMaxZoom: 1.0,
      currentZoom: 1.0,
      minZoom: 1.0,
      maxZoom: 1.0,
      isAutoZoomEnabled: false, // Auto-zoom strictly disabled
      permissionGranted: this.permissionGranted
    };
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public isCameraRunning(): boolean {
    return Boolean(this.stream && this.isScanning && this.stream.active && this.stream.getVideoTracks().some(t => t.readyState === 'live'));
  }

  public setFilterMode(mode: VisionFilterMode) {
    this.activeFilter = mode;
  }

  public getFilterMode(): VisionFilterMode {
    return this.activeFilter;
  }

  public setAutoZoom(_enabled: boolean) {
    // Intentionally no-op: AERORECON requires wide-angle fixed FOV without digital zoom sweeps
    this.notifyCameraState();
  }

  public async setHardwareZoom(_zoomValue: number): Promise<boolean> {
    // Intentionally locked to 1.0x wide-angle
    this.notifyCameraState();
    return true;
  }

  public setCaptureInterval(seconds: number) {
    this.captureIntervalSec = Math.max(3, seconds);
    this.countdownSec = this.captureIntervalSec;
    this.restartTimers();
  }

  public getCaptureInterval(): number {
    return this.captureIntervalSec;
  }

  public getCountdownSec(): number {
    return this.countdownSec;
  }

  public getStats() {
    return {
      photosAnalyzedCount: this.photosAnalyzedCount,
      photosPurgedCount: this.photosPurgedCount,
      latestVerifiedPhoto: this.latestVerifiedPhoto
    };
  }

  public setSimulatedQR(code: string) {
    this.simulatedQrCode = code;
  }

  public setUseSimulatedFeed(sim: boolean) {
    this.useSimulatedFeed = sim;
  }

  public isUsingSimulatedFeed(): boolean {
    return this.useSimulatedFeed;
  }

  /**
   * Safe, Non-Repetitive Android Camera Initializer
   * Operates wide field of view at native resolution without zoom sweeps.
   */
  public async startCamera(videoRef: HTMLVideoElement, facing: 'environment' | 'user' = this.currentFacingMode): Promise<boolean> {
    this.videoElement = videoRef;
    this.isScanning = true;
    this.currentFacingMode = facing;
    this.cameraError = undefined;

    // 1. REUSE EXISTING STREAM IF LIVE
    if (this.stream && this.stream.active && this.stream.getVideoTracks().some(t => t.readyState === 'live')) {
      try {
        this.videoElement.srcObject = this.stream;
        await this.videoElement.play();
        this.useSimulatedFeed = false;
        this.notifyCameraState();
        this.startContinuousStreamScanning();
        this.startPeriodicCaptureLoop();
        return true;
      } catch (e) {
        console.warn('Re-attaching active stream failed', e);
      }
    }

    if (this.isRequestingStream) return false;
    this.isRequestingStream = true;

    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // Multi-tier progressive constraints: Prevents OverconstrainedError on phones, tablets, or webcams
        const constraintCandidates: MediaTrackConstraints[] = [
          // Preferred: High definition wide angle (ideal 1080p, without strict min)
          {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          // Flexible: Standard 720p
          {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          // Facing mode only
          {
            facingMode: { ideal: facing }
          },
          // Facing mode string
          {
            facingMode: facing
          },
          // Any available video hardware on device
          {}
        ];

        let stream: MediaStream | null = null;
        let lastErr: any = null;

        for (const videoCandidate of constraintCandidates) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: videoCandidate,
              audio: false
            });
            if (stream && stream.getVideoTracks().length > 0) {
              console.log('[VISION] Camera stream acquired with candidate constraints:', videoCandidate);
              break;
            }
          } catch (e: any) {
            lastErr = e;
            console.warn('[VISION] Camera candidate rejected, trying fallback:', e?.name || e?.message);
          }
        }

        if (!stream) {
          throw lastErr || new Error('No compatible video stream found on this device');
        }

        this.stream = stream;
        this.permissionGranted = true;
        this.isRequestingStream = false;

        if (typeof window !== 'undefined') {
          localStorage.setItem(PERMISSION_STORAGE_KEY, 'true');
        }

        this.videoElement.srcObject = stream;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        this.videoElement.setAttribute('playsinline', 'true');
        this.videoElement.setAttribute('muted', 'true');
        this.videoElement.setAttribute('autoplay', 'true');

        try {
          await this.videoElement.play();
        } catch (playErr) {
          console.warn('[VISION] Video play notice:', playErr);
        }

        const track = stream.getVideoTracks()[0];
        if (track) {
          const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
          this.hasTorch = !!capabilities.torch;
        }

        this.useSimulatedFeed = false;
        this.notifyCameraState();
        this.startContinuousStreamScanning();
        this.startPeriodicCaptureLoop();
        return true;
      }
    } catch (err: any) {
      this.isRequestingStream = false;
      this.cameraError = err.message || 'Camera permission not granted or device unavailable';
      this.notifyCameraState();
      return false;
    }

    this.isRequestingStream = false;
    this.cameraError = 'Camera device not supported in this environment';
    this.notifyCameraState();
    return false;
  }

  public async switchCamera(): Promise<boolean> {
    const nextFacing = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      return this.startCamera(this.videoElement, nextFacing);
    }
    return false;
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.stream || !this.hasTorch) return false;
    try {
      const track = this.stream.getVideoTracks()[0];
      if (track) {
        const next = !this.isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: next }]
        });
        this.isTorchOn = next;
        this.notifyCameraState();
        return true;
      }
    } catch (e) {
      console.warn('Failed to toggle torch', e);
    }
    return false;
  }

  public stopCamera() {
    this.isScanning = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.periodicTimer = null;
    this.countdownTimer = null;
    this.animFrameId = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.notifyCameraState();
  }

  private startContinuousStreamScanning() {
    let frame = 0;
    const loop = () => {
      if (!this.isScanning) return;
      frame++;
      // Process every 2nd frame for 15-30 FPS scanning without blocking UI thread
      if (frame % 2 === 0) {
        this.scanLiveFrameEdgeToEdge();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Continuous Full-Screen Edge-to-Edge QR Scanner:
   * Scans across 100% of the entire video frame with native wide FOV.
   * Identifies QR codes anywhere in the field of view without digital zoom or cropping.
   */
  private async scanLiveFrameEdgeToEdge() {
    if (this.useSimulatedFeed || !this.videoElement || this.videoElement.readyState < 2 || !this.canvasElement || !this.canvasCtx) {
      return;
    }

    try {
      const video = this.videoElement;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      this.canvasElement.width = width;
      this.canvasElement.height = height;
      this.canvasCtx.drawImage(video, 0, 0, width, height);

      // Extract uncropped full-frame image data
      const fullImageData = this.canvasCtx.getImageData(0, 0, width, height);
      this.applyOpenCVPreprocessing(fullImageData);

      // Full-frame edge-to-edge detection with jsQR
      let qrCode = jsQR(fullImageData.data, fullImageData.width, fullImageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (qrCode) {
        this.consecutiveDetectionFrames++;
        reconDetectionService.setVisualStatus('QR_DETECTED');
        reconDetectionService.setDroneCoreStatus('QR DETECTED');

        const rawText = qrCode.data || '';
        const hasData = rawText.trim().length > 0;
        const isValidTwoDigit = this.validateTwoDigitCode(rawText);

        const tl = qrCode.location.topLeftCorner;
        const tr = qrCode.location.topRightCorner;
        const br = qrCode.location.bottomRightCorner;
        const bl = qrCode.location.bottomLeftCorner;

        const minX = Math.min(tl.x, bl.x);
        const maxX = Math.max(tr.x, br.x);
        const minY = Math.min(tl.y, tr.y);
        const maxY = Math.max(bl.y, br.y);

        const boxW = Math.max(20, maxX - minX);
        const boxH = Math.max(20, maxY - minY);

        const normalizedBox = {
          xPercent: parseFloat(((minX / width) * 100).toFixed(2)),
          yPercent: parseFloat(((minY / height) * 100).toFixed(2)),
          widthPercent: parseFloat(((boxW / width) * 100).toFixed(2)),
          heightPercent: parseFloat(((boxH / height) * 100).toFixed(2)),
          centerXPercent: parseFloat((((minX + boxW / 2) / width) * 100).toFixed(2)),
          centerYPercent: parseFloat((((minY + boxH / 2) / height) * 100).toFixed(2))
        };

        const corners = {
          topLeft: { x: tl.x, y: tl.y, xPercent: (tl.x / width) * 100, yPercent: (tl.y / height) * 100 },
          topRight: { x: tr.x, y: tr.y, xPercent: (tr.x / width) * 100, yPercent: (tr.y / height) * 100 },
          bottomRight: { x: br.x, y: br.y, xPercent: (br.x / width) * 100, yPercent: (br.y / height) * 100 },
          bottomLeft: { x: bl.x, y: bl.y, xPercent: (bl.x / width) * 100, yPercent: (bl.y / height) * 100 }
        };

        // Capture Original Full-Resolution Photo (no digital zoom, native camera resolution)
        const snapshot = this.canvasElement.toDataURL('image/jpeg', 0.90);
        this.latestVerifiedPhoto = snapshot;

        const data: DecodedQRData = {
          rawText,
          code: rawText.trim(),
          isValidTwoDigit,
          detectedAt: Date.now(),
          confidence: hasData ? 0.99 : 0.70,
          photoSnapshotUrl: snapshot,
          boundingBox: { x: minX, y: minY, width: boxW, height: boxH },
          normalizedBox,
          corners
        };

        const now = Date.now();
        const prevCode = this.latestResult?.code;
        this.latestResult = data;

        // Check deduplication: avoid saving duplicate photos continuously for the same QR code
        const isDuplicate = hasData && reconDetectionService.isDuplicateDetection(rawText.trim());

        if (!isDuplicate && (now - this.lastCaptureTime > 2500 || prevCode !== data.code)) {
          this.lastCaptureTime = now;
          this.photosAnalyzedCount++;
          reconDetectionService.setDroneCoreStatus('CAPTURING PHOTO');

          // Dispatch event-driven original photo capture to Recon Detection Service
          reconDetectionService.handleRawDetectionEvent({
            photoDataUrl: snapshot,
            thumbnailDataUrl: snapshot,
            rawImageData: fullImageData,
            initialPayload: hasData ? rawText.trim() : null,
            boundingBox: { x: minX, y: minY, width: boxW, height: boxH }
          });
        }

        if (hasData && (now - this.lastQrAlertTime > 1500 || prevCode !== data.code)) {
          this.lastQrAlertTime = now;
          audioService.playQrDetected();
          audioService.triggerHaptic('success');
        }

        if (now - this.lastQrNotifyTime > 200 || prevCode !== data.code) {
          this.lastQrNotifyTime = now;
          this.notifyListeners(data);
        }
      } else {
        this.consecutiveDetectionFrames = 0;
      }
    } catch (e) {
      // scan error
    }
  }

  private startPeriodicCaptureLoop() {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.countdownSec = this.captureIntervalSec;

    this.countdownTimer = setInterval(() => {
      if (!this.isScanning) return;
      this.countdownSec--;
      if (this.countdownSec <= 0) {
        this.countdownSec = this.captureIntervalSec;
      }
      const telem = mavlinkService.getTelemetry();
      this.notifyPhotoListeners(this.latestCaptureEvent || {
        id: '',
        timestamp: Date.now(),
        intervalSec: this.captureIntervalSec,
        qrFound: false,
        autoPurged: false,
        altitudeMeters: telem.altitude || 10.0,
        latitude: telem.latitude || 0,
        longitude: telem.longitude || 0
      }, this.countdownSec);
    }, 1000);

    this.periodicTimer = setInterval(() => {
      if (!this.isScanning) return;
      this.captureAndAnalyzePhoto();
    }, this.captureIntervalSec * 1000);
  }

  private restartTimers() {
    if (this.isScanning) {
      this.startPeriodicCaptureLoop();
    }
  }

  public applyOpenCVPreprocessing(imageData: ImageData) {
    const data = imageData.data;
    const len = data.length;

    if (this.activeFilter === 'OPENCV_BINARIZED') {
      for (let i = 0; i < len; i += 4) {
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val = avg > 128 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (this.activeFilter === 'OPENCV_CONTRAST') {
      const factor = 1.6;
      for (let i = 0; i < len; i += 4) {
        data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
      }
    } else if (this.activeFilter === 'OPENCV_EDGES') {
      for (let i = 0; i < len; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
    }
  }

  /**
   * Captures the full original image at native camera resolution and performs synchronized Pixhawk telemetry association
   */
  public captureAndAnalyzePhoto(): PhotoCaptureEvent {
    this.photosAnalyzedCount++;
    const photoId = `PHOTO_SNAP_${Date.now()}_${this.photosAnalyzedCount}`;

    let qrResult: DecodedQRData | null = null;
    let retainedPhotoUrl: string | undefined = undefined;

    const telem = mavlinkService.getTelemetry();
    const lat = telem.latitude || 0;
    const lon = telem.longitude || 0;
    const alt = telem.altitude || 10.0;

    if (!this.useSimulatedFeed && this.videoElement && this.videoElement.readyState >= 2 && this.canvasElement && this.canvasCtx) {
      const video = this.videoElement;
      const width = video.videoWidth || 1920;
      const height = video.videoHeight || 1080;

      this.canvasElement.width = width;
      this.canvasElement.height = height;

      this.canvasCtx.drawImage(video, 0, 0, width, height);
      const imageData = this.canvasCtx.getImageData(0, 0, width, height);
      this.applyOpenCVPreprocessing(imageData);

      const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      retainedPhotoUrl = this.canvasElement.toDataURL('image/jpeg', 0.90);

      if (qrCode && qrCode.data) {
        const rawText = qrCode.data;
        const isValid = this.validateTwoDigitCode(rawText);

        this.latestVerifiedPhoto = retainedPhotoUrl;

        qrResult = {
          rawText,
          code: rawText.trim(),
          isValidTwoDigit: isValid,
          detectedAt: Date.now(),
          confidence: 0.98,
          photoSnapshotUrl: retainedPhotoUrl,
          boundingBox: {
            x: qrCode.location.topLeftCorner.x,
            y: qrCode.location.topLeftCorner.y,
            width: Math.abs(qrCode.location.topRightCorner.x - qrCode.location.topLeftCorner.x),
            height: Math.abs(qrCode.location.bottomLeftCorner.y - qrCode.location.topLeftCorner.y)
          }
        };

        // Forward to Recon Detection Service
        reconDetectionService.handleRawDetectionEvent({
          photoDataUrl: retainedPhotoUrl,
          thumbnailDataUrl: retainedPhotoUrl,
          rawImageData: imageData,
          initialPayload: rawText.trim()
        });
      }
    } else {
      if (this.latestResult) {
        qrResult = this.latestResult;
        retainedPhotoUrl = this.generateSyntheticTargetSnapshot(this.latestResult.code);
        qrResult.photoSnapshotUrl = retainedPhotoUrl;
        this.latestVerifiedPhoto = retainedPhotoUrl;
      }
    }

    const event: PhotoCaptureEvent = {
      id: photoId,
      timestamp: Date.now(),
      intervalSec: this.captureIntervalSec,
      qrFound: !!qrResult,
      qrCode: qrResult?.code,
      autoPurged: false, // Never discard captured image
      photoDataUrl: retainedPhotoUrl,
      altitudeMeters: alt,
      latitude: lat,
      longitude: lon
    };

    this.latestCaptureEvent = event;
    this.countdownSec = this.captureIntervalSec;

    if (qrResult) {
      this.latestResult = qrResult;
      audioService.playQrDetected();
      audioService.triggerHaptic('success');
      this.notifyListeners(qrResult);
    }

    this.notifyPhotoListeners(event, this.countdownSec);
    return event;
  }

  public triggerSimulatedDetection(code: string = '27', posXPercent: number = 50, posYPercent: number = 50) {
    const valid = this.validateTwoDigitCode(code);
    const snapshot = this.generateSyntheticTargetSnapshot(code);
    this.latestVerifiedPhoto = snapshot;

    const telem = mavlinkService.getTelemetry();
    const lat = telem.latitude || 17.385044;
    const lon = telem.longitude || 78.486671;
    const alt = telem.altitude || 10.0;

    const data: DecodedQRData = {
      rawText: code,
      code,
      isValidTwoDigit: valid,
      detectedAt: Date.now(),
      confidence: 0.98,
      photoSnapshotUrl: snapshot,
      boundingBox: {
        x: 320,
        y: 180,
        width: 160,
        height: 160
      },
      normalizedBox: {
        xPercent: Math.max(5, Math.min(75, posXPercent - 12)),
        yPercent: Math.max(5, Math.min(75, posYPercent - 12)),
        widthPercent: 24,
        heightPercent: 24,
        centerXPercent: posXPercent,
        centerYPercent: posYPercent
      }
    };

    this.latestResult = data;
    audioService.playQrDetected();
    audioService.triggerHaptic('success');

    // Forward to Recon Detection Service
    reconDetectionService.handleRawDetectionEvent({
      photoDataUrl: snapshot,
      thumbnailDataUrl: snapshot,
      initialPayload: code
    });

    const event: PhotoCaptureEvent = {
      id: `PHOTO_SNAP_${Date.now()}_SIM`,
      timestamp: Date.now(),
      intervalSec: this.captureIntervalSec,
      qrFound: true,
      qrCode: code,
      autoPurged: false,
      photoDataUrl: snapshot,
      altitudeMeters: alt,
      latitude: lat,
      longitude: lon
    };

    this.latestCaptureEvent = event;
    this.notifyPhotoListeners(event, this.countdownSec);
    this.notifyListeners(data);
  }

  public reportDecodedQR(code: string, confidence: number = 0.98) {
    const trimmed = (code || '').trim();
    const hasContent = trimmed.length > 0;
    const valid = this.validateTwoDigitCode(trimmed);
    const snapshot = this.generateSyntheticTargetSnapshot(trimmed);
    this.latestVerifiedPhoto = snapshot;

    const telem = mavlinkService.getTelemetry();

    const data: DecodedQRData = {
      rawText: trimmed,
      code: trimmed,
      isValidTwoDigit: valid,
      detectedAt: Date.now(),
      confidence,
      photoSnapshotUrl: snapshot,
      boundingBox: {
        x: 320,
        y: 180,
        width: 160,
        height: 160
      },
      normalizedBox: {
        xPercent: 38,
        yPercent: 38,
        widthPercent: 24,
        heightPercent: 24,
        centerXPercent: 50,
        centerYPercent: 50
      }
    };

    this.latestResult = data;
    if (hasContent) {
      audioService.playQrDetected();
      audioService.triggerHaptic('success');
      reconDetectionService.handleRawDetectionEvent({
        photoDataUrl: snapshot,
        thumbnailDataUrl: snapshot,
        initialPayload: trimmed
      });
    }

    const event: PhotoCaptureEvent = {
      id: `PHOTO_SNAP_${Date.now()}_IPCAM`,
      timestamp: Date.now(),
      intervalSec: this.captureIntervalSec,
      qrFound: hasContent,
      qrCode: trimmed,
      autoPurged: false,
      photoDataUrl: hasContent ? snapshot : undefined,
      altitudeMeters: telem.altitude || 10.0,
      latitude: telem.latitude || 0,
      longitude: telem.longitude || 0
    };

    this.latestCaptureEvent = event;
    this.notifyPhotoListeners(event, this.countdownSec);
    this.notifyListeners(data);
  }

  public validateTwoDigitCode(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return /^[0-9]{2}$/.test(trimmed);
  }

  public generateSyntheticTargetSnapshot(code: string): string {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 360);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < 640; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 360);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(240, 100, 160, 160);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    ctx.strokeRect(235, 95, 170, 170);

    ctx.fillStyle = '#000000';
    ctx.fillRect(250, 110, 30, 30);
    ctx.fillRect(360, 110, 30, 30);
    ctx.fillRect(250, 220, 30, 30);

    ctx.fillStyle = '#000000';
    if (code.length > 25) {
      ctx.font = 'bold 12px JetBrains Mono, monospace';
    } else if (code.length > 10) {
      ctx.font = 'bold 18px JetBrains Mono, monospace';
    } else if (code.length > 4) {
      ctx.font = 'bold 26px JetBrains Mono, monospace';
    } else {
      ctx.font = 'bold 52px JetBrains Mono, monospace';
    }
    ctx.textAlign = 'center';
    const displayLabel = code.length > 35 ? `${code.substring(0, 32)}...` : code;
    ctx.fillText(displayLabel, 320, 190);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.fillRect(235, 65, 170, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    const shortBadge = code.length > 12 ? `${code.substring(0, 10)}...` : code;
    ctx.fillText(`OPENCV TARGET [${shortBadge}] 98%`, 320, 82);

    return canvas.toDataURL('image/jpeg', 0.85);
  }

  private notifyListeners(data: DecodedQRData) {
    this.listeners.forEach((fn) => fn(data));
  }

  private notifyPhotoListeners(event: PhotoCaptureEvent, countdownSec: number) {
    this.photoListeners.forEach((fn) => fn(event, countdownSec));
  }

  private notifyCameraState() {
    const s = this.getCameraState();
    this.cameraStateListeners.forEach((fn) => fn(s));
  }
}

export const visionService = new VisionService();
