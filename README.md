# Object Measurement App

A mobile-friendly web app that captures photos, segments objects, and calculates their area and volume.

## Features

- 📸 Camera capture or image upload
- ✂️ Click-to-segment OR draw boundary segmentation
- 📏 Reference object calibration (coin/card)
- 📐 Area and volume calculation
- 🎮 3D visualization of detected object

## Quick Start (Google Colab)

1. Open `notebooks/colab_backend.ipynb` in Google Colab
2. Run all cells
3. Click the ngrok URL to access the app

## Local Setup

```bash
cd backend
pip install -r requirements.txt
python main.py
```

## Tech Stack

- **Backend**: Python, FastAPI, SAM, MiDaS
- **Frontend**: HTML/CSS/JS, Three.js (3D visualization)
