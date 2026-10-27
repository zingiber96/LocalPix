// LocalPix regression suite.
//
// Self-contained: starts the server in-process on an ephemeral port with a
// temp output dir, generates its throwaway inputs with sharp, and checks the
// invariants that have actually bitten us:
//
//   1. WebP byte-identical guarantee (fixtures/reference-*.{png,webp} —
//      the .webp was produced by the pre-v1.4.3 pipeline; every release
//      must reproduce it bit-for-bit from the .png with default settings)
//   2. Every output format encodes (11 targets)
//   3. JP2 + EXR survive a round-trip through their new decode paths
//   4. The ?maxBytes= upload cap rejects with 413 and passes under the cap
//   5. Filename templates render {name}/{width}/{height}
//   6. Manual crop boxes produce the requested region
//   7. EXIF-rotated sources crop identically to their upright twins
//      (the v1.4.3 auto-orient fix)
//   8. /api/config reports the package.json version
//
// Run:  npm test   (or: node test/run.cjs)
// Exits non-zero if anything fails, so CI can gate on it.

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.LOCALPIX_OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'localpix-test-'));

const sharp = require('sharp');
const { startServer } = require('../server.js');

const FIXTURES = path.join(__dirname, 'fixtures');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) pass++; else fail++;
}

// POST one file to /api/convert and return { status, json, bytes } (bytes
// fetched via the download endpoint on success).
async function convert(port, buf, name, mime, targetFormat, extraFields = {}) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: mime }), name);
  fd.append('targetFormat', targetFormat);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  const qs = extraFields._maxBytes ? `?maxBytes=${extraFields._maxBytes}` : '';
  fd.delete('_maxBytes');
  const resp = await fetch(`http://127.0.0.1:${port}/api/convert${qs}`, { method: 'POST', body: fd });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) return { status: resp.status, json };
  const dl = await fetch(`http://127.0.0.1:${port}/api/download/${encodeURIComponent(json.convertedName)}`);
  return { status: resp.status, json, bytes: Buffer.from(await dl.arrayBuffer()) };
}

// Mean absolute per-channel difference between two sharp-readable images.
// Small non-zero values are JPEG noise; dims mismatch returns Infinity.
async function meanAbsDiff(a, b) {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  if (A.info.width !== B.info.width || A.info.height !== B.info.height) return Infinity;
  let sum = 0;
  for (let i = 0; i < A.data.length; i++) sum += Math.abs(A.data[i] - B.data[i]);
  return sum / A.data.length;
}

(async () => {
  const { port, server } = await startServer(0);

  // -- 1. Byte-identical guarantee -----------------------------------------
  const refIn = fs.readFileSync(path.join(FIXTURES, 'reference-input.png'));
  const refOut = fs.readFileSync(path.join(FIXTURES, 'reference-output.webp'));
  {
    const r = await convert(port, refIn, 'ref.png', 'image/png', 'webp');
    check('byte-identical default WebP', r.status === 200 && r.bytes.equals(refOut),
      r.bytes ? `${r.bytes.length} bytes` : `status ${r.status}`);
  }

  // -- 2. Every output format encodes --------------------------------------
  for (const fmt of ['avif', 'bmp', 'exr', 'gif', 'ico', 'jpeg', 'jp2', 'jxl', 'png', 'tiff', 'webp']) {
    const r = await convert(port, refIn, `smoke.png`, 'image/png', fmt);
    check(`encode ${fmt}`, r.status === 200, r.status !== 200 ? (r.json.error || r.status) : '');
  }

  // -- 3. JP2 + EXR round-trip through their decode paths ------------------
  {
    const jp2 = await convert(port, refIn, 'rt.png', 'image/png', 'jp2');
    const back = await convert(port, jp2.bytes, 'rt.jp2', 'image/jp2', 'png');
    const m = back.bytes ? await sharp(back.bytes).metadata() : {};
    check('jp2 round-trip', back.status === 200 && m.width === 320 && m.height === 200,
      `${m.width}x${m.height}`);
    const exr = await convert(port, refIn, 'rt.png', 'image/png', 'exr');
    const back2 = await convert(port, exr.bytes, 'rt.exr', 'image/x-exr', 'png');
    const m2 = back2.bytes ? await sharp(back2.bytes).metadata() : {};
    check('exr round-trip', back2.status === 200 && m2.width === 320 && m2.height === 200,
      `${m2.width}x${m2.height}`);
  }

  // -- 4. Upload size cap ---------------------------------------------------
  {
    const capped = await convert(port, refIn, 'cap.png', 'image/png', 'webp', { _maxBytes: '100' });
    check('maxBytes cap rejects', capped.status === 413, `status ${capped.status}`);
    const roomy = await convert(port, refIn, 'cap.png', 'image/png', 'webp', { _maxBytes: String(10 * 1024 * 1024) });
    check('maxBytes cap passes under limit', roomy.status === 200, `status ${roomy.status}`);
  }

  // -- 5. Filename template -------------------------------------------------
  {
    const r = await convert(port, refIn, 'tpl.png', 'image/png', 'webp',
      { filenameTemplate: '{name}-{width}x{height}' });
    const ok = r.status === 200 && /^tpl-320x200(_\d+)?\.webp$/.test(r.json.convertedName || '');
    check('filename template renders', ok, r.json.convertedName);
  }

  // -- 6. Manual crop box ---------------------------------------------------
  {
    const r = await convert(port, refIn, 'crop.png', 'image/png', 'png',
      { transforms: JSON.stringify({ crop: { box: { left: 20, top: 10, width: 120, height: 80 } } }) });
    const m = r.bytes ? await sharp(r.bytes).metadata() : {};
    check('manual crop box dims', r.status === 200 && m.width === 120 && m.height === 80,
      `${m.width}x${m.height}`);
  }

  // -- 7. EXIF orientation crop parity --------------------------------------
  {
    // The same scene, once upright and once stored rotated 90° CCW with
    // EXIF orientation 6 (how cameras record portrait shots). The same crop
    // box — expressed in oriented/preview space — must cut the same pixels.
    const svg = '<svg width="320" height="200"><rect width="320" height="200" fill="#2a2"/>' +
      '<rect x="10" y="10" width="60" height="60" fill="#d22"/>' +
      '<rect y="180" width="320" height="20" fill="#22d"/></svg>';
    const upright = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
    const rotated = await sharp(Buffer.from(svg)).rotate(270)
      .jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    const box = JSON.stringify({ crop: { box: { left: 0, top: 0, width: 90, height: 90 } } });
    const u = await convert(port, upright, 'u.jpg', 'image/jpeg', 'png', { transforms: box });
    const r = await convert(port, rotated, 'r.jpg', 'image/jpeg', 'png', { transforms: box });
    const mad = (u.bytes && r.bytes) ? await meanAbsDiff(u.bytes, r.bytes) : Infinity;
    check('EXIF-rotated crop parity', mad < 3, `mean abs diff ${mad === Infinity ? 'dims mismatch' : mad.toFixed(2)}`);

    // And the default path must NOT auto-orient (byte-identical mechanism):
    const plain = await convert(port, rotated, 'plain.jpg', 'image/jpeg', 'png');
    const mp = plain.bytes ? await sharp(plain.bytes).metadata() : {};
    check('default path keeps stored orientation', mp.width === 200 && mp.height === 320,
      `${mp.width}x${mp.height}`);
  }

  // -- 8. Config version ----------------------------------------------------
  {
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    const pkg = require('../package.json');
    check('config.version matches package.json', cfg.version === pkg.version, cfg.version);
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('SUITE ERROR:', e);
  process.exit(1);
});
