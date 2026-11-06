/**
 * =====================================================================================
 * SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
 * MODULE 3: Lawnmower Grid Generator & One-Tap Pre-Flight Mission Uploader
 * Enforces ADDC Rule 3.3.1 (No manual in-flight clicks; 100% pre-flight autonomous grid)
 * =====================================================================================
 */

import React, { useState } from 'react';
import {
  generateLawnmowerGrid,
  GridCorner,
  LawnmowerGridResult
} from '../../services/lawnmowerGridService';
import { mavlinkService } from '../../services/mavlinkService';
import { audioService } from '../../services/audioService';
import {
  Compass,
  Play,
  Upload,
  Layers,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Shield,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface LawnmowerGridUploaderProps {
  onGridGenerated?: (result: LawnmowerGridResult) => void;
  activeCorners?: GridCorner[];
  onClearCorners?: () => void;
}

export const LawnmowerGridUploader: React.FC<LawnmowerGridUploaderProps> = ({
  onGridGenerated,
  activeCorners = [],
  onClearCorners
}) => {
  const [spacingMeters, setSpacingMeters] = useState<number>(2.5);
  const [altitudeMeters, setAltitudeMeters] = useState<number>(3.5);
  const [gridResult, setGridResult] = useState<LawnmowerGridResult | null>(null);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [missionArmed, setMissionArmed] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Generate grid preview whenever corners change or parameters update
  const handleGenerateGrid = () => {
    if (activeCorners.length < 3) {
      setStatusMessage('Please select at least 3-4 arena boundary corners on the map.');
      return;
    }

    const result = generateLawnmowerGrid(activeCorners, spacingMeters, altitudeMeters);
    setGridResult(result);
    setStatusMessage(result.message);

    if (result.success) {
      audioService.playBeep(880, 100);
      if (onGridGenerated) {
        onGridGenerated(result);
      }
    }
  };

  // Upload compiled grid waypoints to Pixhawk over TELEM2 / Cloud Relay
  const handleUploadToPixhawk = async () => {
    if (!gridResult || !gridResult.success || gridResult.items.length === 0) {
      setStatusMessage('No valid grid generated. Tap 4 boundary corners and generate grid first.');
      return;
    }

    setIsUploading(true);
    setUploadProgress('Initiating MAVLink mission upload handshake...');
    setStatusMessage('Streaming mission items to Pixhawk TELEM2...');

    try {
      const res = await mavlinkService.uploadMissionWaypoints(
        gridResult.items,
        true,
        (stage, current, total) => {
          setUploadProgress(`${stage} (${current}/${total})`);
        }
      );

      if (res.success) {
        setUploadSuccess(true);
        setStatusMessage(`✅ ${res.message} Pixhawk acknowledged 100% of grid waypoints.`);
        audioService.playMissionComplete();
        audioService.triggerHaptic('success');
      } else {
        setUploadSuccess(false);
        setStatusMessage(`❌ Upload failed: ${res.message}`);
        audioService.triggerHaptic('warning');
      }
    } catch (err: any) {
      setUploadSuccess(false);
      setStatusMessage(`❌ Error: ${err.message || 'Mission upload failed'}`);
    } finally {
      setIsUploading(false);
    }
  };

  // One-tap autonomous mission start for whistle blow
  const handleStartAutonomousMission = async () => {
    setStatusMessage('Whistle-blow start sequence: Switching to AUTO mode and arming motors...');
    try {
      // 1. Set mode to AUTO
      const modeOk = await mavlinkService.setFlightMode('AUTO');
      if (!modeOk) {
        setStatusMessage('⚠️ Failed to set AUTO mode on Pixhawk.');
        return;
      }

      // 2. Command ARM
      const armOk = await mavlinkService.armDrone(false);
      if (armOk) {
        setMissionArmed(true);
        setStatusMessage('🚀 DRONE ARMED IN AUTO MODE! Autonomous Lawnmower Reconnaissance in progress.');
        audioService.playMissionComplete();
      } else {
        setStatusMessage('⚠️ Arming command rejected by Pixhawk (check pre-arm checks / GPS 3D fix).');
      }
    } catch (e: any) {
      setStatusMessage(`❌ Mission Start Error: ${e.message}`);
    }
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl text-slate-100 flex flex-col gap-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <Layers className="w-5 h-5 text-emerald-400" />
          <h3 className="font-extrabold text-sm sm:text-base tracking-wide uppercase text-slate-200">
            Lawnmower Grid Generator & Compiler
          </h3>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold">
          ADDC 3.3.1 PRE-FLIGHT
        </span>
      </div>

      {/* Arena Corners Selection Status */}
      <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-medium text-slate-300">
            Arena Boundary Corners: <strong className="text-cyan-400">{activeCorners.length} / 4</strong> selected
          </span>
        </div>
        {activeCorners.length > 0 && onClearCorners && (
          <button
            onClick={onClearCorners}
            className="text-[11px] font-mono text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Reset Corners
          </button>
        )}
      </div>

      {/* Grid Parameters Inputs */}
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">LANE SPACING (M)</label>
          <input
            type="number"
            step="0.5"
            min="1.5"
            max="6.0"
            value={spacingMeters}
            onChange={e => setSpacingMeters(parseFloat(e.target.value) || 2.5)}
            className="w-full bg-slate-900 text-emerald-400 font-bold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-emerald-500"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">2.5m = 100% camera coverage</span>
        </div>
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">SWEEP ALTITUDE (M)</label>
          <input
            type="number"
            step="0.5"
            min="2.5"
            max="10.0"
            value={altitudeMeters}
            onChange={e => setAltitudeMeters(parseFloat(e.target.value) || 3.5)}
            className="w-full bg-slate-900 text-cyan-400 font-bold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-cyan-500"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">3.5m nominal ADDC sweep</span>
        </div>
      </div>

      {/* Action 1: Compile Grid */}
      <button
        onClick={handleGenerateGrid}
        disabled={activeCorners.length < 3}
        className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
          activeCorners.length >= 3
            ? 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 shadow-md'
            : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
        }`}
      >
        <Compass className="w-4 h-4" /> Compute Boustrophedon Grid
      </button>

      {/* Grid Stats Preview */}
      {gridResult && gridResult.success && (
        <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3 text-xs font-mono grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-300">
          <div>
            <span className="text-[10px] text-slate-400 block">LANES</span>
            <strong className="text-emerald-400 text-sm">{gridResult.stats.laneCount}</strong>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">TOTAL WAYPOINTS</span>
            <strong className="text-emerald-400 text-sm">{gridResult.stats.waypointCount}</strong>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">DISTANCE</span>
            <strong className="text-emerald-400 text-sm">{gridResult.stats.totalDistanceMeters}m</strong>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">EST. FLIGHT TIME</span>
            <strong className="text-emerald-400 text-sm">{gridResult.stats.estimatedFlightTimeSeconds}s</strong>
          </div>
        </div>
      )}

      {/* Status Output Box */}
      {statusMessage && (
        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 break-words">
          {statusMessage}
          {uploadProgress && <div className="text-cyan-400 mt-1 font-semibold">{uploadProgress}</div>}
        </div>
      )}

      {/* Action Buttons: Upload & Whistle Blow Start */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* Step 1: Upload during 2-minute prep phase */}
        <button
          onClick={handleUploadToPixhawk}
          disabled={!gridResult || !gridResult.success || isUploading}
          className={`py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            gridResult && gridResult.success && !isUploading
              ? 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-600/30'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
        >
          {uploadSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-slate-950" /> Grid Uploaded ✓
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> Upload Auto-Grid to Pixhawk
            </>
          )}
        </button>

        {/* Step 2: One-Tap Autonomous Start on Whistle Blow */}
        <button
          onClick={handleStartAutonomousMission}
          disabled={!uploadSuccess}
          className={`py-3 px-4 rounded-xl font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            uploadSuccess
              ? 'bg-gradient-to-r from-emerald-500 to-green-400 hover:from-emerald-400 hover:to-green-300 text-slate-950 shadow-lg shadow-emerald-500/40 animate-pulse'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
        >
          <Play className="w-4 h-4 fill-slate-950" /> Start Autonomous Mission
        </button>
      </div>
    </div>
  );
};
