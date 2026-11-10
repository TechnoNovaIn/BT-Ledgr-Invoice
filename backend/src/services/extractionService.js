import { extractText }           from './pdfService.js';
import { parseInvoiceWithRegex } from './regexParser.js';
import { logger }                from '../utils/logger.js';

// Fields that MUST be present for an invoice to be reconciliation-ready.
// Noise in other fields is acceptable; these must be populated (or flagged).
const REQUIRED_FIELDS = [
  'invoiceNumber',
  'invoiceDate',
  'vendorName',
  'vendorGSTIN',
  'grandTotal',
];

/**
 * Full extraction pipeline for a single invoice file.
 * 100% offline: PDF text or local Tesseract OCR → rule-based GST regex parser.
 * No external LLM / Ollama dependency.
 *
 * @param {string} filePath  - Absolute path to the uploaded file
 * @returns {Object}  { method, confidence, data, rawText, missingRequired, partial }
 */
export async function extractInvoice(filePath) {
  // Step 1: Get raw text (PDF or OCR for scanned/image files)
  const { text, isImageBased } = await extractText(filePath);
  logger.info(`Text extracted (${isImageBased ? 'OCR' : 'PDF'}): ${text.length} chars`);

  // Step 2: Rule-based GST extraction (no LLM fallback)
  const regexResult = parseInvoiceWithRegex(text);
  logger.info(`Regex confidence: ${(regexResult.confidence * 100).toFixed(0)}%`);

  const data = regexResult.data ?? {};

  // Step 3: Report which required fields are still missing so the UI can flag them
  const missingRequired = REQUIRED_FIELDS.filter((f) => {
    const v = data[f];
    return v === null || v === undefined || v === '';
  });

  if (missingRequired.length) {
    logger.warn(`Invoice missing required fields: ${missingRequired.join(', ')}`);
  }

  return {
    method:         'REGEX',
    confidence:     regexResult.confidence,
    data,
    rawText:        text,
    missingRequired,
    partial:        missingRequired.length > 0,
  };
}
