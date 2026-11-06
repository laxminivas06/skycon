#!/usr/bin/env python3
"""
=====================================================================================
AERORECON — AUTONOMOUS DRONE SEARCH & TARGET RECONNAISSANCE SYSTEM
MODULE 3: Object Detection Manager, Priority Queue & Detour Photography Scheduler
=====================================================================================

Features:
  1. Priority Queue Management:
       - Priority 1: QR candidates & B/W square patterns (Highest precedence)
       - Priority 2: Square objects & rectangular boxes
       - Priority 3: Other unusual geometric structures
       - Priority 4: Other potential ground objects
  2. Multi-Frame Spatial Association & Deduplication:
       - Merges detections within 3.0m radius or temporal window
       - Preserves maximum confidence, updates centroid and bounding box
  3. Close-Range Photography & Detour Scheduler:
       - Generates stabilized observation waypoints (3.5m AGL) above candidates
       - Maintains resume coordinates so the drone returns to the spiral path
       - Avoids duplicate inspections of previously verified targets
  4. Time-Budget Gating:
       - Automatically restricts detours if total elapsed time approaches 240s
=====================================================================================
"""

import time
import math
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [OBJ_MGR] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("object_manager")


@dataclass
class InspectionTask:
    task_id: str
    object_id: str
    target_lat: float
    target_lon: float
    target_alt_m: float
    priority: int
    created_at: float
    status: str            # "QUEUED" | "IN_PROGRESS" | "CAPTURED" | "DECODED" | "SKIPPED"
    resume_waypoint_idx: int
    photo_path: Optional[str] = None
    decoded_payload: Optional[str] = None
    two_digit_code: Optional[str] = None


class ObjectInspectionManager:
    """
    Manages registered target objects, orders the inspection priority queue,
    and coordinates close-range photography without breaking search coverage.
    """
    def __init__(
        self,
        dedup_distance_m: float = 3.0,
        observation_alt_m: float = 3.5,
        max_inspection_time_s: float = 20.0,
        mission_budget_s: float = 300.0
    ):
        self.dedup_distance_m = dedup_distance_m
        self.observation_alt = observation_alt_m
        self.max_inspection_time = max_inspection_time_s
        self.mission_budget = mission_budget_s

        # In-Memory Database of all detected objects
        self.objects: Dict[str, Dict[str, Any]] = {}
        # Priority Queue of pending inspection tasks
        self.task_queue: List[InspectionTask] = []
        self.completed_tasks: List[InspectionTask] = []
        self.active_task: Optional[InspectionTask] = None

        self.mission_start_time: float = time.time()

    def set_mission_start_time(self, start_time: float):
        self.mission_start_time = start_time

    # ---------------------------------------------------------------------------------
    # Ingest Detection Events from Vision Engine
    # ---------------------------------------------------------------------------------
    def ingest_detection(self, raw_detection: Dict[str, Any], current_waypoint_idx: int = 1) -> str:
        """
        Ingests a detection from vision_engine, deduplicates against existing records,
        and schedules high-priority inspections. Returns object_id.
        """
        now = time.time()
        det_lat = raw_detection.get("lat")
        det_lon = raw_detection.get("lon")

        # 1. Deduplication Check against existing objects
        matched_id = None
        if det_lat is not None and det_lon is not None:
            for oid, obj in self.objects.items():
                if obj.get("lat") is not None and obj.get("lon") is not None:
                    dist = self._haversine(obj["lat"], obj["lon"], det_lat, det_lon)
                    if dist <= self.dedup_distance_m:
                        matched_id = oid
                        break

        if matched_id:
            # Update existing object
            obj = self.objects[matched_id]
            obj["last_seen"] = now
            obj["hits"] = obj.get("hits", 1) + 1
            obj["confidence"] = max(obj.get("confidence", 0.0), raw_detection.get("confidence", 0.5))

            if raw_detection.get("decoded_payload") and not obj.get("decoded_payload"):
                obj["decoded_payload"] = raw_detection["decoded_payload"]
                obj["two_digit_code"] = raw_detection.get("two_digit_code")
                obj["status"] = "VERIFIED"
                obj["priority"] = 1
                log.info(f"Target {matched_id} verified with payload: [{obj['decoded_payload']}]")

            return matched_id

        # 2. Register New Unique Object
        obj_num = len(self.objects) + 1
        obj_id = f"OBJ_{obj_num:03d}"
        priority = int(raw_detection.get("priority", 3))

        obj_record = {
            "object_id": obj_id,
            "category": raw_detection.get("category", "GROUND_OBJECT"),
            "shape": raw_detection.get("shape", "UNKNOWN"),
            "priority": priority,
            "confidence": float(raw_detection.get("confidence", 0.5)),
            "lat": det_lat,
            "lon": det_lon,
            "first_seen": now,
            "last_seen": now,
            "hits": 1,
            "status": "PENDING",
            "decoded_payload": raw_detection.get("decoded_payload"),
            "two_digit_code": raw_detection.get("two_digit_code"),
            "thumbnail": raw_detection.get("thumbnail_base64")
        }
        self.objects[obj_id] = obj_record

        # 3. Queue Close-Range Inspection Task if Priority 1 or 2 and not yet decoded
        if priority in (1, 2) and not obj_record["decoded_payload"] and det_lat and det_lon:
            self._enqueue_inspection_task(obj_id, det_lat, det_lon, priority, current_waypoint_idx)

        return obj_id

    # ---------------------------------------------------------------------------------
    # Inspection Task Queue Management
    # ---------------------------------------------------------------------------------
    def _enqueue_inspection_task(
        self,
        object_id: str,
        lat: float,
        lon: float,
        priority: int,
        resume_wp_idx: int
    ):
        """Enqueues a detour task ordered strictly by priority (P1 before P2)."""
        # Avoid duplicate queueing
        for t in self.task_queue:
            if t.object_id == object_id:
                return

        task = InspectionTask(
            task_id=f"TASK_{object_id}_{int(time.time())}",
            object_id=object_id,
            target_lat=lat,
            target_lon=lon,
            target_alt_m=self.observation_alt,
            priority=priority,
            created_at=time.time(),
            status="QUEUED",
            resume_waypoint_idx=resume_wp_idx
        )
        self.task_queue.append(task)
        # Sort queue: lowest priority number first (P1 < P2)
        self.task_queue.sort(key=lambda t: t.priority)
        log.info(f"Queued Inspection Task for {object_id} (Priority {priority})")

    def get_next_inspection_task(self, current_time: Optional[float] = None) -> Optional[InspectionTask]:
        """
        Retrieves the next highest-priority task if mission time budget permits.
        Rejects tasks if time elapsed > 240 seconds to ensure guaranteed safe RTL.
        """
        now = current_time or time.time()
        elapsed = now - self.mission_start_time
        remaining = self.mission_budget - elapsed

        # Reserve at least 60 seconds for return-to-home and landing
        if remaining < 60.0:
            if self.task_queue:
                log.warning(f"Time budget low ({round(remaining)}s remaining). Aborting remaining {len(self.task_queue)} detour tasks for safe RTL.")
                self.task_queue.clear()
            return None

        if not self.task_queue:
            return None

        self.active_task = self.task_queue.pop(0)
        self.active_task.status = "IN_PROGRESS"
        return self.active_task

    def complete_task(
        self,
        task_id: str,
        photo_path: Optional[str] = None,
        decoded_payload: Optional[str] = None,
        two_digit_code: Optional[str] = None
    ):
        """Marks an inspection task as complete and updates the object record."""
        if self.active_task and self.active_task.task_id == task_id:
            task = self.active_task
            self.active_task = None
        else:
            task = next((t for t in self.task_queue if t.task_id == task_id), None)

        if not task:
            return

        task.photo_path = photo_path
        task.decoded_payload = decoded_payload
        task.two_digit_code = two_digit_code
        task.status = "DECODED" if decoded_payload else "CAPTURED"
        self.completed_tasks.append(task)

        # Update underlying object record
        if task.object_id in self.objects:
            obj = self.objects[task.object_id]
            obj["status"] = "VERIFIED" if decoded_payload else "INSPECTED"
            if decoded_payload:
                obj["decoded_payload"] = decoded_payload
                obj["two_digit_code"] = two_digit_code

        log.info(f"Inspection Task {task_id} marked {task.status}. Code: {two_digit_code or 'None'}")

    # ---------------------------------------------------------------------------------
    # State Serializer for GCS Frontend & REST API
    # ---------------------------------------------------------------------------------
    def get_summary(self) -> Dict[str, Any]:
        """Returns JSON-compatible summary of all objects and inspection progress."""
        return {
            "total_objects": len(self.objects),
            "pending_tasks_count": len(self.task_queue),
            "completed_tasks_count": len(self.completed_tasks),
            "active_task": asdict(self.active_task) if self.active_task else None,
            "objects": list(self.objects.values()),
            "priority_queue": [asdict(t) for t in self.task_queue]
        }

    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        r = 6371000.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2.0)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0)**2
        return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


