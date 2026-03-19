
"""
SAM (Segment Anything Model) Integration
Provides both click-to-segment and draw boundary modes
"""

import numpy as np
from PIL import Image
import torch
import cv2

# Global model holder
sam_model = None
sam_predictor = None

def load_sam_model():
    """Load SAM model (called once at startup)"""
    global sam_model, sam_predictor
    
    from segment_anything import sam_model_registry, SamPredictor
    import os
    import urllib.request
    
    # Use ViT-B for faster inference (good balance of speed/quality)
    model_type = "vit_b"
    
    # Use absolute path relative to this script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, "models")
    checkpoint_path = os.path.join(models_dir, "sam_vit_b.pth")
    
    # Auto-download if not present
    if not os.path.exists(checkpoint_path):
        os.makedirs(models_dir, exist_ok=True)
        url = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
        print(f"Downloading SAM model (~375MB)...")
        print(f"From: {url}")
        print(f"To: {checkpoint_path}")
        
        import sys
        def report_hook(count, block_size, total_size):
            if total_size > 0:
                percent = min(100, int(count * block_size * 100 / total_size))
                sys.stdout.write(f"\rDownloading... {percent}%")
                sys.stdout.flush()
                
        urllib.request.urlretrieve(url, checkpoint_path, reporthook=report_hook)
        print("\nDownload complete!")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading SAM model on {device}...")
    
    sam_model = sam_model_registry[model_type](checkpoint=checkpoint_path)
    sam_model.to(device)
    sam_predictor = SamPredictor(sam_model)
    
    print("SAM model loaded successfully!")
    return sam_predictor

def get_predictor():
    """Get or initialize SAM predictor"""
    global sam_predictor
    if sam_predictor is None:
        load_sam_model()
    return sam_predictor

def segment_by_click(image: np.ndarray, click_points: list, click_labels: list = None) -> np.ndarray:
    """
    Segment object by click points
    
    Args:
        image: RGB image as numpy array (H, W, 3)
        click_points: List of [x, y] coordinates where user clicked
        click_labels: List of labels (1 = foreground, 0 = background)
    
    Returns:
        Binary mask as numpy array (H, W)
    """
    predictor = get_predictor()
    predictor.set_image(image)
    
    points = np.array(click_points)
    labels = np.array(click_labels) if click_labels else np.ones(len(click_points))
    
    masks, scores, _ = predictor.predict(
        point_coords=points,
        point_labels=labels,
        multimask_output=True
    )
    
    # Return the mask with highest score
    best_mask_idx = np.argmax(scores)
    return masks[best_mask_idx].astype(np.uint8) * 255

def segment_by_box(image: np.ndarray, box: list) -> np.ndarray:
    """
    Segment object by bounding box (draw mode)
    
    Args:
        image: RGB image as numpy array (H, W, 3)
        box: [x1, y1, x2, y2] bounding box coordinates
    
    Returns:
        Binary mask as numpy array (H, W)
    """
    predictor = get_predictor()
    predictor.set_image(image)
    
    box_array = np.array(box)
    
    masks, scores, _ = predictor.predict(
        box=box_array,
        multimask_output=True
    )
    
    # Return the mask with highest score
    best_mask_idx = np.argmax(scores)
    return masks[best_mask_idx].astype(np.uint8) * 255

def segment_by_polygon(image: np.ndarray, polygon_points: list) -> np.ndarray:
    """
    Segment object by user-drawn polygon (like doc scanner)
    Uses polygon as initial mask, then refines with SAM
    
    Args:
        image: RGB image as numpy array (H, W, 3)
        polygon_points: List of [x, y] points forming a polygon
    
    Returns:
        Binary mask as numpy array (H, W)
    """
    h, w = image.shape[:2]
    
    # Create initial mask from polygon
    polygon = np.array(polygon_points, dtype=np.int32)
    initial_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(initial_mask, [polygon], 255)
    
    # Get bounding box from polygon
    x_coords = [p[0] for p in polygon_points]
    y_coords = [p[1] for p in polygon_points]
    box = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
    
    # Get center point for SAM
    center_x = (box[0] + box[2]) // 2
    center_y = (box[1] + box[3]) // 2
    
    # Use SAM with both box and center point for refinement
    predictor = get_predictor()
    predictor.set_image(image)
    
    masks, scores, _ = predictor.predict(
        point_coords=np.array([[center_x, center_y]]),
        point_labels=np.array([1]),
        box=np.array(box),
        multimask_output=True
    )
    
    best_mask_idx = np.argmax(scores)
    return masks[best_mask_idx].astype(np.uint8) * 255

def create_mask_overlay(image: np.ndarray, mask: np.ndarray, color=(0, 255, 0), alpha=0.5) -> np.ndarray:
    """Create visualization with mask overlay on image"""
    overlay = image.copy()
    mask_bool = mask > 127
    overlay[mask_bool] = (
        overlay[mask_bool] * (1 - alpha) + 
        np.array(color) * alpha
    ).astype(np.uint8)
    
    # Add contour
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay, contours, -1, color, 2)
    
    return overlay
