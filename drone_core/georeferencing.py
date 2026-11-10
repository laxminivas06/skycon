"""
Rigorous 3D Attitude-Compensated Georeferencing Engine (WGS84 Ellipsoidal)
Milestone 2: S500-AeroRecon Quadcopter System

Implements:
1. Pinhole camera intrinsic ray inversion with optical distortion support.
2. Rigid Camera-to-Body transformation matrix R_C^B (downward nadir camera).
3. Full 3D Euler attitude rotation matrix R_B^NED(phi, theta, psi).
4. Parametric ray intersection with flat ground plane at altitude H_agl.
5. WGS84 ellipsoidal forward projection via meridian M(phi) and prime vertical N(phi) radii of curvature.
6. Sub-meter precision matching golden test vectors (Center nadir, offset target, pitch-compensated cruise).
"""

import math
from dataclasses import dataclass, field
from typing import Optional, Tuple, Union
import numpy as np
import cv2


@dataclass
class CameraIntrinsics3D:
    """Optical parameters and intrinsic calibration for downward vision sensor."""
    width: int = 1280
    height: int = 720
    hfov_deg: float = 68.0
    vfov_deg: float = 54.0
    fx: Optional[float] = None
    fy: Optional[float] = None
    cx: Optional[float] = None
    cy: Optional[float] = None
    dist_coeffs: Optional[np.ndarray] = None  # [k1, k2, p1, p2, k3]
    sensor_model: str = "Sony IMX477"

    def __post_init__(self):
        if self.cx is None:
            self.cx = self.width / 2.0
        if self.cy is None:
            self.cy = self.height / 2.0
        if self.fx is None:
            self.fx = (self.width / 2.0) / math.tan(math.radians(self.hfov_deg / 2.0))
        if self.fy is None:
            self.fy = (self.height / 2.0) / math.tan(math.radians(self.vfov_deg / 2.0))


@dataclass
class GeoreferenceResult:
    """Complete georeferenced output with local metric offsets and WGS84 coordinates."""
    target_lat: float
    target_lon: float
    altitude_agl: float
    offset_north_m: float
    offset_east_m: float
    offset_body_x_m: float  # Forward (+) / Aft (-) in body frame
    offset_body_y_m: float  # Right (+) / Left (-) in body frame
    ground_distance_m: float
    ray_ned: Tuple[float, float, float]
    ray_body: Tuple[float, float, float]
    valid: bool = True
    error_message: Optional[str] = None


