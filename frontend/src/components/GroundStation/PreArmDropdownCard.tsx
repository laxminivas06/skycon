import React, { useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { RunnerLinkState } from '../../types/runner';
import { missionEngine } from '../../services/missionEngine';
import { mavlinkService } from '../../services/mavlinkService';
import {
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Clock,
  Radio,
  Wifi,
  Compass,
  Battery,
  Navigation,
  Smartphone,
  Cpu,
  AlertTriangle
} from 'lucide-react';

interface PreArmDropdownCardProps {
  connectionState: PixhawkConnectionState;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  runnerLink: RunnerLinkState;
  forceBypassChecks: boolean;
  onToggleForceBypass: (bypass: boolean) => void;
  className?: string;
}

export type CheckState = 'PASS' | 'FAIL' | 'WAITING';

interface ValidationItem {
  id: string;
  name: string;
  state: CheckState;
  detail: string;
  icon: React.ReactNode;
}

export const PreArmDropdownCard: React.FC<PreArmDropdownCardProps> = ({
  connectionState,
  telemetry,
  homePoint,
  runnerLink,
  forceBypassChecks,
  onToggleForceBypass,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // 1. Pixhawk Connection (Requires active live heartbeat)
  const hasHeartbeat = (connectionState.lastHeartbeat || 0) > 0 && (Date.now() - (connectionState.lastHeartbeat || 0) < 10000);
  const isPixhawkConnected = Boolean(connectionState.isConnected && hasHeartbeat);
  const pixhawkStatus: CheckState = isPixhawkConnected ? 'PASS' : (connectionState.isUsbConnected ? 'WAITING' : 'FAIL');

  // 2. MAVLink Heartbeat
  const heartbeatStatus: CheckState = hasHeartbeat ? 'PASS' : (connectionState.isUsbConnected ? 'WAITING' : 'FAIL');

  // 3. GPS Fix
  const rawFix = telemetry.gps?.fixType || '';
  const is3DFix = rawFix === '3D_FIX' || rawFix === '3D' || rawFix.includes('3D') || rawFix.includes('DGPS') || rawFix.includes('RTK');
  const hasSomeGps = (telemetry.gps?.satellites || 0) > 0 || (telemetry.latitude !== 0 && telemetry.longitude !== 0);
  const gpsFixStatus: CheckState = is3DFix ? 'PASS' : hasSomeGps ? 'WAITING' : 'FAIL';

  // 4. GPS Satellites
  const sats = telemetry.gps?.satellites || 0;
  const gpsSatStatus: CheckState = sats >= 6 ? 'PASS' : sats >= 3 ? 'WAITING' : 'FAIL';

  // 5. Home Position
  const homeStatus: CheckState = homePoint.isSet ? 'PASS' : 'WAITING';

  // 6. EKF / AHRS Status
  const isEkfOk = connectionState.ekfHealthy || (telemetry.latitude !== 0 && Math.abs(telemetry.heading) >= 0);
  const ekfStatus: CheckState = isEkfOk ? 'PASS' : isPixhawkConnected ? 'WAITING' : 'FAIL';

  // 7. Battery Status
  const batt = telemetry.batteryPercent;
  const battStatus: CheckState = batt > 25 ? 'PASS' : batt > 15 ? 'WAITING' : 'FAIL';

  // 8. ESP32 <-> Pixhawk Connection
  const esp32Status: CheckState = (isPixhawkConnected || connectionState.connectionType === 'ESP32_WEBSOCKET') ? 'PASS' : 'WAITING';

  // 9. Phone <-> ESP32 Connection
  const phoneConnected = Boolean(runnerLink && runnerLink.isConnected);
  const phoneStatus: CheckState = phoneConnected ? 'PASS' : 'WAITING';

  // 10. Flight Mode
  const activeMode = (telemetry.flightMode || '').toUpperCase();
  const validModes = ['STABILIZE', 'ALT_HOLD', 'LOITER', 'GUIDED', 'AUTO', 'RTL', 'LAND', 'POSHOLD'];
  const modeStatus: CheckState = validModes.includes(activeMode) ? 'PASS' : 'WAITING';

  // 11. Armable Status
  const failureReason = connectionState.preArmFailReason || (connectionState.lastArmCommandAck && connectionState.lastArmCommandAck.result !== 0 ? connectionState.lastArmAckResult : null);
  const isArmable = !failureReason || telemetry.isArmed || forceBypassChecks;
  const armableStatus: CheckState = telemetry.isArmed || isArmable ? 'PASS' : 'FAIL';

  const items: ValidationItem[] = [
    {
      id: 'pixhawk_conn',
      name: 'Pixhawk Connection',
      state: pixhawkStatus,
      detail: isPixhawkConnected ? 'Serial / USB Active' : 'Disconnected',
      icon: <Cpu className="w-3.5 h-3.5" />
    },
    {
      id: 'mavlink_hb',
      name: 'MAVLink Heartbeat',
      state: heartbeatStatus,
      detail: hasHeartbeat ? `${connectionState.heartbeatHz?.toFixed(1) || '1.0'} Hz` : 'No Heartbeat',
      icon: <Radio className="w-3.5 h-3.5" />
    },
    {
      id: 'gps_fix',
      name: 'GPS Fix',
      state: gpsFixStatus,
      detail: is3DFix ? '3D Fix Acquired' : rawFix ? rawFix.replace('_', ' ') : 'Acquiring Fix...',
      icon: <Navigation className="w-3.5 h-3.5" />
    },
    {
      id: 'gps_sats',
      name: 'GPS Satellites',
      state: gpsSatStatus,
      detail: `${sats} Visible (min 6)`,
      icon: <Compass className="w-3.5 h-3.5" />
    },
    {
      id: 'home_pos',
      name: 'Home Position',
      state: homeStatus,
      detail: homePoint.isSet ? `${homePoint.latitude.toFixed(5)}, ${homePoint.longitude.toFixed(5)}` : 'Reference Not Set',
      icon: <Compass className="w-3.5 h-3.5" />
    },
    {
      id: 'ekf_status',
      name: 'EKF / AHRS Status',
      state: ekfStatus,
      detail: isEkfOk ? 'Attitude & Position Aligned' : 'Initializing Filters...',
      icon: <ShieldCheck className="w-3.5 h-3.5" />
    },
    {
      id: 'battery_status',
      name: 'Battery Status',
      state: battStatus,
      detail: `${batt}% (${telemetry.batteryVoltage ? telemetry.batteryVoltage.toFixed(1) + 'V' : 'OK'})`,
      icon: <Battery className="w-3.5 h-3.5" />
    },
    {
      id: 'esp32_pixhawk',
      name: 'ESP32 ↔ Pixhawk Connection',
      state: esp32Status,
      detail: esp32Status === 'PASS' ? 'MAVLink Bridge OK' : 'Waiting for Telemetry',
      icon: <Wifi className="w-3.5 h-3.5" />
    },
    {
      id: 'phone_esp32',
      name: 'Phone ↔ ESP32 Connection',
      state: phoneStatus,
      detail: phoneConnected ? 'P2P / Relay Linked' : 'Connecting...',
      icon: <Smartphone className="w-3.5 h-3.5" />
    },
    {
      id: 'flight_mode',
      name: 'Flight Mode',
      state: modeStatus,
      detail: activeMode || 'UNKNOWN',
      icon: <Cpu className="w-3.5 h-3.5" />
    },
    {
      id: 'armable_status',
      name: 'Armable Status',
      state: armableStatus,
      detail: telemetry.isArmed ? 'ARMED' : forceBypassChecks ? 'BYPASS ACTIVE' : !failureReason ? 'Arming Allowed' : failureReason,
      icon: <ShieldAlert className="w-3.5 h-3.5" />
    }
  ];

  // Overall readiness
  const hasFailures = items.some((item) => item.state === 'FAIL');
  const hasWaiting = items.some((item) => item.state === 'WAITING');
  const isOverallReady = forceBypassChecks || (!hasFailures && !hasWaiting);

  const passedCount = items.filter((i) => i.state === 'PASS').length;

  return (
    <div className={`bg-slate-900/95 border rounded-xl overflow-hidden shadow-lg transition-all font-mono select-none ${
      isOverallReady
        ? 'border-emerald-500/50 shadow-emerald-950/20'
        : hasFailures
        ? 'border-rose-500/50 shadow-rose-950/20'
        : 'border-amber-500/40 shadow-amber-950/20'
    } ${className}`}>
      {/* Collapsed Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition"
      >
        <div className="flex items-center space-x-2.5">
          <div className={`p-1.5 rounded-lg border ${
            isOverallReady
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
              : hasFailures
              ? 'bg-rose-950/80 border-rose-500/50 text-rose-400'
              : 'bg-amber-950/80 border-amber-500/50 text-amber-400'
          }`}>
            {isOverallReady ? (
              <ShieldCheck className="w-4 h-4" />
            ) : hasFailures ? (
              <ShieldAlert className="w-4 h-4" />
            ) : (
              <Clock className="w-4 h-4" />
            )}
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-200">
              PRE-ARM CHECK
            </span>
            <span className="ml-2 text-[10px] text-slate-400 font-semibold hidden sm:inline">
              ({passedCount}/{items.length} passed)
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Status Badge */}
          <div className={`px-2.5 py-1 rounded-md text-xs font-black tracking-wider flex items-center space-x-1.5 border ${
            isOverallReady
              ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300'
              : hasFailures
              ? 'bg-rose-950/90 border-rose-400 text-rose-300'
              : 'bg-amber-950/90 border-amber-400 text-amber-300'
          }`}>
            <span>
              {isOverallReady
                ? 'READY'
                : hasFailures
                ? 'NOT READY'
                : 'WAITING'}
            </span>
            {isOverallReady ? (
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            ) : hasFailures ? (
              <X className="w-3.5 h-3.5 stroke-[3]" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
          </div>

          <button
            type="button"
            className="p-1 text-slate-400 hover:text-white transition"
            aria-label="Expand Pre-Arm Details"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-800 space-y-3 bg-slate-950/60">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className={`p-2.5 rounded-lg border flex items-start justify-between transition ${
                  item.state === 'PASS'
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : item.state === 'FAIL'
                    ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                    : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                }`}
              >
                <div className="flex items-start space-x-2 min-w-0">
                  <div className="mt-0.5 shrink-0 opacity-80">{item.icon}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-200 truncate">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {item.detail}
                    </div>
                  </div>
                </div>

                <div className="ml-2 shrink-0">
                  {item.state === 'PASS' && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-black text-xs">
                      ✓
                    </span>
                  )}
                  {item.state === 'FAIL' && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 font-black text-xs">
                      ✗
                    </span>
                  )}
                  {item.state === 'WAITING' && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-black text-xs">
                      ⏳
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Quick Bypass Toggle inside expanded card */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
            <label className="flex items-center space-x-2 cursor-pointer text-slate-400 hover:text-slate-200 select-none">
              <input
                type="checkbox"
                checked={forceBypassChecks}
                onChange={(e) => onToggleForceBypass(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
              />
              <span className="text-[11px] font-bold text-amber-300">
                Bypass Pre-Arm checks (Manual Override)
              </span>
            </label>

            {forceBypassChecks && (
              <span className="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40">
                OVERRIDE ACTIVE — Start enabled
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
