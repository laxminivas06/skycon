"""
Adversarial Stress Test Suite: 3D Georeferencing Projection Math (georeferencing.py)
Milestone 2 Challenge: S500-AeroRecon Quadcopter System
Author: Challenger 2 (Empirical Geospatial & Vision Challenger)

Executes empirical grid generation across:
1. Extreme attitudes: roll +/-22.0 deg, pitch +/-22.0 deg, 30 deg compound tilt, altitudes 0.5m to 25.0m.
2. Heading wraparounds across True North (359.9 deg -> 0.1 deg, negative yaws, multi-turn).
3. Extreme perimeter corners ((0,0), (1280,0), (0,720), (1280,720), subpixels, out-of-bounds).
4. Arbitrary global seed coordinates (Equator, Southern Hemisphere, Prime Meridian, High Latitude).
5. Comprehensive mathematical oracle: NaN/Inf detection, division-by-zero traps, continuity, symmetry.
"""

import math
import sys
import os
import unittest
import numpy as np

# Ensure skycon is in PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from drone_core.georeferencing import Georeferencer, CameraIntrinsics3D, GeoreferenceResult


class AdversarialGeoreferencingTests(unittest.TestCase):

    def setUp(self):
        self.camera = CameraIntrinsics3D(width=1280, height=720, hfov_deg=68.0, vfov_deg=54.0)
        self.georef = Georeferencer(self.camera)

    def _assert_no_nan_or_inf(self, res: GeoreferenceResult, ctx: str = ""):
        """Mathematical oracle: assert absolutely no NaN or Inf in any scalar or tuple field."""
        fields_to_check = [
            ("target_lat", res.target_lat),
            ("target_lon", res.target_lon),
            ("altitude_agl", res.altitude_agl),
            ("offset_north_m", res.offset_north_m),
            ("offset_east_m", res.offset_east_m),
            ("offset_body_x_m", res.offset_body_x_m),
            ("offset_body_y_m", res.offset_body_y_m),
            ("ground_distance_m", res.ground_distance_m),
        ]
        for name, val in fields_to_check:
            self.assertFalse(math.isnan(val), f"NaN detected in {name} [{ctx}]")
            self.assertFalse(math.isinf(val), f"Inf detected in {name} [{ctx}]")

        for i, val in enumerate(res.ray_ned):
            self.assertFalse(math.isnan(val), f"NaN detected in ray_ned[{i}] [{ctx}]")
            self.assertFalse(math.isinf(val), f"Inf detected in ray_ned[{i}] [{ctx}]")

        for i, val in enumerate(res.ray_body):
            self.assertFalse(math.isnan(val), f"NaN detected in ray_body[{i}] [{ctx}]")
            self.assertFalse(math.isinf(val), f"Inf detected in ray_body[{i}] [{ctx}]")

    # =========================================================================
    # TEST 1: Extreme Aircraft Attitudes & Altitude Range
    # =========================================================================
    def test_extreme_attitudes_and_altitudes_grid(self):
        """Stress tests roll +/-22 deg (ANGLE_MAX), pitch +/-22 deg, compound 30 deg, altitudes 0.5m-25m."""
        rolls = [-22.0, -15.0, 0.0, 15.0, 22.0]
        pitches = [-22.0, -15.0, 0.0, 15.0, 22.0]
        # Compound tilt: sqrt(21.213^2 + 21.213^2) = 30.0 deg
        compound_angles = [
            (21.213, 21.213),
            (-21.213, 21.213),
            (21.213, -21.213),
            (-21.213, -21.213),
        ]
        altitudes = [0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 25.0]
        pixels = [(640.0, 360.0), (0.0, 0.0), (1280.0, 720.0)]
        yaws = [0.0, 90.0, 270.0]

        test_count = 0
        valid_count = 0
        invalid_caught_count = 0

        # Standard grid
        for roll in rolls:
            for pitch in pitches:
                for alt in altitudes:
                    for px in pixels:
                        for yaw in yaws:
                            test_count += 1
                            ctx = f"roll={roll}, pitch={pitch}, alt={alt}, px={px}, yaw={yaw}"
                            res = self.georef.resolve_target(
                                u=px[0], v=px[1],
                                drone_lat=13.0827, drone_lon=80.2707,
                                altitude_agl_m=alt,
                                roll_deg=roll, pitch_deg=pitch, yaw_deg=yaw
                            )
                            self._assert_no_nan_or_inf(res, ctx)
                            if res.valid:
                                valid_count += 1
                                self.assertGreaterEqual(res.ground_distance_m, 0.0)
                            else:
                                invalid_caught_count += 1
                                self.assertIsNotNone(res.error_message)

        # Compound tilt grid (30 degree tilt)
        for roll, pitch in compound_angles:
            for alt in altitudes:
                for px in pixels:
                    test_count += 1
                    ctx = f"compound: roll={roll}, pitch={pitch}, alt={alt}, px={px}"
                    res = self.georef.resolve_target(
                        u=px[0], v=px[1],
                        drone_lat=13.0827, drone_lon=80.2707,
                        altitude_agl_m=alt,
                        roll_deg=roll, pitch_deg=pitch, yaw_deg=45.0
                    )
                    self._assert_no_nan_or_inf(res, ctx)
                    if res.valid:
                        valid_count += 1
                    else:
                        invalid_caught_count += 1
                        self.assertIsNotNone(res.error_message)

        print(f"[TEST 1 PASS] Tested {test_count} attitude/altitude combinations. "
              f"Valid: {valid_count}, Gracefully Handled Invalid Rays: {invalid_caught_count}")
        self.assertGreater(test_count, 1000)

    # =========================================================================
    # TEST 2: Heading Wraparound Continuity Across True North & Negative Yaw
    # =========================================================================
    def test_heading_wraparound_and_negative_yaw(self):
        """Tests continuity when yaw transitions across True North (359.9 -> 0.1 deg) and negative angles."""
        lat0, lon0, alt = 13.0827, 80.2707, 5.0
        # Target at fixed pixel offset
        u, v = 740.0, 420.0

        # Step around North in tiny increments: 359.0 to 360.0 and 0.0 to 1.0
        yaw_sequence = [359.0, 359.5, 359.8, 359.9, 359.99, 0.0, 0.01, 0.1, 0.2, 0.5, 1.0]
        results = []
        for yaw in yaw_sequence:
            res = self.georef.resolve_target(
                u=u, v=v, drone_lat=lat0, drone_lon=lon0, altitude_agl_m=alt,
                roll_deg=5.0, pitch_deg=-5.0, yaw_deg=yaw
            )
            self._assert_no_nan_or_inf(res, f"yaw={yaw}")
            self.assertTrue(res.valid)
            results.append((yaw, res.offset_north_m, res.offset_east_m, res.target_lat, res.target_lon))

        # Check continuity across boundary: 359.99 deg and 0.01 deg
        res_359_99 = results[4]
        res_0_01 = results[6]
        d_north = abs(res_359_99[1] - res_0_01[1])
        d_east = abs(res_359_99[2] - res_0_01[2])
        self.assertLess(d_north, 0.05, f"Discontinuous jump in North offset across True North: {d_north}m")
        self.assertLess(d_east, 0.05, f"Discontinuous jump in East offset across True North: {d_east}m")

        # Negative yaws must produce identical results to their (yaw % 360) positive counterparts
        test_pairs = [
            (-0.1, 359.9),
            (-45.0, 315.0),
            (-90.0, 270.0),
            (-180.0, 180.0),
            (-360.0, 0.0),
            (-720.0, 0.0),
            (-405.0, 315.0),
            (720.0, 0.0),
            (1080.5, 0.5)
        ]
        for neg_yaw, pos_equiv in test_pairs:
            res_neg = self.georef.resolve_target(
                u=u, v=v, drone_lat=lat0, drone_lon=lon0, altitude_agl_m=alt,
                roll_deg=2.0, pitch_deg=-3.0, yaw_deg=neg_yaw
            )
            res_pos = self.georef.resolve_target(
                u=u, v=v, drone_lat=lat0, drone_lon=lon0, altitude_agl_m=alt,
                roll_deg=2.0, pitch_deg=-3.0, yaw_deg=pos_equiv
            )
            self._assert_no_nan_or_inf(res_neg, f"neg_yaw={neg_yaw}")
            self.assertEqual(res_neg.valid, res_pos.valid)
            self.assertAlmostEqual(res_neg.offset_north_m, res_pos.offset_north_m, places=3,
                                   msg=f"Negative yaw {neg_yaw} mismatch with {pos_equiv}")
            self.assertAlmostEqual(res_neg.offset_east_m, res_pos.offset_east_m, places=3,
                                   msg=f"Negative yaw {neg_yaw} mismatch with {pos_equiv}")
            self.assertAlmostEqual(res_neg.target_lat, res_pos.target_lat, places=6)
            self.assertAlmostEqual(res_neg.target_lon, res_pos.target_lon, places=6)

        print("[TEST 2 PASS] Verified True North wraparound continuity and negative/multi-turn yaw invariance.")

    # =========================================================================
    # TEST 3: Extreme Perimeter Pixel Corners & Boundary Coordinates
    # =========================================================================
    def test_extreme_perimeter_pixel_corners(self):
        """Stress-tests four exact perimeter corners: (0,0), (1280,0), (0,720), (1280,720) and mid-edges."""
        corners = [
            ("Top-Left", 0.0, 0.0),
            ("Top-Right", 1280.0, 0.0),
            ("Bottom-Left", 0.0, 720.0),
            ("Bottom-Right", 1280.0, 720.0),
            ("Top-Mid", 640.0, 0.0),
            ("Bottom-Mid", 640.0, 720.0),
            ("Left-Mid", 0.0, 360.0),
            ("Right-Mid", 1280.0, 360.0),
            ("Subpixel Center", 640.1234, 359.8765),
            ("Extreme Off-Image Left", -50.0, -50.0),
            ("Extreme Off-Image Right", 1330.0, 770.0),
        ]

        lat0, lon0, alt = 13.0827, 80.2707, 5.0
        for name, u, v in corners:
            res = self.georef.resolve_target(
                u=u, v=v, drone_lat=lat0, drone_lon=lon0, altitude_agl_m=alt,
                roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0
            )
            self._assert_no_nan_or_inf(res, f"Corner {name} ({u}, {v})")
            self.assertTrue(res.valid)

        # Theoretical corner ground projection at altitude H=5.0m, attitude=0:
        # fx = (1280 / 2) / tan(68/2) = 640 / tan(34 deg) = 948.8415 px
        # fy = (720 / 2) / tan(54/2) = 360 / tan(27 deg) = 706.5367 px
        # Top-Left (0, 0): xc = -640 / fx = -tan(34 deg) = -0.67451
        #                  yc = -360 / fy = -tan(27 deg) = -0.50953
        # In body frame: offset_x_body = -yc = +0.50953 (forward)
        #                offset_y_body = +xc = -0.67451 (left / -starboard)
        # Scaled by H=5.0m:
        # dx_body = 5.0 * 0.509525 = +2.5476 m (North if yaw=0)
        # dy_body = 5.0 * (-0.674508) = -3.3725 m (East if yaw=0 => 3.3725m West)
        res_tl = self.georef.resolve_target(0.0, 0.0, lat0, lon0, alt, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(res_tl.offset_north_m, 2.5476, places=3)
        self.assertAlmostEqual(res_tl.offset_east_m, -3.3725, places=3)

        # Bottom-Right (1280, 720):
        # xc = +0.67451, yc = +0.50953
        # dx_body = -2.5476 m (South), dy_body = +3.3725 m (East)
        res_br = self.georef.resolve_target(1280.0, 720.0, lat0, lon0, alt, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(res_br.offset_north_m, -2.5476, places=3)
        self.assertAlmostEqual(res_br.offset_east_m, 3.3725, places=3)

        print("[TEST 3 PASS] Verified all 4 perimeter corners and mid-edges adhere to exact optical limits.")

    # =========================================================================
    # TEST 4: Global Coordinates, Singularities, & Null Island Guard
    # =========================================================================
    def test_global_seed_coordinates_and_guards(self):
        """Verifies georeferencing behavior at equator, southern hemisphere, polar bounds, and Null Island."""
        locations = [
            ("Equator", 0.0001, 80.2707),
            ("Southern Hemisphere", -33.8688, 151.2093),
            ("Prime Meridian", 51.4769, 0.0001),
            ("Sub-Polar 85 deg N", 85.0, 10.0),
            ("Sub-Polar 85 deg S", -85.0, -10.0),
            ("Near North Pole 89.9 deg", 89.9, 0.0),
            ("Antimeridian 179.9999 deg", 10.0, 179.9999),
        ]

        for name, lat, lon in locations:
            res = self.georef.resolve_target(
                u=700.0, v=300.0,
                drone_lat=lat, drone_lon=lon, altitude_agl_m=5.0,
                roll_deg=10.0, pitch_deg=-10.0, yaw_deg=45.0
            )
            self._assert_no_nan_or_inf(res, f"Location {name} ({lat}, {lon})")
            self.assertTrue(res.valid, f"Failed at {name}")
            self.assertNotEqual(res.target_lat, 0.0)

        # Null Island guard test: lat=0.0, lon=0.0 must be rejected
        res_null = self.georef.resolve_target(
            u=640.0, v=360.0,
            drone_lat=0.0, drone_lon=0.0, altitude_agl_m=5.0,
            roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0
        )
        self.assertFalse(res_null.valid)
        self.assertIn("Null Island", res_null.error_message)

        # Low altitude clamp test: altitude <= 0.0m should not divide by zero
        res_zero_alt = self.georef.resolve_target(
            u=640.0, v=360.0,
            drone_lat=13.0827, drone_lon=80.2707, altitude_agl_m=0.0,
            roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0
        )
        self._assert_no_nan_or_inf(res_zero_alt, "zero altitude")
        self.assertTrue(res_zero_alt.valid)

        # Ray parallel or pointing above horizon (steep pitch/roll where v_D <= 0.05)
        # At 90 deg pitch (horizontal optical axis) and 180 deg pitch (inverted flight):
        for p in [88.0, 90.0, 120.0, 180.0]:
            res_sky = self.georef.resolve_target(
                u=640.0, v=360.0,
                drone_lat=13.0827, drone_lon=80.2707, altitude_agl_m=5.0,
                roll_deg=0.0, pitch_deg=p, yaw_deg=0.0
            )
            self._assert_no_nan_or_inf(res_sky, f"sky pitch {p}")
            self.assertFalse(res_sky.valid, f"Expected invalid for pitch={p}")
            self.assertIn("v_D", res_sky.error_message)

        print("[TEST 4 PASS] Verified global seed coordinate handling, Null Island guard, and sky ray rejection.")

    # =========================================================================
    # TEST 5: Metric Linear Altitude Scaling and Roll/Pitch Symmetry
    # =========================================================================
    def test_mathematical_linear_scaling_and_symmetry(self):
        """Verifies mathematical linearity of ground offsets with altitude and bilateral roll symmetry."""
        lat0, lon0 = 13.0827, 80.2707
        u, v = 740.0, 260.0  # Off-center pixel

        # 1. Altitude scaling: delta(2H) must equal 2 * delta(H)
        res_h5 = self.georef.resolve_target(u, v, lat0, lon0, 5.0, roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0)
        res_h10 = self.georef.resolve_target(u, v, lat0, lon0, 10.0, roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0)
        res_h20 = self.georef.resolve_target(u, v, lat0, lon0, 20.0, roll_deg=0.0, pitch_deg=0.0, yaw_deg=0.0)

        self.assertAlmostEqual(res_h10.offset_north_m, 2.0 * res_h5.offset_north_m, places=3)
        self.assertAlmostEqual(res_h10.offset_east_m, 2.0 * res_h5.offset_east_m, places=3)
        self.assertAlmostEqual(res_h20.offset_north_m, 4.0 * res_h5.offset_north_m, places=3)
        self.assertAlmostEqual(res_h20.offset_east_m, 4.0 * res_h5.offset_east_m, places=3)

        # 2. Bilateral Roll Symmetry:
        # At nadir pixel (640, 360) and yaw=0, +roll vs -roll should yield +East vs -East offset of identical magnitude
        res_roll_pos = self.georef.resolve_target(640.0, 360.0, lat0, lon0, 5.0, roll_deg=22.0, pitch_deg=0.0, yaw_deg=0.0)
        res_roll_neg = self.georef.resolve_target(640.0, 360.0, lat0, lon0, 5.0, roll_deg=-22.0, pitch_deg=0.0, yaw_deg=0.0)

        self.assertAlmostEqual(res_roll_pos.offset_north_m, res_roll_neg.offset_north_m, places=4)
        self.assertAlmostEqual(res_roll_pos.offset_east_m, -res_roll_neg.offset_east_m, places=4)
        self.assertAlmostEqual(res_roll_pos.ground_distance_m, res_roll_neg.ground_distance_m, places=4)

        # 3. Bilateral Pitch Symmetry:
        # At nadir pixel (640, 360) and yaw=0, +pitch vs -pitch should yield -North vs +North
        res_pitch_pos = self.georef.resolve_target(640.0, 360.0, lat0, lon0, 5.0, roll_deg=0.0, pitch_deg=22.0, yaw_deg=0.0)
        res_pitch_neg = self.georef.resolve_target(640.0, 360.0, lat0, lon0, 5.0, roll_deg=0.0, pitch_deg=-22.0, yaw_deg=0.0)

        self.assertAlmostEqual(res_pitch_pos.offset_east_m, res_pitch_neg.offset_east_m, places=4)
        self.assertAlmostEqual(res_pitch_pos.offset_north_m, -res_pitch_neg.offset_north_m, places=4)
        self.assertAlmostEqual(res_pitch_pos.ground_distance_m, res_pitch_neg.ground_distance_m, places=4)

        print("[TEST 5 PASS] Verified perfect mathematical linearity and bilateral Euler symmetry.")

    # =========================================================================
    # TEST 6: Lens Distortion Coefficients (Brown-Conrady Polynomial)
    # =========================================================================
    def test_optical_distortion_undistortion_stability(self):
        """Verifies numerical stability when radial/tangential distortion coefficients are supplied."""
        dist_camera = CameraIntrinsics3D(
            width=1280, height=720, hfov_deg=68.0, vfov_deg=54.0,
            dist_coeffs=np.array([-0.08, 0.04, -0.001, 0.001, 0.0], dtype=np.float64)
        )
        dist_georef = Georeferencer(dist_camera)

        test_points = [(640, 360), (100, 100), (1180, 620), (0, 0), (1280, 720)]
        for u, v in test_points:
            res = dist_georef.resolve_target(
                u=u, v=v, drone_lat=13.0827, drone_lon=80.2707, altitude_agl_m=5.0,
                roll_deg=10.0, pitch_deg=-10.0, yaw_deg=30.0
            )
            self._assert_no_nan_or_inf(res, f"Distorted ({u}, {v})")
            self.assertTrue(res.valid)

        # Center pixel (640, 360) distortion displacement should be negligible (< 0.001m)
        res_undist = self.georef.resolve_target(640, 360, 13.0827, 80.2707, 5.0, 0.0, 0.0, 0.0)
        res_dist = dist_georef.resolve_target(640, 360, 13.0827, 80.2707, 5.0, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(res_dist.offset_north_m, res_undist.offset_north_m, places=3)
        self.assertAlmostEqual(res_dist.offset_east_m, res_undist.offset_east_m, places=3)

        print("[TEST 6 PASS] Verified Brown-Conrady lens distortion stability and zero-center drift.")


if __name__ == "__main__":
    unittest.main()
