"""
Monotonic Telemetry Synchronization Ring Buffer & Interpolation Engine
Milestone 2: S500-AeroRecon Quadcopter System

Implements:
1. Thread-safe circular ring buffer (K=50) caching high-rate Pixhawk MAVLink telemetry states.
2. Ingests ATTITUDE (#30, 20Hz), GLOBAL_POSITION_INT (#33, 10Hz), and HEARTBEAT (#0, 1Hz).
3. Monotonic time stamping using time.monotonic() matching camera frame exposures.
4. Linear and circular SLERP-equivalent interpolation synchronizing telemetry to exact frame timestamp t_frame.
5. Heading and yaw angular wraparound handling across 0° / 360° discontinuities.
"""

import math
import time
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, List, Tuple, Dict, Any


@dataclass
class TelemetrySnapshot:
    """Synchronized multi-sensor telemetry state at a discrete monotonic timestamp."""
    timestamp_mono: float
    time_boot_ms: int = 0
    latitude: float = 0.0          # Geodetic degrees
    longitude: float = 0.0         # Geodetic degrees
    altitude_agl_m: float = 0.0    # Meters AGL (relative_alt)
    altitude_msl_m: float = 0.0    # Meters MSL (alt)
    roll_rad: float = 0.0          # Radians (+right down)
    pitch_rad: float = 0.0         # Radians (+nose up, -nose down)
    yaw_rad: float = 0.0           # Radians (+clockwise from North)
    roll_deg: float = 0.0
    pitch_deg: float = 0.0
    yaw_deg: float = 0.0
    heading_deg: float = 0.0       # Compass heading 0..360°
    vx_mps: float = 0.0            # North ground speed
    vy_mps: float = 0.0            # East ground speed
    vz_mps: float = 0.0            # Down vertical speed
    ground_speed_mps: float = 0.0
    custom_mode: int = 0
    is_armed: bool = False
    is_valid: bool = True


