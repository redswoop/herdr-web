#!/usr/bin/env python3
"""Capra app icons: one neon goat, recoloured into every CyberDOS palette.

The source art (mobile/assets/brand/goat-src.jpg) is black plus two neon
inks, magenta and cyan. Each pixel is split into those two inks (least
squares, clipped at zero), and the inks are swapped for a palette's chrome
and live colours; whatever the split can't explain (white-hot eye cores)
is added back untouched. The card frame is keyed out (goat_mask) because
iOS rounds the corners itself.

Writes the iOS asset catalog sets (AppIcon = kabuki, the art as drawn;
AppIcon-<palette> for the rest), the Expo icon, and 120px settings thumbs.
Needs numpy, Pillow and OpenCV (python3-opencv).  python3 tools/capra-icons.py
"""
import json, re
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / 'mobile'
SRC = MOBILE / 'assets/brand/goat-src.jpg'
PALETTES = ROOT / 'node_modules/@redswoop/cyberdos/core/palettes.ts'
XCASSETS = MOBILE / 'ios/herdr/Images.xcassets'
THUMBS = MOBILE / 'assets/icons'
PRIMARY = 'kabuki'
SIDE, CY = 800, 602  # crop square (source px) and its centre row: horn crest to beard tip
LOOK = dict(gain=1.4, lift=0.35, bold=5)  # Armen's pick "D" (2026-10-27): reads at 60pt

def palettes():
    text = PALETTES.read_text()
    out = {}
    for m in re.finditer(r"id: '([a-z-]+)'.*?chrome: '(#[0-9a-f]{6})', live: '(#[0-9a-f]{6})'", text, re.S):
        out[m.group(1)] = (m.group(2), m.group(3))
    return out

def goat_mask(img):
    """Feathered silhouette of the goat: the big central ink blobs, minus the
    card frame ring, its rail ticks and the bottom chevron."""
    v = np.asarray(img).max(2)
    ink = cv2.dilate((v > 50).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(ink, 8)
    keep = np.zeros(n, bool)
    keep[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])] = True
    for k in range(1, n):
        (cx, cy), (x, y, w, h, _) = cent[k], stats[k]
        if w > 720 or h > 900:  # the frame ring
            continue
        if min(w, h) < 16 and max(w, h) > 28:  # rail ticks
            continue
        if cy > 1025:  # chevron under the beard
            continue
        if ((cx - 392) / 330) ** 2 + ((cy - 600) / 440) ** 2 < 1:
            keep[k] = True
    m = cv2.morphologyEx(keep[lab].astype(np.uint8), cv2.MORPH_CLOSE,
                         cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    fill = np.zeros_like(m)
    cv2.drawContours(fill, cnts, -1, 1, -1)
    return cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 4)

def inks(side=SIDE, cy=CY):
    img = Image.open(SRC).convert('RGB')
    im = np.asarray(img).astype(np.float32) / 255 * goat_mask(img)[..., None]
    H, W, _ = im.shape
    y0, xs = cy - side // 2, (side - W) // 2  # square on the head; xs < 0 crops the sides
    canvas = np.zeros((side, side, 3), np.float32)
    sy0, sy1 = max(0, y0), min(H, y0 + side)
    sx0, sx1 = max(0, -xs), min(W, side - xs)
    canvas[sy0 - y0:sy1 - y0, sx0 + xs:sx1 + xs] = im[sy0:sy1, sx0:sx1]
    ink = np.stack([[1.0, 0.18, 0.63], [0.24, 0.85, 0.95]], 1)  # magenta, cyan
    px = canvas.reshape(-1, 3)
    coef = np.clip(px @ np.linalg.pinv(ink).T, 0, None)
    rest = np.clip(px - coef @ ink.T, 0, None)
    return side, coef, rest

def rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255

def render(side, coef, rest, chrome, live, gain=1.0, lift=0.0, bold=0, glow=0.0):
    """gain/lift brighten the inks (lift is a gamma that pulls dim fur up),
    bold thickens strokes, glow paints a chrome halo behind the head. Home
    screen icons are 60pt: the untouched art reads as a black tile there."""
    c = coef.reshape(side, side, 2).copy()
    if bold:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bold, bold))
        for i in range(2):
            c[..., i] = np.maximum(c[..., i], cv2.dilate(c[..., i], k) * 0.8)
    c = np.clip(c * gain, 0, 1) ** (1 - lift)
    o = (c.reshape(-1, 2) @ np.stack([rgb(chrome), rgb(live)], 1).T + rest).reshape(side, side, 3)
    if glow:
        yy, xx = np.mgrid[0:side, 0:side] / side
        halo = np.clip(1 - np.hypot(xx - 0.5, yy - 0.52) / 0.55, 0, 1) ** 1.6 * glow
        o += halo[..., None] * rgb(chrome) * (1 - np.clip(o.max(2, keepdims=True), 0, 1))
    img = Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8))
    return img.resize((1024, 1024), Image.LANCZOS)

def appiconset(name, img):
    d = XCASSETS / f'{name}.appiconset'
    d.mkdir(exist_ok=True)
    for old in d.glob('*.png'):
        old.unlink()
    img.save(d / 'App-Icon-1024x1024@1x.png', optimize=True)
    (d / 'Contents.json').write_text(json.dumps({
        'images': [{'filename': 'App-Icon-1024x1024@1x.png', 'idiom': 'universal',
                    'platform': 'ios', 'size': '1024x1024'}],
        'info': {'version': 1, 'author': 'expo'},
    }, indent=2) + '\n')

def main():
    pals = palettes()
    assert PRIMARY in pals and len(pals) >= 9, pals
    side, coef, rest = inks()
    THUMBS.mkdir(exist_ok=True)
    alternates = []
    for pid, (chrome, live) in pals.items():
        img = render(side, coef, rest, chrome, live, **LOOK)
        img.resize((120, 120), Image.LANCZOS).save(THUMBS / f'{pid}.png', optimize=True)
        if pid == PRIMARY:
            appiconset('AppIcon', img)
            img.save(MOBILE / 'assets/icon.png', optimize=True)
        else:
            appiconset(f'AppIcon-{pid}', img)
            alternates.append(f'AppIcon-{pid}')
    print('ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES =', ' '.join(alternates))

main()
