import React, { useState, useEffect } from 'react';
import { MissionLogEntry } from '../../types/mission';
import { storageService } from '../../services/storageService';
import { 
  History, 
  X, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Clock, 
  QrCode, 
  Radio, 
  RotateCcw,
  Plane,
  Image as ImageIcon,
  MapPin,
  ArrowLeft,
  Navigation,
  Compass,
  Battery,
  Gauge,
  Activity,
  Layers,
  Eye
} from 'lucide-react';

interface MissionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMissionForMap?: (entry: MissionLogEntry) => void;
}

export const MissionHistoryModal: React.FC<MissionHistoryModalProps> = ({
  isOpen,
  onClose,
  onSelectMissionForMap
}) => {
  const [logs, setLogs] = useState<MissionLogEntry[]>([]);
  const [selectedMission, setSelectedMission] = useState<MissionLogEntry | null>(null);

  useEffect(() => {
    if (isOpen) {
      const stored = storageService.getMissionLogs().slice(0, 5);
      setLogs(stored);
      setSelectedMission(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExportJSON = () => {
    const json = storageService.exportLogsAsJSON();
    storageService.downloadFile(json, `sae_mission_logs_${Date.now()}.json`, 'application/json');
  };

  const handleExportCSV = () => {
    const csv = storageService.exportLogsAsCSV();
    storageService.downloadFile(csv, `sae_mission_logs_${Date.now()}.csv`, 'text/csv');
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all mission history logs?')) {
      storageService.clearLogs();
      setLogs([]);
      setSelectedMission(null);
    }
  };

  const handleDeleteIndividual = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm(`Delete mission ${id}? This action cannot be undone.`)) {
      const updated = storageService.deleteMissionLog(id);
      setLogs(updated.slice(0, 5));
      if (selectedMission?.id === id) {
        setSelectedMission(null);
      }
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatTimestamp = (ts: number) => {
    if (!ts || isNaN(ts)) return 'N/A';
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  };

  // Render SVG Tactical Flight Path Map
  const renderFlightPathMap = (mission: MissionLogEntry) => {
    const path = mission.flightPath || [];
    const waypoints = mission.waypoints || [];
    const home = mission.homePoint;

    // Collect all coordinates to compute bounding box
    const allCoords: Array<{ lat: number; lng: number }> = [];
    if (home?.isSet && home.latitude !== 0 && home.longitude !== 0) {
      allCoords.push({ lat: home.latitude, lng: home.longitude });
    }
    path.forEach((p) => allCoords.push({ lat: p.lat, lng: p.lng }));
    waypoints.forEach((w) => allCoords.push({ lat: w.lat, lng: w.lng }));

    if (allCoords.length === 0) {
      return (
        <div className="h-64 rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center text-slate-500 p-4 text-center">
          <Navigation className="w-8 h-8 mb-2 opacity-30 text-sky-400" />
          <p className="text-xs">No GPS flight path coordinates were recorded during this flight.</p>
          <p className="text-[10px] text-slate-600 mt-1">Telemetry GPS coordinates are recorded only when valid 3D GPS lock is present during airborne ops.</p>
        </div>
      );
    }

    const lats = allCoords.map((c) => c.lat);
    const lngs = allCoords.map((c) => c.lng);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);

    // Padding if points are concentrated
    const latSpan = Math.max(0.0002, maxLat - minLat);
    const lngSpan = Math.max(0.0002, maxLng - minLng);
    minLat -= latSpan * 0.15;
    maxLat += latSpan * 0.15;
    minLng -= lngSpan * 0.15;
    maxLng += lngSpan * 0.15;

    const width = 600;
    const height = 300;

    const project = (lat: number, lng: number) => {
      const x = ((lng - minLng) / (maxLng - minLng)) * (width - 40) + 20;
      const y = height - (((lat - minLat) / (maxLat - minLat)) * (height - 40) + 20);
      return { x, y };
    };

    const pathPointsSvg = path.map((pt) => {
      const { x, y } = project(pt.lat, pt.lng);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const homePt = (home?.isSet && home.latitude !== 0) ? project(home.latitude, home.longitude) : null;

    return (
      <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-3 overflow-hidden shadow-inner">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-bold text-slate-200">TACTICAL TRAJECTORY MAP</span>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-sky-400">● Breadcrumbs: {path.length}</span>
            <span className="text-amber-400">◆ Waypoints: {waypoints.length}</span>
            <span className="text-emerald-400">★ Home</span>
          </div>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 sm:h-72 bg-[#090d16] rounded-lg">
          {/* Tactical Coordinate Grid */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#141c2e" strokeWidth="1" />
            </pattern>
            <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Compass Rose Mini */}
          <g transform={`translate(${width - 30}, 30)`} opacity="0.6">
            <circle r="14" fill="#0f172a" stroke="#334155" strokeWidth="1" />
            <path d="M 0,-10 L 3,-2 L 0,0 L -3,-2 Z" fill="#ef4444" />
            <path d="M 0,10 L 3,2 L 0,0 L -3,2 Z" fill="#94a3b8" />
            <text x="0" y="-13" textAnchor="middle" fontSize="7" fill="#ef4444" fontWeight="bold">N</text>
          </g>

          {/* Planned Waypoints Connecting Line */}
          {waypoints.length > 1 && (
            <polyline
              points={waypoints.map((w) => {
                const { x, y } = project(w.lat, w.lng);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ')}
              fill="none"
              stroke="#eab308"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.5"
            />
          )}

          {/* Recorded Flight Path Polyline */}
          {path.length > 1 && (
            <>
              <polyline
                points={pathPointsSvg}
                fill="none"
                stroke="url(#pathGradient)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
              {/* Glowing outer shadow */}
              <polyline
                points={pathPointsSvg}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.15"
              />
            </>
          )}

          {/* Planned Waypoints Nodes */}
          {waypoints.map((wp, idx) => {
            const { x, y } = project(wp.lat, wp.lng);
            return (
              <g key={`wp-${idx}`} transform={`translate(${x}, ${y})`}>
                <polygon points="0,-6 6,0 0,6 -6,0" fill="#eab308" stroke="#000" strokeWidth="1" />
                <text x="0" y="3" textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold">
                  {wp.seq ?? idx}
                </text>
              </g>
            );
          })}

          {/* Home Point Marker */}
          {homePt && (
            <g transform={`translate(${homePt.x}, ${homePt.y})`}>
              <circle r="7" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
              <text x="0" y="3" textAnchor="middle" fontSize="8" fill="#ffffff" fontWeight="bold">H</text>
            </g>
          )}

          {/* Flight Path Start & End Dots */}
          {path.length > 0 && (
            <>
              {(() => {
                const start = project(path[0].lat, path[0].lng);
                return (
                  <circle cx={start.x} cy={start.y} r="4" fill="#38bdf8" stroke="#ffffff" strokeWidth="1" />
                );
              })()}
              {(() => {
                const end = project(path[path.length - 1].lat, path[path.length - 1].lng);
                return (
                  <circle cx={end.x} cy={end.y} r="4" fill="#f43f5e" stroke="#ffffff" strokeWidth="1" />
                );
              })()}
            </>
          )}
        </svg>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[10px] text-slate-500 font-mono">
          <div>Bounds: Lat ({minLat.toFixed(6)} to {maxLat.toFixed(6)})</div>
          <div>Lng ({minLng.toFixed(6)} to {maxLng.toFixed(6)})</div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 font-mono select-none">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center space-x-2.5">
            {selectedMission ? (
              <button
                onClick={() => setSelectedMission(null)}
                className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-white transition flex items-center gap-1 text-xs cursor-pointer mr-1"
                title="Back to Recent Missions List"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </button>
            ) : null}
            <History className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
                <span>MISSION HISTORY</span>
                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                  {selectedMission ? `DETAILS: ${selectedMission.id}` : `PAST 5 FLIGHTS (${logs.length}/5)`}
                </span>
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            title="Close Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          {selectedMission ? (
            /* ============================================================== */
            /* 1. SELECTED MISSION DETAILS VIEW                               */
            /* ============================================================== */
            <div className="space-y-4">
              {/* Mission Summary Card */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center space-x-2.5">
                    <span className="bg-sky-950 border border-sky-500/40 text-sky-400 font-extrabold text-sm px-3 py-1 rounded">
                      {selectedMission.id}
                    </span>
                    <span className="text-xs text-slate-400 font-sans">
                      Flight #{selectedMission.missionNumber} — {formatTimestamp(selectedMission.startTime)}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded border ${
                      selectedMission.completionStatus === 'SUCCESS'
                        ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                        : selectedMission.completionStatus === 'EMERGENCY_RTL'
                        ? 'bg-amber-950/80 border-amber-500/50 text-amber-400'
                        : 'bg-rose-950/80 border-rose-500/50 text-rose-400'
                    }`}>
                      {selectedMission.completionStatus}
                    </span>
                    <button
                      onClick={(e) => handleDeleteIndividual(selectedMission.id, e)}
                      className="p-1.5 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-300 hover:text-white transition cursor-pointer"
                      title="Delete this mission record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Primary Parameters Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                      <Clock className="w-3 h-3 text-sky-400" />
                      <span>Duration</span>
                    </div>
                    <div className="text-sm font-black text-slate-100 mt-1">
                      {formatDuration(selectedMission.durationSeconds)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {selectedMission.durationSeconds}s elapsed
                    </div>
                  </div>

                  <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                      <RotateCcw className="w-3 h-3 text-amber-400" />
                      <span>RTL Status</span>
                    </div>
                    <div className="text-sm font-black text-amber-400 mt-1">
                      {selectedMission.rtlStatus || 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Landing: {selectedMission.landingStatus || 'N/A'}
                    </div>
                  </div>

                  <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                      <QrCode className="w-3 h-3 text-emerald-400" />
                      <span>QR Payload</span>
                    </div>
                    <div className="text-sm font-black text-emerald-400 mt-1">
                      {selectedMission.qrResult || selectedMission.qrData?.code || 'NONE'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {selectedMission.qrData?.confidence ? `Conf: ${selectedMission.qrData.confidence}%` : 'Raw decode'}
                    </div>
                  </div>

                  <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                      <Radio className="w-3 h-3 text-purple-400" />
                      <span>Runner ACK</span>
                    </div>
                    <div className="text-sm font-black text-purple-400 mt-1">
                      {selectedMission.runnerAckReceived ? 'CONFIRMED' : 'NO ACK'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {selectedMission.runnerAckLatencyMs ? `${selectedMission.runnerAckLatencyMs}ms latency` : 'Not confirmed'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Tactical Trajectory Map Visualization */}
              {renderFlightPathMap(selectedMission)}

              {/* 3. Waypoints Table (Only Data Actually Recorded) */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>RECORDED MISSION WAYPOINTS</span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {selectedMission.waypoints?.length || 0} items stored
                  </span>
                </div>

                {selectedMission.waypoints && selectedMission.waypoints.length > 0 ? (
                  <div className="overflow-x-auto max-h-48 border border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-400 sticky top-0">
                        <tr>
                          <th className="py-1.5 px-3">#</th>
                          <th className="py-1.5 px-3">Command</th>
                          <th className="py-1.5 px-3">Latitude</th>
                          <th className="py-1.5 px-3">Longitude</th>
                          <th className="py-1.5 px-3">Alt (AGL)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {selectedMission.waypoints.map((wp, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50 text-slate-300">
                            <td className="py-1.5 px-3 text-sky-400 font-bold">{wp.seq ?? idx}</td>
                            <td className="py-1.5 px-3">
                              {wp.command === 16
                                ? 'NAV_WAYPOINT'
                                : wp.command === 20
                                ? 'NAV_RTL'
                                : wp.command === 21
                                ? 'NAV_LAND'
                                : wp.command === 22
                                ? 'TAKEOFF'
                                : wp.action || `CMD_${wp.command ?? 16}`}
                            </td>
                            <td className="py-1.5 px-3">{wp.lat.toFixed(6)}°</td>
                            <td className="py-1.5 px-3">{wp.lng.toFixed(6)}°</td>
                            <td className="py-1.5 px-3 text-emerald-400">{wp.alt.toFixed(1)}m</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-2 italic">
                    No waypoints were stored for this mission log.
                  </p>
                )}
              </div>

              {/* 4. GPS Coordinates & Recorded Telemetry Snapshot */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Home Point Reference Coordinates */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-1 border-b border-slate-800">
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    <span>HOME POINT GPS REFERENCE</span>
                  </div>

                  {selectedMission.homePoint && selectedMission.homePoint.isSet ? (
                    <div className="space-y-1.5 text-xs text-slate-300">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Latitude:</span>
                        <span className="font-bold text-slate-100">{selectedMission.homePoint.latitude.toFixed(6)}°</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Longitude:</span>
                        <span className="font-bold text-slate-100">{selectedMission.homePoint.longitude.toFixed(6)}°</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Home Altitude:</span>
                        <span className="font-bold text-emerald-400">{selectedMission.homePoint.altitude.toFixed(1)}m AMSL</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Timestamp:</span>
                        <span className="text-slate-400">{formatTimestamp(selectedMission.homePoint.timestamp)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic py-2">
                      Home Point was not recorded for this mission.
                    </p>
                  )}
                </div>

                {/* Telemetry Snapshot Metrics */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200 pb-1 border-b border-slate-800">
                    <Activity className="w-4 h-4 text-sky-400" />
                    <span>TELEMETRY SNAPSHOT</span>
                  </div>

                  {selectedMission.telemetrySnapshot ? (
                    <div className="space-y-1.5 text-xs text-slate-300">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Max Altitude Reached:</span>
                        <span className="font-bold text-sky-400">
                          {selectedMission.telemetrySnapshot.maxAltitude !== undefined
                            ? `${selectedMission.telemetrySnapshot.maxAltitude}m AGL`
                            : 'Not recorded'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Average Flight Speed:</span>
                        <span className="font-bold text-slate-100">
                          {selectedMission.telemetrySnapshot.avgSpeed !== undefined
                            ? `${selectedMission.telemetrySnapshot.avgSpeed} m/s`
                            : 'Not recorded'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Battery Voltage:</span>
                        <span className="font-bold text-amber-400">
                          {selectedMission.telemetrySnapshot.batteryStartVoltage !== undefined
                            ? `${selectedMission.telemetrySnapshot.batteryStartVoltage}V ➔ ${selectedMission.telemetrySnapshot.batteryEndVoltage || '?'}V`
                            : 'Not recorded'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">GPS Satellites Visible:</span>
                        <span className="font-bold text-slate-100">
                          {selectedMission.telemetrySnapshot.satellites ?? 'Not recorded'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Final Flight Mode:</span>
                        <span className="font-bold text-emerald-400">
                          {selectedMission.telemetrySnapshot.flightMode || 'Not recorded'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic py-2">
                      No telemetry snapshot recorded for this flight.
                    </p>
                  )}
                </div>
              </div>

              {/* 5. Verified QR Photo Snapshot if Retained */}
              {selectedMission.verifiedSnapshotUrl && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 pb-1 border-b border-slate-800">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>VERIFIED TARGET QR PHOTO SNAPSHOT</span>
                  </div>
                  <div className="flex items-center space-x-4 pt-1">
                    <img
                      src={selectedMission.verifiedSnapshotUrl}
                      alt="Verified Target QR"
                      className="w-24 h-24 object-cover rounded-lg border border-emerald-500/50 shadow-md"
                    />
                    <div className="text-xs space-y-1 text-slate-300">
                      <div className="font-bold text-white">Target Code #{selectedMission.qrResult}</div>
                      <div className="text-slate-400 text-[11px]">
                        Airborne photo capture locked during search pass. Verified by onboard computer vision pipeline.
                      </div>
                      {selectedMission.qrData?.detectedAt && (
                        <div className="text-[10px] text-slate-500">
                          Detected at: {formatTimestamp(selectedMission.qrData.detectedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 6. State Transition Sequence Timeline */}
              {selectedMission.stateTransitions && selectedMission.stateTransitions.length > 0 && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-slate-200 pb-1 border-b border-slate-800 flex items-center justify-between">
                    <span>STATE TRANSITION TIMELINE</span>
                    <span className="text-[10px] text-slate-500">{selectedMission.stateTransitions.length} transitions</span>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto text-xs">
                    {selectedMission.stateTransitions.map((t, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 px-2 rounded bg-slate-900/50 text-[11px]">
                        <span className="font-bold text-sky-400">{t.state}</span>
                        <span className="text-slate-400 truncate max-w-[280px]">{t.note || ''}</span>
                        <span className="text-slate-500 text-[10px]">{new Date(t.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ============================================================== */
            /* 2. RECENT 5 MISSIONS LIST VIEW                                 */
            /* ============================================================== */
            logs.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30 text-amber-400" />
                <p className="text-sm font-bold text-slate-400">No recorded missions in history yet.</p>
                <p className="text-xs text-slate-600 mt-1">Missions executed through GCS are automatically archived here up to the 5 most recent flights.</p>
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => setSelectedMission(log)}
                  className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 hover:border-sky-500/50 transition cursor-pointer group shadow-sm hover:shadow-md"
                >
                  {/* Mission Summary Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                    <div className="flex items-center space-x-2">
                      <span className="bg-sky-950/80 border border-sky-500/40 text-sky-400 font-extrabold text-xs sm:text-sm px-2.5 py-1 rounded">
                        {log.id}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatTimestamp(log.startTime)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
                        log.completionStatus === 'SUCCESS'
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                          : log.completionStatus === 'EMERGENCY_RTL'
                          ? 'bg-amber-950/60 border-amber-500/40 text-amber-400'
                          : 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                      }`}>
                        {log.completionStatus}
                      </span>
                      <span className="text-xs font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                        {formatDuration(log.durationSeconds)}
                      </span>
                      <button
                        onClick={(e) => handleDeleteIndividual(log.id, e)}
                        className="p-1 rounded bg-slate-800 hover:bg-rose-950 hover:border-rose-500/40 border border-transparent text-slate-400 hover:text-rose-400 transition"
                        title="Delete this mission"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Mission Parameter Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] text-slate-500 uppercase">QR Target</div>
                      <div className="text-sm font-black text-emerald-400">{log.qrResult || 'NONE'}</div>
                    </div>

                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] text-slate-500 uppercase">Flight Path</div>
                      <div className="text-xs font-bold text-sky-400 mt-0.5">
                        {log.flightPath?.length ? `${log.flightPath.length} GPS pts` : 'No GPS pts'}
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] text-slate-500 uppercase">Waypoints</div>
                      <div className="text-xs font-bold text-amber-400 mt-0.5">
                        {log.waypoints?.length ? `${log.waypoints.length} waypoints` : '0 waypoints'}
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                      <div className="text-[10px] text-slate-500 uppercase">RTL / Landing</div>
                      <div className="text-xs font-bold text-slate-300 mt-0.5">{log.rtlStatus || 'N/A'}</div>
                    </div>
                  </div>

                  {/* Click to inspect prompt */}
                  <div className="text-[11px] text-sky-400 group-hover:text-sky-300 flex items-center justify-end gap-1 pt-1 font-bold">
                    <span>Inspect Mission Details & Trajectory</span>
                    <Navigation className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-950/70 flex flex-wrap items-center justify-between gap-2">
          {selectedMission ? (
            <button
              onClick={() => setSelectedMission(null)}
              className="flex items-center space-x-1.5 text-xs text-sky-400 hover:text-white transition cursor-pointer font-bold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to 5 Recent Missions</span>
            </button>
          ) : (
            <button
              onClick={handleClear}
              disabled={logs.length === 0}
              className="flex items-center space-x-1.5 text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All History</span>
            </button>
          )}

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCSV}
              disabled={logs.length === 0}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition flex items-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handleExportJSON}
              disabled={logs.length === 0}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-sky-600/30 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
