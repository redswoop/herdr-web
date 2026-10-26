#!/usr/bin/env python3
"""Capra app icons: one neon goat, recoloured into every CyberDOS palette.

The source art (mobile/assets/brand/goat-src.jpg) is black plus two neon
inks, magenta and cyan. Each pixel is split into those two inks (least
squares, clipped at zero), and the inks are swapped for a palette's chrome
and live colours; whatever the split can't explain (white-hot eye cores)
is added back untouched. The card frame is masked off because iOS rounds
the corners itself.

Writes the iOS asset catalog sets (AppIcon = kabuki, the art as drawn;
AppIcon-<palette> for the rest), the Expo icon, and 120px settings thumbs.
Needs numpy + Pillow.  python3 tools/capra-icons.py
"""
import json, re
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / 'mobile'
SRC = MOBILE / 'assets/brand/goat-src.jpg'
PALETTES = ROOT / 'node_modules/@redswoop/cyberdos/core/palettes.ts'
XCASSETS = MOBILE / 'ios/herdr/Images.xcassets'
THUMBS = MOBILE / 'assets/icons'
PRIMARY = 'kabuki'

def palettes():
    text = PALETTES.read_text()
    out = {}
    for m in re.finditer(r"id: '([a-z-]+)'.*?chrome: '(#[0-9a-f]{6})', live: '(#[0-9a-f]{6})'", text, re.S):
        out[m.group(1)] = (m.group(2), m.group(3))
    return out

def inks():
    im = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32) / 255
    H, W, _ = im.shape
    side, cy = 860, 600          # square on the head, horn tips to beard
    y0, xs = cy - side // 2, (side - W) // 2
    canvas = np.zeros((side, side, 3), np.float32)
    crop = im[max(0, y0):y0 + side]
    canvas[max(0, -y0):max(0, -y0) + crop.shape[0], xs:xs + W] = crop
    yy, xx = np.mgrid[0:side, 0:side]
    iy, ix = yy + y0, xx - xs    # source-image coordinates
    horn = (iy > 330) & (iy < 570)  # the horns reach past the frame rails only here
    keep = (ix > 50) & (ix < 734) & (iy > 190) & (iy < 1020)
    keep &= horn | ((ix > 86) & (ix < 698))
    keep &= ~((iy > 880) & ((ix < 200) | (ix > 584)))  # bottom frame corners
    canvas *= keep[..., None]
    ink = np.stack([[1.0, 0.18, 0.63], [0.24, 0.85, 0.95]], 1)  # magenta, cyan
    px = canvas.reshape(-1, 3)
    coef = np.clip(px @ np.linalg.pinv(ink).T, 0, None)
    rest = np.clip(px - coef @ ink.T, 0, None)
    return side, coef, rest

def rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)]) / 255

def render(side, coef, rest, chrome, live):
    o = np.clip(coef @ np.stack([rgb(chrome), rgb(live)], 1).T + rest, 0, 1)
    img = Image.fromarray((o.reshape(side, side, 3) * 255).astype(np.uint8))
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
        img = render(side, coef, rest, chrome, live)
        img.resize((120, 120), Image.LANCZOS).save(THUMBS / f'{pid}.png', optimize=True)
        if pid == PRIMARY:
            appiconset('AppIcon', img)
            img.save(MOBILE / 'assets/icon.png', optimize=True)
        else:
            appiconset(f'AppIcon-{pid}', img)
            alternates.append(f'AppIcon-{pid}')
    print('ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES =', ' '.join(alternates))

main()
