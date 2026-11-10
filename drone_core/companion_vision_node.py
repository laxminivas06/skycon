"""
Production Onboard Vision & Georeferencing Service (companion_vision_node.py)
Milestone 2: S500-AeroRecon Quadcopter System (Requirement R2)

Unified entry point service integrating:
1. Low-latency V4L2 video capture pipeline (720p@60FPS, CAP_PROP_BUFFERSIZE=1, shutter <= 1/500s).
2. Pixhawk TELEM1 high-speed MAVLink interface (/dev/ttyAMA0 @ 921600 / 115200 baud).
3. WeChatQRCode deep CNN & multi-pass detector with subpixel corner refinement & diagonal intersection centroid.
4. Instant MAVLink SET_MODE to BRAKE (Mode 17) / zero-velocity GUIDED hold upon detection.
5. Rigorous 3D attitude-compensated WGS84 target georeferencing math with frame-telemetry synchronization.
6. Atomic POSIX / Windows local persistence with SHA-256 verification and SQLite audit logging.
7. Deduplication engine suppressing duplicate detections within 5000 ms.
8. Non-blocking network relay dispatching standardized JSON payloads to GCS backend.
"""

import os
import sys
import time
import math
import json
import signal
import logging
import argparse
import threading
from typing import Optional, Dict, Any, Tuple
import requests

from pymavlink import mavutil

try:
    from .config import CameraIntrinsics
    from .v4l2_capture import V4L2CapturePipeline, V4L2Config, CapturedFrame
    from .qr_detector import WeChatQRDetector, QRDetectionResult
    from .georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult
    from .brake_controller import BrakeController
    from .telemetry_sync import TelemetrySyncBuffer, TelemetrySnapshot
    from .persistence import LocalPersistenceManager, GeoreferencedDetectionRecord
except (ImportError, ValueError):
    from drone_core.config import CameraIntrinsics
    from drone_core.v4l2_capture import V4L2CapturePipeline, V4L2Config, CapturedFrame
    from drone_core.qr_detector import WeChatQRDetector, QRDetectionResult
    from drone_core.georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult
    from drone_core.brake_controller import BrakeController
    from drone_core.telemetry_sync import TelemetrySyncBuffer, TelemetrySnapshot
    from drone_core.persistence import LocalPersistenceManager, GeoreferencedDetectionRecord

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("CompanionVisionNode")


