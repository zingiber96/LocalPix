// Thin, lazy-initialised wrapper around @imagemagick/magick-wasm.
//
// LocalPix uses sharp (native libvips) for the hot path — JPEG/PNG/WebP/AVIF/
// GIF/TIFF — because it's fast and the WebP byte-identical guarantee depends
// on it. Everything sharp's prebuilt libvips can't read or write (HEIC, PSD,
// JXL, JP2, EXR, RAW...) routes through magick-wasm, which has a ~273-format
// build of ImageMagick compiled to WebAssembly.
//
// The package is ESM-only ("type": "module" in its package.json); this CJS
// module loads it via dynamic import on first use. The ~14 MB WASM binary is
// read from disk once and handed to initializeImageMagick(); subsequent
// callers reuse the same initialised instance.
//
// API shape mirrors what the server's encoder dispatch table wants:
//   - decodeToRawRgba(buffer) → { width, height, data } suitable as input to
//     sharp(buffer, { raw: { width, height, channels: 4 } }).
//   - encodeFromRawRgba({ width, height, data }, format, opts) → Buffer with
//     the requested format's bytes.
//
// Errors propagate as thrown Errors; callers handle them like any other
// async failure (current encoders catch + return a 500 JSON; the same
// pattern applies here).

const fs = require('fs');

let _magick;       // Cached ESM module after init completes.
let _initPromise;  // Single in-flight init; concurrent first callers all await this.

async function getMagick() {
  if (_magick) return _magick;
  if (!_initPromise) {
    _initPromise = (async () => {
      const mod = await import('@imagemagick/magick-wasm');
      // The package exposes its WASM at the './magick.wasm' subpath export.
      const wasmPath = require.resolve('@imagemagick/magick-wasm/magick.wasm');
      const wasmBytes = fs.readFileSync(wasmPath);
      await mod.initializeImageMagick(wasmBytes);
      _magick = mod;
      return mod;
    })();
  }
  return _initPromise;
}

// Map our lowercase format keys (matching ENCODERS keys and source-kind labels)
// to magick-wasm's MagickFormat enum values. Kept small and explicit so a
// typo here is a load-time failure, not a silent wrong-format encode.
function formatEnumFor(m, key) {
  const k = String(key).toLowerCase();
  switch (k) {
    case 'jpeg': case 'jpg': return m.MagickFormat.Jpeg;
    case 'png':              return m.MagickFormat.Png;
    case 'webp':             return m.MagickFormat.WebP;
    case 'avif':             return m.MagickFormat.Avif;
    case 'gif':              return m.MagickFormat.Gif;
    case 'tiff': case 'tif': return m.MagickFormat.Tiff;
    case 'bmp':              return m.MagickFormat.Bmp;
    case 'ico':              return m.MagickFormat.Ico;
    case 'heic':             return m.MagickFormat.Heic;
    case 'heif':             return m.MagickFormat.Heif;
    case 'psd':              return m.MagickFormat.Psd;
    case 'jxl':              return m.MagickFormat.Jxl;
    case 'jp2': case 'jp2k': case 'j2k': case 'jpx': return m.MagickFormat.Jp2;
    case 'exr':              return m.MagickFormat.Exr;
    default: throw new Error(`magick: unknown target format "${key}"`);
  }
}

/**
 * Decode any magick-supported image buffer into a raw RGBA pixel block.
 * The result is shaped for sharp(buf, { raw: { width, height, channels: 4 } }).
 *
 * @param {Buffer} buffer  source image bytes
 * @returns {Promise<{ width: number, height: number, data: Buffer }>}
 */
async function decodeToRawRgba(buffer) {
  const m = await getMagick();
  return new Promise((resolve, reject) => {
    try {
      m.ImageMagick.read(new Uint8Array(buffer), (img) => {
        const width = img.width;
        const height = img.height;
        img.write(m.MagickFormat.Rgba, (data) => {
          resolve({ width, height, data: Buffer.from(data) });
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Encode a raw RGBA pixel block as the requested format.
 *
 * @param {{ width: number, height: number, data: Buffer|Uint8Array }} pixels
 * @param {string} format  Lowercase format key (see formatEnumFor).
 * @param {object} [opts]
 * @param {number} [opts.quality]  Lossy formats only; 1-100.
 * @param {Record<string,string|number>} [opts.defines]
 *        Format-specific magick "defines" (e.g. { effort: 3 } for JXL).
 *        Set on the image right before write; format scope is inferred.
 * @returns {Promise<Buffer>}
 */
async function encodeFromRawRgba(pixels, format, opts = {}) {
  const m = await getMagick();
  const { width, height, data } = pixels;
  return new Promise((resolve, reject) => {
    try {
      const readSettings = new m.MagickReadSettings();
      readSettings.format = m.MagickFormat.Rgba;
      readSettings.width = width;
      readSettings.height = height;

      const targetFmt = formatEnumFor(m, format);

      m.ImageMagick.read(new Uint8Array(data), readSettings, (img) => {
        if (typeof opts.quality === 'number') {
          img.quality = opts.quality;
        }
        if (opts.defines) {
          for (const [name, value] of Object.entries(opts.defines)) {
            // setDefine(format, name, value) scopes the define to the target
            // format — exactly what we want for jxl-specific effort, etc.
            img.settings.setDefine(targetFmt, name, String(value));
          }
        }
        img.write(targetFmt, (out) => resolve(Buffer.from(out)));
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { decodeToRawRgba, encodeFromRawRgba };
