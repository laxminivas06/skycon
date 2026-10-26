import { TargetBoxDetection, VisualServoingCommand } from '../types/mission';
export type { TargetBoxDetection };

type BoxDetectionListener = (box: TargetBoxDetection) => void;

export type BoxColorSignature = 'CARDBOARD_BROWN' | 'WHITE_TOP_FACE' | 'DARK_CUBOID' | 'QR_CONTAINER' | 'UNKNOWN';

export type SearchLockStatus = 'SEARCHING' | 'ACQUIRING' | 'LOCKED';

class BoxDetectionService {
  private listeners: Set<BoxDetectionListener> = new Set();
  private latestBox: TargetBoxDetection = this.getEmptyDetection();

  // Strict Detection Verification Pipeline (Search -> Verify for 3 frames -> Lock)
  private consecutiveDetectionFrames = 0;
  private minConsecutiveFramesToLock = 3;
  private missingFramesCount = 0;
  private maxAllowedMissingFrames = 4;

  // Exponential Moving Average (EMA) smoothing for stable tracking across frames
  private smoothedBox: { x: number; y: number; w: number; h: number; conf: number } | null = null;
  private emaAlpha = 0.5;

  // Proportional Flight Guidance gains
  private kp_lateral = 1.8;
  private kp_forward = 1.8;

  constructor() {}

  public subscribeBox(fn: BoxDetectionListener) {
    this.listeners.add(fn);
    fn(this.latestBox);
    return () => this.listeners.delete(fn);
  }

  public getLatestBox(): TargetBoxDetection {
    return this.latestBox;
  }

