import React, { useState, useEffect } from 'react';
import { AutonomousMissionConfig, SearchAlgorithmType } from '../../types/mission';
import { missionEngine } from '../../services/missionEngine';
import { circleTestService } from '../../services/circleTestService';
import { customRouteService } from '../../services/customRouteService';
import {
  Sliders,
  ChevronDown,
  ChevronUp,
  MapPin,
  Compass,
  RotateCw,
  Clock,
  Gauge,
  ArrowUpRight,
  ShieldCheck,
  Check,
  Route
} from 'lucide-react';

interface MissionConfigurationCardProps {
  missionConfig: AutonomousMissionConfig;
  onUpdateConfig: (partial: Partial<AutonomousMissionConfig>) => void;
  isMissionActive: boolean;
  className?: string;
}

export const MissionConfigurationCard: React.FC<MissionConfigurationCardProps> = ({
  missionConfig,
  onUpdateConfig,
  isMissionActive,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // Mission Type (Requirement 29: Custom Route as primary default)
  const [missionType, setMissionType] = useState<string>('Custom Route');

  // Custom Route Parameters (Requirements 5, 6, 7)
  const [waypointSpacing, setWaypointSpacing] = useState<number>(() => customRouteService.getWaypointSpacing());
  const [customAltitude, setCustomAltitude] = useState<number>(() => customRouteService.getMissionAltitude());
  const [customSpeed, setCustomSpeed] = useState<number>(() => customRouteService.getMissionSpeed());
  const [allowPerWaypointAlt, setAllowPerWaypointAlt] = useState<boolean>(() => customRouteService.getAllowPerWaypointAltitude());

  // Circle state
  const circleState = circleTestService.getState();
  const [circleEnabled, setCircleEnabled] = useState<boolean>(() => {
    return (
      missionConfig.searchBoundary.type === 'CIRCLE' ||
      circleState.isExecuting ||
      Boolean(circleState.circleRadiusMeters && circleState.circleRadiusMeters > 0)
    );
  });
  const [circleRadius, setCircleRadius] = useState<number>(circleState.circleRadiusMeters || 20);
  const [circleTurns, setCircleTurns] = useState<number>(circleState.totalLaps || 1);

  // Search parameters
  const [searchPattern, setSearchPattern] = useState<SearchAlgorithmType>(missionConfig.searchAlgorithm || 'GRID');
  const [searchDirection, setSearchDirection] = useState<'Horizontal' | 'Vertical'>('Horizontal');
  const [searchSpacing, setSearchSpacing] = useState<number>(missionConfig.gridSpacingMeters || 8);
  const [searchAltitude, setSearchAltitude] = useState<number>(missionConfig.searchAltitude || 15);
  const [searchSpeed, setSearchSpeed] = useState<number>(missionConfig.flightSpeedMs || 3.5);
  const [qrTimeout, setQrTimeout] = useState<number>(missionConfig.inspectionHoverSeconds ? missionConfig.inspectionHoverSeconds * 3 : 15);
  const [missionDurationMins, setMissionDurationMins] = useState<number>(
    Math.round(missionEngine.getMissionDurationSeconds() / 60) || 5
  );

  const handlePatternChange = (pat: SearchAlgorithmType) => {
    setSearchPattern(pat);
    onUpdateConfig({ searchAlgorithm: pat });
  };

  const handleAltitudeChange = (alt: number) => {
    setSearchAltitude(alt);
    setCustomAltitude(alt);
    customRouteService.setMissionAltitude(alt);
    onUpdateConfig({ searchAltitude: alt });
    circleTestService.setAltitude(alt);
  };

  const handleSpeedChange = (spd: number) => {
    setSearchSpeed(spd);
    setCustomSpeed(spd);
    customRouteService.setMissionSpeed(spd);
    onUpdateConfig({ flightSpeedMs: spd });
    circleTestService.setFlightSpeed(spd);
  };

  const handleSpacingChange = (spc: number) => {
    setSearchSpacing(spc);
    onUpdateConfig({ gridSpacingMeters: spc });
  };

  const handleWaypointSpacingChange = (spacing: number) => {
    setWaypointSpacing(spacing);
    customRouteService.setWaypointSpacing(spacing);
  };

  const handleAllowPerWaypointToggle = (allow: boolean) => {
    setAllowPerWaypointAlt(allow);
    customRouteService.setAllowPerWaypointAltitude(allow);
  };

  const handleDurationChange = (mins: number) => {
    setMissionDurationMins(mins);
    missionEngine.setMissionDuration(mins * 60);
  };

  const handleCircleToggle = (enabled: boolean) => {
    setCircleEnabled(enabled);
    if (enabled) {
      circleTestService.setDiameter(circleRadius * 2);
      circleTestService.setLaps(circleTurns);
      // Synchronize altitude only if user has not set a custom circle altitude
      const existingCircleAlt = circleTestService.getConfig().targetAltitudeMeters;
      if (existingCircleAlt && existingCircleAlt > 0) {
        setSearchAltitude(existingCircleAlt);
      } else {
        circleTestService.setAltitude(searchAltitude);
      }
      circleTestService.setFlightSpeed(searchSpeed);
    }
  };

  const handleCircleRadiusChange = (rad: number) => {
    setCircleRadius(rad);
    circleTestService.setDiameter(rad * 2);
  };

  const handleCircleTurnsChange = (turns: number) => {
    setCircleTurns(turns);
    circleTestService.setLaps(turns);
  };

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-lg font-mono select-none ${className}`}>
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition"
      >
        <div className="flex items-center space-x-2.5">
          <div className="p-1.5 rounded-lg bg-sky-950/80 border border-sky-500/40 text-sky-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs sm:text-sm font-black tracking-wider text-slate-200 uppercase">
              MISSION CONFIGURATION
            </span>
            <span className="ml-2 text-[10px] text-slate-400 hidden sm:inline">
              [ {missionType} • {missionType === 'Custom Route' ? `Spacing: ${waypointSpacing}m` : searchPattern.replace('_', ' ')} • {missionType === 'Custom Route' ? customAltitude : searchAltitude}m • {missionType === 'Custom Route' ? customSpeed : searchSpeed}m/s ]
            </span>
          </div>
        </div>

        <button
          type="button"
          className="p-1 text-slate-400 hover:text-white transition"
          aria-label="Toggle Mission Configuration"
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Body Content */}
      {isExpanded && (
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* 1. Mission Type (Requirement 29) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-400 uppercase">
                Mission Type:
              </label>
              <select
                disabled={isMissionActive}
                value={missionType}
                onChange={(e) => setMissionType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50 font-bold"
              >
                <option value="Custom Route">Custom Route (Primary)</option>
                <option value="Grid Search">Grid Search</option>
                <option value="Circle Investigation">Circle Investigation</option>
                <option value="Target Mission">Target Mission</option>
              </select>
            </div>

            {missionType === 'Custom Route' ? (
              <>
                {/* 2. Waypoint Spacing (Requirement 5) */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Waypoint Spacing:
                  </label>
                  <select
                    disabled={isMissionActive}
                    value={waypointSpacing}
                    onChange={(e) => handleWaypointSpacingChange(parseInt(e.target.value) || 5)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50 font-bold"
                  >
                    <option value={2}>2 m</option>
                    <option value={5}>5 m (Recommended)</option>
                    <option value={10}>10 m</option>
                    <option value={20}>20 m</option>
                    <option value={50}>50 m</option>
                  </select>
                </div>

                {/* 3. Mission Altitude (Requirement 6) */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Mission Altitude:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="2"
                      max="120"
                      step="1"
                      disabled={isMissionActive}
                      value={customAltitude}
                      onChange={(e) => handleAltitudeChange(parseFloat(e.target.value) || 15)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold text-amber-300"
                    />
                    <span className="text-xs text-slate-400 shrink-0">m</span>
                  </div>
                </div>

                {/* 4. Mission Speed (Requirement 7) */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Mission Speed:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="0.5"
                      max="15"
                      step="0.5"
                      disabled={isMissionActive}
                      value={customSpeed}
                      onChange={(e) => handleSpeedChange(parseFloat(e.target.value) || 3.0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold text-sky-300"
                    />
                    <span className="text-xs text-slate-400 shrink-0">m/s</span>
                  </div>
                </div>

                {/* 5. QR Scan Timeout */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    QR Scan Timeout:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="3"
                      max="60"
                      step="1"
                      disabled={isMissionActive}
                      value={qrTimeout}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 15;
                        setQrTimeout(val);
                        onUpdateConfig({ inspectionHoverSeconds: Math.max(3, Math.round(val / 3)) });
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold"
                    />
                    <span className="text-xs text-slate-400 shrink-0">sec</span>
                  </div>
                </div>

                {/* 6. Mission Duration */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Maximum Duration:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      step="1"
                      disabled={isMissionActive}
                      value={missionDurationMins}
                      onChange={(e) => handleDurationChange(parseInt(e.target.value) || 5)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold"
                    />
                    <span className="text-xs text-slate-400 shrink-0">min</span>
                  </div>
                </div>

                {/* Optional Per-Waypoint Altitude Toggle (Requirement 6) */}
                <div className="pt-1 sm:col-span-2 lg:col-span-3">
                  <label className="flex items-center space-x-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={isMissionActive}
                      checked={allowPerWaypointAlt}
                      onChange={(e) => handleAllowPerWaypointToggle(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-500 accent-sky-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                    />
                    <span className="text-xs font-bold text-slate-200">
                      Allow per-waypoint altitude
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      ({allowPerWaypointAlt ? 'Enabled: Individual waypoints can be assigned distinct altitudes' : 'Disabled: All waypoints use default mission altitude'})
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <>
                {/* Search Pattern */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Pattern:
                  </label>
                  <select
                    disabled={isMissionActive}
                    value={searchPattern}
                    onChange={(e) => handlePatternChange(e.target.value as SearchAlgorithmType)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="GRID">Grid / Lawn-Mower</option>
                    <option value="EXPANDING_SPIRAL">Expanding Spiral</option>
                    <option value="PERIMETER">Perimeter</option>
                    <option value="ADAPTIVE">Adaptive Scan</option>
                  </select>
                </div>

                {/* Search Direction */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Direction:
                  </label>
                  <select
                    disabled={isMissionActive}
                    value={searchDirection}
                    onChange={(e) => setSearchDirection(e.target.value as 'Horizontal' | 'Vertical')}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="Horizontal">Horizontal</option>
                    <option value="Vertical">Vertical</option>
                  </select>
                </div>

                {/* Search Spacing */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Spacing:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="2"
                      max="30"
                      step="1"
                      disabled={isMissionActive}
                      value={searchSpacing}
                      onChange={(e) => handleSpacingChange(parseFloat(e.target.value) || 8)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold"
                    />
                    <span className="text-xs text-slate-400 shrink-0">m</span>
                  </div>
                </div>

                {/* Search Altitude */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Altitude:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="2"
                      max="100"
                      step="1"
                      disabled={isMissionActive}
                      value={searchAltitude}
                      onChange={(e) => handleAltitudeChange(parseFloat(e.target.value) || 10)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold text-amber-300"
                    />
                    <span className="text-xs text-slate-400 shrink-0">m</span>
                  </div>
                </div>

                {/* Search Speed */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Speed:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="1"
                      max="15"
                      step="0.5"
                      disabled={isMissionActive}
                      value={searchSpeed}
                      onChange={(e) => handleSpeedChange(parseFloat(e.target.value) || 3.0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold text-sky-300"
                    />
                    <span className="text-xs text-slate-400 shrink-0">m/s</span>
                  </div>
                </div>

                {/* Search Area */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Search Area:
                  </label>
                  <div className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-sky-400 font-bold flex items-center justify-between">
                    <span>[ Map Defined ]</span>
                    <span className="text-[10px] text-slate-400">
                      {missionConfig.searchBoundary?.coordinates?.length
                        ? `${missionConfig.searchBoundary.coordinates.length} pts`
                        : 'Polygon'}
                    </span>
                  </div>
                </div>

                {/* QR Scan Timeout */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    QR Scan Timeout:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="3"
                      max="60"
                      step="1"
                      disabled={isMissionActive}
                      value={qrTimeout}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 15;
                        setQrTimeout(val);
                        onUpdateConfig({ inspectionHoverSeconds: Math.max(3, Math.round(val / 3)) });
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold"
                    />
                    <span className="text-xs text-slate-400 shrink-0">sec</span>
                  </div>
                </div>

                {/* Mission Duration */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Mission Duration:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      step="1"
                      disabled={isMissionActive}
                      value={missionDurationMins}
                      onChange={(e) => handleDurationChange(parseInt(e.target.value) || 5)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50 font-bold"
                    />
                    <span className="text-xs text-slate-400 shrink-0">min</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Circle Investigation Section (Requirement 5) */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={isMissionActive}
                  checked={circleEnabled}
                  onChange={(e) => handleCircleToggle(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-500 accent-sky-500 focus:ring-0 cursor-pointer disabled:opacity-50"
                />
                <span className="text-xs font-bold text-slate-200 uppercase">
                  Circle Investigation
                </span>
                <span className="text-[10px] text-slate-400 font-normal">
                  (Perform circular orbit around detected target)
                </span>
              </label>
            </div>

            {/* Parameters visible only when Circle Investigation enabled */}
            {circleEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-900/80 rounded-lg border border-slate-800">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">
                    Radius:
                  </label>
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="number"
                      min="5"
                      max="100"
                      step="5"
                      disabled={isMissionActive}
                      value={circleRadius}
                      onChange={(e) => handleCircleRadiusChange(parseFloat(e.target.value) || 20)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                    />
                    <span className="text-xs text-slate-400">m</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">
                    Turns:
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    disabled={isMissionActive}
                    value={circleTurns}
                    onChange={(e) => handleCircleTurnsChange(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">
                    Altitude:
                  </label>
                  <div className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-amber-300 font-bold truncate">
                    [ Current Mission Altitude: {searchAltitude}m ]
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
