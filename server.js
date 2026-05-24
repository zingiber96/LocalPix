// LocalPix — local, offline, multi-format image converter.
// Single Express server: serves the static frontend and exposes one
// conversion endpoint that dispatches by target format.

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const magick = require('./lib/magick');

// Output dir and port are configurable so the same server can run as a
// standalone process (`npm start`) or be embedded in the Electron app.
// LOCALCONVERT_OUTPUT_DIR is honoured as a one-version-back fallback so
// users who set the env var under the previous app name don't lose their
// configuration on upgrade. The WEBP_OUTPUT_DIR env from the original
// WEBPConvert release is no longer recognized (two renames is enough).
//
// outputDir is mutable at runtime so the Electron host can update it when
// the user picks a new folder via the native dialog. Web/Docker mode reads
// the env var at startup and never reassigns.
let outputDir =
  process.env.LOCALPIX_OUTPUT_DIR ||
  process.env.LOCALCONVERT_OUTPUT_DIR ||
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
// Decode strategy: sharp handles the formats its prebuilt libvips reads
// natively (JPEG/PNG/WebP/AVIF/GIF/TIFF — see SHARP_NATIVE_SOURCES below).
// Everything else (HEIF, PSD, BMP, and any future addition like JXL/JP2/EXR/
// RAW) is routed through magick-wasm (lib/magick.js), which decodes to raw
// RGBA that we hand back to sharp for the rest of the pipeline. This unifies
// what used to be four bespoke decoder libraries (ag-psd, heic-decode,
// libheif-js, bmp-js) into one consistent code path.
//
// HEIF policy: we accept .heic/.heif (HEVC-in-HEIF) as input. We do NOT
// encode HEIF/HEIC because that requires shipping an HEVC encoder (x265)
// whose patent-pool licensing is incompatible with an open-source release.
// AVIF — same HEIF container with the royalty-free AV1 codec — covers the
// "modern, highly compressed" use case on the output side. magick-wasm's
// build also excludes HEVC encoding for the same reason.
const INPUT_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif',
  'image/gif',
  'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
  'image/tiff', 'image/bmp', 'image/svg+xml',
  'image/vnd.adobe.photoshop', 'application/x-photoshop',
  'application/photoshop', 'application/psd', 'image/x-photoshop',
  'image/jxl',
]);
const INPUT_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif',
  '.heic', '.heif', '.heics', '.heifs',
  '.tif', '.tiff', '.bmp', '.svg', '.psd',
  '.jxl',
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
// Returns one of: jpeg, png, webp, avif, gif, heif, tiff, bmp, svg, psd, jxl, unknown.
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
  if (ext === '.jxl' || mime === 'image/jxl') return 'jxl';
  if (['.tif', '.tiff'].includes(ext) || mime === 'image/tiff') return 'tiff';
  if (['.jpg', '.jpeg'].includes(ext) || mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  return 'unknown';
}

// Source kinds that sharp's prebuilt libvips decodes natively. Anything not
// in this set (plus SVG, which has its own density-aware path) is routed
// through magick-wasm. Keeping this small and explicit means the WebP
// byte-identical guarantee — which depends on staying inside the sharp
// pipeline for the hot path — is enforced structurally, not by accident.
const SHARP_NATIVE_SOURCES = new Set([
  'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff',
]);

