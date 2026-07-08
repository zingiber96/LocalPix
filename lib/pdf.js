// Thin, lazy-initialised wrapper around mupdf for PDF page rendering.
//
// Mirrors lib/magick.js in shape: the package is ESM-only, so this CJS module
// loads it via dynamic import on first use and caches the module. The WASM
// engine initialises itself on import.
//
// PDF pages are vector content with no intrinsic pixel size — like SVG, we
// rasterise at a caller-chosen density. PDF points are 72 dpi, so the render
// scale is density / 72 (the default 192 dpi gives a crisp ~2.7× render).
//
// API:
//   - renderPageToPng(buffer, { page, density }) → { png: Buffer, pageCount }
//     `page` is 1-based (what users type); out-of-range values are clamped
//     so "page 99 of a 3-page doc" renders the last page instead of erroring.

let _mupdf;
let _initPromise;

async function getMupdf() {
  if (_mupdf) return _mupdf;
  if (!_initPromise) {
    _initPromise = import('mupdf').then((mod) => {
      _mupdf = mod;
      return mod;
    });
  }
  return _initPromise;
}

async function renderPageToPng(buffer, { page = 1, density = 192 } = {}) {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  try {
    const pageCount = doc.countPages();
    const pageIndex = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount) - 1;
    const scale = density / 72;
    const pdfPage = doc.loadPage(pageIndex);
    try {
      const pixmap = pdfPage.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        return { png: Buffer.from(pixmap.asPNG()), pageCount };
      } finally {
        pixmap.destroy();
      }
    } finally {
      pdfPage.destroy();
    }
  } finally {
    doc.destroy();
  }
}

// Cheap page-count probe — used by /api/pdf-info so the frontend can cap
// its page picker and drive "All pages" batch conversion.
async function countPages(buffer) {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  try {
    return doc.countPages();
  } finally {
    doc.destroy();
  }
}

module.exports = { renderPageToPng, countPages };
