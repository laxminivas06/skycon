"""
WeChatQRCode Deep CNN & Subpixel Corner Refinement QR Detection Engine
Milestone 2: S500-AeroRecon Quadcopter System

Implements:
1. WeChatQRCode deep CNN barcode detector with graceful fallback to OpenCV QRCodeDetector.
2. Multi-pass image enhancement: CLAHE, Unsharp Masking, Otsu Adaptive Binarization, Perspective Rectification.
3. Subpixel corner refinement via cv2.cornerSubPix (winSize=5x5, max_iter=40, eps=0.005).
4. Analytical diagonal line intersection centroid calculation (resolving true optical centroid under perspective warp).
5. Two-digit competition rescue code extraction (e.g. 'SAE_INDIA_RESCUE_42' -> '42').
"""

import os
import re
import time
import logging
from dataclasses import dataclass
from typing import Optional, Tuple, List, Dict, Any, Union
import numpy as np
import cv2

logger = logging.getLogger("QRDetector")


@dataclass
class QRDetectionResult:
    """Rich detection record containing decoded payload, subpixel centroid, and corners."""
    payload: str
    two_digit_code: str
    centroid_u: float
    centroid_v: float
    corners: np.ndarray             # Subpixel refined (4, 2)
    bounding_box: Tuple[int, int, int, int]  # (x, y, width, height)
    method: str
    verified: bool
    execution_time_ms: float


