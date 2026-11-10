import prisma                            from '../db/prismaClient.js';
import { validateInvoiceAgainstStatement } from './validationService.js';
import { logger }                         from '../utils/logger.js';

/**
 * Reconcile every invoice in a batch against a (processed) statement.
 * Pure DB + matching logic — shared by the manual Validate page and the
 * automatic trigger that fires when a statement finishes processing.
 *
 * @returns { summary, results }
 */
export async function runBatchValidation(batchId, statementId, statementIds = []) {
  const uploads = await prisma.invoiceUpload.findMany({
    where:   { batchId },
    include: { invoice: { include: { lineItems: true } } },
  });

  const invoices = uploads.map(u => u.invoice).filter(Boolean);
  if (!invoices.length) throw new Error('No processed invoices found in this batch');

  let targetStatementIds = [];
  if (Array.isArray(statementIds) && statementIds.length > 0) {
    targetStatementIds = statementIds.filter(id => id && id !== 'all');
  } else if (statementId && statementId !== 'all') {
    targetStatementIds = [statementId];
  }

  const whereClause = targetStatementIds.length > 0 ? { id: { in: targetStatementIds } } : {};
  const statements = await prisma.statementUpload.findMany({
    where: whereClause,
    include: { transactions: true },
  });

  if (!statements.length) throw new Error('No statements found for validation');

  // Collect transactions from all chosen statements
  const allTransactions = statements.flatMap(s => s.transactions);
  if (!allTransactions.length) throw new Error('No transactions found in selected statement(s)');

  const results = [];

  for (const invoice of invoices) {
    const validationData = validateInvoiceAgainstStatement(invoice, allTransactions);

    await prisma.validationResult.upsert({
      where:  { invoiceId: invoice.id },
      update: validationData,
      create: validationData,
    });

    // Update invoice status based on outcome
    const invoiceStatus = validationData.overallStatus === 'PASSED'   ? 'VALIDATED'
                        : validationData.overallStatus === 'MISMATCH' ? 'MISMATCH'
                        : 'MISMATCH';   // PARTIAL also goes to MISMATCH for review

    await prisma.invoice.update({
      where: { id: invoice.id },
      data:  { invoiceStatus },
    });

    results.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, ...validationData });
    logger.info(`Validated invoice ${invoice.invoiceNumber}: ${validationData.overallStatus}`);
  }

  const summary = {
    total:    results.length,
    passed:   results.filter(r => r.overallStatus === 'PASSED').length,
    partial:  results.filter(r => r.overallStatus === 'PARTIAL').length,
    mismatch: results.filter(r => r.overallStatus === 'MISMATCH').length,
  };

  return { summary, results };
}
