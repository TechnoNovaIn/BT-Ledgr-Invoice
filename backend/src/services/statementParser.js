import path from 'path';
import { execFileSync } from 'child_process';
import xlsx from 'xlsx';
import { extractText } from './pdfService.js';
import { logger } from '../utils/logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAmount(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const cleaned = String(val).replace(/[₹Rs,\s]/gi, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;

  const str = String(val).trim();
  const dmy = str.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
    const d = new Date(`${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
    if (!isNaN(d)) return d;
  }
  const dMonY = str.match(/(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})/);
  if (dMonY) {
    let y = dMonY[3];
    if (y.length === 2) y = '20' + y;
    const d = new Date(`${dMonY[2]} ${dMonY[1]}, ${y}`);
    if (!isNaN(d)) return d;
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(str);
    if (!isNaN(d)) return d;
  }
  return null;
}

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1})\b/g;

// ─── Spreadsheet (Excel / CSV) Parser ─────────────────────────────────────────

function parseSpreadsheetStatement(filePath) {
  logger.info(`Parsing spreadsheet statement: ${path.basename(filePath)}`);
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    return { statementType: 'BANK', transactions: [] };
  }

  // Scan top 30 rows to locate header columns
  let headerIdx = -1;
  let dateCol = -1;
  let descCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let balanceCol = -1;
  let refCol = -1;
  let vendorCol = -1;

  for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
    const row = rawRows[i].map(c => String(c).trim().toLowerCase());
    const dIdx = row.findIndex(c => /\b(date|txn\s*date|transaction\s*date|value\s*date)\b/.test(c));
    const nIdx = row.findIndex(c => /\b(narration|description|particulars|remarks|details|party\s*name)\b/.test(c));

    if (dIdx !== -1 && nIdx !== -1) {
      headerIdx = i;
      dateCol = dIdx;
      descCol = nIdx;
      debitCol = row.findIndex(c => /\b(debit|dr|withdrawal|withdraw|paid\s*out)\b/.test(c));
      creditCol = row.findIndex(c => /\b(credit|cr|deposit|paid\s*in)\b/.test(c));
      balanceCol = row.findIndex(c => /\b(balance|bal|closing\s*balance)\b/.test(c));
      refCol = row.findIndex(c => /\b(ref|chq|cheque|utr|reference|trn\s*id)\b/.test(c));
      vendorCol = row.findIndex(c => /\b(vendor|party|supplier|account\s*name)\b/.test(c));
      break;
    }
  }

  // Fallback defaults if header was not matched: assume columns Date=0, Description=1, Debit=2, Credit=3
  if (headerIdx === -1) {
    headerIdx = 0;
    dateCol = 0;
    descCol = 1;
    debitCol = 2;
    creditCol = 3;
    balanceCol = 4;
  }

  const transactions = [];

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const rawDate = row[dateCol];
    const txnDate = parseDate(rawDate);
    if (!txnDate) continue; // Skip non-data / total rows

    const narration = String(row[descCol] || '').trim();
    if (!narration && !row[debitCol] && !row[creditCol]) continue;

    const debit = parseAmount(row[debitCol]);
    const credit = parseAmount(row[creditCol]);
    const balance = balanceCol !== -1 ? parseAmount(row[balanceCol]) : null;
    const refExplicit = refCol !== -1 ? String(row[refCol] || '').trim() : null;

    // Extract reference from narration if not in dedicated column
    const refMatch = narration.match(/(?:REF|UTR|CHQ|NEFT|IMPS|UPI)[:\s/]*([A-Z0-9]+)/i);
    const invMatch = narration.match(/(?:INV|INVOICE|BILL)[:\s/#]*([A-Z0-9\-\/]+)/i);
    const gstinMatch = narration.match(GSTIN_RE);

    const vendorExplicit = vendorCol !== -1 ? String(row[vendorCol] || '').trim() : null;

    transactions.push({
      transactionDate: txnDate,
      valueDate: null,
      narration,
      referenceNo: refExplicit || refMatch?.[1] || null,
      invoiceRef: invMatch?.[1] || null,
      debit,
      credit,
      balance,
      vendorName: vendorExplicit || null,
      vendorGSTIN: gstinMatch?.[0] || null,
    });
  }

  logger.info(`Extracted ${transactions.length} rows from spreadsheet statement`);
  return {
    statementType: 'BANK',
    transactions,
  };
}

// ─── Bank Statement Parser (Tabular & Multi-Line) ────────────────────────────

function parseBankStatementTabular(text) {
  const lines = text.split('\n');
  const transactions = [];

  const ROW_START_RE = /^\s*(\d{1,5})\s+([A-Z0-9]+)\s+(\d{1,2}[-/][A-Za-z0-9]{3}[-/]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i;
  const GENERIC_ROW_RE = /^\s*(\d{1,5})\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/i;
  const DIRECT_DATE_RE = /^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/i;

  let drStart = 85;
  let crStart = 96;
  let balStart = 105;

  for (let i = 0; i < Math.min(60, lines.length); i++) {
    const l = lines[i];
    if (/(?:Withdra|Debit)/i.test(l) && /(?:Deposit|Credit)/i.test(l)) {
      const drIdx = l.search(/(?:Withdra|Debit)/i);
      const crIdx = l.search(/(?:Deposit|Credit)/i);
      const balIdx = l.search(/Balance/i);
      if (drIdx !== -1) drStart = drIdx - 2;
      if (crIdx !== -1) crStart = crIdx - 2;
      if (balIdx !== -1) balStart = balIdx - 2;
      break;
    }
  }

  const rawBlocks = [];
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.includes('Detailed Statement') || line.includes('Page ') || line.includes('Transaction remarks:')) {
      continue;
    }

    const match = line.match(ROW_START_RE) || line.match(GENERIC_ROW_RE);
    if (match) {
      if (currentBlock) rawBlocks.push(currentBlock);
      currentBlock = {
        srNo: match[1],
        firstLine: line,
        lines: [line],
      };
    } else if (currentBlock) {
      if (ROW_START_RE.test(line) || GENERIC_ROW_RE.test(line) || DIRECT_DATE_RE.test(line)) {
        rawBlocks.push(currentBlock);
        currentBlock = null;
        i--;
      } else {
        currentBlock.lines.push(line);
      }
    }
  }
  if (currentBlock) rawBlocks.push(currentBlock);

  for (const block of rawBlocks) {
    const firstLine = block.firstLine;
    const dateMatch = firstLine.match(/(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2})/);
    const txnDate = dateMatch ? parseDate(dateMatch[1]) : null;
    if (!txnDate) continue;

    let joinedDr = '';
    let joinedCr = '';
    let joinedBal = '';
    const remarks = [];

    for (const rawLine of block.lines) {
      if (rawLine.includes('End Of Statement') || rawLine.startsWith('Opening Bal:') || rawLine.startsWith('Withdrawls:') || rawLine.startsWith('Deposits:') || rawLine.startsWith('Closing Bal:') || rawLine.startsWith('Legends Used')) {
        continue;
      }
      const line = rawLine.padEnd(160, ' ');

      const remPart = line.slice(55, drStart).trim();
      if (remPart && !remPart.startsWith('Page ')) remarks.push(remPart);

      const drPart = line.slice(drStart, crStart).trim();
      if (drPart && drPart !== '-') joinedDr += drPart;

      const crPart = line.slice(crStart, balStart).trim();
      if (crPart && crPart !== '-') joinedCr += crPart;

      const balPart = line.slice(balStart).trim();
      if (balPart && balPart !== '-') joinedBal += balPart;
    }

    const narration = remarks.join(' ').replace(/\s{2,}/g, ' ').trim();
    const refMatch = narration.match(/(?:INF\/INFT\/|INF\/NEFT\/|UPI\/|BIL\/ONL\/|IMPS\/|UTR[:\s/]*|CHQ[:\s/]*)([A-Z0-9]+)/i);
    const invMatch = narration.match(/(?:INV|INVOICE|BILL)[:\s/#]*([A-Z0-9\-\/]+)/i);
    const gstinMatch = narration.match(GSTIN_RE);

    transactions.push({
      transactionDate: txnDate,
      valueDate: null,
      narration: narration || 'Bank Transaction',
      referenceNo: refMatch ? refMatch[1] : null,
      invoiceRef: invMatch ? invMatch[1] : null,
      debit: parseAmount(joinedDr),
      credit: parseAmount(joinedCr),
      balance: parseAmount(joinedBal),
      vendorName: null,
      vendorGSTIN: gstinMatch ? gstinMatch[0] : null,
    });
  }

  if (transactions.length === 0) {
    return parseBankStatement(text);
  }

  return transactions;
}

// ─── Bank Statement Parser (Text Line Fallback) ───────────────────────────────

function parseBankStatement(text) {
  const lines = text.split('\n');
  const transactions = [];

  const DATE_START = /^\s*(\d{1,5}\s+)?\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !DATE_START.test(line)) continue;

    const cells = line.split(/\s{2,}|\t/);
    const amounts = cells.map(c => parseAmount(c));
    const amtIdxs = amounts.map((v, idx) => (v !== null ? idx : -1)).filter(idx => idx !== -1);

    const balance = amtIdxs.length >= 1 ? amounts[amtIdxs[amtIdxs.length - 1]] : null;
    const amount2 = amtIdxs.length >= 2 ? amounts[amtIdxs[amtIdxs.length - 2]] : null;
    const amount3 = amtIdxs.length >= 3 ? amounts[amtIdxs[amtIdxs.length - 3]] : null;

    const debit = amount3 ?? (amount2 && !amount3 ? amount2 : null);
    const credit = amount3 ? amount2 : null;

    const firstAmtIdx = amtIdxs[0] ?? cells.length;
    const narration = cells.slice(1, firstAmtIdx).join(' ').trim();

    const refMatch = narration.match(/(?:REF|UTR|CHQ|NEFT|IMPS|UPI)[:\s/]*([A-Z0-9]+)/i);
    const invMatch = narration.match(/(?:INV|INVOICE|BILL)[:\s/#]*([A-Z0-9\-\/]+)/i);
    const gstinMatch = narration.match(GSTIN_RE);

    transactions.push({
      transactionDate: parseDate(cells[0]),
      valueDate: cells.length > 2 ? parseDate(cells[1]) : null,
      narration: narration || 'Bank Transaction',
      referenceNo: refMatch?.[1] ?? null,
      invoiceRef: invMatch?.[1] ?? null,
      debit,
      credit,
      balance,
      vendorName: null,
      vendorGSTIN: gstinMatch?.[0] ?? null,
    });
  }

  return transactions;
}

// ─── Ledger / Account Statement Parser (Text) ─────────────────────────────────

function parseLedgerStatement(text) {
  const lines = text.split('\n');
  const transactions = [];

  const DATE_START = /^\s*(\d{1,5}\s+)?\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !DATE_START.test(line)) continue;

    const cells = line.split(/\s{2,}|\t/);
    const amounts = cells.map(c => parseAmount(c));
    const amtIdxs = amounts.map((v, idx) => (v !== null ? idx : -1)).filter(idx => idx !== -1);

    const balance = amtIdxs.length >= 1 ? amounts[amtIdxs[amtIdxs.length - 1]] : null;
    const debit = amtIdxs.length >= 3 ? amounts[amtIdxs[amtIdxs.length - 3]] : null;
    const credit = amtIdxs.length >= 2 ? amounts[amtIdxs[amtIdxs.length - 2]] : null;

    const firstAmtIdx = amtIdxs[0] ?? cells.length;
    const particulars = cells.slice(1, firstAmtIdx).join(' ').trim();

    const slashParts = particulars.split('/');
    const vendorName = slashParts[0]?.trim() ?? null;
    const invoiceRef = slashParts[1]?.trim() ?? null;

    const searchBlock = [line, lines[i + 1] ?? ''].join(' ');
    const gstinMatch = [...searchBlock.matchAll(GSTIN_RE)];
    const vendorGSTIN = gstinMatch[0]?.[1] ?? null;

    transactions.push({
      transactionDate: parseDate(cells[0]),
      valueDate: null,
      narration: particulars,
      referenceNo: null,
      invoiceRef,
      debit,
      credit,
      balance,
      vendorName,
      vendorGSTIN,
    });
  }

  return transactions;
}

function detectStatementType(text) {
  const lower = text.toLowerCase();
  const bankScore = (lower.match(/\b(utr|neft|imps|upi|chq|ifsc|bank\s*statement|withdrawal|deposit|balance|icici|hdfc|sbi|axis)\b/g) || []).length;
  const ledgerScore = (lower.match(/\b(ledger|voucher|vch|tally|opening\s*balance)\b/g) || []).length;
  return bankScore >= ledgerScore ? 'BANK' : 'LEDGER';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract transactions from a bank/ledger statement (Excel, CSV, PDF, or Image).
 * @returns { statementType, transactions }
 */
export async function extractStatement(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Excel (.xlsx, .xls) and CSV files
  if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    return parseSpreadsheetStatement(filePath);
  }

  // PDF statement with layout preservation
  if (ext === '.pdf') {
    let layoutText = '';
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      layoutText = execFileSync('pdftotext', ['-layout', absPath, '-'], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (err) {
      logger.warn('pdftotext -layout failed or unavailable, using pdf-parse fallback', { error: err.message });
    }

    if (layoutText && layoutText.length > 100) {
      const statementType = detectStatementType(layoutText);
      const transactions = statementType === 'BANK'
        ? parseBankStatementTabular(layoutText)
        : parseLedgerStatement(layoutText);
      logger.info(`Parsed ${transactions.length} transactions via pdftotext -layout`);
      if (transactions.length > 0) {
        return { statementType, transactions };
      }
    }
  }

  // Fallback PDF or Image extraction
  const { text } = await extractText(filePath);
  logger.info(`Statement text extracted: ${text.length} chars`);

  const statementType = detectStatementType(text);
  logger.info(`Detected statement type: ${statementType}`);

  const transactions = statementType === 'BANK'
    ? parseBankStatementTabular(text)
    : parseLedgerStatement(text);

  logger.info(`Parsed ${transactions.length} transactions from ${statementType} statement`);
  return { statementType, transactions };
}
