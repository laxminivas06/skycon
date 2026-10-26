import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Download, ArrowDownCircle, Maximize2 } from 'lucide-react';
import { Card } from '../../ui/Card';
import { eventLogService, GroundStationLogEvent } from '../../services/eventLogService';

interface TelemetryLogProps {
  className?: string;
  isFixture?: boolean;
  onExpandLogs?: () => void;
}

interface LogEntry {
  id: string;
  timeStr: string;
  message: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

const FIXTURE_LOGS: LogEntry[] = [
  { id: 'f1', timeStr: '12:00:01', message: 'MAVLink link established (TELEM2 @ 57600 baud)', type: 'info' },
  { id: 'f2', timeStr: '12:00:03', message: 'GPS 3D lock acquired (14 sats, HDOP 0.8)', type: 'success' },
  { id: 'f3', timeStr: '12:00:04', message: 'Battery: 92% (16.2V) • 4S LiPo Healthy', type: 'info' },
  { id: 'f4', timeStr: '12:00:05', message: 'EKF3: State estimation healthy & converged', type: 'success' },
  { id: 'f5', timeStr: '12:00:06', message: 'Vehicle armed in GUIDED mode', type: 'warn' },
  { id: 'f6', timeStr: '12:00:08', message: 'Mission started: Autonomous grid search active', type: 'success' },
];

export const TelemetryLog: React.FC<TelemetryLogProps> = ({
  className = '',
  isFixture = false,
  onExpandLogs,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'NAV' | 'VISION' | 'WARN'>('ALL');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFixture) {
      setLogs(FIXTURE_LOGS);
      return;
    }

    const unsub = eventLogService.subscribeEvents((events: GroundStationLogEvent[]) => {
      // eventLogService unshifts new items, reverse for chronological top-to-bottom log view
      const chronological = [...events].reverse().slice(-500);
      setLogs(chronological);
    });

    return () => unsub();
  }, [isFixture]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = () => {
    if (!isFixture) {
      eventLogService.clearEvents();
    }
    setLogs([]);
  };

  const handleExport = () => {
    const textContent = logs.map((l) => `[${l.timeStr}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skycon-flight-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter((log) => {
    if (filter === 'ALL') return true;
    if (filter === 'WARN') return log.type === 'warn' || log.type === 'error';
    if (filter === 'VISION') {
      const lower = log.message.toLowerCase();
      return lower.includes('box') || lower.includes('qr') || lower.includes('target') || lower.includes('camera') || lower.includes('vision');
    }
    if (filter === 'NAV') {
      const lower = log.message.toLowerCase();
      return lower.includes('wp') || lower.includes('waypoint') || lower.includes('takeoff') || lower.includes('rtl') || lower.includes('loiter') || lower.includes('mode') || lower.includes('arm');
    }
    return true;
  });

  const getSeverityBadge = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return <span className="px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] font-mono font-bold text-emerald-400">OK</span>;
      case 'warn':
        return <span className="px-1 py-0.2 rounded bg-amber-950/80 border border-amber-500/40 text-[9px] font-mono font-bold text-amber-400">WARN</span>;
      case 'error':
        return <span className="px-1 py-0.2 rounded bg-rose-950/80 border border-rose-500/40 text-[9px] font-mono font-bold text-rose-400">ERR</span>;
      default:
        return <span className="px-1 py-0.2 rounded bg-[#161B22] border border-[#30363D] text-[9px] font-mono font-bold text-slate-300">INFO</span>;
    }
  };

  const getLogTextColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return 'text-emerald-300';
      case 'warn':
        return 'text-amber-300';
      case 'error':
        return 'text-rose-400';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <Card
      title="FLIGHT LOGS"
      collapsible
      action={
        <div className="flex items-center gap-1.5">
          {/* Message Count Badge */}
          <span className="px-1.5 py-0.5 rounded bg-[#161B22] border border-[var(--uav-card-border)] text-emerald-400 font-mono text-[9.5px] font-bold">
            {filteredLogs.length} EVTS
          </span>

          {/* Quick Filter Buttons */}
          <div className="hidden sm:flex items-center rounded border border-[var(--uav-card-border)] bg-[#161B22] p-0.5 text-[9.5px] font-mono">
            {(['ALL', 'NAV', 'VISION', 'WARN'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  filter === f
                    ? 'bg-[#10B981] text-emerald-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Auto-scroll pin toggle */}
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 rounded border text-[10px] transition cursor-pointer ${
              autoScroll
                ? 'bg-[#10B981]/20 border-emerald-500/50 text-emerald-400'
                : 'border-[var(--uav-card-border)] text-slate-500 hover:text-slate-300'
            }`}
            title={autoScroll ? 'Auto-scroll is ON (Click to lock scroll position)' : 'Auto-scroll is OFF (Click to follow newest events)'}
            aria-label="Toggle Auto-Scroll"
          >
            <ArrowDownCircle className="w-3 h-3" />
          </button>

          {/* Full Deck Expand Switcher */}
          {onExpandLogs && (
            <button
              type="button"
              onClick={onExpandLogs}
              className="p-1 rounded border border-[var(--uav-card-border)] text-slate-400 hover:text-emerald-300 hover:bg-[#21262D] transition cursor-pointer"
              title="Expand to Fullscreen Flight Logs & MAVLink Deck"
              aria-label="Expand Flight Logs"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}

          {/* Export to TXT */}
          <button
            type="button"
            onClick={handleExport}
            className="p-1 rounded border border-[var(--uav-card-border)] text-slate-400 hover:text-emerald-300 hover:bg-[#21262D] transition cursor-pointer"
            title="Download Flight Logs (.txt)"
            aria-label="Download Flight Logs"
          >
            <Download className="w-3 h-3" />
          </button>

          {/* Clear Log */}
          <button
            type="button"
            onClick={handleClear}
            className="p-1 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/20 transition cursor-pointer"
            title="Clear Flight Logs"
            aria-label="Clear Flight Logs"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      }
      className={`h-[205px] w-full shrink-0 select-none ${className}`}
      contentClassName="p-2 flex flex-col justify-between overflow-hidden bg-[#0D1117]"
    >
      <div
        ref={scrollRef}
        className="w-full h-full overflow-y-auto space-y-1 font-mono text-[11px] leading-[18px] pr-1 scrollbar-thin scrollbar-thumb-[#262C36]"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--uav-muted)] text-[11px] italic">
            <span>No flight events matching filter [{filter}]</span>
            <span className="text-[9.5px] text-slate-500 mt-0.5">MAVLink heartbeat stream is monitoring</span>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-1.5 break-all hover:bg-[#161B22] px-1 py-0.5 rounded transition-colors">
              <span className="text-slate-500 select-none shrink-0 text-[10px]">
                {log.timeStr}
              </span>
              <div className="shrink-0">
                {getSeverityBadge(log.type)}
              </div>
              <span className={`${getLogTextColor(log.type)} text-[10.5px]`}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
