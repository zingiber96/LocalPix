// LocalConvert — local, offline, multi-format image converter.
// Single Express server: serves the static frontend and exposes one
// conversion endpoint that dispatches by target format.

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const bmpJs = require('bmp-js');
const agPsd = require('ag-psd');
const heicDecode = require('heic-decode');

// ag-psd in Node has no HTMLCanvasElement to fall back on. Rather than pull
// in node-canvas (heavy native dep: Cairo, Pango, libjpeg...), inject a
// minimal Node-compatible polyfill. Only createImageData() is actually hit
// by our composite-only PSD path (skipLayerImageData + skipThumbnail), but
// the other two are provided as safety stubs in case ag-psd's internals call
// them on an unexpected code path.
agPsd.initializeCanvas(
  function createCanvas(width, height) {
    const buf = new Uint8ClampedArray(width * height * 4);
    return {
      width,
      height,
      getContext() {
        return {
          createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
          getImageData: (x, y, w, h) => ({ width: w, height: h, data: buf.slice() }),
          putImageData: () => {},
          drawImage: () => {},
        };
      },
    };
  },
  function createCanvasFromData(/* data */) {
    // Only hit when reading embedded thumbnails (we pass skipThumbnail: true).
    return null;
  },
  function createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
);

// Output dir and port are configurable so the same server can run as a
// standalone process (`npm start`) or be embedded in the Electron app.
// WEBP_OUTPUT_DIR is still honoured for backwards-compatibility with users
// who set it under the old name.
//
// outputDir is mutable at runtime so the Electron host can update it when
// the user picks a new folder via the native dialog. Web/Docker mode reads
// the env var at startup and never reassigns.
let outputDir =
  process.env.LOCALCONVERT_OUTPUT_DIR ||
  process.env.WEBP_OUTPUT_DIR ||
  path.join(__dirname, 'output');
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

function getOutputDir() {
  return outputDir;
}

// Set a new output directory. Creates the folder if it doesn't exist, and
// throws if the path isn't writable. Called by the Electron host after the
// user picks a folder.
function setOutputDir(newDir) {
  if (typeof newDir !== 'string' || !newDir) {
    throw new Error('Output directory path must be a non-empty string.');
  }
  const resolved = path.resolve(newDir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  fs.accessSync(resolved, fs.constants.W_OK);
  outputDir = resolved;
  return outputDir;
}

// -- Accepted input formats ---------------------------------------------------
// Symmetric: also writable. Asymmetric inputs (SVG, PSD, HEIF) are documented
// in the README and excluded from the output dispatch table below.
//
// HEIF note: we accept .heic/.heif files (HEVC-in-HEIF). Decode is attempted
// via sharp's bundled libheif first; if that build can't decode HEVC, we fall
// back to heic-decode (pure-JS via libde265-WASM) so distribution stays simple.
// We do NOT encode HEIF/HEIC because that requires shipping an HEVC encoder
// (x265) whose patent-pool licensing is incompatible with an open-source
// release. AVIF (HEIF container + royalty-free AV1) covers the same need on
// the output side. Revisit if licensing changes.
//
// PSD note: sharp's prebuilt libvips does not include the ImageMagick delegate,
// so PSD is decoded JS-side via ag-psd (flattened composite — layers are not
// preserved).
//
// BMP note: same magick-delegate limitation, so BMP input is decoded via
// bmp-js (and BMP output is also encoded via bmp-js since sharp can't write
// BMP either).
const INPUT_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif',
  'image/gif',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  'image/tiff', 'image/bmp', 'image/svg+xml',
  'image/vnd.adobe.photoshop', 'application/x-photoshop',
  'application/photoshop', 'application/psd', 'image/x-photoshop',
]);
const INPUT_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif',
  '.heic', '.heif', '.heics', '.heifs',
  '.tif', '.tiff', '.bmp', '.svg', '.psd',
]);

