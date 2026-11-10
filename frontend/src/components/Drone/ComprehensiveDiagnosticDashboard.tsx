import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  RefreshCw,
  Cpu,
  Satellite,
  Compass,
  Layers,
  Shield,
  Navigation,
  Server,
  FileText,
  Wrench,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  X,
  Sliders
} from 'lucide-react';
import {
  diagnosticService,
  DiagnosticReport,
  DiagnosticCheck,
  DiagnosticCheckStatus
} from '../../services/diagnosticService';

interface ComprehensiveDiagnosticDashboardProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const ComprehensiveDiagnosticDashboard: React.FC<ComprehensiveDiagnosticDashboardProps> = ({
  isOpen = true,
  onClose
}) => {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    flight_controller_overview: true,
    mavlink_connection: true,
    gps_diagnostics: true,
    compass_diagnostics: true,
    imu_ekf_health: true,
    flight_mode_diagnostics: true,
    arming_diagnostics: true,
    geofence_diagnostics: true,
    mission_waypoint_diagnostics: true,
    backend_frontend_diagnostics: true,
    error_logs: true,
    recommended_fixes: true,
    core_answers: true
  });

  // Run initial diagnostic on mount if no previous report
  useEffect(() => {
    const existing = diagnosticService.getLastReport();
    if (existing) {
      setReport(existing);
    } else {
      handleRunDiagnostics();
    }
  }, []);

  const handleRunDiagnostics = async () => {
    setIsRunning(true);
    try {
      const res = await diagnosticService.runCompleteDiagnostics();
      setReport(res);
    } catch (err) {
      console.error('[DIAGNOSTICS] Run failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const toggleSection = (secKey: string) => {
    setExpandedSections(prev => ({ ...prev, [secKey]: !prev[secKey] }));
  };

  const getStatusBadge = (status: DiagnosticCheckStatus) => {
    switch (status) {
      case 'PASSED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-500/40">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> PASSED
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-400 border border-amber-500/40">
            <AlertTriangle className="w-3 h-3 text-amber-400" /> WARNING
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-400 border border-rose-500/40 animate-pulse">
            <XCircle className="w-3 h-3 text-rose-400" /> FAILED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3 h-3 text-slate-400" /> NOT CHECKED
          </span>
        );
    }
  };

  const getSectionIcon = (key: string) => {
    switch (key) {
      case 'flight_controller_overview': return <Cpu className="w-4 h-4 text-cyan-400" />;
      case 'mavlink_connection': return <Activity className="w-4 h-4 text-emerald-400" />;
      case 'gps_diagnostics': return <Satellite className="w-4 h-4 text-blue-400" />;
      case 'compass_diagnostics': return <Compass className="w-4 h-4 text-amber-400" />;
      case 'imu_ekf_health': return <Layers className="w-4 h-4 text-purple-400" />;
      case 'flight_mode_diagnostics': return <Sliders className="w-4 h-4 text-indigo-400" />;
      case 'arming_diagnostics': return <Shield className="w-4 h-4 text-rose-400" />;
      case 'geofence_diagnostics': return <Shield className="w-4 h-4 text-teal-400" />;
      case 'mission_waypoint_diagnostics': return <Navigation className="w-4 h-4 text-sky-400" />;
      case 'backend_frontend_diagnostics': return <Server className="w-4 h-4 text-orange-400" />;
      case 'error_logs': return <FileText className="w-4 h-4 text-yellow-400" />;
      case 'recommended_fixes': return <Wrench className="w-4 h-4 text-rose-400" />;
      default: return <Activity className="w-4 h-4 text-slate-400" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0b0f17] border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden font-sans">
        
        {/* =====================================================================
            TOP HEADER & ACTION CONTROLS
        ===================================================================== */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#0d1424] via-[#11192e] to-[#0d1424] border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black tracking-wide text-white flex items-center gap-2">
                S500 AUTONOMOUS DRONE <span className="text-cyan-400 font-mono text-xs px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">PIXHAWK 2.4.8 AUDIT</span>
              </h1>
              <p className="text-[11px] font-mono text-slate-400">
                End-to-End Pipeline: React Dashboard → Backend → MAVLink → Pixhawk → GPS/Compass → S500 Motors
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRunDiagnostics}
              disabled={isRunning}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition shadow-lg cursor-pointer ${
                isRunning
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50 animate-pulse'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? 'RUNNING AUDIT...' : 'START COMPLETE DIAGNOSTICS'}</span>
            </button>

            {report && (
              <>
                <button
                  onClick={() => diagnosticService.exportReportJSON(report)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition cursor-pointer"
                  title="Download full JSON report"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>JSON</span>
                </button>
                <button
                  onClick={() => diagnosticService.exportReportCSV(report)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition cursor-pointer"
                  title="Download CSV table"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
              </>
            )}

            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer ml-1"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* =====================================================================
            SUMMARY BANNER (TOTAL CHECKS | PASSED | WARNINGS | FAILED | NOT CHECKED)
        ===================================================================== */}
        {report && (
          <div className="bg-[#080d14] border-b border-slate-800/80 px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
              <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Total Checks</span>
                <span className="text-base font-mono font-black text-white">{report.summary.totalChecks}</span>
              </div>
              <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider block">Passed</span>
                <span className="text-base font-mono font-black text-emerald-400">{report.summary.passed}</span>
              </div>
              <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/30">
                <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider block">Warnings</span>
                <span className="text-base font-mono font-black text-amber-400">{report.summary.warnings}</span>
              </div>
              <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30">
                <span className="text-[10px] font-mono text-rose-400 uppercase tracking-wider block">Failed</span>
                <span className="text-base font-mono font-black text-rose-400">{report.summary.failed}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Not Checked</span>
                <span className="text-base font-mono font-black text-slate-400">{report.summary.notChecked}</span>
              </div>
              <div className="p-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">Health Score</span>
                <span className="text-base font-mono font-black text-cyan-300">{report.summary.healthScore}%</span>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            MAIN SCROLLABLE CONTENT BODY
        ===================================================================== */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {/* 13 CORE QUESTIONS & ANSWERS CARD */}
          {report && report.coreAnswers && Object.keys(report.coreAnswers).length > 0 && (
            <div className="rounded-xl bg-[#0e1420] border border-cyan-500/40 overflow-hidden shadow-lg">
              <div
                onClick={() => toggleSection('core_answers')}
                className="p-3.5 bg-gradient-to-r from-cyan-950/50 to-slate-900 border-b border-cyan-500/30 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono font-black text-cyan-200 tracking-wide uppercase">
                    13 Core Project Diagnostic Answers (Evidence-Based Flight Verdict)
                  </span>
                </div>
                {expandedSections['core_answers'] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {expandedSections['core_answers'] && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                  {Object.entries(report.coreAnswers).map(([key, val]) => {
                    const isYes = val.status.includes('YES') || val.status.includes('PASSED') || val.status.includes('RESOLVED') || val.status.includes('EXECUTED');
                    return (
                      <div key={key} className="p-2.5 rounded-lg bg-[#080d14] border border-slate-800 flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-300 font-bold truncate">
                            {key.replace(/^\d+_/, '').replace(/_/g, ' ').toUpperCase()}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isYes ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950 text-rose-400 border border-rose-500/30'
                          }`}>
                            {val.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                          <strong className="text-slate-300">Evidence:</strong> {val.evidence}
                        </p>
                        {val.rootCause && (
                          <p className="text-[10px] text-cyan-400/90 leading-tight">
                            <strong className="text-cyan-300">Analysis:</strong> {val.rootCause}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 12 DEDICATED DIAGNOSTIC SECTIONS */}
          {report && Object.entries(report.sections).map(([secKey, sec]) => {
            if (secKey === 'recommended_fixes') return null; // rendered at the bottom
            const checks = 'checks' in sec ? (sec.checks as DiagnosticCheck[]) : [];
            const isExpanded = expandedSections[secKey] !== false;

            return (
              <div key={secKey} className="rounded-xl bg-[#0e1420] border border-slate-800 overflow-hidden shadow">
                <div
                  onClick={() => toggleSection(secKey)}
                  className="p-3 bg-[#080d14] border-b border-slate-800/80 flex items-center justify-between cursor-pointer select-none hover:bg-slate-900/60 transition"
                >
                  <div className="flex items-center gap-2.5">
                    {getSectionIcon(secKey)}
                    <span className="text-xs font-mono font-bold text-white tracking-wide">
                      {sec.name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      ({checks.length} checks)
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {getStatusBadge(sec.status as DiagnosticCheckStatus)}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-3 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 text-[10px] uppercase">
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Check / Subsystem</th>
                          <th className="py-2 px-3">Actual Measured Value</th>
                          <th className="py-2 px-3">Expected Condition</th>
                          <th className="py-2 px-3">Failure Reason / Remedy</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {checks.map(c => (
                          <tr key={c.id} className="hover:bg-slate-900/40 transition">
                            <td className="py-2 px-3 whitespace-nowrap align-top">
                              {getStatusBadge(c.status)}
                            </td>
                            <td className="py-2 px-3 align-top font-bold text-slate-200">
                              {c.title}
                              <span className="block text-[9px] text-slate-500 font-normal">ID: {c.id}</span>
                            </td>
                            <td className="py-2 px-3 align-top text-cyan-300 font-medium max-w-xs break-words">
                              {c.measuredValue}
                            </td>
                            <td className="py-2 px-3 align-top text-slate-400 max-w-xs break-words">
                              {c.expectedCondition}
                            </td>
                            <td className="py-2 px-3 align-top text-[11px] max-w-sm">
                              {c.failureReason && (
                                <p className="text-rose-400 font-medium mb-1">
                                  ⚠️ {c.failureReason}
                                </p>
                              )}
                              {c.recommendedCorrection && (
                                <p className="text-amber-300/90 text-[10px]">
                                  🔧 <strong>Remedy:</strong> {c.recommendedCorrection}
                                </p>
                              )}
                              {!c.failureReason && !c.recommendedCorrection && (
                                <span className="text-emerald-500/80">✓ Condition satisfied</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* SECTION 12: RECOMMENDED FIXES & STEP-BY-STEP ACTION PLAN */}
          {report && (
            <div className="rounded-xl bg-[#0e1420] border border-amber-500/40 overflow-hidden shadow-lg">
              <div
                onClick={() => toggleSection('recommended_fixes')}
                className="p-3.5 bg-gradient-to-r from-amber-950/40 to-slate-900 border-b border-amber-500/30 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-mono font-black text-amber-300 tracking-wide uppercase">
                    12. Prioritized Action Plan & Recommended Fixes ({report.sections.recommended_fixes.items.length} items)
                  </span>
                </div>
                {expandedSections['recommended_fixes'] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {expandedSections['recommended_fixes'] && (
                <div className="p-4 space-y-3">
                  {report.sections.recommended_fixes.items.length === 0 ? (
                    <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>All 12 subsystem checks passed! Zero critical hardware or software defects detected. Ready for autonomous flight!</span>
                    </div>
                  ) : (
                    report.sections.recommended_fixes.items.map((fix, idx) => (
                      <div key={idx} className="p-3.5 rounded-lg bg-[#080d14] border border-slate-800 text-xs font-mono space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-200">
                            #{idx + 1} [{fix.subsystem}] {fix.checkTitle}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            fix.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-400 border border-rose-500/40' : 'bg-amber-950 text-amber-400 border border-amber-500/40'
                          }`}>
                            {fix.severity}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px]">
                          <strong className="text-slate-300">Issue:</strong> {fix.issue} (Measured: <span className="text-cyan-300">{fix.measured}</span>)
                        </p>
                        <div className="p-2 rounded bg-amber-950/20 border border-amber-500/20 text-amber-200 text-[11px]">
                          <strong>Action Plan:</strong> {fix.remedy}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* =====================================================================
            FOOTER STATUS BAR
        ===================================================================== */}
        <div className="p-3 bg-[#080d14] border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400 px-5">
          <span>Target: Pixhawk 2.4.8 (ArduPilot/PX4) on S500 Quadcopter</span>
          <span>Engine: MAVLink 2.0 Read-Only Safety Protocol ✓</span>
        </div>

      </div>
    </div>
  );
};

