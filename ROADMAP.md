# LocalPix Roadmap

A living map of where LocalPix has been and where it's headed. For the detailed
record of what shipped in each release, see [CHANGELOG.md](CHANGELOG.md).

Legend: ✅ shipped · 🔨 in progress · 📋 planned · ⏸️ deferred/blocked

---

## Shipped

### v1.1.0 — Formats + the architecture pivot
- JPEG XL input + output
- Strip-metadata / preserve-color-profile toggles
- **magick-wasm hybrid architecture** — `sharp` for the hot path
  (JPEG/PNG/WebP/AVIF/GIF/TIFF), `@imagemagick/magick-wasm` for everything
  else. Replaced four separate fallback libraries; makes new formats cheap.

### v1.1.1 — Hardening
- Path-traversal defense + rate limiting (closed CodeQL alerts)
- MIT license
- GitHub Actions release pipeline (`v*` tag → parallel mac/win build → draft
  release)

### v1.2.0 — Transforms
- Resize (max / percentage / exact + upscale toggle), rotate, flip,
  crop-to-aspect, resample kernel
- Smart-label Convert / Reconvert split button
- DOM-API refactor (closed remaining CodeQL XSS alerts)
- CI smoke workflow

### v1.3.0 — Per-file control
- Per-file settings overrides (inline drawer; detach a file from global
  defaults with its own format + options)
- "Apply to all" button
- "Open folder" button in the output row

### v1.4.2 — Update check + guardrails
- **Manual update check** — footer button, one anonymous GET to the GitHub
  Releases API, user-initiated only (no background checks, no identifiers);
  documented in the README FAQ
- **Max file size control** — slider (10 MB → 2 GB → no limit, default
  250 MB) with a "?" explainer, replacing the old hard-coded 100 MB cap;
  enforced client-side at file-add and server-side via `?maxBytes=` (2 GB
  absolute ceiling protects the in-memory upload buffer)
- Dependency security sweep — all 18 Dependabot alerts closed (sharp 0.35.3
  with the WebP byte-identical guarantee re-verified; electron-builder
  26.15.3; `npm audit` clean)

> Threaded through these: the WEBPConvert → LocalConvert → LocalPix rebrand,
> the redesigned UI, app icons, user-selectable output folder, and dark mode —
> none on the original feature roadmap, all shipped.

---

## Planned

### v1.4 — "Full Control" (next; clears the deferred backlog)
Theme: complete, granular control over every conversion.
- 📋 **PDF input** (`mupdf` — gated and proven to render full-res pages in Node)
- 📋 **Filename templates** (`{name}` `{format}` `{date}` `{width}` `{height}`)
- 📋 **Presets** (save / recall / delete named settings, persisted)
- 📋 **Per-file transforms editing** — generalize the transforms UI to bind to
  any state (the way `renderField` already does for options); make the
  per-file drawer's transforms editable instead of read-only
- 📋 **Manual crop overlay** — drag-to-crop on the thumbnail, per file
- Release prep

### v1.5 — Animation (next)
- 📋 Animated GIF/WebP/AVIF round-trip (currently flattened to first frame)
- 📋 Per-format animation options (loop, FPS, frame skip)
- 📋 Frame extraction (animated → series of stills)
- 📋 In-row animation preview

### v1.6 — Smart choices
- 📋 Live quality preview with size estimate
- 📋 Before/after compare slider
- 📋 "Recommended format" suggestion per source
- 📋 Quality cheat-sheet tooltips
- 📋 Optional SSIM / perceptual-quality score

### Later — Bigger batches
- 📋 Folder drag-and-drop → recursive conversion
- 📋 Output organization (mirror structure / flat / group by format)

### Later — Power tools
- 📋 `localpix` CLI binary (shared dispatch core with the server)
- 📋 Drag-out to Finder / Explorer
- 📋 OS shell integration (macOS Quick Action / Windows "Send To")
- 📋 Preset import/export as JSON
- 📋 File association ("Open with LocalPix")

---

## Deferred / blocked

| Item | Status | Reason |
|---|---|---|
| **RAW input** (DNG/NEF/CR2/ARW…) | ⏸️ blocked | magick-wasm only extracts the embedded preview thumbnail; `libraw-wasm` is browser-only and won't run cleanly server-side. Needs either client-side decode (architecture change) or a Node-native decoder. LibRaw the C library decodes DNG fine — the blocker is *where it can run*, not capability. |
| **JPEG 2000** (`.jp2`) | ⏸️ easy, deprioritized | Works via magick-wasm (decode + encode confirmed). ~1 dispatch entry whenever wanted. |
| **OpenEXR** (`.exr`) | ⏸️ easy, deprioritized | Same as JP2 — magick-wasm handles it; cheap to add. |

---

## Non-feature track

| Item | Status |
|---|---|
| GitHub Actions release pipeline | ✅ done (v1.1.1) |
| CI smoke workflow | ✅ done (v1.2.0) |
| README hero screenshot | ✅ done |
| Code signing + notarization (removes Gatekeeper/SmartScreen warnings) | 📋 pending — currently ad-hoc signed (`identity: "-"`) |
| `electron-updater` auto-update | ⏸️ deferred — manual update check (v1.4.2) covers notification; full auto-update is blocked on macOS by ad-hoc signing (Squirrel.Mac requires a Developer ID cert), i.e. on the code-signing row above |
| Submit to `awesome-*` lists (public-launch task) | 📋 not started |
| macOS Intel + Windows ARM builds | 📋 available via scripts, not in the default release set |

---

## Architecture invariants (don't break these)

- **WebP byte-identical guarantee** — a default WebP convert (lossy q80,
  effort 4, no transforms, no metadata flags) must produce byte-identical
  output to the original app, back to the pre-rename WEBPConvert. Every
  release re-verifies this. Mechanism: when nothing is customized, the request
  carries no `transforms` field and no metadata flags, so the pipeline is a
  no-op beyond the WebP encode.
- **No `innerHTML =` string interpolation** in `public/index.html` — DOM is
  built via the `el()` / `svgEl()` helpers (closed a class of CodeQL XSS
  alerts; don't reintroduce the sink).
- **Local-only** — server binds to `127.0.0.1`; no external calls, no
  telemetry. The whole value proposition. Single carve-out (v1.4.2): the
  footer's user-initiated "Check for updates" makes one anonymous GET to the
  GitHub Releases API — never automatic, never carrying data. Any future
  network touch must meet that same bar and be documented in the README FAQ.
- **Hybrid decode** — `sharp` owns the hot path (and the byte-identical
  guarantee depends on it); `lib/magick.js` owns everything else. Adding a
  format is ideally one `ENCODERS` entry + one `FORMAT_OPTIONS` entry.
