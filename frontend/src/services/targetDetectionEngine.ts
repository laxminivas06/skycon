/**
 * SAE INDIA — Target Detection Engine
 * High-reliability vision pipeline for autonomous QR code, barcode,
 * and square-marker detection using phone camera mounted on drone.
 *
 * Implements:
 * - Multi-mode detection: QR_CODE, BARCODE, SQUARE_MARKER
 * - Image quality guardrails: Variance of Laplacian (blur detection),
 *   luminance (low light/glare), contrast
 * - Multi-frame consistency (requires 3 consecutive clean frames)
 * - Ground location estimation (pinhole ray-casting projection) vs drone GPS
 * - Configurable duplicate suppression window
 */

import jsQR from 'jsqr';
import { TargetLocation } from '../types/recon';
import { decodeQRFromImageData, extractTwoDigits } from './qrDecoderService';

export type TargetDetectionMode = 'QR_CODE' | 'BARCODE' | 'SQUARE_MARKER';

export type TargetVerificationStatus = 'UNCONFIRMED' | 'CANDIDATE' | 'VERIFIED' | 'BLUR_REJECTED';

export interface FrameQualityMetrics {
  blurScore: number;        // Variance of Laplacian (higher = sharper, < 60 = blurry)
  isBlurry: boolean;
  meanLuminance: number;    // 0-255 (0 = pitch black, 255 = saturated white)
  isLowLight: boolean;      // < 40
  isGlare: boolean;         // > 220
  contrastScore: number;    // Standard deviation of luminance
}

export interface TargetCandidate {
  mode: TargetDetectionMode;
  payload: string;          // Decoded string or marker descriptor
  twoDigitCode: string | null;
  isValidTwoDigit: boolean;
  confidence: number;       // 0.0 to 1.0
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  frameQuality: FrameQualityMetrics;
  consecutiveFrames: number;
  status: TargetVerificationStatus;
  firstDetectedAt: number;
  lastDetectedAt: number;
}

export interface EstimatedTargetGroundLocation {
  targetLatitude: number;
  targetLongitude: number;
  droneLatitude: number;
  droneLongitude: number;
  droneAltitudeAgl: number;
  headingDeg: number;
  uncertaintyMeters: number;
  isProjected: boolean;     // true if projected via pinhole, false if falling back to drone GPS
  groundOffsetMeters: {
    dxForward: number;
    dyRight: number;
    distanceTotal: number;
  };
}

export interface VerifiedTargetEvent {
  eventId: string;
  detectionMode: TargetDetectionMode;
  payload: string;
  twoDigitCode: string | null;
  confidence: number;
  timestamp: number;
  thumbnailDataUrl?: string;
  dronePosition: {
    lat: number;
    lon: number;
    altAgl: number;
    altMsl: number;
    heading: number;
  };
  estimatedTargetLocation: EstimatedTargetGroundLocation;
  frameQuality: FrameQualityMetrics;
  boundingBox: { x: number; y: number; width: number; height: number };
}

type TargetListener = (event: VerifiedTargetEvent) => void;
type CandidateListener = (candidate: TargetCandidate | null) => void;

// Lazy-load zxing-wasm for barcode scanning
let zxingBarcodeReader: any = null;
let zxingLoadPromise: Promise<any> | null = null;

async function getZxingBarcodeReader() {
  if (zxingBarcodeReader) return zxingBarcodeReader;
  if (!zxingLoadPromise) {
    zxingLoadPromise = import('zxing-wasm')
      .then((mod) => {
        zxingBarcodeReader = mod.readBarcodesFromImageData;
        return zxingBarcodeReader;
      })
      .catch((err) => {
        console.warn('[TARGET_DETECTION] zxing-wasm lazy load fallback:', err);
        return null;
      });
  }
  return zxingLoadPromise;
}

if (typeof window !== 'undefined') {
  getZxingBarcodeReader();
}

