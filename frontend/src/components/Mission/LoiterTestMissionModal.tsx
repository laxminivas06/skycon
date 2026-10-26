import React, { useState, useEffect } from 'react';
import { 
  DroneTelemetry, 
  HomePoint 
} from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { 
  LoiterTestConfig, 
  LoiterTestState, 
  LoiterTestValidation 
} from '../../types/loiterTest';
import { loiterTestService } from '../../services/loiterTestService';
import { 
  Compass, 
  PlaneTakeoff, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  AlertOctagon, 
  Play, 
  X, 
  Clock, 
  Check, 
  ArrowDown, 
  ShieldCheck, 
  ShieldAlert, 
  MapPin, 
  Zap, 
  SlidersHorizontal 
} from 'lucide-react';

interface LoiterTestMissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
}

export const LoiterTestMissionModal: React.FC<LoiterTestMissionModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  homePoint,
  pixhawkState
}) => {
  const [testState, setTestState] = useState<LoiterTestState>(loiterTestService.getState());
  const [config, setConfig] = useState<LoiterTestConfig>(loiterTestService.getConfig());
  const [selectedDuration, setSelectedDuration] = useState<number>(config.loiterDurationSeconds);
  const [operatorConfirmed, setOperatorConfirmed] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Synchronize state with loiterTestService
  useEffect(() => {
    const unsub = loiterTestService.subscribeState((st) => {
      setTestState(st);
      if (st.error) {
        setExecutionError(st.error);
      }
    });
    return unsub;
  }, []);

  // Validation
  const validation: LoiterTestValidation = loiterTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  if (!isOpen) return null;

  const handleDurationSelect = (sec: number) => {
    setSelectedDuration(sec);
    loiterTestService.setLoiterDuration(sec);
    setConfig(loiterTestService.getConfig());
  };

  const handleExecute = async () => {
    setExecutionError(null);
    if (!operatorConfirmed) return;

    const res = await loiterTestService.executeMission(telemetry, pixhawkState, homePoint, true);
    if (!res.success) {
      setExecutionError(res.error || 'Failed to start 5M Loiter Test.');
    }
  };

  const handleAbort = () => {
    loiterTestService.abort('Operator Aborted via Modal');
  };

  const handleReset = () => {
    loiterTestService.resetState();
    setOperatorConfirmed(false);
    setExecutionError(null);
  };

  const isExecuting = testState.isExecuting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 font-mono">
      <div className="bg-slate-900 border border-sky-500/40 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl shadow-sky-950/60 overflow-hidden">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
              <Compass className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black uppercase text-white tracking-wider">
                  5M LOITER TEST
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-sky-950 border border-sky-500/40 text-sky-300">
                  CONTROLLED TEST MISSION
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Vertical 5 m climb, position hold in LOITER, controlled descent & auto-disarm
              </p>
            </div>
          </div>

          {!isExecuting && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* Active Execution Banner */}
          {isExecuting && (
            <div className="p-3.5 bg-sky-950/90 border-2 border-sky-500 rounded-xl space-y-2 shadow-lg shadow-sky-600/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
                  <span className="text-xs font-black uppercase tracking-wider text-sky-200">
                    TEST SEQUENCE IN PROGRESS — {testState.step}
                  </span>
                </div>
                <span className="text-xs font-extrabold text-sky-300">
                  Alt: {testState.currentAltitude.toFixed(1)} / 5.0 m
                </span>
              </div>
              <div className="text-xs text-sky-100 font-bold bg-slate-950/80 p-2.5 rounded-lg border border-sky-500/30">
                {testState.stepMessage}
              </div>
            </div>
          )}

          {/* Completed / Aborted Banner */}
          {!isExecuting && (testState.step === 'COMPLETED' || testState.step === 'ABORTED') && (
            <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
              testState.step === 'COMPLETED'
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                : 'bg-rose-950/80 border-rose-500 text-rose-200'
            }`}>
              <div className="flex items-center space-x-2 text-xs">
                {testState.step === 'COMPLETED' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0" />
                )}
                <span>{testState.stepMessage}</span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold uppercase transition"
              >
                RESET
              </button>
            </div>
          )}

          {/* Execution Error Banner */}
          {executionError && !isExecuting && (
            <div className="p-3 bg-rose-950/90 border border-rose-500 rounded-xl text-rose-200 text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{executionError}</span>
            </div>
          )}

          {/* Section 1: Required Mission Parameters Grid */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs font-black uppercase text-sky-300 tracking-wider flex items-center space-x-2">
              <SlidersHorizontal className="w-4 h-4 text-sky-400" />
              <span>1. MISSION PARAMETERS</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Mission Name</div>
                <div className="font-extrabold text-sky-300 text-xs mt-0.5">5M_LOITER_TEST</div>
              </div>

              <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Takeoff Altitude</div>
                <div className="font-extrabold text-amber-300 text-sm mt-0.5">5 m AGL</div>
              </div>

              <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Flight Mode</div>
                <div className="font-extrabold text-emerald-400 text-xs mt-0.5">LOITER</div>
              </div>

              <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Landing Position</div>
                <div className="font-extrabold text-slate-200 text-xs mt-0.5">Home / Takeoff</div>
              </div>
            </div>

            {/* Configurable Hold Duration */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 text-xs text-slate-300">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>Loiter Hold Duration at 5 m:</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {[5, 10, 15, 20, 30].map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    disabled={isExecuting}
                    onClick={() => handleDurationSelect(dur)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border cursor-pointer ${
                      selectedDuration === dur
                        ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/30 font-black'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    } ${isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {dur}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Complete Mission Sequence (Prompt Requirement) */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs font-black uppercase text-slate-300 tracking-wider">
              2. REQUIRED EXECUTION SEQUENCE
            </div>

            <div className="flex flex-col items-center space-y-1.5 py-1 text-xs font-bold">
              {[
                { id: 'ARMING', label: 'ARM', sub: 'Motors spin confirmation' },
                { id: 'TAKEOFF_CLIMB', label: 'TAKEOFF — 5 m', sub: 'Vertical climb to 5m AGL' },
                { id: 'LOITER_HOLD', label: `LOITER — 5 m`, sub: `Hold position for ${selectedDuration}s` },
                { id: 'DESCENDING', label: 'DESCEND', sub: 'Controlled vertical descent' },
                { id: 'LANDING', label: 'LAND — HOME', sub: 'Touchdown at takeoff position' },
                { id: 'DISARMING', label: 'DISARM', sub: 'Motors stop after landing' }
              ].map((step, idx, arr) => {
                const isActive = testState.step === step.id;
                const isPassed = !isExecuting && testState.step === 'COMPLETED';
                return (
                  <React.Fragment key={step.id}>
                    <div className={`w-full max-w-md p-2.5 rounded-lg border text-center transition flex items-center justify-between px-4 ${
                      isActive
                        ? 'bg-sky-600 border-sky-400 text-white shadow-lg shadow-sky-600/30 scale-105'
                        : isPassed
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300'
                    }`}>
                      <span className="text-[11px] font-black">{step.label}</span>
                      <span className="text-[10px] text-slate-400 font-normal">{step.sub}</span>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className="text-slate-600 text-xs">↓</div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Section 3: Pre-Flight Safety Prerequisites */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-amber-300 tracking-wider">
                3. PRE-FLIGHT PREREQUISITES CHECK
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                validation.allPassed
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                  : 'bg-rose-950/80 border-rose-500/50 text-rose-400'
              }`}>
                {validation.allPassed ? 'ALL PREREQUISITES SATISFIED ✓' : 'PREREQUISITES NOT MET'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {validation.prerequisites.map((p) => (
                <div
                  key={p.id}
                  className={`p-2.5 rounded-lg border flex items-start space-x-2 text-[11px] ${
                    p.passed
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                      : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {p.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="overflow-hidden">
                    <div className="font-bold truncate">{p.label}</div>
                    <div className="text-[10px] text-slate-400 truncate">{p.reason}</div>
                  </div>
                </div>
              ))}
            </div>

            {!validation.allPassed && (
              <div className="p-2.5 bg-rose-950/60 border border-rose-500/40 rounded-lg text-xs text-rose-300 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>
                  Execution blocked: {validation.blockingReason || 'Ensure GPS 3D fix (≥6 sats), MAVLink link, and vehicle disarmed on ground.'}
                </span>
              </div>
            )}
          </div>

          {/* Section 4: Explicit Operator Confirmation */}
          {!isExecuting && testState.step !== 'COMPLETED' && (
            <div className={`p-3.5 rounded-xl space-y-2 border transition ${
              operatorConfirmed 
                ? 'bg-amber-950/60 border-amber-500/80 shadow-md shadow-amber-500/10' 
                : 'bg-amber-950/30 border-amber-500/40'
            }`}>
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  id="loiter-modal-confirm-checkbox"
                  checked={operatorConfirmed}
                  onChange={(e) => setOperatorConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
                />
                <span className="text-xs text-amber-200 font-bold select-none leading-relaxed">
                  I explicitly confirm the flight area is clear of personnel and obstacles, and I authorize the automatic execution of the complete 5M Loiter sequence.
                  {!validation.allPassed && (
                    <span className="block mt-1 text-[11px] text-amber-400 font-normal">
                      ⚡ Checking this enables immediate execution and overrides any pre-flight execution blocker.
                    </span>
                  )}
                </span>
              </label>
            </div>
          )}

        </div>

        {/* Modal Footer / Actions */}
        <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className={`px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase transition ${
              isExecuting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            Close
          </button>

          <div className="flex items-center space-x-3 ml-auto">
            {/* ABORT BUTTON (Active during execution) */}
            {isExecuting ? (
              <button
                type="button"
                onClick={handleAbort}
                className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center space-x-2 transition shadow-lg shadow-rose-600/40 cursor-pointer animate-pulse"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>ABORT 5M LOITER TEST</span>
              </button>
            ) : (
              /* EXECUTE BUTTON */
              <button
                type="button"
                disabled={!operatorConfirmed || isExecuting}
                onClick={handleExecute}
                className={`px-6 py-2.5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-2 transition shadow-lg ${
                  operatorConfirmed && !isExecuting
                    ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse'
                    : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                }`}
                title={!operatorConfirmed ? 'Please confirm the operator declaration checkbox to enable execution' : 'Execute 5M Loiter Test'}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>EXECUTE 5M LOITER TEST</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
