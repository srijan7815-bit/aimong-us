#!/usr/bin/env python3
"""
Placeholder art for M2, drawn from scratch — no external assets.

    python3 scripts/gen-atlas.py

Writes a single swappable atlas plus the manifest that describes it:

    apps/client/public/assets/atlas/placeholder/atlas.png
    apps/client/public/assets/atlas/placeholder/manifest.json

The client only ever reads the manifest, so replacing the art later means dropping
a new folder next to this one and pointing `VITE_ATLAS` at it — no code change.
Everything is drawn with Pillow primitives, so the file is reproducible and the
licence is ours (see THIRD_PARTY.md).
"""
import json
import math
import os

from PIL import Image, ImageDraw

TILE = 32
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps/client/public/assets/atlas/placeholder")

BG = (10, 15, 26, 255)
FLOOR_A = (30, 42, 62, 255)
FLOOR_B = (34, 47, 69, 255)
FLOOR_LINE = (24, 34, 51, 255)
WALL = (86, 104, 132, 255)
WALL_TOP = (108, 128, 158, 255)
WALL_DARK = (54, 68, 92, 255)
VENT = (46, 62, 86, 255)
VENT_SLAT = (120, 150, 180, 255)
TASK = (255, 190, 92, 255)
TASK_DIM = (120, 90, 40, 255)


def floor_tile(seed: int) -> Image.Image:
    img = Image.new("RGBA", (TILE, TILE), FLOOR_A if seed % 2 == 0 else FLOOR_B)
    d = ImageDraw.Draw(img)
    d.rectangle([0, TILE - 1, TILE, TILE], fill=FLOOR_LINE)
    d.rectangle([TILE - 1, 0, TILE, TILE], fill=FLOOR_LINE)
    # a few rivets, deterministic by seed
    for i in range(3):
        x = 6 + ((seed * 7 + i * 11) % 20)
        y = 6 + ((seed * 13 + i * 5) % 20)
        d.point((x, y), fill=FLOOR_LINE)
    return img


def wall_tile() -> Image.Image:
    img = Image.new("RGBA", (TILE, TILE), WALL)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, TILE - 1, 5], fill=WALL_TOP)
    d.rectangle([0, TILE - 1, TILE - 1, TILE - 1], fill=WALL_DARK)
    d.rectangle([TILE - 1, 0, TILE - 1, TILE - 1], fill=WALL_DARK)
    d.line([2, 12, TILE - 3, 12], fill=WALL_DARK)
    d.line([TILE // 2, 13, TILE // 2, TILE - 3], fill=WALL_DARK)
    return img


def vent_tile() -> Image.Image:
    img = Image.new("RGBA", (TILE, TILE), VENT)
    d = ImageDraw.Draw(img)
    for y in range(7, TILE - 5, 5):
        d.line([5, y, TILE - 5, y], fill=VENT_SLAT)
    d.rectangle([4, 5, TILE - 5, TILE - 5], outline=WALL_DARK)
    return img


def task_tile() -> Image.Image:
    img = floor_tile(1)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([7, 7, TILE - 8, TILE - 8], radius=4, outline=TASK_DIM, fill=(40, 34, 24, 255))
    d.rounded_rectangle([10, 10, TILE - 11, TILE - 11], radius=3, outline=TASK)
    d.line([13, 16, 16, 13], fill=TASK)
    return img


def pod_tile(kind: str) -> Image.Image:
    """A white pod so the client can tint it per player colour."""
    img = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    body = (255, 255, 255, 255)
    cx, cy, r = TILE // 2, TILE // 2 + 2, 9
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=body)
    # little legs / backpack, so direction reads even as a blob
    d.rectangle([cx - 5, cy + r - 3, cx - 2, cy + r + 3], fill=body)
    d.rectangle([cx + 2, cy + r - 3, cx + 5, cy + r + 3], fill=body)
    if kind == "visor":
        d.ellipse([cx - 6, cy - 5, cx + 6, cy + 1], fill=(18, 24, 36, 255))
        d.ellipse([cx - 4, cy - 4, cx + 1, cy - 1], fill=(210, 235, 255, 255))
    return img


def dead_body_tile() -> Image.Image:
    """For M3 (bodies on the floor) — drawn now so the atlas is stable."""
    img = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([6, 20, 26, 28], fill=(180, 190, 210, 255))
    d.ellipse([8, 12, 22, 24], fill=(255, 255, 255, 255))
    d.ellipse([11, 15, 19, 20], fill=(18, 24, 36, 255))
    d.line([4, 24, 9, 20], fill=(120, 40, 60, 255))
    return img


def vignette(size: int = 64) -> Image.Image:
    """Soft blob used for the fog edge."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(size // 2, 0, -1):
        alpha = int(255 * (1 - (i / (size / 2))) ** 0.8 * 0.35)
        d.ellipse([size / 2 - i, size / 2 - i, size / 2 + i, size / 2 + i], fill=(0, 0, 0, alpha))
    return img


def build() -> dict:
    frames: dict[str, dict[str, int]] = {}
    # 6 columns x 2 rows of 32px frames
    cols, rows = 8, 2
    # Transparent base: sprites need real transparency, otherwise every pod drags
    # an opaque box around and the layer order looks broken.
    sheet = Image.new("RGBA", (cols * TILE, rows * TILE), (0, 0, 0, 0))

    def place(name: str, img: Image.Image, index: int) -> None:
        col = index % cols
        row = index // cols
        x = col * TILE
        y = row * TILE
        sheet.alpha_composite(img, (x, y))
        frames[name] = {"x": x, "y": y, "w": TILE, "h": TILE}

    place("floor", floor_tile(0), 0)
    place("floorAlt", floor_tile(1), 1)
    place("wall", wall_tile(), 2)
    place("vent", vent_tile(), 3)
    place("task", task_tile(), 4)
    place("pod", pod_tile("body"), 5)
    place("podVisor", pod_tile("visor"), 6)
    place("body", dead_body_tile(), 7)
    place("shadow", vignette(32), 8)

    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, "atlas.png"))

    manifest = {
        "name": "placeholder",
        "version": 1,
        "author": "AImong Us (original, drawn by scripts/gen-atlas.py)",
        "licence": "project",
        "tileSize": TILE,
        "image": "atlas.png",
        "imageWidth": sheet.width,
        "imageHeight": sheet.height,
        "frames": frames,
        "notes": "Swap art by pointing VITE_ATLAS at another folder with the same manifest shape.",
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    return manifest


if __name__ == "__main__":
    m = build()
    print(f"atlas ok: {m['imageWidth']}x{m['imageHeight']}, {len(m['frames'])} frames")
    print("  wrote apps/client/public/assets/atlas/placeholder/{atlas.png,manifest.json}")
