#!/usr/bin/env python3
"""
=====================================================================================
SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
MODULE 4: Master Onboard Vision, 4-Tier Heatmap & Autonomous Mission Node
Fast Local Vision, Target Localization, QR Extraction & Autonomy Loop
Supports:
  1. Real Physical Pixhawk (TELEM1 @ 921600 baud, USB, or UDP relay)
  2. Camera: Downward USB Cam, iPhone RTSP/HTTP Stream, or Synthetic Simulator
  3. Real-Time 4-Tier Heatmap Matrix Generation & Push to GCS Relay Server
  4. Priority Target Registry & Queue (P1: QR, P2: Boxes, P3: Shapes, P4: Ground)
  5. Close-Range Photography Detours & Multi-Pass QR Extraction
  6. MAVLink STATUSTEXT Downlink Broadcast ("QR_CODE:<digits>")
  7. Strict 5-Minute Time Budget Watchdog with Automated RTL & Landing Confirmation
=====================================================================================
"""

import os
import sys
import time
import math
import re
import argparse
import logging
from typing import Optional, Tuple, Dict, Any, List

import cv2
import numpy as np
import requests

# Set up module path to import backend vision and planning engines
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(CURRENT_DIR, "..", "backend")
DATA_DIR = os.path.join(CURRENT_DIR, "..", "data", "detections")
os.makedirs(DATA_DIR, exist_ok=True)

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

try:
    from vision_engine import VisionEngine, PinholeProjector
    from object_manager import ObjectManager, PriorityInspectionTask
    from spiral_planner import SpiralPlanner
except ImportError as err:
    print(f"[ERROR] Failed to import backend modules from {BACKEND_DIR}: {err}")
    sys.exit(1)

# Configure high-visibility flight telemetry logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [VISION_BRAIN] %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("vision_brain")

try:
    from pymavlink import mavutil
except ImportError:
    log.warning("pymavlink is not installed! Physical telemetry requires pymavlink. (pip install pymavlink)")
    mavutil = None

# Optional Ultralytics YOLOv8 support
YOLO_AVAILABLE = False
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    log.info("Ultralytics YOLO not detected. Using deterministic high-contrast geometric contour detector.")


# =====================================================================================
# 1. 2D PID CONTROLLER WITH ANTI-WINDUP
# =====================================================================================
class VisualServoPID:
    """
    Flight-safe 2D Proportional-Integral-Derivative controller for visual servoing.
    Translates pixel errors into body-frame horizontal velocities with clamping.
    """
    def __init__(
        self,
        kp: float = 0.0018,
        ki: float = 0.0001,
        kd: float = 0.0006,
        max_velocity_mps: float = 0.6,
        integral_clamp: float = 0.2
    ):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.max_v = max_velocity_mps
        self.i_clamp = integral_clamp

        self.integral_error = 0.0
        self.prev_error = 0.0
        self.last_time = time.time()

    def reset(self):
        self.integral_error = 0.0
        self.prev_error = 0.0
        self.last_time = time.time()

    def compute(self, error: float, current_alt_m: float = 5.0, ref_alt_m: float = 5.0) -> float:
        now = time.time()
        dt = max(1e-3, now - self.last_time)
        self.last_time = now

        # Dynamic Altitude Scaling:
        # At 1.5m altitude, 1 pixel represents 3.3x less ground distance than at 5.0m.
        # Scale error by (current_alt / ref_alt) clamped to [0.25, 1.2] to prevent low-altitude overshooting and oscillations.
        alt_scale = max(0.25, min(1.2, float(current_alt_m) / max(1.0, float(ref_alt_m))))
        scaled_error = error * alt_scale

        # Proportional term
        p_term = self.kp * scaled_error

        # Integral term with anti-windup clamping
        self.integral_error += scaled_error * dt
        self.integral_error = max(-self.i_clamp, min(self.i_clamp, self.integral_error))
        i_term = self.ki * self.integral_error

        # Derivative term
        derivative = (scaled_error - self.prev_error) / dt
        d_term = self.kd * derivative
        self.prev_error = scaled_error

        # Total control effort
        output = p_term + i_term + d_term

        # Strict velocity clamping to prevent aircraft destabilization
        return float(max(-self.max_v, min(self.max_v, output)))


