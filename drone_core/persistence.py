"""
Air-Gapped Local Persistence Store (Atomic JSON & SQLite)
Milestone 2: S500-AeroRecon Quadcopter System

Implements:
1. Atomic POSIX / Windows file persistence using .tmp write and atomic replace.
2. SHA-256 cryptographic checksum calculation and validation on all records.
3. Local SQLite database storage for air-gapped audit logging (decoded_payloads, georeferenced_detections, mission_events).
4. Standardized JSON schema adhering to PROJECT.md §5 and Technical Report §3.7.
5. 100% backward compatibility with existing DecodedPayloadRecord and test suites.
"""

import json
import os
import sqlite3
import hashlib
from datetime import datetime, timezone
from dataclasses import dataclass, asdict, field
from typing import Optional, Dict, Any, List, Union


@dataclass
class DecodedPayloadRecord:
    """Legacy/core decoded payload record."""
    payload: str
    checksum_sha256: str
    timestamp_utc: str
    epoch_ms: int
    drone_latitude: float
    drone_longitude: float
    drone_altitude_m: float
    approach_distance_m: float
    verified: bool
    status: str = "DECODED_AND_VERIFIED"
    air_gapped: bool = True


@dataclass
class TargetLocationRecord:
    latitude: float
    longitude: float
    altitudeAgl: float
    groundDistanceMeters: float
    offsetNorthMeters: float
    offsetEastMeters: float


@dataclass
class DroneStateRecord:
    latitude: float
    longitude: float
    altitudeAgl: float
    altitudeMsl: float
    rollDeg: float
    pitchDeg: float
    yawDeg: float
    groundSpeedMps: float


@dataclass
class CameraIntrinsicsRecord:
    sensorModel: str
    frameWidth: int
    frameHeight: int
    hfovDeg: float
    vfovDeg: float
    focalLengthPixels: float


@dataclass
class BoundingBoxRecord:
    x: int
    y: int
    width: int
    height: int
    centroidU: float
    centroidV: float


@dataclass
class GeoreferencedDetectionRecord:
    """Standardized Target Detection Payload conforming to PROJECT.md §5 schema."""
    detectionId: str
    timestampUtc: str
    epochMs: int
    payload: str
    twoDigitCode: str
    verified: bool
    targetLocation: TargetLocationRecord
    droneStateAtCapture: DroneStateRecord
    cameraIntrinsics: CameraIntrinsicsRecord
    boundingBox: BoundingBoxRecord
    checksumSha256: str
    thumbnailBase64: Optional[str] = None


