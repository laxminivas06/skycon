import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, WifiOff, RefreshCw, Radio, Settings, X, Power, AlertTriangle, ShieldAlert } from 'lucide-react';
import { ipCameraService, IpCameraStatus } from '../../services/ipCameraService';
import { droneCameraStreamService, DroneCameraStreamStatus } from '../../services/droneCameraStreamService';

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
  const [editingUrl, setEditingUrl] = useState(false);
  const [editValue, setEditValue] = useState(streamUrl);
  const [videoState, setVideoState] = useState<IpCameraStatus>(() => 
    ipCameraService.isIpCameraEnabled() ? 'CONNECTING' : 'OFF'
  );
  const [retryCount, setRetryCount] = useState(0);
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
      setEditValue(url);
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

    return () => {
      clearRetryTimer();
      unsubUrl();
      unsubToggle();
      unsubStatus();
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

  // Only request image if camera is explicitly turned ON
  const imgSrc = isCameraEnabled && streamUrl
    ? `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}_t=${retryCount}`
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

  const handleSaveUrl = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      ipCameraService.setStreamUrl(trimmed);
      setStreamUrl(trimmed);
      setRetryCount(0);
      if (isCameraEnabled) {
        setVideoState('CONNECTING');
        ipCameraService.setStatus('CONNECTING');
      }
    }
    setEditingUrl(false);
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
      ? 'CAMERA: LIVE'
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
          {videoState === 'LIVE' ? (
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
            onClick={() => {
              setEditValue(streamUrl);
              setEditingUrl(true);
            }}
            className="px-2 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition cursor-pointer shadow-sm flex items-center space-x-1"
            title="Configure IP Camera Stream URL"
          >
            <Settings className="w-3 h-3" />
            <span className="hidden xs:inline">URL</span>
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
              <span className="font-bold text-amber-300">HTTPS Security Notice:</span> Web browsers block raw local HTTP streams (<code className="bg-amber-900/60 px-1 py-0.5 rounded text-[9px]">http://192.168.x.x</code>) when loaded from an HTTPS cloud domain. For direct local video: open Ground Station on <code className="bg-amber-900/60 px-1 py-0.5 rounded text-[9px]">http://localhost:5173</code>, use the Android APK, or configure an HTTPS/WSS proxy.
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

      {/* URL editor overlay */}
      {editingUrl && (
        <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 space-y-3">
          <div className="text-xs font-bold text-slate-200 uppercase tracking-wide">
            IP Camera Stream URL
          </div>
          <div className="text-[10px] text-slate-400 text-center max-w-sm">
            Enter IP camera stream URL (HTTP / MJPEG from phone IP Webcam or ESP32-CAM):
            <br />
            <span className="text-sky-300 font-mono text-[10px]">http://192.168.31.194:8080/video</span>
          </div>
          <input
            autoFocus
            type="url"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveUrl();
              if (e.key === 'Escape') setEditingUrl(false);
            }}
            className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
            placeholder="http://192.168.31.194:8080/video"
          />
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={handleSaveUrl}
              className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase cursor-pointer transition"
            >
              SAVE & CONNECT
            </button>
            <button
              type="button"
              onClick={() => setEditingUrl(false)}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-black uppercase cursor-pointer transition"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Video frame or Standby / Error Container */}
      <div className="relative flex-1 flex items-center justify-center min-h-[180px] bg-slate-950 overflow-hidden">
        {/* Direct Drone Core Stream Display */}
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

        {!isDroneLive && imgSrc && isCameraEnabled && (
          <img
            ref={imgRef}
            src={imgSrc}
            alt="IP Camera Live Feed"
            onLoad={handleImgLoad}
            onError={handleImgError}
            className={`w-full h-full object-contain sm:object-cover transition-opacity duration-200 ${
              videoState === 'LIVE' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* 1. Camera OFF / Standby State */}
        {!isDroneLive && (!isCameraEnabled || videoState === 'OFF') && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10">
            <div className="w-12 h-12 rounded-full border border-slate-800 bg-slate-900/80 flex items-center justify-center text-slate-500">
              <Video className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-300 font-extrabold text-xs uppercase tracking-wider">
                Optical Feed Standby
              </div>
              <div className="text-slate-500 text-[10px] mt-0.5 max-w-[240px]">
                IP Camera is turned OFF. Click below to start optical stream.
              </div>
            </div>
            <button
              type="button"
              onClick={() => ipCameraService.setIpCameraEnabled(true)}
              className="mt-1 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center space-x-1.5 transition cursor-pointer shadow-md shadow-sky-950"
            >
              <Power className="w-3.5 h-3.5" />
              <span>Enable Camera Feed</span>
            </button>
          </div>
        )}

        {/* 2. Connecting State */}
        {!isDroneLive && isCameraEnabled && videoState === 'CONNECTING' && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10">
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

        {/* 3. Disconnected State (Auto-retries exhausted or connection failed) */}
        {!isDroneLive && isCameraEnabled && videoState === 'DISCONNECTED' && (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10 max-w-xs">
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
              {isMixedContentRisk ? (
                <div className="text-amber-400/90 text-[9px] mt-1 bg-amber-950/40 border border-amber-800/40 rounded p-1">
                  HTTPS blocks insecure LAN HTTP video. Run app locally on HTTP or use native Android build.
                </div>
              ) : (
                <div className="text-slate-500 text-[9px] mt-0.5">
                  Check camera power, Wi-Fi IP address, and port 8080.
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <button
                type="button"
                onClick={handleManualRetry}
                className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-[10px] font-black uppercase flex items-center space-x-1 cursor-pointer transition border border-sky-500"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditValue(streamUrl);
                  setEditingUrl(true);
                }}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold uppercase cursor-pointer transition border border-slate-700"
              >
                Change URL
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
          <Video className="w-2.5 h-2.5 text-sky-400" />
          <span>IP CAMERA STREAM</span>
        </div>
        {videoState === 'LIVE' && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded text-emerald-300 text-[9px] font-black">
            ● LIVE STREAM
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveVideoFeed;
