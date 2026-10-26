import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video,
  WifiOff,
  RefreshCw,
  Radio,
  Settings,
  X,
  Power,
  AlertTriangle,
  ShieldAlert,
  Smartphone,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Focus,
  Target,
  CheckCircle2
} from 'lucide-react';
import {
  ipCameraService,
  IpCameraStatus,
  IpCameraDetection
} from '../../services/ipCameraService';
import {
  droneCameraStreamService,
  DroneCameraStreamStatus
} from '../../services/droneCameraStreamService';
import { IpCameraConfigModal } from '../common/IpCameraConfigModal';

interface LiveVideoFeedProps {
  className?: string;
  large?: boolean;
  onClose?: () => void;
}

const MAX_AUTO_RETRIES = 3;

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({
  className = '',
  large = false,
  onClose
}) => {
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(() => ipCameraService.isIpCameraEnabled());
  const [streamUrl, setStreamUrl] = useState<string>(() => ipCameraService.getStreamUrl());
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [videoState, setVideoState] = useState<IpCameraStatus>(() => 
    ipCameraService.isIpCameraEnabled() ? 'CONNECTING' : 'OFF'
  );
  const [retryCount, setRetryCount] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<number>(() => ipCameraService.getZoom());
  const [isAutoZoom, setIsAutoZoom] = useState<boolean>(() => ipCameraService.isAutoZoom());
  const [detection, setDetection] = useState<IpCameraDetection | null>(() => ipCameraService.getLatestDetection());
  const [dismissMixedContentWarning, setDismissMixedContentWarning] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const droneVideoRef = useRef<HTMLVideoElement | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  // Drone Core direct stream state
  const [droneStream, setDroneStream] = useState<MediaStream | null>(() => droneCameraStreamService.getMediaStream());
  const [droneFrame, setDroneFrame] = useState<string | null>(() => droneCameraStreamService.getLatestFrame());
  const [droneStreamStatus, setDroneStreamStatus] = useState<DroneCameraStreamStatus>(() => droneCameraStreamService.getCurrentStatus());

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isHttpStream = streamUrl.toLowerCase().startsWith('http://');
  const isMixedContentRisk = isHttps && isHttpStream && isCameraEnabled;

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const scheduleRetry = useCallback(() => {
    clearRetryTimer();
    if (!isCameraEnabled) return;

    if (retryCount >= MAX_AUTO_RETRIES) {
      setVideoState('DISCONNECTED');
      ipCameraService.setStatus('DISCONNECTED');
      return;
    }

    const backoffMs = Math.min(3000 * Math.pow(1.5, retryCount), 8000);
    retryTimerRef.current = window.setTimeout(() => {
      setRetryCount((c) => c + 1);
      setVideoState('CONNECTING');
      ipCameraService.setStatus('CONNECTING');
    }, backoffMs);
  }, [isCameraEnabled, retryCount]);

  useEffect(() => {
    const unsubUrl = ipCameraService.subscribeUrl((url) => {
      setStreamUrl(url);
      setRetryCount(0);
      if (ipCameraService.isIpCameraEnabled()) {
        setVideoState('CONNECTING');
      }
    });

    const unsubToggle = ipCameraService.subscribeToggle((enabled) => {
      setIsCameraEnabled(enabled);
      if (enabled) {
        setRetryCount(0);
        setVideoState('CONNECTING');
      } else {
        clearRetryTimer();
        setVideoState('OFF');
      }
    });

    const unsubStatus = ipCameraService.subscribeStatus((st) => {
      setVideoState(st);
    });

    const unsubZoom = ipCameraService.subscribeZoom((z, sweep) => {
      setZoomLevel(z);
      setIsAutoZoom(sweep);
    });

    const unsubDetection = ipCameraService.subscribeDetection((det) => {
      setDetection(det);
    });

    return () => {
      clearRetryTimer();
      unsubUrl();
      unsubToggle();
      unsubStatus();
      unsubZoom();
      unsubDetection();
    };
  }, []);

  // Subscribe to Drone Core Camera Stream Service
  useEffect(() => {
    droneCameraStreamService.startSubscribing();
    const unsubStream = droneCameraStreamService.subscribeStream((s) => setDroneStream(s));
    const unsubFrame = droneCameraStreamService.subscribeFrame((f) => setDroneFrame(f));
    const unsubStatus = droneCameraStreamService.subscribeStatus((st) => setDroneStreamStatus(st));

    return () => {
      unsubStream();
      unsubFrame();
      unsubStatus();
    };
  }, []);

  // Synchronize Drone Core MediaStream to video element
  useEffect(() => {
    if (droneVideoRef.current) {
      if (droneStream) {
        if (droneVideoRef.current.srcObject !== droneStream) {
          droneVideoRef.current.srcObject = droneStream;
          droneVideoRef.current.play().catch(() => {});
        }
      } else {
        droneVideoRef.current.srcObject = null;
      }
    }
  }, [droneStream]);

  // Attach continuous QR scanner loop when image element is active
  useEffect(() => {
    if (isCameraEnabled && imgRef.current) {
      const detach = ipCameraService.attachScanner(imgRef.current);
      return () => detach();
    }
  }, [isCameraEnabled, retryCount]);

  // Request stream with proxy routing if enabled
  const effectiveUrl = ipCameraService.getEffectiveStreamUrl();
  const imgSrc = isCameraEnabled && effectiveUrl
    ? `${effectiveUrl}${effectiveUrl.includes('?') ? '&' : '?'}_t=${retryCount}`
    : '';

  const handleImgLoad = () => {
    setVideoState('LIVE');
    ipCameraService.setStatus('LIVE');
    setRetryCount(0);
    clearRetryTimer();
  };

  const handleImgError = () => {
    if (!isCameraEnabled) return;
    setVideoState('DISCONNECTED');
    ipCameraService.setStatus('DISCONNECTED');
    scheduleRetry();
  };

  const handleManualRetry = () => {
    clearRetryTimer();
    setRetryCount(0);
    if (!isCameraEnabled) {
      ipCameraService.setIpCameraEnabled(true);
    }
    setVideoState('CONNECTING');
    ipCameraService.setStatus('CONNECTING');
  };

  const isDroneLive = droneStreamStatus === 'LIVE_FEED_CONNECTED' && Boolean(droneStream || droneFrame);

  const stateColor =
    isDroneLive
      ? 'text-emerald-400 border-emerald-500/60 bg-emerald-950/80 shadow-emerald-950/60'
      : !isCameraEnabled || videoState === 'OFF'
      ? 'text-slate-400 border-slate-700 bg-slate-900/90'
      : videoState === 'LIVE'
      ? 'text-emerald-400 border-emerald-500/60 bg-emerald-950/80'
      : videoState === 'CONNECTING'
      ? 'text-amber-400 border-amber-500/60 bg-amber-950/80 animate-pulse'
      : 'text-rose-400 border-rose-500/60 bg-rose-950/80';

  const stateLabel =
    isDroneLive
      ? 'DRONE CORE: LIVE STREAM'
      : !isCameraEnabled || videoState === 'OFF'
      ? 'CAMERA: STANDBY (OFF)'
      : videoState === 'LIVE'
      ? `PHONE IP CAM • ${zoomLevel.toFixed(1)}x`
      : videoState === 'CONNECTING'
      ? `CAMERA: CONNECTING (${retryCount + 1}/${MAX_AUTO_RETRIES})...`
      : 'CAMERA DISCONNECTED';

  return (
    <div
      className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex flex-col font-mono select-none ${className}`}
    >
      {/* Header overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[10px] sm:text-[11px] font-black backdrop-blur-md shadow-md ${stateColor}`}
        >
          {videoState === 'LIVE' || isDroneLive ? (
            <Radio className="w-3 h-3 animate-pulse" />
          ) : videoState === 'CONNECTING' ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : videoState === 'OFF' || !isCameraEnabled ? (
            <Power className="w-3 h-3 text-slate-500" />
          ) : (
            <WifiOff className="w-3 h-3" />
          )}
          <span>{stateLabel}</span>
        </div>

        <div className="flex items-center space-x-1 pointer-events-auto">
          {/* Power toggle */}
          <button
            type="button"
            onClick={() => ipCameraService.setIpCameraEnabled(!isCameraEnabled)}
            className={`px-2 py-1 rounded-lg border text-[10px] font-black transition cursor-pointer shadow-sm flex items-center space-x-1 ${
              isCameraEnabled
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/80'
                : 'bg-slate-900/90 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title={isCameraEnabled ? 'Turn IP Camera OFF' : 'Turn IP Camera ON'}
          >
            <Power className="w-3 h-3" />
            <span>{isCameraEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {isCameraEnabled && (
            <button
              type="button"
              onClick={handleManualRetry}
              className="p-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shadow-sm"
              title="Reconnect video stream"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="px-2 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition cursor-pointer shadow-sm flex items-center space-x-1"
            title="Configure Phone IP Camera Stream URL & Presets"
          >
            <Settings className="w-3 h-3 text-amber-400" />
            <span className="hidden xs:inline">IP CONFIG</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-400 hover:text-white hover:bg-rose-950/80 transition cursor-pointer shadow-sm"
              title="Close Camera View"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Mixed Content / LAN Restriction Banner on HTTPS */}
      {isMixedContentRisk && !dismissMixedContentWarning && (
        <div className="absolute top-12 left-2 right-2 z-20 bg-amber-950/90 border border-amber-600/70 rounded-lg p-2 text-[10px] text-amber-200 flex items-start justify-between backdrop-blur-md shadow-lg">
          <div className="flex items-start space-x-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-300">HTTPS Security Notice:</span> Web browsers block raw local HTTP streams when loaded from an HTTPS domain. In IP Config, keep <strong>Zero-CORS Proxy</strong> enabled to stream safely.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissMixedContentWarning(true)}
            className="text-amber-400 hover:text-white ml-2 cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Video frame or Standby / Error Container */}
      <div className="relative flex-1 flex items-center justify-center min-h-[180px] bg-slate-950 overflow-hidden">
        {/* 1. Direct Drone Core Stream Display */}
        {isDroneLive && (
          <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden">
            <video
              ref={droneVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-contain select-none ${
                droneStream ? 'block' : 'hidden'
              }`}
            />
            {!droneStream && droneFrame && (
              <img
                src={droneFrame}
                alt="Drone Core Camera Live Stream"
                className="w-full h-full object-contain select-none"
              />
            )}
          </div>
        )}

        {/* 2. Phone IP Camera Live Feed */}
        {!isDroneLive && imgSrc && isCameraEnabled && (
          <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
            <img
              ref={imgRef}
              src={imgSrc}
              alt="IP Camera Live Feed"
              onLoad={handleImgLoad}
              onError={handleImgError}
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
                transition: 'transform 0.15s ease-out'
              }}
              className={`w-full h-full object-contain transition-opacity duration-200 ${
                videoState === 'LIVE' ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Tactical QR Bounding Box Overlay */}
            {detection && videoState === 'LIVE' && (
              <div
                className="absolute border-2 border-emerald-400 bg-emerald-500/20 rounded pointer-events-none z-20 animate-pulse shadow-[0_0_20px_rgba(52,211,153,0.9)] transition-all duration-100"
                style={{
                  left: `${Math.max(5, Math.min(85, (detection.boundingBox.x / 1280) * 100))}%`,
                  top: `${Math.max(5, Math.min(85, (detection.boundingBox.y / 720) * 100))}%`,
                  width: `${Math.max(15, Math.min(70, (detection.boundingBox.width / 1280) * 100))}%`,
                  height: `${Math.max(15, Math.min(70, (detection.boundingBox.height / 720) * 100))}%`
                }}
              >
                <div className="absolute -top-6 left-0 px-2 py-0.5 rounded bg-emerald-600 text-white font-mono text-[9px] font-black uppercase flex items-center gap-1 shadow-lg whitespace-nowrap">
                  <Target className="w-3 h-3 animate-spin" />
                  <span>
                    {detection.qrResult.isValidTwoDigit
                      ? `TARGET [${detection.qrResult.twoDigits}]`
                      : `QR [${detection.qrResult.text.slice(0, 10)}]`}
                  </span>
                </div>
              </div>
            )}

            {/* On-Screen Zoom Controls Overlay */}
            {videoState === 'LIVE' && (
              <div className="absolute top-10 right-2 z-20 bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-xl p-1 flex items-center gap-1 shadow-xl font-mono text-[10px] pointer-events-auto">
                <button
                  type="button"
                  onClick={() => ipCameraService.stepZoom(-0.2)}
                  title="Zoom Out (-0.2x)"
                  className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center justify-center cursor-pointer border border-slate-700 active:scale-95"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>

                {[1.0, 2.0, 3.0, 4.0].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => ipCameraService.setZoom(z)}
                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition text-[9px] ${
                      Math.abs(zoomLevel - z) < 0.15
                        ? 'bg-amber-600 text-white shadow'
                        : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                    }`}
                  >
                    {z.toFixed(0)}x
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => ipCameraService.stepZoom(0.2)}
                  title="Zoom In (+0.2x)"
                  className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center justify-center cursor-pointer border border-slate-700 active:scale-95"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>

                <div className="w-[1px] h-3.5 bg-slate-700 mx-0.5" />

                <button
                  type="button"
                  onClick={() => ipCameraService.setAutoZoomSweeping(!isAutoZoom)}
                  title={isAutoZoom ? 'Stop Auto-Zoom' : 'Auto-Zoom Sweep'}
                  className={`px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5 cursor-pointer transition text-[9px] ${
                    isAutoZoom
                      ? 'bg-emerald-600 text-white animate-pulse'
                      : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                  }`}
                >
                  <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                  <span>AUTO</span>
                </button>

                <button
                  type="button"
                  onClick={() => ipCameraService.triggerFocus()}
                  title="Trigger Remote Phone Focus"
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-sky-300 font-bold border border-slate-800 cursor-pointer text-[9px]"
                >
                  FOCUS
                </button>
              </div>
            )}
          </div>
        )}

        {/* 3. Camera OFF / Standby State */}
        {!isDroneLive && (!isCameraEnabled || videoState === 'OFF') && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10 font-mono">
            <div className="w-12 h-12 rounded-full border border-slate-800 bg-slate-900/80 flex items-center justify-center text-amber-400">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-200 font-extrabold text-xs uppercase tracking-wider">
                PHONE IP CAMERA STANDBY
              </div>
              <div className="text-slate-400 text-[10px] mt-0.5 max-w-[240px]">
                Turn on your phone IP camera stream to view live feed, zoom, and detect QR targets.
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => ipCameraService.setIpCameraEnabled(true)}
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center space-x-1.5 transition cursor-pointer shadow-md shadow-amber-950"
              >
                <Power className="w-3.5 h-3.5" />
                <span>Connect Phone Cam</span>
              </button>
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-bold uppercase cursor-pointer transition"
              >
                IP Config
              </button>
            </div>
          </div>
        )}

        {/* 4. Connecting State */}
        {!isDroneLive && isCameraEnabled && videoState === 'CONNECTING' && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10 font-mono">
            <div className="w-10 h-10 rounded-full border border-amber-500/40 bg-amber-950/40 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
            </div>
            <div>
              <div className="text-amber-300 font-extrabold text-xs uppercase">
                Connecting to Camera
              </div>
              <div className="text-slate-400 text-[10px] mt-0.5 max-w-[220px] truncate mx-auto">
                {streamUrl}
              </div>
              <div className="text-slate-500 text-[9px] mt-0.5">
                Attempt {retryCount + 1} of {MAX_AUTO_RETRIES}...
              </div>
            </div>
          </div>
        )}

        {/* 5. Disconnected State */}
        {!isDroneLive && isCameraEnabled && videoState === 'DISCONNECTED' && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10 max-w-xs font-mono">
            <div className="w-10 h-10 rounded-full border border-rose-500/40 bg-rose-950/40 flex items-center justify-center">
              <WifiOff className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <div className="text-rose-300 font-extrabold text-xs uppercase">
                Camera Feed Unavailable
              </div>
              <div className="text-slate-400 text-[10px] mt-0.5 max-w-[240px] truncate mx-auto">
                {streamUrl}
              </div>
              <div className="text-slate-500 text-[9px] mt-0.5">
                Verify phone app is running "Start server" and both devices are on the same Wi-Fi.
              </div>
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <button
                type="button"
                onClick={handleManualRetry}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-black uppercase flex items-center space-x-1 cursor-pointer transition border border-amber-500"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(true)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold uppercase cursor-pointer transition border border-slate-700"
              >
                Change IP
              </button>
              <button
                type="button"
                onClick={() => ipCameraService.setIpCameraEnabled(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-bold uppercase cursor-pointer transition border border-slate-800"
              >
                Turn Off
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom subtle label */}
      <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md px-2 py-0.5 rounded border border-slate-800 text-[9px] text-slate-400 flex items-center space-x-1">
          <Smartphone className="w-2.5 h-2.5 text-amber-400" />
          <span>PHONE IP CAM • SCANNER ACTIVE</span>
        </div>
        {videoState === 'LIVE' && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded text-emerald-300 text-[9px] font-black">
            ● LIVE STREAM
          </div>
        )}
      </div>

      {/* IP Camera Configuration Modal */}
      <IpCameraConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onConnected={() => {
          setVideoState('CONNECTING');
          setRetryCount(0);
        }}
      />
    </div>
  );
};

export default LiveVideoFeed;
