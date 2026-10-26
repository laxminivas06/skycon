"""
Autopilot Interface & Flight Controller Command Layer (MAVLink / Serial)
"""

import time
from dataclasses import dataclass, field
from typing import Optional, Callable


@dataclass
class TelemetryState:
    latitude: float = 12.9715987
    longitude: float = 77.5945627
    altitude_m: float = 10.0
    heading_deg: float = 90.0
    ground_speed_mps: float = 0.0
    vertical_speed_mps: float = 0.0
    flight_mode: str = "GUIDED"
    is_armed: bool = True
    satellites: int = 14
    ekf_healthy: bool = True
    battery_pct: float = 95.0
    last_heartbeat_timestamp: float = field(default_factory=time.time)


class AutopilotInterface:
    """Base interface for flight controller navigation & control."""

    async def connect(self) -> bool:
        raise NotImplementedError

    async def command_yaw(self, heading_deg: float, yaw_rate_dps: float) -> bool:
        raise NotImplementedError

    async def hold_position(self, altitude_m: Optional[float] = None) -> bool:
        raise NotImplementedError

    async def fly_to_position(self, target_lat: float, target_lon: float, target_alt_m: float, speed_mps: float = 2.0) -> bool:
        raise NotImplementedError

    async def command_rtl(self) -> bool:
        raise NotImplementedError

    def get_telemetry(self) -> TelemetryState:
        raise NotImplementedError

    async def disconnect(self):
        pass


class MockAutopilot(AutopilotInterface):
    """
    In-memory mock flight controller for standalone testing and SITL simulation.
    Allows testing full state transitions without physical hardware.
    """

    def __init__(self, initial_telemetry: Optional[TelemetryState] = None):
        self.telemetry = initial_telemetry or TelemetryState()
        self.commands_sent: list = []
        self._connected = True

    async def connect(self) -> bool:
        self._connected = True
        return True

    async def command_yaw(self, heading_deg: float, yaw_rate_dps: float) -> bool:
        self.telemetry.heading_deg = heading_deg % 360.0
        self.commands_sent.append({
            "command": "CONDITION_YAW",
            "heading": heading_deg,
            "rate": yaw_rate_dps,
            "timestamp": time.time()
        })
        return True

    async def hold_position(self, altitude_m: Optional[float] = None) -> bool:
        if altitude_m is not None:
            self.telemetry.altitude_m = altitude_m
        self.commands_sent.append({
            "command": "HOLD_POSITION",
            "altitude": self.telemetry.altitude_m,
            "timestamp": time.time()
        })
        return True

    async def fly_to_position(self, target_lat: float, target_lon: float, target_alt_m: float, speed_mps: float = 2.0) -> bool:
        # Simulate motion towards target
        self.telemetry.latitude = target_lat
        self.telemetry.longitude = target_lon
        self.telemetry.altitude_m = target_alt_m
        self.telemetry.ground_speed_mps = speed_mps
        self.commands_sent.append({
            "command": "DO_REPOSITION",
            "latitude": target_lat,
            "longitude": target_lon,
            "altitude": target_alt_m,
            "speed": speed_mps,
            "timestamp": time.time()
        })
        return True

    async def command_rtl(self) -> bool:
        self.telemetry.flight_mode = "RTL"
        self.commands_sent.append({
            "command": "NAV_RETURN_TO_LAUNCH",
            "timestamp": time.time()
        })
        return True

    def get_telemetry(self) -> TelemetryState:
        self.telemetry.last_heartbeat_timestamp = time.time()
        return self.telemetry

    async def disconnect(self):
        self._connected = False
