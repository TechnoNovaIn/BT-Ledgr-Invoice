import { Router } from 'express';
import { uploadInvoices } from '../middleware/upload.js';
import * as invoiceController from '../controllers/invoiceController.js';

const router = Router();

// Upload multiple invoices → returns batch_id
router.post('/upload', uploadInvoices, invoiceController.uploadInvoices);

// List all batches
router.get('/batches', invoiceController.listBatches);

// Poll batch processing status
router.get('/batch/:batchId', invoiceController.getBatchStatus);

// List all saved invoices (with filters: status, date range)
router.get('/', invoiceController.listInvoices);

// Fast aggregate stats for dashboard
router.get('/stats', invoiceController.getInvoiceStats);

// Get single invoice with line items + validation result
router.get('/:id', invoiceController.getInvoice);

// Update extracted fields (user corrections)
router.put('/:id', invoiceController.updateInvoice);

// Confirm/finalise invoice (user reviewed → status = CONFIRMED)
router.post('/:id/confirm', invoiceController.confirmInvoice);

// Delete invoice
router.delete('/:id', invoiceController.deleteInvoice);

export default router;
