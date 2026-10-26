import React from 'react';
import { Card } from '../../../ui/Card';
import { DashboardTelemetryData } from '../../../hooks/useDashboardTelemetry';

interface InstrumentColumnProps {
  telemetry: DashboardTelemetryData;
}

const getHeadingCardinal = (deg: number): string => {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'North';
  if (norm >= 22.5 && norm < 67.5) return 'North-East';
  if (norm >= 67.5 && norm < 112.5) return 'East';
  if (norm >= 112.5 && norm < 157.5) return 'South-East';
  if (norm >= 157.5 && norm < 202.5) return 'South';
  if (norm >= 202.5 && norm < 247.5) return 'South-West';
  if (norm >= 247.5 && norm < 292.5) return 'West';
  return 'North-West';
};

export const InstrumentColumn: React.FC<InstrumentColumnProps> = ({ telemetry }) => {
  const roll = telemetry.rollDeg || 0;
  const pitch = Math.max(-45, Math.min(45, telemetry.pitchDeg || 0));
  const heading = telemetry.headingDeg || 0;
  const alt = Math.max(0, telemetry.altitudeMeters || 0);
  const spd = Math.max(0, telemetry.speedMs || 0);

  // SVG Gauge calculations (Circumference of r=32 circle is 201)
  const arcCircumference = 201;
  const altPercent = Math.min(1, alt / 50); // Scale up to 50m
  const altOffset = arcCircumference * (1 - altPercent * 0.75);

  const spdPercent = Math.min(1, spd / 15); // Scale up to 15 m/s
  const spdOffset = arcCircumference * (1 - spdPercent * 0.75);

  return (
    <div className="flex flex-col gap-3 h-[540px] w-[287px] shrink-0 select-none">
      {/* 1. PRIMARY ATTITUDE DISPLAY (PFD) (180 px) */}
      <Card
        title="ATTITUDE (PFD)"
        collapsible
        className="h-[180px] shrink-0"
        contentClassName="p-2 flex flex-col items-center justify-center relative overflow-hidden bg-[#090D12]"
      >
        <div className="w-28 h-28 rounded-full border-2 border-[var(--uav-card-border)] overflow-hidden relative shadow-[inset_0_0_12px_rgba(0,0,0,0.8)] bg-[#1c385c]">
          {/* Pitch & Roll Moving Disk */}
          <div
            className="absolute inset-[-40px] transition-transform duration-100 ease-out flex flex-col items-center justify-center pointer-events-none"
            style={{
              transform: `rotate(${-roll}deg) translateY(${pitch * 1.5}px)`,
            }}
          >
            {/* Sky (Upper half: Realistic Horizon Blue) */}
            <div className="w-full h-1/2 bg-gradient-to-b from-[#163b66] to-[#255285]" />
            {/* Horizon Separation Line (Crisp White/Amber) */}
            <div className="w-full h-[2px] bg-white shadow-[0_0_4px_#ffffff] shrink-0" />
            {/* Ground (Lower half: Terrain Earth Olive) */}
            <div className="w-full h-1/2 bg-gradient-to-b from-[#2e4a28] to-[#1c2e19]" />

            {/* Pitch Ladder Marks with Angle Numbers */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2 text-[8px] font-mono font-bold text-white/90">
              <div className="flex items-center gap-1">
                <span className="text-[7.5px] opacity-75">+20</span>
                <div className="w-8 h-[1px] bg-white/70" />
                <span className="text-[7.5px] opacity-75">+20</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7.5px] opacity-90">+10</span>
                <div className="w-14 h-[1px] bg-white/90" />
                <span className="text-[7.5px] opacity-90">+10</span>
              </div>
              <div className="w-20 h-[2px] bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]" />
              <div className="flex items-center gap-1">
                <span className="text-[7.5px] opacity-90">-10</span>
                <div className="w-14 h-[1px] bg-white/90" />
                <span className="text-[7.5px] opacity-90">-10</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7.5px] opacity-75">-20</span>
                <div className="w-8 h-[1px] bg-white/70" />
                <span className="text-[7.5px] opacity-75">-20</span>
              </div>
            </div>
          </div>

          {/* Aircraft Fixed Center Boresight Overlay (Aviation Standard Yellow Wings) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-12 h-1 bg-amber-400 rounded-full shadow-[0_0_6px_rgba(245,158,11,0.9)]" />
            <div className="w-2.5 h-2.5 rounded-full border-2 border-amber-400 bg-black/60 absolute" />
          </div>

          {/* Bank Angle Ticks at top arc (-45, -30, 0, +30, +45) */}
          <div className="absolute top-1 inset-x-0 flex justify-center items-center pointer-events-none z-10">
            <div className="w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-t-[6px] border-t-amber-400" />
          </div>
        </div>

        <div className="w-full flex justify-between items-center px-3 text-[10px] font-mono text-[var(--uav-muted)] mt-1.5">
          <span className="text-emerald-400 font-bold">ROLL {roll.toFixed(1)}°</span>
          <span className="text-amber-400 font-bold">PITCH {pitch.toFixed(1)}°</span>
        </div>
      </Card>

      {/* 2. COMPASS / HORIZONTAL SITUATION (HSI) (156 px) */}
      <Card
        title="COMPASS (HSI)"
        collapsible
        className="h-[156px] shrink-0"
        contentClassName="p-2 flex items-center justify-between overflow-hidden bg-[#090D12]"
      >
        <div className="w-24 h-24 rounded-full border-2 border-[var(--uav-card-border)] bg-[#090D12] relative flex items-center justify-center ml-2 shadow-[inset_0_0_10px_rgba(0,0,0,0.9)]">
          {/* Cardinal Labels */}
          <span className="absolute top-1 text-[9px] font-black text-rose-500 font-mono">N</span>
          <span className="absolute right-1 text-[9px] font-bold text-slate-400 font-mono">E</span>
          <span className="absolute bottom-1 text-[9px] font-bold text-slate-400 font-mono">S</span>
          <span className="absolute left-1 text-[9px] font-bold text-slate-400 font-mono">W</span>

          {/* Compass Dial Needle */}
          <div
            className="w-1.5 h-18 relative flex flex-col items-center justify-between transition-transform duration-150 ease-out"
            style={{ transform: `rotate(${heading}deg)` }}
          >
            <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[24px] border-b-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
            <div className="w-2 h-2 rounded-full bg-white z-10 border border-slate-900" />
            <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[24px] border-t-slate-400" />
          </div>
        </div>

        <div className="flex flex-col items-center justify-center pr-5">
          <span className="text-[28px] font-black text-white font-orbitron tracking-tight leading-none text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-200 to-emerald-300">
            {heading}°
          </span>
          <span className="text-[11px] text-amber-400 font-mono font-bold mt-1 tracking-wider uppercase">
            {getHeadingCardinal(heading)}
          </span>
          {/* Magnetometer Sensing Health Badge */}
          <div className="mt-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#161B22] border border-[var(--uav-card-border)] text-[9.5px] font-mono" title={`Magnetometer: ${telemetry.isCompassHealthy ? 'Healthy & Calibrated' : 'Check I2C cable / Calibrate'}`}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                telemetry.isCompassHealthy ? 'bg-emerald-400 shadow-[0_0_4px_#34d399]' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span className="text-slate-300 font-bold">
              MAG {telemetry.magFieldStrength || 480}mG
            </span>
          </div>
        </div>
      </Card>

      {/* 3. ALTITUDE & SPEED AVIONICS TAPES (181 px) */}
      <Card
        title="ALTITUDE & SPEED"
        collapsible
        className="h-[181px] shrink-0"
        contentClassName="p-2 flex items-center justify-around overflow-hidden bg-[#090D12]"
      >
        {/* Altitude Radial Gauge */}
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 relative flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 76 76">
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#21262D"
                strokeWidth="5"
              />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#E5A93C"
                strokeWidth="5"
                strokeDasharray={arcCircumference}
                strokeDashoffset={altOffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[16px] font-black font-orbitron text-white leading-none">
                {alt.toFixed(1)}
              </span>
              <span className="text-[9px] text-amber-400 font-mono font-bold mt-0.5">METERS</span>
            </div>
          </div>
          <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase mt-1">
            ALTITUDE
          </span>
          <div className="flex items-center gap-1 font-mono text-[9.5px] mt-0.5" title="Vertical Speed / Climb Rate">
            <span className="text-slate-400">V-SPD:</span>
            <span
              className={`font-bold ${
                telemetry.verticalSpeedMs > 0.2
                  ? 'text-emerald-400'
                  : telemetry.verticalSpeedMs < -0.2
                  ? 'text-amber-400'
                  : 'text-slate-300'
              }`}
            >
              {telemetry.verticalSpeedMs > 0 ? '▲+' : telemetry.verticalSpeedMs < 0 ? '▼' : ''}
              {telemetry.verticalSpeedMs.toFixed(1)} m/s
            </span>
          </div>
        </div>

        {/* Air Speed Radial Gauge */}
        <div className="flex flex-col items-center">
          <div className="w-20 h-20 relative flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 76 76">
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#21262D"
                strokeWidth="5"
              />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#10B981"
                strokeWidth="5"
                strokeDasharray={arcCircumference}
                strokeDashoffset={spdOffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[16px] font-black font-orbitron text-white leading-none">
                {spd.toFixed(1)}
              </span>
              <span className="text-[9px] text-emerald-400 font-mono font-bold mt-0.5">M / S</span>
            </div>
          </div>
          <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase mt-1">
            GROUND SPEED
          </span>
          <div className="flex items-center gap-1 font-mono text-[9.5px] mt-0.5" title="Airspeed (approx)">
            <span className="text-slate-400">AIR-SPD:</span>
            <span className="font-bold text-slate-200">
              {(telemetry.speedMs * 1.05).toFixed(1)} m/s
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};