class WeChatQRDetector:
    """
    Robust multi-stage QR code detection and subpixel centroid extraction engine.
    Handles high perspective tilt, motion blur, and low-contrast edge lighting.
    """

    def __init__(
        self,
        detect_prototxt: Optional[str] = None,
        detect_caffemodel: Optional[str] = None,
        sr_prototxt: Optional[str] = None,
        sr_caffemodel: Optional[str] = None,
        rescue_code_regex: str = r"(?:.*?)(\d{2})(?:.*?)"
    ):
        self.rescue_regex = re.compile(rescue_code_regex)
        self.use_wechat = False
        self.wechat_detector = None

        # Check for OpenCV WeChatQRCode availability
        if hasattr(cv2, "wechat_qrcode") and hasattr(cv2.wechat_qrcode, "WeChatQRCode"):
            try:
                # If model weights exist, load them
                args = []
                if (detect_prototxt and os.path.exists(detect_prototxt) and
                        detect_caffemodel and os.path.exists(detect_caffemodel)):
                    args = [detect_prototxt, detect_caffemodel]
                    if sr_prototxt and os.path.exists(sr_prototxt) and sr_caffemodel and os.path.exists(sr_caffemodel):
                        args.extend([sr_prototxt, sr_caffemodel])
                self.wechat_detector = cv2.wechat_qrcode.WeChatQRCode(*args)
                self.use_wechat = True
                logger.info("WeChatQRCode detector initialized successfully (model_args=%d)", len(args))
            except Exception as e:
                logger.warning("WeChatQRCode initialization failed (%s), falling back to QRCodeDetector", e)

        # Standard OpenCV detector fallback
        self.standard_detector = cv2.QRCodeDetector()

    def detect_and_decode(self, frame: np.ndarray) -> Optional[QRDetectionResult]:
        """
        Executes multi-pass detection pipeline and returns verified QRDetectionResult.
        
        Pipeline:
        Pass 1: Direct Deep CNN / Standard decode on raw grayscale
        Pass 2: CLAHE contrast enhancement + Unsharp masking filter
        Pass 3: Otsu adaptive binarization (standard and inverted)
        Pass 4: Perspective quadrilateral rectification
        """
        t0 = time.perf_counter()

        if frame is None or frame.size == 0:
            return None

        # Prepare grayscale image
        if len(frame.shape) == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame

        h, w = gray.shape[:2]

        # -------------------------------------------------------------
        # PASS 1: Raw Grayscale
        # -------------------------------------------------------------
        payload, points, method = self._decode_variant(gray, "PASS1_RAW")
        if payload is None:
            # ---------------------------------------------------------
            # PASS 2: CLAHE + Unsharp Masking
            # ---------------------------------------------------------
            clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)

            # Unsharp filter kernel
            sharp_kernel = np.array([
                [0, -1, 0],
                [-1, 5, -1],
                [0, -1, 0]
            ], dtype=np.float32)
            sharpened = cv2.filter2D(enhanced, -1, sharp_kernel)

            payload, points, method = self._decode_variant(sharpened, "PASS2_CLAHE_SHARP")

        if payload is None:
            # ---------------------------------------------------------
            # PASS 3: Otsu Adaptive Binarization
            # ---------------------------------------------------------
            blurred = cv2.GaussianBlur(gray, (3, 3), 0)
            _, otsu_bin = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            payload, points, method = self._decode_variant(otsu_bin, "PASS3_OTSU")

            if payload is None:
                # Inverted Otsu
                otsu_inv = cv2.bitwise_not(otsu_bin)
                payload, points, method = self._decode_variant(otsu_inv, "PASS3_OTSU_INV")

        if payload is None:
            # ---------------------------------------------------------
            # PASS 4: Candidate Contour Warping / Perspective Search
            # ---------------------------------------------------------
            payload, points, method = self._search_and_rectify_quad(gray)

        if payload is None or points is None or len(points) == 0:
            return None

        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        # Subpixel Corner Refinement & Centroid Extraction
        refined_corners, (uc, vc), bbox = self._refine_corners_and_centroid(gray, points)

        # Extract 2-digit rescue code
        two_digit = self.extract_two_digit_code(payload)
        verified = bool(two_digit is not None)

        return QRDetectionResult(
            payload=payload,
            two_digit_code=two_digit or "",
            centroid_u=round(uc, 2),
            centroid_v=round(vc, 2),
            corners=refined_corners,
            bounding_box=bbox,
            method=method,
            verified=verified,
            execution_time_ms=round(elapsed_ms, 2)
        )

    def _decode_variant(self, image: np.ndarray, method_name: str) -> Tuple[Optional[str], Optional[np.ndarray], str]:
        """Tries decoding on a single image variant using WeChatQRCode or standard QRCodeDetector."""
        if self.use_wechat and self.wechat_detector is not None:
            try:
                res, points = self.wechat_detector.detectAndDecode(image)
                if res and len(res) > 0 and len(res[0].strip()) > 0:
                    pts = points[0] if points is not None and len(points) > 0 else None
                    return res[0].strip(), pts, f"WECHAT_{method_name}"
            except Exception:
                pass

        try:
            text, points, _ = self.standard_detector.detectAndDecode(image)
            if text and len(text.strip()) > 0:
                pts = points[0] if (points is not None and len(points.shape) == 3) else points
                return text.strip(), pts, f"STANDARD_{method_name}"
        except Exception:
            pass

        return None, None, method_name

    def _search_and_rectify_quad(self, gray: np.ndarray) -> Tuple[Optional[str], Optional[np.ndarray], str]:
        """Searches for quadrilateral candidate contours, warps perspective to 256x256, and decodes."""
        h, w = gray.shape[:2]
        thresh = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 5
        )
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < (w * h * 0.002) or area > (w * h * 0.7):
                continue

            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)

            if len(approx) == 4:
                # Candidate quadrilateral
                pts = approx.reshape(4, 2).astype(np.float32)
                # Order points: top-left, top-right, bottom-right, bottom-left
                ordered_pts = self._order_quad_points(pts)

                dst_size = 256
                dst_pts = np.array([
                    [0, 0],
                    [dst_size - 1, 0],
                    [dst_size - 1, dst_size - 1],
                    [0, dst_size - 1]
                ], dtype=np.float32)

                m_warp = cv2.getPerspectiveTransform(ordered_pts, dst_pts)
                warped = cv2.warpPerspective(gray, m_warp, (dst_size, dst_size))

                payload, _, _ = self._decode_variant(warped, "PASS4_WARP")
                if payload is not None:
                    return payload, ordered_pts, "PASS4_WARPED_QUAD"

        return None, None, "PASS4_FAILED"

    @staticmethod
    def _order_quad_points(pts: np.ndarray) -> np.ndarray:
        """Orders 4 points into clockwise [top-left, top-right, bottom-right, bottom-left]."""
        rect = np.zeros((4, 2), dtype=np.float32)
        # Sum of coords: top-left has smallest sum, bottom-right has largest sum
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]

        # Difference of coords: top-right has smallest diff (y - x), bottom-left has largest diff
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        return rect

    def _refine_corners_and_centroid(
        self,
        gray: np.ndarray,
        points: np.ndarray
    ) -> Tuple[np.ndarray, Tuple[float, float], Tuple[int, int, int, int]]:
        """
        Applies cv2.cornerSubPix to the 4 finder corners and computes
        the analytical diagonal intersection centroid.
        """
        pts = np.array(points, dtype=np.float32).reshape(-1, 2)
        if len(pts) != 4:
            pts = pts[:4]

        ordered_pts = self._order_quad_points(pts)

        # 1. Corner Subpixel Refinement
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.005)
        try:
            # Reshape to (4, 1, 2) for cornerSubPix
            subpix_input = ordered_pts.reshape(-1, 1, 2)
            cv2.cornerSubPix(gray, subpix_input, winSize=(5, 5), zeroZone=(-1, -1), criteria=criteria)
            refined = subpix_input.reshape(4, 2)
        except Exception:
            refined = ordered_pts

        # 2. Analytical Diagonal Intersection Centroid
        # L1: P0 (top-left) -> P2 (bottom-right)
        # L2: P1 (top-right) -> P3 (bottom-left)
        x0, y0 = refined[0]
        x1, y1 = refined[1]
        x2, y2 = refined[2]
        x3, y3 = refined[3]

        a1 = y2 - y0
        b1 = -(x2 - x0)
        c1 = x2 * y0 - x0 * y2

        a2 = y3 - y1
        b2 = -(x3 - x1)
        c2 = x3 * y1 - x1 * y3

        det = a1 * b2 - a2 * b1
        if abs(det) > 1e-6:
            uc = (b1 * c2 - b2 * c1) / det
            vc = (c1 * a2 - c2 * a1) / det
        else:
            # Degenerate lines: fallback to arithmetic mean
            uc = float(np.mean(refined[:, 0]))
            vc = float(np.mean(refined[:, 1]))

        # Bounding box
        min_x = int(max(0, np.min(refined[:, 0])))
        min_y = int(max(0, np.min(refined[:, 1])))
        max_x = int(min(gray.shape[1], np.max(refined[:, 0])))
        max_y = int(min(gray.shape[0], np.max(refined[:, 1])))
        bbox = (min_x, min_y, max(1, max_x - min_x), max(1, max_y - min_y))

        return refined, (float(uc), float(vc)), bbox

    def extract_two_digit_code(self, payload: str) -> Optional[str]:
        """Extracts the 2-digit competition rescue code from raw payload text."""
        if not payload:
            return None
        match = self.rescue_regex.search(payload.strip())
        if match:
            return match.group(1)
        # If payload is itself digits
        digits = "".join(filter(str.isdigit, payload))
        if len(digits) >= 2:
            return digits[:2]
        return None
