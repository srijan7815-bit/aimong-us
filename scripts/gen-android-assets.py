#!/usr/bin/env python3
"""
Brands the generated Android project with the game's own art:
launcher icons (all densities + adaptive), round icons, splash screens and the
app label. Re-runnable: it only overwrites files it owns.

    python3 scripts/gen-android-assets.py      # needs Pillow + numpy
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "mobile/android/app/src/main/res")
ICONS = os.path.join(ROOT, "apps/client/public/icons")

DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

SIZES_LAND = {"mdpi": (480, 320), "hdpi": (800, 480), "xhdpi": (1280, 720), "xxhdpi": (1600, 960), "xxxhdpi": (1920, 1280)}
SIZES_PORT = {k: (v[1], v[0]) for k, v in SIZES_LAND.items()}


def square(source, size):
    img = Image.open(source).convert("RGBA")
    return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_pct=0.22):
    """Round-cornered variant for launchers that do not mask icons themselves."""
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_pct), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def splash(size):
    """Portrait/landscape splash: the mark centred on the app background."""
    w, h = size
    bg = Image.new("RGBA", (w, h), (7, 11, 20, 255))
    mark_size = int(min(w, h) * 0.32)
    mark = square(os.path.join(ICONS, "icon-512.png"), mark_size)
    bg.alpha_composite(mark, ((w - mark_size) // 2, (h - mark_size) // 2))
    return bg.convert("RGB")


base = square(os.path.join(ICONS, "icon-512.png"), 512)

for density, px in DENSITIES.items():
    folder = os.path.join(RES, f"mipmap-{density}")
    os.makedirs(folder, exist_ok=True)
    icon = square(os.path.join(ICONS, "icon-512.png"), px)
    icon.save(os.path.join(folder, "ic_launcher.png"))
    rounded(icon).save(os.path.join(folder, "ic_launcher_round.png"))
    # Adaptive icons use a separate foreground layer; our mark is full-bleed, so
    # a scaled copy keeps the pod inside the 66% safe zone.
    fg_size = int(px * 1.5)
    fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
    inner = square(os.path.join(ICONS, "icon-maskable-512.png"), int(fg_size * 0.92))
    fg.alpha_composite(inner, ((fg_size - inner.size[0]) // 2, (fg_size - inner.size[1]) // 2))
    fg.save(os.path.join(folder, "ic_launcher_foreground.png"))
    print(f"mipmap-{density}: {px}px icon")

# Adaptive icon descriptor (API 26+)
anydpi = os.path.join(RES, "mipmap-anydpi-v26")
os.makedirs(anydpi, exist_ok=True)
adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(anydpi, name), "w") as fh:
        fh.write(adaptive)

values = os.path.join(RES, "values")
os.makedirs(values, exist_ok=True)
with open(os.path.join(values, "ic_launcher_background.xml"), "w") as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#070b14</color>\n</resources>\n')

# Splash screens
for density in DENSITIES:
    for orientation, sizes in (("port", SIZES_PORT), ("land", SIZES_LAND)):
        folder = os.path.join(RES, f"drawable-{orientation}-{density}")
        os.makedirs(folder, exist_ok=True)
        splash(sizes[density]).save(os.path.join(folder, "splash.png"))
print("splash screens written")

# App label
strings = os.path.join(values, "strings.xml")
with open(strings, "w") as fh:
    fh.write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <string name="app_name">AImong Us</string>\n'
        '    <string name="title_activity_main">AImong Us</string>\n'
        '    <string name="package_name">us.aimong.app</string>\n'
        '    <string name="custom_url_scheme">us.aimong.app</string>\n'
        "</resources>\n"
    )
print("strings.xml written")
