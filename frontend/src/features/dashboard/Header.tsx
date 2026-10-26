import React, { useState, useEffect } from 'react';
import {
  Satellite,
  Gamepad2,
  Battery,
  Crosshair,
  Settings,
  LogOut,
  Play,
  Loader2,
  Wifi,
  Radio,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { DashboardTelemetryData } from '../../hooks/useDashboardTelemetry';
import { AppRole } from '../../types/mission';
import { gcsConnectionService, GCSConnectionState } from '../../services/gcsConnectionService';
import { mavlinkService } from '../../services/mavlinkService';

interface HeaderProps {
  telemetry: DashboardTelemetryData;
  missionMode?: 'MANUAL' | 'AUTONOMOUS';
  onModeChange?: (mode: 'MANUAL' | 'AUTONOMOUS') => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onOpenSettings?: () => void;
  onLogout?: () => void;
  onArmClick?: () => void;
  onToggleRC?: () => void;
  rcOverrideEnabled?: boolean;
  currentRole?: AppRole;
}

export const Header: React.FC<HeaderProps> = ({
  telemetry,
  missionMode = 'MANUAL',
  onModeChange,
  activeTab = 'Fly',
  onTabChange,
  onOpenSettings,
  onLogout,
  onArmClick,
  onToggleRC,
  rcOverrideEnabled = true,
  currentRole = 'GROUND_STATION',
}) => {
  const isArmed = telemetry.isArmed;
  const [connState, setConnState] = useState<GCSConnectionState>(() => gcsConnectionService.getState());

  useEffect(() => {
    const unsub = gcsConnectionService.subscribe((st) => {
      setConnState(st);
    });
    return () => unsub();
  }, []);

  const handleStartConnections = async () => {
    await gcsConnectionService.start();
  };

  // Helper styles for Wi-Fi Indicator (Connected / Connecting / Disconnected)
  const getWifiBadgeConfig = () => {
    if (!connState.isStarted) {
      return {
        bg: 'bg-[#161B22] border-[var(--uav-card-border)] text-slate-400',
        dot: 'bg-slate-500',
        label: 'Wi-Fi: Disconnected',
        pulse: false
      };
    }
    switch (connState.wifiStatus) {
      case 'VERIFIED':
        return {
          bg: 'bg-[#0f291e] border-[#1b4d36] text-[#22C55E]',
          dot: 'bg-[#22C55E]',
          label: 'Wi-Fi: Connected',
          pulse: true
        };
      case 'CONNECTING':
        return {
          bg: 'bg-[#2d2208] border-[#785412] text-amber-300',
          dot: 'bg-amber-400',
          label: 'Wi-Fi: Connecting',
          pulse: true
        };
      case 'FAILED':
      default:
        return {
          bg: 'bg-[#3b1212] border-[#7f1d1d] text-rose-300',
          dot: 'bg-rose-500',
          label: 'Wi-Fi: Disconnected',
          pulse: false
        };
    }
  };

  // Helper styles for MAVLink Indicator (Connected / Connecting / Disconnected)
  const getMavlinkBadgeConfig = () => {
    const isActuallyConnected = Boolean(connState.isStarted && telemetry.isConnected && connState.mavlinkStatus === 'ACTIVE');
    if (!connState.isStarted) {
      return {
        bg: 'bg-[#161B22] border-[var(--uav-card-border)] text-slate-400',
        dot: 'bg-slate-500',
        label: 'MAVLink: Disconnected',
        pulse: false
      };
    }
    if (isActuallyConnected) {
      return {
        bg: 'bg-[#0f291e] border-[#1b4d36] text-[#22C55E]',
        dot: 'bg-[#22C55E]',
        label: 'MAVLink: Connected',
        pulse: true
      };
    }
    if (connState.mavlinkStatus === 'CONNECTING' || connState.wifiStatus === 'CONNECTING' || connState.wifiStatus === 'VERIFIED') {
      return {
        bg: 'bg-[#2d2208] border-[#785412] text-amber-300',
        dot: 'bg-amber-400',
        label: 'MAVLink: Connecting',
        pulse: true
      };
    }
    return {
      bg: 'bg-[#3b1212] border-[#7f1d1d] text-rose-300',
      dot: 'bg-rose-500',
      label: 'MAVLink: Disconnected',
      pulse: false
    };
  };

  const isGpsActuallyLocked = Boolean(
    (connState.isStarted && connState.gpsStatus === 'LOCKED') ||
    telemetry.isGpsLocked ||
    telemetry.isGpsValid
  );

  // Helper styles for GPS Indicator (GPS Fix Valid / Acquiring GPS / GPS Unavailable)
  const getGpsBadgeConfig = () => {
    const satsCount = telemetry.satellites || connState.satellites || 0;
    if (isGpsActuallyLocked) {
      return {
        bg: 'bg-[#0f291e] border-[#1b4d36] text-[#22C55E]',
        dot: 'bg-[#22C55E]',
        label: `GPS: GPS Fix Valid (${satsCount} Sats)`,
        pulse: false
      };
    }
    if (!connState.isStarted && satsCount === 0) {
      return {
        bg: 'bg-[#161B22] border-[var(--uav-card-border)] text-slate-400',
        dot: 'bg-slate-500',
        label: 'GPS: GPS Unavailable',
        pulse: false
      };
    }
    if (connState.gpsStatus === 'ACQUIRING' || satsCount > 0) {
      return {
        bg: 'bg-[#2d2208] border-[#785412] text-amber-300',
        dot: 'bg-amber-400',
        label: `GPS: Acquiring GPS (${satsCount} Sats)`,
        pulse: true
      };
    }
    return {
      bg: 'bg-[#3b1212] border-[#7f1d1d] text-rose-300',
      dot: 'bg-rose-500',
      label: 'GPS: GPS Unavailable',
      pulse: false
    };
  };

  const wifiConfig = getWifiBadgeConfig();
  const mavlinkConfig = getMavlinkBadgeConfig();
  const gpsConfig = getGpsBadgeConfig();

  // Short status diagnostic string if Wi-Fi is connected but telemetry or GPS is not ready:
  // e.g. "Wi-Fi Connected | MAVLink Disconnected | GPS Acquiring"
  const isWifiConnected = connState.isStarted && connState.wifiStatus === 'VERIFIED';
  const isMavlinkConnected = Boolean(connState.isStarted && telemetry.isConnected && connState.mavlinkStatus === 'ACTIVE');
  const isGpsLocked = isGpsActuallyLocked;
  const showDiagnosticMessage = isWifiConnected && (!isMavlinkConnected || !isGpsLocked);

  const diagnosticWifiText = 'Wi-Fi Connected';
  const diagnosticMavText = isMavlinkConnected
    ? 'MAVLink Connected'
    : (connState.mavlinkStatus === 'CONNECTING' || connState.wifiStatus === 'CONNECTING' || connState.wifiStatus === 'VERIFIED')
    ? 'MAVLink Connecting'
    : 'MAVLink Disconnected';
  const diagnosticGpsText = isGpsActuallyLocked
    ? 'GPS Fix Valid'
    : (connState.gpsStatus === 'ACQUIRING' || (telemetry.satellites || connState.satellites) > 0)
    ? 'GPS Acquiring'
    : 'GPS Unavailable';
  const shortDiagnosticString = `${diagnosticWifiText} | ${diagnosticMavText} | ${diagnosticGpsText}`;

  return (
    <header className="h-[68px] w-full px-3 sm:px-4 bg-[var(--uav-header)] border-b border-[var(--uav-card-border)] flex items-center justify-between select-none shrink-0 z-40 shadow-sm gap-2">
      {/* 1. Left: Brand, Wordmark & Mode Tabs */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {/* Custom Quadcopter Glyph */}
        <div className="w-8 h-8 rounded-[8px] bg-[#161B22] border border-[#262C36] flex items-center justify-center text-emerald-400 shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 9V5" />
            <path d="M12 19v-4" />
            <path d="M9 12H5" />
            <path d="M19 12h-4" />
            <circle cx="5" cy="5" r="2" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" />
            <circle cx="19" cy="19" r="2" />
          </svg>
        </div>

        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <span className="font-orbitron font-black text-[16px] sm:text-[17px] tracking-[0.14em] text-white leading-none text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-200 to-amber-300">
              AERORECON
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-[9px] font-mono font-bold text-emerald-300 tracking-wider hidden md:inline-block">
              TACTICAL GCS
            </span>
          </div>
          <span className="text-[10px] font-mono text-[var(--uav-muted)] tracking-wider mt-0.5 hidden md:block">
            SAE INDIA ADDC 2026 • AUTONOMOUS RESCUE SYSTEM
          </span>
        </div>

        {/* Section 3: TWO PRIMARY MISSION MODES (MANUAL vs AUTONOMOUS) */}
        <div className="flex items-center bg-[#11161F] p-1 rounded-lg border border-[var(--uav-card-border)] ml-1 sm:ml-2">
          <button
            type="button"
            onClick={() => onModeChange?.('MANUAL')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[6px] text-[11px] font-bold font-sans tracking-wide transition cursor-pointer ${
              missionMode === 'MANUAL'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#161B22]'
            }`}
            title="Manual Mission Planning: Draw and customize search path on map"
          >
            <span>🧭</span>
            <span>MANUAL</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.('AUTONOMOUS')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[6px] text-[11px] font-bold font-sans tracking-wide transition cursor-pointer ${
              missionMode === 'AUTONOMOUS'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#161B22]'
            }`}
            title="Autonomous Search Mission: Generate search mission from altitude, radius, and algorithm"
          >
            <span>🤖</span>
            <span>AUTONOMOUS</span>
          </button>
        </div>
      </div>

      {/* 2. Center: START Button, Indicators & Short Diagnostic Status */}
      <div className="flex flex-col items-center justify-center gap-1 shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* START BUTTON: Operator initiates connection verification workflow */}
          <button
            type="button"
            onClick={handleStartConnections}
            disabled={connState.isInitializing}
            title={
              connState.isStarted
                ? 'Re-verify connections (Wi-Fi, MAVLink, Pixhawk GPS)'
                : 'Start GCS: Initialize and verify Wi-Fi, MAVLink, and Pixhawk GPS connections'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-bold font-sans tracking-wide transition shadow-sm cursor-pointer ${
              connState.isInitializing
                ? 'bg-amber-600/80 text-white cursor-wait'
                : connState.isStarted
                ? 'bg-[#161B22] border border-emerald-500/50 text-emerald-400 hover:bg-[#21262D]'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-950/50'
            }`}
          >
            {connState.isInitializing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                <span>INITIALIZING...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{connState.isStarted ? 'RE-VERIFY' : 'START'}</span>
              </>
            )}
          </button>

          {/* SITL Bench Simulator Toggle Button */}
          {telemetry.rawConnectionState.connectionType === 'SIMULATED' ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-cyan-500/50 bg-cyan-950/60 text-cyan-300 text-[11px] font-mono font-bold shadow-sm"
              title="Bench SITL Simulator active with simulated GPS, battery, and MAVLink"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>SITL ACTIVE</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => mavlinkService.switchToSimulationMode()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] border border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-900/50 text-cyan-400 text-[11px] font-mono font-bold transition shadow-sm cursor-pointer"
              title="Activate SITL Simulator for complete desktop testing without physical drone hardware"
            >
              <span>⚡</span>
              <span>BENCH SITL</span>
            </button>
          )}

          {/* Indicator A: Wi-Fi / Network Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[10px] sm:text-[11px] font-mono transition-colors ${wifiConfig.bg}`}
            title={
              !connState.isStarted
                ? 'Wi-Fi: Disconnected. Click START to initialize.'
                : `Network Connectivity: ${connState.wifiStatus}`
            }
          >
            <Wifi className="w-3.5 h-3.5 shrink-0" />
            <span className={`w-1.5 h-1.5 rounded-full ${wifiConfig.dot} ${wifiConfig.pulse ? 'animate-pulse' : ''}`} />
            <span className="font-semibold">{wifiConfig.label}</span>
          </div>

          {/* Indicator B: MAVLink Connection Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[10px] sm:text-[11px] font-mono transition-colors ${mavlinkConfig.bg}`}
            title={
              !connState.isStarted
                ? 'MAVLink: Disconnected. Click START to connect.'
                : `MAVLink Telemetry Bridge: ${connState.mavlinkStatus}`
            }
          >
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span className={`w-1.5 h-1.5 rounded-full ${mavlinkConfig.dot} ${mavlinkConfig.pulse ? 'animate-pulse' : ''}`} />
            <span className="font-semibold">{mavlinkConfig.label}</span>
          </div>

          {/* Indicator C: Pixhawk GPS / Satellites Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[10px] sm:text-[11px] font-mono transition-colors ${gpsConfig.bg}`}
            title={
              !connState.isStarted
                ? 'GPS: GPS Unavailable. Click START to monitor Pixhawk GPS.'
                : `Pixhawk GPS Fix: ${connState.gpsFixType} (${connState.satellites} Sats, HDOP ${connState.hdop})`
            }
          >
            <Satellite className="w-3.5 h-3.5 shrink-0" />
            <span className={`w-1.5 h-1.5 rounded-full ${gpsConfig.dot} ${gpsConfig.pulse ? 'animate-pulse' : ''}`} />
            <span className="font-semibold">{gpsConfig.label}</span>
          </div>
        </div>

        {/* Short Status Message Pill when Wi-Fi is connected but telemetry or GPS is not ready */}
        {showDiagnosticMessage && (
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-300 bg-amber-950/60 border border-amber-600/40 px-2 py-0.5 rounded animate-in fade-in">
            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
            <span className="font-semibold tracking-tight">{shortDiagnosticString}</span>
          </div>
        )}
      </div>

      {/* 3. Right: Vehicle State Pills & Settings */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Arm State Pill */}
        <button
          type="button"
          onClick={onArmClick}
          title={isArmed ? 'EMERGENCY DISARM: Click to disarm vehicle motors immediately' : 'Click to Arm Vehicle'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11px] font-semibold font-sans border transition active:scale-95 cursor-pointer ${
            isArmed
              ? 'bg-rose-950/90 border-rose-600 text-rose-200 hover:bg-rose-900 hover:text-white shadow-sm ring-1 ring-rose-500/50'
              : 'bg-[#0f291e] border-[#1b4d36] text-[#22C55E] hover:bg-[#143d2b]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isArmed ? 'bg-rose-500 animate-pulse' : 'bg-[#22C55E]'
            }`}
          />
          <span>{isArmed ? 'ARMED (CLICK TO DISARM)' : 'DISARMED'}</span>
        </button>

        {/* RC Gamepad Link Toggle Button */}
        <button
          type="button"
          onClick={onToggleRC}
          title={
            rcOverrideEnabled
              ? 'RC Manual Control: ENABLED (Click to Disable RC Override)'
              : 'RC Manual Control: DISABLED (Click to Enable RC Override)'
          }
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[11px] font-mono transition-all active:scale-95 cursor-pointer ${
            rcOverrideEnabled
              ? 'border-[#1b4d36] bg-[#0c2419] text-[#22C55E] hover:bg-[#123826]'
              : 'border-[var(--uav-card-border)] bg-[#161B22] text-slate-400 hover:text-white hover:bg-[#21262D]'
          }`}
        >
          <Gamepad2
            className={`w-3.5 h-3.5 ${
              rcOverrideEnabled ? 'text-[#22C55E]' : 'text-slate-400'
            }`}
          />
          <span className="font-semibold">
            RC: {rcOverrideEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Battery Percent & Voltage Pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border border-[var(--uav-card-border)] bg-[#161B22] text-[11px] font-mono">
          <Battery className="w-3.5 h-3.5 text-[var(--uav-amber)]" />
          <span className="text-[var(--uav-amber)] font-bold">
            {telemetry.batteryPercent}%
          </span>
          <span className="text-[var(--uav-muted)]">
            {telemetry.batteryVoltage.toFixed(1)}V
          </span>
        </div>

        {/* Settings Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Open Settings"
          aria-label="Open Settings"
          className="w-8 h-8 rounded-[8px] border border-[var(--uav-card-border)] bg-[#161B22] hover:bg-[#21262D] hover:text-white flex items-center justify-center text-[var(--uav-muted)] transition cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Optional Logout Button */}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            title="Log Out / Switch Operator"
            aria-label="Log Out / Switch Operator"
            className="w-8 h-8 rounded-[8px] border border-[var(--uav-card-border)] bg-[#161B22] hover:bg-red-950/60 hover:text-red-400 hover:border-red-500/40 flex items-center justify-center text-[var(--uav-muted)] transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
