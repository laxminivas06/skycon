import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { 
  Compass, 
  ArrowUp, 
  ArrowDown, 
  Gauge, 
  Battery, 
  BatteryWarning, 
  Zap, 
  AlertTriangle,
  Radio,
  Activity,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Power,
  Play,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
import { geofenceService } from '../../services/geofenceService';

interface TelemetryPanelProps {
  telemetry: DashboardTelemetryData;
  className?: string;
  onArm?: (force?: boolean) => Promise<boolean | void>;
  onDisarm?: (force?: boolean) => Promise<boolean | void>;
  onNotification?: (msg: string) => void;
}

const getHeadingCardinal = (deg: number): string => {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'North (N)';
  if (norm >= 22.5 && norm < 67.5) return 'North-East (NE)';
  if (norm >= 67.5 && norm < 112.5) return 'East (E)';
  if (norm >= 112.5 && norm < 157.5) return 'South-East (SE)';
  if (norm >= 157.5 && norm < 202.5) return 'South (S)';
  if (norm >= 202.5 && norm < 247.5) return 'South-West (SW)';
  if (norm >= 247.5 && norm < 292.5) return 'West (W)';
  return 'North-West (NW)';
};

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ 
  telemetry, 
  className = '',
  onArm,
  onDisarm,
  onNotification
}) => {
  const [isArming, setIsArming] = useState<boolean>(false);
  const [isDisarming, setIsDisarming] = useState<boolean>(false);
  const [forceArm, setForceArm] = useState<boolean>(false);
  const [armFeedback, setArmFeedback] = useState<string | null>(null);

  const isBusy = isArming || isDisarming;

  const handleArm = async () => {
    if (telemetry.isArmed || isBusy) return;

    // Enforce Geofence Safety: Prevent arming if drone is outside configured geofence
    const geofenceCheck = geofenceService.canArmVehicle(telemetry.latitude, telemetry.longitude);
    if (!geofenceCheck.canArm && !forceArm) {
      audioService.playBeep(350, 200);
      setArmFeedback('ARM BLOCKED: Drone is outside Geofence!');
      onNotification?.(`❌ ${geofenceCheck.reason}`);
      return;
    }

    setIsArming(true);
    setArmFeedback(null);
    audioService.playBeep(850, 100);

    try {
      let success = false;
      if (onArm) {
        const res = await onArm(forceArm);
        success = res !== false;
      } else {
        success = await mavlinkService.sendArmCommand(forceArm);
      }

      if (success) {
        audioService.playBeep(1100, 150);
        setArmFeedback('Vehicle Armed — Motors spinning ✓');
        onNotification?.('Vehicle Armed — Motors spinning ✓');
      } else {
        setArmFeedback('Arm rejected by Pixhawk. Check safety switch or use Force Arm.');
        onNotification?.('Arm rejected by Pixhawk. Check safety switch, GPS 3D fix, and compass.');
      }
    } catch (err: any) {
      setArmFeedback(`Arm failed: ${err?.message || 'Check pre-arm conditions'}`);
      onNotification?.(`Arm failed: ${err?.message || 'Check pre-arm conditions'}`);
    } finally {
      setIsArming(false);
    }
  };

  const handleDisarm = async (force: boolean = forceArm) => {
    if (isBusy) return;
    setIsDisarming(true);
    setArmFeedback(null);
    audioService.playBeep(450, 120);

    try {
      let success = false;
      if (onDisarm) {
        const res = await onDisarm(force);
        success = res !== false;
      } else {
        success = await mavlinkService.sendDisarmCommand(force);
      }

      if (success) {
        audioService.playBeep(350, 150);
        setArmFeedback('Vehicle Disarmed ✓');
        onNotification?.('Vehicle Disarmed ✓');
      } else {
        setArmFeedback('Disarm rejected by Pixhawk (Use Force Disarm if landed)');
        onNotification?.('Disarm rejected by Pixhawk (Confirm vehicle is landed or use Force Disarm)');
      }
    } catch (err: any) {
      setArmFeedback(`Disarm failed: ${err?.message || 'Check connection'}`);
      onNotification?.(`Disarm failed: ${err?.message || 'Check connection'}`);
    } finally {
      setIsDisarming(false);
    }
  };

  const alt = Math.max(0, telemetry.altitudeMeters || 0);
  const heading = Math.round(telemetry.headingDeg || 0);
  const spd = Math.max(0, telemetry.speedMs || 0);
  const vSpd = telemetry.verticalSpeedMs || 0;
  const batteryPct = Math.max(0, Math.min(100, telemetry.batteryPercent ?? 0));
  const batteryVolt = telemetry.batteryVoltage || 0;
  const batteryCurrent = telemetry.rawTelemetry?.batteryCurrent || 0;

  // Arc Gauge Calculations (Circumference of r=32 is 201.06)
  const arcCircumference = 201;
  const altMax = 60; // Standard 60m field ceiling
  const altPercent = Math.min(1, alt / altMax);
  const altOffset = arcCircumference * (1 - altPercent * 0.75);

  const spdMax = 20; // Scale to 20 m/s
  const spdPercent = Math.min(1, spd / spdMax);
  const spdOffset = arcCircumference * (1 - spdPercent * 0.75);

  // Battery health thresholds
  const isBatteryLow = batteryPct > 0 && (batteryPct < 25 || (batteryVolt > 0 && batteryVolt < 10.8));
  const isBatteryCritical = batteryPct > 0 && (batteryPct < 15 || (batteryVolt > 0 && batteryVolt < 10.2));
  const isBatteryUnavailable = batteryVolt <= 0 && batteryPct <= 0;

  return (
    <div className={`flex flex-col gap-3 w-full select-none ${className}`}>
      
      {/* ------------------------------------------------------------- */}
      {/* A. ALTITUDE TELEMETRY CARD (Strictly Altitude, Not Attitude)   */}
      {/* ------------------------------------------------------------- */}
      <Card
        title="ALTITUDE"
        action={
          <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-950/40 border border-amber-500/30 px-1.5 py-0.5 rounded">
            AGL / MSL
          </span>
        }
        className="shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md"
        contentClassName="p-3 flex flex-col gap-2.5"
      >
        <div className="flex items-center justify-between">
          {/* Radial Altitude Dial */}
          <div className="w-20 h-20 relative flex items-center justify-center shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 76 76">
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#1B222D"
                strokeWidth="5.5"
              />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#F59E0B"
                strokeWidth="5.5"
                strokeDasharray={arcCircumference}
                strokeDashoffset={altOffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[18px] font-black font-orbitron text-white leading-none">
                {alt.toFixed(1)}
              </span>
              <span className="text-[8.5px] text-amber-400 font-mono font-bold mt-0.5">METERS</span>
            </div>
          </div>

          {/* Metric Details */}
          <div className="flex flex-col justify-center gap-1.5 flex-1 pl-3">
            <div>
              <span className="text-[10px] text-slate-400 font-mono block">CURRENT ALTITUDE</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-orbitron text-white">
                  {alt.toFixed(1)}
                </span>
                <span className="text-[11px] font-bold text-amber-400 font-mono">m</span>
                <span className="text-[10px] text-slate-500 font-mono ml-1">
                  ({(alt * 3.28084).toFixed(1)} ft)
                </span>
              </div>
            </div>

            {/* Vertical Climb / Descent Rate */}
            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <span className="text-slate-400 text-[10px]">V-SPEED:</span>
              <span
                className={`font-bold flex items-center gap-0.5 ${
                  vSpd > 0.2
                    ? 'text-emerald-400'
                    : vSpd < -0.2
                    ? 'text-amber-400'
                    : 'text-slate-300'
                }`}
              >
                {vSpd > 0.2 ? (
                  <ArrowUp className="w-3 h-3 text-emerald-400" />
                ) : vSpd < -0.2 ? (
                  <ArrowDown className="w-3 h-3 text-amber-400" />
                ) : null}
                {vSpd > 0 ? `+${vSpd.toFixed(1)}` : vSpd.toFixed(1)} m/s
              </span>
            </div>
          </div>
        </div>

        {/* Altitude Visual Range Bar */}
        <div className="space-y-1 pt-1 border-t border-slate-800/80">
          <div className="flex justify-between text-[9px] font-mono text-slate-400">
            <span>GROUND 0m</span>
            <span>CEILING {altMax}m</span>
          </div>
          <div className="w-full bg-[#181F2A] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-amber-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (alt / altMax) * 100)}%` }}
            />
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* B. COMPASS TELEMETRY CARD (Real-Time Heading Dial)             */}
      {/* ------------------------------------------------------------- */}
      <Card
        title="COMPASS"
        action={
          <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-950/40 border border-sky-500/30 px-1.5 py-0.5 rounded">
            MAG HEADING
          </span>
        }
        className="shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md"
        contentClassName="p-3 flex items-center justify-between gap-2"
      >
        {/* Real-Time Compass Rose with Rotating Needle */}
        <div className="w-22 h-22 rounded-full border-2 border-slate-800 bg-[#090D13] relative flex items-center justify-center shrink-0 shadow-[inset_0_0_12px_rgba(0,0,0,0.9)]">
          {/* Static Cardinal Lettering */}
          <span className="absolute top-1 text-[9px] font-black text-rose-500 font-mono">N</span>
          <span className="absolute right-1 text-[9px] font-bold text-slate-400 font-mono">E</span>
          <span className="absolute bottom-1 text-[9px] font-bold text-slate-400 font-mono">S</span>
          <span className="absolute left-1 text-[9px] font-bold text-slate-400 font-mono">W</span>

          {/* Compass Dial Needle that tracks headingDeg */}
          <div
            className="w-2 h-16 relative flex flex-col items-center justify-between transition-transform duration-150 ease-out"
            style={{ transform: `rotate(${heading}deg)` }}
          >
            {/* North Point (Red arrow with glow) */}
            <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[22px] border-b-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]" />
            <div className="w-2.5 h-2.5 rounded-full bg-white z-10 border border-slate-900" />
            {/* South Point (White/slate) */}
            <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[22px] border-t-slate-400" />
          </div>
        </div>

        {/* Heading Value & Orientation */}
        <div className="flex flex-col items-start justify-center flex-1 pl-2">
          <span className="text-[10px] text-slate-400 font-mono block">DRONE HEADING</span>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black font-orbitron text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-teal-200 to-amber-300 leading-none">
              {heading}°
            </span>
          </div>
          <span className="text-[11px] font-bold text-amber-300 font-mono uppercase mt-1">
            {getHeadingCardinal(heading)}
          </span>

          {/* Magnetometer status */}
          <div className="flex items-center gap-1.5 mt-2 text-[9.5px] font-mono text-slate-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                telemetry.isCompassHealthy ? 'bg-emerald-400 shadow-[0_0_4px_#34d399]' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span>{telemetry.isCompassHealthy ? 'CALIBRATED' : 'UNCALIBRATED'}</span>
            <span className="text-slate-500">({telemetry.magFieldStrength || 480}mG)</span>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* C. SPEED TELEMETRY CARD (Ground & Air Speed)                   */}
      {/* ------------------------------------------------------------- */}
      <Card
        title="SPEED"
        action={
          <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            GROUND SPEED
          </span>
        }
        className="shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md"
        contentClassName="p-3 flex flex-col gap-2.5"
      >
        <div className="flex items-center justify-between">
          {/* Radial Speed Dial */}
          <div className="w-20 h-20 relative flex items-center justify-center shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 76 76">
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#1B222D"
                strokeWidth="5.5"
              />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#10B981"
                strokeWidth="5.5"
                strokeDasharray={arcCircumference}
                strokeDashoffset={spdOffset}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[18px] font-black font-orbitron text-white leading-none">
                {spd.toFixed(1)}
              </span>
              <span className="text-[8.5px] text-emerald-400 font-mono font-bold mt-0.5">M / S</span>
            </div>
          </div>

          {/* Metric Details */}
          <div className="flex flex-col justify-center gap-1.5 flex-1 pl-3">
            <div>
              <span className="text-[10px] text-slate-400 font-mono block">VELOCITY</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black font-orbitron text-white">
                  {spd.toFixed(1)}
                </span>
                <span className="text-[11px] font-bold text-emerald-400 font-mono">m/s</span>
                <span className="text-[10px] text-slate-500 font-mono ml-1">
                  ({(spd * 3.6).toFixed(1)} km/h)
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>AIRSPEED (EST):</span>
              <span className="font-bold text-slate-200">
                {(spd * 1.05).toFixed(1)} m/s
              </span>
            </div>
          </div>
        </div>

        {/* Speed Visual Range Bar */}
        <div className="space-y-1 pt-1 border-t border-slate-800/80">
          <div className="flex justify-between text-[9px] font-mono text-slate-400">
            <span>0 m/s</span>
            <span>MAX {spdMax} m/s</span>
          </div>
          <div className="w-full bg-[#181F2A] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (spd / spdMax) * 100)}%` }}
            />
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* D. BATTERY TELEMETRY CARD (Percentage, Voltage, Low Warning)  */}
      {/* ------------------------------------------------------------- */}
      <Card
        title="BATTERY"
        action={
          <div className="flex items-center gap-1">
            <Battery className={`w-3.5 h-3.5 ${isBatteryLow ? 'text-rose-400' : 'text-emerald-400'}`} />
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                isBatteryCritical
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-500 animate-pulse'
                  : isBatteryLow
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-500'
                  : 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {isBatteryUnavailable ? 'NO SENSOR' : `${batteryPct}%`}
            </span>
          </div>
        }
        className={`shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md ${
          isBatteryCritical ? 'ring-1 ring-rose-500' : ''
        }`}
        contentClassName="p-3 flex flex-col gap-2.5"
      >
        {isBatteryUnavailable ? (
          <div className="p-2.5 bg-amber-950/40 border border-amber-500/50 rounded-lg text-amber-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Battery telemetry unavailable. Awaiting Pixhawk power module stream...</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 font-mono block">REMAINING CAPACITY</span>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-3xl font-black font-orbitron leading-none ${
                      isBatteryCritical
                        ? 'text-rose-500 animate-pulse'
                        : isBatteryLow
                        ? 'text-amber-400'
                        : 'text-white'
                    }`}
                  >
                    {batteryPct}%
                  </span>
                  <span className="text-[12px] font-bold text-slate-400 font-mono">
                    {batteryVolt.toFixed(1)}V
                  </span>
                </div>
              </div>

              {/* Pack Voltage & Current stats */}
              <div className="flex flex-col items-end text-[10px] font-mono text-slate-400 gap-0.5">
                <div className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span className="font-bold text-slate-200">{batteryVolt.toFixed(2)} V</span>
                </div>
                {batteryCurrent > 0 && (
                  <span className="text-slate-400">
                    DRAW: <strong className="text-slate-200">{batteryCurrent.toFixed(1)}A</strong>
                  </span>
                )}
                <span className="text-[9px] text-slate-500">
                  3S LiPo (~3.7V/Cell)
                </span>
              </div>
            </div>

            {/* Battery Level Progress Bar */}
            <div className="w-full bg-[#181F2A] h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isBatteryCritical
                    ? 'bg-rose-500 animate-pulse'
                    : isBatteryLow
                    ? 'bg-amber-400'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                }`}
                style={{ width: `${Math.max(4, Math.min(100, batteryPct))}%` }}
              />
            </div>

            {/* Low Battery Warning Banner */}
            {isBatteryLow && (
              <div className="bg-rose-950/70 border border-rose-500/70 px-2 py-1 rounded text-[10px] font-mono text-rose-200 flex items-center gap-1.5 animate-pulse">
                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                <span>LOW BATTERY: Return-to-Launch recommended</span>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ------------------------------------------------------------- */}
      {/* E. MOTOR ARM / DISARM CONTROL CARD (Dedicated Flight Control) */}
      {/* ------------------------------------------------------------- */}
      <Card
        title="MOTOR ARM / DISARM"
        action={
          <span
            className={`text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider ${
              telemetry.isArmed
                ? 'bg-rose-950/80 text-rose-300 border border-rose-500 animate-pulse'
                : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
            }`}
          >
            {telemetry.isArmed ? '● ARMED (ACTIVE)' : '○ DISARMED (SAFE)'}
          </span>
        }
        className="shrink-0 bg-[#0E131A] border-[var(--uav-card-border)] shadow-md"
        contentClassName="p-3 flex flex-col gap-2.5"
      >
        {/* Dynamic Status Banner */}
        <div
          className={`p-2 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 ${
            telemetry.isArmed
              ? 'bg-rose-950/40 border-rose-500/60 text-rose-200'
              : 'bg-[#0f291e]/50 border-[#1b4d36] text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-1.5">
            {telemetry.isArmed ? (
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="font-semibold text-white">
              {telemetry.isArmed ? 'MOTORS ARMED' : 'MOTORS DISARMED'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400">
            {telemetry.flightMode || 'DISARMED'}
          </span>
        </div>

        {/* Arm / Disarm Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          {/* ARM BUTTON */}
          <button
            type="button"
            onClick={handleArm}
            disabled={telemetry.isArmed || isBusy}
            title={
              telemetry.isArmed
                ? 'Flight controller already armed'
                : 'Send MAVLink ARM command (MAV_CMD_COMPONENT_ARM_DISARM param1=1)'
            }
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-bold text-[11px] font-sans tracking-wide uppercase transition shadow-md cursor-pointer ${
              telemetry.isArmed
                ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed border border-slate-700/60'
                : isArming
                ? 'bg-amber-600 text-white cursor-wait'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-950/50 border border-emerald-400/50'
            }`}
          >
            {isArming ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>ARMING...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>ARM MOTORS</span>
              </>
            )}
          </button>

          {/* DISARM BUTTON */}
          <button
            type="button"
            onClick={() => handleDisarm(forceArm)}
            disabled={isBusy}
            title={
              isDisarming
                ? 'Disarming vehicle motors...'
                : forceArm
                ? 'Send FORCE DISARM command (MAV_CMD_COMPONENT_ARM_DISARM param1=0 param2=21196)'
                : 'Send MAVLink DISARM command (MAV_CMD_COMPONENT_ARM_DISARM param1=0)'
            }
            className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-bold text-[11px] font-sans tracking-wide uppercase transition shadow-md cursor-pointer ${
              isDisarming
                ? 'bg-amber-600 text-white cursor-wait'
                : forceArm
                ? 'bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white shadow-rose-950/60 border border-rose-400 ring-1 ring-rose-400'
                : telemetry.isArmed
                ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-rose-950/50 border border-rose-400/50'
                : 'bg-rose-950/40 hover:bg-rose-900/60 active:bg-rose-800/80 text-rose-300 border border-rose-800/60'
            }`}
          >
            {isDisarming ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>DISARMING...</span>
              </>
            ) : (
              <>
                <Power className="w-3.5 h-3.5" />
                <span>{forceArm ? 'FORCE DISARM' : 'DISARM'}</span>
              </>
            )}
          </button>
        </div>

        {/* Bench / Field Force Arm/Disarm Bypass Option */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
          <label className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forceArm}
              onChange={(e) => setForceArm(e.target.checked)}
              disabled={isBusy}
              className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
            />
            <span className={forceArm ? 'text-amber-300 font-bold' : ''}>
              Force Bypass (Arm / Disarm)
            </span>
          </label>

          <span className="text-[9px] font-mono text-slate-500">
            {telemetry.isArmed ? 'PROPELLERS ACTIVE' : 'SAFE STANDBY'}
          </span>
        </div>

        {/* Feedback / Alert Notice */}
        {armFeedback && (
          <div className="p-1.5 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-mono text-slate-300 flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="truncate">{armFeedback}</span>
          </div>
        )}
      </Card>

    </div>
  );
};
