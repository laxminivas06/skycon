"""
Standalone Air-Gapped Edge-Only Autonomous Drone Core (drone_core)
Milestone 2: Production Onboard Vision, Georeferencing & Flight Control
"""

# Core legacy & FSM interfaces
from .config import EdgeMissionConfig, CameraIntrinsics
from .fsm import AutonomousEdgeMissionFSM, MissionState
from .localization import PinholeTargetResolver, TargetDisplacement, haversine_distance_m
from .autopilot import AutopilotInterface, MockAutopilot, TelemetryState
from .vision import OnboardVisionEngine, VisionCandidate, DecodeResult
from .persistence import (
    LocalPersistenceManager,
    DecodedPayloadRecord,
    GeoreferencedDetectionRecord,
    TargetLocationRecord,
    DroneStateRecord,
    CameraIntrinsicsRecord,
    BoundingBoxRecord,
)

# Milestone 2 Production Edge Vision & Georeferencing Modules
from .v4l2_capture import V4L2CapturePipeline, V4L2Config, CapturedFrame
from .qr_detector import WeChatQRDetector, QRDetectionResult
from .georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult
from .brake_controller import BrakeController, BrakingKinematics, BrakeEvent
from .telemetry_sync import TelemetrySyncBuffer, TelemetrySnapshot
from .companion_vision_node import CompanionVisionNode

__all__ = [
    # Legacy / Base interfaces
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
    # M2 Enhanced Records
    "GeoreferencedDetectionRecord",
    "TargetLocationRecord",
    "DroneStateRecord",
    "CameraIntrinsicsRecord",
    "BoundingBoxRecord",
    # M2 Production Services
    "V4L2CapturePipeline",
    "V4L2Config",
    "CapturedFrame",
    "WeChatQRDetector",
    "QRDetectionResult",
    "Georeferencer",
    "CameraIntrinsics3D",
    "GeoreferenceResult",
    "BrakeController",
    "BrakingKinematics",
    "BrakeEvent",
    "TelemetrySyncBuffer",
    "TelemetrySnapshot",
    "CompanionVisionNode",
]
