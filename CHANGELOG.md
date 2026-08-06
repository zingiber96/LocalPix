# Changelog

All notable changes to LocalPix will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — v1.5

### Added

- **Manual update check.** A "Check for updates" button in the footer
  makes one anonymous, user-initiated request to the GitHub Releases API
  and compares version numbers — no identifiers, no background checks,
  no downloads. If a newer version exists you get a link to the release
  page (opened in your system browser from the desktop app). This is the
  only network request LocalPix can make, and only when you click.
  Documented in the README FAQ.
- **Max file size control.** A slider above the file list caps how large
  an added file may be (10 MB up to 2 GB, or **No limit** — the default,
  replacing the previous fixed 100 MB cap). Oversized files are skipped
  at drop time with a notice, and the cap is enforced server-side too.
  The choice persists between sessions.

### Changed

- Uploads now have a 2 GB absolute ceiling (previously a fixed 100 MB),
  since files buffer in memory during conversion.
- The footer version number is now read from the app itself rather than
  hard-coded in the page.

## [1.4.1] — 2026-07-08 "Full Control"

### Added

- **PDF input.** Drop a PDF and convert any page of it to any output
  format. Pages are rendered fully offline by MuPDF (WASM) at 192 dpi;
  a "PDF page to convert" field appears whenever a PDF is in the list,
  capped at the document's real page count, with a **Convert all pages**
  checkbox that converts every page (outputs named `name-p1`, `name-p2`,
  … with per-page download links).
- **Output filename templates.** A "Filename" field next to the output
  folder accepts tokens — `{name}` `{format}` `{width}` `{height}`
  `{date}` `{n}` — applied when naming converted files. `{n}` finds the
  first free number in the output folder, so batches count 1, 2, 3….
  Leaving the field empty (or `{name}`) keeps the original naming, and
  the timestamp suffix still prevents collisions. The template persists
  between sessions, and the tokens are clickable chips that insert at
  the caret.

- **Settings presets.** Save the current global settings (format +
  options + transforms) under a name and recall them from a dropdown
  next to the Convert-to header; Delete removes the selected preset.
  Presets persist in the desktop app's config file (next to the output
  folder choice) and in localStorage in web mode.
- **Manual crop.** An "Open crop overlay…" button in the per-file drawer
  opens a drag-to-crop editor: draw, move, and resize a selection with
  corner and edge handles, lock the aspect ratio (landscape and portrait:
  1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16), and read the live size in source
  pixels. The crop is stored in original source coordinates and applied
  before rotation/resize, so what you draw is exactly the region kept.
  Works with mouse and touch. The aspect-crop controls stay enabled while
  a manual region is set — picking an aspect ratio replaces the region.
- **Per-file transforms editing.** The per-file settings drawer now hosts
  a fully editable Transforms panel (resize, rotate, flip, crop, kernel)
  bound to that file's override — previously transforms were snapshotted
  but read-only. The dimension preview inside the drawer is pinned to that
  file's own dimensions. Global and per-file panels share one renderer.

### Fixed

- Hidden buttons (e.g. the Transforms "Reset") could stay visible because
  the `.btn` display rule overrode the `hidden` attribute.
- Combining rotate 90°/270° with an aspect-ratio crop or percentage
  resize used the pre-rotation dimensions, producing wrong crop geometry.
  Transform steps now track the running dimensions through the pipeline.
- **Dependencies.** Resolved 6 Dependabot advisories via `npm audit fix`
  — most notably `multer` 2.1.1 → 2.2.0 (two DoS advisories; the rest
  are transitive `electron-builder`/`electron` build-time bumps, never
  shipped in the packaged app).
- **Security.** Closed two CodeQL alerts in the filename-template code:
  a path-injection gap in the `{n}`-collision probe (a fallback branch
  could reach `fs.existsSync` with unsanitized, attacker-controlled
  data) and a polynomial-regex ReDoS in the stem-trimming logic,
  replaced with a linear manual scan.

## [1.3.0] — 2026-06-10

### Added

- **Per-file settings overrides.** Each file row now has a pencil button
  that opens an inline settings drawer, detaching that file from the
  global defaults. The drawer exposes a full format selector and all
  format-specific options (quality, lossless, effort, etc.) independently
  for that file. A badge in the row shows the overridden format at a
  glance; a Reset link reverts to globals.
- **"Apply to all" button** in the Convert-to header. Pushes the current
  global settings onto every file in the list, overwriting any per-file
  customizations — a fast way to re-synchronize after bulk-adding files.
- **Open folder button** next to Change output folder in the output row.
  Opens the current output directory in Finder / Explorer without leaving
  the app. Mirrors the existing Output › Open Output Folder menu item
  (⌘O) but puts it at the fingertips right after a batch conversion.

### Fixed

- **Batch conversions stopping mid-run** when any file had its per-file
  settings drawer open. `rebuildOpts` was calling `updateRowOverrideUI`
  which re-entered `buildDrawerContent` → `rebuildOpts` → infinite
  recursion → stack overflow caught by `convertFile`'s error handler,
  marking the file as error and halting the batch. The fix splits
  responsibility: `rebuildOpts` only rebuilds the options panel; a new
  `refreshBadge` helper updates the format badge directly from the
  format-button onclick without touching the drawer.

### Notes / deferred

