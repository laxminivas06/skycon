import React, { useState } from 'react';
import { PixhawkConnectionState, PixhawkStatusMessage, MAVLinkCommandAck } from '../../types/mavlink';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { mavlinkService } from '../../services/mavlinkService';
import {
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Battery,
  Compass,
  Navigation,
  Radio,
  Sliders,
  RotateCcw,
  Terminal,
  ShieldAlert,
  HelpCircle,
  Cpu
} from 'lucide-react';

interface PreArmChecksPanelProps {
  connectionState: PixhawkConnectionState;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  isReady?: boolean;
  className?: string;
}

export type PreArmCheckStatus = 'BLOCKING' | 'INFO' | 'PASS';

export interface PreArmCheckItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: PreArmCheckStatus;
  rawMessage?: string;
  timestamp?: number;
}

export const PreArmChecksPanel: React.FC<PreArmChecksPanelProps> = ({
  connectionState,
  telemetry,
  homePoint,
  isReady,
  className = ''
}) => {
  const [showStatusHistory, setShowStatusHistory] = useState(false);
  const [showArmDebug, setShowArmDebug] = useState(true);

  const activeMode = (telemetry.flightMode || 'DISARMED').toUpperCase();
  const isPosDependent = mavlinkService.isModePositionDependent(activeMode);
  const isAltHoldOrStabilize = !isPosDependent;

  // Compile full list of validation items
  const items: PreArmCheckItem[] = [];

  // 1. Connection & Heartbeat Stream Check
  if (!connectionState.isConnected) {
    items.push({
      id: 'conn_missing',
      category: 'COMMUNICATION LINK',
      title: 'MAVLink Connection & Heartbeat',
      description: 'Pixhawk flight controller is not connected or no MAVLink heartbeat received.',
      status: 'BLOCKING'
    });
  } else {
    items.push({
      id: 'conn_ok',
      category: 'COMMUNICATION LINK',
      title: 'MAVLink Telemetry Link',
      description: `Active link @ ${connectionState.baudRate} baud (SysID ${connectionState.systemId || 1}, ${connectionState.heartbeatHz || 1.0} Hz heartbeat)`,
      status: 'PASS'
    });
  }

  // 2. Hardware Pre-Arm Failures from ArduPilot STATUSTEXT
  const preArmMessages: PixhawkStatusMessage[] = (connectionState.statusHistory || []).filter((msg) => {
    const text = (msg.text || '').toLowerCase();
    return text.includes('prearm') || text.includes('arm') || text.includes('log') || text.includes('fail') || text.includes('check') || text.includes('compass') || text.includes('ahrs') || text.includes('battery') || text.includes('ekf') || text.includes('mag') || text.includes('switch');
  });

  const failureReason = connectionState.preArmFailReason || (connectionState.lastArmCommandAck && connectionState.lastArmCommandAck.result !== 0 ? (connectionState.lastArmAckResult || `Command 400 Rejected: ${connectionState.lastArmCommandAck.resultName}`) : null);

  if (failureReason && !telemetry.isArmed) {
    const lower = failureReason.toLowerCase();
    let remediation = '';
    if (lower.includes('log')) {
      remediation = ' [Remedy: Insert formatted FAT32 MicroSD card into Pixhawk, or set ARMING_CHECK = 0 in Mission Planner]';
    } else if (lower.includes('switch')) {
      remediation = ' [Remedy: Hold Pixhawk safety switch for 3 seconds until solid red]';
    } else if (lower.includes('compass')) {
      remediation = ' [Remedy: Calibrate compass in Mission Planner or move away from indoor metal objects]';
    }

    items.push({
      id: 'ardu_prearm_fail',
      category: 'ARDUPILOT FC PRE-ARM',
      title: 'Pre-Arm Safety Check Rejected by Pixhawk',
      description: `${failureReason}${remediation}`,
      rawMessage: failureReason,
      status: 'BLOCKING'
    });
  }

  // 3. Mode-Aware GPS 3D Fix Requirement
  const gpsFixType = telemetry.gps.fixType || 'NO_FIX';
  const hasGps3DFix = telemetry.gps.isLocked || (telemetry.gps.satellites >= 6 && gpsFixType !== 'NO_GPS' && gpsFixType !== 'NO_FIX');
  const fixDisplayName = gpsFixType === '3D_FIX' ? '3D' : gpsFixType.replace('_', ' ');
  const gpsSourceTag = connectionState.gpsInstances
    ? ` • Source: GPS ${connectionState.gpsInstances.activeInstance === 2 ? '2 (SERIAL4/5)' : '1'}`
    : '';

  if (isPosDependent) {
    // Position-dependent mode (e.g. AUTO, LOITER, GUIDED) REQUIRES GPS
    if (hasGps3DFix) {
      items.push({
        id: 'gps_mode_pass',
        category: 'NAVIGATION SENSORS',
        title: `GPS READY (${activeMode} Mode)`,
        description: `Satellites: ${telemetry.gps.satellites} / 7 | Fix: ${fixDisplayName} (HDOP: ${telemetry.gps.hdop.toFixed(1)})${gpsSourceTag}`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'gps_mode_blocking',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix Required for ${activeMode}`,
        description: `Position estimate unavailable (Satellites: ${telemetry.gps.satellites} / 7, Fix: ${fixDisplayName}). ${activeMode} requires a valid 3D GPS fix. Switch to STABILIZE or ALT_HOLD to arm/test without GPS.`,
        status: 'BLOCKING'
      });
    }
  } else {
    // Mode does NOT require GPS (e.g. ALT_HOLD, STABILIZE)
    if (hasGps3DFix) {
      items.push({
        id: 'gps_althold_pass',
        category: 'NAVIGATION SENSORS',
        title: `GPS READY (Optional in ${activeMode})`,
        description: `Satellites: ${telemetry.gps.satellites} / 7 | Fix: ${fixDisplayName}${gpsSourceTag}`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'gps_althold_info',
        category: 'NAVIGATION SENSORS',
        title: `GPS 3D Fix Unavailable (Not Required for ${activeMode})`,
        description: `${activeMode} is a barometric altitude-control mode. GPS position is NOT required for arming or flight.`,
        status: 'INFO'
      });
    }
  }

  // 4. Mode-Aware Home Point Requirement (Decoupled from GPS readiness)
  const hasExplicitHome = homePoint.isSet && homePoint.latitude !== 0;
  const hasVehiclePosForHome = (telemetry.latitude !== 0 && telemetry.longitude !== 0) || (telemetry.gps.latitude !== 0 && telemetry.gps.longitude !== 0);

  if (isPosDependent) {
    if (hasExplicitHome) {
      items.push({
        id: 'home_pass',
        category: 'HOME POSITION',
        title: 'Home Point Configured',
        description: `Locked at ${homePoint.latitude.toFixed(6)}, ${homePoint.longitude.toFixed(6)} (Alt: ${homePoint.altitude.toFixed(1)}m)`,
        status: 'PASS'
      });
    } else if (hasVehiclePosForHome || hasGps3DFix) {
      // Live vehicle position is available — ArduPilot / GCS auto-sets Home upon arming or via Set Home
      items.push({
        id: 'home_auto_pass',
        category: 'HOME POSITION',
        title: 'Home Position Ready (Auto-Set on Arm / Set Home)',
        description: `Live position available (${(telemetry.latitude || telemetry.gps.latitude).toFixed(6)}, ${(telemetry.longitude || telemetry.gps.longitude).toFixed(6)}). Autopilot sets Home origin automatically upon arming or via "Set Home Point".`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'home_blocking',
        category: 'HOME POSITION',
        title: `Home Point Required for ${activeMode}`,
        description: `Home position is not set. Position-dependent mode (${activeMode}) requires a valid home origin or live GPS lock for navigation and RTL.`,
        status: 'BLOCKING'
      });
    }
  } else {
    if (hasExplicitHome || hasVehiclePosForHome) {
      items.push({
        id: 'home_opt_pass',
        category: 'HOME POSITION',
        title: `Home Point Configured (${activeMode})`,
        description: hasExplicitHome
          ? `Home origin set at ${homePoint.latitude.toFixed(6)}, ${homePoint.longitude.toFixed(6)}`
          : `Live position available for Home origin.`,
        status: 'PASS'
      });
    } else {
      items.push({
        id: 'home_opt_info',
        category: 'HOME POSITION',
        title: `Home Point Not Set (Not Required for ${activeMode})`,
        description: `${activeMode} mode does not use autonomous waypoints or automatic RTL, so home point is optional.`,
        status: 'INFO'
      });
    }
  }

  // 5. Battery Telemetry (Display exact reported values from Pixhawk without fabricating)
  const isBatteryReported = telemetry.batteryVoltage > 0;
  if (isBatteryReported) {
    if (telemetry.batteryVoltage < 10.5 && telemetry.batteryVoltage > 5.0) {
      items.push({
        id: 'batt_low',
        category: 'POWER SYSTEM',
        title: 'Battery Voltage Low',
        description: `Pixhawk reports ${telemetry.batteryVoltage.toFixed(2)} V (${telemetry.batteryPercent}%). Pre-arm battery check threshold may trigger rejection. Verify physical pack voltage and power module calibration.`,
        status: 'BLOCKING'
      });
    } else {
      items.push({
        id: 'batt_ok',
        category: 'POWER SYSTEM',
        title: 'Battery Voltage Telemetry',
        description: `Reported by Pixhawk: ${telemetry.batteryVoltage.toFixed(2)} V (${telemetry.batteryPercent}%)`,
        status: 'PASS'
      });
    }
  } else {
    items.push({
      id: 'batt_unknown',
      category: 'POWER SYSTEM',
      title: 'Battery Telemetry',
      description: 'No battery voltage reported from flight controller power module.',
      status: 'INFO'
    });
  }

  // 6. RC Radio / Failsafe Status
  const isRadioFailsafe = (connectionState.preArmFailReason || '').toLowerCase().includes('radio failsafe') ||
                          (connectionState.preArmFailReason || '').toLowerCase().includes('rc / radio');
  if (isRadioFailsafe) {
    items.push({
      id: 'rc_failsafe_blocking',
      category: 'RC / RADIO LINK',
      title: 'Radio Failsafe Active (Pixhawk Disarmed)',
      description: 'Pixhawk detected no RC signal. If using RC controller: turn transmitter ON and calibrate sticks. If flying autonomous GCS/bench without RC: set FS_THR_ENABLE = 0 and ARMING_CHECK = 0 in Mission Planner.',
      status: 'BLOCKING'
    });
  } else if (connectionState.rcSignalDetected) {
    items.push({
      id: 'rc_ok',
      category: 'RC / RADIO LINK',
      title: 'RC Signal Detected',
      description: `RC transmitter communication active (RSSI: ${telemetry.rcRssi || 'OK'}).`,
      status: 'PASS'
    });
  } else {
    items.push({
      id: 'rc_info',
      category: 'RC / RADIO LINK',
      title: 'RC Controller / GCS Mode',
      description: 'If operating without physical RC controller, ensure FS_THR_ENABLE = 0 and ARMING_CHECK = 0 are configured in Mission Planner.',
      status: 'INFO'
    });
  }

  // Exact Counter Metrics (Replaces misleading "0 errors" with transparent telemetry stats)
  const preArmFailuresCount = preArmMessages.length + (connectionState.preArmFailReason ? 1 : 0);
  const totalPixhawkMessages = connectionState.statusHistory?.length || 0;
  const ackFailuresCount = (connectionState.commandAckHistory || []).filter((ack) => ack.result !== 0).length;

  const blockingCount = items.filter((i) => i.status === 'BLOCKING').length;
  const infoCount = items.filter((i) => i.status === 'INFO').length;
  const passCount = items.filter((i) => i.status === 'PASS').length;

  // Last Command ACK details
  const lastAck: MAVLinkCommandAck | undefined = connectionState.lastCommandAck;
  const latestStatustext = connectionState.latestStatusMessage?.text ||
    (connectionState.statusHistory && connectionState.statusHistory.length > 0 ? connectionState.statusHistory[0].text : undefined);

  return (
    <div className={`bg-slate-900/95 rounded-2xl p-3 sm:p-4.5 border border-slate-800 shadow-xl font-mono space-y-3 ${className}`}>

      {/* Panel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs sm:text-sm font-black uppercase text-white tracking-wider">
            PRE-ARM VALIDATION &amp; ARDUPILOT CHECKS
          </span>
        </div>

        {/* Flight Mode Indicator */}
        <div className="flex items-center space-x-1.5 text-[10px]">
          <span className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/50 text-purple-300 font-bold">
            MODE: {activeMode}
          </span>
          {blockingCount > 0 ? (
            <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-500/60 text-rose-300 font-black flex items-center space-x-1">
              <XCircle className="w-3 h-3 text-rose-400" />
              <span>{blockingCount} BLOCKING</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-black flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>ALL PASSED</span>
            </span>
          )}
          {infoCount > 0 && (
            <span className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/50 text-sky-300 font-bold">
              {infoCount} INFO
            </span>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* EXPLICIT METRIC COUNTERS (SECTION 6: REPLACES MISLEADING "0 ERRORS")      */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className={`p-2 rounded-xl border flex flex-col justify-between ${preArmFailuresCount > 0
            ? 'bg-rose-950/40 border-rose-500/60 text-rose-300'
            : 'bg-slate-950/80 border-slate-800 text-slate-300'
          }`}>
          <span className="text-[9px] uppercase text-slate-400 font-bold">Pre-arm failures</span>
          <span className={`text-sm sm:text-base font-black mt-0.5 ${preArmFailuresCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {preArmFailuresCount}
          </span>
        </div>

        <div className="p-2 rounded-xl border bg-slate-950/80 border-slate-800 text-slate-300 flex flex-col justify-between">
          <span className="text-[9px] uppercase text-slate-400 font-bold">Pixhawk messages</span>
          <span className="text-sm sm:text-base font-black text-sky-400 mt-0.5">
            {totalPixhawkMessages}
          </span>
        </div>

        <div className={`p-2 rounded-xl border flex flex-col justify-between ${ackFailuresCount > 0
            ? 'bg-amber-950/40 border-amber-500/60 text-amber-300'
            : 'bg-slate-950/80 border-slate-800 text-slate-300'
          }`}>
          <span className="text-[9px] uppercase text-slate-400 font-bold">Command ACK failures</span>
          <span className={`text-sm sm:text-base font-black mt-0.5 ${ackFailuresCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {ackFailuresCount}
          </span>
        </div>
      </div>

      {/* Flight Mode Behavioral Banner */}
      {isAltHoldOrStabilize ? (
        <div className="p-2.5 bg-sky-950/40 border border-sky-500/30 rounded-xl text-xs text-sky-200 flex items-start space-x-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <strong className="text-sky-300">{activeMode} Mode Active:</strong> Barometric altitude-stabilized flight. GPS 3D position lock and Home Point are <strong>not required</strong> for arming.
          </div>
        </div>
      ) : (
        <div className="p-2.5 bg-purple-950/40 border border-purple-500/30 rounded-xl text-xs text-purple-200 flex items-start space-x-2">
          <Navigation className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            <strong className="text-purple-300">{activeMode} Mode Active:</strong> Autonomous navigation &amp; position holding. GPS 3D fix &amp; Home Point are <strong>mandatory</strong> before arming.
          </div>
        </div>
      )}

      {/* Responsive Pre-Arm Items List (No height clipping, text wraps naturally) */}
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`p-3 rounded-xl border transition flex flex-col space-y-1.5 ${item.status === 'BLOCKING'
                ? 'bg-rose-950/30 border-rose-500/60 text-rose-200'
                : item.status === 'INFO'
                  ? 'bg-sky-950/20 border-sky-500/40 text-sky-200'
                  : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
              }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center space-x-2 min-w-0">
                {item.status === 'BLOCKING' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : item.status === 'INFO' ? (
                  <Info className="w-4 h-4 text-sky-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-xs font-black text-white uppercase tracking-wide">
                  {item.title}
                </span>
              </div>

              {/* Status Badge */}
              <span className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase shrink-0 ${item.status === 'BLOCKING'
                  ? 'bg-rose-950 border-rose-500 text-rose-300'
                  : item.status === 'INFO'
                    ? 'bg-sky-950 border-sky-500 text-sky-300'
                    : 'bg-emerald-950 border-emerald-500 text-emerald-300'
                }`}>
                {item.status}
              </span>
            </div>

            {/* Full Message Text without Truncation (Section 9) */}
            <p
              className="text-[11px] leading-relaxed text-slate-300"
              style={{
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word'
              }}
            >
              {item.description}
            </p>
          </div>
        ))}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 10 & 11: MAVLink ARM DEBUG & ACK DIAGNOSTICS (COLLAPSIBLE)       */}
      {/* ========================================================================= */}
      <div className="pt-2 border-t border-slate-800">
        <button
          onClick={() => setShowArmDebug(!showArmDebug)}
          className="text-[11px] text-slate-300 hover:text-white flex items-center justify-between w-full py-1.5 cursor-pointer font-bold"
        >
          <span className="flex items-center space-x-1.5">
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>MAVLink ARM DEBUG &amp; ACK DIAGNOSTICS</span>
          </span>
          {showArmDebug ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showArmDebug && (
          <div className="mt-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] space-y-2.5">

            {/* Section 10 Live Diagnostics Grid: 2-column desktop / 1-column mobile */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
              {/* 1. Pixhawk Connection & Heartbeat */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">Pixhawk Link</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    SYSID: <span className="text-purple-300 font-bold">{connectionState.systemId ?? 1}</span> | COMP: <span className="text-purple-300 font-bold">{connectionState.componentId ?? 1}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${connectionState.isConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'}`}>
                    {connectionState.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
                  </span>
                  <div className="text-[9px] text-slate-400 mt-0.5">
                    Heartbeat: {connectionState.lastHeartbeat > 0 ? 'RECEIVED' : 'WAITING'}
                  </div>
                </div>
              </div>

              {/* 2. WebSocket State */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">WebSocket Link</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    {connectionState.portOrAddress || 'ws://192.168.31.194:8080'}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${connectionState.isUsbConnected || connectionState.isConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`}>
                  {connectionState.isUsbConnected || connectionState.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
                </span>
              </div>

              {/* 3. Browser TX & WebSocket TX */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">Browser &amp; WS TX</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    Transport: {connectionState.bytesSent} bytes transmitted
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${connectionState.isUsbConnected || connectionState.isConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'}`}>
                  Browser TX: PASS
                </span>
              </div>

              {/* 4. ESP32 WS RX & Pixhawk TX */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">ESP32 &amp; Pixhawk TX</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    RX: {connectionState.bytesReceived} B | TX: {connectionState.bytesSent} B
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${connectionState.bytesSent > 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-amber-950 text-amber-300 border border-amber-500/40'}`}>
                  Pixhawk TX: {connectionState.bytesSent > 0 ? 'PASS' : 'IDLE'}
                </span>
              </div>

              {/* 5. Last Command & Parameters */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">Last Command Sent</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    CMD: <span className="text-sky-300 font-bold">{connectionState.lastSentCommandId ?? 400}</span> | Param1: <span className="text-sky-300 font-bold">{connectionState.lastCommandName === 'ARM' ? '1.0' : connectionState.lastCommandName === 'DISARM' ? '0.0' : '—'}</span> | Param2: <span className="text-sky-300 font-bold">0.0</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-slate-800 text-sky-300 border border-slate-700">
                  {connectionState.lastCommandName || 'MAV_CMD_ARM'}
                </span>
              </div>

              {/* 6. Last COMMAND_ACK & Vehicle State */}
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-slate-400 uppercase font-bold">ACK &amp; Vehicle State</div>
                  <div className="text-slate-300 font-mono mt-0.5">
                    ACK: <span className="text-amber-300 font-bold">{lastAck ? `${lastAck.resultName} (${lastAck.result})` : 'NONE'}</span>
                  </div>
                </div>
                <span className={`px-2.5 py-0.5 rounded text-[9px] font-black uppercase border ${telemetry.isArmed ? 'bg-emerald-950 text-emerald-300 border-emerald-400' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {telemetry.isArmed ? 'ARMED' : (connectionState.vehicleState || 'DISARMED')}
                </span>
              </div>
            </div>

            {/* TX ARM COMMAND Details */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] font-bold text-sky-400 uppercase">
                <span>TX: MAV_CMD_COMPONENT_ARM_DISARM (400)</span>
                <span className="text-slate-400">Target: SysID {connectionState.systemId || 1}, CompID {connectionState.componentId || 1}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px] text-slate-300">
                <div><strong>Command:</strong> 400 (ARM_DISARM)</div>
                <div><strong>Action:</strong> ARM</div>
                <div><strong>Param1:</strong> 1.0 (ARM)</div>
                <div><strong>Param2:</strong> 0.0 (Standard)</div>
              </div>
              {connectionState.lastArmPacketHex && (
                <div className="mt-1 pt-1 border-t border-slate-800/80 font-mono text-[9px] text-emerald-300 break-all select-all">
                  <span className="text-slate-500 font-bold uppercase mr-1">HEX:</span>
                  {connectionState.lastArmPacketHex}
                </div>
              )}
            </div>

            {/* RX ARM COMMAND_ACK */}
            <div className={`p-2 rounded-lg border space-y-1 ${!connectionState.lastArmCommandAck
                ? 'bg-slate-900 border-slate-800 text-slate-400'
                : connectionState.lastArmCommandAck.result === 0
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase">
                <span>RX: ARM COMMAND_ACK (Command 400)</span>
                {connectionState.lastArmCommandAck && <span>{new Date(connectionState.lastArmCommandAck.timestamp).toLocaleTimeString()}</span>}
              </div>
              {connectionState.lastArmCommandAck ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px]">
                  <div><strong>Command:</strong> 400 (MAV_CMD_COMPONENT_ARM_DISARM)</div>
                  <div>
                    <strong>Result:</strong>{' '}
                    <span className={`font-black ${connectionState.lastArmCommandAck.result === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {connectionState.lastArmCommandAck.resultName} ({connectionState.lastArmCommandAck.result})
                    </span>
                  </div>
                  {connectionState.lastArmCommandAck.resultParam2 !== undefined && (
                    <div><strong>Result Param2:</strong> {connectionState.lastArmCommandAck.resultParam2}</div>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 italic">
                  No COMMAND_ACK received for command 400 yet. Press ARM to send.
                </div>
              )}
            </div>

            {/* RX HEARTBEAT ARMED STATE */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between text-[10px]">
              <div>
                <span className="text-slate-400 font-bold uppercase">RX: HEARTBEAT ARMED STATE</span>
                <div className="text-slate-300 mt-0.5">
                  Bitmask: <code>(HEARTBEAT.base_mode &amp; MAV_MODE_FLAG_SAFETY_ARMED (128)) !== 0</code>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded font-black text-xs border ${telemetry.isArmed
                  ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                {telemetry.isArmed ? 'ARMED (TRUE)' : 'DISARMED (FALSE)'}
              </span>
            </div>

            {/* RX STATUSTEXT / PRE-ARM FAILURES */}
            <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
              <div className="text-[10px] font-bold text-purple-400 uppercase">
                RX: LAST STATUSTEXT MESSAGE
              </div>
              <p
                className="text-[11px] leading-relaxed text-slate-200"
                style={{
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word'
                }}
              >
                {latestStatustext ? latestStatustext : 'No STATUSTEXT reason received from Pixhawk.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ArduPilot Live STATUSTEXT Feed (Expandable, newest first) */}
      <div className="pt-1 border-t border-slate-800">
        <button
          onClick={() => setShowStatusHistory(!showStatusHistory)}
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full py-1 cursor-pointer"
        >
          <span className="flex items-center space-x-1.5 font-bold">
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            <span>ArduPilot STATUSTEXT Stream ({connectionState.statusHistory?.length || 0} messages)</span>
          </span>
          {showStatusHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showStatusHistory && (
          <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {(!connectionState.statusHistory || connectionState.statusHistory.length === 0) ? (
              <div className="text-[10px] text-slate-500 p-2 bg-slate-950 rounded-lg text-center">
                No STATUSTEXT messages received from Pixhawk yet.
              </div>
            ) : (
              connectionState.statusHistory.slice(0, 10).map((msg) => (
                <div
                  key={msg.id}
                  className={`p-2 rounded-lg text-[10px] border flex items-start space-x-2 ${msg.severityLevel <= 3
                      ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                      : msg.severityLevel === 4
                        ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                >
                  <span className="font-bold uppercase text-[9px] px-1 py-0.5 rounded bg-slate-900 border border-slate-700 shrink-0">
                    {msg.severity}
                  </span>
                  <span
                    className="flex-1 leading-relaxed"
                    style={{
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word'
                    }}
                  >
                    {msg.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
