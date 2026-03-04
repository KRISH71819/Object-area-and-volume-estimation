"""
Measurement Module
Calculates area and volume from mask and depth data
Uses reference object for real-world scale calibration
"""

import numpy as np
import cv2
from dataclasses import dataclass
from typing import Tuple, Optional

# Reference object dimensions in cm
REFERENCE_OBJECTS = {
    "coin_10_inr": {"diameter": 2.75, "type": "circle"},      # ₹10 coin
    "coin_5_inr": {"diameter": 2.3, "type": "circle"},        # ₹5 coin
    "coin_2_inr": {"diameter": 2.5, "type": "circle"},        # ₹2 coin
    "coin_1_inr": {"diameter": 2.1, "type": "circle"},        # ₹1 coin
    "credit_card": {"width": 8.56, "height": 5.398, "type": "rectangle"},  # Standard credit card
    "a4_paper": {"width": 29.7, "height": 21.0, "type": "rectangle"},     # A4 paper
}

@dataclass
class MeasurementResult:
    """Container for measurement results"""
    area_cm2: float
    volume_cm3: float
    width_cm: float
    height_cm: float
    depth_avg_cm: float
    pixels_per_cm: float
    
    def to_dict(self):
        return {
            "area_cm2": round(float(self.area_cm2), 2),
            "volume_cm3": round(float(self.volume_cm3), 2),
            "width_cm": round(float(self.width_cm), 2),
            "height_cm": round(float(self.height_cm), 2),
            "depth_avg_cm": round(float(self.depth_avg_cm), 2),
            "pixels_per_cm": round(float(self.pixels_per_cm), 2)
        }

