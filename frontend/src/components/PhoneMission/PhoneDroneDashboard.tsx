import React, { useState, useEffect, useRef } from 'react';
import {
  phoneDroneMissionService,
  PhoneMissionState,
  PhoneMissionProgress,
  PhoneMissionConfig
} from '../../services/phoneDroneMissionService';
import {
  targetDetectionEngine,
  TargetDetectionMode,
  TargetCandidate,
  VerifiedTargetEvent,
  FrameQualityMetrics,
  CapturedAreaImage
} from '../../services/targetDetectionEngine';
import { geofenceService, GeofenceState } from '../../services/geofenceService';
import { ipCameraService, StreamHealthMetrics } from '../../services/ipCameraService';
import {
  phoneDeviceService,
  ScreenOrientationMode,
  AutoFlashlightState,
  DeviceHardwareCapabilities
} from '../../services/phoneDeviceService';
import {
  evidenceUploadService,
  DatabaseSyncStatus
} from '../../services/evidenceUploadService';
import { mavlinkService } from '../../services/mavlinkService';
import { visionService } from '../../services/visionService';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Battery,
  Camera,
  CheckCircle2,
  Compass,
  Cpu,
  Database,
  Eye,
  Flashlight,
  Maximize2,
  Navigation,
  Pause,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sliders,
  Target,
  Upload,
  Wifi,
  WifiOff,
  Zap
} from 'lucide-react';

