import React, { useState } from 'react';
import { PixhawkConnectionState } from '../../types/mavlink';

interface TacticalSideStackProps {
  pixhawkState: PixhawkConnectionState;
  className?: string;
}

export const TacticalSideStack: React.FC<TacticalSideStackProps> = ({
  pixhawkState,
  className = ''
}) => {
  const [isLogExpanded, setIsLogExpanded] = useState<boolean>(false);

  return (
    <div className={`w-72 flex flex-col gap-2 select-none z-30 ${className}`}>
      {/* EVENT LOG COLLAPSIBLE CARD */}
      <div className="bg-[#1b1c1e]/95 backdrop-blur-md rounded-xl shadow-xl border border-[#343537]/80 overflow-hidden">
        <div
          onClick={() => setIsLogExpanded(!isLogExpanded)}
          className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-[#1f2022] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#ffb95f] text-[16px]">notifications_active</span>
            <span className="font-sans text-[11px] uppercase font-bold tracking-wider text-slate-200">EVENT LOG</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-[#ee9800]/20 text-[#ffb95f] font-mono text-[9px] font-bold">
              {pixhawkState.statusHistory?.length || 0} MSGS
            </span>
            {/* Collapse (-) / Expand (+) Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLogExpanded(!isLogExpanded);
              }}
              className="w-5 h-5 rounded flex items-center justify-center bg-[#292a2c] hover:bg-[#343537] text-slate-300 hover:text-white font-bold text-xs transition-colors cursor-pointer border border-[#343537]"
              title={isLogExpanded ? 'Collapse Event Log (-)' : 'Expand Event Log (+)'}
            >
              {isLogExpanded ? '−' : '+'}
            </button>
          </div>
        </div>

        {isLogExpanded && (
          <div className="p-2 border-t border-[#343537]/60 max-h-40 overflow-y-auto font-mono text-[10px] flex flex-col gap-1 bg-[#0d0e10]/90">
            {pixhawkState.statusHistory?.slice(0, 8).map((log, i) => (
              <div key={i} className="text-slate-300 leading-tight border-b border-[#292a2c]/40 pb-0.5">
                <span className="text-[#aec6ff]">[{log.severity}]</span> {log.text}
              </div>
            )) || <div className="text-slate-500">No active warnings.</div>}
          </div>
        )}
      </div>
    </div>
  );
};