class CompanionVisionNode:
    """
    Unified onboard companion computer service orchestrating edge vision,
    dynamic braking, time-synchronized telemetry, georeferencing, and persistence.
    """

    def __init__(
        self,
        connection_str: str = "/dev/ttyAMA0",
        baud_rate: int = 921600,
        video_device: str = "/dev/video0",
        output_json: str = "data/decoded_payloads.json",
        output_db: str = "data/mission_telemetry.db",
        backend_url: Optional[str] = "http://localhost:3000/api/recon/detections",
        mock_mode: bool = False,
        camera_hfov: float = 68.0,
        camera_vfov: float = 54.0,
        dedup_window_s: float = 5.0
    ):
        self.connection_str = connection_str
        self.baud_rate = baud_rate
        self.mock_mode = mock_mode
        self.backend_url = backend_url
        self.dedup_window_s = dedup_window_s

        # 1. Camera Intrinsics & 3D Georeferencer
        self.camera_3d = CameraIntrinsics3D(
            width=1280,
            height=720,
            hfov_deg=camera_hfov,
            vfov_deg=camera_vfov,
            sensor_model="Sony IMX477"
        )
        self.georeferencer = Georeferencer(self.camera_3d)

        # 2. V4L2 Low-Latency Capture Pipeline
        v4l2_cfg = V4L2Config(
            device=video_device,
            width=1280,
            height=720,
            fps=60,
            buffer_size=1,
            shutter_speed_s=1.0 / 500.0,
            exposure_absolute=19,
            use_synthetic_fallback=True
        )
        self.capture_pipeline = V4L2CapturePipeline(v4l2_cfg)

        # 3. QR Detector (WeChatQRCode + Subpixel Refinement)
        self.qr_detector = WeChatQRDetector()

        # 4. Telemetry Synchronization Buffer (K=50)
        self.telemetry_buffer = TelemetrySyncBuffer(capacity=50)

        # 5. MAVLink Connection & Brake Controller
        self.mav: Optional[Any] = None
        self.brake_controller = BrakeController(mav_connection=None)

        # 6. Atomic Persistence Store & SQLite Audit Logger
        self.persistence = LocalPersistenceManager(json_path=output_json, db_path=output_db)

        # State & Concurrency Control
        self._running = False
        self._telemetry_thread: Optional[threading.Thread] = None
        self._last_heartbeat_time = 0.0
        self._recent_detections: Dict[str, float] = {}  # code -> timestamp
        self._detection_count = 0
        self._frames_processed = 0

    def start(self) -> bool:
        """Starts MAVLink listener, video ingest pipeline, and processing loops."""
        if self._running:
            return True

        self._running = True
        logger.info("Initializing S500-AeroRecon Companion Vision Service...")

        # Initialize MAVLink
        if not self.mock_mode and self.connection_str != "mock":
            self._init_mavlink()
        else:
            logger.info("Running in MOCK MAVLink mode. Ingesting synthetic telemetry states.")
            self._start_mock_telemetry()

        # Start V4L2 Capture Pipeline
        if not self.capture_pipeline.start():
            logger.error("Failed to start V4L2 capture pipeline.")
            return False

        logger.info("Companion Vision Service initialized and ready for mission execution.")
        return True

    def _init_mavlink(self):
        """Connects to Pixhawk TELEM1 via pymavlink and starts background telemetry thread."""
        logger.info("Connecting to Pixhawk on %s @ %d baud...", self.connection_str, self.baud_rate)
        try:
            self.mav = mavutil.mavlink_connection(
                self.connection_str,
                baud=self.baud_rate,
                autoreconnect=True,
                source_system=255,  # Companion computer system ID
                source_component=195  # MAV_COMP_ID_OBSTACLE_AVOIDANCE / VISION
            )
            self.brake_controller.set_connection(self.mav)
            self._telemetry_thread = threading.Thread(target=self._telemetry_reader_loop, daemon=True)
            self._telemetry_thread.start()

            # Request high-rate streams via MAV_CMD_SET_MESSAGE_INTERVAL
            self._request_message_interval(mavutil.mavlink.MAVLINK_MSG_ID_ATTITUDE, 50000)  # 20 Hz
            self._request_message_interval(mavutil.mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT, 100000)  # 10 Hz
            logger.info("MAVLink telemetry reader started.")
        except Exception as e:
            logger.warning("Could not connect to physical MAVLink serial port (%s). Falling back to mock telemetry.", e)
            self.mav = None
            self._start_mock_telemetry()

    def _request_message_interval(self, message_id: int, interval_us: int):
        """Dispatches MAV_CMD_SET_MESSAGE_INTERVAL to request high-rate streaming."""
        if self.mav is None:
            return
        try:
            self.mav.mav.command_long_send(
                self.mav.target_system or 1,
                self.mav.target_component or 1,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,
                message_id,
                interval_us,
                0, 0, 0, 0, 0
            )
        except Exception:
            pass

    def _telemetry_reader_loop(self):
        """Continuously reads incoming MAVLink packets and feeds the sync buffer."""
        while self._running and self.mav is not None:
            try:
                msg = self.mav.recv_match(blocking=True, timeout=0.5)
                if msg is None:
                    continue

                msg_type = msg.get_type()
                if msg_type == "HEARTBEAT":
                    self._last_heartbeat_time = time.monotonic()
                    armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    self.telemetry_buffer.update_heartbeat(msg.custom_mode, armed)

                elif msg_type == "ATTITUDE":
                    self.telemetry_buffer.update_attitude(
                        roll_rad=msg.roll,
                        pitch_rad=msg.pitch,
                        yaw_rad=msg.yaw,
                        time_boot_ms=msg.time_boot_ms
                    )

                elif msg_type == "GLOBAL_POSITION_INT":
                    lat = msg.lat / 1e7
                    lon = msg.lon / 1e7
                    alt_agl = msg.relative_alt / 1000.0
                    alt_msl = msg.alt / 1000.0
                    vx = msg.vx / 100.0
                    vy = msg.vy / 100.0
                    vz = msg.vz / 100.0
                    hdg = msg.hdg / 100.0 if hasattr(msg, "hdg") else 0.0
                    self.telemetry_buffer.update_global_position(
                        lat_deg=lat,
                        lon_deg=lon,
                        alt_agl_m=alt_agl,
                        alt_msl_m=alt_msl,
                        vx_mps=vx,
                        vy_mps=vy,
                        vz_mps=vz,
                        hdg_deg=hdg,
                        time_boot_ms=msg.time_boot_ms
                    )
            except Exception as e:
                time.sleep(0.01)

    def _start_mock_telemetry(self):
        """Pushes baseline flight telemetry states into sync buffer for bench test execution."""
        # Initial cruise state over Chennai competition coordinates
        base_lat = 13.0827000
        base_lon = 80.2707000
        base_alt = 5.0

        def mock_loop():
            step = 0
            while self._running:
                now_mono = time.monotonic()
                # Simulate forward flight at 4.0 m/s heading East (90 deg), pitch -10 deg
                heading = 90.0
                pitch = -10.0
                roll = 0.0
                lat = base_lat
                lon = base_lon + (step * 0.0000036)  # ~4m/s East
                alt = 5.0 + math.sin(step * 0.1) * 0.05

                snap = TelemetrySnapshot(
                    timestamp_mono=now_mono,
                    time_boot_ms=step * 50,
                    latitude=lat,
                    longitude=lon,
                    altitude_agl_m=alt,
                    altitude_msl_m=542.5,
                    roll_rad=math.radians(roll),
                    pitch_rad=math.radians(pitch),
                    yaw_rad=math.radians(heading),
                    roll_deg=roll,
                    pitch_deg=pitch,
                    yaw_deg=heading,
                    heading_deg=heading,
                    vx_mps=0.0,
                    vy_mps=4.0,
                    vz_mps=0.0,
                    ground_speed_mps=4.0,
                    custom_mode=3,  # AUTO
                    is_armed=True,
                    is_valid=True
                )
                self.telemetry_buffer.push_snapshot(snap)
                step += 1
                time.sleep(0.05)  # 20 Hz mock stream

        self._telemetry_thread = threading.Thread(target=mock_loop, daemon=True)
        self._telemetry_thread.start()

    def process_frame(self, frame_packet: CapturedFrame) -> Optional[GeoreferencedDetectionRecord]:
        """
        Processes a single video frame:
        1. Detects and decodes QR payload.
        2. Dispatches instant MAVLink BRAKE command upon detection.
        3. Retrieves time-synchronized telemetry state at frame timestamp.
        4. Computes 3D attitude-compensated WGS84 target coordinates.
        5. Atomically saves detection payload to JSON and SQLite.
        6. Relays detection to GCS backend.
        """
        self._frames_processed += 1
        t_frame = frame_packet.timestamp_mono

        # Step 1: QR Detection & Subpixel Centroid Extraction
        detection: Optional[QRDetectionResult] = self.qr_detector.detect_and_decode(frame_packet.image)
        if detection is None or not detection.verified:
            return None

        two_digit = detection.two_digit_code
        now_mono = time.monotonic()

        # Step 2: Deduplication Check (suppress re-trigger within window)
        if two_digit in self._recent_detections:
            last_hit = self._recent_detections[two_digit]
            if now_mono - last_hit < self.dedup_window_s:
                logger.debug("Deduplicating QR hit '%s' (seen %.2fs ago)", two_digit, now_mono - last_hit)
                return None

        self._recent_detections[two_digit] = now_mono
        self._detection_count += 1
        logger.info(
            "*** TARGET DETECTED! Code: '%s' | Payload: '%s' | Centroid: (%.1f, %.1f) ***",
            two_digit, detection.payload, detection.centroid_u, detection.centroid_v
        )

        # Step 3: Instant MAVLink BRAKE Mode Injection
        brake_success = self.brake_controller.trigger_instant_brake(payload_tag=two_digit)
        if brake_success:
            logger.info("BRAKE command successfully transmitted to Pixhawk.")
        else:
            logger.warning("Brake command transmission was unacknowledged.")

        # Step 4: Time-Synchronized Telemetry Lookup
        telemetry: TelemetrySnapshot = self.telemetry_buffer.interpolate(t_frame)
        if not telemetry.is_valid:
            logger.warning("Telemetry not locked. Using fallback center GPS.")
            telemetry.latitude = 13.0827000
            telemetry.longitude = 80.2707000
            telemetry.altitude_agl_m = 5.0

        # Step 5: 3D Attitude-Compensated Georeferencing
        geo_result: GeoreferenceResult = self.georeferencer.resolve_target(
            u=detection.centroid_u,
            v=detection.centroid_v,
            drone_lat=telemetry.latitude,
            drone_lon=telemetry.longitude,
            altitude_agl_m=telemetry.altitude_agl_m,
            roll_deg=telemetry.roll_deg,
            pitch_deg=telemetry.pitch_deg,
            yaw_deg=telemetry.yaw_deg
        )

        logger.info(
            "Georeferenced Target: Lat=%.7f, Lon=%.7f | Offset: dN=%.2fm, dE=%.2fm (Dist=%.2fm)",
            geo_result.target_lat, geo_result.target_lon,
            geo_result.offset_north_m, geo_result.offset_east_m, geo_result.ground_distance_m
        )

        # Step 6: Atomic Disk Persistence (JSON + SQLite)
        cam_meta = {
            "sensorModel": self.camera_3d.sensor_model,
            "frameWidth": self.camera_3d.width,
            "frameHeight": self.camera_3d.height,
            "hfovDeg": self.camera_3d.hfov_deg,
            "vfovDeg": self.camera_3d.vfov_deg,
            "focalLengthPixels": round(self.camera_3d.fx, 2)
        }
        bbox_meta = {
            "x": detection.bounding_box[0],
            "y": detection.bounding_box[1],
            "width": detection.bounding_box[2],
            "height": detection.bounding_box[3],
            "centroidU": detection.centroid_u,
            "centroidV": detection.centroid_v
        }

        record = self.persistence.save_georeferenced_detection(
            payload=detection.payload,
            two_digit_code=two_digit,
            target_lat=geo_result.target_lat,
            target_lon=geo_result.target_lon,
            altitude_agl=geo_result.altitude_agl,
            ground_distance_m=geo_result.ground_distance_m,
            offset_north_m=geo_result.offset_north_m,
            offset_east_m=geo_result.offset_east_m,
            drone_lat=telemetry.latitude,
            drone_lon=telemetry.longitude,
            drone_alt_agl=telemetry.altitude_agl_m,
            drone_alt_msl=telemetry.altitude_msl_m,
            roll_deg=telemetry.roll_deg,
            pitch_deg=telemetry.pitch_deg,
            yaw_deg=telemetry.yaw_deg,
            ground_speed_mps=telemetry.ground_speed_mps,
            camera_intrinsics=cam_meta,
            bounding_box=bbox_meta,
            verified=True
        )

        # Step 7: Async Relay to GCS Backend
        if self.backend_url:
            threading.Thread(target=self._relay_to_backend, args=(record,), daemon=True).start()

        return record

    def _relay_to_backend(self, record: GeoreferencedDetectionRecord):
        """Posts detection JSON to GCS backend REST endpoint with non-blocking timeout."""
        try:
            from dataclasses import asdict
            payload_dict = asdict(record)
            resp = requests.post(self.backend_url, json=payload_dict, timeout=2.0)
            if resp.status_code in (200, 201):
                logger.info("Successfully dispatched target payload to GCS backend (%s).", self.backend_url)
            else:
                logger.warning("Backend rejected payload (HTTP %d): %s", resp.status_code, resp.text)
        except Exception as e:
            logger.debug("Backend network relay deferred/unavailable: %s", e)

    def run_main_loop(self):
        """Continuous production processing loop."""
        logger.info("Companion Vision Node running. Listening for video frames and QR targets...")
        try:
            while self._running:
                frame_packet = self.capture_pipeline.get_latest_frame()
                if frame_packet is None:
                    time.sleep(0.005)
                    continue

                self.process_frame(frame_packet)
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received. Shutting down...")
        finally:
            self.stop()

    def stop(self):
        """Gracefully halts all child threads, capture devices, and communication ports."""
        self._running = False
        self.capture_pipeline.stop()
        if self.mav is not None:
            try:
                self.mav.close()
            except Exception:
                pass
            self.mav = None
        logger.info(
            "Companion Vision Service stopped. Total frames: %d, detections: %d",
            self._frames_processed, self._detection_count
        )


