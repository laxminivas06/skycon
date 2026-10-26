"""
Standalone Air-Gapped Edge-Only Autonomous Drone Core (drone_core)
"""

from .config import EdgeMissionConfig, CameraIntrinsics
from .fsm import AutonomousEdgeMissionFSM, MissionState
from .localization import PinholeTargetResolver, TargetDisplacement, haversine_distance_m
from .autopilot import AutopilotInterface, MockAutopilot, TelemetryState
from .vision import OnboardVisionEngine, VisionCandidate, DecodeResult
from .persistence import LocalPersistenceManager, DecodedPayloadRecord

__all__ = [
    "EdgeMissionConfig",
    "CameraIntrinsics",
    "AutonomousEdgeMissionFSM",
    "MissionState",
    "PinholeTargetResolver",
    "TargetDisplacement",
    "haversine_distance_m",
    "AutopilotInterface",
    "MockAutopilot",
    "TelemetryState",
    "OnboardVisionEngine",
    "VisionCandidate",
    "DecodeResult",
    "LocalPersistenceManager",
    "DecodedPayloadRecord",
]
