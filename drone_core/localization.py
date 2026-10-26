"""
Local Target Resolution Pipeline (Pinhole Intrinsics & Geodesic Projection)
"""

import math
from dataclasses import dataclass
from typing import Tuple, Optional
from .config import CameraIntrinsics


@dataclass
class TargetDisplacement:
    target_lat: float
    target_lon: float
    offset_north_m: float
    offset_east_m: float
    offset_body_x_m: float  # Forward (+) / Backward (-)
    offset_body_y_m: float  # Right (+) / Left (-)
    ground_distance_m: float


class PinholeTargetResolver:
    """
    Computes real-world coordinate displacement from pixel coordinates,
    pinhole camera intrinsics, gimbal attitude, drone altitude and heading.
    """

    def __init__(self, camera: Optional[CameraIntrinsics] = None):
        self.camera = camera or CameraIntrinsics()

    def pixel_to_body_offset(
        self,
        u: float,
        v: float,
        altitude_m: float,
        gimbal_pitch_deg: float = 0.0,
        gimbal_roll_deg: float = 0.0,
        zoom_factor: float = 1.0
    ) -> Tuple[float, float]:
        """
        Convert pixel (u, v) to drone body-frame offset (dx_body_forward, dy_body_right) in meters.
        
        Args:
            u: Horizontal pixel coordinate [0, width]
            v: Vertical pixel coordinate [0, height]
            altitude_m: Altitude AGL in meters
            gimbal_pitch_deg: Gimbal pitch relative to nadir (0° = straight down)
            gimbal_roll_deg: Gimbal roll (0° = level)
            zoom_factor: Optical/digital zoom factor (scales focal length)
        """
        if altitude_m <= 0:
            altitude_m = 0.1  # Guard against division by zero

        # Effective focal lengths scaled by zoom
        effective_fx = self.camera.fx * max(0.5, zoom_factor)
        effective_fy = self.camera.fy * max(0.5, zoom_factor)

        # Normalized coordinates in camera optical frame (+Z optical axis down)
        x_c = (u - self.camera.cx) / effective_fx
        y_c = (v - self.camera.cy) / effective_fy

        # Gimbal rotation corrections
        pitch_rad = math.radians(gimbal_pitch_deg)
        roll_rad = math.radians(gimbal_roll_deg)

        # Camera frame (+X right, +Y down, +Z forward/down) to Body frame (+X forward, +Y right, +Z down)
        # Without gimbal rotation (nadir camera):
        # body_x = -y_c * altitude
        # body_y =  x_c * altitude
        # With small-angle/exact gimbal rotation:
        # Ray vector in camera frame
        ray_c = [x_c, y_c, 1.0]

        # Gimbal pitch/roll rotation on ray
        # Rotation around X_cam (pitch):
        cos_p, sin_p = math.cos(pitch_rad), math.sin(pitch_rad)
        cos_r, sin_r = math.cos(roll_rad), math.sin(roll_rad)

        # Apply gimbal tilt: Pitch tilts along optical axis
        y_c_rot = y_c * cos_p - 1.0 * sin_p
        z_c_rot = y_c * sin_p + 1.0 * cos_p

        x_c_rot = x_c * cos_r + z_c_rot * sin_r
        z_c_rot = -x_c * sin_r + z_c_rot * cos_r

        # Scale ray to ground plane (Z_body = altitude)
        z_c_rot = max(0.01, z_c_rot)
        scale = altitude_m / z_c_rot

        # In Body frame: Forward (+X) corresponds to -Y_cam, Right (+Y) corresponds to +X_cam
        offset_body_x = -y_c_rot * scale
        offset_body_y = x_c_rot * scale

        return offset_body_x, offset_body_y

    def resolve_target(
        self,
        u: float,
        v: float,
        drone_lat: float,
        drone_lon: float,
        altitude_m: float,
        heading_deg: float,
        gimbal_pitch_deg: float = 0.0,
        gimbal_roll_deg: float = 0.0,
        zoom_factor: float = 1.0
    ) -> TargetDisplacement:
        """
        Converts pixel centroid (u, v) to body offset, NED displacement,
        and absolute WGS-84 coordinates.
        """
        body_x, body_y = self.pixel_to_body_offset(
            u, v, altitude_m, gimbal_pitch_deg, gimbal_roll_deg, zoom_factor
        )

        # Rotate body-frame offsets by drone yaw heading (ψ) to Earth NED frame (North, East)
        heading_rad = math.radians(heading_deg)
        cos_h = math.cos(heading_rad)
        sin_h = math.sin(heading_rad)

        delta_north = body_x * cos_h - body_y * sin_h
        delta_east = body_x * sin_h + body_y * cos_h
        ground_dist = math.sqrt(delta_north ** 2 + delta_east ** 2)

        # WGS-84 Geodesic Conversion (WGS-84 semi-major axis ~6378137m)
        r_earth = 6378137.0
        d_lat = (delta_north / r_earth) * (180.0 / math.pi)
        d_lon = (delta_east / (r_earth * math.cos(math.radians(drone_lat)))) * (180.0 / math.pi)

        target_lat = round(drone_lat + d_lat, 7)
        target_lon = round(drone_lon + d_lon, 7)

        return TargetDisplacement(
            target_lat=target_lat,
            target_lon=target_lon,
            offset_north_m=round(delta_north, 2),
            offset_east_m=round(delta_east, 2),
            offset_body_x_m=round(body_x, 2),
            offset_body_y_m=round(body_y, 2),
            ground_distance_m=round(ground_dist, 2)
        )


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes high-precision haversine distance in meters between two coordinates."""
    r_earth = 6378137.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r_earth * c
