import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DroneTelemetry, HomePoint, MissionState } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { mavlinkService } from '../../services/mavlinkService';
import { ControlModePanel } from '../common/ControlModePanel';
import { TelemetryHUD } from '../common/TelemetryHUD';
import {
  Sliders,
  AlertTriangle,
  MapPin,
  Trash2,
  Plus,
  Navigation,
  CheckCircle,
  XCircle,
  Power,
  PowerOff,
  Loader2,
  Route,
  ChevronRight
} from 'lucide-react';

interface GPSWaypoint {
  id: number;
  lat: number;
  lng: number;
  label: string;
}

interface ManualControlDashboardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  missionState: MissionState;
  pixhawkState: PixhawkConnectionState;
}

export const ManualControlDashboard: React.FC<ManualControlDashboardProps> = ({
  telemetry,
  homePoint,
  missionState,
  pixhawkState
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waypoints, setWaypoints] = useState<GPSWaypoint[]>([]);
  const [pathActive, setPathActive] = useState(false);
  const [isArming, setIsArming] = useState(false);
  const [isDisarming, setIsDisarming] = useState(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);
  const waypointIdRef = useRef(1);
  const breadcrumbsRef = useRef<Array<{ x: number; y: number }>>([]);

  const isArmed = telemetry.isArmed;
  const isMissionActive = missionState !== 'IDLE' && missionState !== 'HOME_SET' && missionState !== 'READY' && missionState !== 'MISSION_COMPLETE';

  useEffect(() => {
    if (isArmed) { setIsArming(false); setArmFeedback(null); }
    else { setIsDisarming(false); }
  }, [isArmed]);

  const handleArm = async (force: boolean = false) => {
    if (!pixhawkState.isConnected) { setArmFeedback('Not connected to flight controller.'); return; }
    setArmFeedback(null);
    setIsArming(true);
    const sent = await mavlinkService.sendArmCommand(force);
    if (!sent) { setIsArming(false); setArmFeedback('ARM FAILED: Check ESP32 connection.'); return; }
    const t0 = Date.now();
    const wd = setInterval(() => {
      if (mavlinkService.getTelemetry().isArmed) { setIsArming(false); setArmFeedback(null); clearInterval(wd); }
      else if (Date.now() - t0 > 5000) { setIsArming(false); setArmFeedback('ARM TIMEOUT — No ACK from Pixhawk.'); clearInterval(wd); }
    }, 200);
  };

  const handleDisarm = async (force: boolean = false) => {
    const isConn = pixhawkState.isConnected || pixhawkState.isUsbConnected || pixhawkState.isRealHardware || pixhawkState.connectionType === 'SIMULATED';
    if (!isConn) { setArmFeedback('Not connected.'); return; }
    setArmFeedback(null);
    setIsDisarming(true);
    const shouldForce = force || telemetry.altitude <= 1.0;
    const sent = await mavlinkService.sendDisarmCommand(shouldForce);
    if (!sent) { setIsDisarming(false); setArmFeedback('DISARM FAILED.'); return; }
    const t0 = Date.now();
    const wd = setInterval(() => {
      if (!mavlinkService.getTelemetry().isArmed) { setIsDisarming(false); setArmFeedback(null); clearInterval(wd); }
      else if (Date.now() - t0 > 5000) { setIsDisarming(false); clearInterval(wd); }
    }, 250);
  };

  // Add current GPS position as waypoint
  const addCurrentPosition = useCallback(() => {
    if (!telemetry.gps.isLocked) {
      setArmFeedback('GPS not locked — cannot add waypoint.');
      return;
    }
    const id = waypointIdRef.current++;
    setWaypoints(prev => [...prev, {
      id,
      lat: telemetry.latitude,
      lng: telemetry.longitude,
      label: `POINT ${id}`
    }]);
  }, [telemetry]);

  const removeWaypoint = (id: number) => {
    setWaypoints(prev => prev.filter(w => w.id !== id));
  };

  const clearPath = () => {
    setWaypoints([]);
    setPathActive(false);
    waypointIdRef.current = 1;
  };

  const activatePath = () => {
    if (waypoints.length >= 2) {
      setPathActive(true);
    }
  };

  // Canvas map render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      // Background
      ctx.fillStyle = '#0a0f1d';
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      const gs = 30;
      for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Range rings
      [45, 90, 135, 180].forEach((r, i) => {
        ctx.strokeStyle = 'rgba(56,189,248,0.12)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(148,163,184,0.45)';
        ctx.font = '9px monospace';
        ctx.fillText(`${(i + 1) * 25}m`, cx + r + 2, cy - 2);
      });

      // Home point
      const homeX = cx;
      const homeY = cy + 40;
      if (homePoint.isSet) {
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(homeX, homeY, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#0284c7';
        ctx.beginPath(); ctx.arc(homeX, homeY, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#38bdf8'; ctx.font = 'bold 10px monospace';
        ctx.fillText('HOME', homeX + 12, homeY + 4);
      }

      // Drone position
      const latDiff = (telemetry.latitude - (homePoint.isSet ? homePoint.latitude : telemetry.latitude)) * 111320;
      const lonDiff = (telemetry.longitude - (homePoint.isSet ? homePoint.longitude : telemetry.longitude)) * 111320 * Math.cos(telemetry.latitude * Math.PI / 180);
      const droneX = homeX + lonDiff * 2.2;
      const droneY = homeY - latDiff * 2.2;

      // Breadcrumb trail
      if (telemetry.isArmed && (breadcrumbsRef.current.length === 0 || Math.hypot(droneX - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].x, droneY - breadcrumbsRef.current[breadcrumbsRef.current.length - 1].y) > 4)) {
        breadcrumbsRef.current.push({ x: droneX, y: droneY });
        if (breadcrumbsRef.current.length > 250) breadcrumbsRef.current.shift();
      }
      if (breadcrumbsRef.current.length > 1) {
        ctx.strokeStyle = 'rgba(56,189,248,0.5)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(breadcrumbsRef.current[0].x, breadcrumbsRef.current[0].y);
        breadcrumbsRef.current.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }

      // Planned PATH
      if (waypoints.length >= 2) {
        // Path line
        ctx.strokeStyle = pathActive ? 'rgba(234,179,8,0.9)' : 'rgba(234,179,8,0.4)';
        ctx.lineWidth = pathActive ? 2.5 : 1.5;
        ctx.setLineDash(pathActive ? [] : [5, 4]);
        ctx.beginPath();
        waypoints.forEach((wp, i) => {
          const latD = (wp.lat - (homePoint.isSet ? homePoint.latitude : telemetry.latitude)) * 111320;
          const lonD = (wp.lng - (homePoint.isSet ? homePoint.longitude : telemetry.longitude)) * 111320 * Math.cos(wp.lat * Math.PI / 180);
          const wpX = homeX + lonD * 2.2;
          const wpY = homeY - latD * 2.2;
          if (i === 0) ctx.moveTo(wpX, wpY); else ctx.lineTo(wpX, wpY);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Waypoint dots
      waypoints.forEach((wp, i) => {
        const latD = (wp.lat - (homePoint.isSet ? homePoint.latitude : telemetry.latitude)) * 111320;
        const lonD = (wp.lng - (homePoint.isSet ? homePoint.longitude : telemetry.longitude)) * 111320 * Math.cos(wp.lat * Math.PI / 180);
        const wpX = homeX + lonD * 2.2;
        const wpY = homeY - latD * 2.2;

        ctx.fillStyle = i === 0 ? '#22d3ee' : i === waypoints.length - 1 ? '#f59e0b' : '#a78bfa';
        ctx.beginPath(); ctx.arc(wpX, wpY, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 9px monospace';
        ctx.fillText(`P${i + 1}`, wpX + 7, wpY + 3);
      });

      // Drone icon
      ctx.save();
      ctx.translate(droneX, droneY);
      ctx.rotate((telemetry.heading * Math.PI) / 180);
      ctx.strokeStyle = 'rgba(239,68,68,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -32); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
      ctx.fillStyle = telemetry.isArmed ? 'rgba(56,189,248,0.8)' : 'rgba(148,163,184,0.4)';
      [[-10, -10], [10, -10], [10, 10], [-10, 10]].forEach(([rx, ry]) => {
        ctx.beginPath(); ctx.arc(rx, ry, 3.5, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
      ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 10px monospace';
      ctx.fillText(`DRONE (${telemetry.altitude.toFixed(1)}m)`, droneX + 14, droneY - 5);

      // MANUAL OVERRIDE label
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('⊕ MANUAL OVERRIDE ACTIVE', 8, H - 10);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [telemetry, homePoint, waypoints, pathActive]);

  return (
    <div className="p-3 sm:p-5 max-w-7xl mx-auto space-y-4 font-mono select-none">

      {/* MANUAL OVERRIDE HEADER BANNER */}
      <div className="bg-amber-950/60 border-2 border-amber-500/70 rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-amber-950 border border-amber-500/60 text-amber-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-black text-amber-300 uppercase tracking-wide">MANUAL OVERRIDE ACTIVE</div>
            <div className="text-[11px] text-amber-500/80 mt-0.5">
              {isMissionActive
                ? '⚠ MISSION PAUSED — Automated commands suppressed while in Manual mode'
                : 'Manual control has priority. Automated commands will not be sent.'}
            </div>
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-[11px] font-black border shrink-0 ${
          isArmed
            ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 animate-pulse'
            : 'bg-slate-800 border-slate-700 text-slate-400'
        }`}>
          {isArmed ? '● ARMED' : '○ DISARMED'}
        </div>
      </div>

      {/* TELEMETRY HUD */}
      <TelemetryHUD telemetry={telemetry} />

      {/* MAIN LAYOUT: Map + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* LEFT: ARM/DISARM + Pixhawk */}
        <div className="lg:col-span-5 space-y-4">

          {/* ARM / DISARM Controls */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
              MANUAL ARM / DISARM CONTROL
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleArm(false)}
                disabled={isArmed || isArming || !pixhawkState.isConnected}
                className={`py-4 rounded-xl font-black text-sm uppercase tracking-wide flex items-center justify-center space-x-2 transition ${
                  !isArmed && !isArming && pixhawkState.isConnected
                    ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                {isArming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Power className="w-5 h-5" />}
                <span>{isArming ? 'ARMING...' : 'ARM'}</span>
              </button>

              <button
                onClick={() => handleDisarm(telemetry.altitude <= 1.0)}
                disabled={isDisarming || (!pixhawkState.isConnected && !pixhawkState.isUsbConnected && pixhawkState.connectionType !== 'SIMULATED')}
                className={`py-4 rounded-xl font-black text-sm uppercase tracking-wide flex items-center justify-center space-x-2 transition ${
                  (pixhawkState.isConnected || pixhawkState.isUsbConnected || pixhawkState.connectionType === 'SIMULATED') && !isDisarming
                    ? isArmed
                      ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg shadow-rose-600/30 cursor-pointer'
                      : 'bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
                title="Send MAVLink DISARM command"
              >
                {isDisarming ? <Loader2 className="w-5 h-5 animate-spin" /> : <PowerOff className="w-5 h-5" />}
                <span>{isDisarming ? 'DISARMING...' : isArmed ? 'DISARM' : 'FORCE DISARM'}</span>
              </button>
            </div>

            {armFeedback && (
              <div className="p-2.5 bg-rose-950/70 border border-rose-500/50 rounded-lg text-rose-300 text-xs flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{armFeedback}</span>
              </div>
            )}

            {!pixhawkState.isConnected && !pixhawkState.isUsbConnected && pixhawkState.connectionType !== 'SIMULATED' && (
              <div className="p-2 bg-slate-950/70 border border-slate-700 rounded-lg text-slate-400 text-[11px] flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Connect to flight controller first via ESP32 or USB</span>
              </div>
            )}
          </div>

          {/* Flight Control Panel (No RC Mode) */}
          <ControlModePanel
            telemetry={telemetry}
            connectionState={pixhawkState}
            onArmClick={handleArm}
            onDisarmClick={() => handleDisarm(telemetry.altitude <= 1.0)}
            isArmingInProgress={isArming}
            isDisarmingInProgress={isDisarming}
          />
        </div>

        {/* RIGHT: Map + Path Planning */}
        <div className="lg:col-span-7 space-y-3">

          {/* Map canvas */}
          <div className="relative bg-slate-950 rounded-xl overflow-hidden border border-amber-500/30 h-[320px] sm:h-[380px]">
            <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
              <div className="bg-slate-900/90 backdrop-blur-md px-2.5 py-1 rounded border border-amber-500/40 font-mono text-[11px] text-amber-300 flex items-center space-x-1.5">
                <Navigation className="w-3.5 h-3.5" />
                <span>MANUAL CONTROL MAP</span>
              </div>
              <div className={`px-2.5 py-1 rounded border font-mono text-[10px] font-black ${
                pathActive
                  ? 'bg-amber-950/80 border-amber-500/50 text-amber-300'
                  : waypoints.length > 0
                  ? 'bg-slate-900/80 border-slate-700 text-slate-400'
                  : 'bg-slate-900/80 border-slate-700 text-slate-500'
              }`}>
                {pathActive ? 'PATH ACTIVE' : waypoints.length > 0 ? `${waypoints.length} POINT${waypoints.length > 1 ? 'S' : ''}` : 'NO PATH'}
              </div>
            </div>

            <canvas
              ref={canvasRef}
              width={600}
              height={380}
              className="w-full h-full object-cover block"
            />

            {/* Bottom footer */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-10 pointer-events-none">
              <div className="bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded border border-slate-800 font-mono text-[10px] text-slate-400">
                Lat: {telemetry.latitude.toFixed(6)}° &nbsp; Lon: {telemetry.longitude.toFixed(6)}°
              </div>
              <div className="bg-slate-900/80 backdrop-blur-md px-2 py-1 rounded border border-slate-800 font-mono text-[10px] text-sky-400">
                ↑ HDG: {telemetry.heading.toFixed(0)}°
              </div>
            </div>
          </div>

          {/* GPS PATH PLANNING PANEL */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center space-x-2">
                <Route className="w-3.5 h-3.5 text-amber-400" />
                <span>GPS PATH PLANNING</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {waypoints.length >= 2 && !pathActive && (
                  <button
                    onClick={activatePath}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black uppercase cursor-pointer transition flex items-center space-x-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>ACTIVATE PATH</span>
                  </button>
                )}
                {pathActive && (
                  <div className="px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-500/50 text-amber-300 text-[11px] font-black flex items-center space-x-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>PATH ACTIVE</span>
                  </div>
                )}
                <button
                  onClick={addCurrentPosition}
                  disabled={!telemetry.gps.isLocked}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase cursor-pointer transition flex items-center space-x-1 ${
                    telemetry.gps.isLocked
                      ? 'bg-sky-600 hover:bg-sky-500 text-white'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ADD POINT</span>
                </button>
                {waypoints.length > 0 && (
                  <button
                    onClick={clearPath}
                    className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 text-rose-300 text-[11px] font-black uppercase cursor-pointer transition flex items-center space-x-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>CLEAR</span>
                  </button>
                )}
              </div>
            </div>

            {/* Waypoint List */}
            {waypoints.length === 0 ? (
              <div className="text-center py-4 text-slate-500 text-xs">
                <MapPin className="w-5 h-5 mx-auto mb-1 opacity-40" />
                <div>No waypoints — tap ADD POINT to record current GPS position</div>
                {!telemetry.gps.isLocked && (
                  <div className="text-amber-400 mt-1">⚠ Waiting for GPS lock…</div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {waypoints.map((wp, i) => (
                  <div
                    key={wp.id}
                    className="flex items-center justify-between bg-slate-950/80 px-2.5 py-2 rounded-lg border border-slate-800 text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        i === 0 ? 'bg-cyan-400' : i === waypoints.length - 1 ? 'bg-amber-400' : 'bg-violet-400'
                      }`} />
                      <div>
                        <div className="font-black text-slate-200 uppercase">{wp.label}</div>
                        <div className="text-slate-400 font-mono text-[10px]">
                          {wp.lat.toFixed(6)}°, {wp.lng.toFixed(6)}°
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {i < waypoints.length - 1 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                      <button
                        onClick={() => removeWaypoint(wp.id)}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {waypoints.length >= 2 && (
              <div className={`px-2.5 py-2 rounded-lg border text-[11px] font-mono flex items-center space-x-2 ${
                pathActive
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                  : 'bg-slate-950/60 border-slate-700 text-slate-400'
              }`}>
                <Route className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {pathActive
                    ? `PATH ACTIVE — ${waypoints.length} waypoints. Automated movement must remain within this boundary.`
                    : `${waypoints.length} waypoints defined. Activate path to enforce operating boundary.`}
                </span>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
