import React, { useState } from 'react';
import { DroneTelemetry } from '../../types/mission';

interface CockpitInstrumentsPanelProps {
  telemetry: DroneTelemetry;
  flightTimeStr?: string;
  onOpenSettings?: () => void;
  className?: string;
}

export const CockpitInstrumentsPanel: React.FC<CockpitInstrumentsPanelProps> = ({
  telemetry,
  flightTimeStr = '8:42',
  onOpenSettings,
  className = ''
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'INSTRUMENTS' | 'TELEMETRY'>('INSTRUMENTS');

  const pitch = Math.max(-45, Math.min(45, telemetry.pitch || 0));
  const roll = Math.max(-60, Math.min(60, telemetry.roll || 0));
  const heading = Math.round(((telemetry.heading || 0) % 360 + 360) % 360);
  const alt = Math.max(0, telemetry.altitude || 0);
  const targetAlt = telemetry.targetAltitude || 5.0;
  const speed = Math.max(0, telemetry.groundSpeed || 0);
  const vSpeed = telemetry.verticalSpeed || 0;

  // Turn rate / bank angle
  const bankAngle = Math.round(roll);

  // Cardinal direction helper
  const getCardinal = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((deg % 360) / 45) % 8];
  };
  const cardinal = getCardinal(heading);

  // Airspeed calculations (IAS)
  const rawAirspeed = telemetry.airSpeed;
  const airspeed = Math.max(0, rawAirspeed !== undefined ? rawAirspeed : speed > 0 ? +(speed * 1.05 + 0.3).toFixed(1) : 0);
  const airspeedKmh = +(airspeed * 3.6).toFixed(1);

  return (
    <div className={`bg-[#17181b]/95 backdrop-blur-md rounded-2xl border border-[#2d2e33] shadow-2xl flex select-none text-slate-100 overflow-hidden ${className}`}>
      {/* 1. Left 28px Slim Tactical Icon Rail (Matching Image 1) */}
      <div className="w-8 shrink-0 bg-[#121316] border-r border-[#26272c] py-2 flex flex-col items-center justify-between text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Power / Ignition">
            <span className="material-symbols-outlined text-[16px]">bolt</span>
          </button>
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Compass / Navigation">
            <span className="material-symbols-outlined text-[16px]">explore</span>
          </button>
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Map Layers">
            <span className="material-symbols-outlined text-[16px]">layers</span>
          </button>
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Settings" onClick={onOpenSettings}>
            <span className="material-symbols-outlined text-[16px]">tune</span>
          </button>
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Camera / Optics">
            <span className="material-symbols-outlined text-[16px]">photo_camera</span>
          </button>
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Telemetry Radio">
            <span className="material-symbols-outlined text-[16px]">wifi</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button className="text-slate-400 hover:text-[#38bdf8] transition-colors" title="Diagnostics">
            <span className="material-symbols-outlined text-[16px]">query_stats</span>
          </button>
          <button className="text-slate-400 hover:text-white transition-colors" title="Audio Cues">
            <span className="material-symbols-outlined text-[16px]">volume_up</span>
          </button>
        </div>
      </div>

      {/* 2. Main Flight Instruments Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#18191d]">
        {/* Header Bar */}
        <div className="px-3 py-1.5 bg-[#1f2025] border-b border-[#2a2b30] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-[11px] uppercase tracking-wider font-bold text-slate-200">
              INSTRUMENTS
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Configure Flight Instruments"
              >
                <span className="material-symbols-outlined text-[15px]">settings</span>
              </button>
            )}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-white text-xs font-bold transition-colors cursor-pointer"
              title={isCollapsed ? 'Expand Instruments' : 'Collapse Instruments'}
            >
              {isCollapsed ? '+' : '−'}
            </button>
          </div>
        </div>

        {/* Sub-Header: Flight Time & Battery Strip (Matching Image 1) */}
        <div className="px-3 py-1 bg-[#141518] border-b border-[#25262b] flex items-center justify-between font-mono text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-sans">Flight Time</span>
            <span className="text-slate-200 font-bold">{flightTimeStr}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-sans">Battery</span>
            <span className="flex items-center gap-1 text-[#22c55e] font-bold">
              <span className="material-symbols-outlined text-[13px]">battery_full</span>
              <span>{telemetry.batteryPercent || 88}%</span>
            </span>
          </div>
        </div>

        {!isCollapsed && (
          <div className="p-2 grid grid-cols-2 gap-2 overflow-y-auto max-h-[290px] scrollbar-none bg-[#17181c]">
            {/* ======================================================== */}
            {/* GAUGE 1: ATTITUDE INDICATOR (Artificial Horizon)         */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Attitude</span>
              <div className="w-20 h-20 rounded-full overflow-hidden relative flex items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                {/* Horizon Disk: Sky Blue / Green Earth (Image 1 style) */}
                <div
                  className="absolute inset-0 origin-center flex flex-col transition-transform duration-75 ease-out"
                  style={{
                    transform: `rotate(${roll}deg) translateY(${pitch * -1.0}px)`
                  }}
                >
                  {/* Sky (Blue) */}
                  <div className="w-full h-1/2 bg-[#2563eb] border-b border-white" />
                  {/* Ground (Green - matching Image 1) */}
                  <div className="w-full h-1/2 bg-[#38a169]" />
                  {/* Pitch ladder markings */}
                  <div className="absolute top-[35%] left-1/2 -translate-x-1/2 w-4 h-0.5 bg-white/80" />
                  <div className="absolute top-[65%] left-1/2 -translate-x-1/2 w-4 h-0.5 bg-white/80" />
                </div>
                {/* Center Aircraft Reticle Symbol (Amber/Red wings) */}
                <div className="relative z-10 flex items-center pointer-events-none">
                  <div className="w-3 h-0.5 bg-[#f59e0b] rounded-l shadow-sm" />
                  <div className="w-2 h-2 rounded-full border-2 border-[#f59e0b] bg-transparent mx-0.5" />
                  <div className="w-3 h-0.5 bg-[#f59e0b] rounded-r shadow-sm" />
                </div>
                {/* Top bank index pointer */}
                <div className="absolute top-0.5 w-1 h-1 bg-white pointer-events-none" />
              </div>
              <span className="font-mono text-[8px] text-slate-400 mt-0.5">
                P: {pitch >= 0 ? '+' : ''}{pitch.toFixed(0)}° • R: {roll.toFixed(0)}°
              </span>
            </div>

            {/* ======================================================== */}
            {/* GAUGE 2: HEADING INDICATOR (Directional Gyro / Compass)  */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Heading</span>
              <div className="w-20 h-20 rounded-full relative flex items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                <svg className="w-full h-full p-1" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="44" stroke="#2d2e33" strokeWidth="2" />
                  {/* Cardinal Ticks */}
                  <text x="50" y="16" fill="#ef4444" fontFamily="Inter" fontSize="9" fontWeight="700" textAnchor="middle">N</text>
                  <text x="86" y="53" fill="#e2e8f0" fontFamily="Inter" fontSize="9" fontWeight="600" textAnchor="middle">E</text>
                  <text x="50" y="90" fill="#e2e8f0" fontFamily="Inter" fontSize="9" fontWeight="600" textAnchor="middle">S</text>
                  <text x="14" y="53" fill="#e2e8f0" fontFamily="Inter" fontSize="9" fontWeight="600" textAnchor="middle">W</text>
                  <line x1="50" y1="8" x2="50" y2="11" stroke="#64748b" strokeWidth="1.5" />
                  <line x1="92" y1="50" x2="89" y2="50" stroke="#64748b" strokeWidth="1.5" />
                  <line x1="50" y1="92" x2="50" y2="89" stroke="#64748b" strokeWidth="1.5" />
                  <line x1="8" y1="50" x2="11" y2="50" stroke="#64748b" strokeWidth="1.5" />
                  {/* Red Aircraft Needle (Image 1 style) */}
                  <g transform={`rotate(${heading} 50 50)`} className="transition-transform duration-100 ease-out">
                    <polygon points="50,16 46,50 54,50" fill="#ef4444" />
                    <polygon points="50,84 47,50 53,50" fill="#64748b" />
                    <circle cx="50" cy="50" r="3" fill="#0f172a" stroke="#ef4444" strokeWidth="1.5" />
                  </g>
                </svg>
              </div>
              <span className="font-mono text-[8px] text-[#38bdf8] font-bold mt-0.5">
                {heading.toString().padStart(3, '0')}° {cardinal}
              </span>
            </div>

            {/* ======================================================== */}
            {/* GAUGE 3: ALTITUDE (Altimeter Dial)                       */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Altitude</span>
              <div className="w-20 h-20 rounded-full relative flex flex-col items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                {/* Dial Tick Marks */}
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="38" stroke="#25262b" strokeWidth="4" />
                  {/* Dynamic Altitude Progress Ring */}
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    r="38"
                    stroke="#ffffff"
                    strokeDasharray={238.76}
                    strokeDashoffset={238.76 - Math.min(1, alt / 30.0) * 238.76}
                    strokeLinecap="round"
                    strokeWidth="3.5"
                    className="transition-all duration-150 ease-out"
                  />
                </svg>
                {/* Bold Digital Center Value (Matching Image 1: "20m") */}
                <div className="flex items-baseline">
                  <span className="font-mono text-[17px] font-extrabold text-white leading-none">
                    {Math.round(alt)}
                  </span>
                  <span className="font-sans text-[10px] text-slate-300 font-bold ml-0.5">m</span>
                </div>
              </div>
              <span className="font-mono text-[8px] text-slate-400 mt-0.5">
                TGT: {targetAlt.toFixed(1)}m
              </span>
            </div>

            {/* ======================================================== */}
            {/* GAUGE 4: AIR SPEED INDICATOR                             */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Air Speed</span>
              <div className="w-20 h-20 rounded-full relative flex flex-col items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="38" stroke="#25262b" strokeWidth="4" />
                  {/* Green Safe Speed Arc */}
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    r="38"
                    stroke="#22c55e"
                    strokeDasharray={238.76}
                    strokeDashoffset={100}
                    strokeWidth="3"
                  />
                  {/* Yellow / Red Caution Arc (Image 1 style) */}
                  <circle
                    cx="50"
                    cy="50"
                    fill="none"
                    r="38"
                    stroke="#ef4444"
                    strokeDasharray={238.76}
                    strokeDashoffset={210}
                    strokeWidth="3"
                  />
                </svg>
                {/* Bold Digital Center Value (Matching Image 1: "4.6 m/s") */}
                <div className="flex flex-col items-center leading-none">
                  <span className="font-mono text-[16px] font-extrabold text-white">
                    {airspeed.toFixed(1)}
                  </span>
                  <span className="font-sans text-[7px] text-slate-400 uppercase mt-0.5 font-bold">
                    m/s
                  </span>
                </div>
              </div>
              <span className="font-mono text-[8px] text-slate-400 mt-0.5">
                {airspeedKmh} km/h • GS {speed.toFixed(1)}
              </span>
            </div>

            {/* ======================================================== */}
            {/* GAUGE 5: TURN COORDINATOR / BANK ANGLE                   */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Turn Coordinator</span>
              <div className="w-20 h-20 rounded-full relative flex flex-col items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="38" stroke="#25262b" strokeWidth="3" />
                  {/* Bank index marks */}
                  <line x1="50" y1="12" x2="50" y2="18" stroke="#ffffff" strokeWidth="1.5" />
                  <line x1="28" y1="20" x2="33" y2="24" stroke="#ffffff" strokeWidth="1.5" />
                  <line x1="72" y1="20" x2="67" y2="24" stroke="#ffffff" strokeWidth="1.5" />
                  {/* Bank needle pointer */}
                  <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="20"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    transform={`rotate(${bankAngle} 50 50)`}
                    className="transition-transform duration-100 ease-out"
                  />
                  <circle cx="50" cy="50" r="4" fill="#0f172a" stroke="#ffffff" strokeWidth="1.5" />
                </svg>
                {/* Bold Digital Center Value (Matching Image 1: "-13°") */}
                <span className="font-mono text-[14px] font-extrabold text-white mt-4">
                  {bankAngle >= 0 ? `+${bankAngle}` : bankAngle}°
                </span>
              </div>
              <span className="font-mono text-[8px] text-slate-400 mt-0.5">
                {Math.abs(bankAngle) < 2 ? 'LEVEL FLIGHT' : bankAngle > 0 ? 'BANK RIGHT' : 'BANK LEFT'}
              </span>
            </div>

            {/* ======================================================== */}
            {/* GAUGE 6: VERTICAL SPEED INDICATOR (VSI Variometer)       */}
            {/* ======================================================== */}
            <div className="flex flex-col items-center bg-[#111215] rounded-lg p-1.5 border border-[#25262c] shadow-inner">
              <span className="font-sans text-[9px] font-semibold text-slate-400 mb-0.5">Vertical Speed</span>
              <div className="w-20 h-20 rounded-full relative flex flex-col items-center justify-center bg-[#1f2025] border-2 border-[#383a42] shadow-md">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="none" r="38" stroke="#25262b" strokeWidth="3" />
                  {/* Zero line */}
                  <line x1="14" y1="50" x2="22" y2="50" stroke="#ffffff" strokeWidth="2" />
                  {/* Climb / Sink Ticks */}
                  <line x1="20" y1="30" x2="26" y2="34" stroke="#64748b" strokeWidth="1.5" />
                  <line x1="20" y1="70" x2="26" y2="66" stroke="#64748b" strokeWidth="1.5" />
                  {/* VSI Needle Pointer (Clamped -90deg to +90deg) */}
                  <line
                    x1="50"
                    y1="50"
                    x2="16"
                    y2="50"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    transform={`rotate(${Math.max(-75, Math.min(75, vSpeed * 25))} 50 50)`}
                    className="transition-transform duration-100 ease-out"
                  />
                  <circle cx="50" cy="50" r="3.5" fill="#0f172a" stroke="#ffffff" strokeWidth="1.5" />
                </svg>
                {/* Bold Digital Center Value (Matching Image 1: "-1.2 m/s") */}
                <div className="flex flex-col items-center leading-none mt-2">
                  <span className={`font-mono text-[14px] font-extrabold ${vSpeed >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                    {vSpeed >= 0 ? `+${vSpeed.toFixed(1)}` : vSpeed.toFixed(1)}
                  </span>
                  <span className="font-sans text-[7px] text-slate-400 uppercase mt-0.5 font-bold">
                    m/s
                  </span>
                </div>
              </div>
              <span className="font-mono text-[8px] text-slate-400 mt-0.5">
                {vSpeed > 0.2 ? 'CLIMBING' : vSpeed < -0.2 ? 'DESCENDING' : 'LEVEL'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
