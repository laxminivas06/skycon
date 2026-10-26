import React, { useState, useEffect } from 'react';
import { Compass, Settings, Play, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { DroneTelemetry, HomePoint } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { loiterTestService } from '../../services/loiterTestService';
import { LoiterTestState, LoiterTestValidation } from '../../types/loiterTest';
import { LoiterTestMissionModal } from './LoiterTestMissionModal';

interface LoiterTestMissionCardProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  pixhawkState: PixhawkConnectionState;
}

export const LoiterTestMissionCard: React.FC<LoiterTestMissionCardProps> = ({
  telemetry,
  homePoint,
  pixhawkState
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [testState, setTestState] = useState<LoiterTestState>(loiterTestService.getState());

  useEffect(() => {
    return loiterTestService.subscribeState(setTestState);
  }, []);

  const validation: LoiterTestValidation = loiterTestService.validatePrerequisites(
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
            <span className="text-xs font-black uppercase text-sky-300 tracking-wider">
              5M LOITER TEST
            </span>
            <span className="px-1.5 py-0.2 rounded bg-sky-950/80 border border-sky-500/30 text-[9px] font-bold text-sky-400 uppercase">
              TEST MISSION
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

        {/* Required UI Display Block (Per User Specification) */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Takeoff</div>
            <div className="font-extrabold text-amber-300 text-sm mt-0.5">
              5 m
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Mode</div>
            <div className="font-extrabold text-emerald-400 text-sm mt-0.5">
              LOITER
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Landing</div>
            <div className="font-extrabold text-slate-200 text-xs mt-1 truncate">
              Home Position
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
                  <span>Ready for Execution</span>
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
      <LoiterTestMissionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        telemetry={telemetry}
        homePoint={homePoint}
        pixhawkState={pixhawkState}
      />
    </>
  );
};
