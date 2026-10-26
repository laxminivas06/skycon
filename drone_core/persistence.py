"""
Air-Gapped Local Persistence Store (JSON & SQLite)
"""

import json
import os
import sqlite3
import hashlib
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any, List


@dataclass
class DecodedPayloadRecord:
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

        existing_records.append(asdict(record))

        temp_path = f"{self.json_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(existing_records, f, indent=2)
        os.replace(temp_path, self.json_path)

        return record

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
        """Loads and verifies checksum of the latest saved payload."""
        if not os.path.exists(self.json_path):
            return None

        try:
            with open(self.json_path, "r", encoding="utf-8") as f:
                records = json.load(f)
                if not records:
                    return None
                last = records[-1]
                # Checksum integrity check
                if self.calculate_checksum(last["payload"]) != last["checksum_sha256"]:
                    raise ValueError("Payload SHA-256 checksum mismatch!")
                return DecodedPayloadRecord(**last)
        except Exception:
            return None
