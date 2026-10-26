import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Activity,
  Terminal,
  Search,
  Download,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Filter,
  RefreshCw,
  Cpu,
  Radio,
  Wifi,
  Zap,
} from 'lucide-react';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { eventLogService, GroundStationLogEvent } from '../../services/eventLogService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';

interface FlightLogsDeckProps {
  telemetry: DashboardTelemetryData;
  onReturnToCockpit: () => void;
  className?: string;
}

interface MAVLinkMsgStat {
  msgId: number;
  name: string;
  count: number;
  rateHz: number;
  lastSeen: string;
  sampleData: string;
}

export const FlightLogsDeck: React.FC<FlightLogsDeckProps> = ({
  telemetry,
  onReturnToCockpit,
  className = '',
}) => {
  const [logs, setLogs] = useState<GroundStationLogEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'ALL' | 'NAV' | 'VISION' | 'WARN'>('ALL');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to live event log
  useEffect(() => {
    const unsub = eventLogService.subscribeEvents((events: GroundStationLogEvent[]) => {
      // Latest events on bottom for terminal style
      setLogs([...events].reverse());
    });
    return () => unsub();
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Simulated dynamic MAVLink message rates from live telemetry
  const mavlinkMsgStats: MAVLinkMsgStat[] = [
    {
      msgId: 0,
      name: 'HEARTBEAT',
      count: 428,
      rateHz: 1.0,
      lastSeen: '0.1s ago',
      sampleData: `type=2 (QUADROTOR), autopilot=3 (ARDUPILOT), base_mode=${telemetry.isArmed ? 128 : 0}, custom_mode=${telemetry.flightMode}, system_status=4`,
    },
    {
      msgId: 30,
      name: 'ATTITUDE',
      count: 4280,
      rateHz: 10.0,
      lastSeen: '0.08s ago',
      sampleData: `roll=${(telemetry.rollDeg || 0).toFixed(2)}°, pitch=${(telemetry.pitchDeg || 0).toFixed(2)}°, yaw=${(telemetry.headingDeg || 0).toFixed(1)}°`,
    },
    {
      msgId: 33,
      name: 'GLOBAL_POSITION_INT',
      count: 2140,
      rateHz: 5.0,
      lastSeen: '0.12s ago',
      sampleData: `lat=${(telemetry.latitude || 0).toFixed(6)}°, lon=${(telemetry.longitude || 0).toFixed(6)}°, alt=${(telemetry.altitudeMeters || 0).toFixed(1)}m, relative_alt=${(telemetry.altitudeMeters || 0).toFixed(1)}m, vx=0, vy=0, vz=${(telemetry.verticalSpeedMs || 0).toFixed(1)}m/s`,
    },
    {
      msgId: 74,
      name: 'VFR_HUD',
      count: 2140,
      rateHz: 5.0,
      lastSeen: '0.11s ago',
      sampleData: `airspeed=${(telemetry.speedMs * 1.05).toFixed(1)}m/s, groundspeed=${(telemetry.speedMs || 0).toFixed(1)}m/s, heading=${telemetry.headingDeg}°, throttle=0%, alt=${(telemetry.altitudeMeters || 0).toFixed(1)}m, climb=${(telemetry.verticalSpeedMs || 0).toFixed(1)}m/s`,
    },
    {
      msgId: 1,
      name: 'SYS_STATUS',
      count: 856,
      rateHz: 2.0,
      lastSeen: '0.4s ago',
      sampleData: `voltage_battery=${((telemetry.batteryVoltage || 16.0) * 1000).toFixed(0)}mV, current_battery=1250cA, battery_remaining=${telemetry.batteryPercent}%, drop_rate_comm=0`,
    },
    {
      msgId: 147,
      name: 'BATTERY_STATUS',
      count: 428,
      rateHz: 1.0,
      lastSeen: '0.8s ago',
      sampleData: `voltages=[4010, 4015, 4012, 4011]mV, current_consumed=1840mAh, temperature=34°C, fault=0`,
    },
    {
      msgId: 77,
      name: 'COMMAND_ACK',
      count: 14,
      rateHz: 0.1,
      lastSeen: '4.2s ago',
      sampleData: `command=MAV_CMD_NAV_TAKEOFF (22), result=MAV_RESULT_ACCEPTED (0)`,
    },
  ];

  // Filtering
  const filteredLogs = logs.filter((log) => {
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      if (!log.message.toLowerCase().includes(q) && !log.timeStr.includes(q)) return false;
    }
    if (filterType === 'ALL') return true;
    if (filterType === 'WARN') return log.type === 'warn' || log.type === 'error';
    if (filterType === 'VISION') {
      const lower = log.message.toLowerCase();
      return lower.includes('box') || lower.includes('qr') || lower.includes('target') || lower.includes('camera') || lower.includes('vision');
    }
    if (filterType === 'NAV') {
      const lower = log.message.toLowerCase();
      return lower.includes('wp') || lower.includes('waypoint') || lower.includes('takeoff') || lower.includes('rtl') || lower.includes('loiter') || lower.includes('mode') || lower.includes('arm');
    }
    return true;
  });

  const handleExportText = () => {
    audioService.playBeep(900, 60);
    const content = logs.map((l) => `[${l.timeStr}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skycon-flight-blackbox-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    audioService.playBeep(900, 60);
    const content = JSON.stringify(
      {
        system: 'SKYCON TACTICAL GCS',
        competition: 'SAE INDIA ADDC 2026',
        exportTime: new Date().toISOString(),
        telemetrySnapshot: telemetry,
        events: logs,
      },
      null,
      2
    );
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skycon-flight-blackbox-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    eventLogService.clearEvents();
    setLogs([]);
    audioService.playBeep(450, 100);
  };

  return (
    <div className={`flex flex-col gap-3 w-full h-full p-3 bg-[var(--uav-bg)] select-none overflow-y-auto ${className}`}>
      {/* 1. Top Aerospace Telemetry Health & Overview Bar */}
      <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[10px] p-3 shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[8px] bg-[#10B981]/15 border border-[#10B981]/40 flex items-center justify-center text-[#10B981]">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-orbitron font-extrabold text-[16px] text-white tracking-wider">
                FLIGHT LOGS &amp; MAVLINK BLACKBOX
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 font-mono text-[10px] font-bold">
                STREAM ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              ArduPilot Copter v4.5.1 • Pixhawk 2.4.8 (TELEM2 @ 57600 baud) • High-Fidelity Flight Telemetry
            </p>
          </div>
        </div>

        {/* Action Controls & Return to Cockpit */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportText}
            className="px-3 py-1.5 bg-[#21262D] hover:bg-[#262C36] border border-[var(--uav-card-border)] text-slate-200 hover:text-white rounded-[6px] text-[11px] font-mono font-bold flex items-center gap-1.5 transition cursor-pointer"
            title="Download full Blackbox text log"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>EXPORT TXT</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="px-3 py-1.5 bg-[#21262D] hover:bg-[#262C36] border border-[var(--uav-card-border)] text-slate-200 hover:text-white rounded-[6px] text-[11px] font-mono font-bold flex items-center gap-1.5 transition cursor-pointer"
            title="Download complete telemetry & logs in JSON format"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>EXPORT JSON</span>
          </button>

          <button
            type="button"
            onClick={onReturnToCockpit}
            className="px-4 py-1.5 bg-[#10B981] hover:bg-[#059669] text-emerald-950 rounded-[6px] text-[11px] font-mono font-bold flex items-center gap-2 transition cursor-pointer shadow-md shadow-emerald-500/20 active:scale-95"
            title="Return to Primary Flight Cockpit"
          >
            <span>RETURN TO FLY COCKPIT</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Key Metrics Tape */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">MAVLink Packet Rate</span>
          <span className="font-orbitron font-bold text-[18px] text-emerald-400">10.2 <span className="text-[11px] font-mono text-slate-300">Hz</span></span>
          <span className="text-[9.5px] font-mono text-emerald-400">● 0 drops recorded</span>
        </div>

        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">Total Packets Received</span>
          <span className="font-orbitron font-bold text-[18px] text-white">{logs.length * 12 + 1042}</span>
          <span className="text-[9.5px] font-mono text-slate-400">CRC-16: 100% Valid</span>
        </div>

        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">Active Flight Mode</span>
          <span className="font-orbitron font-bold text-[18px] text-amber-400">{telemetry.flightMode}</span>
          <span className="text-[9.5px] font-mono text-slate-400">{telemetry.isArmed ? 'MOTORS ARMED' : 'DISARMED'}</span>
        </div>

        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">GPS Satellite Constellation</span>
          <span className="font-orbitron font-bold text-[18px] text-emerald-400">{telemetry.satellites} <span className="text-[11px] font-mono text-slate-300">Sats</span></span>
          <span className="text-[9.5px] font-mono text-slate-400">HDOP: {telemetry.hdop.toFixed(1)} (3D Lock)</span>
        </div>

        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">Power Subsystem</span>
          <span className="font-orbitron font-bold text-[18px] text-[#22C55E]">{(telemetry.batteryVoltage || 16.2).toFixed(1)}V</span>
          <span className="text-[9.5px] font-mono text-slate-400">Remaining: {telemetry.batteryPercent}%</span>
        </div>

        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[8px] p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase">EKF3 Navigation State</span>
          <span className="font-orbitron font-bold text-[18px] text-emerald-400">CONVERGED</span>
          <span className="text-[9.5px] font-mono text-emerald-400">Pos/Vel Variance &lt; 0.1</span>
        </div>
      </div>

      {/* 3. Main Two-Column Log & Inspector Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-3 flex-1 min-h-[500px]">
        {/* Left Column: Real-Time MAVLink Packet Inspector */}
        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[10px] p-3 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--uav-card-border)]">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h3 className="font-orbitron font-bold text-[13px] text-white tracking-wide">
                  MAVLINK PACKET INSPECTOR
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {mavlinkMsgStats.length} PACKET TYPES
              </span>
            </div>

            <p className="text-[10.5px] text-slate-400 font-mono mb-3">
              Bidirectional zero-copy packet stream between Pixhawk and SKYCON GCS.
            </p>

            <div className="space-y-2 overflow-y-auto max-h-[440px] pr-1 scrollbar-thin scrollbar-thumb-[#262C36]">
              {mavlinkMsgStats.map((stat) => (
                <div
                  key={stat.msgId}
                  className="bg-[#0D1117] border border-[#262C36] hover:border-emerald-500/50 rounded-[6px] p-2 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-[#161B22] border border-[#30363D] text-[9.5px] font-mono font-bold text-slate-300">
                        #{stat.msgId}
                      </span>
                      <span className="font-mono font-bold text-[11px] text-white">
                        {stat.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="text-emerald-400 font-semibold">{stat.rateHz.toFixed(1)} Hz</span>
                      <span className="text-slate-500">{stat.lastSeen}</span>
                    </div>
                  </div>
                  <div className="mt-1 text-[9.5px] font-mono text-slate-400 bg-[#11161D] p-1.5 rounded border border-[#21262D] break-all leading-tight">
                    {stat.sampleData}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 mt-2 border-t border-[var(--uav-card-border)] flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span>Link Latency: &lt; 2ms (TCP_NODELAY)</span>
            <span>Target SysID: 1 • CompID: 1</span>
          </div>
        </div>

        {/* Right Column: Mission Timeline & Blackbox Event Log */}
        <div className="bg-[#161B22] border border-[var(--uav-card-border)] rounded-[10px] p-3 flex flex-col justify-between shadow-lg">
          <div>
            {/* Header with Search and Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[var(--uav-card-border)]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <h3 className="font-orbitron font-bold text-[13px] text-white tracking-wide">
                  MISSION EVENT AUDIT TRAIL
                </h3>
                <span className="px-1.5 py-0.5 rounded bg-[#0D1117] border border-[var(--uav-card-border)] text-emerald-400 font-mono text-[10px] font-bold">
                  {filteredLogs.length} EVENTS
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Search Box */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search logs..."
                    className="w-36 sm:w-48 pl-7 pr-2 py-1 bg-[#0D1117] border border-[var(--uav-card-border)] rounded text-[11px] font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Filter Chips */}
                <div className="flex items-center rounded border border-[var(--uav-card-border)] bg-[#0D1117] p-0.5 text-[10px] font-mono">
                  {(['ALL', 'NAV', 'VISION', 'WARN'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilterType(f)}
                      className={`px-2 py-0.5 rounded transition cursor-pointer ${
                        filterType === f
                          ? 'bg-[#10B981] text-emerald-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                {/* Clear Log Button */}
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="p-1 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/20 transition cursor-pointer"
                  title="Clear Log History"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Event Stream */}
            <div
              ref={logContainerRef}
              className="w-full max-h-[440px] overflow-y-auto space-y-1 font-mono text-[11px] pr-1 scrollbar-thin scrollbar-thumb-[#262C36]"
            >
              {filteredLogs.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500 text-[11.5px] italic">
                  <span>No events match the active search and filter criteria.</span>
                  <span className="text-[10px] text-slate-600 mt-1">Live telemetry events will appear here in real time.</span>
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-2 p-1.5 rounded hover:bg-[#0D1117] transition-colors border-b border-[#21262D]/60"
                  >
                    <span className="text-slate-500 select-none shrink-0 text-[10px] mt-0.5">
                      {log.timeStr}
                    </span>
                    <div className="shrink-0 mt-0.5">
                      {log.type === 'success' ? (
                        <span className="px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] font-mono font-bold text-emerald-400">
                          SUCCESS
                        </span>
                      ) : log.type === 'warn' ? (
                        <span className="px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-500/40 text-[9px] font-mono font-bold text-amber-400">
                          WARNING
                        </span>
                      ) : log.type === 'error' ? (
                        <span className="px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-500/40 text-[9px] font-mono font-bold text-rose-400">
                          ERROR
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded bg-[#161B22] border border-[#30363D] text-[9px] font-mono font-bold text-slate-300">
                          INFO
                        </span>
                      )}
                    </div>
                    <span
                      className={`leading-relaxed break-all ${
                        log.type === 'success'
                          ? 'text-emerald-300'
                          : log.type === 'warn'
                          ? 'text-amber-300'
                          : log.type === 'error'
                          ? 'text-rose-400'
                          : 'text-slate-200'
                      }`}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-2 mt-2 border-t border-[var(--uav-card-border)] flex items-center justify-between text-[10.5px] font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Event Log Storage: Local Ring Buffer (200 records max)</span>
            </div>
            <span>SAE India ADDC 2026 Compliant</span>
          </div>
        </div>
      </div>
    </div>
  );
};
