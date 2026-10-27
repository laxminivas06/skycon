import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Video,
  Scan,
  Maximize,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  Target,
  Eye,
  Navigation,
  ShieldAlert,
  Radio,
  WifiOff,
  Power
} from 'lucide-react';
import { decodeQRFromImageData } from '../../services/qrDecoderService';
import { Card } from '../../ui/Card';
import { audioService } from '../../services/audioService';
import { reconDetectionService } from '../../services/reconDetectionService';
import {
  droneCameraStreamService,
  DroneCameraStreamStatus
} from '../../services/droneCameraStreamService';
import {
  QRDetectionRecord,
  GCSVisualStatus,
  TargetLocation
} from '../../types/recon';
import { DashboardTelemetryData, useDashboardTelemetry } from '../../hooks/useDashboardTelemetry';

interface CameraFeedProps {
  className?: string;
  telemetry?: DashboardTelemetryData;
}

const getCardinal = (heading: number): string => {
  const norm = ((heading % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'N';
  if (norm >= 22.5 && norm < 67.5) return 'NE';
  if (norm >= 67.5 && norm < 112.5) return 'E';
  if (norm >= 112.5 && norm < 157.5) return 'SE';
  if (norm >= 157.5 && norm < 202.5) return 'S';
  if (norm >= 202.5 && norm < 247.5) return 'SW';
  if (norm >= 247.5 && norm < 292.5) return 'W';
  return 'NW';
};

export const CameraFeed: React.FC<CameraFeedProps> = ({ className = '', telemetry: propTelemetry }) => {
  const hookTelemetry = useDashboardTelemetry();
  const telemetry = propTelemetry || hookTelemetry;

  const [activeTab, setActiveTab] = useState<'STREAM' | 'DETECTIONS' | 'TARGET'>('STREAM');
  const [isScanning, setIsScanning] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  // Direct Drone Core Camera Stream State
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(() => droneCameraStreamService.getMediaStream());
  const [liveFrame, setLiveFrame] = useState<string | null>(() => droneCameraStreamService.getLatestFrame());
  const [streamStatus, setStreamStatus] = useState<DroneCameraStreamStatus>(() => droneCameraStreamService.getCurrentStatus());
  const [hasWebRtcVideo, setHasWebRtcVideo] = useState<boolean>(false);

  // AERORECON State & Intelligence
  const [visualStatus, setVisualStatus] = useState<GCSVisualStatus>(reconDetectionService.getVisualStatus());
  const [detections, setDetections] = useState<QRDetectionRecord[]>(reconDetectionService.getDetections());
  const [latestDetection, setLatestDetection] = useState<QRDetectionRecord | null>(reconDetectionService.getLatestDetection());
  const [activeTarget, setActiveTarget] = useState<TargetLocation | null>(reconDetectionService.getActiveTarget());
  const [targetDist, setTargetDist] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<QRDetectionRecord | null>(null);
  const [isApproaching, setIsApproaching] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const frameImgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3500);
  };

  // Subscribe to Drone Camera Stream Service (WebRTC + Direct Frames)
  useEffect(() => {
    droneCameraStreamService.startSubscribing();

    const unsubStream = droneCameraStreamService.subscribeStream((stream) => {
      setCameraStream(stream);
      setHasWebRtcVideo(Boolean(stream && stream.getVideoTracks().length > 0));
    });

    const unsubFrame = droneCameraStreamService.subscribeFrame((frame) => {
      setLiveFrame(frame);
    });

    const unsubStatus = droneCameraStreamService.subscribeStatus((st) => {
      setStreamStatus(st);
    });

    return () => {
      unsubStream();
      unsubFrame();
      unsubStatus();
    };
  }, []);

  // Synchronize remote MediaStream with video element
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video) {
      if (cameraStream) {
        if (video.srcObject !== cameraStream) {
          video.srcObject = cameraStream;
          video.play().catch(() => {});
        }
      } else {
        video.srcObject = null;
      }
    }
  }, [cameraStream]);

  // Subscribe to AERORECON Detection Service
  useEffect(() => {
    const unsubDetections = reconDetectionService.subscribeDetections((list, latest) => {
      setDetections(list);
      setLatestDetection(latest);
    });

    const unsubStatus = reconDetectionService.subscribeVisualStatus((status) => {
      setVisualStatus(status);
    });

    const unsubTarget = reconDetectionService.subscribeActiveTarget((target, dist, bearing) => {
      setActiveTarget(target);
      setTargetDist(dist);
      setTargetBearing(bearing);
    });

    return () => {
      unsubDetections();
      unsubStatus();
      unsubTarget();
    };
  }, []);

  // Continuous Full-Frame QR Detection Loop from Drone Core stream
  useEffect(() => {
    if (!isScanning || streamStatus !== 'LIVE_FEED_CONNECTED') return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let isProcessing = false;

    const scanFrame = async () => {
      if (isProcessing || !ctx) return;
      isProcessing = true;

      try {
        let source: CanvasImageSource | null = null;
        let w = 0;
        let h = 0;

        const video = remoteVideoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          source = video;
          w = video.videoWidth;
          h = video.videoHeight;
        } else if (frameImgRef.current && frameImgRef.current.complete && frameImgRef.current.naturalWidth > 0) {
          source = frameImgRef.current;
          w = frameImgRef.current.naturalWidth;
          h = frameImgRef.current.naturalHeight;
        }

        if (source && w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(source, 0, 0, w, h);

          const imageData = ctx.getImageData(0, 0, w, h);
          const qrRes = await decodeQRFromImageData(imageData);

          if (qrRes && qrRes.text) {
            const payload = qrRes.text.trim();
            const isDuplicate = reconDetectionService.isDuplicateDetection(payload);

            if (!isDuplicate) {
              const photoDataUrl = canvas.toDataURL('image/jpeg', 0.90);
              reconDetectionService.handleRawDetectionEvent({
                photoDataUrl,
                thumbnailDataUrl: photoDataUrl,
                rawImageData: imageData,
                initialPayload: payload
              });
            }
          }
        }
      } catch {
        // scan error ignored
      } finally {
        isProcessing = false;
      }
    };

    const interval = setInterval(scanFrame, 250); // 4 Hz scan rate
    return () => clearInterval(interval);
  }, [isScanning, streamStatus]);

  const handleApproachTarget = async (detectionId?: string) => {
    setIsApproaching(true);
    audioService.playBeep(980, 100);
    showNotification('Approaching confirmed target location in GUIDED mode...');
    try {
      const res = await reconDetectionService.requestTargetApproach(detectionId, 12.0, 2.5);
      showNotification(res.message);
    } catch (err: any) {
      showNotification(`Approach error: ${err?.message || 'Check link'}`);
    } finally {
      setIsApproaching(false);
    }
  };

  const handleRetryDecode = async (detectionId: string) => {
    showNotification('Retrying software contrast/binarization filters on saved photo...');
    audioService.playBeep(650, 60);
    const updated = await reconDetectionService.retryRecordDecode(detectionId);
    if (updated?.payload) {
      showNotification(`Decoded successfully: [${updated.payload}] ✓`);
      audioService.playBeep(1100, 120);
    } else {
      showNotification('Retry complete: QR code undecodable in this frame.');
    }
  };

  // Visual Status badge calculation
  const getStatusBadge = (status: GCSVisualStatus) => {
    switch (status) {
      case 'TARGET_LOCATION_CONFIRMED':
        return { label: 'TARGET LOCATION CONFIRMED', color: 'bg-emerald-600 text-white animate-pulse', icon: Target };
      case 'QR_DATA_EXTRACTED':
        return { label: 'QR DATA EXTRACTED', color: 'bg-emerald-500 text-white', icon: CheckCircle2 };
      case 'PHOTO_CAPTURED':
        return { label: 'PHOTO CAPTURED', color: 'bg-sky-600 text-white animate-pulse', icon: Camera };
      case 'PROCESSING_IMAGE':
        return { label: 'PROCESSING IMAGE', color: 'bg-amber-600 text-white animate-pulse', icon: RefreshCw };
      case 'QR_DETECTED':
        return { label: 'QR DETECTED', color: 'bg-amber-500 text-black animate-pulse', icon: Target };
      case 'GPS_UNAVAILABLE':
        return { label: 'GPS UNAVAILABLE', color: 'bg-rose-600 text-white animate-pulse', icon: AlertCircle };
      case 'COMMUNICATION_LOST':
        return { label: 'COMMUNICATION LOST', color: 'bg-red-700 text-white animate-pulse', icon: ShieldAlert };
      case 'CAMERA_CONNECTED':
        return { label: 'CAMERA CONNECTED', color: 'bg-slate-800 text-emerald-400', icon: Camera };
      case 'SEARCHING_FOR_QR':
      default:
        return { label: 'SEARCHING FOR QR', color: 'bg-slate-800 text-sky-400', icon: Scan };
    }
  };

  // Drone Core Camera Status Mapping
  const getStreamStatusConfig = (st: DroneCameraStreamStatus) => {
    switch (st) {
      case 'LIVE_FEED_CONNECTED':
        return {
          label: 'Live Feed Connected',
          badgeClass: 'bg-emerald-600 text-white shadow-emerald-950/60',
          pulse: true,
          dotClass: 'bg-emerald-300 animate-pulse',
          icon: Video,
          description: 'Live video feed received directly from Drone Core camera.'
        };
      case 'CONNECTING':
        return {
          label: 'Connecting to Drone Core',
          badgeClass: 'bg-amber-600 text-white shadow-amber-950/60',
          pulse: true,
          dotClass: 'bg-amber-300 animate-spin',
          icon: RefreshCw,
          description: 'Drone Core camera detected. Establishing direct high-speed live feed...'
        };
      case 'CAMERA_OFFLINE':
        return {
          label: 'Camera Offline',
          badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700',
          pulse: false,
          dotClass: 'bg-slate-500',
          icon: WifiOff,
          description: 'Drone Core camera is currently turned OFF. Turn on the camera on Drone Core to resume feed.'
        };
      case 'CONNECTION_LOST':
        return {
          label: 'Connection Lost',
          badgeClass: 'bg-rose-700 text-white shadow-rose-950/60',
          pulse: true,
          dotClass: 'bg-rose-400 animate-pulse',
          icon: WifiOff,
          description: 'Live camera heartbeat lost. Reconnecting to Drone Core...'
        };
      case 'WAITING_FOR_CAMERA':
      default:
        return {
          label: 'Waiting for Drone Core Camera',
          badgeClass: 'bg-[#161B22] text-sky-400 border border-sky-500/30',
          pulse: false,
          dotClass: 'bg-sky-400 animate-pulse',
          icon: Camera,
          description: 'Awaiting Drone Core camera activation. Ensure onboard camera is running.'
        };
    }
  };

  const statusBadge = getStatusBadge(visualStatus);
  const StatusIcon = statusBadge.icon;
  const streamStatusConfig = getStreamStatusConfig(streamStatus);
  const StreamStatusIcon = streamStatusConfig.icon;

  const isFeedActive = (hasWebRtcVideo || Boolean(liveFrame)) || streamStatus === 'LIVE_FEED_CONNECTED';

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  return (
    <Card
      title="DRONE & OPTICAL INTELLIGENCE"
      action={
        <div className="flex items-center gap-1.5 relative flex-wrap justify-end">
          {/* Drone Core Camera Status Pill */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] text-[10px] font-mono font-bold transition shadow-sm ${streamStatusConfig.badgeClass}`}
            title={`Drone Core Camera: ${streamStatusConfig.label}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${streamStatusConfig.dotClass}`} />
            <span className="hidden sm:inline">{streamStatusConfig.label}</span>
          </div>

          {/* Tab Navigation: STREAM | ARCHIVE ({n}) | TARGET */}
          <div className="flex items-center bg-[#161B22] p-0.5 rounded-[6px] border border-[var(--uav-card-border)] text-[10px] font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('STREAM')}
              className={`px-2 py-0.5 rounded-[4px] font-bold transition cursor-pointer ${
                activeTab === 'STREAM' ? 'bg-[#10B981] text-black font-extrabold' : 'text-slate-400 hover:text-white'
              }`}
            >
              STREAM
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DETECTIONS')}
              className={`px-2 py-0.5 rounded-[4px] font-bold transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'DETECTIONS' ? 'bg-[#10B981] text-black font-extrabold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>ARCHIVE</span>
              {detections.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-sky-500 text-white text-[9px] flex items-center justify-center">
                  {detections.length}
                </span>
              )}
            </button>
            {activeTarget && (
              <button
                type="button"
                onClick={() => setActiveTab('TARGET')}
                className={`px-2 py-0.5 rounded-[4px] font-bold transition cursor-pointer flex items-center gap-1 ${
                  activeTab === 'TARGET' ? 'bg-[#10B981] text-black font-extrabold' : 'text-emerald-400 hover:text-white'
                }`}
              >
                <span>TARGET</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </button>
            )}
          </div>
        </div>
      }
      className={`h-[358px] shrink-0 select-none ${className}`}
      contentClassName="p-2 flex flex-col justify-between relative overflow-hidden"
    >
      {/* Action Notice Banner */}
      {actionNotice && (
        <div className="absolute top-3 inset-x-4 z-40 bg-[#161B22]/95 border border-sky-400 text-white px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-2 text-[11px] font-mono animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="truncate">{actionNotice}</span>
        </div>
      )}

      {/* VIEWPORT AREA: STREAM TAB */}
      {activeTab === 'STREAM' && (
        <div
          ref={containerRef}
          className="flex-1 rounded-[8px] border border-[var(--uav-card-border)] bg-black overflow-hidden relative flex items-center justify-center min-h-0"
        >
          {isFeedActive ? (
            <div className="w-full h-full relative flex items-center justify-center bg-black overflow-hidden">
              {/* WebRTC Video Stream Element */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain select-none ${
                  hasWebRtcVideo ? 'block' : 'hidden'
                }`}
              />

              {/* High-Speed Frame Fallback Element */}
              {!hasWebRtcVideo && liveFrame && (
                <img
                  ref={frameImgRef}
                  src={liveFrame}
                  alt="Drone Core Camera Live Stream"
                  className="w-full h-full object-contain select-none"
                />
              )}

              {/* Tactical UAV HUD Telemetry Overlay */}
              <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-2 select-none">
                {/* Top OSD Bar */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1.5 pointer-events-auto">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-600/90 backdrop-blur-sm text-white font-mono font-bold text-[10px] tracking-wider uppercase shadow">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      <span>DRONE CORE CAM</span>
                    </div>
                    <div className="px-2 py-0.5 rounded bg-black/60 border border-slate-700 text-sky-300 font-mono font-bold text-[10px]">
                      {hasWebRtcVideo ? 'WEBRTC 30FPS' : 'LIVE FRAME RELAY'}
                    </div>
                  </div>

                  {/* Flight Telemetry Readout */}
                  <div className="bg-[#070D18]/85 backdrop-blur-sm border border-sky-500/40 rounded px-2.5 py-1 flex items-center gap-2.5 font-mono text-[10.5px] text-white shadow-lg pointer-events-auto">
                    <div className="flex items-center gap-1">
                      <span className="text-sky-400 font-bold">ALT</span>
                      <span className="font-bold">{(telemetry.altitudeMeters || 12.0).toFixed(1)}m</span>
                    </div>
                    <div className="w-[1px] h-3 bg-slate-700" />
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400 font-bold">HDG</span>
                      <span className="font-bold">
                        {(telemetry.headingDeg || 0).toString().padStart(3, '0')}°
                        <span className="text-slate-300 ml-0.5 text-[9.5px] font-semibold">{getCardinal(telemetry.headingDeg || 0)}</span>
                      </span>
                    </div>
                    <div className="w-[1px] h-3 bg-slate-700" />
                    <div className="flex items-center gap-1">
                      <span className="text-emerald-400 font-bold">G-SPD</span>
                      <span className="font-bold">{(telemetry.speedMs || 0).toFixed(1)}m/s</span>
                    </div>
                  </div>
                </div>

                {/* Center Tactical Crosshair */}
                <div className="flex-1 flex items-center justify-center relative pointer-events-none">
                  <div className="relative w-16 h-16 flex items-center justify-center opacity-40">
                    <div className="w-4 h-[1px] bg-emerald-400 absolute left-0" />
                    <div className="w-4 h-[1px] bg-emerald-400 absolute right-0" />
                    <div className="h-4 w-[1px] bg-emerald-400 absolute top-0" />
                    <div className="h-4 w-[1px] bg-emerald-400 absolute bottom-0" />
                    <div className="w-1.5 h-1.5 border border-emerald-400 rounded-full" />
                  </div>

                  {/* Wide Detection Bounding Box Marker */}
                  {isScanning && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-44 h-44 border border-emerald-400/40 rounded-lg flex items-center justify-center relative">
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-300 bg-black/80 px-2 py-0.5 rounded border border-slate-700 whitespace-nowrap">
                          {latestDetection
                            ? `LAST: ${latestDetection.detectionId} [${latestDetection.status}]`
                            : 'SEARCHING FULL FRAME (10–15m AGL)'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom OSD Bar: Mode, Battery, Latest Detection Preview */}
                <div className="flex items-center justify-between text-[9px] font-mono bg-[#0D1117]/85 backdrop-blur-sm border border-slate-800/80 rounded px-2.5 py-1 text-slate-300 pointer-events-auto">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 font-bold">{telemetry.flightMode}</span>
                    <span>•</span>
                    <span>BAT {telemetry.batteryPercent}% ({(telemetry.batteryVoltage || 0).toFixed(1)}V)</span>
                    <span>•</span>
                    <span>GPS: {telemetry.isGpsValid ? `${telemetry.satellites} Sats` : 'UNAVAILABLE'}</span>
                  </div>

                  {latestDetection && (
                    <button
                      type="button"
                      onClick={() => setSelectedPhoto(latestDetection)}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/80 hover:bg-sky-900 border border-sky-500/40 text-sky-300 cursor-pointer transition"
                    >
                      <Eye className="w-3 h-3" />
                      <span>LATEST PHOTO</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Waiting Screen with Direct Prompt to Reconnect Drone Cam */
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#070D18] text-center p-6 select-none font-mono">
              <div className="w-12 h-12 rounded-xl bg-[#0D1524] border border-slate-800 flex items-center justify-center mb-2.5 shadow-xl">
                <StreamStatusIcon className={`w-6 h-6 ${streamStatusConfig.pulse ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
              </div>

              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${streamStatusConfig.dotClass}`} />
                <span className="text-white text-[12px] font-mono font-bold tracking-wide">
                  {streamStatusConfig.label}
                </span>
              </div>

              <p className="text-slate-400 text-[10.5px] font-mono max-w-sm leading-relaxed mb-3">
                {streamStatusConfig.description}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => droneCameraStreamService.reconnect()}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-md shadow-sky-950 transition active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconnect Camera</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEWPORT AREA: DETECTIONS ARCHIVE TAB */}
      {activeTab === 'DETECTIONS' && (
        <div className="flex-1 rounded-[8px] border border-[var(--uav-card-border)] bg-[#0D1117] p-2 flex flex-col gap-2 overflow-y-auto">
          <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-300 border-b border-slate-800 pb-1">
            <span>CAPTURED RECON PHOTOS ({detections.length})</span>
            {detections.length > 0 && (
              <button
                type="button"
                onClick={() => reconDetectionService.clearAllDetections()}
                className="text-[10px] text-slate-500 hover:text-red-400 cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          {detections.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-[11px] font-mono p-4 text-center">
              <Camera className="w-6 h-6 mb-1 text-slate-600" />
              <span>No QR detections captured yet. Monitoring search area for QR codes.</span>
            </div>
          ) : (
            detections.map((rec) => (
              <div
                key={rec.detectionId}
                className="bg-[#11161D] border border-slate-800 hover:border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2 text-[10.5px] font-mono transition"
              >
                {/* Photo Thumbnail */}
                <div
                  onClick={() => setSelectedPhoto(rec)}
                  className="w-12 h-10 rounded overflow-hidden bg-black border border-slate-700 shrink-0 cursor-pointer hover:border-sky-400 transition relative group"
                >
                  {rec.photoDataUrl ? (
                    <img src={rec.thumbnailDataUrl || rec.photoDataUrl} alt={rec.detectionId} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                      <Camera className="w-3 h-3" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <Eye className="w-3 h-3 text-white" />
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white truncate">{rec.detectionId}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                        rec.status === 'TARGET_LOCATION_CONFIRMED'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : rec.status === 'QR_DECODED'
                          ? 'bg-sky-950 text-sky-300 border border-sky-500/40'
                          : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {rec.status}
                    </span>
                  </div>
                  <div className="text-slate-400 truncate text-[9.5px]">
                    {rec.payload ? `Payload: "${rec.payload}"` : 'QR Detected — Data Pending'}
                  </div>
                  <div className="text-[9px] text-slate-500">
                    Pixhawk GPS: {rec.gpsFixValid ? `${rec.droneLatitude.toFixed(4)}, ${rec.droneLongitude.toFixed(4)}` : 'UNAVAILABLE'}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {rec.status === 'DECODE_FAILED' && (
                    <button
                      type="button"
                      onClick={() => handleRetryDecode(rec.detectionId)}
                      className="p-1 rounded bg-[#21262D] hover:bg-slate-700 text-amber-300 cursor-pointer"
                      title="Retry decoding saved image"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                  {rec.isTargetLocationConfirmed && (
                    <button
                      type="button"
                      onClick={() => handleApproachTarget(rec.detectionId)}
                      className="p-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      title="Approach Target"
                    >
                      <Navigation className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedPhoto(rec)}
                    className="p-1 rounded bg-[#21262D] hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                    title="Inspect Photo & Telemetry"
                  >
                    <Eye className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEWPORT AREA: TARGET INTEL TAB */}
      {activeTab === 'TARGET' && activeTarget && (
        <div className="flex-1 rounded-[8px] border border-emerald-500/40 bg-[#0D1117] p-3 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-emerald-400 border-b border-emerald-500/30 pb-1.5">
              <div className="flex items-center gap-1.5">
                <Target className="w-4 h-4 animate-pulse" />
                <span className="font-orbitron font-bold text-[12px] text-white">CONFIRMED GROUND TARGET (CASE A)</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-400 text-emerald-300 font-bold">
                {targetDist !== null ? `${targetDist}m AWAY` : 'DISTANCE PENDING'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-black/40 p-2.5 rounded border border-slate-800">
              <div>
                <span className="text-slate-400 block text-[9.5px]">TARGET LATITUDE</span>
                <span className="text-white font-bold">{activeTarget.latitude.toFixed(6)}°</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">TARGET LONGITUDE</span>
                <span className="text-white font-bold">{activeTarget.longitude.toFixed(6)}°</span>
              </div>
              {targetBearing !== null && (
                <div>
                  <span className="text-slate-400 block text-[9.5px]">BEARING FROM DRONE</span>
                  <span className="text-amber-300 font-bold">{targetBearing}°</span>
                </div>
              )}
              {activeTarget.altitude !== undefined && (
                <div>
                  <span className="text-slate-400 block text-[9.5px]">TARGET ALTITUDE</span>
                  <span className="text-sky-300 font-bold">{activeTarget.altitude}m</span>
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
              Target GPS verified from QR payload. Mission controller movement request uses Pixhawk GUIDED mode (MAV_CMD_DO_REPOSITION) maintaining safe 10–15m altitude.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => handleApproachTarget()}
              disabled={isApproaching}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11.5px] font-bold rounded flex items-center gap-2 cursor-pointer shadow transition active:scale-95"
            >
              <Navigation className="w-4 h-4" />
              <span>{isApproaching ? 'Approaching...' : 'Navigate Toward Target'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Tool Row */}
      <div className="flex items-center justify-between pt-2 px-6">
        <button
          type="button"
          onClick={() => {
            if (latestDetection) setSelectedPhoto(latestDetection);
            else showNotification('No photo captured yet');
          }}
          title="Inspect Latest Captured Photo"
          aria-label="Inspect Photo"
          className="p-1 text-[var(--uav-muted)] hover:text-white transition cursor-pointer active:scale-90"
        >
          <Camera className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsRecording(!isRecording)}
          title={isRecording ? 'Stop Recording' : 'Start Recording Stream'}
          aria-label="Record Video"
          className={`p-1 transition cursor-pointer active:scale-90 ${
            isRecording ? 'text-red-500 animate-pulse' : 'text-[var(--uav-muted)] hover:text-white'
          }`}
        >
          <Video className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsScanning(!isScanning)}
          title={isScanning ? 'Disable QR Target Scanner' : 'Enable QR Target Scanner'}
          aria-label="Target Scan"
          className={`p-1 transition cursor-pointer active:scale-90 ${
            isScanning ? 'text-emerald-400' : 'text-[var(--uav-muted)] hover:text-white'
          }`}
        >
          <Scan className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleFullscreen}
          title="Toggle Fullscreen Video"
          aria-label="Fullscreen Video"
          className="p-1 text-[var(--uav-muted)] hover:text-white transition cursor-pointer active:scale-90"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>

      {/* Full-Screen Original Photo Inspection Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-slate-700 rounded-xl max-w-2xl w-full p-4 text-white shadow-2xl space-y-3 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-sky-400" />
                <h3 className="font-orbitron font-bold text-[13px] text-white">ORIGINAL CAPTURED PHOTO &amp; TELEMETRY</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPhoto(null)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-[#21262D] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-[200px] max-h-[340px] bg-black rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center relative">
              {selectedPhoto.photoDataUrl ? (
                <img src={selectedPhoto.photoDataUrl} alt={selectedPhoto.detectionId} className="w-full h-full object-contain" />
              ) : (
                <div className="text-slate-500 font-mono text-[11px]">Original image data unavailable</div>
              )}
              <div className="absolute top-2 left-2 bg-black/75 px-2 py-0.5 rounded text-[10px] font-mono text-emerald-400 border border-slate-800">
                ORIGINAL RESOLUTION (NO ZOOM)
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] font-mono bg-[#11161D] p-2 rounded-lg border border-slate-800">
              <div>
                <span className="text-slate-400 block text-[9px]">DETECTION ID</span>
                <span className="text-white font-bold">{selectedPhoto.detectionId}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">STATUS</span>
                <span className="text-emerald-400 font-bold">{selectedPhoto.status}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">PIXHAWK LATITUDE</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixValid ? `${selectedPhoto.droneLatitude.toFixed(6)}°` : 'UNAVAILABLE'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">PIXHAWK LONGITUDE</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixValid ? `${selectedPhoto.droneLongitude.toFixed(6)}°` : 'UNAVAILABLE'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">ALTITUDE (AGL)</span>
                <span className="text-sky-300 font-bold">{selectedPhoto.droneAltitudeAgl.toFixed(1)}m</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px]">GPS FIX</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixType} ({selectedPhoto.satellites} Sats)
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block text-[9px]">DECODED PAYLOAD</span>
                <span className="text-emerald-300 font-bold break-all">{selectedPhoto.payload || 'Data Pending (Undecoded)'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400 font-mono truncate max-w-sm">{selectedPhoto.notes}</span>
              <div className="flex items-center gap-2">
                {selectedPhoto.status === 'DECODE_FAILED' && (
                  <button
                    type="button"
                    onClick={() => handleRetryDecode(selectedPhoto.detectionId)}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-black font-bold text-[11px] font-mono rounded cursor-pointer"
                  >
                    Retry Filters
                  </button>
                )}
                {selectedPhoto.isTargetLocationConfirmed && (
                  <button
                    type="button"
                    onClick={() => {
                      handleApproachTarget(selectedPhoto.detectionId);
                      setSelectedPhoto(null);
                    }}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] font-mono rounded flex items-center gap-1.5 cursor-pointer"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Approach Target</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPhoto(null)}
                  className="px-3 py-1 bg-[#21262D] hover:bg-slate-700 text-slate-300 text-[11px] font-mono rounded cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </Card>
  );
};

export default CameraFeed;
