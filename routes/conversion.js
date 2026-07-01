/**
 * routes/conversion.js
 *
 * Express router exposing two endpoints:
 *
 *   POST /api/convert/csv-to-edi  — accepts a .csv file, returns an .edi file
 *   POST /api/convert/edi-to-csv  — accepts a .edi/.txt file, returns a .csv file
 *
 * Files are processed entirely in memory via multer's memoryStorage; raw
 * uploads are never written to disk.
 */

'use strict';

const express   = require('express');
const multer    = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const { Parser }   = require('json2csv');

const { convertCsvTo834, convert834ToCsv } = require('../services/ediConverter');

const router = express.Router();

// ── Multer — in-memory storage, 50 MB ceiling ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB; large employer rosters
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',        // .csv on Windows
      'text/plain',
      'application/octet-stream',        // generic binary — accept, validate content later
      'application/EDI-X12',
    ];
    // Always accept; content-type sniffing is unreliable for EDI files.
    cb(null, true);
  },
});

// ── Helper: parse a CSV buffer into an array of objects ───────────────────
function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const records = [];
    const stream  = Readable.from(buffer.toString('utf8'));

    stream
      .pipe(csvParser({ mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/\s+/g, '_') }))
      .on('data', row => records.push(row))
      .on('end',  ()  => resolve(records))
      .on('error', err => reject(new Error(`CSV parse error: ${err.message}`)));
  });
}

// ── Helper: convert records array → CSV string via json2csv ───────────────
function recordsToCsvString(records) {
  if (records.length === 0) return '';
  const parser = new Parser({ fields: Object.keys(records[0]) });
  return parser.parse(records);
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/convert/csv-to-edi
// ─────────────────────────────────────────────────────────────────────────────
router.post('/csv-to-edi', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field name "file".' });
    }

    // Check file extension as a light gate before attempting CSV parse
    const name = (req.file.originalname || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      return res.status(400).json({ error: 'Expected a .csv file.' });
    }

    const records = await parseCsvBuffer(req.file.buffer);

    if (records.length === 0) {
      return res.status(422).json({ error: 'CSV file is empty or has no data rows.' });
    }

    const ediString = await convertCsvTo834(records);

    // Return as a downloadable .edi file
    const outName = (req.file.originalname || 'output').replace(/\.csv$/i, '') + '.edi';
    res.setHeader('Content-Type', 'application/EDI-X12');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(ediString);
  } catch (err) {
    console.error('[csv-to-edi]', err.message);
    // Surface validation / business-logic errors as 422; unexpected errors as 500
    const status = err.message.startsWith('Validation') ? 422 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/convert/edi-to-csv
// ─────────────────────────────────────────────────────────────────────────────
router.post('/edi-to-csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field name "file".' });
    }

    const name = (req.file.originalname || '').toLowerCase();
    const validExts = ['.edi', '.x12', '.txt', '.834'];
    if (!validExts.some(ext => name.endsWith(ext))) {
      return res.status(400).json({ error: `Expected an EDI file (.edi, .x12, .txt). Got: ${name}` });
    }

    const ediString = req.file.buffer.toString('utf8');
    const records   = await convert834ToCsv(ediString);
    const csvString = recordsToCsvString(records);

    // Return as a downloadable .csv file
    const outName = (req.file.originalname || 'output').replace(/\.(edi|x12|txt|834)$/i, '') + '.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(csvString);
  } catch (err) {
    console.error('[edi-to-csv]', err.message);
    const status = err.message.includes('malformed') || err.message.includes('No member') ? 422 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