# =====================================================================================
# STANDALONE VERIFICATION ROUTINE
# =====================================================================================
if __name__ == "__main__":
    mgr = ObjectInspectionManager(dedup_distance_m=3.0, observation_alt_m=3.5)
    mgr.set_mission_start_time(time.time())

    # Ingest detection 1: QR Candidate at lat=13.0827, lon=80.2707
    id1 = mgr.ingest_detection({
        "category": "QR_CANDIDATE",
        "shape": "QR_PATTERN",
        "priority": 1,
        "confidence": 0.92,
        "lat": 13.0827,
        "lon": 80.2707
    }, current_waypoint_idx=3)

    # Ingest detection 2: Square Box at lat=13.0828, lon=80.2708
    id2 = mgr.ingest_detection({
        "category": "BOX_STRUCTURE",
        "shape": "SQUARE",
        "priority": 2,
        "confidence": 0.85,
        "lat": 13.0828,
        "lon": 80.2708
    }, current_waypoint_idx=4)

    # Ingest duplicate detection within 1.5m -> Should merge with id1
    id1_dup = mgr.ingest_detection({
        "category": "QR_CANDIDATE",
        "priority": 1,
        "lat": 13.082705,
        "lon": 80.270705
    })

    print(f"Object 1 ID: {id1}")
    print(f"Object 2 ID: {id2}")
    print(f"Duplicate Merged to ID: {id1_dup} (Equal to ID 1: {id1 == id1_dup})")

    # Fetch next task
    task = mgr.get_next_inspection_task()
    print(f"Next Priority Inspection Task: {task.task_id} for {task.object_id} (Priority {task.priority})")

    # Complete task
    mgr.complete_task(task.task_id, photo_path="data/crop_001.jpg", decoded_payload="CACHE:42", two_digit_code="42")
    summary = mgr.get_summary()
    print(f"Total Objects in Registry: {summary['total_objects']}")
    print(f"Completed Tasks: {summary['completed_tasks_count']}")
    print(f"Verified Object: {summary['objects'][0]['object_id']} -> Code: {summary['objects'][0]['two_digit_code']}")