// -- Small helpers ------------------------------------------------------------
function clamp(value, lo, hi, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function parseHexColor(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

// detectSourceKind: which decoder path do we take?
// Returns one of: jpeg, png, webp, avif, gif, heif, tiff, bmp, svg, psd, unknown.
function detectSourceKind(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (ext === '.psd' || mime.includes('photoshop') || mime === 'application/psd') return 'psd';
  if (ext === '.bmp' || mime === 'image/bmp') return 'bmp';
  if (
    ['.heic', '.heif', '.heics', '.heifs'].includes(ext) ||
    mime.startsWith('image/heic') ||
    mime.startsWith('image/heif')
  ) return 'heif';
  if (ext === '.svg' || mime === 'image/svg+xml') return 'svg';
  if (ext === '.gif' || mime === 'image/gif') return 'gif';
  if (ext === '.png' || mime === 'image/png') return 'png';
  if (ext === '.webp' || mime === 'image/webp') return 'webp';
  if (ext === '.avif' || mime === 'image/avif') return 'avif';
  if (['.tif', '.tiff'].includes(ext) || mime === 'image/tiff') return 'tiff';
  if (['.jpg', '.jpeg'].includes(ext) || mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  return 'unknown';
}

// Build a sharp pipeline from the uploaded buffer, routing through JS-side
// decoders for formats sharp's prebuilt libvips can't read.
async function buildSourcePipeline(file, sourceKind, { density }) {
  if (sourceKind === 'svg') {
    return sharp(file.buffer, { density });
  }

  if (sourceKind === 'psd') {
    const psd = agPsd.readPsd(file.buffer, {
      skipLayerImageData: true,
      skipThumbnail: true,
      useImageData: true,
    });
    if (!psd.imageData) throw new Error('PSD has no composite image to convert.');
    const { width, height, data } = psd.imageData;
    // psd.imageData.data is a Uint8ClampedArray of RGBA.
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    });
  }

  if (sourceKind === 'bmp') {
    const decoded = bmpJs.decode(file.buffer, true);
    return sharp(decoded.data, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    });
  }

  if (sourceKind === 'heif') {
    // sharp's prebuilt libvips ships libheif without the HEVC decoder plugin
    // (libde265) — the same patent-related omission that excludes HEIC from
    // the output side. With no plugin, sharp parses the HEIF container fine
    // (metadata works) but throws "No decoding plugin installed" at the
    // moment of pixel extraction — too late for a try/catch on metadata to
    // catch. Decode unconditionally via heic-decode (pure-JS libde265-WASM)
    // and hand the raw pixels to sharp. AVIF files are routed through the
    // 'avif' source kind, not here.
    const { width, height, data } = await heicDecode({ buffer: file.buffer });
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    });
  }

  return sharp(file.buffer);
}

// -- ICO encoder (inline) -----------------------------------------------------
// ICO container format: 6-byte ICONDIR header + 16-byte ICONDIRENTRY per image
// + concatenated PNG buffers. We embed PNGs (not raw BMP) since every modern
// OS supports PNG-in-ICO and it keeps file sizes small.
function packIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type = 1 (icon)
  header.writeUInt16LE(count, 4); // image count

  const dirEntries = Buffer.alloc(16 * count);
  let offset = header.length + dirEntries.length;
  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];
    const e = i * 16;
    dirEntries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width  (0 = 256)
    dirEntries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height (0 = 256)
    dirEntries.writeUInt8(0, e + 2);                       // palette colours
    dirEntries.writeUInt8(0, e + 3);                       // reserved
    dirEntries.writeUInt16LE(1, e + 4);                    // colour planes
    dirEntries.writeUInt16LE(32, e + 6);                   // bits per pixel
    dirEntries.writeUInt32LE(buf.length, e + 8);           // image size
    dirEntries.writeUInt32LE(offset, e + 12);              // offset to data
    offset += buf.length;
  }
  return Buffer.concat([header, dirEntries, ...pngBuffers]);
}

