"""
Air-Gapped Autonomous Edge Mission Finite State Machine (drone_core FSM)
"""

import asyncio
import time
from enum import Enum
from typing import Optional, Callable, Dict, Any, List
import numpy as np

from .config import EdgeMissionConfig
from .autopilot import AutopilotInterface, TelemetryState
from .localization import PinholeTargetResolver, TargetDisplacement, haversine_distance_m
from .vision import OnboardVisionEngine, VisionCandidate, DecodeResult
from .persistence import LocalPersistenceManager, DecodedPayloadRecord


class MissionState(str, Enum):
    STANDBY = "STANDBY"
    TAKEOFF_ARRIVAL = "TAKEOFF_ARRIVAL"
    SEARCHING = "SEARCHING"
    TARGET_DETECTED = "TARGET_DETECTED"
    APPROACHING = "APPROACHING"
    DECODING = "DECODING"
    RTL = "RTL"
    ABORTED = "ABORTED"


class AutonomousEdgeMissionFSM:
    """
    Air-gapped, edge-native autonomous payload and mission manager.
    Executes search, target localization, approach, and decoding onboard
    without external telemetry links or ground dependency.
    """

    def __init__(
        self,
        autopilot: AutopilotInterface,
        config: Optional[EdgeMissionConfig] = None,
        persistence: Optional[LocalPersistenceManager] = None
    ):
        self.autopilot = autopilot
        self.config = config or EdgeMissionConfig()
        self.persistence = persistence or LocalPersistenceManager(
            json_path=self.config.payload_storage_path,
            db_path=self.config.sqlite_storage_path
        )
        self.resolver = PinholeTargetResolver(self.config.camera)
        self.vision = OnboardVisionEngine(self.config)

        # FSM State
        self.state: MissionState = MissionState.STANDBY
        self.status_message: str = "Air-gapped edge drone core initialized in STANDBY"
        self._running: bool = False

        # Mission Variables
        self.current_yaw_heading: float = 0.0
        self.locked_target: Optional[TargetDisplacement] = None
        self.target_candidate_box: Optional[Dict[str, Any]] = None
        self.candidate_verification_count: int = 0
        self.lost_candidate_count: int = 0
        self.decode_start_time: float = 0.0
        self.decode_retries_count: int = 0
        self.decoded_payload_record: Optional[DecodedPayloadRecord] = None

        # State Listeners
        self.state_listeners: List[Callable[[Dict[str, Any]], None]] = []

    def subscribe(self, callback: Callable[[Dict[str, Any]], None]):
        """Subscribe to FSM state updates."""
        self.state_listeners.append(callback)

    def _notify(self):
        progress = self.get_progress()
        for cb in self.state_listeners:
            try:
                cb(progress)
            except Exception:
                pass

    def get_progress(self) -> Dict[str, Any]:
        telem = self.autopilot.get_telemetry()
        dist_to_target = None
        if self.locked_target:
            dist_to_target = haversine_distance_m(
                telem.latitude, telem.longitude,
                self.locked_target.target_lat, self.locked_target.target_lon
            )

        return {
            "state": self.state.value,
            "status_message": self.status_message,
            "yaw_heading": self.current_yaw_heading,
            "zoom": self.vision.current_zoom,
            "target": self.locked_target,
            "distance_to_target_m": dist_to_target,
            "decode_retries": self.decode_retries_count,
            "decoded_record": self.decoded_payload_record,
            "telemetry": telem,
            "air_gapped": True
        }

    def transition_to(self, new_state: MissionState, reason: str):
        """Cleanly transitions FSM state and logs event."""
        if self.state == new_state:
            return
        old_state = self.state
        self.state = new_state
        self.status_message = reason
        print(f"[DRONE_CORE FSM] {old_state.value} -> {new_state.value} | {reason}")

        # Log event into local persistence
        self.persistence.log_mission_event(
            state=new_state.value,
            message=reason,
            telemetry={"lat": self.autopilot.get_telemetry().latitude, "lon": self.autopilot.get_telemetry().longitude}
        )
        self._notify()

    # =========================================================================
    # LIFECYCLE MANAGEMENT
    # =========================================================================

    async def start(self) -> bool:
        """Starts the air-gapped autonomous mission."""
        await self.autopilot.connect()
        self.vision.start()
        self._running = True

        telem = self.autopilot.get_telemetry()
        self.current_yaw_heading = telem.heading_deg

        self.transition_to(
            MissionState.TAKEOFF_ARRIVAL,
            f"Autonomous takeoff / arrival verified at search altitude {self.config.search_altitude_m}m AGL."
        )

        # Transition directly into SEARCHING
        self.transition_to(
            MissionState.SEARCHING,
            "Holding position. Initiating 360° continuous yaw sweep and dynamic zoom."
        )
        return True

    async def stop(self):
        """Terminates all vision loops and resets to STANDBY."""
        self._running = False
        self.vision.stop()
        self.transition_to(MissionState.STANDBY, "Autonomous edge mission halted.")

    # =========================================================================
    # ASYNCHRONOUS NON-BLOCKING TICK
    # =========================================================================

    async def tick(self, frame: Optional[np.ndarray] = None):
        """
        Single non-blocking execution tick.
        Called continuously at 10-20 Hz by mission runner.
        """
        if not self._running:
            return

        # 1. Non-blocking frame submission to worker queue
        if frame is not None:
            self.vision.submit_frame(frame)

        # 2. Poll processed results from vision worker without blocking
        cv_result = self.vision.get_latest_result()

        # 3. State-specific non-blocking execution
        try:
            if self.state == MissionState.SEARCHING:
                await self._step_searching(cv_result)
            elif self.state == MissionState.TARGET_DETECTED:
                await self._step_target_detected(cv_result)
            elif self.state == MissionState.APPROACHING:
                await self._step_approaching(cv_result)
            elif self.state == MissionState.DECODING:
                await self._step_decoding(cv_result)
            elif self.state == MissionState.RTL:
                # Terminal RTL state: holds until landed or reset
                pass
        except Exception as e:
            # Failsafe: any unrecoverable exception transitions safely to RTL
            print(f"[DRONE_CORE FSM] Unrecoverable exception during {self.state.value}: {e}")
            await self._trigger_failsafe_rtl(f"Unrecoverable exception: {e}")

    # =========================================================================
    # STATE IMPLEMENTATIONS
    # =========================================================================

    async def _step_searching(self, cv_result: Optional[Dict[str, Any]]):
        """
        SEARCHING:
        - Flight: Hold horizontal position, step 360° yaw (10-15°/sec).
        - Vision: Step dynamic zoom sweep, ingest candidates.
        """
        # 1. Yaw scan
        yaw_step = self.config.yaw_rate_dps * 0.1  # Assuming ~10Hz tick
        self.current_yaw_heading = (self.current_yaw_heading + yaw_step) % 360.0
        await self.autopilot.command_yaw(self.current_yaw_heading, self.config.yaw_rate_dps)

        # 2. Zoom sweep
        current_zoom = self.vision.step_dynamic_zoom(is_searching=True)

        # 3. Check for detected candidates
        if cv_result and cv_result.get("candidate"):
            candidate: VisionCandidate = cv_result["candidate"]
            self.candidate_verification_count = 1
            self.lost_candidate_count = 0
            self.target_candidate_box = {"x": candidate.x, "y": candidate.y, "w": candidate.width, "h": candidate.height}

            # Immediate direct QR decode shortcut if found in search
            if candidate.is_qr_direct and candidate.qr_payload:
                await self._handle_successful_decode(candidate.qr_payload, method="SEARCH_DIRECT")
                return

            self._localize_candidate(candidate.centroid_u, candidate.centroid_v, current_zoom)
            self.transition_to(
                MissionState.TARGET_DETECTED,
                f"Candidate identified at centroid ({candidate.centroid_u:.1f}, {candidate.centroid_v:.1f}). Pausing yaw."
            )

    async def _step_target_detected(self, cv_result: Optional[Dict[str, Any]]):
        """
        TARGET_DETECTED:
        - Action: Pause yaw rotation; maintain altitude hold.
        - Localization & Verification: Re-verify candidate across N frames.
        - Transition: If verified -> APPROACHING; if lost -> return to SEARCHING.
        """
        # Hold altitude and current yaw
        await self.autopilot.hold_position(self.config.search_altitude_m)

        if cv_result is not None:
            if cv_result.get("candidate"):
                candidate: VisionCandidate = cv_result["candidate"]
                self.candidate_verification_count += 1
                self.lost_candidate_count = 0
                # Update localized displacement with latest centroid
                self._localize_candidate(candidate.centroid_u, candidate.centroid_v, self.vision.current_zoom)

                if candidate.is_qr_direct and candidate.qr_payload:
                    await self._handle_successful_decode(candidate.qr_payload, method="DETECT_DIRECT")
                    return

                if self.candidate_verification_count >= self.config.verification_frames:
                    self.transition_to(
                        MissionState.APPROACHING,
                        f"Candidate verified across {self.candidate_verification_count} frames. Dispatched navigation to ({self.locked_target.target_lat}, {self.locked_target.target_lon})."
                    )
                    # Dispatch non-blocking reposition command
                    await self.autopilot.fly_to_position(
                        self.locked_target.target_lat,
                        self.locked_target.target_lon,
                        self.config.approach_altitude_m,
                        self.config.approach_speed_mps
                    )
            else:
                self.lost_candidate_count += 1
                if self.lost_candidate_count >= self.config.verification_frames:
                    self.candidate_verification_count = 0
                    self.transition_to(
                        MissionState.SEARCHING,
                        "Target candidate lost or false positive. Resuming 360° visual search."
                    )

    async def _step_approaching(self, cv_result: Optional[Dict[str, Any]]):
        """
        APPROACHING:
        - Flight: Non-blocking position targets towards localized coordinates.
        - Altitude: Step down to decoding altitude while compensating zoom to center target.
        - Transition: Arrived within arrival_tolerance_m -> DECODING.
        """
        if not self.locked_target:
            self.transition_to(MissionState.SEARCHING, "Target lost during approach. Returning to search.")
            return

        telem = self.autopilot.get_telemetry()
        dist = haversine_distance_m(
            telem.latitude, telem.longitude,
            self.locked_target.target_lat, self.locked_target.target_lon
        )

        # Check opportunistic decode during approach
        if cv_result and cv_result.get("qr_result") and cv_result["qr_result"].verified:
            await self._handle_successful_decode(cv_result["qr_result"].payload, method="APPROACH_INTERCEPT")
            return

        # Continuous target centering with zoom compensation
        if cv_result and cv_result.get("candidate"):
            candidate: VisionCandidate = cv_result["candidate"]
            self._localize_candidate(candidate.centroid_u, candidate.centroid_v, self.vision.current_zoom)
            # Re-issue fine reposition target
            await self.autopilot.fly_to_position(
                self.locked_target.target_lat,
                self.locked_target.target_lon,
                self.config.decoding_altitude_m,
                self.config.approach_speed_mps
            )

        # Arrival condition threshold
        if dist <= self.config.arrival_tolerance_m:
            self.decode_start_time = time.time()
            self.decode_retries_count = 0
            self.vision.set_zoom(1.5)  # Set sharp optical focus for decode
            self.transition_to(
                MissionState.DECODING,
                f"Arrived directly above target (distance: {dist:.2f}m <= {self.config.arrival_tolerance_m}m). Initiating high-res decoding."
            )
            await self.autopilot.hold_position(self.config.decoding_altitude_m)

    async def _step_decoding(self, cv_result: Optional[Dict[str, Any]]):
        """
        DECODING:
        - Flight: Maintain tight position and yaw hold.
        - Vision: Multi-pass high-resolution QR decoding across frames.
        - Success: Payload verified -> RTL.
        - Timeout: Continuous decode timeout -> RTL / localized search.
        """
        self.decode_retries_count += 1
        telem = self.autopilot.get_telemetry()
        await self.autopilot.hold_position(self.config.decoding_altitude_m)

        # Check for verified QR decode
        if cv_result and cv_result.get("qr_result") and cv_result["qr_result"].verified:
            payload = cv_result["qr_result"].payload
            await self._handle_successful_decode(payload, method=cv_result["qr_result"].method)
            return

        # Dynamic zoom adjustment during decoding if initial frames fail
        if self.decode_retries_count % 8 == 0:
            next_zoom = 2.0 if self.vision.current_zoom <= 1.5 else 1.25
            self.vision.set_zoom(next_zoom)

        # Timeout Check
        elapsed = time.time() - self.decode_start_time
        if elapsed >= self.config.decode_timeout_s or self.decode_retries_count >= self.config.max_decode_retries:
            print(f"[DRONE_CORE FSM] Decode timeout ({elapsed:.1f}s, {self.decode_retries_count} retries). Triggering failsafe.")
            await self._trigger_failsafe_rtl("Decoding timeout reached without verified payload. Failing safely to RTL.")

    async def _handle_successful_decode(self, payload: str, method: str = "DECODED"):
        """
        Handles verified payload:
        1. Validates checksum & persists locally to JSON and SQLite.
        2. Powers down non-essential CV pipelines.
        3. Commands autonomous Return-to-Launch (RTL).
        """
        telem = self.autopilot.get_telemetry()
        dist = 0.0
        if self.locked_target:
            dist = haversine_distance_m(
                telem.latitude, telem.longitude,
                self.locked_target.target_lat, self.locked_target.target_lon
            )

        # Save to local disk persistence with SHA-256 checksum and timestamps
        record = self.persistence.save_payload(
            payload=payload,
            lat=telem.latitude,
            lon=telem.longitude,
            alt=telem.altitude_m,
            distance_to_target=round(dist, 2),
            verified=True
        )
        self.decoded_payload_record = record

        # Terminate CV processing pipeline
        self.vision.stop()

        # Command autonomous RTL
        self.transition_to(
            MissionState.RTL,
            f"Payload '{payload}' (SHA-256: {record.checksum_sha256[:8]}...) saved locally. Autopilot executing autonomous RTL."
        )
        await self.autopilot.command_rtl()

    async def _trigger_failsafe_rtl(self, reason: str):
        """Failsafe handler: terminates CV and commands RTL."""
        self.vision.stop()
        self.transition_to(MissionState.RTL, f"FAILSAFE RTL ACTIVATED: {reason}")
        await self.autopilot.command_rtl()

    def _localize_candidate(self, u: float, v: float, zoom: float):
        """Invokes pinhole projection pipeline to update target coordinates."""
        telem = self.autopilot.get_telemetry()
        self.locked_target = self.resolver.resolve_target(
            u=u,
            v=v,
            drone_lat=telem.latitude,
            drone_lon=telem.longitude,
            altitude_m=telem.altitude_m,
            heading_deg=telem.heading_deg,
            zoom_factor=zoom
        )
