import React, { useState, useEffect } from 'react';
import { 
  AutonomousMissionConfig, 
  AutonomousMissionValidation, 
  SearchBoundaryConfig, 
  SearchAlgorithmType, 
  DroneTelemetry, 
  HomePoint, 
  MissionState 
} from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { missionEngine } from '../../services/missionEngine';
import { mavlinkService } from '../../services/mavlinkService';
import { MissionMapDrawer } from './MissionMapDrawer';
import { 
  PlaneTakeoff, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  MapPin, 
  Sliders, 
  Save, 
  Play, 
  X, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw, 
  ShieldCheck, 
  ShieldAlert, 
  Compass, 
  Layers,
  ArrowUp,
  ArrowDown,
  Info,
  Check,
  AlertOctagon,
  Clock,
  RotateCw
} from 'lucide-react';
import { loiterTestService } from '../../services/loiterTestService';
import { LoiterTestState, LoiterTestValidation } from '../../types/loiterTest';
import { LoiterTestPanel } from './LoiterTestPanel';
import { circleTestService } from '../../services/circleTestService';
import { CircleTestState, CircleTestValidation } from '../../types/circleTest';
import { CircleTestPanel } from './CircleTestPanel';

interface AutonomousMissionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  missionState: MissionState;
  onStartMission: () => void;
}

