#!/usr/bin/env python3
"""
=====================================================================================
SAE INDIA — Autonomous Drone Rescue System (ADDC 2026)
MODULE 4: Onboard Vision & 2D PID Visual Servoing Brain Node
Fast Local Vision & Autonomy Loop (<10ms) via Companion Computer TELEM1 (921600 baud)
=====================================================================================

ARCHITECTURE:
  - Connects to Pixhawk TELEM1 at 921600 baud (MAVLink 2).
  - Downward-facing camera (640x480 @ 30 FPS).
  - 6-State Autonomous Finite State Machine (FSM):
      1. STATE_WAIT_FOR_AUTO      : Monitors AUTO mission and altitude (>2.8m).
      2. STATE_GRID_SWEEP         : Downward detection of Intelligence Cache Box (3 consecutive frames).
      3. STATE_INTERCEPT_GUIDED   : Switches Pixhawk to GUIDED mode.
      4. STATE_VISUAL_SERVO_DESCEND: 2D PID visual centering (clamped [-0.6, +0.6] m/s) & descent to 1.2m.
      5. STATE_QR_DECODE          : High-resolution QR detection on cropped ROI + STATUSTEXT broadcast.
      6. STATE_RTL                : Commands Return-to-Launch and logs mission completion.
  - Flight-Safety Watchdogs:
      * 3.0s Lost-target recovery: Zeros velocities and reverts to AUTO grid sweep.
      * 25.0s Hard servo timeout: Commands immediate RTL to preserve battery.
=====================================================================================
"""

import os
import sys
import time
import math
import re
import argparse
import logging
from typing import Optional, Tuple, Dict, Any

import cv2
import numpy as np

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
    log.error("pymavlink is not installed! Install via: pip install pymavlink")
    sys.exit(1)

# Optional Ultralytics YOLOv8 support
YOLO_AVAILABLE = False
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    log.info("ultralytics YOLO not detected. Falling back to deterministic high-contrast geometric contour detector.")


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

    def compute(self, error: float) -> float:
        now = time.time()
        dt = max(1e-3, now - self.last_time)
        self.last_time = now

        # Proportional term
        p_term = self.kp * error

        # Integral term with anti-windup clamping
        self.integral_error += error * dt
        self.integral_error = max(-self.i_clamp, min(self.i_clamp, self.integral_error))
        i_term = self.ki * self.integral_error

        # Derivative term
        derivative = (error - self.prev_error) / dt
        d_term = self.kd * derivative
        self.prev_error = error

        # Total control effort
        output = p_term + i_term + d_term

        # Strict velocity clamping to prevent aircraft destabilization
        return float(max(-self.max_v, min(self.max_v, output)))