class Georeferencer:
    """
    Computes exact 3D attitude-compensated ground target coordinates from
    pixel coordinates (u, v), altitude AGL, and aircraft roll, pitch, yaw.
    """

    # WGS-84 Reference Ellipsoid Constants (EPSG:4326)
    WGS84_A = 6378137.0                      # Semi-major axis (meters)
    WGS84_F = 1.0 / 298.257223563            # Flattening
    WGS84_E2 = 2.0 * WGS84_F - WGS84_F ** 2  # First eccentricity squared (~0.00669437999014)

    # Rigid Camera-to-Body Transformation Matrix R_C^B
    # Downward camera: +X_cam (right) -> +Y_body (right)
    #                  +Y_cam (down)  -> -X_body (aft)
    #                  +Z_cam (optical down) -> +Z_body (down)
    R_C_B = np.array([
        [0.0, -1.0, 0.0],
        [1.0,  0.0, 0.0],
        [0.0,  0.0, 1.0]
    ], dtype=np.float64)

    def __init__(self, camera: Optional[CameraIntrinsics3D] = None):
        self.camera = camera or CameraIntrinsics3D()

    @staticmethod
    def rotation_matrix_body_to_ned(roll_rad: float, pitch_rad: float, yaw_rad: float) -> np.ndarray:
        """
        Computes the direction cosine matrix R_B^NED transforming coordinates
        from Aircraft Body Frame (X-forward, Y-right, Z-down) to Earth Local NED Frame
        using the aerospace Z-Y-X sequence: R_B^NED = R_z(yaw) * R_y(pitch) * R_x(roll).
        
        Note on pitch sign convention:
        In standard flight dynamics, pitch-down (theta < 0) tilts the body +Z axis forward (+X_B),
        which pitches the nadir optical axis forward towards the aircraft nose.
        """
        c_psi, s_psi = math.cos(yaw_rad), math.sin(yaw_rad)
        c_th, s_th = math.cos(pitch_rad), math.sin(pitch_rad)
        c_phi, s_phi = math.cos(roll_rad), math.sin(roll_rad)

        R_z = np.array([
            [c_psi, -s_psi, 0.0],
            [s_psi,  c_psi, 0.0],
            [0.0,    0.0,   1.0]
        ], dtype=np.float64)

        R_y = np.array([
            [c_th,  0.0, -s_th],
            [0.0,   1.0,  0.0],
            [s_th,  0.0,  c_th]
        ], dtype=np.float64)

        R_x = np.array([
            [1.0, 0.0,    0.0],
            [0.0, c_phi, -s_phi],
            [0.0, s_phi,  c_phi]
        ], dtype=np.float64)

        return R_z @ R_y @ R_x

    @classmethod
    def wgs84_radii_of_curvature(cls, lat_rad: float) -> Tuple[float, float]:
        """
        Calculates the WGS84 meridian radius of curvature M(phi) and
        prime vertical radius of curvature N(phi) at geodetic latitude phi.
        """
        sin_lat = math.sin(lat_rad)
        denom = 1.0 - cls.WGS84_E2 * (sin_lat ** 2)
        sqrt_denom = math.sqrt(denom)

        # Meridian radius of curvature (North-South direction)
        m = (cls.WGS84_A * (1.0 - cls.WGS84_E2)) / (denom * sqrt_denom)

        # Prime vertical radius of curvature (East-West direction)
        n = cls.WGS84_A / sqrt_denom

        return m, n

    @classmethod
    def metric_offset_to_wgs84(
        cls,
        drone_lat: float,
        drone_lon: float,
        delta_north_m: float,
        delta_east_m: float
    ) -> Tuple[float, float]:
        """
        Projects local metric North-East offsets (meters) into geodetic latitude
        and longitude (degrees) using exact WGS84 ellipsoidal curvatures.
        """
        phi_rad = math.radians(drone_lat)
        m, n = cls.wgs84_radii_of_curvature(phi_rad)

        cos_phi = math.cos(phi_rad)
        if abs(cos_phi) < 1e-9:
            # Extreme polar singularity guard
            cos_phi = 1e-9 if cos_phi >= 0 else -1e-9

        d_lat_deg = (delta_north_m / m) * (180.0 / math.pi)
        d_lon_deg = (delta_east_m / (n * cos_phi)) * (180.0 / math.pi)

        target_lat = round(drone_lat + d_lat_deg, 7)
        target_lon = round(drone_lon + d_lon_deg, 7)
        return target_lat, target_lon

    def resolve_target(
        self,
        u: float,
        v: float,
        drone_lat: float,
        drone_lon: float,
        altitude_agl_m: float,
        roll_deg: float,
        pitch_deg: float,
        yaw_deg: float
    ) -> GeoreferenceResult:
        """
        Transforms pixel centroid (u, v) into 3D attitude-compensated WGS84 target coordinates.
        
        Args:
            u: Horizontal pixel coordinate [0, width]
            v: Vertical pixel coordinate [0, height]
            drone_lat: Drone GPS geodetic latitude in degrees
            drone_lon: Drone GPS geodetic longitude in degrees
            altitude_agl_m: Current altitude above ground level in meters (H_agl)
            roll_deg: Aircraft roll angle in degrees (+right wing down)
            pitch_deg: Aircraft pitch angle in degrees (+nose up, -nose down)
            yaw_deg: Aircraft yaw heading in degrees (0..360 clockwise from North)
        """
        # Guard: Check for Null Island or invalid coordinates
        if abs(drone_lat) < 1e-6 and abs(drone_lon) < 1e-6:
            return GeoreferenceResult(
                target_lat=0.0,
                target_lon=0.0,
                altitude_agl=altitude_agl_m,
                offset_north_m=0.0,
                offset_east_m=0.0,
                offset_body_x_m=0.0,
                offset_body_y_m=0.0,
                ground_distance_m=0.0,
                ray_ned=(0.0, 0.0, 1.0),
                ray_body=(0.0, 0.0, 1.0),
                valid=False,
                error_message="Invalid GPS coordinates (Null Island detected: 0.0, 0.0)"
            )

        # Guard: Low altitude clamp
        h_eff = max(0.2, altitude_agl_m)

        # Step 1: Pinhole Ray Inversion in Camera Frame
        if self.camera.dist_coeffs is not None and len(self.camera.dist_coeffs) > 0:
            # Undistort points using OpenCV
            pts = np.array([[[u, v]]], dtype=np.float32)
            k_mat = np.array([
                [self.camera.fx, 0.0, self.camera.cx],
                [0.0, self.camera.fy, self.camera.cy],
                [0.0, 0.0, 1.0]
            ], dtype=np.float32)
            undistorted = cv2.undistortPoints(pts, k_mat, self.camera.dist_coeffs)
            x_c = float(undistorted[0, 0, 0])
            y_c = float(undistorted[0, 0, 1])
        else:
            x_c = (u - self.camera.cx) / self.camera.fx
            y_c = (v - self.camera.cy) / self.camera.fy

        r_c = np.array([x_c, y_c, 1.0], dtype=np.float64)

        # Step 2: Camera to Body Frame Transformation (R_C^B)
        r_b = self.R_C_B @ r_c
        offset_body_x_norm = float(r_b[0])
        offset_body_y_norm = float(r_b[1])

        # Step 3: Body Frame to Local NED Frame (Attitude Compensation)
        roll_rad = math.radians(roll_deg)
        pitch_rad = math.radians(pitch_deg)
        yaw_rad = math.radians(yaw_deg % 360.0)

        R_b_ned = self.rotation_matrix_body_to_ned(roll_rad, pitch_rad, yaw_rad)
        v_ned = R_b_ned @ r_b
        v_N, v_E, v_D = float(v_ned[0]), float(v_ned[1]), float(v_ned[2])

        # Step 4: Ground Plane Intersection (Z_NED = 0)
        # Ray equation: p(t) = (0, 0, -H) + lambda * (v_N, v_E, v_D)
        # Intersection at Z = 0: -H + lambda * v_D = 0 => lambda = H / v_D
        if v_D <= 0.05:
            # Ray is pointing near horizontal or upwards (no ground intersection)
            return GeoreferenceResult(
                target_lat=drone_lat,
                target_lon=drone_lon,
                altitude_agl=altitude_agl_m,
                offset_north_m=0.0,
                offset_east_m=0.0,
                offset_body_x_m=0.0,
                offset_body_y_m=0.0,
                ground_distance_m=0.0,
                ray_ned=(v_N, v_E, v_D),
                ray_body=(float(r_b[0]), float(r_b[1]), float(r_b[2])),
                valid=False,
                error_message=f"Ray does not intersect ground plane (v_D = {v_D:.3f} <= 0.05)"
            )

        lam = h_eff / v_D
        delta_north = lam * v_N
        delta_east = lam * v_E
        ground_dist = math.sqrt(delta_north ** 2 + delta_east ** 2)

        # Scale body offsets to metric distance
        offset_body_x = offset_body_x_norm * h_eff
        offset_body_y = offset_body_y_norm * h_eff

        # Step 5: WGS84 Geodetic Forward Projection
        target_lat, target_lon = self.metric_offset_to_wgs84(
            drone_lat=drone_lat,
            drone_lon=drone_lon,
            delta_north_m=delta_north,
            delta_east_m=delta_east
        )

        return GeoreferenceResult(
            target_lat=target_lat,
            target_lon=target_lon,
            altitude_agl=round(altitude_agl_m, 2),
            offset_north_m=round(delta_north, 4),
            offset_east_m=round(delta_east, 4),
            offset_body_x_m=round(offset_body_x, 4),
            offset_body_y_m=round(offset_body_y, 4),
            ground_distance_m=round(ground_dist, 4),
            ray_ned=(round(v_N, 5), round(v_E, 5), round(v_D, 5)),
            ray_body=(round(float(r_b[0]), 5), round(float(r_b[1]), 5), round(float(r_b[2]), 5)),
            valid=True
        )