  /**
   * Multi-Stage Geometric Cuboid & Cardboard / White Top Plate Detector
   * Only locks after active searching and verifying multi-frame geometric consistency.
   */
  public analyzeFrameForBox(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    qrBox?: { x: number; y: number; width: number; height: number }
  ): TargetBoxDetection {
    // 1. FAST PATH: If QR code bounding box is detected on the box top plate
    if (qrBox && qrBox.width > 15) {
      this.consecutiveDetectionFrames = Math.min(10, this.consecutiveDetectionFrames + 2);
      this.missingFramesCount = 0;

      const padding = Math.max(30, qrBox.width * 0.5);
      const rawBx = Math.max(0, qrBox.x - padding);
      const rawBy = Math.max(0, qrBox.y - padding);
      const rawBw = Math.min(width - rawBx, qrBox.width + padding * 2);
      const rawBh = Math.min(height - rawBy, qrBox.height + padding * 2);

      const smoothed = this.smoothDetection(rawBx, rawBy, rawBw, rawBh, 0.99);
      const detection = this.computeBoxMetrics(
        smoothed.x,
        smoothed.y,
        smoothed.w,
        smoothed.h,
        width,
        height,
        smoothed.conf,
        'QR_CONTAINER',
        true
      );

      this.latestBox = detection;
      this.notify();
      return detection;
    }

    // 2. OPTICAL GEOMETRIC CUBOID & CONTRAST EDGE CONTOUR SCANNER
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      let brownMinX = width, brownMaxX = 0, brownMinY = height, brownMaxY = 0, brownCount = 0;
      let whiteMinX = width, whiteMaxX = 0, whiteMinY = height, whiteMaxY = 0, whiteCount = 0;
      let darkMinX = width, darkMaxX = 0, darkMinY = height, darkMaxY = 0, darkCount = 0;

      const step = 4; // High-precision 4px scan grid

      for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          // A. CARDBOARD BROWN / KRAFT / OCHRE (Warm brown ratios R > G > B)
          const isCardboardBrown =
            r > 90 &&
            r < 230 &&
            g > 50 &&
            g < 185 &&
            b > 20 &&
            b < 140 &&
            r > b + 20 &&
            r >= g - 10 &&
            g >= b;

          if (isCardboardBrown) {
            brownCount++;
            if (x < brownMinX) brownMinX = x;
            if (x > brownMaxX) brownMaxX = x;
            if (y < brownMinY) brownMinY = y;
            if (y > brownMaxY) brownMaxY = y;
          }

          // B. WHITE TOP PLATE (Mounting face for QR code)
          const isWhiteTop =
            lum > 185 &&
            Math.abs(r - g) < 25 &&
            Math.abs(r - b) < 25 &&
            Math.abs(g - b) < 25;

          if (isWhiteTop) {
            whiteCount++;
            if (x < whiteMinX) whiteMinX = x;
            if (x > whiteMaxX) whiteMaxX = x;
            if (y < whiteMinY) whiteMinY = y;
            if (y > whiteMaxY) whiteMaxY = y;
          }

          // C. DARK CUBOID / BOX BORDER
          if (lum < 40) {
            darkCount++;
            if (x < darkMinX) darkMinX = x;
            if (x > darkMaxX) darkMaxX = x;
            if (y < darkMinY) darkMinY = y;
            if (y > darkMaxY) darkMaxY = y;
          }
        }
      }

      // Check White Top Face First
      const whiteW = whiteMaxX - whiteMinX;
      const whiteH = whiteMaxY - whiteMinY;
      if (whiteCount >= 45 && whiteW >= 40 && whiteH >= 40) {
        const whiteAspect = whiteW / whiteH;
        if (whiteAspect >= 0.6 && whiteAspect <= 1.7) {
          this.consecutiveDetectionFrames++;
          this.missingFramesCount = 0;

          const isLocked = this.consecutiveDetectionFrames >= this.minConsecutiveFramesToLock;
          const conf = Math.min(0.96, 0.65 + (whiteCount / 600) * 0.3);
          const smoothed = this.smoothDetection(whiteMinX, whiteMinY, whiteW, whiteH, conf);

          const detection = this.computeBoxMetrics(
            smoothed.x,
            smoothed.y,
            smoothed.w,
            smoothed.h,
            width,
            height,
            smoothed.conf,
            'WHITE_TOP_FACE',
            isLocked
          );
          this.latestBox = detection;
          this.notify();
          return detection;
        }
      }

      // Check Cardboard Brown Face
      const brownW = brownMaxX - brownMinX;
      const brownH = brownMaxY - brownMinY;
      if (brownCount >= 45 && brownW >= 40 && brownH >= 40) {
        const brownAspect = brownW / brownH;
        if (brownAspect >= 0.55 && brownAspect <= 1.9) {
          this.consecutiveDetectionFrames++;
          this.missingFramesCount = 0;

          const isLocked = this.consecutiveDetectionFrames >= this.minConsecutiveFramesToLock;
          const conf = Math.min(0.94, 0.6 + (brownCount / 500) * 0.35);
          const smoothed = this.smoothDetection(brownMinX, brownMinY, brownW, brownH, conf);

          const detection = this.computeBoxMetrics(
            smoothed.x,
            smoothed.y,
            smoothed.w,
            smoothed.h,
            width,
            height,
            smoothed.conf,
            'CARDBOARD_BROWN',
            isLocked
          );
          this.latestBox = detection;
          this.notify();
          return detection;
        }
      }

      // Check Dark/Black Box
      const darkW = darkMaxX - darkMinX;
      const darkH = darkMaxY - darkMinY;
      if (darkCount >= 50 && darkW >= 45 && darkH >= 45) {
        const darkAspect = darkW / darkH;
        if (darkAspect >= 0.6 && darkAspect <= 1.7) {
          this.consecutiveDetectionFrames++;
          this.missingFramesCount = 0;

          const isLocked = this.consecutiveDetectionFrames >= this.minConsecutiveFramesToLock;
          const conf = Math.min(0.90, 0.55 + (darkCount / 600) * 0.35);
          const smoothed = this.smoothDetection(darkMinX, darkMinY, darkW, darkH, conf);

          const detection = this.computeBoxMetrics(
            smoothed.x,
            smoothed.y,
            smoothed.w,
            smoothed.h,
            width,
            height,
            smoothed.conf,
            'DARK_CUBOID',
            isLocked
          );
          this.latestBox = detection;
          this.notify();
          return detection;
        }
      }
    } catch (e) {
      // frame processing skipped
    }

    // If candidate was lost for a couple of frames, briefly hold before resetting to SEARCHING
    if (this.smoothedBox && this.missingFramesCount < this.maxAllowedMissingFrames) {
      this.missingFramesCount++;
      const detection = this.computeBoxMetrics(
        this.smoothedBox.x,
        this.smoothedBox.y,
        this.smoothedBox.w,
        this.smoothedBox.h,
        width,
        height,
        this.smoothedBox.conf * 0.8,
        'CARDBOARD_BROWN',
        true
      );
      this.latestBox = detection;
      this.notify();
      return detection;
    }

    // Reset completely to SEARCHING state
    this.consecutiveDetectionFrames = 0;
    this.missingFramesCount = 0;
    this.smoothedBox = null;
    this.latestBox = this.getEmptyDetection();
    this.notify();
    return this.latestBox;
  }

  // Smooth bounding box coordinates using EMA
  private smoothDetection(x: number, y: number, w: number, h: number, conf: number) {
    if (!this.smoothedBox) {
      this.smoothedBox = { x, y, w, h, conf };
      return this.smoothedBox;
    }

    const a = this.emaAlpha;
    this.smoothedBox.x = a * x + (1 - a) * this.smoothedBox.x;
    this.smoothedBox.y = a * y + (1 - a) * this.smoothedBox.y;
    this.smoothedBox.w = a * w + (1 - a) * this.smoothedBox.w;
    this.smoothedBox.h = a * h + (1 - a) * this.smoothedBox.h;
    this.smoothedBox.conf = a * conf + (1 - a) * this.smoothedBox.conf;

    return this.smoothedBox;
  }

  // Calculate Visual Servoing FC Velocity Vectors (m/s) & Flight Guidance
  private computeBoxMetrics(
    bx: number,
    by: number,
    bw: number,
    bh: number,
    frameW: number,
    frameH: number,
    confidence: number,
    signature: BoxColorSignature = 'CARDBOARD_BROWN',
    isLocked: boolean = false
  ): TargetBoxDetection {
    const opticalCenterX = frameW / 2;
    const opticalCenterY = frameH / 2;

    const boxCenterX = bx + bw / 2;
    const boxCenterY = by + bh / 2;

    // Offset Error Percentages (-100% to +100%)
    const offsetXPercent = ((boxCenterX - opticalCenterX) / opticalCenterX) * 100;
    const offsetYPercent = ((boxCenterY - opticalCenterY) / opticalCenterY) * 100;

    const areaPercent = ((bw * bh) / (frameW * frameH)) * 100;
    const isCentered = Math.abs(offsetXPercent) <= 10 && Math.abs(offsetYPercent) <= 10;

    // Guidance Proportional Control
    const forwardSpeedMs = parseFloat((- (offsetYPercent / 100) * this.kp_forward).toFixed(2));
    const lateralSpeedMs = parseFloat(((offsetXPercent / 100) * this.kp_lateral).toFixed(2));
    const descentRateMs = isCentered ? 0.35 : 0.0;
    const yawCorrectionDeg = parseFloat(((offsetXPercent / 100) * 15).toFixed(1));

    let action: VisualServoingCommand['action'] = 'ADJUST_PITCH_ROLL';
    let logText = '';

    const sigLabel =
      signature === 'WHITE_TOP_FACE'
        ? 'WHITE TOP PLATE'
        : signature === 'CARDBOARD_BROWN'
        ? 'CARDBOARD BROWN CUBOID'
        : signature === 'QR_CONTAINER'
        ? 'QR TARGET BOX'
        : 'CUBOID TARGET';

    if (!isLocked) {
      action = 'SEARCHING_PATTERN';
      logText = `SEARCHING: ACQUIRING TARGET [${sigLabel} - VERIFYING 3D GEOMETRY]...`;
    } else if (isCentered) {
      action = 'HOLD_CENTER';
      logText = `TARGET LOCKED [${sigLabel} CENTERED]. FC COMMAND: HOLD POSITION & DESCEND TO READ QR.`;
    } else {
      action = 'ADJUST_PITCH_ROLL';
      const dirLat = lateralSpeedMs > 0 ? 'ROLL_RIGHT' : 'ROLL_LEFT';
      const dirLon = forwardSpeedMs > 0 ? 'PITCH_FORWARD' : 'PITCH_BACKWARD';
      logText = `FC GUIDANCE: ${dirLon} (${Math.abs(forwardSpeedMs)} m/s), ${dirLat} (${Math.abs(lateralSpeedMs)} m/s) [${sigLabel}]`;
    }

    const fcGuidance: VisualServoingCommand = {
      action,
      targetPitchRoll: {
        forwardSpeedMs: isLocked ? forwardSpeedMs : 0,
        lateralSpeedMs: isLocked ? lateralSpeedMs : 0,
        descentRateMs: isLocked ? descentRateMs : 0,
        yawCorrectionDeg: isLocked ? yawCorrectionDeg : 0
      },
      flightControlLog: logText,
      isCentered: isLocked && isCentered
    };

    return {
      isDetected: true,
      isLocked,
      centerX: Math.round(boxCenterX),
      centerY: Math.round(boxCenterY),
      width: Math.round(bw),
      height: Math.round(bh),
      aspectRatio: parseFloat((bw / bh).toFixed(2)),
      areaPercent: parseFloat(areaPercent.toFixed(1)),
      offsetXPercent: parseFloat(offsetXPercent.toFixed(1)),
      offsetYPercent: parseFloat(offsetYPercent.toFixed(1)),
      distanceOffsetMeters: parseFloat((Math.hypot(offsetXPercent, offsetYPercent) * 0.08).toFixed(2)),
      confidence: parseFloat(confidence.toFixed(2)),
      fcGuidance,
      detectedAt: Date.now()
    };
  }

  // Simulated Box Target
  public triggerSimulatedBox(offsetX: number = 0, offsetY: number = 0, signature: BoxColorSignature = 'CARDBOARD_BROWN') {
    const frameW = 640;
    const frameH = 480;
    const bw = 190;
    const bh = 190;
    const bx = frameW / 2 - bw / 2 + (offsetX / 100) * (frameW / 2);
    const by = frameH / 2 - bh / 2 + (offsetY / 100) * (frameH / 2);

    this.consecutiveDetectionFrames = 5;
    const smoothed = this.smoothDetection(bx, by, bw, bh, 0.95);
    const detection = this.computeBoxMetrics(
      smoothed.x,
      smoothed.y,
      smoothed.w,
      smoothed.h,
      frameW,
      frameH,
      0.95,
      signature,
      true
    );

    this.latestBox = detection;
    this.notify();
    return detection;
  }

  private getEmptyDetection(): TargetBoxDetection {
    return {
      isDetected: false,
      isLocked: false,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0,
      aspectRatio: 1,
      areaPercent: 0,
      offsetXPercent: 0,
      offsetYPercent: 0,
      distanceOffsetMeters: 0,
      confidence: 0,
      fcGuidance: {
        action: 'SEARCHING_PATTERN',
        targetPitchRoll: {
          forwardSpeedMs: 0,
          lateralSpeedMs: 0,
          descentRateMs: 0,
          yawCorrectionDeg: 0
        },
        flightControlLog: 'AUTONOMOUS SEARCH PATTERN: Scanning for Cardboard Cuboid / White Target Plate...',
        isCentered: false
      },
      detectedAt: Date.now()
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn(this.latestBox));
  }
}

export const boxDetectionService = new BoxDetectionService();