def calculate_pixels_per_cm(ref_mask: np.ndarray, ref_type: str) -> float:
    """
    Calculate pixels per cm using reference object mask
    
    Args:
        ref_mask: Binary mask of reference object
        ref_type: Type of reference object (e.g., "coin_10_inr")
    
    Returns:
        pixels_per_cm: Calibration factor
    """
    ref_info = REFERENCE_OBJECTS.get(ref_type)
    if ref_info is None:
        raise ValueError(f"Unknown reference object: {ref_type}")
    
    # Find contours
    contours, _ = cv2.findContours(ref_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No contours found in reference mask")
    
    # Get the largest contour
    largest_contour = max(contours, key=cv2.contourArea)
    
    if ref_info["type"] == "circle":
        # Fit circle to contour
        (x, y), radius = cv2.minEnclosingCircle(largest_contour)
        pixel_diameter = radius * 2
        real_diameter = ref_info["diameter"]
        pixels_per_cm = pixel_diameter / real_diameter
        
    elif ref_info["type"] == "rectangle":
        # Fit rectangle to contour
        rect = cv2.minAreaRect(largest_contour)
        width_px, height_px = rect[1]
        
        # Match dimensions
        real_width = ref_info["width"]
        real_height = ref_info["height"]
        
        # Average of both dimensions for better accuracy
        pixels_per_cm = ((width_px / real_width) + (height_px / real_height)) / 2
    
    return pixels_per_cm

def calculate_area(mask: np.ndarray, pixels_per_cm: float) -> float:
    """
    Calculate real-world area of masked object
    
    Args:
        mask: Binary mask of object
        pixels_per_cm: Calibration factor
    
    Returns:
        Area in cm²
    """
    pixel_count = np.sum(mask > 127)
    pixel_area_cm2 = 1 / (pixels_per_cm ** 2)
    area_cm2 = pixel_count * pixel_area_cm2
    return area_cm2

def calculate_dimensions(mask: np.ndarray, pixels_per_cm: float) -> Tuple[float, float]:
    """
    Calculate bounding box dimensions of object
    
    Returns:
        (width_cm, height_cm)
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0, 0
    
    largest_contour = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(largest_contour)
    width_px, height_px = rect[1]
    
    width_cm = width_px / pixels_per_cm
    height_cm = height_px / pixels_per_cm
    
    return width_cm, height_cm

def calculate_volume(mask: np.ndarray, depth: np.ndarray, pixels_per_cm: float, 
                     depth_scale: float = 30.0) -> Tuple[float, float]:
    """
    Estimate volume using mask and depth map
    
    The depth_scale factor converts normalized depth (0-1) to approximate cm.
    This is calibrated based on typical object sizes.
    
    Args:
        mask: Binary mask of object
        depth: Normalized depth map (0-1, higher = closer)
        pixels_per_cm: Calibration factor from reference object
        depth_scale: Factor to convert depth units to cm (adjustable)
    
    Returns:
        (volume_cm3, avg_depth_cm)
    """
    mask_bool = mask > 127
    
    if not np.any(mask_bool):
        return 0, 0
    
    # Get depth values within mask
    masked_depth = depth[mask_bool]
    
    # Calculate relative depth (subtract background)
    depth_min = np.percentile(masked_depth, 5)
    depth_max = np.percentile(masked_depth, 95)
    relative_depth = depth_max - depth_min
    
    # Average depth in the mask area
    avg_depth = np.mean(masked_depth)
    
    # Convert to real-world depth (approximate)
    depth_cm = relative_depth * depth_scale
    avg_depth_cm = avg_depth * depth_scale
    
    # Calculate volume using depth integration
    # Volume ≈ sum of (pixel_area × depth) for each pixel
    pixel_area_cm2 = 1 / (pixels_per_cm ** 2)
    
    # Integrate depth over the mask
    depth_values = depth[mask_bool] * depth_scale
    volume_cm3 = np.sum(depth_values) * pixel_area_cm2
    
    # Alternative: approximate as width × height × depth
    # This is a simpler estimation for roughly box-shaped objects
    width_cm, height_cm = calculate_dimensions(mask, pixels_per_cm)
    simple_volume = width_cm * height_cm * depth_cm * 0.6  # 0.6 accounts for non-box shapes
    
    # Return the average of both methods
    estimated_volume = (volume_cm3 + simple_volume) / 2
    
    return estimated_volume, avg_depth_cm

def measure_object(
    object_mask: np.ndarray, 
    depth_map: np.ndarray,
    ref_mask: Optional[np.ndarray] = None,
    ref_type: str = "coin_10_inr",
    default_pixels_per_cm: float = 50.0
) -> MeasurementResult:
    """
    Complete measurement of an object
    
    Args:
        object_mask: Binary mask of the object to measure
        depth_map: Depth map from MiDaS
        ref_mask: Optional binary mask of reference object
        ref_type: Type of reference object
        default_pixels_per_cm: Default if no reference provided
    
    Returns:
        MeasurementResult with all measurements
    """
    # Calibrate using reference if provided
    if ref_mask is not None:
        try:
            pixels_per_cm = calculate_pixels_per_cm(ref_mask, ref_type)
        except (ValueError, Exception) as e:
            print(f"Warning: Could not calibrate with reference ({e}), using default")
            pixels_per_cm = default_pixels_per_cm
    else:
        pixels_per_cm = default_pixels_per_cm
    
    # Calculate measurements
    area_cm2 = calculate_area(object_mask, pixels_per_cm)
    width_cm, height_cm = calculate_dimensions(object_mask, pixels_per_cm)
    volume_cm3, avg_depth_cm = calculate_volume(object_mask, depth_map, pixels_per_cm)
    
    return MeasurementResult(
        area_cm2=area_cm2,
        volume_cm3=volume_cm3,
        width_cm=width_cm,
        height_cm=height_cm,
        depth_avg_cm=avg_depth_cm,
        pixels_per_cm=pixels_per_cm
    )

def generate_3d_mesh_data(mask: np.ndarray, depth: np.ndarray, 
                           pixels_per_cm: float, scale: float = 0.01) -> dict:
    """
    Generate 3D mesh data for Three.js visualization
    
    Returns dict with vertices and faces for a simple 3D representation
    """
    # Downsample for performance
    mask_small = cv2.resize(mask, (64, 64), interpolation=cv2.INTER_NEAREST)
    depth_small = cv2.resize(depth, (64, 64), interpolation=cv2.INTER_LINEAR)
    
    vertices = []
    indices = []
    
    h, w = mask_small.shape
    vertex_map = {}  # (x, y) -> vertex index
    
    # Create vertices for each point in mask
    for y in range(h):
        for x in range(w):
            if mask_small[y, x] > 127:
                z = depth_small[y, x] * 10  # Scale depth
                vertex_map[(x, y)] = len(vertices)
                vertices.extend([
                    float((x - w/2) * scale),
                    float((h/2 - y) * scale),
                    float(z * scale)
                ])
    
    # Create faces (triangles)
    for y in range(h - 1):
        for x in range(w - 1):
            if all((x+dx, y+dy) in vertex_map for dx in [0, 1] for dy in [0, 1]):
                # Two triangles per quad
                v00 = vertex_map[(x, y)]
                v10 = vertex_map[(x+1, y)]
                v01 = vertex_map[(x, y+1)]
                v11 = vertex_map[(x+1, y+1)]
                
                indices.extend([v00, v10, v01])
                indices.extend([v10, v11, v01])
    
    return {
        "vertices": vertices,
        "indices": indices,
        "vertex_count": len(vertices) // 3,
        "face_count": len(indices) // 3
    }


def measure_object_area(
    object_mask: np.ndarray,
    ref_mask: Optional[np.ndarray] = None,
    ref_type: str = "coin_10_inr",
    default_pixels_per_cm: float = 50.0
) -> dict:
    """
    Simplified measurement: compute area only using reference object for scale.
    No depth map needed.
    
    Args:
        object_mask: Binary mask of the object
        ref_mask: Optional binary mask of reference object
        ref_type: Type of reference object
        default_pixels_per_cm: Fallback if no reference mask
    
    Returns:
        Dict with area_cm2, width_cm, height_cm, pixels_per_cm
    """
    # Get scale from reference object
    if ref_mask is not None:
        try:
            pixels_per_cm = calculate_pixels_per_cm(ref_mask, ref_type)
        except Exception as e:
            print(f"Scale calibration failed: {e}, using default")
            pixels_per_cm = default_pixels_per_cm
    else:
        pixels_per_cm = default_pixels_per_cm
    
    # Calculate area
    area_cm2 = calculate_area(object_mask, pixels_per_cm)
    
    # Calculate dimensions
    width_cm, height_cm = calculate_dimensions(object_mask, pixels_per_cm)
    
    return {
        "area_cm2": round(float(area_cm2), 2),
        "width_cm": round(float(width_cm), 2),
        "height_cm": round(float(height_cm), 2),
        "pixels_per_cm": round(float(pixels_per_cm), 2),
    }

