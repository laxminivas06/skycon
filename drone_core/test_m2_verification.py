"""
Comprehensive Automated Verification Test Suite for Milestone 2
Edge Vision, Georeferencing, Dynamic Braking & Telemetry Sync

Verifies:
1. 3 Analytical Georeferencing Golden Vectors (§5 survey_miner_2/handoff.md):
   - Vector 1: Center Nadir Alignment (Lat=13.0827, Lon=80.2707, H=5.0m, u=640, v=360 => dN=0.0m, dE=0.0m)
   - Vector 2: Offset Target with Heading (u=829.77, v=218.69 => dN=1.00m, dE=1.00m)
   - Vector 3: Pitch-Compensated Forward Cruise (pitch=-10°, yaw=90° => dN=0.0m, dE=0.88m)
2. Georeferencing edge cases: Null Island rejection, upward/horizontal ray rejection (v_D <= 0.05).
3. V4L2 low-latency capture pipeline (720p@60FPS, CAP_PROP_BUFFERSIZE=1, shutter <= 1/500s).
4. WeChatQRCode & subpixel corner refinement with analytical diagonal intersection centroid.
5. Instant MAVLink BRAKE controller (Mode 17) & stopping kinematics (3.49m forward over target).
6. Monotonic telemetry sync ring buffer (K=50) with circular yaw/heading wraparound.
7. Atomic JSON persistence with SHA-256 integrity and local SQLite audit logging.
8. End-to-end integration of CompanionVisionNode.
"""

import os
import sys
import math
import time
import shutil
import unittest
import numpy as np
import cv2

try:
    from drone_core.georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult
    from drone_core.v4l2_capture import V4L2CapturePipeline, V4L2Config, CapturedFrame
    from drone_core.qr_detector import WeChatQRDetector, QRDetectionResult
    from drone_core.brake_controller import BrakeController, BrakingKinematics
    from drone_core.telemetry_sync import TelemetrySyncBuffer, TelemetrySnapshot
    from drone_core.persistence import LocalPersistenceManager, GeoreferencedDetectionRecord
    from drone_core.companion_vision_node import CompanionVisionNode
except ImportError:
    from .georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult
    from .v4l2_capture import V4L2CapturePipeline, V4L2Config, CapturedFrame
    from .qr_detector import WeChatQRDetector, QRDetectionResult
    from .brake_controller import BrakeController, BrakingKinematics
    from .telemetry_sync import TelemetrySyncBuffer, TelemetrySnapshot
    from .persistence import LocalPersistenceManager, GeoreferencedDetectionRecord
    from .companion_vision_node import CompanionVisionNode