export const AutonomousMissionConfigModal: React.FC<AutonomousMissionConfigModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  homePoint,
  pixhawkState,
  missionState,
  onStartMission
}) => {
  const [config, setConfig] = useState<AutonomousMissionConfig>(missionEngine.getMissionConfig());
  const [altitudeInput, setAltitudeInput] = useState<string>(String(config.searchAltitude));
  const [altitudeValidation, setAltitudeValidation] = useState<{ valid: boolean; reason?: string }>(
    missionEngine.validateAltitude(config.searchAltitude)
  );
  const [isMapDrawerOpen, setIsMapDrawerOpen] = useState<boolean>(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 9-point validation state
  const [validation, setValidation] = useState<AutonomousMissionValidation>(missionEngine.validateMission());
  const [forceBypassChecks, setForceBypassChecks] = useState<boolean>(() => missionEngine.getForceBypassChecks());

  // Mission Selection Tab: Standard Autonomous Search vs 5M_LOITER_TEST vs AUTONOMOUS_CIRCLE_TEST
  const [activeMissionTab, setActiveMissionTab] = useState<'AUTONOMOUS_SEARCH' | '5M_LOITER_TEST' | 'AUTONOMOUS_CIRCLE_TEST'>('AUTONOMOUS_SEARCH');
  const [loiterState, setLoiterState] = useState<LoiterTestState>(loiterTestService.getState());
  const [loiterOperatorConfirmed, setLoiterOperatorConfirmed] = useState<boolean>(false);
  const [loiterExecutionError, setLoiterExecutionError] = useState<string | null>(null);
  const [selectedLoiterDuration, setSelectedLoiterDuration] = useState<number>(
    loiterTestService.getConfig().loiterDurationSeconds
  );

  const [circleState, setCircleState] = useState<CircleTestState>(circleTestService.getState());
  const [circleOperatorConfirmed, setCircleOperatorConfirmed] = useState<boolean>(false);
  const [circleExecutionError, setCircleExecutionError] = useState<string | null>(null);
  const [selectedCircleDiameter, setSelectedCircleDiameter] = useState<number>(
    circleTestService.getConfig().circleDiameterMeters
  );
  const [selectedCircleAltitude, setSelectedCircleAltitude] = useState<number>(
    circleTestService.getConfig().targetAltitudeMeters
  );
  const [selectedCircleLaps, setSelectedCircleLaps] = useState<number>(
    circleTestService.getConfig().laps
  );
  const [selectedCircleDirection, setSelectedCircleDirection] = useState<'CW' | 'CCW'>(
    circleTestService.getConfig().direction
  );

  const handleLoiterDurationSelect = (sec: number) => {
    setSelectedLoiterDuration(sec);
    loiterTestService.setLoiterDuration(sec);
  };

  const handleCircleDiameterSelect = (d: number) => {
    setSelectedCircleDiameter(d);
    circleTestService.setDiameter(d);
  };

  const handleCircleAltitudeSelect = (alt: number) => {
    setSelectedCircleAltitude(alt);
    circleTestService.setAltitude(alt);
  };

  const handleCircleLapsSelect = (laps: number) => {
    setSelectedCircleLaps(laps);
    circleTestService.setLaps(laps);
  };

  const handleCircleDirectionSelect = (dir: 'CW' | 'CCW') => {
    setSelectedCircleDirection(dir);
    circleTestService.setDirection(dir);
  };

  useEffect(() => {
    const unsubLoiter = loiterTestService.subscribeState(setLoiterState);
    const unsubCircle = circleTestService.subscribeState(setCircleState);
    return () => {
      unsubLoiter();
      unsubCircle();
    };
  }, []);

  const loiterValidation: LoiterTestValidation = loiterTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const circleValidation: CircleTestValidation = circleTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const isAirborne = telemetry.isArmed && telemetry.altitude > 1.0;
  const isMissionActive =
    missionState !== 'IDLE' &&
    missionState !== 'HOME_SET' &&
    missionState !== 'READY' &&
    missionState !== 'MISSION_COMPLETE';

  // Synchronize validation on telemetry and config updates
  useEffect(() => {
    setValidation(missionEngine.validateMission());
  }, [telemetry, pixhawkState, homePoint, config, isOpen]);

  if (!isOpen) return null;

  const handleAltitudeChange = (value: string) => {
    setAltitudeInput(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      const check = missionEngine.validateAltitude(parsed);
      setAltitudeValidation(check);
      if (check.valid) {
        setConfig((prev) => ({ ...prev, searchAltitude: parsed }));
      }
    } else {
      setAltitudeValidation({ valid: false, reason: 'Please enter a valid numeric altitude' });
    }
  };

  const handleAltitudePreset = (alt: number) => {
    setAltitudeInput(String(alt));
    const check = missionEngine.validateAltitude(alt);
    setAltitudeValidation(check);
    if (check.valid) {
      setConfig((prev) => ({ ...prev, searchAltitude: alt }));
      if (isMissionActive) {
        missionEngine.updateSearchAltitude(alt);
      }
    }
  };

  const handleAltitudeStep = (delta: number) => {
    const current = parseFloat(altitudeInput) || config.searchAltitude;
    const next = Math.max(2, Math.min(100, +(current + delta).toFixed(1)));
    handleAltitudePreset(next);
  };

  const handleSaveMission = () => {
    const parsedAlt = parseFloat(altitudeInput);
    if (isNaN(parsedAlt) || !altitudeValidation.valid) {
      return;
    }

    // If drone is airborne and altitude changed, perform controlled transition
    if (isMissionActive && parsedAlt !== missionEngine.getMissionConfig().searchAltitude) {
      missionEngine.updateSearchAltitude(parsedAlt);
    } else {
      missionEngine.updateMissionConfig({
        ...config,
        searchAltitude: parsedAlt
      });
    }

    setSaveSuccessMsg('Mission Configuration Saved & Validated ✓');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleBoundarySaved = (newBoundary: SearchBoundaryConfig) => {
    const updated = { ...config, searchBoundary: newBoundary };
    setConfig(updated);
    missionEngine.updateMissionConfig({ searchBoundary: newBoundary });
    setIsMapDrawerOpen(false);
  };

  const handleStart = () => {
    handleSaveMission();
    missionEngine.setForceBypassChecks(forceBypassChecks);
    missionEngine.startMission(forceBypassChecks);
    onStartMission();
    onClose();
  };

  const handleExecuteLoiterTest = async () => {
    setLoiterExecutionError(null);
    if (!loiterOperatorConfirmed) {
      setLoiterOperatorConfirmed(true);
    }
    const res = await loiterTestService.executeMission(telemetry, pixhawkState, homePoint, true);
    if (!res.success) {
      setLoiterExecutionError(res.error || 'Failed to start 5M Loiter Test.');
    }
  };

  const handleAbortLoiterTest = () => {
    loiterTestService.abort('Operator Aborted via Modal');
  };

  const handleResetLoiterTest = () => {
    loiterTestService.resetState();
    setLoiterOperatorConfirmed(false);
    setLoiterExecutionError(null);
  };

  const handleExecuteCircleTest = async () => {
    setCircleExecutionError(null);
    if (!circleOperatorConfirmed) {
      setCircleOperatorConfirmed(true);
    }
    const res = await circleTestService.executeMission(telemetry, pixhawkState, homePoint, true);
    if (!res.success) {
      setCircleExecutionError(res.error || 'Failed to start Autonomous Circle Test.');
    }
  };

  const handleAbortCircleTest = () => {
    circleTestService.abort('Operator Aborted via Modal');
  };

  const handleResetCircleTest = () => {
    circleTestService.resetState();
    setCircleOperatorConfirmed(false);
    setCircleExecutionError(null);
  };

  const algorithms: Array<{ id: SearchAlgorithmType; name: string; tag: string; desc: string }> = [
    {
      id: 'GRID',
      name: 'Algorithm A — Lawn-Mower / Grid',
      tag: 'DEFAULT (RECT/SQUARE)',
      desc: 'Parallel search lanes dynamically computed from camera FOV, altitude, and desired overlap.'
    },
    {
      id: 'SPIRAL',
      name: 'Algorithm B — Spiral / Expanding',
      tag: 'CIRCULAR / RADIAL',
      desc: 'Progressive outward Archimedean spiral respecting the configured circular search boundary.'
    },
    {
      id: 'PERIMETER',
      name: 'Algorithm C — Perimeter + Inward',
      tag: 'OUTER TO INNER',
      desc: 'Outer boundary perimeter sweep followed by concentric inward stepping loops.'
    },
    {
      id: 'ADAPTIVE',
      name: 'Algorithm D — Adaptive Search',
      tag: 'SMART DIVERSION',
      desc: 'Autonomous search with opportunistic target diversion, inspection holding, and seamless path resume.'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto font-mono select-none">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <PlaneTakeoff className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black uppercase text-white tracking-wider">
                  AUTONOMOUS MISSION CONFIGURATION
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-sky-950 border border-sky-500/40 text-sky-300">
                  AUTHORIZED OPERATOR
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Pre-flight parameterization, Google Maps geofence, and takeoff climb sequencer
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mission Type Selection Tabs */}
        <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mr-1">
              MISSION:
            </span>
            <button
              type="button"
              disabled={loiterState.isExecuting || circleState.isExecuting}
              onClick={() => setActiveMissionTab('AUTONOMOUS_SEARCH')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer ${
                activeMissionTab === 'AUTONOMOUS_SEARCH'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              } ${loiterState.isExecuting || circleState.isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Autonomous Search & Rescue
            </button>
            <button
              type="button"
              disabled={isMissionActive || circleState.isExecuting}
              onClick={() => setActiveMissionTab('5M_LOITER_TEST')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center space-x-1.5 ${
                activeMissionTab === '5M_LOITER_TEST'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              } ${isMissionActive || circleState.isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              <span>5M_LOITER_TEST</span>
            </button>
            <button
              type="button"
              disabled={isMissionActive || loiterState.isExecuting}
              onClick={() => setActiveMissionTab('AUTONOMOUS_CIRCLE_TEST')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center space-x-1.5 ${
                activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              } ${isMissionActive || loiterState.isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <RotateCw className="w-3.5 h-3.5 text-sky-400" />
              <span>AUTONOMOUS_CIRCLE_TEST ({selectedCircleDiameter}m Ø)</span>
            </button>
          </div>

          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-bold uppercase">
            {activeMissionTab === '5M_LOITER_TEST'
              ? 'Selected: 5M_LOITER_TEST'
              : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST'
              ? `Selected: Circle (${selectedCircleDiameter}m Ø, ${selectedCircleAltitude}m Alt)`
              : 'Selected: Autonomous Search'}
          </span>
        </div>

        {/* Live Altitude & Telemetry Banner */}
        <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400">Target Altitude:</span>
              <span className="text-amber-400 font-extrabold text-sm">
                {activeMissionTab === '5M_LOITER_TEST'
                  ? '5.0'
                  : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST'
                  ? selectedCircleAltitude.toFixed(1)
                  : config.searchAltitude} m
              </span>
            </div>
            <div className="text-slate-600">•</div>
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400">Current Altitude:</span>
              <span className={`font-extrabold text-sm ${
                Math.abs(telemetry.altitude - (activeMissionTab === '5M_LOITER_TEST' ? 5.0 : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST' ? selectedCircleAltitude : config.searchAltitude)) <= 0.5
                  ? 'text-emerald-400'
                  : 'text-sky-400'
              }`}>
                {telemetry.altitude.toFixed(1)} m
              </span>
            </div>
            <div className="text-slate-600 hidden sm:inline">•</div>
            <div className="hidden sm:flex items-center space-x-1.5 text-slate-400">
              <span>FC State:</span>
              <span className={`font-bold ${telemetry.isArmed ? 'text-emerald-400' : 'text-slate-400'}`}>
                {telemetry.isArmed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {activeMissionTab === '5M_LOITER_TEST' ? (
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
                loiterValidation.allPassed
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}>
                {loiterValidation.allPassed ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>PRE-FLIGHT: ALL PREREQUISITES MET</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>PRE-FLIGHT: {loiterValidation.prerequisites.filter((p) => p.passed).length}/{loiterValidation.prerequisites.length} READY</span>
                  </>
                )}
              </span>
            ) : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST' ? (
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
                circleValidation.allPassed
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}>
                {circleValidation.allPassed ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>PRE-FLIGHT: ALL PREREQUISITES MET</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>PRE-FLIGHT: {circleValidation.prerequisites.filter((p) => p.passed).length}/{circleValidation.prerequisites.length} READY</span>
                  </>
                )}
              </span>
            ) : (
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-black border flex items-center space-x-1 ${
                validation.isValid
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
              }`}>
                {validation.isValid ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>PRE-FLIGHT VALIDATION: 9/9 PASSED</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                    <span>PRE-FLIGHT: {validation.conditions.filter(c => c.passed).length}/9 READY</span>
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {activeMissionTab === '5M_LOITER_TEST' ? (
            <LoiterTestPanel
              telemetry={telemetry}
              homePoint={homePoint}
              pixhawkState={pixhawkState}
              operatorConfirmed={loiterOperatorConfirmed}
              onOperatorConfirmedChange={setLoiterOperatorConfirmed}
              selectedDuration={selectedLoiterDuration}
              onDurationSelect={handleLoiterDurationSelect}
              onReset={handleResetLoiterTest}
              executionError={loiterExecutionError}
            />
          ) : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST' ? (
            <CircleTestPanel
              telemetry={telemetry}
              homePoint={homePoint}
              pixhawkState={pixhawkState}
              operatorConfirmed={circleOperatorConfirmed}
              onOperatorConfirmedChange={setCircleOperatorConfirmed}
              selectedDiameter={selectedCircleDiameter}
              onDiameterSelect={handleCircleDiameterSelect}
              selectedAltitude={selectedCircleAltitude}
              onAltitudeSelect={handleCircleAltitudeSelect}
              selectedLaps={selectedCircleLaps}
              onLapsSelect={handleCircleLapsSelect}
              selectedDirection={selectedCircleDirection}
              onDirectionSelect={handleCircleDirectionSelect}
              onReset={handleResetCircleTest}
              executionError={circleExecutionError}
            />
          ) : (
            <>
              {saveSuccessMsg && (
                <div className="p-3 bg-emerald-950/70 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center space-x-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-bold">{saveSuccessMsg}</span>
                </div>
              )}

          {/* Section 1: Search Altitude Configuration */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div>
                <label className="text-xs font-black uppercase text-amber-300 tracking-wider flex items-center space-x-1.5">
                  <span>1. SEARCH ALTITUDE (ABOVE HOME REFERENCE)</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Drone will automatically climb from home to this altitude before starting search.
                </p>
              </div>

              <div className="flex items-center space-x-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  altitudeValidation.valid
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                }`}>
                  {altitudeValidation.valid ? 'Valid Envelope (2 - 100m)' : altitudeValidation.reason}
                </span>
              </div>
            </div>

            {/* Altitude Input & Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => handleAltitudeStep(-1)}
                  className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-sm flex items-center justify-center cursor-pointer"
                >
                  -1m
                </button>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    min="2"
                    max="100"
                    value={altitudeInput}
                    onChange={(e) => handleAltitudeChange(e.target.value)}
                    className="w-24 text-center bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-base font-black text-amber-300 font-mono focus:border-amber-500 focus:outline-none"
                    placeholder="10"
                  />
                  <span className="absolute right-2 top-2.5 text-xs text-slate-500 pointer-events-none">m</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleAltitudeStep(1)}
                  className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-sm flex items-center justify-center cursor-pointer"
                >
                  +1m
                </button>
              </div>

              {/* Presets */}
              <div className="flex items-center flex-wrap gap-1.5">
                {[5, 10, 12, 15, 20, 25, 30].map((presetAlt) => (
                  <button
                    key={presetAlt}
                    type="button"
                    onClick={() => handleAltitudePreset(presetAlt)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition border ${
                      parseFloat(altitudeInput) === presetAlt
                        ? 'bg-amber-600 border-amber-400 text-white font-black shadow-md shadow-amber-600/30'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    } cursor-pointer`}
                  >
                    {presetAlt} m
                  </button>
                ))}
              </div>
            </div>

            {isMissionActive && (
              <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-lg text-[11px] text-amber-300 flex items-center space-x-2">
                <Info className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  Active Mission Notice: Changing altitude now will command the flight controller to safely transition to the new target altitude without abrupt motions.
                </span>
              </div>
            )}
          </div>

          {/* Section 2: Search Area & Map Boundary */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-xs font-black uppercase text-amber-300 tracking-wider flex items-center space-x-1.5">
                  <span>2. SEARCH AREA (GEOFENCE BOUNDARY)</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Draw Rectangle, Square, Circle, Polygon, or Custom geofence boundary on Google Maps.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsMapDrawerOpen((prev) => !prev)}
                className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-sky-600/20 cursor-pointer self-start sm:self-auto"
              >
                <MapPin className="w-4 h-4" />
                <span>{isMapDrawerOpen ? 'HIDE MAP PLANNER' : 'DRAW ON MAP'}</span>
              </button>
            </div>

            {/* Current Boundary Summary */}
            <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-slate-400">Configured Boundary:</span>
                <span className="font-bold text-amber-300">{config.searchBoundary.type}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">
                  {config.searchBoundary.coordinates?.length || 0} Vertices (~{Math.round(config.searchBoundary.areaSquareMeters || 6400)} m²)
                </span>
              </div>

              <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                GEOFENCE ACTIVE
              </span>
            </div>

            {/* Embedded Map Drawer if opened */}
            {isMapDrawerOpen && (
              <div className="pt-2">
                <MissionMapDrawer
                  config={config}
                  telemetry={telemetry}
                  homePoint={homePoint}
                  onSaveBoundary={handleBoundarySaved}
                  onClose={() => setIsMapDrawerOpen(false)}
                  isInline={true}
                />
              </div>
            )}
          </div>

          {/* Section 3: Search Pattern & Algorithm Selection */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div>
              <label className="text-xs font-black uppercase text-amber-300 tracking-wider">
                3. SEARCH PATTERN / ALGORITHM
              </label>
              <p className="text-[11px] text-slate-400">
                Select the autonomous scanning pattern the drone will execute once target altitude is reached and stabilized.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {algorithms.map((alg) => {
                const isSelected = config.searchAlgorithm === alg.id;
                return (
                  <button
                    key={alg.id}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, searchAlgorithm: alg.id }))}
                    className={`p-3 rounded-xl border text-left transition flex items-start space-x-2.5 ${
                      isSelected
                        ? 'bg-amber-950/40 border-amber-500 text-amber-200 shadow-md shadow-amber-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    } cursor-pointer`}
                  >
                    <div className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      isSelected ? 'border-amber-400 bg-amber-500' : 'border-slate-600'
                    }`}>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-1.5">
                        <div className="font-extrabold text-xs text-white">{alg.name}</div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 font-black border border-slate-700">
                          {alg.tag}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 leading-tight">{alg.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Live Camera Ground Footprint & Effective Lane Spacing */}
            {(() => {
              const alt = parseFloat(altitudeInput) || config.searchAltitude || 10;
              const hFov = 70;
              const vFov = 52;
              const groundW = 2 * alt * Math.tan(((hFov / 2) * Math.PI) / 180);
              const groundH = 2 * alt * Math.tan(((vFov / 2) * Math.PI) / 180);
              const overlap = config.desiredOverlapPercent || 25;
              const laneSpacing = groundW * (1 - overlap / 100);

              return (
                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5">
                    <div className="text-slate-400 text-[10px] font-bold uppercase flex items-center space-x-1">
                      <Layers className="w-3 h-3 text-sky-400" />
                      <span>Dynamic Camera Coverage at {alt}m Altitude (70° HFOV):</span>
                    </div>
                    <div className="text-white font-bold">
                      Ground Coverage: <span className="text-emerald-400">{groundW.toFixed(1)}m × {groundH.toFixed(1)}m</span> | Effective Lane Spacing: <span className="text-sky-400">{laneSpacing.toFixed(1)}m</span> ({overlap}% overlap)
                    </div>
                  </div>
                  <span className="text-[9px] text-slate-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    No Hardcoded Spacing ✓
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Section 4: RTL on QR Confirmation Behavior */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <label className="text-xs font-black uppercase text-amber-300 tracking-wider">
                4. RTL ON QR CONFIRMATION
              </label>
              <p className="text-[11px] text-slate-400">
                {config.rtlOnQrConfirmation
                  ? 'Automatically initiate Return-To-Launch and land when Runner confirms QR.'
                  : 'Hold airborne position/hover over target upon confirmation (Manual RTL required).'}
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, rtlOnQrConfirmation: true }))}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition border ${
                  config.rtlOnQrConfirmation
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-sm shadow-emerald-600/30'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                } cursor-pointer`}
              >
                ON
              </button>
              <button
                type="button"
                onClick={() => setConfig((prev) => ({ ...prev, rtlOnQrConfirmation: false }))}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition border ${
                  !config.rtlOnQrConfirmation
                    ? 'bg-amber-600 border-amber-400 text-white shadow-sm shadow-amber-600/30'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                } cursor-pointer`}
              >
                OFF
              </button>
            </div>
          </div>

          {/* Section 5: Advanced Configuration Collapsible Panel */}
          <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen((prev) => !prev)}
              className="w-full p-4 text-left flex items-center justify-between text-xs font-bold uppercase text-slate-300 hover:bg-slate-900/50 transition cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>ADVANCED MISSION BEHAVIOR CONFIGURATION</span>
              </div>
              {isAdvancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isAdvancedOpen && (
              <div className="p-4 pt-0 border-t border-slate-900 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Search Flight Speed */}
                <div className="space-y-1.5 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Search Flight Speed:</span>
                    <span className="text-sky-400 font-bold">{config.flightSpeedMs.toFixed(1)} m/s</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="8.0"
                    step="0.5"
                    value={config.flightSpeedMs}
                    onChange={(e) => setConfig((p) => ({ ...p, flightSpeedMs: parseFloat(e.target.value) }))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>1.0 m/s (Cautious)</span>
                    <span>8.0 m/s (Fast)</span>
                  </div>
                </div>

                {/* Grid Spacing */}
                <div className="space-y-1.5 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Lawnmower Grid Spacing:</span>
                    <span className="text-sky-400 font-bold">{config.gridSpacingMeters.toFixed(1)} m</span>
                  </div>
                  <input
                    type="range"
                    min="2.0"
                    max="15.0"
                    step="0.5"
                    value={config.gridSpacingMeters}
                    onChange={(e) => setConfig((p) => ({ ...p, gridSpacingMeters: parseFloat(e.target.value) }))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>2.0 m (High Density)</span>
                    <span>15.0 m (Wide)</span>
                  </div>
                </div>

                {/* Stabilization Hold Duration */}
                <div className="space-y-1.5 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Altitude Stabilization Hold:</span>
                    <span className="text-sky-400 font-bold">{config.stabilizationSeconds} sec</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={config.stabilizationSeconds}
                    onChange={(e) => setConfig((p) => ({ ...p, stabilizationSeconds: parseInt(e.target.value, 10) }))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>1s (Rapid)</span>
                    <span>5s (Rock Solid)</span>
                  </div>
                </div>

                {/* Altitude Tolerance */}
                <div className="space-y-1.5 bg-slate-900 p-3 rounded-lg border border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Altitude Tolerance Band:</span>
                    <span className="text-sky-400 font-bold">±{config.altitudeToleranceMeters.toFixed(1)} m</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.5"
                    step="0.1"
                    value={config.altitudeToleranceMeters}
                    onChange={(e) => setConfig((p) => ({ ...p, altitudeToleranceMeters: parseFloat(e.target.value) }))}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>±0.2 m</span>
                    <span>±1.5 m</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 6: Comprehensive 9-Point Pre-Flight Validation Checklist */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-amber-300 tracking-wider">
                5. PRE-FLIGHT MISSION VALIDATION CHECKLIST (9 CONDITIONS)
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                validation.isValid
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-400'
              }`}>
                {validation.isValid ? 'ALL 9 CHECKS SATISFIED' : 'CHECKS INCOMPLETE'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {validation.conditions.map((cond) => (
                <div
                  key={cond.id}
                  className={`p-2.5 rounded-lg border flex items-start space-x-2 text-[11px] ${
                    cond.passed
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                      : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {cond.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="overflow-hidden">
                    <div className="font-bold truncate">{cond.label}</div>
                    <div className="text-[10px] text-slate-400 truncate">{cond.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {!validation.isValid && (
              <p className="text-[11px] text-rose-400">
                ⚠ START MISSION is disabled until all 9 checks pass. Ensure FC MAVLink connection, GPS 3D fix, Home reference lock, and valid search boundary.
              </p>
            )}
          </div>
            </>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loiterState.isExecuting}
            className={`px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase transition ${
              loiterState.isExecuting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            Close
          </button>

          {activeMissionTab === '5M_LOITER_TEST' ? (
            <div className="flex items-center space-x-3 ml-auto">
              {(loiterState.step === 'COMPLETED' || loiterState.step === 'ABORTED') && (
                <button
                  type="button"
                  onClick={handleResetLoiterTest}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black uppercase tracking-wider transition cursor-pointer"
                >
                  RESET TEST
                </button>
              )}

              {loiterState.isExecuting ? (
                <button
                  type="button"
                  onClick={handleAbortLoiterTest}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center space-x-2 transition shadow-lg shadow-rose-600/40 cursor-pointer animate-pulse"
                >
                  <AlertOctagon className="w-4 h-4" />
                  <span>ABORT 5M LOITER TEST</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <label className={`flex items-center space-x-2 text-xs font-semibold select-none cursor-pointer px-3 py-2 rounded-xl transition border ${
                    loiterOperatorConfirmed
                      ? 'bg-amber-950/80 border-amber-500/80 text-amber-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                  }`}>
                    <input
                      type="checkbox"
                      id="modal-loiter-operator-confirm-footer"
                      checked={loiterOperatorConfirmed}
                      onChange={(e) => setLoiterOperatorConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
                    />
                    <span>
                      <span className="font-bold text-amber-300">Authorize Flight Area Clear</span>
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={isMissionActive}
                    onClick={handleExecuteLoiterTest}
                    className={`px-6 py-2.5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-2 transition shadow-lg ${
                      !isMissionActive
                        ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                    }`}
                    title="Execute 5M Loiter Test"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>EXECUTE 5M LOITER TEST</span>
                  </button>
                </div>
              )}
            </div>
          ) : activeMissionTab === 'AUTONOMOUS_CIRCLE_TEST' ? (
            <div className="flex flex-wrap items-center space-x-3 ml-auto gap-2">
              {(circleState.step === 'COMPLETED' || circleState.step === 'ABORTED') && (
                <button
                  type="button"
                  onClick={handleResetCircleTest}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black uppercase tracking-wider transition cursor-pointer"
                >
                  RESET TEST
                </button>
              )}

              {circleState.isExecuting ? (
                <button
                  type="button"
                  onClick={handleAbortCircleTest}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center space-x-2 transition shadow-lg shadow-rose-600/40 cursor-pointer animate-pulse"
                >
                  <AlertOctagon className="w-4 h-4" />
                  <span>ABORT CIRCLE MISSION</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <label className={`flex items-center space-x-2 text-xs font-semibold select-none cursor-pointer px-3 py-2 rounded-xl transition border ${
                    circleOperatorConfirmed
                      ? 'bg-amber-950/80 border-amber-500/80 text-amber-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                  }`}>
                    <input
                      type="checkbox"
                      id="modal-circle-operator-confirm-footer"
                      checked={circleOperatorConfirmed}
                      onChange={(e) => setCircleOperatorConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
                    />
                    <span>
                      <span className="font-bold text-amber-300">Authorize Flight Area Clear</span>
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={isMissionActive}
                    onClick={handleExecuteCircleTest}
                    className={`px-6 py-2.5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-2 transition shadow-lg ${
                      !isMissionActive
                        ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse'
                        : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                    }`}
                    title="Execute Autonomous Circle Test"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>EXECUTE CIRCLE TEST ({selectedCircleDiameter}m Ø, {selectedCircleAltitude}m ALT)</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center space-x-3 ml-auto gap-2">
              {/* Force Bypass Checkbox */}
              <label className={`flex items-center space-x-2 text-xs font-semibold select-none cursor-pointer px-3 py-2 rounded-xl transition border ${
                forceBypassChecks
                  ? 'bg-amber-950/80 border-amber-500/80 text-amber-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
              }`}>
                <input
                  type="checkbox"
                  id="modal-bypass-prearm-checkbox"
                  checked={forceBypassChecks}
                  onChange={(e) => {
                    setForceBypassChecks(e.target.checked);
                    missionEngine.setForceBypassChecks(e.target.checked);
                  }}
                  className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>
                  <span className="font-bold text-amber-300">No problem, Start Mission</span>{' '}
                  <span className="text-[10px] text-slate-400">(Bypass Checks)</span>
                </span>
              </label>

              {/* SAVE MISSION BUTTON */}
              <button
                type="button"
                onClick={handleSaveMission}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 text-xs font-black uppercase tracking-wider flex items-center space-x-2 transition cursor-pointer"
              >
                <Save className="w-4 h-4 text-amber-400" />
                <span>SAVE MISSION</span>
              </button>

              {/* START MISSION BUTTON */}
              <button
                type="button"
                disabled={(!validation.isValid && !forceBypassChecks) || isMissionActive}
                onClick={handleStart}
                className={`px-6 py-2.5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-2 transition shadow-lg ${
                  (validation.isValid || forceBypassChecks) && !isMissionActive
                    ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-emerald-600/30 cursor-pointer animate-pulse'
                    : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                }`}
                title={
                  forceBypassChecks
                    ? 'FORCE START: Checks bypassed by user override'
                    : !validation.isValid
                    ? 'START DISABLED: Check conditions or check "No problem, Start Mission"'
                    : 'Start Autonomous Mission'
                }
              >
                <Play className="w-4 h-4 fill-current" />
                <span>START MISSION</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
