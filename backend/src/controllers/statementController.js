import prisma                from '../db/prismaClient.js';
import { extractStatement } from '../services/statementParser.js';
import { runBatchValidation } from '../services/reconciliationService.js';
import { AppError }         from '../middleware/errorHandler.js';
import { logger }           from '../utils/logger.js';
import { v4 as uuidv4 }    from 'uuid';

// ─── POST /api/statements/upload ─────────────────────────────────────────────

export async function uploadStatement(req, res) {
  const files = (req.files && req.files.length > 0) ? req.files : (req.file ? [req.file] : []);
  if (!files.length) throw new AppError('No statement file uploaded', 400);

  // Statements can be uploaded independently of a batch — create a solo batch
  const batchId = req.body.batchId ?? uuidv4();

  // Ensure batch exists
  await prisma.uploadBatch.upsert({
    where:  { id: batchId },
    update: {},
    create: { id: batchId },
  });

  const createdStatements = [];

  for (const file of files) {
    const statementUpload = await prisma.statementUpload.create({
      data: {
        batchId,
        fileName:      file.originalname,
        filePath:      file.path,
        statementType: 'BANK',          // will be updated after parsing
        status:        'PROCESSING',
      },
    });

    // Process async
    processStatement(statementUpload).catch(err =>
      logger.error('Statement processing error', { statementId: statementUpload.id, error: err.message })
    );

    createdStatements.push(statementUpload);
  }

  res.status(202).json({
    success:     true,
    count:       createdStatements.length,
    statements:  createdStatements,
    statementId: createdStatements[0]?.id,
    batchId,
    message:     `${createdStatements.length} statement(s) accepted and being processed.`,
  });
}

async function processStatement(statementUpload) {
  try {
    const { statementType, transactions } = await extractStatement(statementUpload.filePath);

    // Update statement type
    await prisma.statementUpload.update({
      where: { id: statementUpload.id },
      data:  { statementType },
    });

    // Bulk create transactions
    if (transactions.length) {
      await prisma.transaction.createMany({
        data: transactions.map(t => ({ ...t, statementId: statementUpload.id })),
      });
    }

    await prisma.statementUpload.update({
      where: { id: statementUpload.id },
      data:  { status: 'DONE' },
    });

    logger.info(`Statement ${statementUpload.id}: ${transactions.length} transactions parsed`);

    // Auto-reconcile if this statement is linked to an invoice batch.
    if (statementUpload.batchId) {
      runBatchValidation(statementUpload.batchId, statementUpload.id)
        .then((r) => logger.info(`Auto-validation for statement ${statementUpload.id}: ${r.summary.passed} passed, ${r.summary.mismatch} mismatch`))
        .catch((err) => logger.warn(`Auto-validation skipped for statement ${statementUpload.id}: ${err.message}`));
    }
  } catch (err) {
    logger.error(`Statement processing failed: ${err.message}`);
    try {
      await prisma.statementUpload.update({
        where: { id: statementUpload.id },
        data:  { status: 'FAILED', errorMessage: err.message },
      });
    } catch (dbErr) {
      logger.error(`Failed to mark statement ${statementUpload.id} as FAILED`, { error: dbErr.message });
    }
  }
}

// ─── GET /api/statements ──────────────────────────────────────────────────────

export async function listStatements(req, res) {
  const statements = await prisma.statementUpload.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { transactions: true } } },
  });
  res.json({ success: true, statements });
}

// ─── GET /api/statements/:id ──────────────────────────────────────────────────

export async function getStatement(req, res) {
  const statement = await prisma.statementUpload.findUnique({
    where:   { id: req.params.id },
    include: { transactions: { orderBy: { transactionDate: 'asc' } } },
  });

  if (!statement) throw new AppError('Statement not found', 404);
  res.json({ success: true, statement });
}

// ─── DELETE /api/statements/:id ───────────────────────────────────────────────

export async function deleteStatement(req, res) {
  await prisma.statementUpload.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Statement deleted' });
}