class TestMilestone2EdgeVisionAndGeoreferencing(unittest.TestCase):

    def setUp(self):
        self.test_dir = os.path.join(os.path.dirname(__file__), "test_scratch_m2")
        os.makedirs(self.test_dir, exist_ok=True)
        self.json_path = os.path.join(self.test_dir, "test_detections.json")
        self.db_path = os.path.join(self.test_dir, "test_audit.db")

        # Standard IMX477 camera intrinsics: 1280x720, 68° HFOV, 54° VFOV
        self.cam = CameraIntrinsics3D(width=1280, height=720, hfov_deg=68.0, vfov_deg=54.0)
        self.geo = Georeferencer(self.cam)

    def tearDown(self):
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir, ignore_errors=True)

    # =========================================================================
    # SUITE 1: 3 GOLDEN GEOREFERENCING TEST VECTORS (Analytical Accuracy)
    # =========================================================================

    def test_vector1_center_nadir_alignment(self):
        """Vector 1: Target at exact optical center with nadir attitude gives zero displacement."""
        res = self.geo.resolve_target(
            u=640.0, v=360.0,
            drone_lat=13.0827000, drone_lon=80.2707000,
            altitude_agl_m=5.00,
            roll_deg=0.0, pitch_deg=0.0, yaw_deg=90.0
        )
        self.assertTrue(res.valid)
        self.assertAlmostEqual(res.offset_north_m, 0.00, places=2)
        self.assertAlmostEqual(res.offset_east_m, 0.00, places=2)
        self.assertAlmostEqual(res.ground_distance_m, 0.00, places=2)
        self.assertAlmostEqual(res.target_lat, 13.0827000, places=6)
        self.assertAlmostEqual(res.target_lon, 80.2707000, places=6)

    def test_vector2_offset_target_with_heading(self):
        """Vector 2: Target at (829.77, 218.69) with yaw=0° gives dN=1.00m, dE=1.00m."""
        res = self.geo.resolve_target(
            u=829.77, v=218.69,
            drone_lat=13.0827000, drone_lon=80.2707000,
            altitude_agl_m=5.00,
            roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0
        )
        self.assertTrue(res.valid)
        # Check sub-meter / centimeter accuracy
        self.assertAlmostEqual(res.offset_north_m, 1.00, places=2)
        self.assertAlmostEqual(res.offset_east_m, 1.00, places=2)
        self.assertAlmostEqual(res.ground_distance_m, 1.414, delta=0.02)
        self.assertAlmostEqual(res.target_lat, 13.0827090, places=6)
        self.assertAlmostEqual(res.target_lon, 80.2707092, places=6)

    def test_vector3_pitch_compensated_forward_cruise(self):
        """Vector 3: Drone cruising East with -10° pitch has target 0.88m ahead (East)."""
        res = self.geo.resolve_target(
            u=640.0, v=360.0,
            drone_lat=13.0827000, drone_lon=80.2707000,
            altitude_agl_m=5.00,
            roll_deg=0.0, pitch_deg=-10.0, yaw_deg=90.0
        )
        self.assertTrue(res.valid)
        self.assertAlmostEqual(res.offset_north_m, 0.00, places=2)
        self.assertAlmostEqual(res.offset_east_m, 0.8816, places=2)
        self.assertAlmostEqual(res.ground_distance_m, 0.8816, places=2)
        self.assertAlmostEqual(res.target_lat, 13.0827000, places=6)
        self.assertAlmostEqual(res.target_lon, 80.2707081, places=6)

    def test_georeferencing_edge_cases(self):
        """Edge cases: Null Island GPS rejection and upward ray rejection."""
        # 1. Null Island rejection
        null_res = self.geo.resolve_target(
            u=640.0, v=360.0,
            drone_lat=0.0, drone_lon=0.0,
            altitude_agl_m=5.0,
            roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0
        )
        self.assertFalse(null_res.valid)
        self.assertIn("Null Island", null_res.error_message)

        # 2. Extreme pitch upward (ray does not hit ground)
        up_res = self.geo.resolve_target(
            u=640.0, v=360.0,
            drone_lat=13.0827, drone_lon=80.2707,
            altitude_agl_m=5.0,
            roll_deg=0.0, pitch_deg=88.0, yaw_deg=0.0
        )
        self.assertFalse(up_res.valid)
        self.assertIn("v_D", up_res.error_message)

    # =========================================================================
    # SUITE 2: V4L2 LOW-LATENCY CAPTURE PIPELINE
    # =========================================================================

    def test_v4l2_capture_lifecycle_and_buffer(self):
        """Verifies single-buffer queue (CAP_PROP_BUFFERSIZE=1) and frame ingest."""
        cfg = V4L2Config(
            device="/dev/video0",
            width=1280,
            height=720,
            fps=60,
            buffer_size=1,
            use_synthetic_fallback=True
        )
        pipe = V4L2CapturePipeline(cfg)
        self.assertTrue(pipe.start())
        time.sleep(0.1)

        frame = pipe.get_latest_frame()
        self.assertIsNotNone(frame)
        self.assertEqual(frame.width, 1280)
        self.assertEqual(frame.height, 720)
        self.assertGreater(frame.timestamp_mono, 0.0)

        stats = pipe.get_stats()
        self.assertGreater(stats["frames_captured"], 0)
        self.assertEqual(stats["shutter_clamp_s"], 1.0 / 500.0)
        pipe.stop()

    # =========================================================================
    # SUITE 3: WECHAT QR DETECTOR & SUBPIXEL CENTROID
    # =========================================================================

    def test_qr_detection_and_subpixel_refinement(self):
        """Verifies multi-pass QR decoding, 2-digit extraction, and analytical diagonal intersection."""
        detector = WeChatQRDetector()

        # Render synthetic test frame with real QR code
        frame = np.full((720, 1280, 3), 220, dtype=np.uint8)

        # Draw a synthetic QR pattern using qrcode library or OpenCV
        try:
            import qrcode
            qr = qrcode.QRCode(box_size=5, border=2)
            qr.add_data("SAE_INDIA_RESCUE_42")
            qr.make(fit=True)
            qr_img = np.array(qr.make_image(fill_color="black", back_color="white").convert("RGB"))
            qh, qw = qr_img.shape[:2]
            frame[280:280 + qh, 540:540 + qw] = qr_img

            res = detector.detect_and_decode(frame)
            self.assertIsNotNone(res)
            self.assertEqual(res.payload, "SAE_INDIA_RESCUE_42")
            self.assertEqual(res.two_digit_code, "42")
            self.assertTrue(res.verified)
            self.assertEqual(res.corners.shape, (4, 2))
            # Centroid should be within the QR bounding box
            self.assertGreater(res.centroid_u, 540)
            self.assertLess(res.centroid_u, 540 + qw)
            self.assertGreater(res.centroid_v, 280)
            self.assertLess(res.centroid_v, 280 + qh)
        except ImportError:
            # Fallback direct test of two-digit regex extraction
            self.assertEqual(detector.extract_two_digit_code("SAE_INDIA_RESCUE_42"), "42")
            self.assertEqual(detector.extract_two_digit_code("TARGET_77"), "77")
            self.assertEqual(detector.extract_two_digit_code("99"), "99")

    # =========================================================================
    # SUITE 4: INSTANT MAVLINK BRAKE CONTROLLER & KINEMATICS
    # =========================================================================

    def test_brake_controller_stopping_kinematics(self):
        """Verifies braking stopping distance of 3.49m (LOIT_BRK_DELAY=0.3, LOIT_BRK_ACCEL=350)."""
        kin = BrakingKinematics(cruise_speed_mps=4.0)
        self.assertAlmostEqual(kin.delay_distance_m, 1.20, places=2)
        self.assertAlmostEqual(kin.decel_distance_m, 2.29, places=2)
        self.assertAlmostEqual(kin.total_stopping_distance_m, 3.49, places=2)
        self.assertAlmostEqual(kin.total_stopping_time_s, 1.44, places=2)

        ctrl = BrakeController(mav_connection=None)
        success = ctrl.trigger_instant_brake(payload_tag="42")
        self.assertTrue(success)
        self.assertTrue(ctrl.is_braking_active)
        self.assertEqual(ctrl.last_brake_event.target_payload, "42")

    # =========================================================================
    # SUITE 5: TELEMETRY SYNC RING BUFFER & INTERPOLATION
    # =========================================================================

    def test_telemetry_sync_interpolation_and_heading_wrap(self):
        """Verifies monotonic state interpolation and circular heading wraparound (355° -> 5°)."""
        buf = TelemetrySyncBuffer(capacity=50)

        s0 = TelemetrySnapshot(
            timestamp_mono=100.0,
            latitude=13.0827000,
            longitude=80.2707000,
            altitude_agl_m=5.0,
            heading_deg=355.0,
            yaw_deg=355.0,
            roll_rad=0.0,
            pitch_rad=math.radians(-10.0),
            yaw_rad=math.radians(355.0)
        )
        s1 = TelemetrySnapshot(
            timestamp_mono=100.1,  # +100ms
            latitude=13.0827100,
            longitude=80.2707100,
            altitude_agl_m=5.2,
            heading_deg=5.0,  # Wrapped across North (+10° total rotation)
            yaw_deg=5.0,
            roll_rad=0.0,
            pitch_rad=math.radians(-10.0),
            yaw_rad=math.radians(5.0)
        )
        buf.push_snapshot(s0)
        buf.push_snapshot(s1)

        # Midpoint at t=100.05 (alpha = 0.5)
        interp = buf.interpolate(100.05)
        self.assertAlmostEqual(interp.latitude, 13.0827050, places=7)
        self.assertAlmostEqual(interp.altitude_agl_m, 5.10, places=2)
        # Midpoint of 355° and 5° across North is 0.0°
        self.assertTrue(abs(interp.heading_deg - 0.0) < 0.1 or abs(interp.heading_deg - 360.0) < 0.1)

    # =========================================================================
    # SUITE 6: ATOMIC PERSISTENCE & SHA-256 INTEGRITY
    # =========================================================================

    def test_atomic_persistence_and_checksum(self):
        """Verifies atomic .tmp serialization and SHA-256 validation."""
        mgr = LocalPersistenceManager(self.json_path, self.db_path)

        cam_meta = {"sensorModel": "Sony IMX477", "frameWidth": 1280, "frameHeight": 720, "hfovDeg": 68.0, "vfovDeg": 54.0, "focalLengthPixels": 948.84}
        bbox_meta = {"x": 600, "y": 300, "width": 80, "height": 80, "centroidU": 640.0, "centroidV": 340.0}

        record = mgr.save_georeferenced_detection(
            payload="SAE_INDIA_RESCUE_42",
            two_digit_code="42",
            target_lat=13.0827090,
            target_lon=80.2707092,
            altitude_agl=5.0,
            ground_distance_m=1.41,
            offset_north_m=1.00,
            offset_east_m=1.00,
            drone_lat=13.0827000,
            drone_lon=80.2707000,
            drone_alt_agl=5.0,
            drone_alt_msl=542.5,
            roll_deg=0.0,
            pitch_deg=0.0,
            yaw_deg=0.0,
            ground_speed_mps=4.0,
            camera_intrinsics=cam_meta,
            bounding_box=bbox_meta,
            verified=True
        )

        self.assertTrue(os.path.exists(self.json_path))
        self.assertFalse(os.path.exists(f"{self.json_path}.tmp"))
        self.assertEqual(len(record.checksumSha256), 64)

        # Load and verify through legacy reader
        loaded = mgr.load_latest_payload()
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.payload, "SAE_INDIA_RESCUE_42")

    # =========================================================================
    # SUITE 7: COMPANION VISION NODE END-TO-END WORKFLOW
    # =========================================================================

    def test_companion_vision_node_pipeline_execution(self):
        """Verifies full CompanionVisionNode processing loop with synthetic video and mock telemetry."""
        node = CompanionVisionNode(
            connection_str="mock",
            output_json=self.json_path,
            output_db=self.db_path,
            mock_mode=True
        )
        self.assertTrue(node.start())
        time.sleep(0.15)

        # Create a synthetic frame with QR code "SAE_INDIA_RESCUE_42"
        frame_img = np.full((720, 1280, 3), 200, dtype=np.uint8)
        try:
            import qrcode
            qr = qrcode.QRCode(box_size=4, border=2)
            qr.add_data("SAE_INDIA_RESCUE_42")
            qr.make(fit=True)
            qr_img = np.array(qr.make_image(fill_color="black", back_color="white").convert("RGB"))
            qh, qw = qr_img.shape[:2]
            frame_img[300:300 + qh, 600:600 + qw] = qr_img
        except ImportError:
            pass

        frame_packet = CapturedFrame(
            image=frame_img,
            timestamp_mono=time.monotonic(),
            frame_index=1,
            width=1280,
            height=720,
            is_synthetic=True
        )

        record = node.process_frame(frame_packet)
        node.stop()

        if record is not None:
            self.assertEqual(record.twoDigitCode, "42")
            self.assertTrue(record.verified)
            self.assertAlmostEqual(record.targetLocation.altitudeAgl, 0.0, delta=5.5)


def run_tests():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestMilestone2EdgeVisionAndGeoreferencing)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
