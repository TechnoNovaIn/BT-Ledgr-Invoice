import { Router } from 'express';
import { uploadStatement } from '../middleware/upload.js';
import * as statementController from '../controllers/statementController.js';

const router = Router();

// Upload a statement (bank or ledger)
router.post('/upload', uploadStatement, statementController.uploadStatement);

// List all uploaded statements
router.get('/', statementController.listStatements);

// Get single statement with transactions
router.get('/:id', statementController.getStatement);

// Delete a statement
router.delete('/:id', statementController.deleteStatement);

export default router;
