/**
 * SAE INDIA — Phone Device Service
 * Controls Android phone hardware features when mounted on drone:
 * - Screen orientation controls (Landscape, Portrait, Auto Rotate)
 * - Flashlight / Torch control with brightness hysteresis
 * - Camera focus & exposure compensation controls
 * - Device capability probing and browser restriction handling
 */

export type ScreenOrientationMode = 'LANDSCAPE' | 'PORTRAIT' | 'AUTO';

export interface DeviceHardwareCapabilities {
  supportsOrientationLock: boolean;
  supportsTorch: boolean;
  supportsFocusMode: boolean;
  supportsExposureCompensation: boolean;
  minExposure?: number;
  maxExposure?: number;
  stepExposure?: number;
  supportedFocusModes: string[];
}

export interface AutoFlashlightState {
  enabled: boolean;
  isTorchCurrentlyOn: boolean;
  currentLuminance: number;
  darkThreshold: number;     // e.g. 40
  brightThreshold: number;   // e.g. 75
  darkDwellTimeMs: number;   // time luminance has been below dark threshold
  brightDwellTimeMs: number; // time luminance has been above bright threshold
  hysteresisActive: boolean;
  statusText: string;
}

type CapabilityListener = (caps: DeviceHardwareCapabilities) => void;
type OrientationListener = (mode: ScreenOrientationMode, actualOrientation: string) => void;
type FlashlightListener = (state: AutoFlashlightState) => void;

export class PhoneDeviceService {
  private currentOrientationMode: ScreenOrientationMode = 'AUTO';
  private actualOrientation: string = 'portrait-primary';
  private capabilities: DeviceHardwareCapabilities = {
    supportsOrientationLock: false,
    supportsTorch: false,
    supportsFocusMode: false,
    supportsExposureCompensation: false,
    supportedFocusModes: []
  };

  private activeVideoTrack: MediaStreamTrack | null = null;
  private autoFlashlight: AutoFlashlightState = {
    enabled: false,
    isTorchCurrentlyOn: false,
    currentLuminance: 128,
    darkThreshold: 40,
    brightThreshold: 75,
    darkDwellTimeMs: 0,
    brightDwellTimeMs: 0,
    hysteresisActive: false,
    statusText: 'Flashlight Standby'
  };

  private lastLuminanceSampleTime: number = Date.now();
  private capListeners: Set<CapabilityListener> = new Set();
  private orientationListeners: Set<OrientationListener> = new Set();
  private flashListeners: Set<FlashlightListener> = new Set();

  constructor() {
    this.initOrientationDetection();
  }

  private initOrientationDetection() {
    if (typeof window === 'undefined') return;

    if (typeof window !== 'undefined' && screen && screen.orientation) {
      this.capabilities.supportsOrientationLock = typeof (screen.orientation as any).lock === 'function';
      this.actualOrientation = screen.orientation.type || 'portrait-primary';

      screen.orientation.addEventListener('change', () => {
        this.actualOrientation = screen.orientation.type;
        this.notifyOrientation();
      });
    } else {
      window.addEventListener('resize', () => {
        const isLandscape = window.innerWidth > window.innerHeight;
        this.actualOrientation = isLandscape ? 'landscape-primary' : 'portrait-primary';
        this.notifyOrientation();
      });
    }
  }

  public subscribeCapabilities(fn: CapabilityListener) {
    this.capListeners.add(fn);
    fn(this.capabilities);
    return () => this.capListeners.delete(fn);
  }

  public subscribeOrientation(fn: OrientationListener) {
    this.orientationListeners.add(fn);
    fn(this.currentOrientationMode, this.actualOrientation);
    return () => this.orientationListeners.delete(fn);
  }

  public subscribeFlashlight(fn: FlashlightListener) {
    this.flashListeners.add(fn);
    fn(this.autoFlashlight);
    return () => this.flashListeners.delete(fn);
  }

