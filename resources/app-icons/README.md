# AIGC CANVAS application icon

Created with the built-in imagegen tool. `source.png` is the unchanged generated original. The mark combines the application's existing black/gold palette with a canvas arch and play symbol.

- `icon.png`: 1024px master export for previews and reuse.
- `icon.ico`: Windows application / NSIS installer icon, 16/24/32/48/64/128/256px.
- `icon.icns`: macOS icon, 16/32/64/128/256/512/1024px.
- `../../public/app-icon.png`: 256px UI / favicon image.
- `../../public/app-icon.ico`: Windows runtime window icon.

To re-export all sizes after updating the source, run from the project root in Windows PowerShell:

```powershell
./resources/app-icons/export-icons.ps1
```

Export only resizes and encodes the source, preserving transparency. Committed outputs are used directly by Windows and macOS builds; PowerShell is not required when packaging on macOS. The old template icons are retained; `electron-builder.json` explicitly selects the new files.

## Generation prompt

```text
Use case: logo-brand
Asset type: production desktop application icon for AIGC CANVAS, an AI storyboard, infinite canvas and video creation application.
Primary request: Create one distinctive premium app icon, not a presentation sheet or mockup. A bold geometric golden open canvas/frame subtly shaped like an architectural arch or letter A, with one clean right-pointing play triangle cut into the central negative space. Keep the mark unified, strong and very simple enough to read at 16px.
Style: precise polished graphic design, mostly flat vector-like silhouette with restrained satin gold tonal variation. Existing app palette is near-black #0d0d14 and warm gold #d4af37 / #f0d98c.
Composition: square 1024x1024 image, front-facing centered rounded-square near-black tile occupying 90% of the image, transparent outer corners/background. Gold mark centered and occupying about 65% of tile width. Comfortable even padding. Smooth crisp antialiased edges. Actual transparent alpha outside the tile.
Avoid: text, words, letters as typography, watermark, extra stars, tiny circuit lines, film sprocket details, scenery, mockup, perspective, drop shadow beyond the tile, overly elaborate metal reflections, purple/blue gradients. Exactly one finished icon.
```
