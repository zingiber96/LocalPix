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