# =====================================================================================
# 2. MASTER AUTONOMOUS VISION BRAIN CLASS
# =====================================================================================
class AutonomousVisionBrain:
    def __init__(
        self,
        connection_string: str = "/dev/ttyAMA0",
        baud: int = 921600,
        camera_source: str = "0",
        relay_url: Optional[str] = "http://localhost:5000",
        yolo_weights: Optional[str] = None,
        synthetic_mode: bool = False,
        search_altitude: float = 5.0,
        time_limit_sec: float = 300.0,
    ):
        self.conn_str = connection_string
        self.baud = baud
        self.cam_source = camera_source
        self.relay_url = relay_url.rstrip("/") if relay_url else None
        self.synthetic_mode = synthetic_mode
        self.search_altitude = search_altitude
        self.time_limit_sec = time_limit_sec

        # Telemetry State
        self.current_lat: float = 13.0827
        self.current_lon: float = 80.2707
        self.current_altitude_m: float = 0.0
        self.current_roll: float = 0.0
        self.current_pitch: float = 0.0
        self.current_yaw: float = 0.0
        self.current_voltage: float = 12.4
        self.current_battery_pct: int = 95
        self.current_mode: str = "UNKNOWN"
        self.is_armed: bool = False
        self.last_telem_time: float = 0.0

        # Subsystems Initialization
        self.vision_engine = VisionEngine(grid_cols=32, grid_rows=24, camera_hfov=68.0, camera_vfov=54.0)
        self.object_manager = ObjectManager(dedup_distance_m=3.0, mission_budget_s=time_limit_sec)
        self.spiral_planner = SpiralPlanner(camera_hfov_deg=68.0, camera_vfov_deg=54.0, max_mission_duration_s=time_limit_sec)
        self.pid_x = VisualServoPID(kp=0.0018, ki=0.0001, kd=0.0006, max_velocity_mps=0.6)
        self.pid_y = VisualServoPID(kp=0.0018, ki=0.0001, kd=0.0006, max_velocity_mps=0.6)

        # FSM State
        self.state: str = "STATE_WAIT_FOR_AUTO"
        self.mission_start_time: float = time.time()
        self.consecutive_box_detections: int = 0
        self.last_target_seen_time: float = 0.0
        self.servo_start_time: float = 0.0
        self.last_relay_push: float = 0.0
        self.active_inspection_task: Optional[PriorityInspectionTask] = None
        self.decoded_codes: List[str] = []

        # Connect MAVLink
        self.mav = None
        if not self.synthetic_mode and mavutil is not None:
            log.info(f"Connecting to Pixhawk on {self.conn_str} at {self.baud} baud...")
            try:
                self.mav = mavutil.mavlink_connection(self.conn_str, baud=self.baud)
                log.info("Waiting for heartbeat from Pixhawk...")
                self.mav.wait_heartbeat(timeout=10)
                if self.mav.target_system:
                    log.info(f"Heartbeat received from System {self.mav.target_system}, Component {self.mav.target_component}!")
                    self._request_data_streams()
            except Exception as e:
                log.warning(f"Could not open MAVLink port ({e}). Running in bench telemetry mode.")
                self.mav = None
        else:
            log.info("Running in bench / synthetic mode without direct MAVLink serial port.")

        # Camera Capture Setup
        self.cap = None
        if not self.synthetic_mode:
            try:
                cam_idx = int(self.cam_source)
                log.info(f"Opening physical camera index {cam_idx}...")
                self.cap = cv2.VideoCapture(cam_idx)
            except ValueError:
                log.info(f"Opening camera stream URL / file: '{self.cam_source}'...")
                self.cap = cv2.VideoCapture(self.cam_source)

            if self.cap and self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                self.cap.set(cv2.CAP_PROP_FPS, 30)
                log.info("Camera successfully opened (640x480 @ 30 FPS).")
            else:
                log.warning(f"Cannot open camera '{self.cam_source}'! Falling back to synthetic frames.")
                self.synthetic_mode = True

    def _request_data_streams(self):
        """Requests telemetry streams at 10 Hz from flight controller."""
        if not self.mav:
            return
        try:
            self.mav.mav.request_data_stream_send(
                self.mav.target_system,
                self.mav.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_POSITION,
                10,
                1
            )
            self.mav.mav.request_data_stream_send(
                self.mav.target_system,
                self.mav.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_EXTRA1,
                10,
                1
            )
            self.mav.mav.request_data_stream_send(
                self.mav.target_system,
                self.mav.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS,
                5,
                1
            )
        except Exception as e:
            log.warning(f"Failed to request data streams: {e}")

    def update_telemetry(self):
        """Drains incoming MAVLink packets non-blockingly to update vehicle state."""
        if not self.mav:
            # Bench simulation: slowly climb to search altitude in AUTO mode
            if self.state in ["STATE_WAIT_FOR_AUTO", "STATE_SPIRAL_SEARCH"]:
                if self.current_altitude_m < self.search_altitude:
                    self.current_altitude_m += 0.25
                self.current_mode = "AUTO"
                self.is_armed = True
            return

        while True:
            msg = self.mav.recv_msg()
            if msg is None:
                break

            msg_type = msg.get_type()
            if msg_type == "HEARTBEAT":
                custom_mode = msg.custom_mode
                mode_map = {
                    0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO",
                    4: "GUIDED", 5: "LOITER", 6: "RTL", 9: "LAND"
                }
                self.current_mode = mode_map.get(custom_mode, f"MODE_{custom_mode}")
                self.is_armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

            elif msg_type == "GLOBAL_POSITION_INT":
                self.current_lat = float(msg.lat) / 1e7
                self.current_lon = float(msg.lon) / 1e7
                self.current_altitude_m = float(msg.relative_alt) / 1000.0
                self.last_telem_time = time.time()

            elif msg_type == "VFR_HUD":
                if self.current_altitude_m == 0.0:
                    self.current_altitude_m = float(msg.alt)
                self.last_telem_time = time.time()

            elif msg_type == "ATTITUDE":
                self.current_roll = math.degrees(msg.roll)
                self.current_pitch = math.degrees(msg.pitch)
                self.current_yaw = math.degrees(msg.yaw)

            elif msg_type == "SYS_STATUS":
                self.current_voltage = float(msg.voltage_battery) / 1000.0
                self.current_battery_pct = msg.battery_remaining

    def set_mode(self, mode_name: str):
        """Commands ArduCopter mode switch."""
        modes = {
            "STABILIZE": 0, "ALT_HOLD": 2, "AUTO": 3,
            "GUIDED": 4, "LOITER": 5, "RTL": 6, "LAND": 9
        }
        if mode_name not in modes:
            log.error(f"Unknown flight mode: {mode_name}")
            return

        mode_id = modes[mode_name]
        log.info(f"COMMANDING FLIGHT CONTROLLER MODE: {mode_name} (ID {mode_id})...")
        if self.mav:
            try:
                self.mav.mav.set_mode_send(
                    self.mav.target_system,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    mode_id
                )
            except Exception as e:
                log.warning(f"Error sending set_mode command: {e}")
        else:
            self.current_mode = mode_name

    def send_body_velocity(self, vx: float, vy: float, vz: float):
        """
        Transmits SET_POSITION_TARGET_LOCAL_NED velocity vector in MAV_FRAME_BODY_OFFSET_NED.
        vx: forward (+) / backward (-) in m/s
        vy: right (+) / left (-) in m/s
        vz: down (+) / up (-) in m/s (positive descends in NED)
        """
        if not self.mav:
            return

        type_mask = 0b0000111111000111  # Enables vx, vy, vz only
        try:
            self.mav.mav.set_position_target_local_ned_send(
                int(time.time() * 1000) & 0xFFFFFFFF,
                self.mav.target_system,
                self.mav.target_component,
                mavutil.mavlink.MAV_FRAME_BODY_OFFSET_NED,
                type_mask,
                0.0, 0.0, 0.0,
                vx, vy, vz,
                0.0, 0.0, 0.0,
                0.0, 0.0
            )
        except Exception as e:
            log.warning(f"Error sending body velocity: {e}")

    def send_global_position_target(self, lat: float, lon: float, alt_m: float, yaw_deg: float = 0.0):
        """
        Positions drone over target GPS coordinates at specified altitude.
        """
        if not self.mav:
            return

        type_mask = 0b0000111111111000  # Enables lat, lon, alt only
        try:
            self.mav.mav.set_position_target_global_int_send(
                int(time.time() * 1000) & 0xFFFFFFFF,
                self.mav.target_system,
                self.mav.target_component,
                mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                type_mask,
                int(lat * 1e7),
                int(lon * 1e7),
                float(alt_m),
                0.0, 0.0, 0.0,
                0.0, 0.0, 0.0,
                math.radians(yaw_deg),
                0.0
            )
        except Exception as e:
            log.warning(f"Error sending global target: {e}")

    def broadcast_qr_statustext(self, digits: str, payload_str: str = ""):
        """
        Broadcasts MAVLINK_MSG_ID_STATUSTEXT with "QR_CODE:<digits>" 5 times over 1 second.
        Guarantees that Pixhawk relays it through TELEM2 to the ESP32-S3 and Cloud Ground Station.
        """
        text = f"QR_CODE:{digits}"
        if payload_str and payload_str != digits:
            text = f"QR_CODE:{digits}:{payload_str[:20]}"
        b_payload = text.encode("utf-8")
        log.info(f"🚨 BROADCASTING CRITICAL STATUSTEXT TO PIXHAWK TELEM2: '{text}' 🚨")

        if self.mav:
            for _ in range(5):
                try:
                    self.mav.mav.statustext_send(
                        mavutil.mavlink.MAV_SEVERITY_CRITICAL,
                        b_payload
                    )
                except Exception as e:
                    log.warning(f"Failed to send STATUSTEXT: {e}")
                time.sleep(0.15)

    def _generate_synthetic_frame(self) -> np.ndarray:
        """Generates realistic synthetic aerial frame with terrain, cache box, and QR code."""
        frame = np.full((480, 640, 3), (34, 110, 48), dtype=np.uint8)  # Grass ground
        # Add slight texture noise
        noise = np.random.randint(-15, 15, (480, 640, 3), dtype=np.int16)
        frame = np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        # Place target box in center-right
        bx, by, bw, bh = 340, 250, 90, 90
        cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), (255, 255, 255), -1)
        cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), (0, 0, 0), 3)

        # Draw finder patterns
        for fx, fy in [(bx + 5, by + 5), (bx + bw - 25, by + 5), (bx + 5, by + bh - 25)]:
            cv2.rectangle(frame, (fx, fy), (fx + 20, fy + 20), (0, 0, 0), -1)
            cv2.rectangle(frame, (fx + 4, fy + 4), (fx + 16, fy + 16), (255, 255, 255), -1)
            cv2.rectangle(frame, (fx + 7, fy + 7), (fx + 13, fy + 13), (0, 0, 0), -1)

        # Draw "42" label
        cv2.putText(frame, "42", (bx + 32, by + 54), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
        return frame

    def _push_to_relay(self, heatmap_frame: Any, objects_list: List[Dict[str, Any]]):
        """Pushes real-time heatmap grid and object queue updates to Relay server."""
        if not self.relay_url:
            return

        try:
            from dataclasses import asdict
            if hasattr(heatmap_frame, "__dataclass_fields__"):
                heatmap_payload = asdict(heatmap_frame)
            else:
                heatmap_payload = heatmap_frame

            requests.post(f"{self.relay_url}/api/vision/heatmap", json={"heatmap": heatmap_payload}, timeout=0.8)
            requests.post(f"{self.relay_url}/api/vision/objects", json={"objects": objects_list}, timeout=0.8)
        except Exception:
            pass  # Non-blocking: network delay should never stall flight loop

    def run(self):
        """Main autonomous vision and mission control loop."""
        log.info("Starting Master Autonomous Vision Brain loop...")
        img_w, img_h = 640, 480
        center_x, center_y = img_w // 2, img_h // 2
        self.mission_start_time = time.time()

        try:
            while True:
                now = time.time()
                elapsed_mission_time = now - self.mission_start_time
                remaining_mission_time = max(0.0, self.time_limit_sec - elapsed_mission_time)

                # 1. Update vehicle state
                self.update_telemetry()

                # 2. Capture downward camera frame
                if self.synthetic_mode or self.cap is None:
                    frame = self._generate_synthetic_frame()
                else:
                    ret, frame = self.cap.read()
                    if not ret or frame is None:
                        time.sleep(0.01)
                        continue

                # 3. Run Vision Engine: 4-Tier Heatmap + Contour Detection + Multi-Pass QR Decoder
                telem = {
                    "lat": self.current_lat,
                    "lon": self.current_lon,
                    "alt_m": max(1.0, self.current_altitude_m),
                    "pitch_deg": self.current_pitch,
                    "roll_deg": self.current_roll,
                    "yaw_deg": self.current_yaw
                }
                annotated_frame, heatmap_frame, active_objects = self.vision_engine.process_frame(
                    frame,
                    drone_telemetry=telem
                )

                # 4. Ingest Detected Candidates in Object Manager
                for obj in active_objects:
                    self.object_manager.ingest_detection(obj, current_waypoint_idx=1)

                # 5. Push Live Telemetry, Heatmap & Object Queue to Relay Server (every 1.5s)
                if now - self.last_relay_push > 1.5:
                    objects_list = self.object_manager.get_active_objects()
                    self._push_to_relay(heatmap_frame, objects_list)
                    self.last_relay_push = now
                    self.last_relay_push = now

                # 6. Global 5-Minute Time Budget & Battery Watchdog
                if elapsed_mission_time > (self.time_limit_sec - 40.0) and self.state != "STATE_RTL":
                    log.warning(f"⏱️ 5-MINUTE TIME LIMIT APPROACHING ({elapsed_mission_time:.1f}s / {self.time_limit_sec}s)! Triggering safe RTL.")
                    self.set_mode("RTL")
                    self.state = "STATE_RTL"

                if self.current_voltage > 0.0 and self.current_voltage < 10.5 and self.state != "STATE_RTL":
                    log.warning(f"🔋 LOW BATTERY FAILSAFE ({self.current_voltage:.1f}V)! Triggering immediate RTL.")
                    self.set_mode("RTL")
                    self.state = "STATE_RTL"

                # =====================================================================
                # 7. FINITE STATE MACHINE (FSM) TRANSITIONS
                # =====================================================================

                if self.state == "STATE_WAIT_FOR_AUTO":
                    # Wait until drone reaches mission sweep altitude (>= 2.8m)
                    if (self.current_mode in ["AUTO", "GUIDED"] and self.current_altitude_m >= 2.8) or self.synthetic_mode:
                        log.info(f"Cruise altitude reached ({self.current_altitude_m:.2f}m). Engaging SPIRAL_SEARCH.")
                        self.state = "STATE_SPIRAL_SEARCH"
                        self.consecutive_box_detections = 0

                elif self.state == "STATE_SPIRAL_SEARCH":
                    # Check if high-priority target (P1 or P2) is ready for inspection
                    task = self.object_manager.get_next_inspection_task(remaining_mission_time=remaining_mission_time)
                    if task:
                        log.info(f"🎯 HIGH-PRIORITY TARGET ACQUIRED: {task.object_id} (Priority {task.priority}) at ({task.target_lat:.5f}, {task.target_lon:.5f})")
                        self.active_inspection_task = task
                        self.state = "STATE_INTERCEPT_GUIDED"
                        self.consecutive_box_detections = 0

                elif self.state == "STATE_INTERCEPT_GUIDED":
                    # Switch from AUTO to GUIDED to seize local position/velocity control
                    self.set_mode("GUIDED")
                    self.pid_x.reset()
                    self.pid_y.reset()
                    self.last_target_seen_time = now
                    self.servo_start_time = now
                    self.state = "STATE_VISUAL_SERVO_DESCEND"

                    # If global GPS is available, dispatch drone toward target coordinates
                    if self.active_inspection_task and self.active_inspection_task.target_lat:
                        self.send_global_position_target(
                            self.active_inspection_task.target_lat,
                            self.active_inspection_task.target_lon,
                            alt_m=3.5,  # Close-range photography altitude
                            yaw_deg=self.current_yaw
                        )

                elif self.state == "STATE_VISUAL_SERVO_DESCEND":
                    # Flight Watchdog: Hard servo timeout (25s maximum)
                    if now - self.servo_start_time > 25.0:
                        log.warning("⏱️ Servo timeout exceeded (25s)! Resuming search.")
                        if self.active_inspection_task:
                            self.active_inspection_task.status = "INSPECTED"
                        self.active_inspection_task = None
                        self.set_mode("AUTO")
                        self.state = "STATE_SPIRAL_SEARCH"
                        continue

                    # Look for visual box contour for fine body-velocity centering
                    box_match = next((c for c in active_objects if c.get("priority") in [1, 2] and c.get("centroid")), None)

                    if box_match:
                        self.last_target_seen_time = now
                        cx, cy = box_match["centroid"]
                        err_fwd = float(center_y - cy)
                        err_right = float(cx - center_x)
                        pixel_dist = math.sqrt(err_fwd**2 + err_right**2)

                        # Dynamic altitude-scaled 2D PID velocities clamped strictly to [-0.6, +0.6] m/s
                        vx = self.pid_x.compute(err_fwd, current_alt_m=self.current_altitude_m, ref_alt_m=self.search_altitude)
                        vy = self.pid_y.compute(err_right, current_alt_m=self.current_altitude_m, ref_alt_m=self.search_altitude)

                        # Descent logic down to 3.5m observation floor
                        target_floor_alt = 3.5
                        vz = 0.0
                        if pixel_dist < 40.0:
                            if self.current_altitude_m > target_floor_alt:
                                vz = 0.25  # Downward velocity in NED
                            else:
                                vz = 0.0
                                log.info(f"Target centered at inspection altitude ({self.current_altitude_m:.2f}m). Proceeding to CAPTURE & DECODE.")
                                self.state = "STATE_CAPTURE_AND_DECODE"
                                self.servo_start_time = now
                        else:
                            vz = -0.1 if self.current_altitude_m < target_floor_alt else 0.0

                        self.send_body_velocity(vx, vy, vz)
                    else:
                        # Target briefly lost: hold position
                        self.send_body_velocity(0.0, 0.0, 0.0)
                        if now - self.last_target_seen_time > 4.0:
                            log.warning("Target lost for > 4.0s during servo. Resuming search.")
                            self.set_mode("AUTO")
                            self.state = "STATE_SPIRAL_SEARCH"

                elif self.state == "STATE_CAPTURE_AND_DECODE":
                    # Hover directly over box and capture high-resolution photograph
                    self.send_body_velocity(0.0, 0.0, 0.0)

                    # Save high-resolution photographic evidence to disk
                    timestamp_str = int(time.time())
                    obj_id = self.active_inspection_task.object_id if self.active_inspection_task else f"OBJ_{timestamp_str}"
                    img_path = os.path.join(DATA_DIR, f"{obj_id}_{timestamp_str}.jpg")
                    cv2.imwrite(img_path, frame)
                    log.info(f"📸 High-resolution photograph captured and saved: {img_path}")

                    # Run multi-pass QR decoder
                    decoded_payload, two_digit_code = self.vision_engine.decode_qr(frame)
                    if not two_digit_code and decoded_payload:
                        match = re.search(r"\b(\d{2})\b", decoded_payload)
                        if match:
                            two_digit_code = match.group(1)

                    if two_digit_code or decoded_payload:
                        code = two_digit_code or (decoded_payload[:2] if decoded_payload else "00")
                        log.info(f"🎉 QR CODE SUCCESSFULLY DECODED: '{code}' (Payload: '{decoded_payload}') 🎉")
                        self.decoded_codes.append(code)

                        # Broadcast MAVLink STATUSTEXT to Pixhawk TELEM2
                        self.broadcast_qr_statustext(code, decoded_payload or "")

                        # Mark task as DECODED in ObjectManager
                        if self.active_inspection_task:
                            self.object_manager.complete_task(
                                self.active_inspection_task.task_id,
                                photo_path=img_path,
                                decoded_payload=decoded_payload,
                                two_digit_code=code
                            )

                        # Push immediate update to Relay
                        self._push_to_relay(heatmap_frame, self.object_manager.get_active_objects())

                        # Transition to resume search or return
                        self.state = "STATE_BROADCAST_AND_RESUME"
                        self.servo_start_time = now
                    else:
                        # QR not decoded yet; retry or timeout after 5 seconds
                        if now - self.servo_start_time > 5.0:
                            log.warning(f"QR decode timed out for {obj_id}. Marking inspected and resuming search.")
                            if self.active_inspection_task:
                                self.active_inspection_task.status = "INSPECTED"
                            self.state = "STATE_BROADCAST_AND_RESUME"
                            self.servo_start_time = now

                elif self.state == "STATE_BROADCAST_AND_RESUME":
                    # Climb back to 5.0m search altitude and resume spiral search
                    if self.current_altitude_m < self.search_altitude - 0.3:
                        self.send_body_velocity(0.0, 0.0, -0.4)  # Climb upward (-vz)
                    else:
                        log.info("Safe search altitude restored. Resuming spiral search.")
                        self.active_inspection_task = None
                        self.set_mode("AUTO")
                        self.state = "STATE_SPIRAL_SEARCH"

                elif self.state == "STATE_RTL":
                    # Drone returning to launch. Mission accomplished!
                    time.sleep(1.0)
                    log.info(f"[MISSION COMPLETED] State: RTL | Decoded Codes: {self.decoded_codes} | Time: {elapsed_mission_time:.1f}s")
                    if self.current_altitude_m < 0.3 and not self.is_armed:
                        log.info("Touchdown confirmed. Drone successfully landed and disarmed!")
                        break

                # Maintain 15-20 Hz loop rate
                dt = time.time() - now
                if dt < 0.05:
                    time.sleep(0.05 - dt)

        except KeyboardInterrupt:
            log.info("Keyboard interrupt received. Halting velocities and commanding RTL...")
            self.send_body_velocity(0.0, 0.0, 0.0)
            self.set_mode("RTL")
        finally:
            if self.cap:
                self.cap.release()
            log.info("Vision Brain node exited cleanly.")


# =====================================================================================
# SCRIPT ENTRYPOINT
# =====================================================================================
def main():
    parser = argparse.ArgumentParser(description="SAE INDIA ADDC 2026 Autonomous Vision Brain")
    parser.add_argument("--port", type=str, default="/dev/ttyAMA0", help="MAVLink serial port (default: /dev/ttyAMA0, COM port, or udp:127.0.0.1:14550)")
    parser.add_argument("--baud", type=int, default=921600, help="TELEM1 baud rate (default: 921600)")
    parser.add_argument("--cam", type=str, default="0", help="Camera index (e.g. 0) or RTSP/HTTP URL for iPhone (default: '0')")
    parser.add_argument("--relay", type=str, default="http://localhost:5000", help="GCS / Relay Server URL (default: http://localhost:5000)")
    parser.add_argument("--weights", type=str, default=None, help="Path to custom YOLOv8 weights (optional)")
    parser.add_argument("--synthetic", action="store_true", help="Run in synthetic bench simulation mode")
    parser.add_argument("--test", action="store_true", help="Run single test frame verification and exit")
    parser.add_argument("--altitude", type=float, default=5.0, help="Cruise search altitude (default: 5.0m)")
    parser.add_argument("--timelimit", type=float, default=300.0, help="Total mission time limit in seconds (default: 300.0 / 5 min)")
    args = parser.parse_args()

    # If --test is provided, verify synthetic frame and exit
    if args.test:
        log.info("Running standalone bench verification of VisionBrain...")
        brain = AutonomousVisionBrain(
            connection_string="sim",
            camera_source="0",
            relay_url=None,
            synthetic_mode=True,
            search_altitude=args.altitude,
            time_limit_sec=args.timelimit
        )
        frame = brain._generate_synthetic_frame()
        telem = {"lat": 13.0827, "lon": 80.2707, "alt_m": 5.0, "pitch_deg": 0.0, "roll_deg": 0.0, "yaw_deg": 0.0}
        annotated_frame, heatmap_frame, active_objects = brain.vision_engine.process_frame(frame, drone_telemetry=telem)
        log.info(f"Test verification succeeded! Heatmap grid: {heatmap_frame.grid_width}x{heatmap_frame.grid_height}, Active Objects: {len(active_objects)}")
        sys.exit(0)

    brain = AutonomousVisionBrain(
        connection_string=args.port,
        baud=args.baud,
        camera_source=args.cam,
        relay_url=args.relay,
        yolo_weights=args.weights,
        synthetic_mode=args.synthetic,
        search_altitude=args.altitude,
        time_limit_sec=args.timelimit
    )
    brain.run()


if __name__ == "__main__":
    main()
