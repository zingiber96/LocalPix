const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Output dir and port are configurable so the same server can run as a
// standalone process (`npm start`) or be embedded in the Electron app.
const OUTPUT_DIR =
  process.env.WEBP_OUTPUT_DIR || path.join(__dirname, 'output');
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

function createApp() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const app = express();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
      }
    },
  });

  app.use(express.static(path.join(__dirname, 'public')));

  function resolveOutputPath(baseName) {
    const candidate = path.join(OUTPUT_DIR, baseName);
    if (!fs.existsSync(candidate)) return candidate;
    const ts = Date.now();
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    return path.join(OUTPUT_DIR, `${stem}_${ts}${ext}`);
  }

  app.post('/api/convert', upload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const quality = Math.min(100, Math.max(0, parseInt(req.body.quality, 10) || 80));
    const density = Math.min(1440, Math.max(72, parseInt(req.body.density, 10) || 96));
    const originalName = path.parse(req.file.originalname).name;
    const outputFilename = `${originalName}.webp`;
    const outputPath = resolveOutputPath(outputFilename);

    try {
      let pipeline;

      if (req.file.mimetype === 'image/svg+xml') {
        pipeline = sharp(req.file.buffer, { density });
      } else {
        pipeline = sharp(req.file.buffer);
      }

      await pipeline
        .webp({ quality, lossless: false, alphaQuality: 100 })
        .toFile(outputPath);

      const convertedSize = fs.statSync(outputPath).size;

      res.json({
        originalName: req.file.originalname,
        originalSize: req.file.size,
        convertedName: path.basename(outputPath),
        convertedSize,
      });
    } catch (err) {
      console.error('Conversion error:', err.message);
      res.status(500).json({ error: `Conversion failed: ${err.message}` });
    }
  });

  app.get('/api/download/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(OUTPUT_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found.' });
    }

    res.download(filePath, filename);
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
      resolve({ port: server.address().port, server, outputDir: OUTPUT_DIR });
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, startServer, OUTPUT_DIR };

// Run directly (`node server.js` / `npm start`) — keep CLI behaviour.
if (require.main === module) {
  startServer().then(({ port }) => {
    console.log(`\n  WebP Converter running at http://localhost:${port}\n`);
  });
}
