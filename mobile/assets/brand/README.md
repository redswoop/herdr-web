# Capra brand assets

| File | Use |
|---|---|
| `sheep-mark.png` | Canonical flat sheep mark (1024², black field) |
| `empty-sheep.png` | Empty-state / gate illustration |
| `icon-set-sheet.png` | Design reference for monoline UI glyphs |
| `goat-src.jpg` | Neon goat master for the app icon (magenta + cyan inks on black) |

App chrome icons are **not** rasterized from the sheet — they come from
`@expo/vector-icons` (Ionicons) via `src/components/Icon.tsx` so they stay
crisp and tintable.

Expo app icon / splash masters live one level up:

- `../icon.png` — iOS/Android app icon (1024², the kabuki goat)
- `../icons/<palette>.png` — 120px thumbs for the settings icon picker

`python3 tools/capra-icons.py` redraws all of these from `goat-src.jpg`
plus the iOS asset catalog sets (`AppIcon` = kabuki, `AppIcon-<palette>`
for the other eight, listed in the target's
`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`). New palette → rerun it,
add the name to that build setting and to `ICON_THUMBS` in
`src/app-icon.ts`, and ship a `[build]`.
- `../splash-icon.png` — splash image on `#0e0e13`
