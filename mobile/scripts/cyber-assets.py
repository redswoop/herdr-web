#!/usr/bin/env python3
"""Tiles and masks for the cyber skin (mobile/src/cyber.tsx). Everything is
white-on-transparent so the app tints it with the live palette; only the
vignette is black. Re-run after changing a shape; the PNGs are committed."""
import math, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'cyber')
os.makedirs(OUT, exist_ok=True)

# CRT scanlines: 1px dark line every 3px (web: 0-2px clear, 2-3px 13% black)
im = Image.new('RGBA', (4, 3), (0, 0, 0, 0))
for x in range(4):
    im.putpixel((x, 2), (0, 0, 0, 255))
im.save(os.path.join(OUT, 'scanlines.png'))

# faint HUD grid, 28px cell, 1px lines (tinted at runtime)
im = Image.new('RGBA', (28, 28), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.line([(0, 0), (27, 0)], fill=(255, 255, 255, 255))
d.line([(0, 0), (0, 27)], fill=(255, 255, 255, 255))
im.save(os.path.join(OUT, 'grid.png'))

# vignette: clear to 50% of the radius, then eases to 55% black at the corners
N = 256
im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
px = im.load()
for y in range(N):
    for x in range(N):
        dx, dy = (x + 0.5) / N * 2 - 1, (y + 0.5) / N * 2 - 1
        r = math.sqrt(dx * dx + dy * dy) / math.sqrt(2)  # 0 centre → 1 corner
        t = max(0.0, (r - 0.5) / 0.5)
        px[x, y] = (0, 0, 0, int(255 * 0.55 * t * t))
im.save(os.path.join(OUT, 'vignette.png'))

# haze: the red bloom the web body paints at the top centre (tinted at runtime)
W, H = 256, 128
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
px = im.load()
for y in range(H):
    for x in range(W):
        dx = (x + 0.5) / W * 2 - 1
        dy = (y + 0.5) / H + 0.1  # centre sits 10% above the top edge
        r = math.sqrt((dx / 1.4) ** 2 + (dy / 0.55) ** 2)
        a = max(0.0, 1 - r / 0.65)
        px[x, y] = (255, 255, 255, int(255 * a * a))
im.save(os.path.join(OUT, 'haze.png'))

# hazard stripes: 45° white bars, 10px on / 10px off (tinted at runtime)
S = 20
im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
px = im.load()
for y in range(S):
    for x in range(S):
        if ((x + y) % S) < S // 2:
            px[x, y] = (255, 255, 255, 255)
im.save(os.path.join(OUT, 'stripes.png'))
print('wrote', sorted(os.listdir(OUT)))
