# WebP Converter

A local, offline web app to batch-convert PNG, JPEG, and SVG images to WebP.

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

**Install:** open `release/WebP Converter-1.0.0-arm64.dmg` and drag the app to
Applications, then double-click it like any other app.

Converted files are saved to **`~/Downloads/WebP Converter/`**. Use the
**Output → Open Output Folder** menu item (⌘O) to jump there.

### Building the app from source

```bash
npm install          # installs Electron + electron-builder (dev deps)
npm run app          # run the desktop app in dev mode
npm run dist         # build release/*.dmg, *.zip and the .app bundle
```

> The build is unsigned (`identity: null`). On first launch macOS Gatekeeper
> may warn — right-click the app → **Open**, or run
> `xattr -dr com.apple.quarantine "WebP Converter.app"`.

## Run with Docker (standalone)

No Node install needed — just Docker.

```bash
# Build and run with Compose (recommended)
docker compose up --build

# …or with plain Docker
docker build -t webp-converter .
docker run -p 3000:3000 -v "$(pwd)/output:/app/output" webp-converter
```

Open **http://localhost:3000**. Converted files are written to the host
`./output` folder via a bind mount, so they persist after the container stops.

To run it detached and manage it:

```bash
docker compose up -d --build   # start in background
docker compose logs -f         # view logs
docker compose down            # stop and remove
```

## Features

- Drag-and-drop or click-to-browse upload
- Thumbnail preview before conversion
- Quality slider (0–100, default 80)
- SVG rasterization at 1×, 2×, or 3× resolution
- Convert all files at once or individually
- File size before/after with savings percentage
- Inline download links after conversion
- Converted files saved to `./output/` with timestamp collision avoidance
- Fully offline — no external APIs or database

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `multer` | Multipart file upload handling |
| `sharp` | Image processing and WebP conversion |
