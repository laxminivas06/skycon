import React, { useState, useEffect, useRef } from 'react';
import { DroneTelemetry, DecodedQRData, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { mavlinkService } from '../../services/mavlinkService';
import { visionService } from '../../services/visionService';
import { reconDetectionService } from '../../services/reconDetectionService';
import {
  QRDetectionRecord,
  DroneCoreQRStatus
} from '../../types/recon';
import { droneCameraStreamService } from '../../services/droneCameraStreamService';
import {
  autonomousEdgeDroneCoreService,
  EdgeMissionProgress
} from '../../services/autonomousEdgeDroneCoreService';
import {
  Camera,
  Target,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  MapPin,
  VideoOff,
  Settings,
  Maximize,
  Minimize,
  X,
  Power,
  Play,
  Square,
  Radio,
  Compass,
  ShieldCheck,
  ZoomIn
} from 'lucide-react';

interface DroneDashboardProps {
  telemetry: DroneTelemetry;
  missionState: MissionState;
  remainingSeconds?: number;
  elapsedSeconds?: number;
  decodedQR: DecodedQRData | null;
  pixhawkState: PixhawkConnectionState;
  runnerLink?: RunnerLinkState;
  runnerAckReceived?: boolean;
  runnerAckLatencyMs?: number;
  onQRDetected?: (data: DecodedQRData) => void;
  onEmergencyRTL?: () => void;
  className?: string;
}

export const DroneDashboard: React.FC<DroneDashboardProps> = ({
  telemetry,
  missionState,
  decodedQR,
  pixhawkState,
  onQRDetected,
  onEmergencyRTL,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Fullscreen and Settings State
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn('[DRONE FULLSCREEN] Failed to toggle:', err);
    }
  };

  // AERORECON Drone Core Status (10 Exact Specified States)
  const [coreStatus, setCoreStatus] = useState<DroneCoreQRStatus>(reconDetectionService.getDroneCoreStatus());
  const [latestDetection, setLatestDetection] = useState<QRDetectionRecord | null>(reconDetectionService.getLatestDetection());

  // Autonomous Edge Drone Core State (Strictly Air-Gapped Onboard System)
  const [edgeProgress, setEdgeProgress] = useState<EdgeMissionProgress>(autonomousEdgeDroneCoreService.getProgress());

  // Camera Hardware State
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);

  // Active Detection Bounding Box for Live Reticle Overlay
  const [activeBoundingBox, setActiveBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);



  // 1. Camera Initialization (Continuous Scanning with Fixed Wide FOV)
  useEffect(() => {
    let isMounted = true;

    const startCamera = async (retries = 4) => {
      if (!videoRef.current) {
        if (retries > 0 && isMounted) {
          setTimeout(() => startCamera(retries - 1), 150);
        }
        return;
      }
      try {
        const success = await visionService.startCamera(videoRef.current);
        if (isMounted) {
          setIsCameraActive(success);
          if (success) {
            reconDetectionService.setDroneCoreStatus('SEARCHING FOR QR');
            setCameraErrorMessage(null);
            // Air-Gapped Drone Core: Zero video or telemetry broadcasting to GCS
          } else {
            reconDetectionService.setDroneCoreStatus('CAMERA ERROR');
            setCameraErrorMessage('Camera unavailable or permission denied. Check camera access.');
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setIsCameraActive(false);
          reconDetectionService.setDroneCoreStatus('CAMERA ERROR');
          setCameraErrorMessage(err?.message || 'Failed to start camera');
        }
      }
    };

    startCamera();

    const unsubCamera = visionService.subscribeCameraState((state) => {
      if (isMounted) {
        setIsCameraActive(state.isActive);
        if (state.error) {
          setCameraErrorMessage(state.error);
          reconDetectionService.setDroneCoreStatus('CAMERA ERROR');
        }
      }
    });

    return () => {
      isMounted = false;
      unsubCamera();
    };
  }, []);

  // 2. Subscribe to Edge Drone Core State Machine
  useEffect(() => {
    const unsubEdge = autonomousEdgeDroneCoreService.subscribeState((progress) => {
      setEdgeProgress(progress);
      if (progress.lockedTarget && progress.lockedTarget.boundingBox) {
        setActiveBoundingBox(progress.lockedTarget.boundingBox);
      }
    });
    return () => {
      unsubEdge();
    };
  }, []);

  // 3. Subscribe to Recon Detection Service & RTL updates
  useEffect(() => {
    const unsubStatus = reconDetectionService.subscribeDroneCoreStatus((status) => {
      setCoreStatus(status);
    });

    const unsubDetections = reconDetectionService.subscribeDetections((_list, latest) => {
      setLatestDetection(latest);
      if (latest && latest.boundingBox) {
        setActiveBoundingBox(latest.boundingBox);
        setTimeout(() => setActiveBoundingBox(null), 2500);
      }
    });

    // Watch Pixhawk telemetry for RTL flight mode confirmation (Step 7: Confirm RTL)
    const unsubTelemetry = mavlinkService.subscribeTelemetry((t) => {
      const mode = (t.flightMode || '').toUpperCase();
      if (mode === 'RTL') {
        reconDetectionService.setDroneCoreStatus('RETURNING TO LAUNCH');
      }
    });

    return () => {
      unsubStatus();
      unsubDetections();
      unsubTelemetry();
    };
  }, []);

  // 4. Forward QR detection events to parent if required
  useEffect(() => {
    if (decodedQR && onQRDetected) {
      onQRDetected(decodedQR);
    }
  }, [decodedQR, onQRDetected]);

  // Toggle Drone Core Camera Power
  const handleToggleCamera = async () => {
    if (isCameraActive) {
      if (edgeProgress.state !== 'STANDBY') {
        autonomousEdgeDroneCoreService.stopMission();
      }
      visionService.stopCamera();
      setIsCameraActive(false);
      reconDetectionService.setDroneCoreStatus('CAMERA READY');
    } else {
      setCameraErrorMessage(null);
      reconDetectionService.setDroneCoreStatus('SEARCHING FOR QR');
      if (videoRef.current) {
        const success = await visionService.startCamera(videoRef.current);
        setIsCameraActive(success);
        if (!success) {
          reconDetectionService.setDroneCoreStatus('CAMERA ERROR');
          setCameraErrorMessage('Camera unavailable or permission denied. Check camera access.');
        }
      }
    }
  };

  // Restart Camera Feed
  const handleRestartCamera = async () => {
    setCameraErrorMessage(null);
    reconDetectionService.setDroneCoreStatus('SEARCHING FOR QR');
    if (videoRef.current) {
      const success = await visionService.startCamera(videoRef.current);
      setIsCameraActive(success);
    }
  };

  // Start / Abort Autonomous Edge Scan
  const handleToggleEdgeMission = async () => {
    if (edgeProgress.state === 'STANDBY') {
      if (!isCameraActive && videoRef.current) {
        const started = await visionService.startCamera(videoRef.current);
        setIsCameraActive(started);
        if (started) {
          await autonomousEdgeDroneCoreService.startMission(videoRef.current);
        }
      } else {
        await autonomousEdgeDroneCoreService.startMission(videoRef.current);
      }
    } else {
      autonomousEdgeDroneCoreService.stopMission();
    }
  };

  // Helper for rendering the 10 exact specified status states
  const getStatusBadgeConfig = (status: DroneCoreQRStatus) => {
    switch (status) {
      case 'RETURNING TO LAUNCH':
        return {
          label: 'RETURNING TO LAUNCH',
          bg: 'bg-rose-950/95',
          border: 'border-rose-500',
          text: 'text-rose-100',
          pulse: true,
          icon: RotateCcw,
          hint: 'Pixhawk flight controller executing autonomous return to launch point'
        };
      case 'RTL INITIATED':
        return {
          label: 'RTL INITIATED',
          bg: 'bg-red-950/95',
          border: 'border-red-500',
          text: 'text-red-100',
          pulse: true,
          icon: RotateCcw,
          hint: 'QR data verified. Pixhawk RTL command dispatched cleanly via MAVLink'
        };
      case 'QR DATA RECEIVED':
        return {
          label: 'QR DATA RECEIVED',
          bg: 'bg-emerald-950/90',
          border: 'border-emerald-500',
          text: 'text-emerald-100',
          pulse: false,
          icon: CheckCircle2,
          hint: 'Payload verified. Triggering automatic Pixhawk Return-To-Launch...'
        };
      case 'PROCESSING QR':
        return {
          label: 'PROCESSING QR',
          bg: 'bg-amber-950/90',
          border: 'border-amber-500',
          text: 'text-amber-100',
          pulse: true,
          icon: RefreshCw,
          hint: 'Decoding original-resolution photo & extracting QR payload'
        };
      case 'CAPTURING PHOTO':
        return {
          label: 'CAPTURING PHOTO',
          bg: 'bg-sky-950/90',
          border: 'border-sky-500',
          text: 'text-sky-100',
          pulse: true,
          icon: Camera,
          hint: 'Saving full-resolution original image without digital zoom or crop'
        };
      case 'QR DETECTED':
        return {
          label: 'QR DETECTED',
          bg: 'bg-amber-900/90',
          border: 'border-amber-400',
          text: 'text-amber-200',
          pulse: true,
          icon: Target,
          hint: 'QR finder pattern recognized in live camera field of view'
        };
      case 'SEARCHING FOR QR':
        return {
          label: 'SEARCHING FOR QR',
          bg: 'bg-slate-900/90',
          border: 'border-sky-500/40',
          text: 'text-sky-300',
          pulse: true,
          icon: Camera,
          hint: 'Continuous wide-angle monitoring at 10–15m cruising altitude'
        };
      case 'QR PROCESSING FAILED':
        return {
          label: 'QR PROCESSING FAILED',
          bg: 'bg-slate-900/95',
          border: 'border-rose-500/70',
          text: 'text-rose-300',
          pulse: false,
          icon: AlertTriangle,
          hint: 'Image undecodable. Original photo preserved for offline inspection'
        };
      case 'CAMERA ERROR':
        return {
          label: 'CAMERA ERROR',
          bg: 'bg-rose-950/95',
          border: 'border-rose-500',
          text: 'text-rose-200',
          pulse: false,
          icon: AlertTriangle,
          hint: 'Camera feed unavailable. Verify hardware connection or camera permissions'
        };
      case 'CAMERA READY':
      default:
        return {
          label: 'CAMERA READY',
          bg: 'bg-slate-900/90',
          border: 'border-slate-700',
          text: 'text-slate-300',
          pulse: false,
          icon: Camera,
          hint: 'Drone-core camera initialized. Wide field of view locked at 1.0x'
        };
    }
  };

  const statusConfig = getStatusBadgeConfig(coreStatus);
  const StatusIcon = statusConfig.icon;
  const isGpsValid = Boolean(
    telemetry.gps.isLocked ||
    (telemetry.latitude !== 0 && Math.abs(telemetry.latitude) > 0.001) ||
    telemetry.gps.fixType === '3D_FIX' ||
    telemetry.gps.fixType === '3D_DGPS' ||
    telemetry.gps.fixType === 'RTK_FLOAT' ||
    telemetry.gps.fixType === 'RTK_FIXED'
  );
  const isRtlExecuting = (telemetry.flightMode || '').toUpperCase() === 'RTL' || coreStatus === 'RETURNING TO LAUNCH';

  return (
    <div ref={containerRef} className={`w-full h-full flex-1 flex flex-col min-h-0 font-sans select-none ${className}`}>
      {/* Primary Camera Card: Occupies available screen space */}
      <div className="relative rounded-2xl bg-[#070b14] border border-slate-800 overflow-hidden shadow-2xl flex-1 flex flex-col min-h-0">
        {/* Camera View Sub-Header */}
        <div className="h-10 px-3 sm:px-4 bg-[#0a0f1d] border-b border-slate-800/80 flex items-center justify-between text-xs font-mono shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Camera className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] truncate">
              AIR-GAPPED DRONE CORE
            </span>
            <span className="text-[10px] text-slate-500 hidden sm:inline">•</span>
            <span className="text-[10px] text-emerald-400 font-bold hidden sm:inline flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 inline" />
              EDGE ONLY
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
            }`} />
            <span className="hidden md:inline">
              {isCameraActive
                ? (edgeProgress.state !== 'STANDBY' ? `ACTIVE • ${edgeProgress.state}` : 'STANDBY • READY')
                : 'CAMERA OFF'}
            </span>

            {/* Autonomous Edge Mission Start/Abort Button */}
            <button
              type="button"
              onClick={handleToggleEdgeMission}
              title={edgeProgress.state === 'STANDBY' ? 'Start Autonomous Onboard Mission (Air-Gapped 360° Scan)' : 'Abort Autonomous Mission'}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer shadow-md active:scale-95 shrink-0 ${
                edgeProgress.state === 'STANDBY'
                  ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-950/60 ring-1 ring-sky-400/50'
                  : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/60 ring-1 ring-amber-400/50 animate-pulse'
              }`}
            >
              {edgeProgress.state === 'STANDBY' ? (
                <>
                  <Play className="w-3.5 h-3.5 shrink-0" />
                  <span>START AUTO SCAN</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 shrink-0" />
                  <span>ABORT SCAN</span>
                </>
              )}
            </button>

            {/* Camera Power Toggle (Start/Stop local camera hardware) */}
            <button
              type="button"
              onClick={handleToggleCamera}
              title={isCameraActive ? 'Turn Camera Off' : 'Turn Camera On'}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer shadow-md active:scale-95 shrink-0 ${
                isCameraActive
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/60 ring-1 ring-rose-400/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 ring-1 ring-emerald-400/50'
              }`}
            >
              <Power className="w-3.5 h-3.5 shrink-0" />
              <span>{isCameraActive ? 'CAMERA OFF' : 'CAMERA ON'}</span>
            </button>

            {/* Camera Settings Button (Fully visible, unclipped, sufficient padding) */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              title="Camera Sensor Settings"
              aria-label="Camera Sensor Settings"
              className="w-7 h-7 min-w-[28px] min-h-[28px] p-1 rounded-lg bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-700/80 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
            >
              <Settings className="w-4 h-4 shrink-0 block" />
            </button>

            {/* Exactly One Fullscreen Button (Synchronized with HTML5 Fullscreen API) */}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              className="w-7 h-7 min-w-[28px] min-h-[28px] p-1 rounded-lg bg-slate-900 hover:bg-slate-800 active:bg-slate-700 border border-slate-700/80 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4 shrink-0 block" />
              ) : (
                <Maximize className="w-4 h-4 shrink-0 block" />
              )}
            </button>
          </div>
        </div>

        {/* Autonomous Edge Mission State Tracker Strip (Air-Gapped Workflow) */}
        {edgeProgress.state !== 'STANDBY' && (
          <div className="px-3 py-1.5 bg-[#0b1324] border-b border-sky-900/60 flex flex-wrap items-center justify-between text-[10px] font-mono gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold uppercase tracking-wide">MISSION:</span>
              <span className={`px-2 py-0.5 rounded font-black tracking-wider text-[10px] uppercase shadow-sm ${
                edgeProgress.state === 'SEARCHING'
                  ? 'bg-sky-900/80 text-sky-200 border border-sky-500 animate-pulse'
                  : edgeProgress.state === 'TARGET_DETECTED'
                  ? 'bg-amber-900/80 text-amber-200 border border-amber-500 animate-pulse'
                  : edgeProgress.state === 'APPROACHING'
                  ? 'bg-indigo-900/80 text-indigo-200 border border-indigo-500'
                  : edgeProgress.state === 'DECODING'
                  ? 'bg-purple-900/80 text-purple-200 border border-purple-500 animate-pulse'
                  : 'bg-emerald-900/80 text-emerald-200 border border-emerald-500'
              }`}>
                {edgeProgress.state}
              </span>
              <span className="text-slate-500 hidden sm:inline">•</span>
              <span className="text-slate-300 truncate max-w-xs md:max-w-md hidden sm:inline">
                {edgeProgress.statusMessage}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-amber-400 font-bold flex items-center gap-1">
                <ZoomIn className="w-3 h-3" />
                {edgeProgress.currentZoomFactor.toFixed(1)}x ZOOM
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-sky-300 font-bold flex items-center gap-1">
                <Compass className="w-3 h-3" />
                {edgeProgress.currentYawDegrees.toFixed(0)}° YAW
              </span>
              {edgeProgress.distanceToTargetMeters !== null && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-emerald-400 font-bold">
                    DIST: {edgeProgress.distanceToTargetMeters.toFixed(1)}m
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Video Canvas Container (Maintains 16:9 Aspect Ratio) */}
        <div className="relative w-full flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
          <div className="relative w-full h-full max-w-full max-h-full aspect-video flex items-center justify-center overflow-hidden">
            {/* Drone Core Onboard Camera Stream */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                isCameraActive ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
              }`}
            />

            {/* Camera Offline / Error State Placeholder */}
            {!isCameraActive && (
              <div className="p-6 text-center space-y-3 max-w-sm">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mx-auto">
                  <VideoOff className="w-6 h-6 text-slate-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-orbitron">
                    CAMERA FEED UNAVAILABLE
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 font-mono">
                    {cameraErrorMessage || 'Connecting to drone-core optical sensor...'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRestartCamera}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 mx-auto shadow-lg shadow-amber-600/30"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>INITIALIZE CAMERA</span>
                </button>
              </div>
            )}

            {/* TACTICAL HUD OVERLAY: Top Status Indicator */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10 gap-2">
              <div
                className={`px-3 py-1.5 rounded-lg border backdrop-blur-md flex items-center gap-2 shadow-xl pointer-events-auto transition-all ${
                  statusConfig.bg
                } ${statusConfig.border} ${statusConfig.text}`}
                title={statusConfig.hint}
              >
                <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.pulse ? 'animate-pulse' : ''}`} />
                <span className="font-orbitron font-extrabold text-[11px] tracking-wider uppercase">
                  {statusConfig.label}
                </span>
              </div>

              {/* FOV & Dynamic Zoom Indicator */}
              <div className="px-2.5 py-1 rounded-lg bg-black/75 border border-slate-800 text-[10px] font-mono text-slate-300 backdrop-blur-sm hidden sm:flex items-center gap-1.5 shadow-md">
                <span className="text-amber-400 font-bold">{edgeProgress.currentZoomFactor.toFixed(1)}x DYNAMIC</span>
                <span className="text-slate-600">•</span>
                <span>YAW {edgeProgress.currentYawDegrees.toFixed(0)}°</span>
                <span className="text-slate-600">•</span>
                <span className="text-emerald-400 font-bold">AIR-GAPPED</span>
              </div>
            </div>

            {/* TACTICAL HUD OVERLAY: Center Reticle / Target Corners */}
            {isCameraActive && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative w-48 h-48 border border-white/20 rounded-lg">
                  {/* Corner Brackets */}
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-amber-400" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-amber-400" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-amber-400" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-amber-400" />

                  {/* Subtle Crosshair */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400/60" />
                </div>
              </div>
            )}

            {/* TACTICAL HUD OVERLAY: Dynamic QR Detection Bounding Box */}
            {activeBoundingBox && (
              <div
                className="absolute border-2 border-emerald-400 bg-emerald-500/20 rounded pointer-events-none z-20 animate-pulse shadow-[0_0_15px_rgba(52,211,153,0.8)]"
                style={{
                  left: `${activeBoundingBox.x}px`,
                  top: `${activeBoundingBox.y}px`,
                  width: `${activeBoundingBox.width}px`,
                  height: `${activeBoundingBox.height}px`
                }}
              >
                <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-emerald-600 text-white font-mono text-[9px] font-bold">
                  TARGET LOCK
                </span>
              </div>
            )}

            {/* TACTICAL HUD OVERLAY: Bottom Flight Telemetry Strip */}
            <div className="absolute bottom-2 left-2 right-2 px-3 py-1.5 bg-[#0c1322]/90 border border-slate-800/90 rounded-xl backdrop-blur-md flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-300 pointer-events-none z-10 gap-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 text-[10px]">ALT:</span>
                  <span className="text-amber-300 font-bold">{telemetry.altitude.toFixed(1)}m AGL</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 text-[10px]">SPD:</span>
                  <span className="text-sky-300 font-bold">{telemetry.groundSpeed.toFixed(1)} m/s</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 text-[10px]">HDG:</span>
                  <span className="text-slate-300 font-bold">{telemetry.heading}°</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {isGpsValid ? (
                  <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span>{telemetry.latitude.toFixed(6)}, {telemetry.longitude.toFixed(6)}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>GPS ACQUIRING</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Automatic RTL Notification Banner (Triggered automatically upon verified QR receipt) */}
        {(edgeProgress.state === 'RTL' || (latestDetection && latestDetection.rtlInitiated)) && (
          <div className={`shrink-0 p-3 border-t flex items-center justify-between shadow-2xl transition-all ${
            isRtlExecuting || edgeProgress.state === 'RTL'
              ? 'bg-rose-950/95 border-rose-500 text-rose-100 shadow-rose-950/60'
              : 'bg-red-950/90 border-red-500 text-red-100 shadow-red-950/40'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-rose-900/80 border border-rose-400 flex items-center justify-center text-rose-200 shrink-0">
                <RotateCcw className="w-4 h-4 animate-spin" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-orbitron font-extrabold text-xs uppercase tracking-wide text-white">
                    {edgeProgress.state === 'RTL' ? 'MISSION COMPLETE • AUTONOMOUS RETURN TO LAUNCH' : (isRtlExecuting ? 'RETURNING TO LAUNCH (RTL ACTIVE)' : 'AUTOMATIC RTL INITIATED')}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-400 text-rose-200 text-[9px] font-mono font-bold">
                    AIR-GAPPED RTL
                  </span>
                </div>
                <p className="text-[10px] text-rose-200/90 font-mono">
                  {edgeProgress.decodedPayload
                    ? `Verified QR Payload: "${edgeProgress.decodedPayload}" stored securely in local memory. Pixhawk confirmed RTL navigation.`
                    : (isRtlExecuting
                      ? `Pixhawk confirmed RTL flight mode. Cruising back to Home Reference at ${telemetry.altitude.toFixed(1)}m.`
                      : 'QR payload verified. Pixhawk Return-To-Launch triggered automatically. Autonomous search halted.')}
                </p>
              </div>
            </div>

            <div className="font-mono text-right hidden sm:block">
              <span className="text-[10px] text-rose-300 block">Flight Controller:</span>
              <span className="text-xs font-black uppercase text-white">{telemetry.flightMode || 'RTL'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Camera Sensor Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0e1422] border border-slate-700 rounded-xl max-w-sm w-full p-5 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-amber-400" />
                <h3 className="font-orbitron font-bold text-xs uppercase tracking-wide text-white">
                  OPTICAL SENSOR SETTINGS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400">Sensor Mode:</span>
                <span className="text-emerald-400 font-bold">16:9 NATIVE</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400">Field of View:</span>
                <span className="text-amber-400 font-bold">1.0x FIXED WIDE</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400">QR Decoder:</span>
                <span className="text-sky-300 font-bold">MULTI-PASS ENGINE</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400">Auto RTL Trigger:</span>
                <span className="text-rose-400 font-bold">ACTIVE ON VERIFY</span>
              </div>
            </div>



            <button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              CLOSE SETTINGS
            </button>
          </div>
        </div>
      )}


    </div>
  );
};

export default DroneDashboard;
