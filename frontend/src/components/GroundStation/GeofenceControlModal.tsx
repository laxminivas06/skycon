import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  Compass,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Sliders,
  MapPin,
  Maximize2,
  Minimize2,
  ArrowUp,
  ArrowDown,
  Layers,
  Circle,
  Square
} from 'lucide-react';
import { geofenceService, GeofenceConfig, GeofenceShape, GeofenceBreachAction, GeofenceAnchor } from '../../services/geofenceService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';

interface GeofenceControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOnMap?: () => void;
}

export const GeofenceControlModal: React.FC<GeofenceControlModalProps> = ({
  isOpen,
  onClose,
  onSelectOnMap,
}) => {
  const [geofenceState, setGeofenceState] = useState(() => geofenceService.getState());
  const [enabled, setEnabled] = useState(geofenceState.enabled);
  const [shape, setShape] = useState<GeofenceShape>(geofenceState.shape);
  const [radius, setRadius] = useState<number>(geofenceState.radiusMeters || 50);
  const [width, setWidth] = useState<number>(geofenceState.widthMeters || 50);
  const [height, setHeight] = useState<number>(geofenceState.heightMeters || 50);
  const [maxAlt, setMaxAlt] = useState<number>(geofenceState.maxAltitudeMeters || 25);
  const [minAlt, setMinAlt] = useState<number>(geofenceState.minAltitudeMeters || 1.5);
  const [breachAction, setBreachAction] = useState<GeofenceBreachAction>(geofenceState.breachAction || 'RTL');
  const [anchorType, setAnchorType] = useState<GeofenceAnchor>(geofenceState.anchorType || 'HOME');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsub = geofenceService.subscribe((st) => {
      setGeofenceState(st);
    });
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const showNotification = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const handleToggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    geofenceService.setEnabled(next);
    audioService.playBeep(next ? 880 : 450, 70);
    showNotification(next ? 'Geofence Active: Boundary monitoring armed' : 'Geofence Disarmed');
  };

  const handleApplyADDCDefaults = () => {
    setEnabled(true);
    setShape('ARENA_RECTANGLE');
    setWidth(50);
    setHeight(50);
    setMaxAlt(25.0);
    setMinAlt(1.5);
    setBreachAction('RTL');
    setAnchorType('HOME');
    geofenceService.resetToADDCDefaults();
    showNotification('Applied SAE India ADDC Rule 3.3 Defaults (50m × 50m Arena, 25m Ceiling)');
  };

  const handleSaveConfig = () => {
    geofenceService.updateConfig({
      enabled,
      shape,
      radiusMeters: radius,
      widthMeters: width,
      heightMeters: height,
      maxAltitudeMeters: maxAlt,
      minAltitudeMeters: minAlt,
      breachAction,
      anchorType,
    });
    audioService.playBeep(920, 80);
    showNotification('Geofence parameters updated & synchronized ✓');
    setTimeout(() => onClose(), 600);
  };

  const handleClearGeofence = () => {
    setEnabled(false);
    geofenceService.clearGeofence();
    showNotification('Geofence boundary cleared and disarmed');
  };

  const currentAlt = geofenceState.currentAltitudeMeters || 0;
  const distEdge = geofenceState.distanceToBoundaryMeters;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none font-sans animate-in fade-in">
      <div className="bg-[#0f141c] border border-slate-700/80 rounded-2xl max-w-2xl w-full text-slate-100 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#141a24] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              !enabled
                ? 'bg-slate-800/80 border-slate-700 text-slate-400'
                : geofenceState.isBreached
                ? 'bg-rose-950/80 border-rose-500/80 text-rose-400 animate-pulse'
                : 'bg-amber-950/80 border-amber-500/60 text-amber-400'
            }`}>
              {geofenceState.isBreached ? <ShieldAlert className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-[14px] sm:text-[15px] font-orbitron font-bold tracking-wide text-white flex items-center gap-2">
                <span>AUTONOMOUS GEOFENCE CONTROL</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">ADDC 2026</span>
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                Real-time safety perimeter, vertical ceiling & autopilot failsafes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Notice */}
        {notice && (
          <div className="mx-5 mt-3 p-2 rounded-lg bg-sky-950/90 border border-sky-500 text-sky-200 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Live Status Pill & Master Switch */}
          <div className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            !enabled
              ? 'bg-slate-900/60 border-slate-800 text-slate-400'
              : geofenceState.isBreached
              ? 'bg-rose-950/60 border-rose-500 text-rose-300 animate-pulse'
              : 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300'
          }`}>
            <div className="flex items-center gap-2.5">
              {enabled && !geofenceState.isBreached && <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />}
              {enabled && geofenceState.isBreached && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
              {!enabled && <Shield className="w-5 h-5 text-slate-500 shrink-0" />}
              <div>
                <span className="text-xs font-mono font-bold tracking-wider uppercase block">
                  {!enabled
                    ? 'GEOFENCE DISARMED'
                    : geofenceState.isBreached
                    ? `⚠️ BREACH ALERT: ${geofenceState.breachReason}`
                    : 'GEOFENCE ARMED — VEHICLE WITHIN BOUNDARY'}
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {enabled && distEdge !== null
                    ? `Distance to perimeter: ~${distEdge > 0 ? `${distEdge}m inside` : `${Math.abs(distEdge)}m outside`}`
                    : 'Boundary watchdog ready'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleEnabled}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wider transition cursor-pointer flex items-center gap-1.5 ${
                  enabled
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-black shadow-md'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                <span>{enabled ? 'ENABLED' : 'DISABLED'}</span>
              </button>
            </div>
          </div>

          {/* Preset Bar */}
          <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-2">
            <span className="text-slate-400">Quick Configuration Presets:</span>
            <button
              type="button"
              onClick={handleApplyADDCDefaults}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition cursor-pointer"
            >
              ★ Apply SAE ADDC 50m Arena (Rule 3.3)
            </button>
          </div>

          {/* Section 1: Shape & Dimensions */}
          <div className="space-y-2 bg-[#121822] p-3.5 rounded-xl border border-slate-800">
            <label className="text-xs font-mono font-bold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Square className="w-3.5 h-3.5 text-amber-400" />
                <span>1. HORIZONTAL BOUNDARY GEOMETRY</span>
              </span>
              <span className="text-[10px] text-slate-400">Select Shape</span>
            </label>

            {/* Shape Selector */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShape('ARENA_RECTANGLE')}
                className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                  shape === 'ARENA_RECTANGLE'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <div className="font-mono font-bold text-xs flex items-center gap-1.5">
                  <Square className="w-3.5 h-3.5" />
                  <span>Rectangular Arena</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">50m × 50m or Custom box</div>
              </button>

              <button
                type="button"
                onClick={() => setShape('CIRCLE')}
                className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                  shape === 'CIRCLE'
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                <div className="font-mono font-bold text-xs flex items-center gap-1.5">
                  <Circle className="w-3.5 h-3.5" />
                  <span>Circular Radius</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Radial distance from anchor</div>
              </button>
            </div>

            {/* Shape Dimensions Inputs */}
            {shape === 'ARENA_RECTANGLE' ? (
              <div className="pt-2 grid grid-cols-2 gap-3 text-xs font-mono">
                <div>
                  <span className="text-slate-400 block mb-1">Arena Width (East-West):</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={width}
                      onChange={(e) => setWidth(Math.max(10, Math.min(500, Number(e.target.value) || 50)))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-bold text-xs outline-none focus:border-amber-400"
                    />
                    <span className="text-slate-400">m</span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Arena Length (North-South):</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={height}
                      onChange={(e) => setHeight(Math.max(10, Math.min(500, Number(e.target.value) || 50)))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-bold text-xs outline-none focus:border-amber-400"
                    />
                    <span className="text-slate-400">m</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="pt-2 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Fence Radius:</span>
                  <span className="font-bold text-amber-300">{radius} meters</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={300}
                  step={5}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex items-center gap-1.5 pt-1">
                  {[25, 50, 100, 150, 200].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRadius(r)}
                      className={`px-2 py-0.5 rounded text-[10.5px] border cursor-pointer ${
                        radius === r
                          ? 'bg-amber-500 text-black font-bold border-amber-400'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {r}m
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Vertical Altitude Ceilings & Floors */}
          <div className="space-y-2 bg-[#121822] p-3.5 rounded-xl border border-slate-800 text-xs font-mono">
            <label className="font-bold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ArrowUp className="w-3.5 h-3.5 text-sky-400" />
                <span>2. VERTICAL ALTITUDE LIMITS (AGL)</span>
              </span>
              <span className="text-sky-300">Current: {currentAlt.toFixed(1)}m</span>
            </label>

            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* Ceiling */}
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400">Max Ceiling (AGL):</span>
                  <span className="font-bold text-sky-400">{maxAlt}m</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={maxAlt}
                  onChange={(e) => setMaxAlt(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">ADDC Rule limit: 25.0m</span>
              </div>

              {/* Floor */}
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400">Min Floor (AGL):</span>
                  <span className="font-bold text-amber-400">{minAlt}m</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={minAlt}
                  onChange={(e) => setMinAlt(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Prevents ground impact</span>
              </div>
            </div>
          </div>

          {/* Section 3: Breach Failsafe Action & Anchor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            {/* Failsafe Action */}
            <div className="bg-[#121822] p-3 rounded-xl border border-slate-800 space-y-1.5">
              <label className="font-bold text-slate-300 block mb-1">3. FAILSAFE BREACH ACTION:</label>
              {(['RTL', 'LOITER', 'LAND', 'POSHOLD'] as GeofenceBreachAction[]).map((act) => (
                <label
                  key={act}
                  className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition ${
                    breachAction === act
                      ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="breachAction"
                      checked={breachAction === act}
                      onChange={() => setBreachAction(act)}
                      className="accent-emerald-500"
                    />
                    <span>{act}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {act === 'RTL' ? 'Return Home' : act === 'LOITER' ? 'Hold Position' : act === 'LAND' ? 'Descend' : 'Position Hold'}
                  </span>
                </label>
              ))}
            </div>

            {/* Anchor Origin Point */}
            <div className="bg-[#121822] p-3 rounded-xl border border-slate-800 space-y-1.5">
              <label className="font-bold text-slate-300 block mb-1">4. GEOFENCE ANCHOR ORIGIN:</label>
              {[
                { type: 'HOME' as GeofenceAnchor, label: 'Home Point (Takeoff Lock)', desc: 'Standard GCS Reference' },
                { type: 'DRONE' as GeofenceAnchor, label: 'Current Drone Position', desc: 'Centered on live Pixhawk GPS' },
                { type: 'CUSTOM' as GeofenceAnchor, label: 'Custom Location (Cricket Ground)', desc: geofenceState.customAnchor ? `Set at (${geofenceState.customAnchor.lat.toFixed(5)}, ${geofenceState.customAnchor.lng.toFixed(5)})` : 'Click on map or drag pin to place' }
              ].map((anch) => (
                <label
                  key={anch.type}
                  className={`flex flex-col p-2 rounded-lg border cursor-pointer transition ${
                    anchorType === anch.type
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="anchorType"
                      checked={anchorType === anch.type}
                      onChange={() => setAnchorType(anch.type)}
                      className="accent-amber-500"
                    />
                    <span>{anch.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 ml-5">{anch.desc}</span>
                </label>
              ))}

              {/* Quick Map Placement Button */}
              <button
                type="button"
                onClick={() => {
                  onSelectOnMap?.();
                  onClose();
                }}
                className="w-full mt-2 py-2 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>📍 Place on Map (Click Cricket Ground)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#141a24] border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClearGeofence}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 text-xs font-mono font-bold transition cursor-pointer"
          >
            Clear / Disarm Fence
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-mono font-black tracking-wide uppercase transition active:scale-95 cursor-pointer shadow-lg shadow-emerald-500/20"
            >
              Save & Apply Geofence
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