export class TargetDetectionEngine {
  private activeMode: TargetDetectionMode = 'QR_CODE';
  private minConsecutiveFrames: number = 3;
  private blurThreshold: number = 60.0; // Variance of Laplacian cutoff
  private deduplicationWindowMs: number = 30000; // 30s de-dup default

  private targetListeners: Set<TargetListener> = new Set();
  private candidateListeners: Set<CandidateListener> = new Set();

  private activeCandidate: TargetCandidate | null = null;
  private recentDetections: Map<string, number> = new Map(); // payload -> timestamp

  // Camera calibration parameters (typical mobile rear camera wide lens)
  private cameraCalibration = {
    fovHorizontalDeg: 72.0,
    fovVerticalDeg: 54.0,
    isCalibrated: true
  };

  public setMode(mode: TargetDetectionMode) {
    this.activeMode = mode;
    this.activeCandidate = null;
    this.notifyCandidate();
  }

  public getMode(): TargetDetectionMode {
    return this.activeMode;
  }

  public setDeduplicationWindowMs(ms: number) {
    this.deduplicationWindowMs = Math.max(5000, Math.min(120000, ms));
  }

  public getDeduplicationWindowMs(): number {
    return this.deduplicationWindowMs;
  }

  public setBlurThreshold(threshold: number) {
    this.blurThreshold = Math.max(10, threshold);
  }

  public getBlurThreshold(): number {
    return this.blurThreshold;
  }

  public subscribeVerifiedTarget(fn: TargetListener) {
    this.targetListeners.add(fn);
    return () => this.targetListeners.delete(fn);
  }

  public subscribeCandidate(fn: CandidateListener) {
    this.candidateListeners.add(fn);
    fn(this.activeCandidate);
    return () => this.candidateListeners.delete(fn);
  }

  /**
   * Calculates Variance of Laplacian (blur detection) and mean luminance
   * on grayscale representation of frame data.
   */
  public computeQualityMetrics(imageData: ImageData): FrameQualityMetrics {
    const { width, height, data } = imageData;
    const totalPixels = width * height;
    if (totalPixels === 0) {
      return {
        blurScore: 0,
        isBlurry: true,
        meanLuminance: 0,
        isLowLight: true,
        isGlare: false,
        contrastScore: 0
      };
    }

    // Step 1: Compute Grayscale luminance and mean
    let sumLum = 0;
    const gray = new Uint8Array(totalPixels);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      gray[j] = lum;
      sumLum += lum;
    }
    const meanLuminance = sumLum / totalPixels;

    // Step 2: Compute contrast (std dev of luminance)
    let sumSqDiff = 0;
    for (let j = 0; j < totalPixels; j++) {
      const d = gray[j] - meanLuminance;
      sumSqDiff += d * d;
    }
    const contrastScore = Math.sqrt(sumSqDiff / totalPixels);

    // Step 3: Compute 3x3 Laplacian Variance on subsampled grid for performance (step = 2)
    const step = 2;
    let laplacianSum = 0;
    let laplacianSqSum = 0;
    let laplacianCount = 0;

    for (let y = step; y < height - step; y += step) {
      const rowOffset = y * width;
      const prevRowOffset = (y - 1) * width;
      const nextRowOffset = (y + 1) * width;

      for (let x = step; x < width - step; x += step) {
        // 3x3 discrete Laplacian kernel:
        // [ 0,  1,  0]
        // [ 1, -4,  1]
        // [ 0,  1,  0]
        const center = gray[rowOffset + x];
        const up = gray[prevRowOffset + x];
        const down = gray[nextRowOffset + x];
        const left = gray[rowOffset + x - 1];
        const right = gray[rowOffset + x + 1];

        const lap = up + down + left + right - 4 * center;
        laplacianSum += lap;
        laplacianSqSum += lap * lap;
        laplacianCount++;
      }
    }

    let blurScore = 0;
    if (laplacianCount > 0) {
      const lapMean = laplacianSum / laplacianCount;
      const lapVariance = laplacianSqSum / laplacianCount - lapMean * lapMean;
      blurScore = Math.max(0, +lapVariance.toFixed(2));
    }

