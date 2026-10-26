import React, { useState, useEffect } from 'react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { CircleTestConfig, CircleTestState, CircleTestValidation } from '../../types/circleTest';
import { circleTestService } from '../../services/circleTestService';
import { CircleTestPanel } from './CircleTestPanel';
import {
  Compass,
  Play,
  X,
  AlertOctagon,
  RotateCw
} from 'lucide-react';

interface CircleTestMissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
}

export const CircleTestMissionModal: React.FC<CircleTestMissionModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  homePoint,
  pixhawkState
}) => {
  const [testState, setTestState] = useState<CircleTestState>(circleTestService.getState());
  const [config, setConfig] = useState<CircleTestConfig>(circleTestService.getConfig());
  const [selectedDiameter, setSelectedDiameter] = useState<number>(config.circleDiameterMeters);
  const [selectedAltitude, setSelectedAltitude] = useState<number>(config.targetAltitudeMeters);
  const [selectedLaps, setSelectedLaps] = useState<number>(config.laps);
  const [selectedDirection, setSelectedDirection] = useState<'CW' | 'CCW'>(config.direction);
  const [operatorConfirmed, setOperatorConfirmed] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  useEffect(() => {
    return circleTestService.subscribeState(setTestState);
  }, []);

  if (!isOpen) return null;

  const validation: CircleTestValidation = circleTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const handleDiameterChange = (d: number) => {
    setSelectedDiameter(d);
    circleTestService.setDiameter(d);
    setConfig(circleTestService.getConfig());
  };

  const handleAltitudeChange = (alt: number) => {
    setSelectedAltitude(alt);
    circleTestService.setAltitude(alt);
    setConfig(circleTestService.getConfig());
  };

  const handleLapsChange = (laps: number) => {
    setSelectedLaps(laps);
    circleTestService.setLaps(laps);
    setConfig(circleTestService.getConfig());
  };

  const handleDirectionChange = (dir: 'CW' | 'CCW') => {
    setSelectedDirection(dir);
    circleTestService.setDirection(dir);
    setConfig(circleTestService.getConfig());
  };

  const handleExecute = async () => {
    setExecutionError(null);
    if (!operatorConfirmed) {
      setOperatorConfirmed(true);
    }
    const res = await circleTestService.executeMission(telemetry, pixhawkState, homePoint, true);
    if (!res.success) {
      setExecutionError(res.error || 'Failed to start Autonomous Circle Test.');
    }
  };

  const handleAbort = () => {
    circleTestService.abort('Operator Aborted via Modal');
  };

  const handleReset = () => {
    circleTestService.resetState();
    setOperatorConfirmed(false);
    setExecutionError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto font-mono">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-sky-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-sky-950/90 via-slate-900 to-slate-900 border-b border-sky-500/30 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-400">
              <RotateCw className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black uppercase text-sky-200 tracking-wider">
                  AUTONOMOUS CIRCLE TEST MISSION
                </h2>
                <span className="px-2 py-0.5 rounded bg-sky-950 border border-sky-500/40 text-[9px] font-bold text-sky-300 uppercase">
                  TAKEOFF CENTERED
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Climb to altitude, transit outward, execute 360° circle orbit of configured diameter, and auto-land at center.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={testState.isExecuting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          <CircleTestPanel
            telemetry={telemetry}
            homePoint={homePoint}
            pixhawkState={pixhawkState}
            operatorConfirmed={operatorConfirmed}
            onOperatorConfirmedChange={setOperatorConfirmed}
            selectedDiameter={selectedDiameter}
            onDiameterSelect={handleDiameterChange}
            selectedAltitude={selectedAltitude}
            onAltitudeSelect={handleAltitudeChange}
            selectedLaps={selectedLaps}
            onLapsSelect={handleLapsChange}
            selectedDirection={selectedDirection}
            onDirectionSelect={handleDirectionChange}
            onReset={handleReset}
            executionError={executionError}
          />
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={testState.isExecuting}
            className={`px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold uppercase transition ${
              testState.isExecuting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            Close
          </button>

          <div className="flex flex-wrap items-center space-x-3 ml-auto gap-2">
            {(testState.step === 'COMPLETED' || testState.step === 'ABORTED') && (
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-black uppercase tracking-wider transition cursor-pointer"
              >
                RESET TEST
              </button>
            )}

            {testState.isExecuting ? (
              <button
                type="button"
                onClick={handleAbort}
                className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center space-x-2 transition shadow-lg shadow-rose-600/40 cursor-pointer animate-pulse"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>ABORT CIRCLE MISSION</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <label className={`flex items-center space-x-2 text-xs font-semibold select-none cursor-pointer px-3 py-2 rounded-xl transition border ${
                  operatorConfirmed
                    ? 'bg-amber-950/80 border-amber-500/80 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}>
                  <input
                    type="checkbox"
                    checked={operatorConfirmed}
                    onChange={(e) => setOperatorConfirmed(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 accent-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span>
                    <span className="font-bold text-amber-300">Authorize Flight Area Clear</span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleExecute}
                  className="px-6 py-2.5 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center space-x-2 transition shadow-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-600/30 cursor-pointer animate-pulse"
                  title="Execute Autonomous Circle Test"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>EXECUTE CIRCLE TEST ({selectedDiameter}m Ø, {selectedAltitude}m ALT)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
