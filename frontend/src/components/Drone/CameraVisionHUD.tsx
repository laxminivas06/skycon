import React, { useEffect, useRef, useState } from 'react';
import { DecodedQRData, PhotoCaptureEvent, DroneTelemetry } from '../../types/mission';
import { visionService, VisionFilterMode } from '../../services/visionService';
import { 
  Camera, 
  Sparkles, 
  CheckCircle2, 
  CameraIcon,
  Send,
  X,
  QrCode,
  Zap,
  SwitchCamera,
  Layers,
  Flashlight,
  Sliders,
  Eye,
  Scan,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Power,
  PowerOff
} from 'lucide-react';

interface CameraVisionHUDProps {
  onQRDetected?: (data: DecodedQRData) => void;
  isScanning?: boolean;
  className?: string;
  decodedQR: DecodedQRData | null;
  telemetry?: DroneTelemetry;
  scannerActive?: boolean;
  onScannerToggle?: (active: boolean) => void;
}

export const CameraVisionHUD: React.FC<CameraVisionHUDProps> = ({
  onQRDetected,
  isScanning = false,
  className = '',
  decodedQR,
  telemetry,
  scannerActive,
  onScannerToggle
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [filterMode, setFilterMode] = useState<VisionFilterMode>('NORMAL');
  const [showFilterMenu, setShowFilterMenu] = useState<boolean>(false);
  const [showZoomSlider, setShowZoomSlider] = useState<boolean>(false);
  // Requirement: Default state when Drone Core opens: Scanner = OFF. Camera does not activate.
  const [isScannerOn, setIsScannerOn] = useState<boolean>(scannerActive ?? false);

  const [cameraState, setCameraState] = useState<{
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
  }>(visionService.getCameraState());

  const [activeQR, setActiveQR] = useState<DecodedQRData | null>(decodedQR);
  const [showTargetModal, setShowTargetModal] = useState(false);

  // Sync external scannerActive if supplied
  useEffect(() => {
    if (scannerActive !== undefined) {
      setIsScannerOn(scannerActive);
    }
  }, [scannerActive]);

  const handleTurnScannerOn = async () => {
    setIsScannerOn(true);
    if (onScannerToggle) onScannerToggle(true);
    if (videoRef.current) {
      await visionService.startCamera(videoRef.current);
      setCameraState(visionService.getCameraState());
    }
  };

  const handleTurnScannerOff = () => {
    setIsScannerOn(false);
    if (onScannerToggle) onScannerToggle(false);
    visionService.stopCamera();
    setCameraState(visionService.getCameraState());
  };

  const startCameraStream = async () => {
    if (videoRef.current && isScannerOn) {
      await visionService.startCamera(videoRef.current);
      setCameraState(visionService.getCameraState());
    }
  };

  useEffect(() => {
    let mounted = true;

    // Camera and scanner only activate if user tapped ON
    if (isScannerOn && videoRef.current) {
      visionService.startCamera(videoRef.current).then(() => {
        if (mounted) setCameraState(visionService.getCameraState());
      });
    } else {
      visionService.stopCamera();
      if (mounted) setCameraState(visionService.getCameraState());
    }

    const unsubscribeCam = visionService.subscribeCameraState((s) => {
      if (mounted) setCameraState(s);
    });

    const unsubscribeQR = visionService.subscribeQR((data) => {
      if (mounted && isScannerOn) {
        setActiveQR(data);
        if (data && data.isValidTwoDigit) {
          setShowTargetModal(true);
        }
        if (onQRDetected) {
          onQRDetected(data);
        }
      }
    });

    return () => {
      mounted = false;
      unsubscribeCam();
      unsubscribeQR();
      visionService.stopCamera();
    };
  }, [isScannerOn, onQRDetected]);

  useEffect(() => {
    if (decodedQR) {
      setActiveQR(decodedQR);
      if (decodedQR.isValidTwoDigit) {
        setShowTargetModal(true);
      }
    }
  }, [decodedQR]);

  const handleSwitchCamera = async () => {
    await visionService.switchCamera();
    setCameraState(visionService.getCameraState());
  };

  const handleToggleTorch = async () => {
    await visionService.toggleTorch();
    setCameraState(visionService.getCameraState());
  };

  const handleToggleAutoZoom = () => {
    const next = !cameraState.isAutoZoomEnabled;
    visionService.setAutoZoom(next);
    setCameraState(visionService.getCameraState());
  };

  const handleSetDirectZoom = (zoomLevel: number) => {
    visionService.setAutoZoom(false);
    visionService.setHardwareZoom(zoomLevel);
    setCameraState(visionService.getCameraState());
  };

  const handleSelectFilter = (mode: VisionFilterMode) => {
    setFilterMode(mode);
    visionService.setFilterMode(mode);
  };

  const needsPermissionPrompt = !cameraState.isActive && !cameraState.permissionGranted;

  // Video CSS Filter Style Mapping for Live Shaders + Digital Magnification
  const getVideoStyle = (): React.CSSProperties => {
    let filter = 'none';
    switch (filterMode) {
      case 'OPENCV_EDGES':
        filter = 'contrast(300%) grayscale(100%) invert(100%) drop-shadow(0 0 4px #06b6d4)';
        break;
      case 'OPENCV_BINARIZED':
        filter = 'grayscale(100%) contrast(600%) brightness(120%)';
        break;
      case 'OPENCV_CONTRAST':
        filter = 'contrast(200%) saturate(160%) brightness(115%)';
        break;
      case 'NIGHT_VISION':
        filter = 'sepia(100%) hue-rotate(90deg) brightness(140%) contrast(220%)';
        break;
      case 'CYBER_HUD':
        filter = 'contrast(150%) hue-rotate(190deg) saturate(180%)';
        break;
      case 'NORMAL':
      default:
        filter = 'none';
        break;
    }

    // Seamlessly combine hardware optical zoom with smooth digital super-resolution magnification up to 5.0x
    const hwMax = cameraState.hasZoom ? (cameraState.hardwareMaxZoom || 3.0) : 1.0;
    const hwApplied = cameraState.hasZoom ? Math.min(hwMax, cameraState.currentZoom) : 1.0;
    const digitalScale = cameraState.currentZoom / hwApplied;

    return {
      filter,
      transform: `scale(${digitalScale})`,
      transformOrigin: 'center center',
      transition: 'transform 0.1s ease-out, filter 0.2s ease'
    };
  };

  return (
    <div className={`relative w-full h-full min-h-[360px] sm:min-h-[440px] bg-black overflow-hidden select-none font-mono flex flex-col justify-between ${className}`}>
      {/* 100% Full-Screen Responsive Camera Feed */}
      <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={getVideoStyle()}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Cyber HUD Scanline & Grid Overlay (Active in Cyber & Night Vision Modes) */}
      {(filterMode === 'CYBER_HUD' || filterMode === 'NIGHT_VISION') && (
        <div className="absolute inset-0 pointer-events-none z-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-60" />
      )}

      {/* Subtle Corner Scanning Reticles */}
      <div className="absolute inset-0 pointer-events-none p-3 sm:p-4 z-10">
        <div className="w-full h-full relative">
          <div className="absolute top-0 left-0 w-5 sm:w-8 h-5 sm:h-8 border-t-2 border-l-2 border-emerald-400/60" />
          <div className="absolute top-0 right-0 w-5 sm:w-8 h-5 sm:h-8 border-t-2 border-r-2 border-emerald-400/60" />
          <div className="absolute bottom-0 left-0 w-5 sm:w-8 h-5 sm:h-8 border-b-2 border-l-2 border-emerald-400/60" />
          <div className="absolute bottom-0 right-0 w-5 sm:w-8 h-5 sm:h-8 border-b-2 border-r-2 border-emerald-400/60" />

          {/* Crosshair Center Reticle */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 pointer-events-none opacity-40">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-2 bg-emerald-400" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 h-2 bg-emerald-400" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-0.5 bg-emerald-400" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-0.5 bg-emerald-400" />
          </div>
        </div>
      </div>

      {/* SCANNER OFF STANDBY OVERLAY (Camera remains deactivated until user taps ON) */}
      {!isScannerOn && (
        <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 font-mono">
          <div className="w-16 h-16 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center text-slate-400 shadow-xl">
            <Scan className="w-8 h-8 text-sky-400" />
          </div>

          <div className="space-y-1.5 max-w-sm">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-400 text-xs font-black uppercase">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              <span>SCANNER = OFF</span>
            </div>
            <h3 className="text-lg font-black text-white uppercase tracking-wide">
              DRONE QR SCANNER
            </h3>
            <p className="text-xs text-slate-400">
              Camera and QR detection are turned OFF. Tap ON below to activate the drone camera and start scanning.
            </p>
          </div>

          <button
            type="button"
            onClick={handleTurnScannerOn}
            className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-black text-sm uppercase tracking-wider transition flex items-center space-x-2.5 shadow-xl shadow-emerald-600/40 cursor-pointer"
          >
            <Power className="w-5 h-5" />
            <span>TURN SCANNER ON</span>
          </button>
        </div>
      )}

      {/* One-Time Initial Camera Permission Request Prompt */}
      {isScannerOn && needsPermissionPrompt && (
        <div className="absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-950/80 border-2 border-emerald-400 flex items-center justify-center text-emerald-300 shadow-xl shadow-emerald-500/20">
            <Camera className="w-8 h-8 animate-pulse" />
          </div>

          <div className="space-y-1 max-w-sm">
            <h3 className="text-lg font-black text-white uppercase tracking-wide">
              ENABLE CAMERA
            </h3>
            <p className="text-xs text-slate-400">
              Grant camera access to enable responsive QR scanning and dynamic zoom up to 5.0x.
            </p>
          </div>

          <button
            onClick={startCameraStream}
            className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-black text-sm uppercase tracking-wider transition flex items-center space-x-2.5 shadow-xl shadow-emerald-600/40 cursor-pointer"
          >
            <CameraIcon className="w-5 h-5" />
            <span>ALLOW CAMERA ACCESS</span>
          </button>
        </div>
      )}

      {/* DYNAMIC RESPONSIVE QR BOUNDING BOX */}
      {activeQR?.normalizedBox && (
        <div
          className="absolute pointer-events-none z-20 transition-all duration-100 ease-out border-2 border-emerald-400 bg-emerald-500/20 rounded-lg shadow-2xl shadow-emerald-500/50 flex items-center justify-center"
          style={{
            left: `${activeQR.normalizedBox.xPercent}%`,
            top: `${activeQR.normalizedBox.yPercent}%`,
            width: `${Math.max(14, activeQR.normalizedBox.widthPercent)}%`,
            height: `${Math.max(14, activeQR.normalizedBox.heightPercent)}%`
          }}
        >
          <div className="absolute -top-1 -left-1 w-3.5 h-3.5 border-t-3 border-l-3 border-emerald-300" />
          <div className="absolute -top-1 -right-1 w-3.5 h-3.5 border-t-3 border-r-3 border-emerald-300" />
          <div className="absolute -bottom-1 -left-1 w-3.5 h-3.5 border-b-3 border-l-3 border-emerald-300" />
          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-b-3 border-r-3 border-emerald-300" />

          <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-400 text-[10px] font-black tracking-wider uppercase whitespace-nowrap shadow-lg flex items-center space-x-1 animate-bounce">
            <Sparkles className="w-3 h-3" />
            <span>QR CODE [{activeQR.code}]</span>
          </div>

          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        </div>
      )}

      {/* Top Header Controls: Zoom status, Battery, Torch, Theme, Switch Camera */}
      <div className="relative z-20 p-2 sm:p-3 flex items-center justify-between pointer-events-none gap-1.5 flex-wrap">
        {/* Left Side: Auto-Zoom & Battery Indicators */}
        <div className="flex items-center space-x-1.5 pointer-events-auto">
          <button
            onClick={handleToggleAutoZoom}
            className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full backdrop-blur-md border text-[10px] sm:text-[11px] text-white flex items-center space-x-1.5 transition cursor-pointer shadow-lg ${
              cameraState.isAutoZoomEnabled 
                ? 'bg-sky-600/90 border-sky-400/80 shadow-sky-600/30' 
                : 'bg-black/70 border-white/15 hover:bg-black/90'
            }`}
            title="Toggle Autonomous 1x -> 5x Dynamic Zoom Sweep"
          >
            <div className={`w-2 h-2 rounded-full ${cameraState.isAutoZoomEnabled ? 'bg-sky-300 animate-pulse' : 'bg-amber-400'}`} />
            <span className="font-bold tracking-wider">
              {cameraState.isAutoZoomEnabled ? `AUTO-ZOOM: ${cameraState.currentZoom.toFixed(1)}x` : `ZOOM: ${cameraState.currentZoom.toFixed(1)}x`}
            </span>
          </button>

          {/* Live FC Battery Indicator on Camera HUD */}
          {telemetry && (
            <div className="bg-black/70 backdrop-blur-md px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full border border-white/15 text-[10px] sm:text-[11px] font-black flex items-center space-x-1 shadow-lg">
              <span className={telemetry.batteryPercent > 50 ? 'text-emerald-400' : telemetry.batteryPercent > 20 ? 'text-amber-400' : 'text-rose-400'}>
                🔋 {telemetry.batteryPercent}%
              </span>
              <span className="text-[9px] text-slate-400">({telemetry.batteryVoltage}V)</span>
            </div>
          )}
        </div>

        {/* Right Side: Scanner OFF, Torch, Theme Selector, Switch Camera */}
        <div className="flex items-center space-x-1.5 pointer-events-auto">
          {/* Explicit Scanner OFF button */}
          <button
            type="button"
            onClick={handleTurnScannerOff}
            className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-rose-600/90 hover:bg-rose-500 active:bg-rose-700 text-white border border-rose-400 text-[9px] sm:text-[10px] font-black uppercase flex items-center space-x-1 transition cursor-pointer shadow-lg shadow-rose-600/30"
            title="Stop QR detection and turn camera OFF"
          >
            <PowerOff className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            <span>OFF</span>
          </button>

          {/* Torch Toggle */}
          {cameraState.hasTorch && (
            <button
              onClick={handleToggleTorch}
              className={`p-1.5 sm:p-2 rounded-full backdrop-blur-md border transition cursor-pointer ${
                cameraState.isTorchOn ? 'bg-amber-500 text-black border-amber-300 shadow-lg shadow-amber-500/50' : 'bg-black/70 text-white/90 border-white/15 hover:bg-black/90'
              }`}
              title="Toggle Torch / Flash"
            >
              <Flashlight className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
            </button>
          )}

          {/* Vision Filter Theme Toggle Menu */}
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full backdrop-blur-md border text-[9px] sm:text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 transition cursor-pointer shadow-lg ${
              filterMode !== 'NORMAL' ? 'bg-sky-600 text-white border-sky-400 shadow-sky-600/40' : 'bg-black/70 text-white/90 border-white/15 hover:bg-black/90'
            }`}
            title="Switch Vision Filter & Themes"
          >
            <Layers className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
            <span>{filterMode.replace('OPENCV_', '')}</span>
          </button>

          {/* Switch Camera */}
          <button
            onClick={handleSwitchCamera}
            className="p-1.5 sm:p-2 bg-black/70 backdrop-blur-md hover:bg-black/90 text-white/90 rounded-full border border-white/15 transition cursor-pointer shadow-lg"
            title="Switch Camera (Front/Back)"
          >
            <SwitchCamera className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Floating Vision Filter Mode Selector Deck */}
      {showFilterMenu && (
        <div className="absolute top-12 sm:top-14 right-2 sm:right-3 z-30 bg-slate-950/95 backdrop-blur-md border border-slate-700 rounded-xl p-2 shadow-2xl space-y-1 w-44 animate-in fade-in slide-in-from-top-2 duration-150 font-mono">
          <div className="text-[9px] text-slate-400 uppercase font-black px-2 py-1 tracking-wider border-b border-slate-800">
            Select Vision Mode:
          </div>

          {[
            { id: 'NORMAL', label: 'Normal Optical', desc: 'Raw High-Res RGB' },
            { id: 'OPENCV_EDGES', label: 'Edge Detection', desc: 'Sobel High-Contrast' },
            { id: 'OPENCV_BINARIZED', label: 'Binarized B&W', desc: 'Matrix Threshold' },
            { id: 'OPENCV_CONTRAST', label: 'HDR Dynamic Boost', desc: 'Extreme Contrast' },
            { id: 'NIGHT_VISION', label: 'Night Vision', desc: 'Thermal Green HUD' },
            { id: 'CYBER_HUD', label: 'Cyber HUD', desc: 'Futuristic Grid' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                handleSelectFilter(item.id as VisionFilterMode);
                setShowFilterMenu(false);
              }}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition flex flex-col cursor-pointer ${
                filterMode === item.id 
                  ? 'bg-sky-600 text-white font-black' 
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{item.label}</span>
                {filterMode === item.id && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </div>
              <span className="text-[9px] opacity-75 font-normal">{item.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Bottom Floating Responsive Zoom Control Deck (Quick Presets: 1x, 2x, 3x, 5x & Slider) */}
      <div className="relative z-20 p-2 sm:p-3 flex items-center justify-between pointer-events-none gap-2">
        <div className="pointer-events-auto bg-black/75 backdrop-blur-md px-2 py-1 rounded-xl border border-white/15 flex items-center space-x-1 shadow-2xl">
          <span className="text-[9px] font-bold text-slate-400 uppercase px-1 hidden xs:inline">ZOOM:</span>

          {/* Quick Zoom Preset Buttons */}
          {[1.0, 2.0, 3.0, 5.0].map((zoom) => (
            <button
              key={zoom}
              onClick={() => handleSetDirectZoom(zoom)}
              className={`px-2 py-1 rounded-lg text-[10px] font-black tracking-wider transition cursor-pointer ${
                !cameraState.isAutoZoomEnabled && Math.abs(cameraState.currentZoom - zoom) < 0.2
                  ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/40'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              {zoom}x
            </button>
          ))}

          {/* Auto Zoom Quick Toggle */}
          <button
            onClick={handleToggleAutoZoom}
            className={`px-2 py-1 rounded-lg text-[10px] font-black tracking-wider transition flex items-center space-x-0.5 cursor-pointer ${
              cameraState.isAutoZoomEnabled 
                ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/40' 
                : 'text-slate-400 hover:bg-white/10'
            }`}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${cameraState.isAutoZoomEnabled ? 'animate-spin' : ''}`} />
            <span>AUTO</span>
          </button>
        </div>

        {/* Dynamic Zoom Slider Trigger / Control */}
        <div className="pointer-events-auto bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-xl border border-white/15 flex items-center space-x-2 shadow-2xl">
          <ZoomOut 
            className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-white" 
            onClick={() => handleSetDirectZoom(Math.max(1.0, cameraState.currentZoom - 0.5))} 
          />
          <input
            type="range"
            min={1.0}
            max={5.0}
            step={0.1}
            value={cameraState.currentZoom}
            onChange={(e) => handleSetDirectZoom(parseFloat(e.target.value))}
            className="w-16 sm:w-24 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
          <ZoomIn 
            className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-white" 
            onClick={() => handleSetDirectZoom(Math.min(5.0, cameraState.currentZoom + 0.5))} 
          />
          <span className="text-[10px] font-black text-emerald-400 min-w-[28px] text-right">
            {cameraState.currentZoom.toFixed(1)}x
          </span>
        </div>
      </div>

      {/* FULL-SCREEN TARGET DETECTION DISPLAY MODAL */}
      {showTargetModal && activeQR?.isValidTwoDigit && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900/95 border-2 border-emerald-400 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center space-y-4 shadow-2xl shadow-emerald-500/30 font-mono relative">
            <button
              onClick={() => setShowTargetModal(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="inline-flex items-center space-x-1.5 bg-emerald-950 text-emerald-300 border border-emerald-400 px-3 py-1 rounded-full text-[11px] font-black tracking-wider uppercase shadow-lg">
              <Sparkles className="w-3.5 h-3.5" />
              <span>QR CODE DECODED</span>
            </div>

            <div>
              <div className="text-slate-400 text-[10px] uppercase tracking-widest font-bold mb-1">
                TARGET NUMBER
              </div>
              <div className="text-7xl sm:text-8xl font-black text-white tracking-widest leading-none drop-shadow-[0_10px_30px_rgba(16,185,129,0.6)]">
                {activeQR.code}
              </div>
            </div>

            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs text-left">
              <div className="space-y-0.5">
                <div className="text-emerald-400 font-bold flex items-center space-x-1 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verified 2-Digit Target ✓</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Ready to transmit directly to Runner
                </div>
              </div>

              {activeQR.photoSnapshotUrl && (
                <img
                  src={activeQR.photoSnapshotUrl}
                  alt="QR Snapshot"
                  className="w-12 h-12 object-cover rounded-lg border border-emerald-500/60"
                />
              )}
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => setShowTargetModal(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
              >
                Scan Again
              </button>

              <button
                onClick={() => {
                  setShowTargetModal(false);
                  if (onQRDetected) onQRDetected(activeQR);
                }}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Confirm</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
