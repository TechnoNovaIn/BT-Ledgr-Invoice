import 'express-async-errors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import statementRoutes from './routes/statementRoutes.js';
import validationRoutes from './routes/validationRoutes.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const uploadsDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3002;

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// ─── Serve uploaded files ─────────────────────────────────────────────────────
app.use('/uploads', express.static(uploadsDir));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/invoices', invoiceRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/validation', validationRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Network Access Auth (Optional PIN) ───────────────────────────────────────
app.get('/api/auth/status', (req, res) => {
  const pin = process.env.APP_PIN ? process.env.APP_PIN.trim() : '';
  res.json({ pinRequired: pin.length > 0 });
});

app.post('/api/auth/verify-pin', (req, res) => {
  const configuredPin = process.env.APP_PIN ? process.env.APP_PIN.trim() : '';
  if (!configuredPin) {
    return res.json({ valid: true });
  }
  const { pin } = req.body || {};
  if (pin && pin.toString().trim() === configuredPin) {
    return res.json({ valid: true });
  }
  return res.status(401).json({ valid: false, message: 'Invalid PIN. Please try again.' });
});

// ─── Static Frontend (Production) ─────────────────────────────────────────────
app.use(express.static(frontendDist));

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  const indexPath = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Invoice backend running on port ${PORT}`);
});

export default app;
