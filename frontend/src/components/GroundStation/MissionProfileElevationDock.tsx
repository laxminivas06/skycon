import React, { useState } from 'react';
import { DroneTelemetry } from '../../types/mission';

interface MissionProfileElevationDockProps {
  telemetry: DroneTelemetry;
  flightTimeStr: string;
  isMissionRunning: boolean;
  onStartResumeMission: () => void;
  onHoldMission: () => void;
  onAbortRTL: () => void;
  className?: string;
}

export const MissionProfileElevationDock: React.FC<MissionProfileElevationDockProps> = ({
  telemetry,
  flightTimeStr,
  isMissionRunning,
  onStartResumeMission,
  onHoldMission,
  onAbortRTL,
  className = ''
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(2);

  const currentAlt = Math.max(0, telemetry.altitude || 0);
  const targetAlt = telemetry.targetAltitude || 20.0;
  const heading = Math.round(((telemetry.heading || 0) % 360 + 360) % 360);
  const speed = Math.max(0, telemetry.groundSpeed || 0);
  const vSpeed = telemetry.verticalSpeed || 0;

  // Cardinal direction helper
  const getCardinal = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((deg % 360) / 45) % 8];
  };

  // UAV position on SVG profile graph:
  // Altitude 0m to 30m maps to Y=55 down to Y=12
  const uavY = Math.max(12, Math.min(55, 55 - (currentAlt / 30) * 43));
  // Progress 0% to 100% maps to X=35 to X=360
  const progressPercent = Math.min(100, Math.max(5, (telemetry.searchProgress || 35)));
  const uavX = 35 + (progressPercent / 100) * 325;

  return (
    <div
      className={`bg-[#18191d]/95 backdrop-blur-md rounded-xl shadow-2xl border border-[#303138] overflow-hidden select-none text-slate-200 transition-all ${className}`}
    >
      {/* 1. TOP CONTROL & TELEMETRY STRIP (Matching Image 1) */}
      <div className="px-3 py-1.5 bg-[#1f2025] border-b border-[#2a2b30] flex items-center justify-between flex-wrap gap-2">
        {/* Playback & Execution Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveStep(Math.max(1, activeStep - 1))}
            className="w-6 h-6 rounded bg-[#2a2b30] hover:bg-[#34353a] flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            title="Step Backward"
          >
            <span className="material-symbols-outlined text-[15px]">skip_previous</span>
          </button>
          <button
            onClick={() => setActiveStep(Math.max(1, activeStep - 1))}
            className="w-6 h-6 rounded bg-[#2a2b30] hover:bg-[#34353a] flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            title="Rewind"
          >
            <span className="material-symbols-outlined text-[15px]">fast_rewind</span>
          </button>
          <button
            onClick={isMissionRunning ? onHoldMission : onStartResumeMission}
            className={`px-2 h-6 rounded flex items-center gap-1 font-bold text-[11px] transition cursor-pointer ${
              isMissionRunning
                ? 'bg-[#f59e0b] hover:bg-[#d97706] text-slate-900'
                : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white'
            }`}
            title={isMissionRunning ? 'Pause Mission (Hold)' : 'Start / Resume Autonomous Mission'}
          >
            <span className="material-symbols-outlined text-[15px]">
              {isMissionRunning ? 'pause' : 'play_arrow'}
            </span>
            <span className="hidden sm:inline">{isMissionRunning ? 'PAUSE' : 'START'}</span>
          </button>
          <button
            onClick={() => setActiveStep(Math.min(5, activeStep + 1))}
            className="w-6 h-6 rounded bg-[#2a2b30] hover:bg-[#34353a] flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            title="Fast Forward"
          >
            <span className="material-symbols-outlined text-[15px]">fast_forward</span>
          </button>
          <button
            onClick={() => setActiveStep(Math.min(5, activeStep + 1))}
            className="w-6 h-6 rounded bg-[#2a2b30] hover:bg-[#34353a] flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
            title="Step Forward"
          >
            <span className="material-symbols-outlined text-[15px]">skip_next</span>
          </button>
        </div>

        {/* Center Live Mission Telemetry Badges (Matching Image 1: Timer | 250° SW | 4.6 m/s | 20m | 1.2 m/s) */}
        <div className="flex items-center gap-2 font-mono text-[11px] bg-[#121316] px-3 py-0.5 rounded-full border border-[#2a2b30]">
          {/* Clock */}
          <div className="flex items-center gap-1 text-[#38bdf8]">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            <span className="font-bold">{flightTimeStr}</span>
          </div>
          <span className="text-slate-600">|</span>

          {/* Heading */}
          <div className="flex items-center gap-1 text-slate-200">
            <span className="material-symbols-outlined text-[14px] text-slate-400">explore</span>
            <span className="font-bold">{heading}° {getCardinal(heading)}</span>
          </div>
          <span className="text-slate-600">|</span>

          {/* Airspeed */}
          <div className="flex items-center gap-1 text-[#22c55e]">
            <span className="material-symbols-outlined text-[14px]">speed</span>
            <span className="font-bold">{speed.toFixed(1)}m/s</span>
          </div>
          <span className="text-slate-600">|</span>

          {/* Altitude */}
          <div className="flex items-center gap-1 text-white">
            <span className="material-symbols-outlined text-[14px] text-amber-400">height</span>
            <span className="font-bold">{currentAlt.toFixed(1)}m</span>
          </div>
          <span className="text-slate-600">|</span>

          {/* Vertical Climb Rate */}
          <div className={`flex items-center gap-1 font-bold ${vSpeed >= 0 ? 'text-[#22c55e]' : 'text-rose-400'}`}>
            <span className="material-symbols-outlined text-[14px]">swap_vert</span>
            <span>{vSpeed >= 0 ? `+${vSpeed.toFixed(1)}` : vSpeed.toFixed(1)}m/s</span>
          </div>
        </div>

        {/* Right Duration Clock & Collapse Toggle */}
        <div className="flex items-center gap-2">
          <div className="font-mono text-[11px] text-slate-400 hidden md:block">
            TOTAL: <span className="text-slate-200 font-bold">00:18:42</span>
          </div>
          <button
            onClick={onAbortRTL}
            className="px-2 py-0.5 rounded bg-[#b91c1c]/40 hover:bg-[#b91c1c] text-[#fca5a5] hover:text-white border border-[#b91c1c] text-[10px] font-bold uppercase transition cursor-pointer"
            title="Emergency Abort & RTL"
          >
            ABORT RTL
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white font-bold text-xs bg-[#2a2b30] hover:bg-[#34353a] transition cursor-pointer"
            title={isCollapsed ? 'Expand Dock' : 'Collapse Dock'}
          >
            {isCollapsed ? '+' : '−'}
          </button>
        </div>
      </div>

      {/* 2. MAIN BODY (Left Mission Tree + Right Elevation Profile Graph) */}
      {!isCollapsed && (
        <div className="flex flex-col md:flex-row h-28 bg-[#141518]">
          {/* Left: Mission & Waypoint Hierarchy Tree (Matching Image 1) */}
          <div className="w-full md:w-56 p-2 bg-[#121316] border-r border-[#26272c] overflow-y-auto text-[10px] font-sans scrollbar-none">
            {/* Active Vehicle Tree Node */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#2563eb]/20 text-white font-bold border-l-2 border-[#3b82f6]">
              <span className="material-symbols-outlined text-[13px] text-[#38bdf8]">expand_more</span>
              <span>Vehicle 1 (Active Unit)</span>
            </div>

            {/* Sub-node: Autonomous Mission 1 */}
            <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-slate-700/60 pl-2">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <span className="material-symbols-outlined text-[13px] text-emerald-400">route</span>
                <span>Mission 1 (Rescue Corridor)</span>
              </div>

              {/* Waypoints */}
              <div className="ml-3 flex flex-col gap-0.5 text-slate-400 text-[9px] font-mono">
                <div className="flex items-center gap-1 hover:text-white cursor-pointer">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8]" />
                  <span>WP1: Takeoff &amp; Climb (5m)</span>
                </div>
                <div className="flex items-center gap-1 hover:text-white cursor-pointer">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>WP2: Search Area Grid (20m)</span>
                </div>
                <div className="flex items-center gap-1 hover:text-white cursor-pointer">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  <span>WP3: QR Target Lock (10m)</span>
                </div>
                <div className="flex items-center gap-1 hover:text-white cursor-pointer">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  <span>WP4: P2P Runner Drop &amp; RTL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Elevation Cross-Section Chart (Matching Image 1 with Altitude & Distance Grids) */}
          <div className="flex-1 relative p-1.5 bg-[#0f1013] overflow-hidden flex flex-col justify-between">
            <svg className="w-full h-full" viewBox="0 0 400 70" preserveAspectRatio="none">
              <defs>
                {/* Elevation Path Gradient */}
                <linearGradient id="elevationGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.05" />
                </linearGradient>
              </defs>

              {/* Grid Lines: Y-Axis (Altitude 0m, 10m, 20m, 30m) */}
              <line x1="30" y1="12" x2="390" y2="12" stroke="#26272e" strokeWidth="0.8" strokeDasharray="3,3" />
              <line x1="30" y1="26" x2="390" y2="26" stroke="#26272e" strokeWidth="0.8" strokeDasharray="3,3" />
              <line x1="30" y1="40" x2="390" y2="40" stroke="#26272e" strokeWidth="0.8" strokeDasharray="3,3" />
              <line x1="30" y1="55" x2="390" y2="55" stroke="#383a42" strokeWidth="1" />

              {/* Y-Axis Labels */}
              <text x="26" y="15" fill="#64748b" fontSize="6.5" fontFamily="monospace" textAnchor="end">30m</text>
              <text x="26" y="29" fill="#64748b" fontSize="6.5" fontFamily="monospace" textAnchor="end">20m</text>
              <text x="26" y="43" fill="#64748b" fontSize="6.5" fontFamily="monospace" textAnchor="end">10m</text>
              <text x="26" y="57" fill="#64748b" fontSize="6.5" fontFamily="monospace" textAnchor="end">0m</text>

              {/* X-Axis Distance Labels (0km to 5.0km matching Image 1) */}
              <text x="35" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">0km</text>
              <text x="70" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">0.5km</text>
              <text x="105" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">1.0km</text>
              <text x="140" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">1.5km</text>
              <text x="175" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">2.0km</text>
              <text x="210" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">2.5km</text>
              <text x="245" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">3.0km</text>
              <text x="280" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">3.5km</text>
              <text x="315" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">4.0km</text>
              <text x="350" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">4.5km</text>
              <text x="385" y="66" fill="#64748b" fontSize="6" fontFamily="monospace" textAnchor="middle">5.0km</text>

              {/* Shaded Flight Corridor Area (Orange & Purple envelope matching Image 1) */}
              <polygon
                points="35,55 50,26 150,26 190,40 270,40 375,26 385,55"
                fill="url(#elevationGrad)"
              />

              {/* Outer Envelope Border (Orange) */}
              <polyline
                points="35,55 50,26 150,26 190,40 270,40 375,26 385,55"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />

              {/* Center Flight Path Line (Purple) */}
              <polyline
                points="35,55 50,26 150,26 190,40 270,40 375,26 385,55"
                fill="none"
                stroke="#c084fc"
                strokeWidth="1"
                strokeDasharray="4,2"
              />

              {/* Numbered Waypoint Circles on Graph */}
              <circle cx="50" cy="26" r="2.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="0.8" />
              <circle cx="150" cy="26" r="2.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="0.8" />
              <circle cx="190" cy="40" r="2.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="0.8" />
              <circle cx="270" cy="40" r="2.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="0.8" />
              <circle cx="375" cy="26" r="2.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="0.8" />

              {/* Current UAV Drone Animated Marker */}
              <g transform={`translate(${uavX}, ${uavY})`} className="transition-all duration-300 ease-out">
                {/* Radar pulse ring */}
                <circle cx="0" cy="0" r="4.5" fill="none" stroke="#38bdf8" strokeWidth="0.8" className="animate-ping" />
                {/* Drone Center Core */}
                <circle cx="0" cy="0" r="3" fill="#2563eb" stroke="#ffffff" strokeWidth="1" />
                {/* Drone Label */}
                <text x="0" y="-5" fill="#38bdf8" fontSize="5.5" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                  UAV {currentAlt.toFixed(1)}m
                </text>
              </g>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};
