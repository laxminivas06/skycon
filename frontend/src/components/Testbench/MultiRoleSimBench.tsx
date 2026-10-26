import React, { useState } from 'react';
import { DroneTelemetry, HomePoint, DecodedQRData, MissionState, PreFlightChecklist as ChecklistType } from '../../types/mission';
import { PixhawkConnectionState } from '../../types/mavlink';
import { RunnerLinkState } from '../../types/runner';
import { GroundStationDashboard } from '../GroundStation/GroundStationDashboard';
import { DroneDashboard } from '../Drone/DroneDashboard';
import { RunnerDashboard } from '../Runner/RunnerDashboard';
import { 
  Laptop, 
  Plane, 
  Smartphone, 
  Layers, 
  Play, 
  CheckCircle2, 
  ShieldAlert, 
  ArrowRight,
  Sparkles,
  RefreshCw,
  Info
} from 'lucide-react';
import { visionService } from '../../services/visionService';
import { missionEngine } from '../../services/missionEngine';

interface MultiRoleSimBenchProps {
  telemetry: DroneTelemetry;
  homePoint: HomePoint;
  missionState: MissionState;
  remainingSeconds: number;
  elapsedSeconds: number;
  checklist: ChecklistType;
  isReadyForMission: boolean;
  decodedQR: DecodedQRData | null;
  pixhawkState: PixhawkConnectionState;
  runnerLink: RunnerLinkState;
  runnerAckReceived: boolean;
  runnerAckLatencyMs?: number;
  onSetHomePoint: () => void;
  onStartMission: () => void;
  onEmergencyRTL: () => void;
  onQRDetected: (data: DecodedQRData) => void;
}

