import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { circleTestService } from '../../services/circleTestService';
import { CircleTestState, CircleTestValidation } from '../../types/circleTest';
import {
  Sliders,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertOctagon,
  Check,
  RotateCw,
  RotateCcw,
  Gauge,
  Compass,
  ArrowUpRight
} from 'lucide-react';

interface CircleTestPanelProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
  operatorConfirmed: boolean;
  onOperatorConfirmedChange: (confirmed: boolean) => void;
  selectedDiameter: number;
  onDiameterSelect: (diameter: number) => void;
  selectedAltitude: number;
  onAltitudeSelect: (alt: number) => void;
  selectedLaps: number;
  onLapsSelect: (laps: number) => void;
  selectedDirection: 'CW' | 'CCW';
  onDirectionSelect: (dir: 'CW' | 'CCW') => void;
  onReset: () => void;
  executionError: string | null;
}

export const CircleTestPanel: React.FC<CircleTestPanelProps> = ({
  telemetry,
  homePoint,
  pixhawkState,
  operatorConfirmed,
  onOperatorConfirmedChange,
  selectedDiameter,
  onDiameterSelect,
  selectedAltitude,
  onAltitudeSelect,
  selectedLaps,
  onLapsSelect,
  selectedDirection,
  onDirectionSelect,
  onReset,
  executionError
}) => {
  const [testState, setTestState] = useState<CircleTestState>(circleTestService.getState());

  useEffect(() => {
    return circleTestService.subscribeState(setTestState);
  }, []);

  const validation: CircleTestValidation = circleTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const isExecuting = testState.isExecuting;
  const radius = +(selectedDiameter / 2).toFixed(1);

  // Quick Preset values
  const diameterPresets = [6, 10, 15, 20, 30, 50];
  const altitudePresets = [3, 5, 8, 10, 15];

  // Visual orbit animation/preview math
  const orbitAngle = testState.isExecuting ? testState.currentAngleDeg : (selectedDirection === 'CW' ? 45 : 315);
  const orbitRad = (orbitAngle - 90) * (Math.PI / 180);
  const droneSvgX = 100 + 65 * Math.cos(orbitRad);
  const droneSvgY = 100 + 65 * Math.sin(orbitRad);

  return (
    <div className="space-y-4 font-mono text-slate-200">
      {/* Active State / Progress Bar */}
      {isExecuting && (
        <div className="p-3.5 bg-sky-950/90 border border-sky-500 rounded-xl space-y-2.5 shadow-lg shadow-sky-950/50 animate-pulse">
          <div className="flex items-center justify-between text-xs">
            <span className="font-extrabold text-sky-300 flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span>ORBIT ACTIVE: {testState.step}</span>
            </span>
            <span className="text-amber-400 font-bold">
              Lap {testState.currentLap} of {testState.totalLaps} ({testState.progressPercent}%)
            </span>
          </div>

          <div className="text-xs text-sky-100 font-medium">
            {testState.stepMessage}
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-sky-700/50">
            <div
              className="bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 h-full transition-all duration-300"
              style={{ width: `${testState.progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-300 pt-1 border-t border-sky-900/60">
            <div>Alt: <span className="font-bold text-amber-300">{testState.currentAltitude.toFixed(1)}m</span> / {testState.targetAltitude}m</div>
            <div>Angle: <span className="font-bold text-sky-300">{testState.currentAngleDeg}°</span></div>
            <div>Speed: <span className="font-bold text-emerald-300">{testState.flightSpeedMps} m/s</span></div>
          </div>
        </div>
      )}

      {/* Completion or Abort Banner */}
      {!isExecuting && (testState.step === 'COMPLETED' || testState.step === 'ABORTED') && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between ${
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

      {/* Visual Orbit Preview Diagram & Flight Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Left: SVG Circular Orbit Preview */}
        <div className="md:col-span-5 bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="text-[10px] font-black uppercase text-sky-400 tracking-wider mb-1 self-start flex items-center space-x-1">
            <Compass className="w-3.5 h-3.5" />
            <span>FLIGHT ORBIT VISUALIZATION</span>
          </div>

          <svg viewBox="0 0 200 200" className="w-44 h-44 sm:w-48 sm:h-48 my-1">
            {/* Grid Circles */}
            <circle cx="100" cy="100" r="90" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx="100" cy="100" r="65" fill="#0369a1" fillOpacity="0.08" stroke="#38bdf8" strokeWidth="2" strokeDasharray={testState.isExecuting ? "4 2" : "none"} />
            <circle cx="100" cy="100" r="30" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="2 2" />

            {/* Center Home Takeoff Reference Point */}
            <circle cx="100" cy="100" r="8" fill="#f59e0b" fillOpacity="0.25" stroke="#f59e0b" strokeWidth="1.5" />
            <text x="100" y="103" textAnchor="middle" dominantBaseline="middle" fill="#fbbf24" fontSize="8" fontWeight="bold">H</text>

            {/* Diameter Crossline */}
            <line x1="35" y1="100" x2="165" y2="100" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="2 2" />
            <text x="100" y="85" textAnchor="middle" fill="#7dd3fc" fontSize="7" fontWeight="bold">Ø {selectedDiameter} m</text>
            <text x="100" y="118" textAnchor="middle" fill="#94a3b8" fontSize="6.5">Radius: {radius} m</text>

            {/* Drone Position Marker */}
            <g transform={`translate(${droneSvgX}, ${droneSvgY})`}>
              <circle cx="0" cy="0" r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
              <polygon points="0,-8 3,-2 -3,-2" fill="#f59e0b" />
            </g>

            {/* Orbit Direction Arrow */}
            <path
              d={selectedDirection === 'CW'
                ? "M 100 35 A 65 65 0 0 1 165 100"
                : "M 100 35 A 65 65 0 0 0 35 100"
              }
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2"
              strokeDasharray="4 3"
              markerEnd="url(#arrow)"
            />
          </svg>

          <div className="flex items-center justify-between w-full text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
            <span>Center: Takeoff (0,0)</span>
            <span className="text-amber-300 font-bold">AGL: {selectedAltitude} m</span>
          </div>
        </div>

        {/* Right: Parameter Quick Cards */}
        <div className="md:col-span-7 bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="text-xs font-black uppercase text-sky-300 tracking-wider flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <span>1. MISSION FLIGHT PARAMETERS</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Circle Diameter</div>
              <div className="font-extrabold text-sky-300 text-sm mt-0.5">
                {selectedDiameter} m <span className="text-[10px] text-slate-400 font-normal">(R: {radius}m)</span>
              </div>
            </div>

            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Takeoff / Orbit Alt</div>
              <div className="font-extrabold text-amber-300 text-sm mt-0.5">
                {selectedAltitude} m AGL
              </div>
            </div>

            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Orbit Laps & Angle</div>
              <div className="font-extrabold text-emerald-400 text-xs mt-0.5">
                {selectedLaps} Lap{selectedLaps > 1 ? 's' : ''} ({selectedLaps * 360}°)
              </div>
            </div>

            <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Landing Reference</div>
              <div className="font-extrabold text-slate-200 text-xs mt-1 truncate">
                Takeoff Point
              </div>
            </div>
          </div>

          {/* Diameter Selection Buttons */}
          <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-bold flex items-center space-x-1">
                <span>Circle Diameter (Takeoff Center):</span>
              </span>
              <span className="text-sky-300 font-extrabold text-xs">{selectedDiameter} m</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {diameterPresets.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={isExecuting}
                  onClick={() => onDiameterSelect(d)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border cursor-pointer ${
                    selectedDiameter === d
                      ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-600/30 font-black'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  } ${isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {d}m
                </button>
              ))}
              <div className="flex items-center ml-auto space-x-1">
                <input
                  type="number"
                  disabled={isExecuting}
                  min={2}
                  max={150}
                  step={1}
                  value={selectedDiameter}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 2) onDiameterSelect(val);
                  }}
                  className="w-16 px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-center text-xs text-sky-200 font-bold focus:border-sky-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">m</span>
              </div>
            </div>
          </div>

          {/* Altitude Selection Buttons */}
          <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-bold flex items-center space-x-1">
                <span>Flight Cruise Altitude:</span>
              </span>
              <span className="text-amber-300 font-extrabold text-xs">{selectedAltitude} m</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {altitudePresets.map((alt) => (
                <button
                  key={alt}
                  type="button"
                  disabled={isExecuting}
                  onClick={() => onAltitudeSelect(alt)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border cursor-pointer ${
                    selectedAltitude === alt
                      ? 'bg-amber-600 border-amber-400 text-white shadow-md shadow-amber-600/30 font-black'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  } ${isExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {alt}m
                </button>
              ))}
              <div className="flex items-center ml-auto space-x-1">
                <input
                  type="number"
                  disabled={isExecuting}
                  min={2}
                  max={60}
                  step={1}
                  value={selectedAltitude}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 2) onAltitudeSelect(val);
                  }}
                  className="w-16 px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-center text-xs text-amber-200 font-bold focus:border-amber-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">m</span>
              </div>
            </div>
          </div>

          {/* Laps & Direction */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Revolutions (Laps)</div>
              <div className="flex items-center space-x-1">
                {[1, 2, 3].map((lap) => (
                  <button
                    key={lap}
                    type="button"
                    disabled={isExecuting}
                    onClick={() => onLapsSelect(lap)}
                    className={`flex-1 py-1 rounded-lg text-xs font-bold transition border cursor-pointer ${
                      selectedLaps === lap
                        ? 'bg-emerald-600 border-emerald-400 text-white shadow font-black'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {lap} Lap
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Direction</div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => onDirectionSelect('CW')}
                  className={`flex-1 py-1 rounded-lg text-xs font-bold transition border flex items-center justify-center space-x-1 cursor-pointer ${
                    selectedDirection === 'CW'
                      ? 'bg-sky-600 border-sky-400 text-white shadow font-black'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <RotateCw className="w-3 h-3" />
                  <span>CW</span>
                </button>
                <button
                  type="button"
                  disabled={isExecuting}
                  onClick={() => onDirectionSelect('CCW')}
                  className={`flex-1 py-1 rounded-lg text-xs font-bold transition border flex items-center justify-center space-x-1 cursor-pointer ${
                    selectedDirection === 'CCW'
                      ? 'bg-sky-600 border-sky-400 text-white shadow font-black'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>CCW</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Step Sequence Execution Plan */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2.5">
        <div className="text-xs font-black uppercase text-slate-300 tracking-wider">
          2. AUTONOMOUS CIRCLE SEQUENCE PIPELINE
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5 text-[10px]">
          {[
            { step: 'ARMING', label: '1. Arm Motors', desc: 'FC Arm & Spin' },
            { step: 'TAKEOFF_CLIMB', label: `2. Climb ${selectedAltitude}m`, desc: 'Vertical Ascent' },
            { step: 'TRANSIT_TO_PERIMETER', label: `3. Out to R=${radius}m`, desc: 'Transit to Edge' },
            { step: 'ORBITING', label: `4. 360° Orbit (${selectedLaps}x)`, desc: 'Smooth Circle' },
            { step: 'RETURNING_TO_CENTER', label: '5. Return Center', desc: 'Over Takeoff Pt' },
            { step: 'DESCENDING', label: '6. Land & Disarm', desc: 'Touchdown' }
          ].map((item, idx) => {
            const isActive = testState.step === item.step;
            const isDone = testState.step === 'COMPLETED';
            return (
              <div
                key={idx}
                className={`p-2 rounded-lg border text-center transition ${
                  isActive
                    ? 'bg-sky-950/80 border-sky-400 text-sky-200 shadow-md shadow-sky-500/20 font-bold'
                    : isDone
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-500'
                }`}
              >
                <div className="font-extrabold truncate">{item.label}</div>
                <div className="text-[9px] opacity-75 truncate">{item.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Safety Prerequisites Check */}
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
              Execution note: {validation.blockingReason || 'Ensure GPS 3D fix, MAVLink link, and vehicle disarmed on ground.'}
            </span>
          </div>
        )}
      </div>

      {/* Section 4: Operator Confirmation */}
      {!isExecuting && testState.step !== 'COMPLETED' && (
        <div className={`p-3.5 rounded-xl space-y-2 border transition ${
          operatorConfirmed
            ? 'bg-amber-950/60 border-amber-500/80 shadow-md shadow-amber-500/10'
            : 'bg-amber-950/30 border-amber-500/40'
        }`}>
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              id="circle-operator-confirm-checkbox"
              checked={operatorConfirmed}
              onChange={(e) => onOperatorConfirmedChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500"
            />
            <span className="text-xs text-amber-200 font-bold select-none leading-relaxed">
              I authorize autonomous circle flight (Diameter: {selectedDiameter}m, Alt: {selectedAltitude}m, {selectedLaps} lap) and confirm the airspace around takeoff position is clear of obstacles.
              {!validation.allPassed && (
                <span className="block mt-1 text-[11px] text-amber-400 font-normal">
                  ⚡ Checking this enables immediate execution and overrides pre-flight blocker checks.
                </span>
              )}
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
