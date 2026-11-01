#!/usr/bin/env python3
"""
Generates the PWA icons + splash marks from the same vector language as the
in-game pod-bots (original art, no third-party assets).

Output is committed to apps/client/public/icons, so a normal build never needs
this script. Run it only when the mark changes:

    python3 scripts/gen-icons.py          # needs Pillow + numpy

Everything is drawn analytically at 4x and downsampled (LANCZOS), which gives
clean anti-aliased edges without a browser or an SVG rasteriser.
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps/client/public/icons")
os.makedirs(OUT, exist_ok=True)

SUPER = 4  # supersampling factor

# --- palette (mirrors packages/shared/src/colors.ts and the client CSS) -------
INK = (5, 8, 15, 255)
BODY_TOP = (56, 224, 189)
BODY_BOTTOM = (15, 140, 126)
BOOT = (10, 95, 85, 255)
VISOR = (5, 8, 15, 255)
EYE = (223, 246, 255, 255)
ANTENNA = (124, 226, 254, 255)
BG_CENTER = (18, 58, 82)
BG_MID = (10, 21, 36)
BG_EDGE = (7, 11, 20)


def radial_bg(w: int, h: int) -> Image.Image:
    """Soft station glow: teal-blue at the top, deep space at the edges."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.16
    dist = np.sqrt(((xx - cx) / (w * 0.85)) ** 2 + ((yy - cy) / (h * 0.95)) ** 2)
    dist = np.clip(dist, 0.0, 1.0)[..., None]

    center = np.array(BG_CENTER, dtype=np.float32)
    mid = np.array(BG_MID, dtype=np.float32)
    edge = np.array(BG_EDGE, dtype=np.float32)

    first = np.clip(dist / 0.55, 0, 1)
    second = np.clip((dist - 0.55) / 0.45, 0, 1)
    rgb = center * (1 - first) + mid * first
    rgb = rgb * (1 - second) + edge * second
    arr = np.dstack([rgb, np.full((h, w, 1), 255.0, dtype=np.float32)])
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def vertical_gradient(w: int, h: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    ramp = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    top_arr = np.array(top, dtype=np.float32).reshape(1, 1, 3)
    bot_arr = np.array(bottom, dtype=np.float32).reshape(1, 1, 3)
    rgb = top_arr * (1 - ramp) + bot_arr * ramp
    rgb = np.repeat(rgb, w, axis=1)
    arr = np.dstack([rgb, np.full((h, w, 1), 255.0, dtype=np.float32)])
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def stars(img: Image.Image, count: int = 26, seed: int = 7) -> None:
    """A few faint specks so the icon reads as 'space', not a flat tile."""
    rng = np.random.default_rng(seed)
    draw = ImageDraw.Draw(img, "RGBA")
    w, h = img.size
    for _ in range(count):
        x = float(rng.uniform(0, w))
        y = float(rng.uniform(0, h))
        r = float(rng.uniform(0.004, 0.011)) * w
        alpha = int(rng.uniform(40, 140))
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, alpha))


def draw_mark(size: int, maskable: bool) -> Image.Image:
    """One square icon at `size` px, drawn at SUPER x and downsampled."""
    s = size * SUPER
    img = radial_bg(s, s)
    stars(img, count=30)

    # Maskable icons are cropped to a circle by the launcher, so keep the pod
    # inside the middle ~70% and let the background bleed to the edges.
    scale = 0.66 if maskable else 0.88
    unit = s * scale / 40.0  # the pod is authored on a 40x48 grid
    ox = (s - 40 * unit) / 2
    oy = (s - 45 * unit) / 2 + 0.6 * unit

    def X(v: float) -> float:
        return ox + v * unit

    def Y(v: float) -> float:
        return oy + v * unit

    d = ImageDraw.Draw(img, "RGBA")

    # --- ground shadow (soft, drawn first) --------------------------------
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(shadow, "RGBA").ellipse([X(9.0), Y(43.6), X(31.0), Y(45.8)], fill=(0, 0, 0, 96))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius=unit * 1.1)))

    # --- antenna ----------------------------------------------------------
    d.line([(X(20), Y(11.2)), (X(20), Y(5.0))], fill=INK, width=int(unit * 2.6), joint="curve")
    d.ellipse([X(17.0), Y(2.1), X(23.0), Y(8.1)], fill=ANTENNA, outline=INK, width=int(unit * 1.5))

    # --- boots ------------------------------------------------------------
    for bx in (7.0, 25.0):
        d.rounded_rectangle(
            [X(bx), Y(37.2), X(bx + 8.0), Y(44.6)],
            radius=unit * 3.4,
            fill=BOOT,
            outline=INK,
            width=int(unit * 1.7),
        )

    # --- body: gradient fill clipped to a rounded rect, then a chunky outline
    body_box = [X(5.6), Y(9.0), X(34.4), Y(40.2)]
    radius = unit * 12.8
    body_mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(body_mask).rounded_rectangle(body_box, radius=radius, fill=255)
    img.paste(vertical_gradient(s, s, BODY_TOP, BODY_BOTTOM), (0, 0), body_mask)
    d.rounded_rectangle(body_box, radius=radius, outline=INK, width=int(unit * 2.9))

    # --- visor + eyes -----------------------------------------------------
    visor_box = [X(10.2), Y(14.8), X(29.8), Y(27.6)]
    d.rounded_rectangle(
        visor_box, radius=unit * 6.4, fill=VISOR, outline=INK, width=int(unit * 1.3)
    )
    for ex in (15.9, 24.1):
        d.ellipse([X(ex - 2.7), Y(18.5), X(ex + 2.7), Y(23.9)], fill=EYE)
    # mouth grille
    d.rounded_rectangle([X(13.8), Y(31.0), X(26.2), Y(33.3)], radius=unit * 1.15, fill=BOOT)

    return img.resize((size, size), Image.LANCZOS)


def draw_splash(size: tuple[int, int]) -> Image.Image:
    """Store-style splash: the mark small and centred on the app background."""
    w, h = size
    img = radial_bg(w, h)
    stars(img, count=48, seed=3)
    mark = draw_mark(int(min(w, h) * 0.34), maskable=False)
    img.alpha_composite(mark, ((w - mark.width) // 2, (h - mark.height) // 2))
    return img


TARGETS = [
    ("icon-192.png", (192, 192), False),
    ("icon-512.png", (512, 512), False),
    ("icon-maskable-512.png", (512, 512), True),
    ("apple-touch-icon.png", (180, 180), False),
    ("favicon-48.png", (48, 48), False),
]

for name, dims, maskable in TARGETS:
    draw_mark(dims[0], maskable).save(os.path.join(OUT, name))
    print(f"wrote icons/{name} ({dims[0]}x{dims[1]})")

# Splash screens (Android generates its own from the manifest, but adding the
# two common aspect ratios keeps iOS/older Chrome from showing white).
for name, dims in [("splash-1080x1920.png", (1080, 1920)), ("splash-1920x1080.png", (1920, 1080))]:
    draw_splash(dims).save(os.path.join(OUT, name), optimize=True)
    print(f"wrote icons/{name}")

print("done")
