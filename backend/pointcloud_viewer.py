"""
Real-Time LiDAR-style Point Cloud Viewer
=========================================
Standalone script -- does NOT touch any existing project files.

Opens your webcam, runs MiDaS depth estimation on every frame,
back-projects pixels to 3D, and renders a live sparse point cloud
in an interactive matplotlib window.

Controls
--------
  - Drag the 3D view to rotate
  - Press  Q  in the OpenCV preview to quit

Usage:
    python pointcloud_viewer.py
"""

import sys
import numpy as np
import torch
import cv2

import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D  # noqa

# ── Config ──────────────────────────────────────────────────────────
CAM_INDEX        = 0          # webcam index (0 = default camera)
CAPTURE_WIDTH    = 320        # low res keeps MiDaS fast
CAPTURE_HEIGHT   = 240
POINT_SUBSAMPLE  = 4          # every Nth pixel  (higher = sparser)
MAX_POINTS       = 15_000     # cap for smooth rendering
POINT_SIZE       = 0.5
DEPTH_CLIP_FAR   = 0.92       # drop farthest 8 % (walls / noise)
UPDATE_INTERVAL  = 80         # milliseconds between redraws
# ────────────────────────────────────────────────────────────────────

# ── globals filled once ─────────────────────────────────────────────
midas_model    = None
midas_transform = None
midas_device   = None
# ────────────────────────────────────────────────────────────────────


def load_midas():
    global midas_model, midas_transform, midas_device
    print("Loading MiDaS depth model (auto-downloads on first run) ...")
    midas_model = torch.hub.load(
        "intel-isl/MiDaS", "MiDaS_small", trust_repo=True
    )
    midas_model.eval()
    midas_device = "cuda" if torch.cuda.is_available() else "cpu"
    midas_model.to(midas_device)
    transforms = torch.hub.load(
        "intel-isl/MiDaS", "transforms", trust_repo=True
    )
    midas_transform = transforms.small_transform
    print(f"MiDaS ready on {midas_device}")


def estimate_depth(frame_bgr):
    """Run MiDaS on a small BGR frame -> depth map (HxW float)."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    inp = midas_transform(rgb).to(midas_device)
    with torch.no_grad():
        pred = midas_model(inp)
        pred = torch.nn.functional.interpolate(
            pred.unsqueeze(1),
            size=rgb.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()
    return pred.cpu().numpy()


def frame_to_cloud(frame_bgr, depth):
    """Back-project depth into sparse 3-D points + colours."""
    h, w = depth.shape
    d_min, d_max = depth.min(), depth.max()
    dn = (depth - d_min) / (d_max - d_min + 1e-8)

    mask = dn < DEPTH_CLIP_FAR

    fx = fy = w * 0.8
    cx, cy = w / 2.0, h / 2.0

    ys = np.arange(0, h, POINT_SUBSAMPLE)
    xs = np.arange(0, w, POINT_SUBSAMPLE)
    xv, yv = np.meshgrid(xs, ys)

    zv = dn[yv, xv]
    mv = mask[yv, xv]

    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    cv = rgb[yv, xv]

    xf, yf, zf = xv.ravel(), yv.ravel(), zv.ravel()
    mf = mv.ravel()
    cf = cv.reshape(-1, 3)

    xf, yf, zf, cf = xf[mf], yf[mf], zf[mf], cf[mf]

    zf = 1.0 / (zf + 0.05)

    x3 = (xf - cx) / fx * zf
    y3 = (yf - cy) / fy * zf
    pts = np.stack([x3, -y3, -zf], axis=-1)

    if len(pts) > MAX_POINTS:
        idx = np.random.choice(len(pts), MAX_POINTS, replace=False)
        pts, cf = pts[idx], cf[idx]

    return pts, cf


def make_colors(pts, raw_rgb):
    """Blue-tinted depth colouring (LiDAR look)."""
    z = pts[:, 2]
    zn = (z - z.min()) / (np.ptp(z) + 1e-8)
    blue = np.array([0.15, 0.55, 1.0])
    tinted = raw_rgb * 0.3 + blue * 0.7
    bright = 0.25 + 0.75 * zn[:, None]
    return np.clip(tinted * bright, 0, 1)


def draw_grid(ax, z_floor, span, n=22, color="#2a4060", lw=0.3):
    ticks = np.linspace(-span, span, n)
    for t in ticks:
        ax.plot([t, t], [-span, span], [z_floor, z_floor],
                color=color, lw=lw, alpha=0.45)
        ax.plot([-span, span], [t, t], [z_floor, z_floor],
                color=color, lw=lw, alpha=0.45)


# ── Main loop ──────────────────────────────────────────────────────
def main():
    load_midas()

    cap = cv2.VideoCapture(CAM_INDEX)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam.  Try changing CAM_INDEX at the top.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_HEIGHT)

    # ── set up matplotlib figure ──────────────────────────────────
    plt.ion()
    fig = plt.figure(figsize=(12, 8), facecolor="#0a0e17")
    ax  = fig.add_subplot(111, projection="3d", facecolor="#0a0e17")

    scatter = None

    def style_axes():
        for spine in [ax.xaxis, ax.yaxis, ax.zaxis]:
            spine.pane.fill = False
            spine.pane.set_edgecolor("#1a2030")
            spine.label.set_color("#667788")
            spine._axinfo["tick"]["color"]     = "#667788"
            spine._axinfo["grid"]["color"]     = "#1a2030"
            spine._axinfo["grid"]["linewidth"] = 0.3
        ax.tick_params(colors="#667788", labelsize=7)
        ax.set_xlabel("X", color="#5588aa", fontsize=9)
        ax.set_ylabel("Y", color="#5588aa", fontsize=9)
        ax.set_zlabel("Z", color="#5588aa", fontsize=9)

    style_axes()
    ax.view_init(elev=25, azim=-60)
    print("\n-- Real-time point cloud running --")
    print("   Drag the 3-D view to rotate.")
    print("   Press  Q  in the camera preview to quit.\n")

    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Resize for speed
        small = cv2.resize(frame, (CAPTURE_WIDTH, CAPTURE_HEIGHT))

        # Show camera preview
        preview = cv2.resize(frame, (480, 360))
        cv2.imshow("Camera Preview  [Q to quit]", preview)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break

        # ── Depth + cloud ─────────────────────────────────────────
        depth = estimate_depth(small)
        pts, raw_c = frame_to_cloud(small, depth)
        colors = make_colors(pts, raw_c)

        # ── Update 3-D plot ───────────────────────────────────────
        ax.cla()
        style_axes()

        ax.scatter(
            pts[:, 0], pts[:, 1], pts[:, 2],
            c=colors, s=POINT_SIZE, alpha=0.85,
            depthshade=True, edgecolors="none",
        )

        # floor grid
        z_floor = pts[:, 2].min() - 0.05
        span = max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1])) / 2 * 1.1
        draw_grid(ax, z_floor, span)

        ax.set_xlim(pts[:, 0].min(), pts[:, 0].max())
        ax.set_ylim(pts[:, 1].min(), pts[:, 1].max())
        ax.set_zlim(z_floor, pts[:, 2].max())

        frame_count += 1
        ax.set_title(
            f"Live Point Cloud | {len(pts):,} pts | frame {frame_count}",
            color="#88aacc", fontsize=12, pad=12,
        )

        fig.canvas.draw_idle()
        fig.canvas.flush_events()
        plt.pause(UPDATE_INTERVAL / 1000.0)

    # cleanup
    cap.release()
    cv2.destroyAllWindows()
    plt.close("all")
    print("Viewer closed.")


if __name__ == "__main__":
    main()
