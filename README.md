# LocalPix

A local, offline image converter. Batch-convert between JPEG, PNG, WebP,
AVIF, GIF, TIFF, BMP and ICO — and read HEIC, SVG and PSD as inputs. No
upload, no telemetry, no account.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- npm (bundled with Node)

## Setup

```bash
# Install dependencies (first run only)
npm install

# Start the server
npm start
```

Then open **http://localhost:3000** in your browser.

## Desktop app (click-to-launch, no terminal)

A standalone macOS app — no Node, npm, or Docker needed by the end user.

**Install:** open the DMG in `release/` and drag the app to Applications, then
double-click it like any other app.

Converted files are saved to **`~/Documents/LocalPix/`** by default — use
**Output → Change Output Folder…** (⌘⇧O) to pick anywhere else. Open the
current folder with **Output → Open Output Folder** (⌘O).

### Building the app from source

```bash
npm install          # installs Electron + electron-builder (dev deps)
npm run app          # run the desktop app in dev mode
npm run dist         # build release/*.dmg, *.zip and the .app bundle
```

> The build is unsigned (`identity: null`). On first launch macOS Gatekeeper
> may warn — right-click the app → **Open**, or run
> `xattr -dr com.apple.quarantine "LocalPix.app"`.

## Run with Docker (standalone)

No Node install needed — just Docker.

```bash
# Build and run with Compose (recommended)
docker compose up --build

# …or with plain Docker
docker build -t localpix .
docker run -p 3000:3000 -v "$(pwd)/output:/app/output" localpix
```

Open **http://localhost:3000**. Converted files are written to the host
`./output` folder via a bind mount, so they persist after the container stops.

To run it detached and manage it:

```bash
docker compose up -d --build   # start in background
docker compose logs -f         # view logs
docker compose down            # stop and remove
```

## Supported formats

### Read (input)

JPEG, PNG, WebP, AVIF, GIF, **HEIF/HEIC**, TIFF, BMP, **SVG**, **PSD**

### Write (output)

JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, ICO

### Input-only formats

Three formats can be read but not written:

- **SVG** — vector-to-raster is well-defined; raster-to-vector is tracing
  rather than conversion, and is out of scope.
- **PSD** — imported as a flattened composite. Layers, effects, masks and
  adjustment layers are not preserved.
- **HEIF/HEIC** — accepted as input (decoded locally). HEIC files use the
  HEVC codec, and shipping an HEVC encoder (x265) in an open-source GitHub
  release carries patent-pool licensing complications. AVIF — which uses the
  same HEIF container with the royalty-free AV1 codec — covers the same
  "modern, highly compressed" use case on the output side.

## Features

- Drag-and-drop or click-to-browse upload
- Thumbnail preview before conversion (where the browser can render the format)
- Per-format options: JPEG quality and progressive, PNG palette and compression,
  WebP lossy/lossless and effort, AVIF quality and effort, GIF colours and loop,
  TIFF compression, ICO size set
- SVG rasterization at 1×, 2× or 3× resolution
- Inline JPEG background-fill picker for transparent sources
- Inline notice on non-square sources when targeting ICO
- Convert all files at once or individually
- File size before/after with savings percentage
- Inline download links after conversion
- Converted files saved to `./output/` with timestamp collision avoidance
- Fully offline — no external APIs, analytics or telemetry

## Architecture notes

The conversion endpoint dispatches by target format via a single table in
`server.js`. Each entry pairs an encoder function with a small options schema.
The frontend renders the options panel from a parallel config in
`public/index.html`. Adding a future format is one entry on each side; the
endpoint logic itself stays unchanged.

For format-specific implementation details and v1 decisions (per-file vs.
global options, animation flattening, the HEIC licensing reasoning), see the
inline comments in `server.js`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `multer` | Multipart file upload handling |
| `sharp` | Image processing, primary encoder |
| `ag-psd` | PSD decode (flattened composite) |
| `bmp-js` | BMP encode and decode |
| `heic-decode` | HEIF/HEIC decode fallback when sharp's libheif lacks HEVC |
