import { v4 as uuidv4 }       from 'uuid';
import prisma                   from '../db/prismaClient.js';
import { extractInvoice }       from '../services/extractionService.js';
import { validateInvoiceMath }  from '../services/validationService.js';
import { AppError }             from '../middleware/errorHandler.js';
import { logger }               from '../utils/logger.js';

// ─── POST /api/invoices/upload ────────────────────────────────────────────────

export async function uploadInvoices(req, res) {
  if (!req.files?.length) throw new AppError('No files uploaded', 400);

  const batchId = uuidv4();

  // Create batch record
  await prisma.uploadBatch.create({ data: { id: batchId } });

  // Create upload records for each file
  const uploads = await Promise.all(req.files.map(file =>
    prisma.invoiceUpload.create({
      data: {
        batchId,
        fileName: file.originalname,
        filePath: file.path,
        mimeType: file.mimetype,
        status:   'PROCESSING',
      },
    })
  ));

  // Process each file asynchronously (don't block the response)
  Promise.all(uploads.map(upload => processUpload(upload))).catch(err =>
    logger.error('Batch processing error', { error: err.message })
  );

  res.status(202).json({
    success: true,
    batchId,
    filesReceived: uploads.length,
    message: 'Files accepted. Poll /api/invoices/batch/:batchId for status.',
  });
}

async function processUpload(upload) {
  try {
    logger.info(`Processing upload: ${upload.fileName}`);

    // Extract invoice data
    const { method, confidence, data, rawText, missingRequired } = await extractInvoice(upload.filePath);

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        uploadId:        upload.id,
        invoiceNumber:   data.invoiceNumber,
        invoiceDate:     data.invoiceDate,
        dueDate:         data.dueDate,
        vendorName:      data.vendorName,
        vendorAddress:   data.vendorAddress,
        vendorGSTIN:     data.vendorGSTIN,
        vendorPAN:       data.vendorPAN,
        buyerName:       data.buyerName,
        buyerAddress:    data.buyerAddress,
        buyerGSTIN:      data.buyerGSTIN,
        totalTaxable:    data.totalTaxable,
        totalCGST:       data.totalCGST,
        totalSGST:       data.totalSGST,
        totalIGST:       data.totalIGST,
        totalCess:       data.totalCess,
        roundOff:        data.roundOff,
        grandTotal:      data.grandTotal,
        extractionMethod: method,
        extractionRaw:   { confidence, rawText: rawText?.slice(0, 5000), missingRequired },
        invoiceStatus:   'PENDING',
      },
    });

    // Create line items
    if (data.lineItems?.length) {
      await prisma.lineItem.createMany({
        data: data.lineItems.map(li => ({ ...li, invoiceId: invoice.id })),
      });
    }

    // Run internal GST math validation
    const mathChecks = validateInvoiceMath(data, data.lineItems ?? []);
    const mathFailed = mathChecks.filter(c => !c.ok);
    if (mathFailed.length) {
      logger.warn(`Invoice ${invoice.id}: ${mathFailed.length} math check(s) failed`, { mathFailed });
    }

    // Mark upload as done
    await prisma.invoiceUpload.update({
      where: { id: upload.id },
      data:  { status: 'DONE' },
    });

    logger.info(`Upload ${upload.id} processed → Invoice ${invoice.id} (confidence: ${(confidence * 100).toFixed(0)}%)`);
  } catch (err) {
    logger.error(`Failed to process upload ${upload.id}`, { error: err.message });
    try {
      await prisma.invoiceUpload.update({
        where: { id: upload.id },
        data:  { status: 'FAILED', errorMessage: err.message },
      });
    } catch (dbErr) {
      logger.error(`Failed to mark upload ${upload.id} as FAILED`, { error: dbErr.message });
    }
  }
}

// ─── GET /api/invoices/batches ─────────────────────────────────────────────────

export async function listBatches(req, res) {
  const batches = await prisma.uploadBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { uploads: true } },
      uploads: {
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { fileName: true },
      },
    },
  });

  const result = batches.map(b => ({
    batchId: b.id,
    fileName: b.uploads[0]?.fileName ?? null,
    invoiceCount: b._count.uploads,
    createdAt: b.createdAt,
  }));

  res.json({ success: true, batches: result });
}

// ─── GET /api/invoices/batch/:batchId ─────────────────────────────────────────

