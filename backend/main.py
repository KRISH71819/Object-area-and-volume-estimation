"""
PixScale - FastAPI Backend
Main server handling image upload, segmentation, and area measurement
"""

import io
import json
import base64
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

# Initialize FastAPI app
app = FastAPI(
    title="PixScale API",
    description="AI-powered area measurement with SAM segmentation",
    version="2.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy load models to save memory
models_loaded = False

def ensure_models_loaded():
    """Load SAM model on first request"""
    global models_loaded
    if not models_loaded:
        print("Loading SAM model... This may take a minute.")
        from segmentation import load_sam_model
        load_sam_model()
        models_loaded = True
        print("SAM model loaded successfully!")

def image_to_base64(image: np.ndarray) -> str:
    """Convert numpy array to base64 encoded PNG"""
    pil_img = Image.fromarray(image)
    buffer = io.BytesIO()
    pil_img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()

def base64_to_image(b64_string: str) -> np.ndarray:
    """Convert base64 string to numpy array"""
    img_data = base64.b64decode(b64_string)
    img = Image.open(io.BytesIO(img_data))
    return np.array(img.convert("RGB"))

@app.get("/", response_class=HTMLResponse)
async def root():
    """API info page"""
    return """
    <html>
        <body style="font-family: system-ui; max-width: 600px; margin: 40px auto;">
            <h1>PixScale API</h1>
            <p>AI-powered area measurement backend</p>
            <h3>Endpoints:</h3>
            <ul>
                <li>POST /segment/click - Segment by click points</li>
                <li>POST /segment/box - Segment by bounding box</li>
                <li>POST /segment/polygon - Segment by drawn polygon</li>
                <li>POST /measure - Measure object area with reference</li>
            </ul>
        </body>
    </html>
    """

@app.post("/segment/click")
async def segment_by_click(
    image: UploadFile = File(...),
    points: str = Form(...),
    labels: str = Form(None)
):
    """Segment object by click points"""
    ensure_models_loaded()
    from segmentation import segment_by_click as do_segment, create_mask_overlay
    
    img_data = await image.read()
    img = np.array(Image.open(io.BytesIO(img_data)).convert("RGB"))
    
    click_points = json.loads(points)
    click_labels = json.loads(labels) if labels else None
    
    mask = do_segment(img, click_points, click_labels)
    overlay = create_mask_overlay(img, mask)
    
    return JSONResponse({
        "success": True,
        "mask": image_to_base64(mask),
        "overlay": image_to_base64(overlay)
    })

@app.post("/segment/box")
async def segment_by_box(
    image: UploadFile = File(...),
    box: str = Form(...)
):
    """Segment object by bounding box"""
    ensure_models_loaded()
    from segmentation import segment_by_box as do_segment, create_mask_overlay
    
    img_data = await image.read()
    img = np.array(Image.open(io.BytesIO(img_data)).convert("RGB"))
    
    box_coords = json.loads(box)
    
    mask = do_segment(img, box_coords)
    overlay = create_mask_overlay(img, mask)
    
    return JSONResponse({
        "success": True,
        "mask": image_to_base64(mask),
        "overlay": image_to_base64(overlay)
    })

@app.post("/segment/polygon")
async def segment_by_polygon(
    image: UploadFile = File(...),
    polygon: str = Form(...)
):
    """Segment object by drawn polygon"""
    ensure_models_loaded()
    from segmentation import segment_by_polygon as do_segment, create_mask_overlay
    
    img_data = await image.read()
    img = np.array(Image.open(io.BytesIO(img_data)).convert("RGB"))
    
    polygon_points = json.loads(polygon)
    
    mask = do_segment(img, polygon_points)
    overlay = create_mask_overlay(img, mask)
    
    return JSONResponse({
        "success": True,
        "mask": image_to_base64(mask),
        "overlay": image_to_base64(overlay)
    })

@app.post("/measure")
async def measure_object_endpoint(
    image: UploadFile = File(...),
    object_mask: str = Form(...),
    ref_mask: str = Form(None),
    ref_type: str = Form("coin_10_inr")
):
    """Measure object area using reference object for scale"""
    ensure_models_loaded()
    from measurement import measure_object_area
    
    # Parse image and masks
    img_data = await image.read()
    img = np.array(Image.open(io.BytesIO(img_data)).convert("RGB"))
    
    obj_mask = base64_to_image(object_mask)
    if len(obj_mask.shape) == 3:
        obj_mask = obj_mask[:, :, 0]
    
    ref_mask_arr = None
    if ref_mask:
        ref_mask_arr = base64_to_image(ref_mask)
        if len(ref_mask_arr.shape) == 3:
            ref_mask_arr = ref_mask_arr[:, :, 0]
    
    # Measure area (no depth needed)
    result = measure_object_area(obj_mask, ref_mask_arr, ref_type)
    
    return JSONResponse({
        "success": True,
        "measurements": {
            "area_cm2": float(result["area_cm2"]),
            "width_cm": float(result["width_cm"]),
            "height_cm": float(result["height_cm"]),
            "pixels_per_cm": float(result["pixels_per_cm"]),
        },
        "depth_map": None,
        "mesh_data": None,
    })

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "models_loaded": models_loaded}

@app.post("/preload")
async def preload_models():
    """Pre-load models (call this to warm up)"""
    ensure_models_loaded()
    return {"status": "models_loaded"}

if __name__ == "__main__":
    print("Starting PixScale Server...")
    ensure_models_loaded()
    print("Open http://localhost:8000 in your browser")
    uvicorn.run(app, host="0.0.0.0", port=8000)
