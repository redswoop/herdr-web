# herdr brand assets

| File | Use |
|---|---|
| `sheep-mark.png` | Canonical flat sheep mark (1024², black field) |
| `empty-sheep.png` | Empty-state / gate illustration |
| `icon-set-sheet.png` | Design reference for monoline UI glyphs |

App chrome icons are **not** rasterized from the sheet — they come from
`@expo/vector-icons` (Ionicons) via `src/components/Icon.tsx` so they stay
crisp and tintable.

Expo app icon / splash masters live one level up:

- `../icon.png` — iOS/Android app icon (1024²)
- `../splash-icon.png` — splash image on `#0e0e13`