def main():
    parser = argparse.ArgumentParser(description="S500-AeroRecon Companion Vision & Georeferencing Node")
    parser.add_argument("--connection", default="/dev/ttyAMA0", help="Pixhawk TELEM1 port (e.g. /dev/ttyAMA0 or mock)")
    parser.add_argument("--baud", type=int, default=921600, help="Serial baud rate (921600 or 115200)")
    parser.add_argument("--video", default="/dev/video0", help="Camera video device or index")
    parser.add_argument("--output-json", default="data/decoded_payloads.json", help="Path to local JSON output")
    parser.add_argument("--output-db", default="data/mission_telemetry.db", help="Path to SQLite audit DB")
    parser.add_argument("--backend-url", default="http://localhost:3000/api/recon/detections", help="GCS Backend REST URL")
    parser.add_argument("--mock", action="store_true", help="Run with simulated telemetry and synthetic video")
    parser.add_argument("--test", action="store_true", help="Execute built-in self test and exit")
    args = parser.parse_args()

    if args.test:
        print("[TEST] Running companion_vision_node internal self-test...")
        node = CompanionVisionNode(connection_str="mock", mock_mode=True)
        assert node.start() == True
        time.sleep(0.2)
        # Test synthetic frame grab
        frame = node.capture_pipeline.get_latest_frame()
        assert frame is not None
        node.stop()
        print("[TEST] Self-test completed successfully with exit code 0.")
        sys.exit(0)

    node = CompanionVisionNode(
        connection_str=args.connection,
        baud_rate=args.baud,
        video_device=args.video,
        output_json=args.output_json,
        output_db=args.output_db,
        backend_url=args.backend_url,
        mock_mode=args.mock
    )

    if not node.start():
        sys.exit(1)

    node.run_main_loop()


if __name__ == "__main__":
    main()
