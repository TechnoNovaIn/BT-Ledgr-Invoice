import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

// pdf-parse is a CommonJS module — dynamic import needed in ESM
async function getPdfParse() {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  return mod.default;
}

const IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp']);
const PDF_TYPE = '.pdf';

let nativeTesseractChecked = false;
let hasNativeTesseract = false;

async function checkNativeTesseract() {
  if (nativeTesseractChecked) return hasNativeTesseract;
  try {
    await execFileAsync('tesseract', ['--version']);
    hasNativeTesseract = true;
    logger.info('Native Tesseract 5 engine detected and active');
  } catch (err) {
    hasNativeTesseract = false;
    logger.info('Native Tesseract not found in PATH, using tesseract.js fallback');
  }
  nativeTesseractChecked = true;
  return hasNativeTesseract;
}

/**
 * Extract raw text from a PDF or image file.
 * Returns { text, pageCount, isImageBased }
 */
export async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_TYPES.has(ext)) {
    return extractFromImage(filePath);
  }

  if (ext === PDF_TYPE) {
    return extractFromPdf(filePath);
  }

  throw new Error(`Unsupported file type for text extraction: ${ext}`);
}

// ─── PDF extraction (Native Text Layer + Scanned PDF Fallback) ─────────────────
async function extractFromPdf(filePath) {
  const pdfParse = await getPdfParse();
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  // If the PDF has substantial text, use native digital text
  const isImageBased = data.text.trim().length < 150;

  if (!isImageBased) {
    logger.info(`PDF digital text extracted: ${data.numpages} pages, ${data.text.length} chars`);
    return { text: data.text, pageCount: data.numpages, isImageBased: false };
  }

  logger.info(`PDF appears image-based/scanned (${data.text.trim().length} chars). Running high-accuracy OCR: ${path.basename(filePath)}`);
  return extractFromScannedPdf(filePath);
}

// ─── Scanned PDF conversion via pdftoppm ────────────────────────────────────────
async function extractFromScannedPdf(filePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-pdf-'));
  try {
    const outputPrefix = path.join(tmpDir, 'page');
    // Rasterize pages at 300 DPI PNG using poppler pdftoppm
    await execFileAsync('pdftoppm', ['-png', '-r', '300', filePath, outputPrefix]);

    const files = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

    if (files.length === 0) {
      throw new Error('pdftoppm produced no image pages');
    }

    logger.info(`Scanned PDF rasterized into ${files.length} page(s) at 300 DPI`);
    const pageTexts = [];

    for (const file of files) {
      const pagePath = path.join(tmpDir, file);
      const { text } = await extractFromImage(pagePath);
      if (text && text.trim()) {
        pageTexts.push(text.trim());
      }
    }

    const combinedText = pageTexts.join('\n\n--- PAGE BREAK ---\n\n');
    return {
      text: combinedText,
      pageCount: files.length,
      isImageBased: true,
    };
  } catch (err) {
    logger.warn(`pdftoppm rasterization failed (${err.message}), falling back to direct image OCR attempt`);
    return extractFromImage(filePath);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error
    }
  }
}

// ─── Image Preprocessing & OCR Pipeline ────────────────────────────────────────
export async function extractFromImage(filePath) {
  logger.info(`Preprocessing image for OCR: ${path.basename(filePath)}`);

  const metadata = await sharp(filePath).metadata();
  const width = metadata.width || 0;

  // Scale up small images (common with phone invoice photos) to reach ~2400px width
  const targetWidth = 2400;
  const scale = width > 0 && width < targetWidth ? targetWidth / width : 1;

  const baseImage = sharp(filePath).resize({
    width: Math.round(width * scale) || undefined,
    withoutEnlargement: false,
  });

  // Preprocessing variants:
  // 1. Contrast-enhanced grayscale + unsharp mask (best for standard receipts)
  // 2. High-contrast binarized (best for faded stamps or dark backgrounds)
  // 3. Normalized denoise (best for noisy mobile camera shots)
  const variants = [
    {
      name: 'contrast',
      pipe: baseImage.clone()
        .grayscale()
        .normalise()
        .linear(1.4, -20)
        .sharpen({ sigma: 1.5, m1: 0.5, m2: 2.5 }),
    },
    {
      name: 'binary',
      pipe: baseImage.clone()
        .grayscale()
        .normalise()
        .linear(1.8, -35)
        .threshold(160),
    },
  ];

  const hasNative = await checkNativeTesseract();

  if (hasNative) {
    return ocrWithNativeTesseract(variants, filePath);
  }

  return ocrWithTesseractJs(variants);
}

// ─── Fast Native Tesseract 5.5 OCR ─────────────────────────────────────────────
async function ocrWithNativeTesseract(variants, originalPath) {
  let best = { text: '', charCount: -1, variant: null };

  for (const v of variants) {
    try {
      const buffer = await v.pipe.png().toBuffer();
      const tmpImg = path.join(os.tmpdir(), `tess-${Date.now()}-${v.name}.png`);
      fs.writeFileSync(tmpImg, buffer);

      // Run tesseract with psm 4 (column/table mode) and eng+hin language models
      let stdout = '';
      try {
        const res = await execFileAsync('tesseract', [tmpImg, 'stdout', '-l', 'eng+hin', '--psm', '4']);
        stdout = res.stdout || '';
      } catch (err) {
        // Fallback to eng if hin model triggers error
        const res = await execFileAsync('tesseract', [tmpImg, 'stdout', '-l', 'eng', '--psm', '4']);
        stdout = res.stdout || '';
      } finally {
        try { fs.unlinkSync(tmpImg); } catch (e) {}
      }

      const text = stdout.trim();
      const meaningfulChars = text.replace(/[^A-Za-z0-9]/g, '').length;
      logger.info(`Native OCR variant '${v.name}': ${text.length} chars (${meaningfulChars} alphanumeric)`);

      if (meaningfulChars > best.charCount) {
        best = { text, charCount: meaningfulChars, variant: v.name };
      }
    } catch (err) {
      logger.warn(`Native OCR error on variant ${v.name}: ${err.message}`);
    }
  }

  // If variants failed to capture text, try raw image directly
  if (best.charCount < 50) {
    try {
      const res = await execFileAsync('tesseract', [originalPath, 'stdout', '-l', 'eng', '--psm', '6']);
      const rawText = (res.stdout || '').trim();
      if (rawText.length > best.text.length) {
        best = { text: rawText, charCount: rawText.length, variant: 'raw' };
      }
    } catch (e) {
      // Ignore
    }
  }

  logger.info(`Native OCR complete (best=${best.variant}): ${best.text.length} characters`);
  return { text: best.text, pageCount: 1, isImageBased: true };
}

// ─── Tesseract.js Worker Fallback ──────────────────────────────────────────────
async function ocrWithTesseractJs(variants) {
  const worker = await createWorker('eng');
  let best = { text: '', confidence: -1, name: null };

  try {
    for (const v of variants) {
      const buf = await v.pipe.png().toBuffer();
      const { data } = await worker.recognize(buf);
      logger.info(`Tesseract.js variant '${v.name}': confidence ${data.confidence.toFixed(1)}%`);
      if (data.confidence > best.confidence) {
        best = { text: data.text, confidence: data.confidence, name: v.name };
      }
    }
  } finally {
    await worker.terminate();
  }

  logger.info(`Tesseract.js complete (best=${best.name}): confidence ${best.confidence.toFixed(1)}%`);
  return { text: best.text, pageCount: 1, isImageBased: true };
}