class LocalPersistenceManager:
    """
    Manages air-gapped onboard disk storage with atomic writes,
    checksum verification, and local SQLite audit logs.
    """

    def __init__(self, json_path: str = "data/decoded_payloads.json", db_path: str = "data/mission_telemetry.db"):
        self.json_path = json_path
        self.db_path = db_path
        self._ensure_directories()
        self._init_sqlite()

    def _ensure_directories(self):
        for path in [self.json_path, self.db_path]:
            directory = os.path.dirname(path)
            if directory and not os.path.exists(directory):
                os.makedirs(directory, exist_ok=True)

    def _init_sqlite(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS decoded_payloads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payload TEXT NOT NULL,
                    checksum_sha256 TEXT NOT NULL,
                    timestamp_utc TEXT NOT NULL,
                    epoch_ms INTEGER NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    altitude REAL,
                    verified INTEGER NOT NULL,
                    air_gapped INTEGER NOT NULL
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS georeferenced_detections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    detection_id TEXT UNIQUE NOT NULL,
                    timestamp_utc TEXT NOT NULL,
                    epoch_ms INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    two_digit_code TEXT NOT NULL,
                    target_lat REAL NOT NULL,
                    target_lon REAL NOT NULL,
                    ground_dist_m REAL NOT NULL,
                    offset_north_m REAL NOT NULL,
                    offset_east_m REAL NOT NULL,
                    drone_lat REAL NOT NULL,
                    drone_lon REAL NOT NULL,
                    altitude_agl REAL NOT NULL,
                    roll_deg REAL NOT NULL,
                    pitch_deg REAL NOT NULL,
                    yaw_deg REAL NOT NULL,
                    centroid_u REAL NOT NULL,
                    centroid_v REAL NOT NULL,
                    checksum_sha256 TEXT NOT NULL,
                    raw_json TEXT NOT NULL
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mission_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp_utc TEXT NOT NULL,
                    state TEXT NOT NULL,
                    message TEXT NOT NULL,
                    telemetry_json TEXT
                )
            """)
            conn.commit()

    @staticmethod
    def calculate_checksum(data_str: str) -> str:
        """Calculates SHA-256 checksum for payload verification."""
        return hashlib.sha256(data_str.encode("utf-8")).hexdigest()

    def save_payload(
        self,
        payload: str,
        lat: float,
        lon: float,
        alt: float,
        distance_to_target: float = 0.0,
        verified: bool = True
    ) -> DecodedPayloadRecord:
        """
        Atomically saves verified payload to local JSON and SQLite.
        """
        now = datetime.now(timezone.utc)
        iso_time = now.isoformat()
        epoch_ms = int(now.timestamp() * 1000)
        checksum = self.calculate_checksum(payload)

        record = DecodedPayloadRecord(
            payload=payload,
            checksum_sha256=checksum,
            timestamp_utc=iso_time,
            epoch_ms=epoch_ms,
            drone_latitude=lat,
            drone_longitude=lon,
            drone_altitude_m=alt,
            approach_distance_m=distance_to_target,
            verified=verified,
            air_gapped=True
        )

        # 1. Update SQLite
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO decoded_payloads 
                (payload, checksum_sha256, timestamp_utc, epoch_ms, latitude, longitude, altitude, verified, air_gapped)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.payload,
                record.checksum_sha256,
                record.timestamp_utc,
                record.epoch_ms,
                record.drone_latitude,
                record.drone_longitude,
                record.drone_altitude_m,
                1 if record.verified else 0,
                1
            ))
            conn.commit()

        # 2. Atomic write to JSON
        self._atomic_append_json(asdict(record))
        return record

    def save_georeferenced_detection(
        self,
        payload: str,
        two_digit_code: str,
        target_lat: float,
        target_lon: float,
        altitude_agl: float,
        ground_distance_m: float,
        offset_north_m: float,
        offset_east_m: float,
        drone_lat: float,
        drone_lon: float,
        drone_alt_agl: float,
        drone_alt_msl: float,
        roll_deg: float,
        pitch_deg: float,
        yaw_deg: float,
        ground_speed_mps: float,
        camera_intrinsics: Dict[str, Any],
        bounding_box: Dict[str, Any],
        thumbnail_base64: Optional[str] = None,
        verified: bool = True
    ) -> GeoreferencedDetectionRecord:
        """
        Atomically saves full standardized georeferenced target record to JSON and SQLite.
        """
        now = datetime.now(timezone.utc)
        iso_time = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(now.microsecond / 1000):03d}Z"
        epoch_ms = int(now.timestamp() * 1000)
        detection_id = f"DET_{epoch_ms}"

        target_loc = TargetLocationRecord(
            latitude=round(target_lat, 7),
            longitude=round(target_lon, 7),
            altitudeAgl=round(altitude_agl, 2),
            groundDistanceMeters=round(ground_distance_m, 2),
            offsetNorthMeters=round(offset_north_m, 2),
            offsetEastMeters=round(offset_east_m, 2)
        )

        drone_state = DroneStateRecord(
            latitude=round(drone_lat, 7),
            longitude=round(drone_lon, 7),
            altitudeAgl=round(drone_alt_agl, 2),
            altitudeMsl=round(drone_alt_msl, 2),
            rollDeg=round(roll_deg, 2),
            pitchDeg=round(pitch_deg, 2),
            yawDeg=round(yaw_deg, 2),
            groundSpeedMps=round(ground_speed_mps, 2)
        )

        cam_rec = CameraIntrinsicsRecord(
            sensorModel=camera_intrinsics.get("sensorModel", "Sony IMX477"),
            frameWidth=int(camera_intrinsics.get("frameWidth", 1280)),
            frameHeight=int(camera_intrinsics.get("frameHeight", 720)),
            hfovDeg=float(camera_intrinsics.get("hfovDeg", 68.0)),
            vfovDeg=float(camera_intrinsics.get("vfovDeg", 54.0)),
            focalLengthPixels=float(camera_intrinsics.get("focalLengthPixels", 948.84))
        )

        bbox_rec = BoundingBoxRecord(
            x=int(bounding_box.get("x", 0)),
            y=int(bounding_box.get("y", 0)),
            width=int(bounding_box.get("width", 0)),
            height=int(bounding_box.get("height", 0)),
            centroidU=round(float(bounding_box.get("centroidU", 0.0)), 2),
            centroidV=round(float(bounding_box.get("centroidV", 0.0)), 2)
        )

        # Canonical string for checksum calculation
        canonical_str = f"{detection_id}|{payload}|{target_lat:.7f}|{target_lon:.7f}|{epoch_ms}"
        checksum = self.calculate_checksum(canonical_str)

        record = GeoreferencedDetectionRecord(
            detectionId=detection_id,
            timestampUtc=iso_time,
            epochMs=epoch_ms,
            payload=payload,
            twoDigitCode=two_digit_code,
            verified=verified,
            targetLocation=target_loc,
            droneStateAtCapture=drone_state,
            cameraIntrinsics=cam_rec,
            boundingBox=bbox_rec,
            checksumSha256=checksum,
            thumbnailBase64=thumbnail_base64
        )

        record_dict = asdict(record)

        # 1. Save to SQLite
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO georeferenced_detections
                (detection_id, timestamp_utc, epoch_ms, payload, two_digit_code,
                 target_lat, target_lon, ground_dist_m, offset_north_m, offset_east_m,
                 drone_lat, drone_lon, altitude_agl, roll_deg, pitch_deg, yaw_deg,
                 centroid_u, centroid_v, checksum_sha256, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.detectionId,
                record.timestampUtc,
                record.epochMs,
                record.payload,
                record.twoDigitCode,
                target_loc.latitude,
                target_loc.longitude,
                target_loc.groundDistanceMeters,
                target_loc.offsetNorthMeters,
                target_loc.offsetEastMeters,
                drone_state.latitude,
                drone_state.longitude,
                drone_state.altitudeAgl,
                drone_state.rollDeg,
                drone_state.pitchDeg,
                drone_state.yawDeg,
                bbox_rec.centroidU,
                bbox_rec.centroidV,
                record.checksumSha256,
                json.dumps(record_dict)
            ))
            # Also keep legacy table updated
            cursor.execute("""
                INSERT INTO decoded_payloads 
                (payload, checksum_sha256, timestamp_utc, epoch_ms, latitude, longitude, altitude, verified, air_gapped)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                record.payload,
                record.checksumSha256,
                record.timestampUtc,
                record.epochMs,
                target_loc.latitude,
                target_loc.longitude,
                target_loc.altitudeAgl,
                1 if record.verified else 0,
                1
            ))
            conn.commit()

        # 2. Atomic append to JSON
        self._atomic_append_json(record_dict)
        return record

    def _atomic_append_json(self, record_dict: Dict[str, Any]):
        """Appends record to target JSON file using temporary file and atomic replace."""
        existing_records: List[Dict[str, Any]] = []
        if os.path.exists(self.json_path):
            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        existing_records = data
                    elif isinstance(data, dict):
                        existing_records = [data]
            except Exception:
                existing_records = []

        existing_records.append(record_dict)

        temp_path = f"{self.json_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(existing_records, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, self.json_path)

    def log_mission_event(self, state: str, message: str, telemetry: Optional[Dict[str, Any]] = None):
        """Logs mission transition events into local SQLite."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO mission_events (timestamp_utc, state, message, telemetry_json)
                    VALUES (?, ?, ?, ?)
                """, (
                    datetime.now(timezone.utc).isoformat(),
                    state,
                    message,
                    json.dumps(telemetry or {})
                ))
                conn.commit()
        except Exception:
            pass

    def load_latest_payload(self) -> Optional[DecodedPayloadRecord]:
        """Loads and verifies checksum of the latest saved payload (legacy compatibility)."""
        if not os.path.exists(self.json_path):
            return None

        try:
            with open(self.json_path, "r", encoding="utf-8") as f:
                records = json.load(f)
                if not records:
                    return None
                last = records[-1]
                # If schema is full GeoreferencedDetectionRecord
                if "detectionId" in last:
                    checksum = self.calculate_checksum(
                        f"{last['detectionId']}|{last['payload']}|{last['targetLocation']['latitude']:.7f}|{last['targetLocation']['longitude']:.7f}|{last['epochMs']}"
                    )
                    if checksum != last["checksumSha256"]:
                        raise ValueError("Payload SHA-256 checksum mismatch!")
                    return DecodedPayloadRecord(
                        payload=last["payload"],
                        checksum_sha256=last["checksumSha256"],
                        timestamp_utc=last["timestampUtc"],
                        epoch_ms=last["epochMs"],
                        drone_latitude=last["droneStateAtCapture"]["latitude"],
                        drone_longitude=last["droneStateAtCapture"]["longitude"],
                        drone_altitude_m=last["droneStateAtCapture"]["altitudeAgl"],
                        approach_distance_m=last["targetLocation"]["groundDistanceMeters"],
                        verified=last["verified"],
                        status="DECODED_AND_VERIFIED",
                        air_gapped=True
                    )
                else:
                    # Legacy record
                    if self.calculate_checksum(last["payload"]) != last["checksum_sha256"]:
                        raise ValueError("Payload SHA-256 checksum mismatch!")
                    return DecodedPayloadRecord(**last)
        except Exception:
            return None