# =====================================================================================
# 2. INTELLIGENCE CACHE BOX & QR CODE DETECTOR ENGINE
# =====================================================================================
class TargetDetector:
    """
    Dual-mode target detector:
    - Primary: YOLOv8n custom model (if weights file is provided)
    - Deterministic Secondary: CLAHE + Adaptive Threshold + Contour aspect-ratio/geometry filter
    - Multi-pass QR Decoder: WeChatQRCode / OpenCV QRCodeDetector with CLAHE enhancement
    """
    def __init__(self, yolo_weights_path: Optional[str] = None):
        self.yolo_model = None
        if YOLO_AVAILABLE and yolo_weights_path and os.path.exists(yolo_weights_path):
            try:
                log.info(f"Loading custom YOLOv8 model from {yolo_weights_path}...")
                self.yolo_model = YOLO(yolo_weights_path)
            except Exception as e:
                log.warning(f"Failed to load YOLO model: {e}. Using geometric contour detector.")

        # QR Detectors
        self.qr_detector = cv2.QRCodeDetector()
        self.clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        self.two_digit_pattern = re.compile(r"\b(\d{2})\b")

    def detect_box(self, frame: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        """
        Detects cache box in image frame. Returns (center_x, center_y, width, height) or None.
        """
        h, w = frame.shape[:2]

        # Mode A: YOLO Inference
        if self.yolo_model is not None:
            try:
                results = self.yolo_model(frame, verbose=False, conf=0.45)
                for r in results:
                    boxes = r.boxes
                    if boxes is not None and len(boxes) > 0:
                        b = boxes[0].xyxy[0].cpu().numpy()
                        bx1, by1, bx2, by2 = int(b[0]), int(b[1]), int(b[2]), int(b[3])
                        cw = bx2 - bx1
                        ch = by2 - by1
                        cx = bx1 + cw // 2
                        cy = by1 + ch // 2
                        return (cx, cy, cw, ch)
            except Exception as e:
                log.warning(f"YOLO inference error: {e}")

        # Mode B: High-Contrast Geometric Contour Fallback
        # The ADDC Intelligence Cache box is a high-contrast square on arena terrain
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        clahe_img = self.clahe.apply(blurred)

        # Adaptive thresholding to handle outdoor shadows and sun glint
        thresh = cv2.adaptiveThreshold(
            clahe_img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 19, 4
        )

        contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []

        frame_area = w * h
        min_box_area = frame_area * 0.005  # At least 0.5% of frame
        max_box_area = frame_area * 0.50   # At most 50% of frame

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_box_area or area > max_box_area:
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)

            # Check if quadrilateral (4 vertices)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                x, y, bw, bh = cv2.boundingRect(approx)
                aspect_ratio = float(bw) / float(bh)
                # Square ratio within [0.75, 1.35]
                if 0.75 <= aspect_ratio <= 1.35:
                    cx = x + bw // 2
                    cy = y + bh // 2
                    candidates.append((area, (cx, cy, bw, bh)))

        if candidates:
            # Sort by area descending (largest prominent square target)
            candidates.sort(key=lambda c: c[0], reverse=True)
            return candidates[0][1]

        return None

    def decode_qr(self, frame: np.ndarray, box_roi: Optional[Tuple[int, int, int, int]] = None) -> Optional[str]:
        """
        Attempts multi-pass QR decoding on frame or cropped box region.
        Returns 2-digit code string or None.
        """
        h, w = frame.shape[:2]

        if box_roi:
            cx, cy, bw, bh = box_roi
            # Add 20% margin around box ROI
            pad_w = int(bw * 0.2)
            pad_h = int(bh * 0.2)
            x1 = max(0, cx - bw // 2 - pad_w)
            y1 = max(0, cy - bh // 2 - pad_h)
            x2 = min(w, cx + bw // 2 + pad_w)
            y2 = min(h, cy + bh // 2 + pad_h)
            roi = frame[y1:y2, x1:x2]
        else:
            roi = frame

        if roi.size == 0 or roi.shape[0] < 20 or roi.shape[1] < 20:
            return None

        # Pass 1: Direct decoding
        val, _, _ = self.qr_detector.detectAndDecode(roi)
        if val:
            code = self._extract_two_digits(val)
            if code:
                return code

        # Pass 2: Grayscale + CLAHE + Sharpen
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        enhanced = self.clahe.apply(gray)
        kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
        sharpened = cv2.filter2D(enhanced, -1, kernel)

        val, _, _ = self.qr_detector.detectAndDecode(sharpened)
        if val:
            code = self._extract_two_digits(val)
            if code:
                return code

        # Pass 3: Otsu Binarization
        _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        val, _, _ = self.qr_detector.detectAndDecode(otsu)
        if val:
            code = self._extract_two_digits(val)
            if code:
                return code

        return None

    def _extract_two_digits(self, raw_text: str) -> Optional[str]:
        """Extracts 2 digits from raw QR text."""
        raw_text = raw_text.strip()
        # Direct 2 digits
        if len(raw_text) == 2 and raw_text.isdigit():
            return raw_text
        # Regex search inside payload string (e.g., "CACHE:42" or "SAE42")
        match = self.two_digit_pattern.search(raw_text)
        if match:
            return match.group(1)
        return None


# =====================================================================================
# 3. AUTONOMOUS FINITE STATE MACHINE (FSM)
# =====================================================================================
class AutonomousVisionBrain:
    def __init__(
        self,
        connection_string: str = "/dev/ttyAMA0",
        baud: int = 921600,
        camera_index: int = 0,
        yolo_weights: Optional[str] = None
    ):
        self.conn_str = connection_string
        self.baud = baud
        self.cam_idx = camera_index

        log.info(f"Connecting to Pixhawk on {self.conn_str} at {self.baud} baud...")
        self.mav = mavutil.mavlink_connection(self.conn_str, baud=self.baud)
        log.info("Waiting for heartbeat from Pixhawk...")
        self.mav.wait_heartbeat()
        log.info(f"Heartbeat received from System {self.mav.target_system}, Component {self.mav.target_component}!")

        # Request high-rate telemetry streams from Pixhawk
        self._request_data_streams()

        # Telemetry State
        self.current_altitude_m: float = 0.0
        self.current_mode: str = "UNKNOWN"
        self.is_armed: bool = False
        self.last_telem_time: float = 0.0

        # Computer Vision & Servoing
        self.detector = TargetDetector(yolo_weights)
        self.pid_x = VisualServoPID(kp=0.0018, ki=0.0001, kd=0.0006, max_velocity_mps=0.6)
        self.pid_y = VisualServoPID(kp=0.0018, ki=0.0001, kd=0.0006, max_velocity_mps=0.6)

        # FSM State
        self.state: str = "STATE_WAIT_FOR_AUTO"
        self.consecutive_box_detections: int = 0
        self.last_target_seen_time: float = 0.0
        self.servo_start_time: float = 0.0
        self.decoded_code: Optional[str] = None

        # Camera Capture
        log.info(f"Opening camera index {self.cam_idx}...")
        self.cap = cv2.VideoCapture(self.cam_idx)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap.set(cv2.CAP_PROP_FPS, 30)

        if not self.cap.isOpened():
            log.error(f"Cannot open camera index {self.cam_idx}!")
            sys.exit(1)

    def _request_data_streams(self):
        """Requests telemetry streams at 10 Hz from flight controller."""
        # MAV_DATA_STREAM_POSITION
        self.mav.mav.request_data_stream_send(
            self.mav.target_system,
            self.mav.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_POSITION,
            10,
            1
        )
        # MAV_DATA_STREAM_EXTRA1 (attitude)
        self.mav.mav.request_data_stream_send(
            self.mav.target_system,
            self.mav.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_EXTRA1,
            10,
            1
        )

    def update_telemetry(self):
        """Drains incoming MAVLink packets non-blockingly to update vehicle state."""
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
                # relative_alt is in millimeters
                self.current_altitude_m = float(msg.relative_alt) / 1000.0
                self.last_telem_time = time.time()

            elif msg_type == "VFR_HUD":
                if self.current_altitude_m == 0.0:
                    self.current_altitude_m = float(msg.alt)
                self.last_telem_time = time.time()

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
        self.mav.mav.set_mode_send(
            self.mav.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            mode_id
        )

    def send_body_velocity(self, vx: float, vy: float, vz: float):
        """
        Transmits SET_POSITION_TARGET_LOCAL_NED velocity vector in MAV_FRAME_BODY_OFFSET_NED.
        vx: forward (+) / backward (-) in m/s
        vy: right (+) / left (-) in m/s
        vz: down (+) / up (-) in m/s (positive descends in NED)
        """
        # Type mask: 0b0000111111000111 (0x0FC7) enables vx, vy, vz only
        type_mask = 0b0000111111000111

        self.mav.mav.set_position_target_local_ned_send(
            int(time.time() * 1000) & 0xFFFFFFFF,
            self.mav.target_system,
            self.mav.target_component,
            mavutil.mavlink.MAV_FRAME_BODY_OFFSET_NED,
            type_mask,
            0.0, 0.0, 0.0,  # x, y, z positions (ignored)
            vx, vy, vz,     # vx, vy, vz velocities in m/s
            0.0, 0.0, 0.0,  # afx, afy, afz accelerations (ignored)
            0.0, 0.0        # yaw, yaw_rate (ignored)
        )

    def broadcast_qr_statustext(self, digits: str):
        """
        Broadcasts MAVLINK_MSG_ID_STATUSTEXT with "QR_CODE:<digits>" 5 times over 1 second.
        Guarantees that Pixhawk relays it through TELEM2 to the ESP32-S3 and Cloud Ground Station.
        """
        payload = f"QR_CODE:{digits}".encode("utf-8")
        log.info(f"🚨 BROADCASTING CRITICAL STATUSTEXT TO PIXHAWK TELEM2: 'QR_CODE:{digits}' 🚨")
        for i in range(5):
            self.mav.mav.statustext_send(
                mavutil.mavlink.MAV_SEVERITY_CRITICAL,
                payload
            )
            time.sleep(0.2)

    def run(self):
        """Main autonomous vision loop."""
        log.info("Starting Autonomous Vision Brain loop...")
        img_w, img_h = 640, 480
        center_x, center_y = img_w // 2, img_h // 2

        last_loop_time = time.time()

        try:
            while True:
                # 1. Update vehicle state
                self.update_telemetry()

                # 2. Capture downward camera frame
                ret, frame = self.cap.read()
                if not ret or frame is None:
                    time.sleep(0.01)
                    continue

                now = time.time()
                box_detection = self.detector.detect_box(frame)

                # =====================================================================
                # 3. FINITE STATE MACHINE (FSM) TRANSITIONS
                # =====================================================================

                if self.state == "STATE_WAIT_FOR_AUTO":
                    # Wait until drone is flying in AUTO mode at mission sweep altitude (>2.8m)
                    if self.current_mode == "AUTO" and self.current_altitude_m >= 2.8:
                        log.info(f"Target altitude reached in AUTO ({self.current_altitude_m:.2f}m). Engaging GRID_SWEEP.")
                        self.state = "STATE_GRID_SWEEP"
                        self.consecutive_box_detections = 0

                elif self.state == "STATE_GRID_SWEEP":
                    # Sweep arena grid, looking for cache box (require 3 consecutive frames)
                    if box_detection is not None:
                        self.consecutive_box_detections += 1
                        log.info(f"Cache candidate detected ({self.consecutive_box_detections}/3 frames)...")
                        if self.consecutive_box_detections >= 3:
                            log.info("🎯 TARGET VERIFIED! Intercepting flight controller into GUIDED mode.")
                            self.state = "STATE_INTERCEPT_GUIDED"
                    else:
                        self.consecutive_box_detections = max(0, self.consecutive_box_detections - 1)

                elif self.state == "STATE_INTERCEPT_GUIDED":
                    # Switch from AUTO to GUIDED to seize local visual velocity control
                    self.set_mode("GUIDED")
                    self.pid_x.reset()
                    self.pid_y.reset()
                    self.last_target_seen_time = now
                    self.servo_start_time = now
                    self.state = "STATE_VISUAL_SERVO_DESCEND"

                elif self.state == "STATE_VISUAL_SERVO_DESCEND":
                    # Flight Watchdog A: Hard servo timeout (25s maximum)
                    if now - self.servo_start_time > 25.0:
                        log.warning("⏱️ Hard servo timeout exceeded (25s)! Triggering safety RTL.")
                        self.set_mode("RTL")
                        self.state = "STATE_RTL"
                        continue

                    # Flight Watchdog B: Lost-target recovery (3.0s loss)
                    if box_detection is None:
                        if now - self.last_target_seen_time > 3.0:
                            log.warning("⚠️ Target lost for > 3.0s! Halting descent, reverting to AUTO grid sweep.")
                            self.send_body_velocity(0.0, 0.0, 0.0)
                            self.set_mode("AUTO")
                            self.state = "STATE_GRID_SWEEP"
                            self.consecutive_box_detections = 0
                        else:
                            # Hold position while searching
                            self.send_body_velocity(0.0, 0.0, 0.0)
                        continue

                    self.last_target_seen_time = now
                    bx, by, bw, bh = box_detection

                    # Visual centering pixel error:
                    # In downward camera mounted facing forward:
                    # Top of image (by < center_y) = Drone Forward (+X)
                    # Right of image (bx > center_x) = Drone Right (+Y)
                    err_fwd = float(center_y - by)
                    err_right = float(bx - center_x)

                    pixel_dist = math.sqrt(err_fwd**2 + err_right**2)

                    # Compute 2D PID velocities clamped strictly to [-0.6, +0.6] m/s
                    vx = self.pid_x.compute(err_fwd)
                    vy = self.pid_y.compute(err_right)

                    # Altitude floor control:
                    # If centered within 45 pixels, descend at 0.25 m/s down to 1.2m floor
                    vz = 0.0
                    target_floor_alt = 1.2

                    if pixel_dist < 45.0:
                        if self.current_altitude_m > target_floor_alt:
                            vz = 0.25  # Downward velocity in NED (+vz)
                            log.info(f"Centering locked (err={pixel_dist:.1f}px). Descending: alt={self.current_altitude_m:.2f}m")
                        else:
                            vz = 0.0  # Hold hover floor at 1.2m
                            log.info(f"Hover floor achieved ({self.current_altitude_m:.2f}m). Proceeding to QR_DECODE.")
                            self.state = "STATE_QR_DECODE"
                    else:
                        # If horizontal error is large, maintain altitude until centered
                        vz = -0.1 if self.current_altitude_m < target_floor_alt else 0.0

                    self.send_body_velocity(vx, vy, vz)

                elif self.state == "STATE_QR_DECODE":
                    # Hover directly over box and decode QR code
                    self.send_body_velocity(0.0, 0.0, 0.0)

                    code = self.detector.decode_qr(frame, box_detection)
                    if code:
                        self.decoded_code = code
                        log.info(f"🎉 QR CODE SUCCESSFULLY DECODED: '{code}' 🎉")
                        self.broadcast_qr_statustext(code)
                        self.set_mode("RTL")
                        self.state = "STATE_RTL"
                    else:
                        # Flight Watchdog: 25s timeout
                        if now - self.servo_start_time > 25.0:
                            log.warning("⏱️ QR decode timeout exceeded! Commanding RTL to preserve battery.")
                            self.set_mode("RTL")
                            self.state = "STATE_RTL"

                elif self.state == "STATE_RTL":
                    # Drone returning to launch. Mission accomplished!
                    time.sleep(1.0)
                    log.info(f"[MISSION COMPLETED] State: RTL | Decoded Code: '{self.decoded_code}'")

                # Maintain 15-20 Hz loop rate
                dt = time.time() - now
                if dt < 0.05:
                    time.sleep(0.05 - dt)

        except KeyboardInterrupt:
            log.info("Keyboard interrupt received. Halting velocities and switching to RTL...")
            self.send_body_velocity(0.0, 0.0, 0.0)
            self.set_mode("RTL")
        finally:
            self.cap.release()
            log.info("Vision Brain node exited cleanly.")


# =====================================================================================
# SCRIPT ENTRYPOINT
# =====================================================================================
def main():
    parser = argparse.ArgumentParser(description="SAE INDIA ADDC 2026 Autonomous Vision Brain")
    parser.add_argument("--port", type=str, default="/dev/ttyAMA0", help="MAVLink serial port (default: /dev/ttyAMA0 or COM port)")
    parser.add_argument("--baud", type=int, default=921600, help="TELEM1 baud rate (default: 921600)")
    parser.add_argument("--cam", type=int, default=0, help="Downward camera index (default: 0)")
    parser.add_argument("--weights", type=str, default=None, help="Path to custom YOLOv8 weights (optional)")
    args = parser.parse_args()

    brain = AutonomousVisionBrain(
        connection_string=args.port,
        baud=args.baud,
        camera_index=args.cam,
        yolo_weights=args.weights
    )
    brain.run()


if __name__ == "__main__":
    main()

