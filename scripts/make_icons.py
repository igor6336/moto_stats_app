"""Generates the app icons. Run: python3 scripts/make_icons.py"""
import math
from PIL import Image, ImageDraw

def icon(size, path):
    s = 4  # supersample
    W = size * s
    img = Image.new("RGB", (W, W), (11, 13, 16))
    d = ImageDraw.Draw(img)
    cx, cy, r = W / 2, W * 0.56, W * 0.34
    w = int(W * 0.07)
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, 150, 390, fill=(42, 49, 60), width=w)
    d.arc(box, 150, 300, fill=(255, 122, 26), width=w)
    a = math.radians(300)
    nx, ny = cx + r * 0.78 * math.cos(a), cy + r * 0.78 * math.sin(a)
    d.line([cx, cy, nx, ny], fill=(238, 241, 245), width=int(W * 0.045))
    hub = W * 0.055
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(238, 241, 245))
    img.resize((size, size), Image.LANCZOS).save(path)

for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    icon(size, f"icons/{name}")
