import React, { useState, useEffect } from 'react';
import { AppRole, MissionState, DroneTelemetry, HomePoint, DecodedQRData, PreFlightChecklist } from './types/mission';
import { PixhawkConnectionState } from './types/mavlink';
import { RunnerLinkState } from './types/runner';
import { mavlinkService } from './services/mavlinkService';
import { missionEngine } from './services/missionEngine';
import { runnerCommService } from './services/runnerCommService';
import { visionService } from './services/visionService';
import { authService, UserSession } from './services/authService';
import { Header } from './components/common/Header';
import { LoginScreen } from './components/Auth/LoginScreen';
import { GroundStationDashboard } from './components/GroundStation/GroundStationDashboard';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DroneDashboard } from './components/Drone/DroneDashboard';
import { PhoneDroneDashboard } from './components/PhoneMission/PhoneDroneDashboard';
import { RunnerDashboard } from './components/Runner/RunnerDashboard';
import { MultiRoleSimBench } from './components/Testbench/MultiRoleSimBench';
import { MissionHistoryModal } from './components/History/MissionHistoryModal';

export const App: React.FC = () => {
  const [session, setSession] = useState<UserSession | null>(authService.getSession());
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [droneViewMode, setDroneViewMode] = useState<'PHONE_MISSION' | 'DRONE_HUD'>('PHONE_MISSION');

  // Core Real-Time State
  const [telemetry, setTelemetry] = useState<DroneTelemetry>(mavlinkService.getTelemetry());
  const [homePoint, setHomePoint] = useState<HomePoint>(mavlinkService.getHomePoint());
  const [pixhawkState, setPixhawkState] = useState<PixhawkConnectionState>(mavlinkService.getConnectionState());
  const [runnerLink, setRunnerLink] = useState<RunnerLinkState>(runnerCommService.getState());
  const [missionState, setMissionState] = useState<MissionState>(missionEngine.getCurrentState());
  const [remainingSeconds, setRemainingSeconds] = useState<number>(missionEngine.getRemainingSeconds());
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(missionEngine.getElapsedSeconds());
  const [decodedQR, setDecodedQR] = useState<DecodedQRData | null>(missionEngine.getDecodedQR());
  const [runnerAckReceived, setRunnerAckReceived] = useState<boolean>(false);
  const [runnerAckLatencyMs, setRunnerAckLatencyMs] = useState<number>(120);

  // Pre-flight validation status
  const [preFlight, setPreFlight] = useState<{ isReady: boolean; checklist: PreFlightChecklist }>(
    missionEngine.checkPreFlight()
  );

  useEffect(() => {
    // 0. Subscribe to Auth Session
    const unsubAuth = authService.subscribeSession((sess) => {
      setSession(sess);
    });

    // 1. Subscribe to MAVLink Telemetry
    const unsubTelemetry = mavlinkService.subscribeTelemetry((t) => {
      setTelemetry(t);
      setHomePoint(mavlinkService.getHomePoint());
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 2. Subscribe to Pixhawk Connection State
    const unsubConn = mavlinkService.subscribeConnection((c) => {
      setPixhawkState(c);
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 3. Subscribe to Runner Link State
    const unsubRunner = runnerCommService.subscribeState((r) => {
      setRunnerLink(r);
      setPreFlight(missionEngine.checkPreFlight());
    });

    // 4. Subscribe to Mission Engine State Machine & Timer (Persisted)
    const unsubMission = missionEngine.subscribeState((state, elapsed, remaining) => {
      setMissionState(state);
      setElapsedSeconds(elapsed);
      setRemainingSeconds(remaining);
      setDecodedQR(missionEngine.getDecodedQR());
      setPreFlight(missionEngine.checkPreFlight());

      if (state === 'RUNNER_CONFIRMED' || state === 'MISSION_COMPLETE') {
        setRunnerAckReceived(true);
      }
    });

    // 5. Subscribe to Vision QR events
    const unsubVision = visionService.subscribeQR((qr) => {
      setDecodedQR(qr);
    });

    return () => {
      unsubAuth();
      unsubTelemetry();
      unsubConn();
      unsubRunner();
      unsubMission();
      unsubVision();
    };
  }, []);

  // Action Handlers
  const handleSetHomePoint = async (coords?: { lat: number; lng: number }) => {
    if (coords) {
      await missionEngine.setHomePoint(coords.lat, coords.lng);
    } else {
      await missionEngine.setHomePoint();
    }
    setHomePoint(mavlinkService.getHomePoint());
    setPreFlight(missionEngine.checkPreFlight());
  };

  const handleStartMission = () => {
    missionEngine.startMission();
  };

  const handleEmergencyRTL = () => {
    missionEngine.triggerEmergencyRTL('MANUAL_EMERGENCY_RTL');
  };

  const handleResetMission = () => {
    missionEngine.resetMission();
    setRunnerAckReceived(false);
    setDecodedQR(null);
  };

  const handleQRDetected = (data: DecodedQRData) => {
    setDecodedQR(data);
    missionEngine.handleQRDetected(data);
  };

  const handleLogout = () => {
    authService.logout();
  };

  // Check for Dev-only fixture mode (?fixture=reference)
  const isFixtureMode =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fixture') === 'reference';

  if (isFixtureMode) {
    return <DashboardPage onLogout={handleLogout} />;
  }

  // If not logged in, show secure Role Access Login Portal
  if (!session) {
    return <LoginScreen onLoginSuccess={(role) => {}} />;
  }

  const currentRole = session.role;

  // Commander Fly Ground Station Dashboard (Exact reproduction of reference)
  if (currentRole === 'GROUND_STATION') {
    return (
      <DashboardPage
        onLogout={handleLogout}
        currentRole={currentRole}
      />
    );
  }

  // Dedicated Field Runner Experience (Completely separated from Ground Station)
  if (currentRole === 'RUNNER') {
    return (
      <div className="min-h-screen bg-sae-dark text-slate-100 flex flex-col font-sans select-none">
        {/* Dedicated Minimal Runner Top Bar */}
        <header className="h-[52px] px-3 sm:px-6 bg-[#0c1322] border-b border-slate-800 flex items-center justify-between select-none z-40 shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-center text-emerald-400 font-black">
              🏃
            </div>
            <div>
              <span className="font-orbitron font-extrabold text-[13px] tracking-wide text-white block leading-none">
                FIELD RUNNER UNIT
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                SAE INDIA ADDC 2026 • GROUND OPERATIVE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 hover:text-red-300 border border-slate-800 text-slate-400 text-[11px] font-sans font-semibold transition cursor-pointer"
              title="Log Out"
            >
              LOGOUT
            </button>
          </div>
        </header>

        <main className="flex-1 p-2 sm:p-4 overflow-y-auto">
          <RunnerDashboard
            runnerLink={runnerLink}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
          />
        </main>
      </div>
    );
  }

  // Dedicated Drone Core Experience (Matches Field Unit & GCS Design System)
  if (currentRole === 'DRONE') {
    return (
      <div className="h-[100dvh] w-full bg-sae-dark text-slate-100 flex flex-col font-sans select-none overflow-hidden">
        {/* Dedicated Minimal Drone Core Top Bar (Matching Field Unit & GCS) */}
        <header className="h-[52px] px-3 sm:px-6 bg-[#0c1322] border-b border-slate-800 flex items-center justify-between select-none z-40 shadow-lg shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-center text-emerald-400 font-black">
              📱
            </div>
            <div>
              <span className="font-orbitron font-extrabold text-[13px] tracking-wide text-white block leading-none">
                AUTONOMOUS PHONE RECON UNIT
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                SAE INDIA ADDC 2026 • ONBOARD DRONE-MOUNTED PHONE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#11161F] p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setDroneViewMode('PHONE_MISSION')}
                className={`px-2.5 py-1 rounded text-xs font-bold font-mono transition cursor-pointer ${
                  droneViewMode === 'PHONE_MISSION'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📱 PHONE MISSION
              </button>
              <button
                type="button"
                onClick={() => setDroneViewMode('DRONE_HUD')}
                className={`px-2.5 py-1 rounded text-xs font-bold font-mono transition cursor-pointer ${
                  droneViewMode === 'DRONE_HUD'
                    ? 'bg-amber-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📷 DRONE HUD
              </button>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 hover:text-red-300 border border-slate-800 text-slate-400 text-[11px] font-sans font-semibold transition cursor-pointer"
              title="Log Out"
            >
              LOGOUT
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {droneViewMode === 'PHONE_MISSION' ? (
            <PhoneDroneDashboard />
          ) : (
            <div className="flex-1 p-2 sm:p-4 min-h-0 flex flex-col overflow-hidden">
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
                onQRDetected={handleQRDetected}
                onEmergencyRTL={handleEmergencyRTL}
                className="flex-1 min-h-0"
              />
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sae-dark text-slate-100 flex flex-col font-sans select-none">
      {/* Tactical Top App Header with Role Badge & Logout */}
      <Header
        currentRole={currentRole}
        missionState={missionState}
        telemetry={telemetry}
        pixhawkState={pixhawkState}
        runnerLink={runnerLink}
        onSwitchRole={handleLogout}
        onOpenHistory={() => setHistoryOpen(true)}
        onResetMission={handleResetMission}
      />

      {/* Main Authenticated Dashboard Screen Based on Active Role */}
      <main className="flex-1 pb-10">

        {currentRole === 'TESTBENCH' && (
          <MultiRoleSimBench
            telemetry={telemetry}
            homePoint={homePoint}
            missionState={missionState}
            remainingSeconds={remainingSeconds}
            elapsedSeconds={elapsedSeconds}
            checklist={preFlight.checklist}
            isReadyForMission={preFlight.isReady}
            decodedQR={decodedQR}
            pixhawkState={pixhawkState}
            runnerLink={runnerLink}
            runnerAckReceived={runnerAckReceived}
            runnerAckLatencyMs={runnerAckLatencyMs}
            onSetHomePoint={handleSetHomePoint}
            onStartMission={handleStartMission}
            onEmergencyRTL={handleEmergencyRTL}
            onQRDetected={handleQRDetected}
          />
        )}
      </main>

      {/* Mission History & Blackbox Log Modal */}
      <MissionHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
};

export default App;
