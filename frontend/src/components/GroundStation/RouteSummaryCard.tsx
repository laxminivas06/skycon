import React, { useState } from 'react';
import { GroundStationMission, ReturnBehavior } from '../../types/groundStationMap';
import { customRouteService, RouteValidationResult } from '../../services/customRouteService';
import { missionEngine } from '../../services/missionEngine';
import {
  Route,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  Trash2,
  UploadCloud,
  Edit3,
  Bookmark,
  Clock,
  Compass,
  Gauge
} from 'lucide-react';

interface RouteSummaryCardProps {
  mission: GroundStationMission | null;
  onEditRoute: () => void;
  onClearRoute: () => void;
  onReverseRoute: () => void;
  onUploadToDrone: () => void;
  onStartMission: () => void;
  isMissionActive: boolean;
  className?: string;
}

export const RouteSummaryCard: React.FC<RouteSummaryCardProps> = ({
  mission,
  onEditRoute,
  onClearRoute,
  onReverseRoute,
  onUploadToDrone,
  onStartMission,
  isMissionActive,
  className = ''
}) => {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const validation: RouteValidationResult = customRouteService.validateRoute();
  const maxDurationSec = missionEngine.getMissionDurationSeconds();

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s} sec`;
  };

  const outboundWaypointsCount = mission?.outboundWaypoints?.length || 0;
  const returnWaypointsCount = mission?.returnWaypoints?.length || 0;
  const totalWaypointsCount = mission?.waypoints?.length || 0;

  const returnLabel =
    mission?.returnBehavior === 'SAME_PATH_BACK'
      ? 'Same Path Back'
      : mission?.returnBehavior === 'CUSTOM_RETURN_PATH'
      ? 'Custom Return Path'
      : mission?.returnBehavior === 'LAND_AT_HOME'
      ? 'Land at Home'
      : 'Direct RTL to Home';

  const handleSaveRoute = () => {
    if (!mission) return;
    try {
      localStorage.setItem('SAE_SAVED_CUSTOM_ROUTE', JSON.stringify(mission));
      setSaveStatus('Route saved to browser storage ✓');
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (e) {
      setSaveStatus('Failed to save route');
    }
  };

  if (!mission || totalWaypointsCount === 0) {
    return (
      <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg font-mono select-none ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-400">
            <Route className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              CUSTOM ROUTE SUMMARY
            </span>
          </div>
          <span className="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40 font-bold">
            NO ROUTE PLANNED
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Click <span className="text-sky-300 font-bold">[ PLAN ROUTE ]</span> on the map above to draw a custom flight path.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg font-mono select-none space-y-3.5 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-500/40 text-sky-400">
            <Route className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-100 uppercase">
              CUSTOM ROUTE SUMMARY
            </span>
            <div className="text-[10px] text-slate-400">
              Planned Autonomous Navigation Profile
            </div>
          </div>
        </div>

        {/* Validation Status Pill */}
        <div className="flex items-center space-x-2 self-start sm:self-auto">
          {validation.isValid ? (
            <span className="text-[11px] font-extrabold text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded border border-emerald-500/40 flex items-center space-x-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>MISSION READY</span>
            </span>
          ) : (
            <span className="text-[11px] font-bold text-rose-400 bg-rose-950/60 px-2.5 py-0.5 rounded border border-rose-500/40 flex items-center space-x-1">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>VALIDATION ERROR</span>
            </span>
          )}
        </div>
      </div>

      {/* Grid of Key Mission Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-xs">
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Distance:</span>
          <span className="font-extrabold text-sky-300 text-sm">
            {mission.totalDistance} m
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Waypoints:</span>
          <span className="font-extrabold text-slate-100 text-sm">
            {totalWaypointsCount} <span className="text-[10px] text-slate-400 font-normal">({outboundWaypointsCount} out, {returnWaypointsCount} ret)</span>
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Cruising Altitude:</span>
          <span className="font-extrabold text-amber-300 text-sm">
            {mission.altitude} m
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Cruising Speed:</span>
          <span className="font-extrabold text-slate-100 text-sm">
            {mission.speed} m/s
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Estimated Time:</span>
          <span className="font-extrabold text-slate-100 text-sm">
            {formatDuration(mission.estimatedDuration)}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-400 uppercase font-bold block">Return Behavior:</span>
          <span className="font-extrabold text-emerald-400 truncate block text-xs mt-0.5">
            {returnLabel}
          </span>
        </div>
      </div>

      {/* Validation Failure Warning (Requirement 12) */}
      {!validation.isValid && validation.errorReason && (
        <div className="p-2.5 bg-rose-950/40 border border-rose-500/50 rounded-lg flex items-start space-x-2 text-xs text-rose-300 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <div>
            <span className="font-black text-rose-300 uppercase">❌ Mission cannot start</span>
            <p className="mt-0.5 text-rose-200">
              Reason: “{validation.errorReason}”
            </p>
          </div>
        </div>
      )}

      {/* Pre-Flight Route Confirmation Details (Requirement 24) */}
      <div className="text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-800/80">
        <div className="flex items-center space-x-2">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>
            Flight Window: <strong className="text-slate-200">{formatDuration(mission.estimatedDuration)}</strong> / Max Timeout: <strong className="text-amber-400">{formatDuration(maxDurationSec)}</strong>
          </span>
        </div>

        {saveStatus && (
          <span className="text-emerald-400 font-bold text-[10px] animate-in fade-in">
            {saveStatus}
          </span>
        )}
      </div>

      {/* Route Action Buttons (Requirement 8) */}
      <div className="flex items-center space-x-2 flex-wrap gap-1.5 pt-1">
        <button
          type="button"
          disabled={isMissionActive}
          onClick={onEditRoute}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
          title="Redraw or add to route"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Edit Route</span>
        </button>

        <button
          type="button"
          disabled={isMissionActive}
          onClick={onReverseRoute}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
          title="Reverse Outbound Waypoints"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reverse</span>
        </button>

        <button
          type="button"
          disabled={isMissionActive}
          onClick={handleSaveRoute}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50"
          title="Save Route Configuration"
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span>Save Route</span>
        </button>

        <button
          type="button"
          disabled={isMissionActive}
          onClick={onUploadToDrone}
          className="px-3 py-2 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-500/50 text-xs font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50 shadow-sm"
          title="Upload Waypoints to Pixhawk Flight Controller"
        >
          <UploadCloud className="w-3.5 h-3.5 text-sky-400" />
          <span>Send to Drone</span>
        </button>

        <button
          type="button"
          disabled={isMissionActive}
          onClick={onClearRoute}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/80 text-rose-300 border border-slate-700 hover:border-rose-500/50 text-xs font-bold uppercase flex items-center space-x-1.5 transition cursor-pointer disabled:opacity-50 ml-auto"
          title="Clear Route"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};
