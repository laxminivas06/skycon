import React, { useState, useEffect } from 'react';
import { 
  DroneTelemetry, 
  MissionState 
} from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { missionEngine } from '../../services/missionEngine';
import { searchEngine, SearchEngineStatus } from '../../services/searchEngine';
import { 
  Sliders, 
  Radio, 
  Activity, 
  MapPin, 
  Compass, 
  Navigation, 
  ArrowUp, 
  ArrowDown, 
  Check, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Settings,
  Target,
  QrCode,
  Scan,
  Zap,
  Eye,
  Crosshair,
  Layers
} from 'lucide-react';

interface AutonomousMissionStatusBarProps {
  telemetry: DroneTelemetry;
  missionState: MissionState;
  pixhawkState: PixhawkConnectionState;
  onOpenConfig?: () => void;
  isAuthorizedOperator?: boolean;
}

export const AutonomousMissionStatusBar: React.FC<AutonomousMissionStatusBarProps> = ({
  telemetry,
  missionState,
  pixhawkState,
  onOpenConfig,
  isAuthorizedOperator = true
}) => {
  const config = missionEngine.getMissionConfig();
  const [isQuickAltOpen, setIsQuickAltOpen] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchEngineStatus>(searchEngine.getStatus());
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = searchEngine.subscribe((st) => {
      setSearchStatus(st);
    });
    return () => unsubscribe();
  }, []);

  const isMavlinkConnected =
    pixhawkState.isConnected &&
    (pixhawkState.bytesReceived > 0 || pixhawkState.isUsbConnected || pixhawkState.connectionType === 'SIMULATED');
  const isHeartbeatHealthy =
    pixhawkState.isReceivingTelemetry ||
    pixhawkState.heartbeatHz >= 0.5 ||
    (pixhawkState.lastHeartbeat > 0 && Date.now() - pixhawkState.lastHeartbeat < 4000) ||
    pixhawkState.connectionType === 'SIMULATED';
  const isGpsLocked = telemetry.gps.isLocked && telemetry.gps.satellites >= 6;

  const handleQuickAltitudeChange = (newAlt: number) => {
    const res = missionEngine.updateSearchAltitude(newAlt);
    if (!res.success) {
      setAltError(res.error || 'Invalid altitude');
      setTimeout(() => setAltError(null), 3000);
    } else {
      setAltError(null);
    }
  };

  // Determine High-Level Stage Badge & Colors
  const isSearching = missionState === 'SEARCHING' || searchStatus.state === 'SEARCHING';
  const isTargetDetected = searchStatus.state === 'TARGET_DETECTED' || searchStatus.state === 'INSPECTING_TARGET' || missionState === 'BOX_DETECTED';
  const isQrActive = searchStatus.state === 'QR_ACTIVE' || searchStatus.state === 'QR_CONFIRMED' || missionState === 'QR_DETECTED' || missionState === 'QR_SCANNING';

  return (
    <div className="w-full bg-slate-900/95 border border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-xl font-mono select-none space-y-2">
      {/* 1. Top Core Primary Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Dynamic Autonomous Search Stage Hero Pill */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Main State Hero */}
          <div className={`px-3 py-1.5 rounded-lg border text-xs font-black tracking-wider uppercase flex items-center space-x-2 shadow-lg ${
            isQrActive
              ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300 animate-pulse shadow-emerald-900/40'
              : isTargetDetected
              ? 'bg-amber-950/90 border-amber-400 text-amber-300 animate-pulse shadow-amber-900/40'
              : isSearching
              ? 'bg-sky-950/90 border-sky-400 text-sky-300 animate-pulse shadow-sky-900/40'
              : 'bg-slate-950 border-slate-700 text-slate-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isQrActive ? 'bg-emerald-400 animate-ping' : isTargetDetected ? 'bg-amber-400 animate-ping' : isSearching ? 'bg-sky-400 animate-ping' : 'bg-slate-500'
            }`} />
            <span>
              {isQrActive
                ? 'QR DETECTED — SCANNER ACTIVE'
                : isTargetDetected
                ? `TARGET DETECTED (${searchStatus.currentTarget?.confidence || 87}%)`
                : isSearching
                ? `SEARCHING [${config.searchAlgorithm}]`
                : missionState.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Quick Altitude Pill with + / - Buttons */}
          <div className="flex items-center space-x-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-[10px] text-slate-400 uppercase font-bold">ALT:</span>
            <span className="font-extrabold text-amber-400">{config.searchAltitude}m</span>
            <span className="text-[10px] text-slate-500">({telemetry.altitude.toFixed(1)}m)</span>

            {isAuthorizedOperator && (
              <div className="flex items-center space-x-0.5 ml-1">
                <button
                  type="button"
                  onClick={() => handleQuickAltitudeChange(Math.max(2, config.searchAltitude - 1))}
                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-black flex items-center justify-center cursor-pointer"
                  title="Lower Target Altitude by 1m"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAltitudeChange(Math.min(100, config.searchAltitude + 1))}
                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-black flex items-center justify-center cursor-pointer"
                  title="Raise Target Altitude by 1m"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {/* Object Detection Subsystem Status */}
          <div className="flex items-center space-x-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[10px] sm:text-xs">
            <Eye className={`w-3 h-3 ${searchStatus.objectDetectionActive ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="text-slate-400 font-bold uppercase hidden xs:inline">Object Detection:</span>
            <span className={`font-bold ${searchStatus.objectDetectionActive ? 'text-emerald-400' : 'text-slate-400'}`}>
              {searchStatus.objectDetectionActive ? 'ACTIVE' : 'STANDBY'}
            </span>
          </div>

          {/* QR Scanner Subsystem Status */}
          <div className="flex items-center space-x-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[10px] sm:text-xs">
            <Scan className={`w-3 h-3 ${searchStatus.qrScannerActive ? 'text-emerald-400 animate-spin' : 'text-slate-500'}`} />
            <span className="text-slate-400 font-bold uppercase hidden xs:inline">QR Scanner:</span>
            <span className={`font-bold ${searchStatus.qrScannerActive ? 'text-emerald-400' : 'text-slate-400'}`}>
              {searchStatus.qrScannerActive ? 'ACTIVE' : 'STANDBY'}
            </span>
          </div>

          {/* Camera Zoom Subsystem Status */}
          <div className="flex items-center space-x-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[10px] sm:text-xs">
            <span className="text-slate-400 font-bold uppercase">Zoom:</span>
            <span className="font-extrabold text-sky-400">{searchStatus.activeZoomLevel.toFixed(1)}x</span>
          </div>
        </div>

        {/* Right: Expandable Details & Configure Button */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
            className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs flex items-center space-x-1 transition cursor-pointer"
            title="Toggle Extended Telemetry & Search Footprint Details"
          >
            <span className="text-[10px] uppercase font-bold hidden sm:inline">Advanced</span>
            {isAdvancedExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {isAuthorizedOperator && onOpenConfig && (
            <button
              type="button"
              onClick={onOpenConfig}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-black uppercase tracking-wider flex items-center space-x-1.5 shadow-md shadow-amber-600/20 cursor-pointer shrink-0"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CONFIGURE MISSION</span>
              <span className="sm:hidden">CONFIG</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Collapsible Advanced Telemetry & Ground Footprint Calculations */}
      {isAdvancedExpanded && (
        <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px] animate-in fade-in duration-150">
          {/* Algorithm Info */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">Search Pattern</div>
            <div className="font-bold text-sky-400 mt-0.5">{config.searchAlgorithm}</div>
            <div className="text-[9px] text-slate-500">
              Lane {searchStatus.currentLane}/{searchStatus.totalLanes} (WP {searchStatus.activeWaypointIndex + 1}/{searchStatus.totalWaypoints})
            </div>
          </div>

          {/* Optical Ground Footprint */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">Ground Footprint</div>
            <div className="font-bold text-emerald-400 mt-0.5">
              {searchStatus.groundFootprint.widthMeters.toFixed(1)}m × {searchStatus.groundFootprint.heightMeters.toFixed(1)}m
            </div>
            <div className="text-[9px] text-slate-500">
              Spacing: {searchStatus.groundFootprint.effectiveLaneSpacingMeters.toFixed(1)}m (25% ovlp)
            </div>
          </div>

          {/* Search Progress */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">Search Progress</div>
            <div className="font-bold text-amber-300 mt-0.5">{searchStatus.progressPercent}% Covered</div>
            <div className="text-[9px] text-slate-500">
              {searchStatus.distanceCoveredMeters}m / {(searchStatus.distanceCoveredMeters + searchStatus.remainingDistanceMeters)}m
            </div>
          </div>

          {/* Targets Inspected */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">Targets Recorded</div>
            <div className="font-bold text-white mt-0.5">{searchStatus.targetHistory.length} Detected</div>
            <div className="text-[9px] text-slate-500">
              {searchStatus.isSuspendedForInspection ? 'Inspecting Target...' : 'Active Search Path'}
            </div>
          </div>

          {/* GPS Link */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">GPS Fix</div>
            <div className={`font-bold mt-0.5 ${isGpsLocked ? 'text-emerald-400' : 'text-amber-400'}`}>
              {isGpsLocked ? 'LOCKED (3D)' : 'ACQUIRING'}
            </div>
            <div className="text-[9px] text-slate-500">{telemetry.gps.satellites} Sats, HDOP {telemetry.gps.hdop.toFixed(1)}</div>
          </div>

          {/* MAVLink / Heartbeat */}
          <div className="bg-slate-950/90 p-2 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400 uppercase font-bold">MAVLink FC</div>
            <div className={`font-bold mt-0.5 ${isMavlinkConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isMavlinkConnected ? `${pixhawkState.heartbeatHz.toFixed(1)} Hz` : 'DISCONNECTED'}
            </div>
            <div className="text-[9px] text-slate-500">{pixhawkState.connectionType}</div>
          </div>
        </div>
      )}

      {/* Target Inspection Alert Toast */}
      {searchStatus.currentTarget && searchStatus.state === 'INSPECTING_TARGET' && (
        <div className="p-2 bg-amber-950/80 border border-amber-500/50 rounded-lg text-amber-200 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Crosshair className="w-4 h-4 text-amber-400 animate-spin" />
            <span>
              <strong>Target Inspection:</strong> Hovering at {searchStatus.currentTarget.gpsPosition.lat.toFixed(5)}, {searchStatus.currentTarget.gpsPosition.lng.toFixed(5)} ({searchStatus.currentTarget.confidence}% conf). Scanning for QR candidate...
            </span>
          </div>
          <span className="text-[10px] font-bold bg-amber-900/60 px-2 py-0.5 rounded text-amber-300">
            Zoom {searchStatus.activeZoomLevel.toFixed(1)}x
          </span>
        </div>
      )}

      {altError && (
        <div className="p-1.5 bg-rose-950/70 border border-rose-500/40 rounded text-rose-300 text-[10px] flex items-center space-x-1">
          <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
          <span>{altError}</span>
        </div>
      )}
    </div>
  );
};
