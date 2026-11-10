import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from './errorHandler.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50');

const INVOICE_EXTS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp'
]);

const STATEMENT_EXTS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.bmp', '.xlsx', '.xls', '.csv'
]);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/bmp',
  'image/x-ms-bmp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);

// Ensure upload subdirectories exist
['invoices', 'statements'].forEach((sub) => {
  fs.mkdirSync(path.join(UPLOAD_DIR, sub), { recursive: true });
});

function makeStorage(subDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(UPLOAD_DIR, subDir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${uuidv4()}${ext}`;
      cb(null, name);
    },
  });
}

function makeFileFilter(allowedExts) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isAllowedExt = allowedExts.has(ext);
    const isAllowedMime = ALLOWED_MIME_TYPES.has(file.mimetype);

    if (isAllowedExt || isAllowedMime) {
      cb(null, true);
    } else {
      cb(new AppError(`Unsupported file format: ${file.originalname} (${file.mimetype}). Supported formats: ${Array.from(allowedExts).join(', ')}`, 400));
    }
  };
}

export const uploadInvoices = multer({
  storage: makeStorage('invoices'),
  fileFilter: makeFileFilter(INVOICE_EXTS),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
}).array('invoices', 50);          // up to 50 files per batch

const statementMulter = multer({
  storage: makeStorage('statements'),
  fileFilter: makeFileFilter(STATEMENT_EXTS),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

export const uploadStatement = (req, res, next) => {
  statementMulter.fields([
    { name: 'statements', maxCount: 50 },
    { name: 'statement', maxCount: 50 },
  ])(req, res, (err) => {
    if (err) return next(err);
    const files = [
      ...(req.files?.statements || []),
      ...(req.files?.statement || []),
    ];
    req.files = files;
    if (files.length === 1) {
      req.file = files[0];
    }
    next();
  });
};

export const uploadStatements = uploadStatement;

