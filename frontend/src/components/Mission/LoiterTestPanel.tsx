import React from 'react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { loiterTestService } from '../../services/loiterTestService';
import { LoiterTestState, LoiterTestValidation } from '../../types/loiterTest';
import { 
  Sliders, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  AlertOctagon, 
  Check 
} from 'lucide-react';

interface LoiterTestPanelProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  operatorConfirmed: boolean;
  onOperatorConfirmedChange: (confirmed: boolean) => void;
  selectedDuration: number;
  onDurationSelect: (sec: number) => void;
  onReset: () => void;
  executionError: string | null;
}

export const LoiterTestPanel: React.FC<LoiterTestPanelProps> = ({
  telemetry,
  homePoint,
  pixhawkState,
  operatorConfirmed,
  onOperatorConfirmedChange,
  selectedDuration,
  onDurationSelect,
  onReset,
  executionError
}) => {
  const [testState, setTestState] = React.useState<LoiterTestState>(loiterTestService.getState());

  React.useEffect(() => {
    return loiterTestService.subscribeState(setTestState);
  }, []);

  const validation: LoiterTestValidation = loiterTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const isExecuting = testState.isExecuting;

  return (
    <div className="space-y-4 font-mono select-none">
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
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between ${
            testState.step === 'COMPLETED'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
              : 'bg-rose-950/80 border-rose-500 text-rose-200'
          }`}
        >
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
            onClick={onReset}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold uppercase transition cursor-pointer"
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
          <Sliders className="w-4 h-4 text-sky-400" />
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
            <div className="font-extrabold text-slate-200 text-xs mt-0.5">Home Position</div>
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
                onClick={() => onDurationSelect(dur)}
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
            { id: 'LOITER_HOLD', label: 'LOITER — 5 m', sub: `Hold position for ${selectedDuration}s` },
            { id: 'DESCENDING', label: 'DESCEND', sub: 'Controlled vertical descent' },
            { id: 'LANDING', label: 'LAND — HOME', sub: 'Touchdown at takeoff position' },
            { id: 'DISARMING', label: 'DISARM', sub: 'Motors stop after landing' }
          ].map((step, idx, arr) => {
            const isActive = testState.step === step.id;
            const isPassed = !isExecuting && testState.step === 'COMPLETED';
            return (
              <React.Fragment key={step.id}>
                <div
                  className={`w-full max-w-md p-2.5 rounded-lg border text-center transition flex items-center justify-between px-4 ${
                    isActive
                      ? 'bg-sky-600 border-sky-400 text-white shadow-lg shadow-sky-600/30 scale-105'
                      : isPassed
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300'
                  }`}
                >
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
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
              validation.allPassed
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                : 'bg-rose-950/80 border-rose-500/50 text-rose-400'
            }`}
          >
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
              id="loiter-operator-confirm-checkbox"
              checked={operatorConfirmed}
              onChange={(e) => onOperatorConfirmedChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
            />
            <span className="text-xs text-amber-200 font-bold select-none leading-relaxed">
              I explicitly confirm the flight area is clear of personnel and obstacles, and I authorize the automatic execution of the complete 5M Loiter sequence.
              {!validation.allPassed && (
                <span className="block mt-1 text-[11px] text-amber-400 font-normal">
                  ⚡ Checking this enables immediate takeoff and overrides any pre-flight execution blocker.
                </span>
              )}
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