class TelemetrySyncBuffer:
    """
    Circular history buffer (K=50) providing interpolation of drone states
    to the exact camera exposure timestamp t_frame.
    """

    def __init__(self, capacity: int = 50):
        self.capacity = capacity
        self._buffer: deque = deque(maxlen=capacity)
        self._lock = threading.Lock()

        # Cache of latest received values
        self._latest_time_boot_ms = 0
        self._latest_lat = 0.0
        self._latest_lon = 0.0
        self._latest_alt_agl = 0.0
        self._latest_alt_msl = 0.0
        self._latest_roll = 0.0
        self._latest_pitch = 0.0
        self._latest_yaw = 0.0
        self._latest_heading = 0.0
        self._latest_vx = 0.0
        self._latest_vy = 0.0
        self._latest_vz = 0.0
        self._latest_mode = 0
        self._latest_armed = False
        self._total_ingested = 0

    def update_attitude(self, roll_rad: float, pitch_rad: float, yaw_rad: float, time_boot_ms: int = 0):
        """Ingests MAVLink ATTITUDE (#30) packet."""
        now_mono = time.monotonic()
        with self._lock:
            self._latest_time_boot_ms = time_boot_ms
            self._latest_roll = roll_rad
            self._latest_pitch = pitch_rad
            self._latest_yaw = yaw_rad % (2.0 * math.pi)
            self._push_snapshot_locked(now_mono)

    def update_global_position(
        self,
        lat_deg: float,
        lon_deg: float,
        alt_agl_m: float,
        alt_msl_m: float,
        vx_mps: float = 0.0,
        vy_mps: float = 0.0,
        vz_mps: float = 0.0,
        hdg_deg: float = 0.0,
        time_boot_ms: int = 0
    ):
        """Ingests MAVLink GLOBAL_POSITION_INT (#33) packet."""
        now_mono = time.monotonic()
        with self._lock:
            self._latest_time_boot_ms = time_boot_ms
            self._latest_lat = lat_deg
            self._latest_lon = lon_deg
            self._latest_alt_agl = alt_agl_m
            self._latest_alt_msl = alt_msl_m
            self._latest_vx = vx_mps
            self._latest_vy = vy_mps
            self._latest_vz = vz_mps
            self._latest_heading = hdg_deg % 360.0
            self._push_snapshot_locked(now_mono)

    def update_heartbeat(self, custom_mode: int, is_armed: bool):
        """Ingests MAVLink HEARTBEAT (#0) packet."""
        with self._lock:
            self._latest_mode = custom_mode
            self._latest_armed = is_armed

    def push_snapshot(self, snapshot: TelemetrySnapshot):
        """Directly pushes a complete snapshot (useful for testing and replay)."""
        with self._lock:
            self._buffer.append(snapshot)
            self._total_ingested += 1

    def _push_snapshot_locked(self, timestamp_mono: float):
        """Internal helper to construct and append snapshot from latest cached values."""
        spd = math.sqrt(self._latest_vx ** 2 + self._latest_vy ** 2)
        snap = TelemetrySnapshot(
            timestamp_mono=timestamp_mono,
            time_boot_ms=self._latest_time_boot_ms,
            latitude=self._latest_lat,
            longitude=self._latest_lon,
            altitude_agl_m=self._latest_alt_agl,
            altitude_msl_m=self._latest_alt_msl,
            roll_rad=self._latest_roll,
            pitch_rad=self._latest_pitch,
            yaw_rad=self._latest_yaw,
            roll_deg=math.degrees(self._latest_roll),
            pitch_deg=math.degrees(self._latest_pitch),
            yaw_deg=math.degrees(self._latest_yaw),
            heading_deg=self._latest_heading,
            vx_mps=self._latest_vx,
            vy_mps=self._latest_vy,
            vz_mps=self._latest_vz,
            ground_speed_mps=spd,
            custom_mode=self._latest_mode,
            is_armed=self._latest_armed,
            is_valid=(abs(self._latest_lat) > 1e-6 or abs(self._latest_lon) > 1e-6)
        )
        self._buffer.append(snap)
        self._total_ingested += 1

    def get_latest(self) -> Optional[TelemetrySnapshot]:
        """Returns the most recent snapshot in the buffer without interpolation."""
        with self._lock:
            if not self._buffer:
                return None
            return self._buffer[-1]

    def interpolate(self, t_frame_mono: float) -> TelemetrySnapshot:
        """
        Interpolates drone position and attitude to match exact frame exposure timestamp t_frame_mono.
        Uses SLERP-equivalent circular angle interpolation for yaw and heading.
        """
        with self._lock:
            if not self._buffer:
                # Return empty default snapshot
                return TelemetrySnapshot(timestamp_mono=t_frame_mono, is_valid=False)

            buf_list = list(self._buffer)

        # If only 1 snapshot, return it
        if len(buf_list) == 1:
            return buf_list[0]

        # Boundary checks
        if t_frame_mono <= buf_list[0].timestamp_mono:
            return buf_list[0]
        if t_frame_mono >= buf_list[-1].timestamp_mono:
            return buf_list[-1]

        # Binary search or scan for interval [s0, s1] such that s0.t <= t_frame <= s1.t
        idx = 0
        for i in range(len(buf_list) - 1):
            if buf_list[i].timestamp_mono <= t_frame_mono <= buf_list[i + 1].timestamp_mono:
                idx = i
                break

        s0 = buf_list[idx]
        s1 = buf_list[idx + 1]

        dt = s1.timestamp_mono - s0.timestamp_mono
        if dt <= 1e-6:
            return s1

        alpha = max(0.0, min(1.0, (t_frame_mono - s0.timestamp_mono) / dt))

        # 1. Linear interpolation for position and altitude
        interp_lat = (1.0 - alpha) * s0.latitude + alpha * s1.latitude
        interp_lon = (1.0 - alpha) * s0.longitude + alpha * s1.longitude
        interp_alt_agl = (1.0 - alpha) * s0.altitude_agl_m + alpha * s1.altitude_agl_m
        interp_alt_msl = (1.0 - alpha) * s0.altitude_msl_m + alpha * s1.altitude_msl_m

        # 2. Linear interpolation for roll and pitch
        interp_roll = (1.0 - alpha) * s0.roll_rad + alpha * s1.roll_rad
        interp_pitch = (1.0 - alpha) * s0.pitch_rad + alpha * s1.pitch_rad

        # 3. Circular shortest-arc interpolation for yaw
        delta_yaw = math.atan2(math.sin(s1.yaw_rad - s0.yaw_rad), math.cos(s1.yaw_rad - s0.yaw_rad))
        interp_yaw = (s0.yaw_rad + alpha * delta_yaw) % (2.0 * math.pi)

        # 4. Circular shortest-arc interpolation for heading degrees
        h0_rad = math.radians(s0.heading_deg)
        h1_rad = math.radians(s1.heading_deg)
        delta_hdg = math.atan2(math.sin(h1_rad - h0_rad), math.cos(h1_rad - h0_rad))
        interp_heading = math.degrees(h0_rad + alpha * delta_hdg) % 360.0

        # 5. Linear velocity interpolation
        interp_vx = (1.0 - alpha) * s0.vx_mps + alpha * s1.vx_mps
        interp_vy = (1.0 - alpha) * s0.vy_mps + alpha * s1.vy_mps
        interp_vz = (1.0 - alpha) * s0.vz_mps + alpha * s1.vz_mps
        interp_spd = math.sqrt(interp_vx ** 2 + interp_vy ** 2)

        # 6. Discrete state nearest-neighbor selection
        closer = s0 if alpha < 0.5 else s1

        return TelemetrySnapshot(
            timestamp_mono=t_frame_mono,
            time_boot_ms=closer.time_boot_ms,
            latitude=interp_lat,
            longitude=interp_lon,
            altitude_agl_m=interp_alt_agl,
            altitude_msl_m=interp_alt_msl,
            roll_rad=interp_roll,
            pitch_rad=interp_pitch,
            yaw_rad=interp_yaw,
            roll_deg=math.degrees(interp_roll),
            pitch_deg=math.degrees(interp_pitch),
            yaw_deg=math.degrees(interp_yaw),
            heading_deg=interp_heading,
            vx_mps=interp_vx,
            vy_mps=interp_vy,
            vz_mps=interp_vz,
            ground_speed_mps=interp_spd,
            custom_mode=closer.custom_mode,
            is_armed=closer.is_armed,
            is_valid=(abs(interp_lat) > 1e-6 or abs(interp_lon) > 1e-6)
        )

    def size(self) -> int:
        with self._lock:
            return len(self._buffer)