export async function getBatchStatus(req, res) {
  const { batchId } = req.params;

  const batch = await prisma.uploadBatch.findUnique({
    where:   { id: batchId },
    include: {
      uploads: {
        include: { invoice: { select: { id: true, invoiceStatus: true, grandTotal: true } } },
      },
    },
  });

  if (!batch) throw new AppError('Batch not found', 404);

  const summary = {
    total:      batch.uploads.length,
    processing: batch.uploads.filter(u => u.status === 'PROCESSING').length,
    done:       batch.uploads.filter(u => u.status === 'DONE').length,
    failed:     batch.uploads.filter(u => u.status === 'FAILED').length,
  };

  res.json({ success: true, batchId, summary, uploads: batch.uploads });
}

// ─── GET /api/invoices/stats ──────────────────────────────────────────────────
export async function getInvoiceStats(req, res) {
  const [countsByStatus, totalSum, recentInvoices, totalCount] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['invoiceStatus'],
      _count: { id: true },
    }),
    prisma.invoice.aggregate({
      _sum: { grandTotal: true },
    }),
    prisma.invoice.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        validationResult: { select: { overallStatus: true } },
      },
    }),
    prisma.invoice.count(),
  ]);

  const stats = {
    total: totalCount,
    validated: 0,
    mismatches: 0,
    pending: 0,
    confirmed: 0,
    totalValue: parseFloat(totalSum._sum.grandTotal || 0),
    recent: recentInvoices,
  };

  for (const item of countsByStatus) {
    if (item.invoiceStatus === 'VALIDATED') stats.validated = item._count.id;
    else if (item.invoiceStatus === 'MISMATCH') stats.mismatches = item._count.id;
    else if (item.invoiceStatus === 'PENDING') stats.pending = item._count.id;
    else if (item.invoiceStatus === 'CONFIRMED') stats.confirmed = item._count.id;
  }

  res.json({ success: true, stats });
}

// ─── GET /api/invoices ────────────────────────────────────────────────────────
export async function listInvoices(req, res) {
  const { status, from, to, page = 1, limit = 20 } = req.query;

  const where = {};
  if (status)       where.invoiceStatus = status;
  if (from || to)   where.invoiceDate   = { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { validationResult: { select: { overallStatus: true } } },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * parseInt(limit),
      take:    parseInt(limit),
    }),
    prisma.invoice.count({ where }),
  ]);

  res.json({ success: true, total, page: parseInt(page), invoices });
}

// ─── GET /api/invoices/:id ────────────────────────────────────────────────────

export async function getInvoice(req, res) {
  const invoice = await prisma.invoice.findUnique({
    where:   { id: req.params.id },
    include: { lineItems: true, validationResult: true, upload: true },
  });

  if (!invoice) throw new AppError('Invoice not found', 404);
  res.json({ success: true, invoice });
}

// ─── PUT /api/invoices/:id ────────────────────────────────────────────────────

const ALLOWED_UPDATE_FIELDS = [
  'invoiceNumber', 'invoiceDate', 'dueDate',
  'vendorName', 'vendorAddress', 'vendorGSTIN', 'vendorPAN',
  'buyerName', 'buyerAddress', 'buyerGSTIN',
  'totalTaxable', 'totalCGST', 'totalSGST', 'totalIGST', 'totalCess', 'roundOff', 'grandTotal',
];

export async function updateInvoice(req, res) {
  const { lineItems } = req.body;
  const fields = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (key in req.body) fields[key] = req.body[key];
  }

  const invoice = await prisma.invoice.update({
    where: { id: req.params.id },
    data:  fields,
  });

  // If line items were provided, replace them in a transaction
  if (lineItems) {
    await prisma.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { invoiceId: invoice.id } });
      if (lineItems.length) {
        await tx.lineItem.createMany({
          data: lineItems.map(li => ({ ...li, invoiceId: invoice.id })),
        });
      }
    });
  }

  const updated = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: { lineItems: true, validationResult: true, upload: true },
  });

  res.json({ success: true, invoice: updated });
}

// ─── POST /api/invoices/:id/confirm ───────────────────────────────────────────

export async function confirmInvoice(req, res) {
  const invoice = await prisma.invoice.update({
    where: { id: req.params.id },
    data:  { invoiceStatus: 'CONFIRMED' },
  });

  res.json({ success: true, message: 'Invoice confirmed', invoice });
}

// ─── DELETE /api/invoices/:id ─────────────────────────────────────────────────

export async function deleteInvoice(req, res) {
  await prisma.invoice.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Invoice deleted' });
}
