import React, { useState, useEffect } from 'react';
import { eventLogService, GroundStationLogEvent } from '../../services/eventLogService';
import { Terminal, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

interface CollapsibleEventLogProps {
  className?: string;
}

export const CollapsibleEventLog: React.FC<CollapsibleEventLogProps> = ({
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [events, setEvents] = useState<GroundStationLogEvent[]>(eventLogService.getEvents());

  useEffect(() => {
    const unsub = eventLogService.subscribeEvents((evts) => {
      setEvents(evts);
    });
    return unsub;
  }, []);

  const latestEvent = events[0];

  return (
    <div className={`bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-lg font-mono select-none ${className}`}>
      {/* Header bar - click to expand/collapse */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition"
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1 rounded bg-slate-800 text-sky-400 shrink-0">
            <Terminal className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-black tracking-wider text-slate-200 uppercase shrink-0">
            EVENT LOG
          </span>
          {latestEvent && (
            <span className="text-[11px] text-slate-400 truncate hidden sm:inline ml-2">
              <span className="text-slate-500 font-bold">{latestEvent.timeStr}</span> {latestEvent.message}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[10px] text-slate-500 font-bold">
            {events.length} events
          </span>
          <button
            type="button"
            className="p-1 text-slate-400 hover:text-white transition"
            aria-label="Toggle Event Log"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Logs */}
      {isExpanded && (
        <div className="p-3 border-t border-slate-800 bg-slate-950/90 space-y-2">
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1 text-xs">
            {events.length === 0 ? (
              <div className="text-slate-500 text-center py-2 text-[11px]">
                No events recorded yet
              </div>
            ) : (
              events.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start space-x-3 py-0.5 border-b border-slate-900/60 last:border-0"
                >
                  <span className="text-[10px] font-bold text-slate-500 shrink-0 select-text">
                    {evt.timeStr}
                  </span>
                  <span
                    className={`text-[11px] select-text break-words ${
                      evt.type === 'success'
                        ? 'text-emerald-400'
                        : evt.type === 'warn'
                        ? 'text-amber-300'
                        : evt.type === 'error'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {evt.message}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => eventLogService.clearEvents()}
              className="text-[10px] text-slate-500 hover:text-rose-400 flex items-center space-x-1 cursor-pointer transition"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Log</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
