import prisma                 from '../db/prismaClient.js';
import { runBatchValidation } from '../services/reconciliationService.js';
import { AppError }            from '../middleware/errorHandler.js';

// ─── POST /api/validation/run ─────────────────────────────────────────────────
// Body: { batchId, statementId }
// Matches every invoice in the batch against the given statement.

export async function runValidation(req, res) {
  const { batchId, statementId, statementIds } = req.body;
  if (!batchId) throw new AppError('batchId is required', 400);
  if (!statementId && (!Array.isArray(statementIds) || statementIds.length === 0)) {
    throw new AppError('At least one statementId or statementIds array is required', 400);
  }

  const { summary, results } = await runBatchValidation(batchId, statementId, statementIds);
  res.json({ success: true, summary, results });
}

// ─── GET /api/validation/invoice/:invoiceId ───────────────────────────────────

export async function getValidationResult(req, res) {
  const result = await prisma.validationResult.findUnique({
    where:   { invoiceId: req.params.invoiceId },
    include: { transaction: true },
  });

  if (!result) throw new AppError('Validation result not found', 404);
  res.json({ success: true, result });
}

// ─── POST /api/validation/invoice/:invoiceId/override ────────────────────────
// Allows a user to manually mark a mismatch as resolved.
// Body: { notes }

export async function overrideValidation(req, res) {
  const { notes } = req.body;

  const result = await prisma.validationResult.update({
    where: { invoiceId: req.params.invoiceId },
    data:  { overallStatus: 'PASSED', notes: notes ?? 'Manually overridden by user' },
  });

  await prisma.invoice.update({
    where: { id: req.params.invoiceId },
    data:  { invoiceStatus: 'VALIDATED' },
  });

  res.json({ success: true, message: 'Validation overridden', result });
}
