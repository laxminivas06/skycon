import React, { useState, useEffect } from 'react';
import {
  Camera,
  Target,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Navigation,
  Eye,
  MapPin,
  Clock,
  Layers,
  X,
  Maximize2,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  RotateCcw
} from 'lucide-react';
import {
  QRDetectionRecord,
  GCSVisualStatus,
  QRProcessingState,
  TargetLocation
} from '../../types/recon';
import { reconDetectionService } from '../../services/reconDetectionService';
import { audioService } from '../../services/audioService';

interface ReconDetectionPanelProps {
  onApproachTarget?: (detectionId: string) => void;
  className?: string;
}

export const ReconDetectionPanel: React.FC<ReconDetectionPanelProps> = ({
  onApproachTarget,
  className = ''
}) => {
  const [detections, setDetections] = useState<QRDetectionRecord[]>(reconDetectionService.getDetections());
  const [latestDetection, setLatestDetection] = useState<QRDetectionRecord | null>(reconDetectionService.getLatestDetection());
  const [visualStatus, setVisualStatus] = useState<GCSVisualStatus>(reconDetectionService.getVisualStatus());
  const [activeTarget, setActiveTarget] = useState<TargetLocation | null>(reconDetectionService.getActiveTarget());
  const [targetDistance, setTargetDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);

  const [selectedPhoto, setSelectedPhoto] = useState<QRDetectionRecord | null>(null);
  const [isApproaching, setIsApproaching] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

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
      setTargetDistance(dist);
      setTargetBearing(bearing);
    });

    return () => {
      unsubDetections();
      unsubStatus();
      unsubTarget();
    };
  }, []);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3500);
  };

  const handleApproachTarget = async (detectionId?: string) => {
    setIsApproaching(true);
    audioService.playBeep(980, 100);
    showNotification('Validating target location & initiating controlled approach...');
    try {
      const res = await reconDetectionService.requestTargetApproach(detectionId, 12.0, 2.5);
      showNotification(res.message);
      if (res.success && onApproachTarget && detectionId) {
        onApproachTarget(detectionId);
      }
    } catch (err: any) {
      showNotification(`Approach error: ${err?.message || 'Check MAVLink link'}`);
    } finally {
      setIsApproaching(false);
    }
  };

  const handleRetryDecode = async (detectionId: string) => {
    showNotification('Applying secondary image processing filters to saved photo...');
    audioService.playBeep(650, 60);
    const updated = await reconDetectionService.retryRecordDecode(detectionId);
    if (updated?.payload) {
      showNotification(`Decoded successfully: [${updated.payload}] ✓`);
      audioService.playBeep(1100, 120);
    } else {
      showNotification('Retry filter passed: QR data still undetectable in saved frame.');
    }
  };

  const getStatusBadge = (status: GCSVisualStatus) => {
    switch (status) {
      case 'TARGET_LOCATION_CONFIRMED':
        return {
          label: 'TARGET LOCATION CONFIRMED',
          bg: 'bg-emerald-600',
          border: 'border-emerald-400',
          text: 'text-white',
          pulse: true,
          icon: Target
        };
      case 'QR_DATA_EXTRACTED':
        return {
          label: 'QR DATA EXTRACTED',
          bg: 'bg-emerald-500/90',
          border: 'border-emerald-300',
          text: 'text-white',
          pulse: false,
          icon: CheckCircle2
        };
      case 'PHOTO_CAPTURED':
        return {
          label: 'PHOTO CAPTURED',
          bg: 'bg-sky-600',
          border: 'border-sky-400',
          text: 'text-white',
          pulse: true,
          icon: Camera
        };
      case 'PROCESSING_IMAGE':
        return {
          label: 'PROCESSING IMAGE',
          bg: 'bg-amber-600',
          border: 'border-amber-400',
          text: 'text-white',
          pulse: true,
          icon: RefreshCw
        };
      case 'QR_DETECTED':
        return {
          label: 'QR DETECTED',
          bg: 'bg-amber-500',
          border: 'border-amber-300',
          text: 'text-black',
          pulse: true,
          icon: Target
        };
      case 'GPS_UNAVAILABLE':
        return {
          label: 'GPS UNAVAILABLE',
          bg: 'bg-rose-600',
          border: 'border-rose-400',
          text: 'text-white',
          pulse: true,
          icon: AlertTriangle
        };
      case 'COMMUNICATION_LOST':
        return {
          label: 'COMMUNICATION LOST',
          bg: 'bg-red-700',
          border: 'border-red-500',
          text: 'text-white',
          pulse: true,
          icon: ShieldAlert
        };
      case 'CAMERA_CONNECTED':
        return {
          label: 'CAMERA CONNECTED',
          bg: 'bg-slate-800',
          border: 'border-slate-700',
          text: 'text-emerald-400',
          pulse: false,
          icon: Camera
        };
      case 'SEARCHING_FOR_QR':
      default:
        return {
          label: 'SEARCHING FOR QR',
          bg: 'bg-slate-800/90',
          border: 'border-sky-500/40',
          text: 'text-sky-300',
          pulse: false,
          icon: Camera
        };
    }
  };

  const badge = getStatusBadge(visualStatus);
  const BadgeIcon = badge.icon;

  return (
    <div className={`flex flex-col gap-2 font-sans select-none ${className}`}>
      {/* 1. Official GCS Visual Status Indicator Banner */}
      <div
        className={`w-full px-3 py-1.5 rounded-lg border flex items-center justify-between shadow-md transition-all ${
          badge.bg
        } ${badge.border} ${badge.text}`}
      >
        <div className="flex items-center gap-2">
          <BadgeIcon className={`w-3.5 h-3.5 ${badge.pulse ? 'animate-pulse' : ''}`} />
          <span className="font-orbitron font-bold text-[11px] tracking-wider uppercase">{badge.label}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] opacity-90">
          <span>ALT: 10–15m AGL</span>
          <span>•</span>
          <span>WIDE FOV (1.0x)</span>
        </div>
      </div>

      {/* Floating Action Notice */}
      {actionNotice && (
        <div className="bg-[#161B22] border border-sky-400 text-white px-3 py-1.5 rounded text-[11px] font-mono shadow-xl flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* QR-Triggered Automatic RTL Alert Banner */}
      {latestDetection && (latestDetection.rtlInitiated || latestDetection.rtlConfirmed) && (
        <div className={`p-3 rounded-lg border flex items-center justify-between text-xs font-mono shadow-lg animate-in fade-in ${
          latestDetection.rtlConfirmed
            ? 'bg-amber-950/40 border-amber-500/60 text-amber-200'
            : 'bg-sky-950/40 border-sky-500/60 text-sky-200'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded border ${
              latestDetection.rtlConfirmed
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'bg-sky-500/20 border-sky-500/50 text-sky-400 animate-pulse'
            }`}>
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-orbitron font-bold text-[11px] tracking-wide text-white">
                  {latestDetection.rtlConfirmed ? 'RETURNING TO LAUNCH (CONFIRMED)' : 'RTL INITIATED (AUTOMATIC)'}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  latestDetection.rtlConfirmed
                    ? 'bg-amber-900/80 text-amber-300 border border-amber-700/60'
                    : 'bg-sky-900/80 text-sky-300 border border-sky-700/60'
                }`}>
                  {latestDetection.flightMode || 'RTL'}
                </span>
              </div>
              <p className="text-[10px] text-slate-300 mt-0.5">
                Triggered automatically by QR code detection: <span className="text-white font-mono font-semibold">"{latestDetection.payload?.slice(0, 32)}{latestDetection.payload && latestDetection.payload.length > 32 ? '...' : ''}"</span> (not an operator command)
              </p>
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            <span className="text-[9px] text-slate-400 block">MAVLINK MAV_CMD_NAV_RETURN_TO_LAUNCH</span>
            <span className="text-[10px] text-emerald-400 font-bold">PIXHAWK ACKNOWLEDGED</span>
          </div>
        </div>
      )}

      {/* 2. Active Target Intel Card (Case A: Confirmed Target Location) */}
      {activeTarget && activeTarget.isValid ? (
        <div className="bg-[#11161D] border border-emerald-500/50 rounded-lg p-2.5 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-emerald-400">
            <div className="flex items-center gap-1.5">
              <Target className="w-4 h-4 animate-pulse" />
              <span className="font-orbitron font-bold text-[11.5px] tracking-wide text-white">
                CONFIRMED QR TARGET (CASE A)
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-300">
              {targetDistance !== null ? `${targetDistance}m AWAY` : 'DISTANCE PENDING'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px] font-mono bg-black/40 p-2 rounded border border-slate-800">
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

          <div className="flex items-center justify-between pt-1">
            <span className="text-[9.5px] text-slate-400 font-mono">
              Flight Controller: GUIDED MAV_CMD_DO_REPOSITION
            </span>
            <button
              type="button"
              onClick={() => handleApproachTarget()}
              disabled={isApproaching}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold rounded flex items-center gap-1.5 shadow transition active:scale-95 cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>{isApproaching ? 'Approaching...' : 'Approach Target'}</span>
            </button>
          </div>
        </div>
      ) : latestDetection ? (
        /* Case B: Decoded Payload without GPS Coordinates */
        <div className="bg-[#11161D] border border-slate-800 rounded-lg p-2.5 shadow space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sky-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-orbitron font-bold text-[11px] tracking-wide text-white">
                LATEST RECON ACQUISITION
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {latestDetection.payloadType}
            </span>
          </div>

          <div className="bg-black/40 p-2 rounded border border-slate-800 text-[10.5px] font-mono space-y-1">
            <div className="flex justify-between items-start">
              <span className="text-slate-400">PAYLOAD:</span>
              <span className="text-emerald-300 font-bold break-all text-right max-w-[240px]">
                {latestDetection.payload || 'Data Pending (Undecoded)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">CAPTURE GPS:</span>
              <span className="text-slate-200">
                {latestDetection.gpsFixValid
                  ? `${latestDetection.droneLatitude.toFixed(6)}, ${latestDetection.droneLongitude.toFixed(6)}`
                  : 'GPS UNAVAILABLE'}
              </span>
            </div>
            <div className="flex justify-between text-[9.5px] text-slate-500">
              <span>Ground Target Position:</span>
              <span className="italic">Unknown (No GPS in payload)</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Latest Captured Photo Thumbnail Strip & History Header */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 font-bold">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>DETECTION ARCHIVE ({detections.length})</span>
        </div>
        {detections.length > 0 && (
          <button
            type="button"
            onClick={() => reconDetectionService.clearAllDetections()}
            className="text-[10px] text-slate-500 hover:text-red-400 font-mono transition cursor-pointer"
          >
            Clear Archive
          </button>
        )}
      </div>

      {/* Detections Gallery List */}
      <div className="flex flex-col gap-1.5 max-h-[145px] overflow-y-auto pr-1">
        {detections.length === 0 ? (
          <div className="bg-[#11161D] border border-dashed border-slate-800 rounded-lg p-3 text-center text-slate-500 text-[11px] font-mono">
            No QR detections recorded yet. Autonomous camera scanning active at 10–15m altitude.
          </div>
        ) : (
          detections.slice(0, 10).map((record) => (
            <div
              key={record.detectionId}
              className="bg-[#11161D] border border-slate-800/80 hover:border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2 text-[10.5px] font-mono transition"
            >
              {/* Photo Thumbnail */}
              <div
                onClick={() => setSelectedPhoto(record)}
                className="w-12 h-10 rounded overflow-hidden bg-black border border-slate-700 shrink-0 cursor-pointer hover:border-sky-400 transition relative group"
                title="Click to view full original resolution photo"
              >
                {record.photoDataUrl ? (
                  <img
                    src={record.thumbnailDataUrl || record.photoDataUrl}
                    alt={record.detectionId}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600">
                    <Camera className="w-3 h-3" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                  <Eye className="w-3 h-3 text-white" />
                </div>
              </div>

              {/* Detail Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white truncate">{record.detectionId}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                      record.status === 'TARGET_LOCATION_CONFIRMED'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                        : record.status === 'QR_DECODED'
                        ? 'bg-sky-950 text-sky-300 border border-sky-500/40'
                        : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
                <div className="text-slate-400 truncate text-[9.5px]">
                  {record.payload ? `Payload: "${record.payload}"` : 'QR Detected — Data Pending'}
                </div>
                <div className="text-[9px] text-slate-500 flex items-center gap-2">
                  <span>
                    GPS: {record.gpsFixValid ? `${record.droneLatitude.toFixed(4)}, ${record.droneLongitude.toFixed(4)}` : 'UNAVAIL'}
                  </span>
                  <span>•</span>
                  <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {record.status === 'DECODE_FAILED' && (
                  <button
                    type="button"
                    onClick={() => handleRetryDecode(record.detectionId)}
                    className="p-1 rounded bg-[#21262D] hover:bg-slate-700 text-amber-300 text-[10px] cursor-pointer"
                    title="Retry software image processing filters"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                {record.isTargetLocationConfirmed && (
                  <button
                    type="button"
                    onClick={() => handleApproachTarget(record.detectionId)}
                    className="p-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] cursor-pointer"
                    title="Navigate drone toward this confirmed target"
                  >
                    <Navigation className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPhoto(record)}
                  className="p-1 rounded bg-[#21262D] hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                  title="Inspect photo & telemetry"
                >
                  <Eye className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 4. Full Original Resolution Photo & Telemetry Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-slate-700 rounded-xl max-w-2xl w-full p-4 text-white shadow-2xl space-y-3 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-sky-400" />
                <h3 className="font-orbitron font-bold text-[14px] text-white">
                  ORIGINAL CAMERA PHOTO &amp; TELEMETRY
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPhoto(null)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-[#21262D] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Photo Viewport */}
            <div className="flex-1 min-h-[220px] max-h-[360px] bg-black rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center relative">
              {selectedPhoto.photoDataUrl ? (
                <img
                  src={selectedPhoto.photoDataUrl}
                  alt={selectedPhoto.detectionId}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-slate-500 font-mono text-[11px]">Original image data unavailable</div>
              )}
              <div className="absolute top-2 left-2 bg-black/75 px-2 py-1 rounded text-[10px] font-mono text-emerald-400 border border-slate-800">
                NATIVE ORIGINAL RESOLUTION (WIDE FOV)
              </div>
            </div>

            {/* Synchronized Pixhawk Telemetry Metadata Table */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] font-mono bg-[#11161D] p-2.5 rounded-lg border border-slate-800">
              <div>
                <span className="text-slate-400 block text-[9.5px]">DETECTION ID</span>
                <span className="text-white font-bold">{selectedPhoto.detectionId}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">STATUS</span>
                <span className="text-emerald-400 font-bold">{selectedPhoto.status}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">PIXHAWK LATITUDE</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixValid ? `${selectedPhoto.droneLatitude.toFixed(6)}°` : 'UNAVAILABLE'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">PIXHAWK LONGITUDE</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixValid ? `${selectedPhoto.droneLongitude.toFixed(6)}°` : 'UNAVAILABLE'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">ALTITUDE (AGL)</span>
                <span className="text-sky-300 font-bold">{selectedPhoto.droneAltitudeAgl.toFixed(1)}m</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9.5px]">GPS FIX / SATS</span>
                <span className="text-white font-bold">
                  {selectedPhoto.gpsFixType} ({selectedPhoto.satellites} Sats)
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block text-[9.5px]">DECODED PAYLOAD</span>
                <span className="text-emerald-300 font-bold break-all">
                  {selectedPhoto.payload || 'None (Pending / Decode Failed)'}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedPhoto.notes || ''}
              </span>
              <div className="flex items-center gap-2">
                {selectedPhoto.status === 'DECODE_FAILED' && (
                  <button
                    type="button"
                    onClick={() => handleRetryDecode(selectedPhoto.detectionId)}
                    className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-black font-bold text-[11px] font-mono cursor-pointer transition"
                  >
                    Retry Software Filters
                  </button>
                )}
                {selectedPhoto.isTargetLocationConfirmed && (
                  <button
                    type="button"
                    onClick={() => {
                      handleApproachTarget(selectedPhoto.detectionId);
                      setSelectedPhoto(null);
                    }}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] font-mono flex items-center gap-1.5 cursor-pointer transition shadow"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Approach Target Location</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPhoto(null)}
                  className="px-3 py-1.5 rounded bg-[#21262D] hover:bg-slate-700 text-slate-300 text-[11px] font-mono cursor-pointer transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
