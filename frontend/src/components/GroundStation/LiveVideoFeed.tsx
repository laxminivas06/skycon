import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  WifiOff,
  RefreshCw,
  Radio,
  X
} from 'lucide-react';
import {
  droneCameraStreamService,
  DroneCameraStreamStatus
} from '../../services/droneCameraStreamService';

interface LiveVideoFeedProps {
  className?: string;
  large?: boolean;
  onClose?: () => void;
}

export const LiveVideoFeed: React.FC<LiveVideoFeedProps> = ({
  className = '',
  large = false,
  onClose
}) => {
  const droneVideoRef = useRef<HTMLVideoElement | null>(null);

  // Drone Core direct stream state
  const [droneStream, setDroneStream] = useState<MediaStream | null>(() => droneCameraStreamService.getMediaStream());
  const [droneFrame, setDroneFrame] = useState<string | null>(() => droneCameraStreamService.getLatestFrame());
  const [droneStreamStatus, setDroneStreamStatus] = useState<DroneCameraStreamStatus>(() => droneCameraStreamService.getCurrentStatus());

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

  const isDroneLive = droneStreamStatus === 'LIVE_FEED_CONNECTED' && Boolean(droneStream || droneFrame);

  const getStatusBadge = () => {
    switch (droneStreamStatus) {
      case 'LIVE_FEED_CONNECTED':
        return {
          label: 'DRONE CORE: LIVE STREAM',
          color: 'text-emerald-400 border-emerald-500/60 bg-emerald-950/80 shadow-emerald-950/60',
          icon: Radio
        };
      case 'CONNECTING':
        return {
          label: 'CONNECTING TO DRONE CORE...',
          color: 'text-amber-400 border-amber-500/60 bg-amber-950/80 animate-pulse',
          icon: RefreshCw
        };
      case 'CAMERA_OFFLINE':
        return {
          label: 'DRONE CAMERA OFFLINE',
          color: 'text-slate-400 border-slate-700 bg-slate-900/90',
          icon: WifiOff
        };
      case 'CONNECTION_LOST':
        return {
          label: 'DRONE STREAM LOST',
          color: 'text-rose-400 border-rose-500/60 bg-rose-950/80',
          icon: WifiOff
        };
      case 'WAITING_FOR_CAMERA':
      default:
        return {
          label: 'WAITING FOR DRONE CAMERA',
          color: 'text-sky-400 border-sky-500/40 bg-slate-900/90',
          icon: Video
        };
    }
  };

  const statusConfig = getStatusBadge();
  const StatusIcon = statusConfig.icon;

  return (
    <div
      className={`relative bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex flex-col font-mono select-none ${className}`}
    >
      {/* Header overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
        <div
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[10px] sm:text-[11px] font-black backdrop-blur-md shadow-md ${statusConfig.color}`}
        >
          <StatusIcon className={`w-3 h-3 ${droneStreamStatus === 'LIVE_FEED_CONNECTED' ? 'animate-pulse' : droneStreamStatus === 'CONNECTING' ? 'animate-spin' : ''}`} />
          <span>{statusConfig.label}</span>
        </div>

        <div className="flex items-center space-x-1 pointer-events-auto">
          <button
            type="button"
            onClick={() => droneCameraStreamService.reconnect()}
            className="p-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shadow-sm"
            title="Reconnect video stream"
          >
            <RefreshCw className="w-3 h-3" />
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

      {/* Video Viewport Area */}
      <div className="relative flex-1 flex items-center justify-center min-h-[180px] bg-slate-950 overflow-hidden">
        {isDroneLive ? (
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
        ) : (
          <div className="flex flex-col items-center justify-center space-y-2 p-4 text-center z-10 font-mono">
            <div className="w-12 h-12 rounded-xl border border-slate-800 bg-[#0D1524] flex items-center justify-center text-sky-400 shadow-xl">
              <Video className="w-6 h-6" />
            </div>
            <div>
              <div className="text-slate-200 font-extrabold text-xs uppercase tracking-wider">
                {statusConfig.label}
              </div>
              <div className="text-slate-400 text-[10px] mt-0.5 max-w-[240px]">
                Direct feed from Drone Core optical sensor. Connect drone or start onboard camera.
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => droneCameraStreamService.reconnect()}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center space-x-1.5 transition cursor-pointer shadow-md shadow-sky-950"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reconnect Feed</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom subtle indicator */}
      <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur-md px-2 py-0.5 rounded border border-slate-800 text-[9px] text-slate-400 flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
          <span>DRONE ONBOARD CAMERA</span>
        </div>
        {isDroneLive && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded text-emerald-300 text-[9px] font-black">
            ● LIVE STREAM
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveVideoFeed;
