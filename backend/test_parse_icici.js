import fs from 'fs';
import { execFileSync } from 'child_process';

const file = '/opt/ledgr/backend/uploads/statements/86771254-1cc2-47a1-b432-0fbaaff65f08.pdf';

function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[₹Rs,\s]/gi, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(str) {
  if (!str) return null;
  const s = String(str).replace(/\s+/g, '').trim();
  const dmy = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3];
    return new Date(`${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
  }
  const dMonY = s.match(/(\d{1,2})[-/]?([A-Za-z]{3})[-/]?(\d{2,4})/);
  if (dMonY) {
    let y = dMonY[3];
    if (y.length === 2) y = '20' + y;
    return new Date(`${dMonY[2]} ${dMonY[1]}, ${y}`);
  }
  return null;
}

// Extract using pdftotext -layout
const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf-8' });
const lines = text.split('\n');

console.log(`Total lines from pdftotext -layout: ${lines.length}`);

// Find where transaction table starts
const transactions = [];
let currentTx = null;

// Pattern for start of row in ICICI statement:
// Column 1: Sr No (1 to 99999)
// Column 2: Tran ID (e.g. S5703, S5883, or numeric)
// Column 3: Date (e.g. 20/Sep/2026 or 20/09/2026)
const ROW_START_RE = /^\s*(\d{1,5})\s+([A-Z0-9]+)\s+(\d{1,2}[-/][A-Za-z0-9]{3}[-/]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\d{1,2}[-/][A-Za-z0-9]{3}[-/]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i;

// Also generic row start: line starting with date or serial number
const GENERIC_ROW_RE = /^\s*(\d{1,5})\s+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/i;
const DIRECT_DATE_RE = /^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/i;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim() || line.includes('Detailed Statement') || line.includes('Page ') || line.includes('Transaction remarks:')) {
    continue;
  }

  const match = line.match(ROW_START_RE);
  if (match) {
    if (currentTx) transactions.push(currentTx);
    currentTx = {
      srNo: match[1],
      tranId: match[2],
      valDate: match[3],
      txnDate: match[4],
      lines: [line],
    };
  } else if (currentTx) {
    // Check if next line is another transaction or continuation
    if (ROW_START_RE.test(line) || GENERIC_ROW_RE.test(line) || DIRECT_DATE_RE.test(line)) {
      transactions.push(currentTx);
      currentTx = null;
      i--; // re-process line
    } else {
      currentTx.lines.push(line);
    }
  }
}
if (currentTx) transactions.push(currentTx);

console.log(`Extracted transactions: ${transactions.length}`);
function cleanBlock(lines) {
  let joinedDr = '';
  let joinedCr = '';
  let joinedBal = '';
  const remarks = [];

  for (const rawLine of lines) {
    if (rawLine.includes('Detailed Statement') || rawLine.includes('Page ') || rawLine.includes('Transaction remarks:') || rawLine.includes('Legends Used') || rawLine.includes('End Of Statement')) {
      continue;
    }
    // Pad line to at least 140 chars
    const line = rawLine.padEnd(150, ' ');

    const remPart = line.slice(62, 103).trim();
    if (remPart && !remPart.startsWith('Page ')) remarks.push(remPart);

    const drPart = line.slice(103, 118).trim();
    if (drPart && drPart !== '-') joinedDr += drPart;

    const crPart = line.slice(118, 130).trim();
    if (crPart && crPart !== '-') joinedCr += crPart;

    const balPart = line.slice(130).trim();
    if (balPart && balPart !== '-') joinedBal += balPart;
  }

  const narration = remarks.join(' ').replace(/\s{2,}/g, ' ').trim();
  const refMatch = narration.match(/(?:INF\/INFT\/|INF\/NEFT\/|UPI\/|BIL\/ONL\/|IMPS\/|UTR[:\s/]*|CHQ[:\s/]*)([A-Z0-9]+)/i);
  const invMatch = narration.match(/(?:INV|INVOICE|BILL)[:\s/#]*([A-Z0-9\-\/]+)/i);

  return {
    narration,
    referenceNo: refMatch ? refMatch[1] : null,
    invoiceRef: invMatch ? invMatch[1] : null,
    debit: parseAmount(joinedDr),
    credit: parseAmount(joinedCr),
    balance: parseAmount(joinedBal),
  };
}

const cleanedTxs = transactions.slice(0, 10).map(t => ({
  srNo: t.srNo,
  date: parseDate(t.txnDate),
  ...cleanBlock(t.lines)
}));

console.log('Cleaned 10 samples with column slicing:', JSON.stringify(cleanedTxs, null, 2));


