import { Router } from 'express';
import * as validationController from '../controllers/validationController.js';

const router = Router();

// Run validation: match all invoices in a batch against a statement
router.post('/run', validationController.runValidation);

// Get validation result for a single invoice
router.get('/invoice/:invoiceId', validationController.getValidationResult);

// Override / manually resolve a validation mismatch
router.post('/invoice/:invoiceId/override', validationController.overrideValidation);

export default router;