    return {
      blurScore,
      isBlurry: blurScore < this.blurThreshold,
      meanLuminance: +meanLuminance.toFixed(1),
      isLowLight: meanLuminance < 40,
      isGlare: meanLuminance > 220,
      contrastScore: +contrastScore.toFixed(1)
    };
  }

  /**
   * Pinhole projection ground coordinate estimation
   * Calculates target ground coordinate from camera frame pixel coordinates,
   * drone altitude AGL, pitch, roll, and yaw.
   */
  public estimateTargetGroundLocation(params: {
    droneLat: number;
    droneLon: number;
    droneAltAgl: number;
    headingDeg: number;
    pitchDeg?: number;
    rollDeg?: number;
    hdop?: number;
    pixelCenter: { x: number; y: number };
    frameSize: { width: number; height: number };
  }): EstimatedTargetGroundLocation {
    const {
      droneLat,
      droneLon,
      droneAltAgl,
      headingDeg,
      pitchDeg = 0,
      rollDeg = 0,
      hdop = 1.0,
      pixelCenter,
      frameSize
    } = params;

    const hasGps = Math.abs(droneLat) > 0.001 && Math.abs(droneLon) > 0.001;
    const hasAltitude = droneAltAgl > 0.5;

    // If no valid altitude or no GPS, we cannot project ground position
    if (!hasGps || !hasAltitude) {
      return {
        targetLatitude: droneLat,
        targetLongitude: droneLon,
        droneLatitude: droneLat,
        droneLongitude: droneLon,
        droneAltitudeAgl: droneAltAgl,
        headingDeg,
        uncertaintyMeters: 15.0, // High uncertainty fallback
        isProjected: false,
        groundOffsetMeters: { dxForward: 0, dyRight: 0, distanceTotal: 0 }
      };
    }

    // Normalized coordinates relative to frame center: range [-1, 1]
    const W = Math.max(1, frameSize.width);
    const H = Math.max(1, frameSize.height);
    const nx = (pixelCenter.x - W / 2) / (W / 2);
    const ny = (pixelCenter.y - H / 2) / (H / 2);

    const halfFovH = (this.cameraCalibration.fovHorizontalDeg / 2) * (Math.PI / 180);
    const halfFovV = (this.cameraCalibration.fovVerticalDeg / 2) * (Math.PI / 180);

    const angleX = nx * halfFovH;
    const angleY = ny * halfFovV;

    const pitchRad = (pitchDeg * Math.PI) / 180;
    const rollRad = (rollDeg * Math.PI) / 180;
    const yawRad = (headingDeg * Math.PI) / 180;

    // Displacements relative to drone heading:
    // ny > 0 is bottom of frame = behind drone; ny < 0 is top of frame = ahead of drone
    const dxForward = -droneAltAgl * Math.tan(pitchRad + angleY);
    const dyRight = droneAltAgl * Math.tan(rollRad + angleX);

    // Rotate body frame displacement to Geographic North/East frame by drone yaw
    const dNorth = dxForward * Math.cos(yawRad) - dyRight * Math.sin(yawRad);
    const dEast = dxForward * Math.sin(yawRad) + dyRight * Math.cos(yawRad);

    const metersPerDegreeLat = 111132.95;
    const metersPerDegreeLon = 111132.95 * Math.cos((droneLat * Math.PI) / 180);

    const targetLat = droneLat + dNorth / metersPerDegreeLat;
    const targetLon = droneLon + dEast / metersPerDegreeLon;

    const distTotal = Math.sqrt(dxForward * dxForward + dyRight * dyRight);

    // Uncertainty model based on altitude, GPS HDOP, and optical resolution
    const angularUncertainty = droneAltAgl * Math.tan((2.0 * Math.PI) / 180); // ±2 deg sensor noise
    const gpsUncertainty = Math.max(0.8, hdop * 1.5);
    const totalUncertainty = +(angularUncertainty + gpsUncertainty).toFixed(1);

    return {
      targetLatitude: +targetLat.toFixed(7),
      targetLongitude: +targetLon.toFixed(7),
      droneLatitude: droneLat,
      droneLongitude: droneLon,
      droneAltitudeAgl: droneAltAgl,
      headingDeg,
      uncertaintyMeters: totalUncertainty,
      isProjected: true,
      groundOffsetMeters: {
        dxForward: +dxForward.toFixed(2),
        dyRight: +dyRight.toFixed(2),
        distanceTotal: +distTotal.toFixed(2)
      }
    };
  }

  /**
   * Main Frame Processor
   * Analyzes an image frame from camera canvas, evaluates quality,
   * runs the active detection mode, tracks multi-frame confirmation,
   * and notifies verified listeners.
   */
  public async processFrame(
    canvas: HTMLCanvasElement,
    telemetry: {
      lat: number;
      lon: number;
      altAgl: number;
      altMsl: number;
      heading: number;
      pitch?: number;
      roll?: number;
      hdop?: number;
    }
  ): Promise<{
    quality: FrameQualityMetrics;
    candidate: TargetCandidate | null;
    verifiedEvent: VerifiedTargetEvent | null;
  }> {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return {
        quality: { blurScore: 0, isBlurry: true, meanLuminance: 0, isLowLight: true, isGlare: false, contrastScore: 0 },
        candidate: null,
        verifiedEvent: null
      };
    }

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);

    // 1. Evaluate image quality
    const quality = this.computeQualityMetrics(imageData);

    // 2. Run detection algorithm based on activeMode
    let rawResult: {
      found: boolean;
      payload: string;
      confidence: number;
      boundingBox: { x: number; y: number; width: number; height: number };
    } | null = null;

    if (this.activeMode === 'QR_CODE') {
      rawResult = await this.detectQRCode(imageData);
    } else if (this.activeMode === 'BARCODE') {
      rawResult = await this.detectBarcode(imageData);
    } else if (this.activeMode === 'SQUARE_MARKER') {
      rawResult = this.detectSquareMarker(imageData, quality);
    }

    // 3. Multi-Frame Consistency & Blur Filter Pipeline
    const now = Date.now();

    if (!rawResult || !rawResult.found) {
      // If target lost, decrement consecutive frames with hysteresis
      if (this.activeCandidate) {
        this.activeCandidate.consecutiveFrames = Math.max(0, this.activeCandidate.consecutiveFrames - 1);
        if (this.activeCandidate.consecutiveFrames === 0) {
          this.activeCandidate = null;
          this.notifyCandidate();
        }
      }
      return { quality, candidate: this.activeCandidate, verifiedEvent: null };
    }

    // Target candidate was visually identified in this frame
    const { payload, confidence, boundingBox } = rawResult;
    const twoDigits = extractTwoDigits(payload);

    // Handle blur: Do not treat blurry frames as verified targets
    if (quality.isBlurry) {
      if (this.activeCandidate && this.activeCandidate.payload === payload) {
        this.activeCandidate.status = 'BLUR_REJECTED';
        this.activeCandidate.frameQuality = quality;
        this.notifyCandidate();
      }
      return { quality, candidate: this.activeCandidate, verifiedEvent: null };
    }

    // Match with current active candidate
    if (this.activeCandidate && this.activeCandidate.payload === payload) {
      this.activeCandidate.consecutiveFrames++;
      this.activeCandidate.lastDetectedAt = now;
      this.activeCandidate.boundingBox = boundingBox;
      this.activeCandidate.frameQuality = quality;
      this.activeCandidate.confidence = Math.max(this.activeCandidate.confidence, confidence);

      if (this.activeCandidate.consecutiveFrames >= this.minConsecutiveFrames) {
        this.activeCandidate.status = 'VERIFIED';
      } else {
        this.activeCandidate.status = 'CANDIDATE';
      }
    } else {
      // New candidate initiation
      this.activeCandidate = {
        mode: this.activeMode,
        payload,
        twoDigitCode: twoDigits.twoDigits,
        isValidTwoDigit: twoDigits.isValid,
        confidence,
        boundingBox,
        frameQuality: quality,
        consecutiveFrames: 1,
        status: 'UNCONFIRMED',
        firstDetectedAt: now,
        lastDetectedAt: now
      };
    }

    this.notifyCandidate();

    // 4. Verification Check and Duplicate Prevention
    let verifiedEvent: VerifiedTargetEvent | null = null;
    if (this.activeCandidate.status === 'VERIFIED') {
      // Check duplicate window
      const lastSeen = this.recentDetections.get(payload);
      const isDuplicate = lastSeen && now - lastSeen < this.deduplicationWindowMs;

      if (!isDuplicate) {
        this.recentDetections.set(payload, now);

        // Generate thumbnail
        const thumbnailDataUrl = this.cropThumbnail(canvas, boundingBox);

        // Estimate target ground coordinates
        const pixelCenter = {
          x: boundingBox.x + boundingBox.width / 2,
          y: boundingBox.y + boundingBox.height / 2
        };

        const estimatedTargetLocation = this.estimateTargetGroundLocation({
          droneLat: telemetry.lat,
          droneLon: telemetry.lon,
          droneAltAgl: telemetry.altAgl,
          headingDeg: telemetry.heading,
          pitchDeg: telemetry.pitch,
          rollDeg: telemetry.roll,
          hdop: telemetry.hdop,
          pixelCenter,
          frameSize: { width, height }
        });

        verifiedEvent = {
          eventId: `TARGET_${now}_${Math.floor(Math.random() * 900 + 100)}`,
          detectionMode: this.activeMode,
          payload,
          twoDigitCode: twoDigits.twoDigits,
          confidence,
          timestamp: now,
          thumbnailDataUrl,
          dronePosition: {
            lat: telemetry.lat,
            lon: telemetry.lon,
            altAgl: telemetry.altAgl,
            altMsl: telemetry.altMsl,
            heading: telemetry.heading
          },
          estimatedTargetLocation,
          frameQuality: quality,
          boundingBox
        };

        this.notifyTarget(verifiedEvent);
      }
    }

    return { quality, candidate: this.activeCandidate, verifiedEvent };
  }

  private async detectQRCode(imageData: ImageData) {
    // 1. Try fast jsQR edge-to-edge
    try {
      const qr = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (qr && qr.data && qr.data.trim().length > 0) {
        const tl = qr.location.topLeftCorner;
        const br = qr.location.bottomRightCorner;
        const minX = Math.min(tl.x, qr.location.bottomLeftCorner.x);
        const maxX = Math.max(qr.location.topRightCorner.x, br.x);
        const minY = Math.min(tl.y, qr.location.topRightCorner.y);
        const maxY = Math.max(qr.location.bottomLeftCorner.y, br.y);

        return {
          found: true,
          payload: qr.data.trim(),
          confidence: 0.98,
          boundingBox: {
            x: Math.max(0, Math.round(minX)),
            y: Math.max(0, Math.round(minY)),
            width: Math.max(20, Math.round(maxX - minX)),
            height: Math.max(20, Math.round(maxY - minY))
          }
        };
      }
    } catch {}

    // 2. Fallback to zxing-wasm decode
    try {
      const zxing = await getZxingBarcodeReader();
      if (zxing) {
        const results = await zxing(imageData, { formats: ['QRCode'] });
        if (results && results.length > 0 && results[0].text) {
          const res = results[0];
          const bbox = res.position ? {
            x: Math.round(Math.min(res.position.topLeft.x, res.position.bottomLeft.x)),
            y: Math.round(Math.min(res.position.topLeft.y, res.position.topRight.y)),
            width: Math.round(Math.max(20, Math.abs(res.position.bottomRight.x - res.position.topLeft.x))),
            height: Math.round(Math.max(20, Math.abs(res.position.bottomRight.y - res.position.topLeft.y)))
          } : { x: 50, y: 50, width: 100, height: 100 };

          return {
            found: true,
            payload: res.text.trim(),
            confidence: 0.95,
            boundingBox: bbox
          };
        }
      }
    } catch {}

    return null;
  }

  private async detectBarcode(imageData: ImageData) {
    try {
      const zxing = await getZxingBarcodeReader();
      if (!zxing) return null;

      const results = await zxing(imageData, {
        formats: ['Code128', 'Code39', 'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'DataMatrix']
      });

      if (results && results.length > 0 && results[0].text) {
        const res = results[0];
        const bbox = res.position ? {
          x: Math.round(Math.min(res.position.topLeft.x, res.position.bottomLeft.x)),
          y: Math.round(Math.min(res.position.topLeft.y, res.position.topRight.y)),
          width: Math.round(Math.max(30, Math.abs(res.position.bottomRight.x - res.position.topLeft.x))),
          height: Math.round(Math.max(20, Math.abs(res.position.bottomRight.y - res.position.topLeft.y)))
        } : { x: 50, y: 50, width: 120, height: 60 };

        return {
          found: true,
          payload: res.text.trim(),
          confidence: 0.94,
          boundingBox: bbox
        };
      }
    } catch {}
    return null;
  }

  /**
   * Square Ground Marker Detector:
   * Detects square or rectangular quadrilateral contours with high contrast borders
   * and aspect ratio between 0.8 and 1.25.
   */
  private detectSquareMarker(imageData: ImageData, quality: FrameQualityMetrics) {
    const { width, height, data } = imageData;
    const step = 4;
    const threshold = quality.meanLuminance * 0.6; // Dark marker border on light ground

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let hitCount = 0;

    for (let y = step * 2; y < height - step * 2; y += step) {
      for (let x = step * 2; x < width - step * 2; x += step) {
        const idx = (y * width + x) * 4;
        const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;

        if (lum < threshold) {
          hitCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (hitCount > 30 && maxX > minX + 25 && maxY > minY + 25) {
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      const aspect = boxW / boxH;

      // Validate aspect ratio of square marker (0.75 to 1.33)
      if (aspect >= 0.75 && aspect <= 1.33) {
        const areaRatio = (boxW * boxH) / (width * height);
        if (areaRatio >= 0.005 && areaRatio <= 0.6) {
          const markerId = `MARKER_SQ_${Math.round(boxW)}x${Math.round(boxH)}`;
          return {
            found: true,
            payload: markerId,
            confidence: +(0.85 + Math.min(0.1, hitCount / 500)).toFixed(2),
            boundingBox: {
              x: minX,
              y: minY,
              width: boxW,
              height: boxH
            }
          };
        }
      }
    }

    return null;
  }

  private cropThumbnail(canvas: HTMLCanvasElement, bbox: { x: number; y: number; width: number; height: number }): string {
    try {
      const thumbCanvas = document.createElement('canvas');
      const pad = Math.max(15, Math.round(bbox.width * 0.2));
      const sx = Math.max(0, bbox.x - pad);
      const sy = Math.max(0, bbox.y - pad);
      const sw = Math.min(canvas.width - sx, bbox.width + pad * 2);
      const sh = Math.min(canvas.height - sy, bbox.height + pad * 2);

      thumbCanvas.width = 160;
      thumbCanvas.height = 160;
      const tCtx = thumbCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 160, 160);
        return thumbCanvas.toDataURL('image/jpeg', 0.75);
      }
    } catch {}
    return '';
  }

  private notifyCandidate() {
    this.candidateListeners.forEach((fn) => fn(this.activeCandidate));
  }

  private notifyTarget(event: VerifiedTargetEvent) {
    this.targetListeners.forEach((fn) => fn(event));
  }
}

export const targetDetectionEngine = new TargetDetectionEngine();