export const PhoneDroneDashboard: React.FC = () => {
  // Mission State Machine
  const [progress, setProgress] = useState<PhoneMissionProgress>(() =>
    phoneDroneMissionService.getProgress()
  );
  const [config, setConfig] = useState<PhoneMissionConfig>(() =>
    phoneDroneMissionService.getConfig()
  );

  // Vision & Detection
  const [detectionMode, setDetectionMode] = useState<TargetDetectionMode>(() =>
    targetDetectionEngine.getMode()
  );
  const [activeCandidate, setActiveCandidate] = useState<TargetCandidate | null>(null);
  const [lastVerifiedTarget, setLastVerifiedTarget] = useState<VerifiedTargetEvent | null>(null);
  const [frameQuality, setFrameQuality] = useState<FrameQualityMetrics | null>(null);

  // Device Hardware & Orientation
  const [orientationMode, setOrientationMode] = useState<ScreenOrientationMode>('AUTO');
  const [actualOrientation, setActualOrientation] = useState<string>('portrait-primary');
  const [flashState, setFlashState] = useState<AutoFlashlightState>(() => ({
    enabled: false,
    isTorchCurrentlyOn: false,
    currentLuminance: 128,
    darkThreshold: 40,
    brightThreshold: 75,
    darkDwellTimeMs: 0,
    brightDwellTimeMs: 0,
    hysteresisActive: false,
    statusText: 'Flashlight Standby'
  }));
  const [capabilities, setCapabilities] = useState<DeviceHardwareCapabilities>({
    supportsOrientationLock: false,
    supportsTorch: false,
    supportsFocusMode: false,
    supportsExposureCompensation: false,
    supportedFocusModes: []
  });

  // Database Sync
  const [syncStatus, setSyncStatus] = useState<DatabaseSyncStatus>(() =>
    evidenceUploadService.getSyncStatus()
  );

  // Geofence & Arm Lockout State
  const [geofenceState, setGeofenceState] = useState<GeofenceState>(() => geofenceService.getState());

  // Captured Area Image Gallery & Scanner Queue
  const [capturedImages, setCapturedImages] = useState<CapturedAreaImage[]>(() =>
    targetDetectionEngine.getCapturedImages()
  );
  const [streamHealth, setStreamHealth] = useState<StreamHealthMetrics>(() =>
    ipCameraService.getStreamHealth()
  );
  const [isScanningSnapshots, setIsScanningSnapshots] = useState<boolean>(false);

  // Modals & Confirmation Dialogs
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionType: 'RTL' | 'ABORT' | 'REJECT_VERIFY';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    actionType: 'RTL',
    onConfirm: () => {}
  });

  // Camera video and canvas refs for real-time processing
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // 1. Subscribe to Mission Engine
  useEffect(() => {
    const unsub = phoneDroneMissionService.subscribeProgress((p) => {
      setProgress(p);
      if (p.activeTarget) {
        setLastVerifiedTarget(p.activeTarget);
      }
    });
    return () => { unsub(); };
  }, []);

  // 2. Subscribe to Target Engine
  useEffect(() => {
    const unsubCand = targetDetectionEngine.subscribeCandidate((cand) => {
      setActiveCandidate(cand);
    });
    const unsubTarget = targetDetectionEngine.subscribeVerifiedTarget((event) => {
      setLastVerifiedTarget(event);
    });
    return () => {
      unsubCand();
      unsubTarget();
    };
  }, []);

  // 3. Subscribe to Device Hardware
  useEffect(() => {
    const unsubCaps = phoneDeviceService.subscribeCapabilities((caps) => setCapabilities(caps));
    const unsubOrient = phoneDeviceService.subscribeOrientation((mode, actual) => {
      setOrientationMode(mode);
      setActualOrientation(actual);
    });
    const unsubFlash = phoneDeviceService.subscribeFlashlight((fs) => setFlashState(fs));
    return () => {
      unsubCaps();
      unsubOrient();
      unsubFlash();
    };
  }, []);

  // 4. Subscribe to Evidence Upload Status
  useEffect(() => {
    const unsubSync = evidenceUploadService.subscribeSyncStatus((s) => setSyncStatus(s));
    return () => { unsubSync(); };
  }, []);

  // 4b. Subscribe to Geofence, Captured Area Images & Stream Health
  useEffect(() => {
    const unsubGeofence = geofenceService.subscribe((s) => setGeofenceState(s));
    const unsubImages = targetDetectionEngine.subscribeCapturedImages((imgs) => setCapturedImages(imgs));
    const unsubHealth = ipCameraService.subscribeStreamHealth((sh) => setStreamHealth(sh));
    return () => {
      unsubGeofence();
      unsubImages();
      unsubHealth();
    };
  }, []);

  // 5. Initialize Camera & Continuous Frame Processing Loop
  useEffect(() => {
    let isMounted = true;

    const startCamera = async () => {
      if (!videoRef.current) return;
      try {
        const ok = await visionService.startCamera(videoRef.current);
        if (ok && isMounted) {
          const stream = visionService.getStream();
          const track = stream ? stream.getVideoTracks()[0] : null;
          phoneDeviceService.registerVideoTrack(track);
        }
      } catch (e) {
        console.warn('[PHONE_DASHBOARD] Camera start error:', e);
      }
    };

    startCamera();

    // Continuous Frame Processing Loop
    const processLoop = async () => {
      if (!isMounted) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= 2) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const tFrameStart = performance.now();
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frameLatency = Math.round(performance.now() - tFrameStart);
          ipCameraService.recordFrameRendered(frameLatency);

          const telem = mavlinkService.getTelemetry();
          const result = await targetDetectionEngine.processFrame(canvas, {
            lat: telem.latitude,
            lon: telem.longitude,
            altAgl: telem.altitude,
            altMsl: telem.gps.altitude || telem.altitude,
            heading: telem.heading,
            pitch: telem.pitch,
            roll: telem.roll,
            hdop: telem.gps.hdop
          });

          setFrameQuality(result.quality);
          phoneDeviceService.updateLuminanceForAutoTorch(result.quality.meanLuminance);

          // Real-time Ground Anomaly / Object Detection & Whole-Area Snapshot Capture during SEARCHING
          const currMission = phoneDroneMissionService.getProgress();
          if (currMission.state === 'SEARCHING' && result.quality.blurScore >= 60) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const contour = targetDetectionEngine.detectSalientGroundContour(imgData, result.quality);
            if (contour) {
              const snap = targetDetectionEngine.captureAreaSnapshot({
                canvas,
                telemetry: {
                  lat: telem.latitude,
                  lon: telem.longitude,
                  altAgl: telem.altitude,
                  heading: telem.heading,
                  pitch: telem.pitch,
                  roll: telem.roll,
                  hdop: telem.gps.hdop
                },
                bboxNormalized: contour,
                sharpness: result.quality.blurScore
              });
              if (snap) {
                targetDetectionEngine.scanCapturedImagesForQR();
              }
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(processLoop);
    };

    animFrameRef.current = requestAnimationFrame(processLoop);

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // State Display Color & Pulse Helpers
  const getStateColor = (state: PhoneMissionState) => {
    if (state.startsWith('FAIL_') || state === 'EMERGENCY_STOP') {
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    }
    switch (state) {
      case 'IDLE': return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'CONNECTING': return 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse';
      case 'PREFLIGHT_CHECK': return 'bg-blue-500/20 text-blue-300 border-blue-500/50';
      case 'SEARCHING': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 animate-pulse';
      case 'TARGET_DETECTED': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50';
      case 'EVIDENCE_SAVED': return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50';
      case 'REVISITING': return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 animate-pulse';
      case 'VERIFYING': return 'bg-purple-500/20 text-purple-300 border-purple-500/50 animate-pulse';
      case 'UPLOADING': return 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse';
      case 'SERVER_ACKNOWLEDGED': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50';
      case 'RTL': return 'bg-rose-500/20 text-rose-300 border-rose-500/50 animate-pulse';
      case 'LANDED': return 'bg-teal-500/20 text-teal-300 border-teal-500/50';
      case 'COMPLETE': return 'bg-emerald-600/30 text-emerald-200 border-emerald-400';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const isPortrait = actualOrientation.startsWith('portrait');

  return (
    <div className="w-full h-full min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* AREA 1: CONNECTION & FLIGHT-HEALTH STATUS BAR */}
      <header className="px-3 sm:px-6 py-2.5 bg-[#0b1220] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shadow-lg z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black shadow-inner">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-orbitron font-extrabold text-sm sm:text-base tracking-wide text-white">
                AERORECON
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                PHONE ONBOARD EDGE
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              PIXHAWK ARDUPILOT • OPTICAL RECON GCS
            </span>
          </div>
        </div>

        {/* Telemetry Health Indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          {/* Connection Status */}
          <div
            className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 font-bold ${
              progress.telemetryHealth.isConnected && progress.telemetryHealth.isHeartbeatAlive
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-400'
                : progress.state === 'CONNECTING'
                ? 'bg-amber-950/60 border-amber-500/50 text-amber-400 animate-pulse'
                : 'bg-red-950/60 border-red-500/50 text-red-400'
            }`}
          >
            {progress.telemetryHealth.isConnected && progress.telemetryHealth.isHeartbeatAlive ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            <span>
              {progress.telemetryHealth.isConnected && progress.telemetryHealth.isHeartbeatAlive
                ? 'CONNECTED'
                : progress.state === 'CONNECTING'
                ? 'CONNECTING...'
                : 'DISCONNECTED'}
            </span>
          </div>

          {/* GPS Fix */}
          <div className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-blue-400" />
            <span>GPS: {progress.telemetryHealth.gpsFix} ({progress.telemetryHealth.satellites} sats)</span>
          </div>

          {/* Battery */}
          <div className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
            <Battery className="w-3.5 h-3.5 text-amber-400" />
            <span>{progress.telemetryHealth.batteryPercent}%</span>
          </div>

          {/* Flight Mode */}
          <div className="px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>MODE: {progress.telemetryHealth.flightMode || 'DISARMED'}</span>
          </div>

          {/* Armed Status */}
          <div
            className={`px-2 py-1 rounded-md border font-bold ${
              progress.telemetryHealth.isArmed
                ? 'bg-red-950/60 border-red-500/50 text-red-400'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            {progress.telemetryHealth.isArmed ? 'ARMED' : 'DISARMED'}
          </div>

          {/* Geofence & Pre-Arm Lockout Status Badge */}
          {(() => {
            const liveTelem = mavlinkService.getTelemetry();
            const armCheck = geofenceService.canArmVehicle(liveTelem.latitude, liveTelem.longitude);
            return (
              <div
                className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 font-bold ${
                  !geofenceState.enabled
                    ? 'bg-slate-900 border-slate-700 text-slate-400'
                    : armCheck.canArm
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-400'
                    : 'bg-red-950/60 border-red-500/50 text-red-400 animate-pulse'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>
                  {!geofenceState.enabled
                    ? 'GEOFENCE: OFF'
                    : armCheck.canArm
                    ? 'GEOFENCE: LOCKED INSIDE'
                    : 'ARM BLOCKED: OUTSIDE FENCE'}
                </span>
              </div>
            );
          })()}
        </div>
      </header>

      {/* MISSION STATE & COMMAND CONFIRMATION BANNER */}
      <div className="px-3 sm:px-6 py-2 bg-[#0d1627] border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-mono text-[11px]">ACTIVE MISSION STATE:</span>
          <span
            className={`px-2.5 py-1 rounded font-orbitron font-extrabold tracking-wider border ${getStateColor(
              progress.state
            )}`}
          >
            {progress.state}
          </span>
          <span className="text-slate-300 text-[12px] hidden md:inline">
            — {progress.stateMessage}
          </span>
        </div>

        {/* Command Requested vs Confirmed Indicator */}
        {progress.commandPending && (
          <div className="flex items-center gap-2">
            {progress.commandPending.confirmed ? (
              <div className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 flex items-center gap-1.5 font-mono text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>COMMAND CONFIRMED BY AUTOPILOT ({progress.commandPending.command})</span>
              </div>
            ) : (
              <div className="px-2.5 py-1 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 flex items-center gap-1.5 font-mono text-[11px] animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span>COMMAND REQUESTED ({progress.commandPending.command}) — Awaiting FC...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MAIN DASHBOARD CONTENT GRID (Responsive for Landscape & Portrait) */}
      <main className="flex-1 p-2 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-y-auto">
        {/* AREA 2: LARGE LIVE CAMERA PREVIEW WITH HUD RETICLE (7 cols desktop) */}
        <div className="lg:col-span-7 flex flex-col gap-2.5">
          <div className="relative w-full aspect-video bg-black rounded-xl border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center">
            {/* Live Camera Video Feed */}
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              muted
              playsInline
            />

            {/* Hidden canvas for computer vision image extraction */}
            <canvas ref={canvasRef} className="hidden" />

            {/* HUD Tactical Reticle Overlay */}
            <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
              {/* Top HUD Badges */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-slate-700/80 text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE SENSOR
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-slate-700/80 text-[10px] font-mono text-cyan-300">
                    MODE: {detectionMode}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-slate-700/80 text-[10px] font-mono text-emerald-300 flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5 text-emerald-400" />
                    <span>{streamHealth.fps} FPS</span>
                    <span className="text-slate-500">•</span>
                    <span>{streamHealth.latencyMs}ms</span>
                    {streamHealth.isStalled && (
                      <span className="text-red-400 font-bold animate-pulse">STALLED</span>
                    )}
                  </span>
                </div>

                {/* Quality & Illumination Badge */}
                {frameQuality && (
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span
                      className={`px-2 py-0.5 rounded backdrop-blur-md border ${
                        frameQuality.isBlurry
                          ? 'bg-red-950/80 border-red-500/50 text-red-300'
                          : 'bg-black/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      SHARPNESS: {frameQuality.blurScore.toFixed(0)} {frameQuality.isBlurry ? '(BLURRY)' : '(CLEAN)'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded backdrop-blur-md border ${
                        flashState.isTorchCurrentlyOn
                          ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                          : 'bg-black/60 border-slate-700 text-slate-300'
                      }`}
                    >
                      LUM: {frameQuality.meanLuminance.toFixed(0)} {flashState.isTorchCurrentlyOn ? '⚡ TORCH ON' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Center Crosshair Target Area */}
              <div className="self-center flex items-center justify-center">
                <div className="w-24 h-24 border border-emerald-500/40 rounded-lg relative flex items-center justify-center">
                  <div className="w-3 h-3 border border-emerald-400/80 rounded-full" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 w-0.5 h-2 bg-emerald-400/60" />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2 w-0.5 h-2 bg-emerald-400/60" />
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 h-0.5 w-2 bg-emerald-400/60" />
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 h-0.5 w-2 bg-emerald-400/60" />
                </div>
              </div>

              {/* Candidate Box Overlay */}
              {activeCandidate && (
                <div className="absolute inset-0 pointer-events-none">
                  <div
                    className={`absolute border-2 rounded transition-all duration-75 flex flex-col items-center justify-start ${
                      activeCandidate.status === 'VERIFIED'
                        ? 'border-emerald-400 bg-emerald-500/10'
                        : activeCandidate.status === 'BLUR_REJECTED'
                        ? 'border-red-400 bg-red-500/10'
                        : 'border-yellow-400 bg-yellow-500/10 animate-pulse'
                    }`}
                    style={{
                      left: `${(activeCandidate.boundingBox.x / 640) * 100}%`,
                      top: `${(activeCandidate.boundingBox.y / 480) * 100}%`,
                      width: `${(activeCandidate.boundingBox.width / 640) * 100}%`,
                      height: `${(activeCandidate.boundingBox.height / 480) * 100}%`
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/80 text-white -translate-y-5">
                      {activeCandidate.status === 'VERIFIED'
                        ? `VERIFIED: "${activeCandidate.payload}"`
                        : activeCandidate.status === 'BLUR_REJECTED'
                        ? 'BLUR REJECTED'
                        : `CANDIDATE (${activeCandidate.consecutiveFrames}/3)`}
                    </span>
                  </div>
                </div>
              )}

              {/* Bottom HUD Bar */}
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-300 bg-black/60 backdrop-blur-md px-3 py-1 rounded border border-slate-700/80">
                <span>ALT: {progress.telemetryHealth.altitudeAgl.toFixed(1)}m AGL</span>
                <span>HDG: {progress.telemetryHealth.flightMode}</span>
                <span>WP: {progress.activeWaypointIndex + 1} / {progress.totalWaypoints || 0}</span>
              </div>
            </div>
          </div>

          {/* AREA: CAPTURED AREA SURVEY SNAPSHOTS GALLERY (WHOLE-AREA SURVEY) */}
          <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                <span className="font-orbitron font-extrabold text-xs tracking-wider text-slate-200">
                  CAPTURED AREA SNAPSHOTS ({capturedImages.length})
                </span>
                <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                  • 1.5m Spatial Deduplication • Multi-Scale QR Queue
                </span>
              </div>
              <button
                type="button"
                disabled={capturedImages.length === 0 || isScanningSnapshots}
                onClick={async () => {
                  setIsScanningSnapshots(true);
                  try {
                    await targetDetectionEngine.scanCapturedImagesForQR();
                  } finally {
                    setIsScanningSnapshots(false);
                  }
                }}
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[11px] font-mono font-bold flex items-center gap-1 transition shadow"
              >
                <RefreshCw className={`w-3 h-3 ${isScanningSnapshots ? 'animate-spin' : ''}`} />
                <span>{isScanningSnapshots ? 'SCANNING QUEUE...' : 'SCAN SNAPSHOTS NOW'}</span>
              </button>
            </div>

            {capturedImages.length === 0 ? (
              <div className="py-3 px-4 bg-slate-900/40 rounded-lg border border-dashed border-slate-800 text-center text-slate-500 text-xs font-mono">
                No ground anomaly snapshots captured yet. During bounded search, ground contours with sharpness σ² ≥ 60 are automatically geotagged and queued here.
              </div>
            ) : (
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin">
                {capturedImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative shrink-0 w-36 bg-slate-900 rounded-lg border border-slate-800 overflow-hidden text-[10px] font-mono shadow group hover:border-slate-700 transition"
                  >
                    <div className="relative aspect-video bg-black flex items-center justify-center">
                      <img
                        src={img.imageDataUrl}
                        alt="Area Survey Capture"
                        className="w-full h-full object-cover"
                      />
                      {/* Status Badge */}
                      <span
                        className={`absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] font-bold ${
                          img.scanStatus === 'QR_DETECTED'
                            ? 'bg-emerald-500 text-slate-950'
                            : img.scanStatus === 'PENDING_QR_SCAN'
                            ? 'bg-amber-500/90 text-slate-950 animate-pulse'
                            : 'bg-slate-800/90 text-slate-300'
                        }`}
                      >
                        {img.scanStatus === 'QR_DETECTED'
                          ? 'QR FOUND'
                          : img.scanStatus === 'PENDING_QR_SCAN'
                          ? 'SCANNING'
                          : 'CLEAR'}
                      </span>
                    </div>

                    <div className="p-1.5 space-y-0.5">
                      {img.qrPayload ? (
                        <div className="font-bold text-emerald-400 truncate">
                          "{img.qrPayload}"
                        </div>
                      ) : (
                        <div className="text-slate-300 truncate">
                          {img.estimatedGroundLat.toFixed(5)}, {img.estimatedGroundLon.toFixed(5)}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-slate-500 text-[9px]">
                        <span>ALT: {img.altitudeAgl.toFixed(1)}m</span>
                        <span>HDG: {img.headingDeg.toFixed(0)}°</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AREA 7: ORIENTATION, FLASHLIGHT, & CAMERA CONTROLS BAR */}
          <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Screen Orientation Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-mono text-[11px]">ORIENTATION:</span>
              <button
                type="button"
                onClick={() => phoneDeviceService.setOrientation('PORTRAIT')}
                className={`px-2 py-1 rounded font-mono ${
                  orientationMode === 'PORTRAIT'
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                PORTRAIT
              </button>
              <button
                type="button"
                onClick={() => phoneDeviceService.setOrientation('LANDSCAPE')}
                className={`px-2 py-1 rounded font-mono ${
                  orientationMode === 'LANDSCAPE'
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                LANDSCAPE
              </button>
              <button
                type="button"
                onClick={() => phoneDeviceService.setOrientation('AUTO')}
                className={`px-2 py-1 rounded font-mono ${
                  orientationMode === 'AUTO'
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                AUTO
              </button>
            </div>

            {/* Flashlight / Torch Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => phoneDeviceService.setTorch(!flashState.isTorchCurrentlyOn)}
                disabled={!capabilities.supportsTorch}
                className={`px-2.5 py-1 rounded font-mono flex items-center gap-1 ${
                  flashState.isTorchCurrentlyOn
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40'
                }`}
              >
                <Flashlight className="w-3.5 h-3.5" />
                <span>{flashState.isTorchCurrentlyOn ? 'TORCH ON' : 'TORCH OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => phoneDeviceService.setAutoFlashlightEnabled(!flashState.enabled)}
                disabled={!capabilities.supportsTorch}
                className={`px-2.5 py-1 rounded font-mono ${
                  flashState.enabled
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40'
                }`}
              >
                AUTO FLASH
              </button>
            </div>

            {/* Detection Mode Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-mono text-[11px]">DETECT:</span>
              <button
                type="button"
                onClick={() => {
                  setDetectionMode('QR_CODE');
                  targetDetectionEngine.setMode('QR_CODE');
                }}
                className={`px-2 py-1 rounded font-mono ${
                  detectionMode === 'QR_CODE'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                QR CODE
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetectionMode('BARCODE');
                  targetDetectionEngine.setMode('BARCODE');
                }}
                className={`px-2 py-1 rounded font-mono ${
                  detectionMode === 'BARCODE'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                BARCODE
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetectionMode('SQUARE_MARKER');
                  targetDetectionEngine.setMode('SQUARE_MARKER');
                }}
                className={`px-2 py-1 rounded font-mono ${
                  detectionMode === 'SQUARE_MARKER'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                SQUARE MARKER
              </button>
            </div>
          </div>

          {/* PRIMARY FLIGHT & MISSION CONTROLS BAR */}
          <div className="p-3 bg-[#0c1424] rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Connect / Disconnect */}
              <button
                type="button"
                onClick={() => {
                  if (progress.telemetryHealth.isConnected) {
                    phoneDroneMissionService.disconnectDrone();
                  } else {
                    phoneDroneMissionService.connectDrone();
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition flex items-center gap-1.5 ${
                  progress.telemetryHealth.isConnected
                    ? 'bg-red-950/80 border border-red-500/50 text-red-300 hover:bg-red-900'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{progress.telemetryHealth.isConnected ? 'DISCONNECT' : 'CONNECT DRONE'}</span>
              </button>

              {/* Preflight Check */}
              <button
                type="button"
                onClick={() => phoneDroneMissionService.performPreflightCheck()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold font-mono flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                <span>PREFLIGHT CHECK</span>
              </button>

              {/* Plan Search */}
              <button
                type="button"
                onClick={() => phoneDroneMissionService.planSearch()}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono flex items-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>PLAN SEARCH</span>
              </button>

              {/* Start Mission */}
              <button
                type="button"
                onClick={() => phoneDroneMissionService.startMission()}
                disabled={progress.state === 'SEARCHING'}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-extrabold font-orbitron flex items-center gap-1.5 shadow-lg shadow-emerald-950/50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>START MISSION</span>
              </button>

              {/* Pause / Resume */}
              <button
                type="button"
                onClick={() => {
                  if (progress.state === 'SEARCHING') {
                    phoneDroneMissionService.pauseMission();
                  } else {
                    phoneDroneMissionService.resumeMission();
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold font-mono flex items-center gap-1.5"
              >
                <Pause className="w-3.5 h-3.5 text-yellow-400" />
                <span>PAUSE / RESUME</span>
              </button>
            </div>

            {/* Critical Destructive Actions (With Confirmation Dialogs) */}
            <div className="flex items-center gap-2">
              {/* Return to Launch */}
              <button
                type="button"
                onClick={() => {
                  setConfirmDialog({
                    isOpen: true,
                    title: 'CONFIRM RETURN TO LAUNCH',
                    description: 'Are you sure you want to command the drone to Return to Launch immediately?',
                    actionType: 'RTL',
                    onConfirm: () => phoneDroneMissionService.requestRTL('Manual operator command')
                  });
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-rose-300 text-xs font-bold font-mono flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>RETURN TO LAUNCH</span>
              </button>

              {/* Emergency Abort */}
              <button
                type="button"
                onClick={() => {
                  setConfirmDialog({
                    isOpen: true,
                    title: 'CRITICAL EMERGENCY ABORT',
                    description: 'This will immediately halt all autonomous flight commands and force the drone into safe LOITER hold.',
                    actionType: 'ABORT',
                    onConfirm: () => phoneDroneMissionService.emergencyAbort()
                  });
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-extrabold font-mono flex items-center gap-1.5 shadow-lg shadow-red-950/50"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>ABORT</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols desktop): MISSION, TELEMETRY, EVIDENCE & SYNC */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* AREA 3: SEARCH PATTERN SELECTION & CONFIGURATION */}
          <div className="p-3.5 bg-[#0c1424] rounded-xl border border-slate-800">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-orbitron font-extrabold text-xs tracking-wider text-slate-200">
                SEARCH PATTERN CONFIGURATION
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...config, searchPattern: 'SPIRAL' as const };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                    config.searchPattern === 'SPIRAL'
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  SPIRAL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...config, searchPattern: 'TANGENTIAL' as const };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                    config.searchPattern === 'TANGENTIAL'
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  TANGENTIAL
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <label className="text-[10px] text-slate-400 block">MAX RADIUS (M)</label>
                <input
                  type="number"
                  value={config.radiusMeters}
                  onChange={(e) => {
                    const r = Math.max(10, Math.min(200, parseFloat(e.target.value) || 40));
                    const next = { ...config, radiusMeters: r };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block">LANE SPACING (M)</label>
                <input
                  type="number"
                  value={config.spacingMeters}
                  onChange={(e) => {
                    const s = Math.max(3, Math.min(30, parseFloat(e.target.value) || 8));
                    const next = { ...config, spacingMeters: s };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block">SEARCH ALTITUDE (M)</label>
                <input
                  type="number"
                  value={config.altitudeMeters}
                  onChange={(e) => {
                    const alt = Math.max(3, Math.min(100, parseFloat(e.target.value) || 10));
                    const next = { ...config, altitudeMeters: alt };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block">FLIGHT SPEED (M/S)</label>
                <input
                  type="number"
                  value={config.speedMs}
                  onChange={(e) => {
                    const spd = Math.max(1, Math.min(10, parseFloat(e.target.value) || 3));
                    const next = { ...config, speedMs: spd };
                    setConfig(next);
                    phoneDroneMissionService.setConfig(next);
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-100"
                />
              </div>
            </div>

            {/* Path Preview Stats */}
            {progress.plannedPath && (
              <div className="mt-2.5 p-2 bg-slate-900/60 rounded border border-slate-800/80 text-[11px] font-mono flex items-center justify-between text-slate-300">
                <span>Waypoints: {progress.plannedPath.waypoints.length}</span>
                <span>Distance: {progress.plannedPath.totalDistanceMeters}m</span>
                <span>Est. Time: {progress.plannedPath.estimatedTimeSeconds}s</span>
              </div>
            )}
          </div>

          {/* AREA 5: QR / MARKER DETECTION RESULTS & EVIDENCE HISTORY */}
          <div className="p-3.5 bg-[#0c1424] rounded-xl border border-slate-800 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-orbitron font-extrabold text-xs tracking-wider text-slate-200">
                  VERIFIED TARGET EVIDENCE
                </span>
                {lastVerifiedTarget && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    VERIFIED ✓
                  </span>
                )}
              </div>

              {lastVerifiedTarget ? (
                <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex gap-3 text-xs font-mono">
                  {lastVerifiedTarget.thumbnailDataUrl && (
                    <img
                      src={lastVerifiedTarget.thumbnailDataUrl}
                      alt="Target Crop"
                      className="w-20 h-20 rounded border border-slate-700 object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-sm">
                        PAYLOAD: "{lastVerifiedTarget.payload}"
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {(lastVerifiedTarget.confidence * 100).toFixed(0)}% CONF
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-300">
                      <div>
                        EST. TARGET:{' '}
                        {lastVerifiedTarget.estimatedTargetLocation.targetLatitude.toFixed(6)},{' '}
                        {lastVerifiedTarget.estimatedTargetLocation.targetLongitude.toFixed(6)}
                      </div>
                      <div className="text-slate-400">
                        DRONE GPS:{' '}
                        {lastVerifiedTarget.dronePosition.lat.toFixed(6)},{' '}
                        {lastVerifiedTarget.dronePosition.lon.toFixed(6)} (±
                        {lastVerifiedTarget.estimatedTargetLocation.uncertaintyMeters}m)
                      </div>
                    </div>

                    {/* Revisit & Operator Confirmation Controls */}
                    <div className="pt-1 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => phoneDroneMissionService.handleRevisitVerificationComplete(true)}
                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold"
                      >
                        CONFIRM VALID
                      </button>
                      <button
                        type="button"
                        onClick={() => phoneDroneMissionService.handleRevisitVerificationComplete(false)}
                        className="px-2 py-0.5 rounded bg-red-950 hover:bg-red-900 border border-red-500/50 text-red-300 text-[10px]"
                      >
                        REJECT / FALSE ALARM
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-900/40 rounded-lg border border-dashed border-slate-800 text-center text-slate-400 text-xs font-mono">
                  No verified target detected yet. Active search scanner scanning for {detectionMode}...
                </div>
              )}
            </div>

            {/* AREA 6: DATABASE SYNCHRONIZATION STATUS */}
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-400" />
                <span>
                  SYNC:{' '}
                  {syncStatus.pendingCount > 0 ? (
                    <span className="text-amber-400 font-bold">
                      {syncStatus.pendingCount} QUEUED OFFLINE
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-bold">ALL SYNCED</span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => evidenceUploadService.flushQueue()}
                  disabled={syncStatus.pendingCount === 0}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-[11px] font-bold flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" />
                  <span>RETRY UPLOAD</span>
                </button>
              </div>
            </div>
          </div>

          {/* AREA 8: MISSION TIMELINE & EVENT LOG */}
          <div className="p-3.5 bg-[#0c1424] rounded-xl border border-slate-800 max-h-48 flex flex-col">
            <span className="font-orbitron font-extrabold text-xs tracking-wider text-slate-200 mb-2">
              MISSION TIMELINE & EVENT LOG
            </span>
            <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[11px]">
              {progress.eventLog.length === 0 ? (
                <span className="text-slate-500">Awaiting events...</span>
              ) : (
                progress.eventLog.map((ev, i) => (
                  <div
                    key={i}
                    className={`px-2 py-1 rounded flex items-start gap-1.5 ${
                      ev.severity === 'error'
                        ? 'bg-red-950/40 border border-red-500/40 text-red-300'
                        : ev.severity === 'warn'
                        ? 'bg-amber-950/40 border border-amber-500/40 text-amber-300'
                        : 'bg-slate-900 border border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="font-bold text-[10px] text-cyan-400 shrink-0">
                      [{ev.state}]
                    </span>
                    <span className="truncate">{ev.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* CONFIRMATION MODAL FOR CRITICAL ACTIONS (RTL / ABORT) */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0d1626] border border-red-500/60 rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-orbitron font-extrabold text-base text-white">
                {confirmDialog.title}
              </h3>
            </div>
            <p className="text-slate-300 text-sm">{confirmDialog.description}</p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono font-bold"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  confirmDialog.onConfirm();
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-orbitron font-extrabold shadow-lg shadow-red-950/50"
              >
                CONFIRM ACTION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
