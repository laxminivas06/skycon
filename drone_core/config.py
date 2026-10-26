"""
Edge-Only Autonomous Mission Configuration (drone_core)
"""

from dataclasses import dataclass, field
import re
from typing import Pattern


@dataclass
class CameraIntrinsics:
    width: int = 1280
    height: int = 720
    hfov_deg: float = 60.0
    vfov_deg: float = 45.0
    # Optional explicit focal lengths and principal point (if calibrated)
    fx: float = None
    fy: float = None
    cx: float = None
    cy: float = None

    def __post_init__(self):
        import math
        if self.cx is None:
            self.cx = self.width / 2.0
        if self.cy is None:
            self.cy = self.height / 2.0
        if self.fx is None:
            self.fx = (self.width / 2.0) / math.tan(math.radians(self.hfov_deg / 2.0))
        if self.fy is None:
            self.fy = (self.height / 2.0) / math.tan(math.radians(self.vfov_deg / 2.0))


@dataclass
class EdgeMissionConfig:
    # Flight altitudes (AGL)
    search_altitude_m: float = 10.0
    approach_altitude_m: float = 5.0
    decoding_altitude_m: float = 3.5

    # Yaw scanning
    yaw_rate_dps: float = 12.0  # 10-15°/sec continuous smooth sweep

    # Dynamic optical/digital zoom sweep
    min_zoom: float = 1.0
    max_zoom: float = 2.5
    zoom_step: float = 0.25
    zoom_interval_s: float = 1.2

    # Approach thresholds
    arrival_tolerance_m: float = 1.5
    approach_speed_mps: float = 2.0

    # Verification and decoding
    verification_frames: int = 3
    max_decode_retries: int = 40
    decode_timeout_s: float = 15.0
    payload_regex: str = r"^\d{2}$"

    # Persistence
    payload_storage_path: str = "data/decoded_payloads.json"
    sqlite_storage_path: str = "data/mission_telemetry.db"

    # Camera
    camera: CameraIntrinsics = field(default_factory=CameraIntrinsics)

    def get_compiled_regex(self) -> Pattern:
        return re.compile(self.payload_regex)