// -- Output dispatch table ----------------------------------------------------
// Each entry: { ext, encode(pipeline, opts, ctx) -> Buffer }.
// To add a future format, add an entry here and a matching entry to
// FORMAT_OPTIONS in public/index.html. No endpoint changes required.
//
// v1 decisions captured here for future maintainers:
//   * Target format + options are GLOBAL (one selection per batch).
//     Per-file overrides are a v1.1 candidate.
//   * Animated GIF/WebP inputs are flattened to the first frame for every
//     target. Frame-by-frame conversion is a v1.1 candidate.
const ENCODERS = {
  jpeg: {
    ext: 'jpg',
    async encode(pipeline, opts) {
      const quality = clamp(opts.quality, 1, 100, 80);
      const progressive = !!opts.progressive;
      const bg = parseHexColor(opts.background) || { r: 255, g: 255, b: 255, alpha: 1 };
      // JPEG has no alpha. Flatten transparent sources onto bg to avoid the
      // libjpeg "transparent = black" pitfall.
      const meta = await pipeline.clone().metadata();
      let out = pipeline;
      if (meta.hasAlpha) out = out.flatten({ background: bg });
      return out.jpeg({ quality, mozjpeg: true, progressive }).toBuffer();
    },
  },

  png: {
    ext: 'png',
    async encode(pipeline, opts) {
      const compressionLevel = clamp(opts.compressionLevel, 0, 9, 6);
      const palette = !!opts.palette;
      return pipeline.png({ compressionLevel, palette }).toBuffer();
    },
  },

  webp: {
    ext: 'webp',
    async encode(pipeline, opts) {
      const lossless = !!opts.lossless;
      const quality = clamp(opts.quality, 1, 100, 80);
      const effort = clamp(opts.effort, 0, 6, 4);
      // alphaQuality is fixed at 100 (not exposed in UI) to preserve
      // byte-identical output with the pre-LocalConvert WebP defaults.
      return pipeline.webp({ quality, lossless, effort, alphaQuality: 100 }).toBuffer();
    },
  },

  avif: {
    ext: 'avif',
    async encode(pipeline, opts) {
      const lossless = !!opts.lossless;
      const quality = clamp(opts.quality, 1, 100, 50);
      const effort = clamp(opts.effort, 0, 9, 4);
      return pipeline.avif({ quality, lossless, effort }).toBuffer();
    },
  },

  gif: {
    ext: 'gif',
    async encode(pipeline, opts) {
      const colours = clamp(opts.colors, 2, 256, 256);
      const effort = clamp(opts.effort, 1, 10, 7);
      const loop = clamp(opts.loop, 0, 65535, 0);
      return pipeline.gif({ colours, effort, loop }).toBuffer();
    },
  },

  tiff: {
    ext: 'tiff',
    async encode(pipeline, opts) {
      const compression = ['lzw', 'deflate', 'jpeg', 'none'].includes(opts.compression)
        ? opts.compression
        : 'lzw';
      const tiffOpts = { compression };
      if (compression === 'jpeg') tiffOpts.quality = clamp(opts.quality, 1, 100, 80);
      return pipeline.tiff(tiffOpts).toBuffer();
    },
  },

  bmp: {
    ext: 'bmp',
    async encode(pipeline) {
      // sharp cannot write BMP; produce raw RGBA and encode via bmp-js.
      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const encoded = bmpJs.encode({ data, width: info.width, height: info.height });
      return encoded.data;
    },
  },

  ico: {
    ext: 'ico',
    async encode(pipeline, opts) {
      const allowed = [16, 32, 48, 64, 128, 256];
      const requested = Array.isArray(opts.sizes) && opts.sizes.length
        ? opts.sizes.map(Number).filter((n) => allowed.includes(n))
        : [16, 32, 48];
      const sizes = [...new Set(requested)].sort((a, b) => a - b);
      if (!sizes.length) sizes.push(32);

      // Materialise the source as a PNG once, then resize from that for each
      // requested icon size. fit:'contain' with transparent padding handles
      // non-square sources (pad, do not crop or stretch).
      const srcPng = await pipeline.png().toBuffer();
      const pngBuffers = [];
      for (const size of sizes) {
        const buf = await sharp(srcPng)
          .resize({
            width: size,
            height: size,
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png({ compressionLevel: 9 })
          .toBuffer();
        pngBuffers.push(buf);
      }
      return packIco(pngBuffers, sizes);
    },
  },
};

// -- App factory --------------------------------------------------------------
function createApp() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const app = express();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = (file.mimetype || '').toLowerCase();
      if (INPUT_MIMES.has(mime) || INPUT_EXTS.has(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${mime || ext || 'unknown'}`));
      }
    },
  });

  app.use(express.static(path.join(__dirname, 'public')));

  function resolveOutputPath(baseName) {
    // Read outputDir at call time, not at app-creation time, so changes via
    // setOutputDir() take effect on the next conversion without a restart.
    const candidate = path.join(outputDir, baseName);
    if (!fs.existsSync(candidate)) return candidate;
    const ts = Date.now();
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    return path.join(outputDir, `${stem}_${ts}${ext}`);
  }

  // Lightweight config endpoint — lets the frontend display the current
  // output folder in the UI and detect whether it's running in Electron.
  app.get('/api/config', (req, res) => {
    res.json({
      outputDir,
      // No way to tell from inside the server alone, but the Electron host
      // sets this env var when it embeds us. The frontend uses this to decide
      // whether to show the "Change…" button.
      electron: !!process.env.LOCALCONVERT_ELECTRON,
    });
  });

  app.post('/api/convert', upload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const targetFormat = String(req.body.targetFormat || 'webp').toLowerCase();
    const encoder = ENCODERS[targetFormat];
    if (!encoder) {
      return res
        .status(400)
        .json({ error: `Unsupported target format: ${targetFormat}` });
    }

    let opts = {};
    if (req.body.options) {
      try {
        opts = JSON.parse(req.body.options);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid options JSON' });
      }
    }

    const density = clamp(req.body.inputDensity, 72, 1440, 192);
    const sourceKind = detectSourceKind(req.file);

    const originalStem = path.parse(req.file.originalname).name;
    const outputFilename = `${originalStem}.${encoder.ext}`;
    const outputPath = resolveOutputPath(outputFilename);

    try {
      const pipeline = await buildSourcePipeline(req.file, sourceKind, { density });
      const outputBuffer = await encoder.encode(pipeline, opts, { sourceKind });
      fs.writeFileSync(outputPath, outputBuffer);

      res.json({
        originalName: req.file.originalname,
        originalSize: req.file.size,
        convertedName: path.basename(outputPath),
        convertedSize: outputBuffer.length,
      });
    } catch (err) {
      console.error('Conversion error:', err.message);
      res.status(500).json({ error: `Conversion failed: ${err.message}` });
    }
  });

  app.get('/api/download/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(outputDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.download(filePath, filename);
  });

  // JSON error handler — converts multer fileFilter rejections and the like
  // into structured responses the frontend can display inline.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err && err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: err.message || 'Upload error' });
  });

  return app;
}

/**
 * Start the HTTP server.
 * @param {number} [port] Port to bind. Pass 0 for an OS-assigned free port.
 * @returns {Promise<{port:number, server:import('http').Server, outputDir:string}>}
 */
function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(port, '127.0.0.1');
    server.on('listening', () => {
      resolve({ port: server.address().port, server, outputDir });
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, startServer, getOutputDir, setOutputDir };

// Run directly (`node server.js` / `npm start`) — keep CLI behaviour.
if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`\n  LocalConvert running at http://localhost:${port}\n`);
  });
}
