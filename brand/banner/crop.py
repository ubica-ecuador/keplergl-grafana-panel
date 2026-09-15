"""Cuts the three map slices out of full-page panel captures made by capture.mjs.

    python3 crop.py <dir with raw-flow.png, raw-fires.png, raw-gfs.png>

Every capture shares one viewport (lat -6, lng -62, zoom 3.6, at 2x), so a square
cut around each canvas centre gives three textures that line up geographically.
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "raw"

SIDE = 1600  # capture px: 800 CSS px at 2x. banner.html's CROP must match.
OUT = 1200

# Centre of the map canvas in each 2200x2200 capture. The flow dashboard has one
# more row of variables above the panel, so its canvas sits lower.
SLICES = {
    "flow": ("raw-flow.png", (1063, 1188)),
    "fires": ("raw-fires.png", (1063, 1150)),
    "gfs": ("raw-gfs.png", (1063, 1150)),
}

(HERE / "slices").mkdir(exist_ok=True)
for name, (file, (cx, cy)) in SLICES.items():
    image = Image.open(RAW / file).convert("RGB")
    box = (cx - SIDE // 2, cy - SIDE // 2, cx + SIDE // 2, cy + SIDE // 2)
    out = HERE / "slices" / f"{name}.jpg"
    image.crop(box).resize((OUT, OUT), Image.LANCZOS).save(out, quality=90)
    print(out, box)