export const MultiRoleSimBench: React.FC<MultiRoleSimBenchProps> = ({
  telemetry,
  homePoint,
  missionState,
  remainingSeconds,
  elapsedSeconds,
  checklist,
  isReadyForMission,
  decodedQR,
  pixhawkState,
  runnerLink,
  runnerAckReceived,
  runnerAckLatencyMs,
  onSetHomePoint,
  onStartMission,
  onEmergencyRTL,
  onQRDetected
}) => {
  const [activeTab, setActiveTab] = useState<'ALL_3_SPLIT' | 'GROUND_STATION' | 'DRONE' | 'RUNNER'>('ALL_3_SPLIT');

  const scenarioSteps = [
    { num: '1-3', label: 'Set Home Point & Lock GPS', done: homePoint.isSet },
    { num: '4-7', label: 'Validate Pre-flight & START MISSION', done: missionState !== 'IDLE' && missionState !== 'HOME_SET' },
    { num: '8-10', label: 'Autonomous Climb & Search Grid', done: telemetry.altitude >= 5 || missionState === 'CLIMBING_TO_ALTITUDE' || missionState === 'ALTITUDE_STABILIZING' || missionState === 'SEARCHING' || missionState === 'QR_DETECTED' || missionState === 'QR_SCANNING' || missionState === 'QR_DECODED' || missionState === 'SEND_TO_RUNNER' || missionState === 'WAIT_FOR_RUNNER_ACK' || missionState === 'RUNNER_CONFIRMED' || missionState === 'RTL' || missionState === 'RETURNING_HOME' || missionState === 'LANDING' || missionState === 'MISSION_COMPLETE' },
    { num: '11-13', label: 'Airborne Vision Locks 2-Digit QR (e.g. 27)', done: !!decodedQR },
    { num: '14-16', label: 'Direct Wireless to Runner & Auto-ACK', done: runnerAckReceived },
    { num: '17-21', label: 'Airborne Hold → Pixhawk RTL → Land at Home', done: missionState === 'RTL' || missionState === 'RETURNING_HOME' || missionState === 'LANDING' || missionState === 'MISSION_COMPLETE' },
    { num: '22-24', label: 'Mission Complete within 3-min window', done: missionState === 'MISSION_COMPLETE' }
  ];

  return (
    <div className="p-3 sm:p-5 max-w-[1600px] mx-auto space-y-4 font-mono">
      {/* Top Testbench Header & Scenario Step Tracker */}
      <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 hud-border space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-purple-400" />
            <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-wider">
              SAE INDIA MISSION VERIFICATION TESTBENCH
            </h2>
          </div>

          {/* Quick Simulation Scenario Trigger Buttons */}
          <div className="flex items-center space-x-2">
            {!homePoint.isSet && (
              <button
                onClick={onSetHomePoint}
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition flex items-center space-x-1"
              >
                <span>1. Set Home</span>
              </button>
            )}

            {homePoint.isSet && (missionState === 'IDLE' || missionState === 'HOME_SET' || missionState === 'READY') && (
              <button
                onClick={onStartMission}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1 animate-pulse"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>2. Start Mission</span>
              </button>
            )}

            {(missionState === 'SEARCHING' || missionState === 'TAKEOFF' || missionState === 'CLIMBING_TO_ALTITUDE' || missionState === 'ALTITUDE_STABILIZING') && (
              <button
                onClick={() => visionService.triggerSimulatedDetection('27')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition flex items-center space-x-1 animate-pulse"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>3. Detect QR "27"</span>
              </button>
            )}
          </div>
        </div>

        {/* Scenario Step Progress Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 pt-2 border-t border-slate-800">
          {scenarioSteps.map((step, idx) => (
            <div
              key={idx}
              className={`p-1.5 rounded border text-[10px] flex flex-col justify-between transition ${
                step.done
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 font-bold'
                  : 'bg-slate-950/40 border-slate-800 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span>STEP {step.num}</span>
                {step.done ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />}
              </div>
              <span className="truncate">{step.label}</span>
            </div>
          ))}
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-1 sm:space-x-2 pt-2 border-t border-slate-800 text-xs">
          <span className="text-slate-400 font-bold hidden sm:inline">VIEW:</span>
          {[
            { id: 'ALL_3_SPLIT', label: 'ALL 3 DEVICES (SPLIT SCREEN)', icon: Layers },
            { id: 'GROUND_STATION', label: 'GROUND STATION VIEW', icon: Laptop },
            { id: 'DRONE', label: 'DRONE ONBOARD VIEW', icon: Plane },
            { id: 'RUNNER', label: 'RUNNER VIEW', icon: Smartphone }
          ].map((tab) => {
            const Icon = tab.icon;
            const isSel = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg border font-bold transition flex items-center space-x-1.5 ${
                  isSel
                    ? 'bg-purple-950 border-purple-500 text-purple-300'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab Views */}
      {activeTab === 'ALL_3_SPLIT' ? (
        /* 3-Column Simultaneous Multi-Role Command Deck */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Col 1: Ground Station Android */}
          <div className="bg-slate-900/60 rounded-2xl p-3 border border-sky-500/30 space-y-3">
            <div className="bg-sky-950/60 text-sky-400 border border-sky-500/40 px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center justify-between">
              <span>1. GROUND STATION ANDROID</span>
              <span className="text-[10px]">COORDINATOR</span>
            </div>
            <GroundStationDashboard
              telemetry={telemetry}
              homePoint={homePoint}
              missionState={missionState}
              remainingSeconds={remainingSeconds}
              elapsedSeconds={elapsedSeconds}
              checklist={checklist}
              isReadyForMission={isReadyForMission}
              pixhawkState={pixhawkState}
              runnerLink={runnerLink}
              onSetHomePoint={onSetHomePoint}
              onStartMission={onStartMission}
              onEmergencyRTL={onEmergencyRTL}
            />
          </div>

          {/* Col 2: Drone Android (Camera & QR Decoder) */}
          <div className="bg-slate-900/60 rounded-2xl p-3 border border-amber-500/30 space-y-3">
            <div className="bg-amber-950/60 text-amber-400 border border-amber-500/40 px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center justify-between">
              <span>2. DRONE ANDROID MISSION CORE</span>
              <span className="text-[10px]">CAMERA & VISION</span>
            </div>
            <DroneDashboard
              telemetry={telemetry}
              missionState={missionState}
              remainingSeconds={remainingSeconds}
              elapsedSeconds={elapsedSeconds}
              decodedQR={decodedQR}
              pixhawkState={pixhawkState}
              runnerLink={runnerLink}
              runnerAckReceived={runnerAckReceived}
              runnerAckLatencyMs={runnerAckLatencyMs}
              onQRDetected={onQRDetected}
              onEmergencyRTL={onEmergencyRTL}
            />
          </div>

          {/* Col 3: Runner Android */}
          <div className="bg-slate-900/60 rounded-2xl p-3 border border-emerald-500/30 space-y-3">
            <div className="bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 px-3 py-1 rounded-lg text-xs font-black uppercase flex items-center justify-between">
              <span>3. RUNNER ANDROID FIELD UNIT</span>
              <span className="text-[10px]">AUTO-ACK PROTOCOL</span>
            </div>
            <RunnerDashboard
              runnerLink={runnerLink}
              missionState={missionState}
              remainingSeconds={remainingSeconds}
              elapsedSeconds={elapsedSeconds}
            />
          </div>
        </div>
      ) : activeTab === 'GROUND_STATION' ? (
        <GroundStationDashboard
          telemetry={telemetry}
          homePoint={homePoint}
          missionState={missionState}
          remainingSeconds={remainingSeconds}
          elapsedSeconds={elapsedSeconds}
          checklist={checklist}
          isReadyForMission={isReadyForMission}
          pixhawkState={pixhawkState}
          runnerLink={runnerLink}
          onSetHomePoint={onSetHomePoint}
          onStartMission={onStartMission}
          onEmergencyRTL={onEmergencyRTL}
        />
      ) : activeTab === 'DRONE' ? (
        <DroneDashboard
          telemetry={telemetry}
          missionState={missionState}
          remainingSeconds={remainingSeconds}
          elapsedSeconds={elapsedSeconds}
          decodedQR={decodedQR}
          pixhawkState={pixhawkState}
          runnerLink={runnerLink}
          runnerAckReceived={runnerAckReceived}
          runnerAckLatencyMs={runnerAckLatencyMs}
          onQRDetected={onQRDetected}
          onEmergencyRTL={onEmergencyRTL}
        />
      ) : (
        <RunnerDashboard
          runnerLink={runnerLink}
          missionState={missionState}
          remainingSeconds={remainingSeconds}
          elapsedSeconds={elapsedSeconds}
        />
      )}
    </div>
  );
};