  /**
   * Probes active camera MediaStreamTrack for hardware capabilities
   */
  public registerVideoTrack(track: MediaStreamTrack | null) {
    this.activeVideoTrack = track;
    if (!track) {
      this.capabilities.supportsTorch = false;
      this.capabilities.supportsFocusMode = false;
      this.capabilities.supportsExposureCompensation = false;
      this.notifyCaps();
      return;
    }

    try {
      const getCapabilities = (track as any).getCapabilities;
      if (typeof getCapabilities === 'function') {
        const caps = getCapabilities.call(track);
        this.capabilities.supportsTorch = Boolean(caps.torch);
        this.capabilities.supportsFocusMode = Array.isArray(caps.focusMode) && caps.focusMode.length > 0;
        this.capabilities.supportedFocusModes = caps.focusMode || [];
        this.capabilities.supportsExposureCompensation =
          typeof caps.exposureCompensation !== 'undefined' ||
          (caps.exposureCompensation && typeof caps.exposureCompensation.min !== 'undefined');

        if (caps.exposureCompensation) {
          this.capabilities.minExposure = caps.exposureCompensation.min;
          this.capabilities.maxExposure = caps.exposureCompensation.max;
          this.capabilities.stepExposure = caps.exposureCompensation.step;
        }
      }
    } catch (e) {
      console.warn('[PHONE_DEVICE] Could not inspect track capabilities:', e);
    }

    this.notifyCaps();
  }

  /**
   * Sets screen orientation with graceful browser error handling
   */
  public async setOrientation(mode: ScreenOrientationMode): Promise<{ success: boolean; message: string }> {
    this.currentOrientationMode = mode;
    this.notifyOrientation();

    if (typeof window === 'undefined' || typeof screen === 'undefined' || !screen?.orientation) {
      return { success: true, message: `Orientation mode updated to ${mode.toLowerCase()} (headless/desktop environment)` };
    }

    try {
      const orient = screen.orientation as any;
      if (mode === 'AUTO') {
        if (typeof orient?.unlock === 'function') {
          orient.unlock();
        }
        return { success: true, message: 'Auto rotation unlocked' };
      }

      if (typeof orient?.lock === 'function') {
        const lockTarget = mode === 'LANDSCAPE' ? 'landscape' : 'portrait';
        await orient.lock(lockTarget);
        return { success: true, message: `Orientation locked to ${mode.toLowerCase()}` };
      }
    } catch (err: any) {
      const msg = err?.message || 'Orientation lock requires fullscreen or is restricted by device policy';
      console.warn('[PHONE_DEVICE] Orientation lock notice:', msg);
      return {
        success: false,
        message: 'Mobile browser requires fullscreen or user gesture to lock orientation. Responsive layout adapts automatically.'
      };
    }

    return { success: false, message: 'Orientation lock not supported' };
  }

  /**
   * Toggles flashlight / torch directly on the camera hardware
   */
  public async setTorch(on: boolean): Promise<{ success: boolean; message: string }> {
    if (!this.activeVideoTrack) {
      return { success: false, message: 'No active camera video track' };
    }

    if (!this.capabilities.supportsTorch) {
      return { success: false, message: 'Flashlight / Torch hardware is not supported on this camera' };
    }

    try {
      await (this.activeVideoTrack as any).applyConstraints({
        advanced: [{ torch: on }]
      });
      this.autoFlashlight.isTorchCurrentlyOn = on;
      this.autoFlashlight.statusText = on ? 'Flashlight ON' : 'Flashlight OFF';
      this.notifyFlash();
      return { success: true, message: `Flashlight ${on ? 'ON' : 'OFF'}` };
    } catch (err: any) {
      return { success: false, message: `Torch hardware error: ${err.message}` };
    }
  }

  public setAutoFlashlightEnabled(enabled: boolean) {
    this.autoFlashlight.enabled = enabled;
    this.autoFlashlight.darkDwellTimeMs = 0;
    this.autoFlashlight.brightDwellTimeMs = 0;
    this.autoFlashlight.statusText = enabled ? 'Auto Flashlight Active (Monitoring Lux)' : 'Auto Flashlight Disabled';

    // If disabled, turn torch off
    if (!enabled && this.autoFlashlight.isTorchCurrentlyOn) {
      this.setTorch(false);
    }
    this.notifyFlash();
  }