- Per-file transforms editing (resize, rotate, flip, crop per file) is
  intentionally deferred to the next release alongside the manual crop
  overlay feature. The transforms snapshot captured at customization time
  is preserved and shown read-only in the drawer.
- Presets (save/recall/delete named settings), filename templates, PDF
  input, and manual crop boxes are also deferred to the next release.

### Preserved

- WebP byte-identical output guarantee — confirmed again (438-byte match).
- All v1.2 capabilities: transforms, smart Convert button, batch modes,
  all supported formats, metadata toggles, output folder picker.

## [1.2.0] — 2026-05-25

### Added

- **Transforms section.** A new collapsible section between Privacy and
  Output folder gives you a real image-processing pipeline alongside the
  format conversion:
  - **Resize** with three modes — *Max dimension* (bounds the long edge,
    preserves aspect), *Percentage*, and *Exact dimensions* (auto-crops to
    fit). Optional *Allow upscale* toggle gates enlargement on the first
    two modes; Exact always allows it.
  - **Rotate** in fixed 90° / 180° / 270° increments.
  - **Flip horizontal** and **flip vertical** as independent toggles.
  - **Crop to aspect** — 1:1, 4:3, 3:2, 16:9, or a custom W:H. Center crop
    only in v1.2; manual crop boxes are slated for v1.3.
  - **Resample kernel** selector — Lanczos 3 (default), Lanczos 2,
    Mitchell, Cubic, or Nearest (sharp pixels). Only enabled when a resize
    is active.
  - A live **"Resulting dimensions"** preview computed from the first file
    in the list. Per-file row notice describes the active transforms.
    Reset button restores all controls to defaults.
- **Smart-label Convert button.** Replaces the old "Convert all" with a
  context-aware split button. Labels as `Convert N new` when there are
  unconverted files and offers `Reconvert all` via the dropdown when both
  actions are useful; `Reconvert all N files` when everything's already
  done. Per-row Convert / Reconvert buttons unchanged.
- **MIT LICENSE** file (the v1.1.1 commit added the field to `package.json`;
  this surfaces the full text at the repo root).
- **GitHub Actions CI workflow** (`.github/workflows/ci.yml`). Runs on PRs
  to `main` and direct pushes to `main`: `npm ci`, syntax check for every
  JS entrypoint, and a module-load smoke test that catches polyfill
  regressions and missing-dep issues without needing fixture binaries.

### Changed

- **DOM-API refactor of `public/index.html`.** All fourteen `innerHTML =`
  string-interpolation assignments replaced with explicit DOM construction
  via two small `el()` / `svgEl()` helpers. Every attribute and text node
  now flows through `setAttribute` / `createTextNode`, never through the
  HTML parser. Closes the three CodeQL "DOM text reinterpreted as HTML"
  alerts structurally instead of by dismissal, and removes a class of
  future XSS risk if anyone forgets the escape convention in a PR.

### Notes / deferred

- **RAW camera input** (NEF / CR2 / CR3 / DNG / ARW / ORF / RW2 / RAF) was
  investigated as a v1.2 stretch goal and deferred. magick-wasm accepts
  RAW files but only extracts the small embedded preview thumbnail
  (typically 160×120 from a 33 MB NEF), not the full demosaiced sensor
  data. Shipping that would surprise users expecting their full image.
  RAW returns when a real decoder (libraw-wasm or similar) lands.
- **Manual crop boxes** (drag-to-crop overlay) stay on the v1.3 docket.

### Preserved

- WebP byte-identical output guarantee — verified again with transforms
  field absent and with empty `{}`, both produce the same SHA-256 as the
  pre-LocalPix reference.
- All v1.1 capabilities: formats, metadata toggles, output folder picker,
  drag-and-drop, batch convert, ICO multi-size, SVG density, JPEG alpha
  flatten (which was re-tested across all four transform combinations).

## [1.1.1] — 2026-05-24

### Security

- **Path-traversal defense.** Defensive `path.basename()` + outputDir boundary
  checks added to `resolveOutputPath()` and the `/api/download/:filename`
  handler. Filenames containing traversal sequences (`..`, absolute paths,
  OS-specific separator tricks) now safely land inside the output folder or
  are rejected. Closes the two CodeQL "Uncontrolled data used in path
  expression" alerts.
- **Rate limiting** via `express-rate-limit` on the conversion (100/min) and
  download (300/min) endpoints, with standard `RateLimit` response headers.
  The server still binds to loopback only (`127.0.0.1`); the threat model is
  "a malicious local webpage that has discovered the loopback port," not the
  public internet. Closes the two CodeQL "Missing rate limiting" alerts.

### Added

- **MIT License** (`LICENSE` file + `license`/`author` fields in `package.json`).
- **GitHub Actions release pipeline** (`.github/workflows/release.yml`).
  Pushing a `v*` tag now triggers parallel macOS + Windows builds and creates
  a draft GitHub Release with both artifacts and release notes auto-extracted
  from this CHANGELOG.
- **`scripts/build-icns.sh`** — reusable macOS `.icns` generator from any
  1024×1024 PNG master. Used to build both the light and dark icon variants.

### Notes

- Three CodeQL "DOM text reinterpreted as HTML" alerts in
  `public/index.html` remain open as won't-fix — all interpolated values flow
  through `escHtml()` and aren't reachable XSS. Pencilled in for a full
  DOM-API refactor in v1.2.

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