// Build a sharp pipeline from the uploaded buffer. SVG keeps its density-
// aware decode; sharp-native formats pass through unchanged; everything else
// is decoded by magick-wasm to raw RGBA and re-entered into sharp's pipeline.
async function buildSourcePipeline(file, sourceKind, { density }) {
  if (sourceKind === 'svg') {
    return sharp(file.buffer, { density });
  }

  if (SHARP_NATIVE_SOURCES.has(sourceKind)) {
    return sharp(file.buffer);
  }

  // heif, psd, bmp — and any future v1.x format (jxl, jp2, exr, raw, …).
  // See lib/magick.js for the wrapper; Phase 0 validation report for the
  // per-format gating decisions and known limitations (no Ghostscript so
  // PDF input needs a separate decoder; HEIC output stays excluded).
  const { width, height, data } = await magick.decodeToRawRgba(file.buffer);
  return sharp(data, { raw: { width, height, channels: 4 } });
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

// Apply the two global metadata toggles to a sharp pipeline. Called by each
// sharp-native encoder right before its format-specific step.
//
// Defaults match historical behaviour: sharp strips all metadata unless told
// otherwise. opts._stripMetadata=true (the default when the frontend toggle
// is checked, also the default when the field is absent) keeps that, so the
// WebP byte-identical guarantee is preserved when callers don't engage the
// new toggles.
//
// The toggles only meaningfully affect sharp-native output formats. For
// magick-encoded outputs (BMP, JXL, and future ones routed through
// lib/magick.js), metadata is implicitly stripped at the raw-RGBA bridge
// regardless of toggle state — the source's EXIF/ICC was already discarded
// by the time we hand pixels to magick. A future enhancement could route
// ICC/EXIF separately through the magick encode call.
function applyMetadataOptions(pipeline, opts) {
  if (opts._stripMetadata === false) {
    // User explicitly opted in to preserving all metadata.
    return pipeline.keepMetadata();
  }
  if (opts._preserveColorProfile === true) {
    // Strip personal data (EXIF, GPS, XMP) but keep the colour profile so
    // colours don't shift after conversion.
    return pipeline.keepIccProfile();
  }
  // Default: strip everything. No-op on the pipeline — sharp does this
  // by default unless we ask it to keep something.
  return pipeline;
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
      let out = applyMetadataOptions(pipeline, opts);
      if (meta.hasAlpha) out = out.flatten({ background: bg });
      return out.jpeg({ quality, mozjpeg: true, progressive }).toBuffer();
    },
  },

  png: {
    ext: 'png',
    async encode(pipeline, opts) {
      const compressionLevel = clamp(opts.compressionLevel, 0, 9, 6);
      const palette = !!opts.palette;
      return applyMetadataOptions(pipeline, opts)
        .png({ compressionLevel, palette }).toBuffer();
    },
  },

  webp: {
    ext: 'webp',
    async encode(pipeline, opts) {
      const lossless = !!opts.lossless;
      const quality = clamp(opts.quality, 1, 100, 80);
      const effort = clamp(opts.effort, 0, 6, 4);
      // alphaQuality is fixed at 100 (not exposed in UI) to preserve
      // byte-identical output with the pre-LocalConvert WebP defaults
      // (which were inherited unchanged by LocalConvert and now LocalPix).
      return applyMetadataOptions(pipeline, opts)
        .webp({ quality, lossless, effort, alphaQuality: 100 }).toBuffer();
    },
  },

  avif: {
    ext: 'avif',
    async encode(pipeline, opts) {
      const lossless = !!opts.lossless;
      const quality = clamp(opts.quality, 1, 100, 50);
      const effort = clamp(opts.effort, 0, 9, 4);
      return applyMetadataOptions(pipeline, opts)
        .avif({ quality, lossless, effort }).toBuffer();
    },
  },

  jxl: {
    ext: 'jxl',
    async encode(pipeline, opts) {
      // JPEG XL — modern, royalty-free, generally better than WebP at
      // similar quality. Sharp's prebuilt libvips doesn't include libjxl,
      // so we encode via magick-wasm. Default effort 7 matches libjxl's
      // default (high compression, slow); users wanting speed crank it
      // down. Quality 80 ≈ visually lossless for photos.
      const quality = clamp(opts.quality, 1, 100, 80);
      const effort = clamp(opts.effort, 1, 9, 7);
      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return magick.encodeFromRawRgba(
        { width: info.width, height: info.height, data },
        'jxl',
        { quality, defines: { effort: String(effort) } },
      );
    },
  },

  gif: {
    ext: 'gif',
    async encode(pipeline, opts) {
      const colours = clamp(opts.colors, 2, 256, 256);
      const effort = clamp(opts.effort, 1, 10, 7);
      const loop = clamp(opts.loop, 0, 65535, 0);
      return applyMetadataOptions(pipeline, opts)
        .gif({ colours, effort, loop }).toBuffer();
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
      return applyMetadataOptions(pipeline, opts).tiff(tiffOpts).toBuffer();
    },
  },

  bmp: {
    ext: 'bmp',
    async encode(pipeline) {
      // sharp cannot write BMP; produce raw RGBA and hand to magick-wasm.
      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return magick.encodeFromRawRgba(
        { width: info.width, height: info.height, data },
        'bmp',
      );
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
      electron: !!process.env.LOCALPIX_ELECTRON,
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

    // Global metadata toggles are sent as top-level form fields, not folded
    // into the per-format options. We default stripMetadata=true (matches
    // sharp's historical strip-by-default behaviour and the WebP byte-
    // identical guarantee) and preserveColorProfile=false. The "_" prefix
    // signals these are cross-cutting opts, not encoder-specific knobs.
    opts._stripMetadata = req.body.stripMetadata !== 'false';
    opts._preserveColorProfile = req.body.preserveColorProfile === 'true';

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
    console.log(`\n  LocalPix running at http://localhost:${port}\n`);
  });
}
