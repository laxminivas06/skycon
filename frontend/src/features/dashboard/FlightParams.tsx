import React, { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, MoveVertical } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Segmented } from '../../ui/Segmented';
import { NumberField } from '../../ui/NumberField';
import { Toggle } from '../../ui/Toggle';
import { mavlinkService } from '../../services/mavlinkService';
import { groundStationMissionService } from '../../services/groundStationMissionService';
import { audioService } from '../../services/audioService';

interface FlightParamsProps {
  className?: string;
}

export const FlightParams: React.FC<FlightParamsProps> = ({ className = '' }) => {
  const [tab, setTab] = useState<'Basic' | 'Vertical' | 'Advanced' | 'RTL' | 'Failsafe'>('Basic');

  // Basic Params
  const [altitude, setAltitude] = useState<number>(30);
  const [yaw, setYaw] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(5.0);
  const [faceWaypoint, setFaceWaypoint] = useState<boolean>(true);
  const [autoContinue, setAutoContinue] = useState<boolean>(true);

  // Circle / Orbit Radius
  const [circleRadius, setCircleRadius] = useState<number>(() =>
    groundStationMissionService.getCircleRadius()
  );

  useEffect(() => {
    return groundStationMissionService.subscribeCircleRadius((r) => setCircleRadius(r));
  }, []);

  const [isExecutingVertical, setIsExecutingVertical] = useState<boolean>(false);
  const [verticalStatusMsg, setVerticalStatusMsg] = useState<string | null>(null);

  // Advanced Params
  const [climbRate, setClimbRate] = useState<number>(2.5);
  const [descentRate, setDescentRate] = useState<number>(1.5);
  const [loiterRadius, setLoiterRadius] = useState<number>(10);
  const [navAcceleration, setNavAcceleration] = useState<number>(1.2);

  // RTL Params
  const [rtlAltitude, setRtlAltitude] = useState<number>(15);
  const [rtlDelay, setRtlDelay] = useState<number>(2);
  const [climbFirst, setClimbFirst] = useState<boolean>(true);

  // Failsafe Params
  const [lowBatteryVoltage, setLowBatteryVoltage] = useState<number>(10.5);
  const [criticalVoltage, setCriticalVoltage] = useState<number>(9.9);
  const [linkTimeoutSec, setLinkTimeoutSec] = useState<number>(5);

  const handleAltitudeChange = (val: number) => {
    setAltitude(val);
    mavlinkService.setTargetAltitude(val);
    audioService.playBeep(750, 40);
  };

  const handleExecuteVerticalAlt = async (targetAlt: number) => {
    setIsExecutingVertical(true);
    audioService.playBeep(880, 80);
    setVerticalStatusMsg(`Commanding altitude -> ${targetAlt}m...`);
    try {
      await mavlinkService.commandVerticalAltitude(targetAlt);
      setVerticalStatusMsg(`Holding coordinates, repositioned to ${targetAlt}m ✓`);
      setTimeout(() => setVerticalStatusMsg(null), 3500);
    } catch {
      setVerticalStatusMsg('Vertical command failed');
    } finally {
      setIsExecutingVertical(false);
    }
  };

  const handleNudgeAltitude = async (delta: number) => {
    const nextAlt = Math.max(1, Math.min(120, altitude + delta));
    setAltitude(nextAlt);
    await handleExecuteVerticalAlt(nextAlt);
  };

  return (
    <Card
      title="FLIGHT PARAMETERS"
      collapsible
      className={`h-[205px] w-full shrink-0 select-none ${className}`}
      contentClassName="p-2 flex flex-col justify-between overflow-hidden"
    >
      {/* Top Tabs */}
      <div>
        <Segmented
          size="sm"
          value={tab}
          onChange={(t) => {
            setTab(t as any);
            audioService.playBeep(650, 40);
          }}
          options={[
            { id: 'Basic', label: 'Basic' },
            { id: 'Vertical', label: 'Vertical' },
            { id: 'Advanced', label: 'Advanced' },
            { id: 'RTL', label: 'RTL' },
            { id: 'Failsafe', label: 'Failsafe' },
          ]}
        />
      </div>

      {/* Tab Contents */}
      {tab === 'Basic' && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="flex flex-col gap-1">
            <div className="flex items-end gap-1">
              <div className="flex-1">
                <NumberField
                  label="Target Altitude (m)"
                  value={altitude}
                  onChange={handleAltitudeChange}
                  min={2}
                  max={120}
                  step={1}
                />
              </div>
              <button
                type="button"
                onClick={() => handleExecuteVerticalAlt(altitude)}
                disabled={isExecutingVertical}
                className="h-[28px] px-2 rounded bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-emerald-950 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition active:scale-95"
                title="Climb / Descend directly at drone's current location to this altitude"
              >
                <MoveVertical className="w-3 h-3 text-emerald-950" />
                <span>Go</span>
              </button>
            </div>
            <NumberField
              label="Yaw (°)"
              value={yaw}
              onChange={(v) => {
                setYaw(v);
                audioService.playBeep(700, 30);
              }}
              min={0}
              max={360}
              step={5}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <NumberField
                  label="Cruise Speed (m/s)"
                  value={speed}
                  onChange={(v) => {
                    setSpeed(v);
                    audioService.playBeep(700, 30);
                  }}
                  min={1}
                  max={15}
                  step={0.5}
                />
              </div>
              <div className="flex-1">
                <NumberField
                  label="Orbit Radius (m)"
                  value={circleRadius}
                  onChange={(v) => {
                    groundStationMissionService.setCircleRadius(v);
                    audioService.playBeep(700, 30);
                  }}
                  min={3}
                  max={150}
                  step={1}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  id="face-wp"
                  checked={faceWaypoint}
                  onChange={(e) => setFaceWaypoint(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[var(--uav-primary-blue)] cursor-pointer"
                />
                <label htmlFor="face-wp" className="text-[10px] font-semibold text-[var(--uav-text)] cursor-pointer">
                  Face WP
                </label>
              </div>

              <Toggle
                checked={autoContinue}
                onChange={setAutoContinue}
                label="Auto"
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'Vertical' && (
        <div className="flex flex-col justify-between h-full pt-1 pb-0.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <NumberField
                label="Target Altitude (m)"
                value={altitude}
                onChange={setAltitude}
                min={1}
                max={120}
                step={1}
              />
              <span className="text-[10px] text-slate-400 font-mono">
                Current Alt: {mavlinkService.getTelemetry().altitude.toFixed(1)}m
              </span>
            </div>
            <div className="flex flex-col gap-1 justify-center">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => handleNudgeAltitude(2)}
                  className="py-1 px-1 rounded bg-[#161B22] border border-[var(--uav-card-border)] hover:bg-[#21262D] text-emerald-300 font-mono text-[10px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                >
                  <ArrowUp className="w-2.5 h-2.5" /> +2m
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeAltitude(-2)}
                  className="py-1 px-1 rounded bg-[#161B22] border border-[var(--uav-card-border)] hover:bg-[#21262D] text-amber-300 font-mono text-[10px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                >
                  <ArrowDown className="w-2.5 h-2.5" /> -2m
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeAltitude(5)}
                  className="py-1 px-1 rounded bg-[#161B22] border border-[var(--uav-card-border)] hover:bg-[#21262D] text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                >
                  <ArrowUp className="w-2.5 h-2.5" /> +5m
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeAltitude(-5)}
                  className="py-1 px-1 rounded bg-[#161B22] border border-[var(--uav-card-border)] hover:bg-[#21262D] text-amber-400 font-mono text-[10px] font-bold flex items-center justify-center gap-0.5 cursor-pointer"
                >
                  <ArrowDown className="w-2.5 h-2.5" /> -5m
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleExecuteVerticalAlt(altitude)}
            disabled={isExecutingVertical}
            className="w-full py-1.5 px-3 rounded-lg bg-[#10B981] hover:bg-[#059669] text-emerald-950 font-sans font-bold text-[11px] flex items-center justify-center gap-2 shadow transition cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <MoveVertical className="w-3.5 h-3.5 text-emerald-950" />
            <span>CLIMB / DESCEND AT DRONE LOCATION ({altitude}m)</span>
          </button>
          {verticalStatusMsg && (
            <div className="text-[10px] font-mono text-center text-emerald-400 truncate">
              {verticalStatusMsg}
            </div>
          )}
        </div>
      )}

      {tab === 'Advanced' && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="flex flex-col gap-1">
            <NumberField
              label="Climb Rate (m/s)"
              value={climbRate}
              onChange={setClimbRate}
              min={0.5}
              max={5.0}
              step={0.5}
            />
            <NumberField
              label="Descent Rate (m/s)"
              value={descentRate}
              onChange={setDescentRate}
              min={0.5}
              max={3.0}
              step={0.5}
            />
          </div>
          <div className="flex flex-col gap-1">
            <NumberField
              label="Loiter Radius (m)"
              value={loiterRadius}
              onChange={setLoiterRadius}
              min={5}
              max={50}
              step={1}
            />
            <NumberField
              label="Nav Accel (m/s²)"
              value={navAcceleration}
              onChange={setNavAcceleration}
              min={0.5}
              max={4.0}
              step={0.2}
            />
          </div>
        </div>
      )}

      {tab === 'RTL' && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="flex flex-col gap-1">
            <NumberField
              label="RTL Altitude (m)"
              value={rtlAltitude}
              onChange={setRtlAltitude}
              min={5}
              max={100}
              step={1}
            />
            <NumberField
              label="RTL Delay (s)"
              value={rtlDelay}
              onChange={setRtlDelay}
              min={0}
              max={30}
              step={1}
            />
          </div>
          <div className="flex flex-col justify-center gap-2 pt-2">
            <Toggle
              checked={climbFirst}
              onChange={setClimbFirst}
              label="Climb Before Return"
            />
            <span className="text-[10px] text-[var(--uav-muted)]">
              Pixhawk climbs to RTL_ALT ({rtlAltitude}m) before flying home.
            </span>
          </div>
        </div>
      )}

      {tab === 'Failsafe' && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <div className="flex flex-col gap-1">
            <NumberField
              label="Low LiPo (V)"
              value={lowBatteryVoltage}
              onChange={setLowBatteryVoltage}
              min={9.0}
              max={12.0}
              step={0.1}
            />
            <NumberField
              label="Crit LiPo (V)"
              value={criticalVoltage}
              onChange={setCriticalVoltage}
              min={8.5}
              max={11.0}
              step={0.1}
            />
          </div>
          <div className="flex flex-col gap-1">
            <NumberField
              label="Link Loss (s)"
              value={linkTimeoutSec}
              onChange={setLinkTimeoutSec}
              min={2}
              max={20}
              step={1}
            />
            <div className="pt-2">
              <span className="text-[10px] font-mono text-[#22C55E]">
                Failsafe: Auto RTL Active ✓
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
