import React, { useState, useEffect } from 'react';
import { Settings, Play, CheckCircle2, AlertTriangle, AlertOctagon, RotateCw } from 'lucide-react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { circleTestService } from '../../services/circleTestService';
import { CircleTestState, CircleTestValidation, CircleTestConfig } from '../../types/circleTest';
import { CircleTestMissionModal } from './CircleTestMissionModal';

interface CircleTestMissionCardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
}

export const CircleTestMissionCard: React.FC<CircleTestMissionCardProps> = ({
  telemetry,
  homePoint,
  pixhawkState
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [testState, setTestState] = useState<CircleTestState>(circleTestService.getState());
  const [config, setConfig] = useState<CircleTestConfig>(circleTestService.getConfig());

  useEffect(() => {
    return circleTestService.subscribeState((s) => {
      setTestState(s);
      setConfig(circleTestService.getConfig());
    });
  }, []);

  const validation: CircleTestValidation = circleTestService.validatePrerequisites(
    telemetry,
    pixhawkState,
    homePoint
  );

  const isExecuting = testState.isExecuting;

  return (
    <>
      <div className="bg-slate-900/90 p-3.5 sm:p-4 rounded-xl border border-sky-500/30 hud-border font-mono space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isExecuting ? 'bg-sky-400 animate-ping' : 'bg-sky-400'}`} />
            <span className="text-xs font-black uppercase text-sky-300 tracking-wider flex items-center space-x-1.5">
              <RotateCw className="w-3.5 h-3.5 text-sky-400" />
              <span>AUTONOMOUS CIRCLE TEST</span>
            </span>
            <span className="px-1.5 py-0.2 rounded bg-sky-950/80 border border-sky-500/30 text-[9px] font-bold text-sky-400 uppercase">
              ORBIT MISSION
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center space-x-1 cursor-pointer transition shadow-sm shadow-sky-600/30"
          >
            <Settings className="w-3 h-3" />
            <span>CONFIGURE / PREVIEW</span>
          </button>
        </div>

        {/* Display Block: Diameter, Altitude, Mode, Laps */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Diameter</div>
            <div className="font-extrabold text-sky-300 text-sm mt-0.5">
              {config.circleDiameterMeters} m
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Altitude</div>
            <div className="font-extrabold text-amber-300 text-sm mt-0.5">
              {config.targetAltitudeMeters} m
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Revolutions</div>
            <div className="font-extrabold text-emerald-400 text-sm mt-0.5">
              {config.laps} Lap{config.laps > 1 ? 's' : ''}
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Pattern Center</div>
            <div className="font-extrabold text-slate-200 text-xs mt-1 truncate">
              Takeoff Point
            </div>
          </div>
        </div>

        {/* Execution or Readiness Status Footer */}
        {isExecuting ? (
          <div className="p-2 bg-sky-950/60 border border-sky-500/40 rounded-lg flex items-center justify-between text-[11px]">
            <span className="text-sky-200 font-bold truncate">
              {testState.stepMessage}
            </span>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="ml-2 px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-black shrink-0 cursor-pointer"
            >
              MONITOR / ABORT
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/80">
            <span className="text-slate-400">Pre-Flight Readiness:</span>
            <span className={`font-bold flex items-center space-x-1 ${
              validation.allPassed ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {validation.allPassed ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Ready for Execution ({config.circleDiameterMeters}m Ø, {config.targetAltitudeMeters}m AGL)</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  <span>{validation.prerequisites.filter(p => p.passed).length}/{validation.prerequisites.length} Checks Ready</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Modal Dialog */}
      <CircleTestMissionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
      />
    </>
  );
};
