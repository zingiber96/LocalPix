# Changelog

All notable changes to LocalPix will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026

### Added

- **JPEG XL** (`.jxl`) input + output. Royalty-free modern codec with
  excellent compression and full alpha support. Quality and effort knobs
  exposed; default effort of 7 matches libjxl's default (highest
  compression, slow) — turn it down for faster encodes.
- **Strip metadata** global toggle (on by default). Scrubs EXIF, GPS,
  camera info, XMP and other personal data from outputs. Sharp-native
  formats (JPEG, PNG, WebP, AVIF, GIF, TIFF) respect the toggle directly.
- **Preserve color profile** toggle, paired with strip metadata. Drops
  personal data but keeps the ICC profile so colors don't shift after
  conversion. Disabled when strip metadata is off (redundant in that case).

### Changed

- **Hybrid decode/encode architecture.** Sharp continues to handle the
  hot path (JPEG, PNG, WebP, AVIF, GIF, TIFF) at native speed. Everything
  else — HEIC, PSD, BMP, JPEG XL, and future additions like JP2/EXR/RAW —
  now routes through a single [`magick-wasm`][magick] dependency instead
  of multiple per-format JS libraries. Adding a new format is now one
  dispatch entry instead of a new dependency. ~7 MB net bundle increase
  for a ~70-formats coverage upgrade.
- **BMP output is now 32-bit RGBA** instead of 24-bit RGB. Preserves
  source transparency. File sizes ~33% larger on transparent sources.
  Modern tools (Preview, Photoshop, GIMP, Paint.NET, Windows Paint on
  Win10+) handle 32-bit BMPs without issue.

### Removed

- Direct dependencies: `ag-psd`, `heic-decode`, `libheif-js`, `bmp-js`.
  All replaced by the unified `@imagemagick/magick-wasm` path.

### Preserved

- **WebP byte-identical output** vs. previous LocalPix and LocalConvert
  releases, all the way back to the original WEBPConvert app. The default
  WebP encode at quality 80, effort 4 produces the same bytes as v1.0.0.
- All v1.0 features: drag-and-drop, segmented format selector, dark mode,
  ⌘O / ⌘⇧O menu actions, Electron folder picker, ICO multi-size, SVG
  density control, JPEG alpha background fill, animated source flattening.

### Known limitations

- **PDF input** is not yet supported. The magick-wasm build relies on a
  system Ghostscript binary for PDF rasterization, which we can't ship in
  a packaged Electron app. PDF support requires a separate decoder
  (e.g. `mupdf-js`) and is planned for v1.1.x.
- **RAW input** (DNG, CR2, NEF, ARW) is listed as supported by magick-wasm
  but hasn't been validated against real camera files yet. Planned for v1.2.
- **Metadata toggles only fully apply to sharp-native outputs.**
  Magick-routed outputs (BMP, JXL, future niche formats) strip metadata
  unconditionally at the raw-RGBA bridge. The output is effectively
  "stripped" regardless of toggle state. Will be addressed when metadata
  pass-through is wired through magick-wasm directly.

[magick]: https://github.com/dlemstra/magick-wasm

## [1.0.0]

- Initial release of LocalPix (rename from LocalConvert).
- Local, offline image converter for macOS and Windows.
- Inputs: JPEG, PNG, WebP, AVIF, GIF, HEIF/HEIC, TIFF, BMP, SVG, PSD.
- Outputs: JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, ICO.
- Dark mode, segmented format selector, user-selectable output folder
  (Electron), drag-and-drop, batch convert.