  /**
   * Feed real-time luminance into adaptive auto flashlight hysteresis engine.
   * - Enables torch if luminance < darkThreshold (40) continuously for > 1500ms
   * - Disables torch if luminance > brightThreshold (75) continuously for > 2000ms
   * - Hysteresis gap (40 to 75) completely prevents rapid on/off flickering!
   */
  public updateLuminanceForAutoTorch(meanLuminance: number) {
    const now = Date.now();
    const dt = Math.min(500, now - this.lastLuminanceSampleTime);
    this.lastLuminanceSampleTime = now;

    this.autoFlashlight.currentLuminance = meanLuminance;

    if (!this.autoFlashlight.enabled || !this.capabilities.supportsTorch) {
      return;
    }

    const { darkThreshold, brightThreshold, isTorchCurrentlyOn } = this.autoFlashlight;

    if (!isTorchCurrentlyOn) {
      if (meanLuminance < darkThreshold) {
        this.autoFlashlight.darkDwellTimeMs += dt;
        this.autoFlashlight.brightDwellTimeMs = 0;

        if (this.autoFlashlight.darkDwellTimeMs >= 1500) {
          // Low light detected consistently -> trigger torch
          this.autoFlashlight.hysteresisActive = true;
          this.setTorch(true);
          this.autoFlashlight.statusText = `Auto Flashlight ON (Low light: ${meanLuminance.toFixed(0)} < ${darkThreshold})`;
        } else {
          this.autoFlashlight.statusText = `Low light stabilizing (${((1500 - this.autoFlashlight.darkDwellTimeMs) / 1000).toFixed(1)}s)...`;
        }
      } else {
        this.autoFlashlight.darkDwellTimeMs = Math.max(0, this.autoFlashlight.darkDwellTimeMs - dt * 2);
        this.autoFlashlight.statusText = `Illumination Adequate (${meanLuminance.toFixed(0)} / 255)`;
      }
    } else {
      if (meanLuminance > brightThreshold) {
        this.autoFlashlight.brightDwellTimeMs += dt;
        this.autoFlashlight.darkDwellTimeMs = 0;

        if (this.autoFlashlight.brightDwellTimeMs >= 2000) {
          // Daylight / sufficient lighting restored -> turn off torch
          this.autoFlashlight.hysteresisActive = false;
          this.setTorch(false);
          this.autoFlashlight.statusText = `Auto Flashlight OFF (Sufficient light: ${meanLuminance.toFixed(0)} > ${brightThreshold})`;
        } else {
          this.autoFlashlight.statusText = `Sufficient light detected (${((2000 - this.autoFlashlight.brightDwellTimeMs) / 1000).toFixed(1)}s to turn off)...`;
        }
      } else {
        this.autoFlashlight.brightDwellTimeMs = Math.max(0, this.autoFlashlight.brightDwellTimeMs - dt * 2);
        this.autoFlashlight.statusText = `Torch Active (Scene Lum: ${meanLuminance.toFixed(0)})`;
      }
    }

    this.notifyFlash();
  }

  /**
   * Sets manual or auto exposure compensation where supported
   */
  public async setExposureCompensation(value: number): Promise<{ success: boolean; message: string }> {
    if (!this.activeVideoTrack || !this.capabilities.supportsExposureCompensation) {
      return { success: false, message: 'Exposure compensation not supported on this camera hardware' };
    }

    try {
      await (this.activeVideoTrack as any).applyConstraints({
        advanced: [{ exposureCompensation: value }]
      });
      return { success: true, message: `Exposure set to ${value}` };
    } catch (e: any) {
      return { success: false, message: `Exposure error: ${e.message}` };
    }
  }

  /**
   * Sets focus mode (continuous autofocus vs macro) where supported
   */
  public async setFocusMode(mode: 'continuous' | 'manual' | 'macro'): Promise<{ success: boolean; message: string }> {
    if (!this.activeVideoTrack || !this.capabilities.supportsFocusMode) {
      return { success: false, message: 'Hardware focus mode control not supported on this camera' };
    }

    try {
      await (this.activeVideoTrack as any).applyConstraints({
        advanced: [{ focusMode: mode }]
      });
      return { success: true, message: `Focus mode set to ${mode}` };
    } catch (e: any) {
      return { success: false, message: `Focus mode error: ${e.message}` };
    }
  }

  private notifyCaps() {
    this.capListeners.forEach((fn) => fn(this.capabilities));
  }

  private notifyOrientation() {
    this.orientationListeners.forEach((fn) => fn(this.currentOrientationMode, this.actualOrientation));
  }

  private notifyFlash() {
    this.flashListeners.forEach((fn) => fn(this.autoFlashlight));
  }
}

export const phoneDeviceService = new PhoneDeviceService();
