import { logger } from '../utils/logger.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const VENDOR_THRESHOLD = parseFloat(process.env.VENDOR_MATCH_THRESHOLD   || '0.70'); // lowered from 0.75
const AMOUNT_TOLERANCE = parseFloat(process.env.AMOUNT_TOLERANCE_PERCENT || '0.02'); // 2% tolerance (was 1%)

// ─── String similarity ────────────────────────────────────────────────────────

function normaliseStr(s) {
  return (s ?? '')
    .toLowerCase()
    .replace(/\b(pvt|ltd|private|limited|india|co|corp|llp|inc)\b\.?/g, '') // strip legal suffixes
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1;
  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  if (range < 0) return 0;

  const s1m = new Array(s1.length).fill(false);
  const s2m = new Array(s2.length).fill(false);
  let matches = 0, trans = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - range);
    const end   = Math.min(i + range + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  const a = s1.split('').filter((_, i) => s1m[i]);
  const b = s2.split('').filter((_, i) => s2m[i]);
  a.forEach((c, i) => { if (c !== b[i]) trans++; });

  return (matches / s1.length + matches / s2.length + (matches - trans / 2) / matches) / 3;
}

/**
 * Smart vendor similarity:
 * - Strips legal suffixes (Pvt Ltd, Limited, etc.)
 * - Checks substring containment first (handles "ABC Pvt Ltd" vs "ABC")
 * - Falls back to Jaro for fuzzy matching
 * FIX: when matching against bank narration, extract the likely vendor name
 * from the narration instead of comparing the full sentence.
 */
function vendorSimilarity(invoiceName, statementVendorOrNarration) {
  const a = normaliseStr(invoiceName);
  if (!a) return 0;

  // For bank statements, narration is a long string like
  // "NEFT/INB/UTR123/ABC TRADERS PVT LTD/PAYMENT FOR INV"
  // Extract the most meaningful token (longest word-group that isn't a code)
  const tokens = (statementVendorOrNarration ?? '').split(/[\/\-_|]/).map(t => t.trim()).filter(Boolean);
  let best = 0;
  for (const token of tokens) {
    const b = normaliseStr(token);
    if (!b || b.length < 3) continue;
    if (a.includes(b) || b.includes(a)) return 0.95;
    const score = jaroSimilarity(a, b);
    if (score > best) best = score;
  }
  return best;
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkAmount(invoice, txn) {
  const invoiceAmt = parseFloat(invoice.grandTotal ?? 0);
  // FIX: check BOTH debit and credit — invoice payment could appear as either
  const debit  = parseFloat(txn.debit  ?? 0);
  const credit = parseFloat(txn.credit ?? 0);
  const stmtAmt = debit > 0 ? debit : credit;

  if (!invoiceAmt || !stmtAmt) return { match: null, invoiceAmt, stmtAmt, diff: null };

  const diff    = Math.abs(invoiceAmt - stmtAmt);
  const pctDiff = diff / invoiceAmt;
  const match   = pctDiff <= AMOUNT_TOLERANCE;

  return { match, invoiceAmt, stmtAmt, diff: parseFloat(diff.toFixed(2)) };
}

function checkVendor(invoice, txn) {
  const invoiceVendor    = invoice.vendorName;
  // Use vendorName if available (ledger), otherwise use narration (bank)
  const statementVendor  = txn.vendorName ?? txn.narration;
  const similarity       = vendorSimilarity(invoiceVendor, statementVendor);
  const match            = similarity >= VENDOR_THRESHOLD;
  return { match, invoiceVendor, statementVendor: txn.vendorName ?? txn.narration, similarity: parseFloat(similarity.toFixed(3)) };
}

function checkDate(invoice, txn) {
  const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : null;
  const paymentDate = txn.transactionDate  ? new Date(txn.transactionDate)  : null;

  if (!invoiceDate || !paymentDate) return { match: null, invoiceDate, paymentDate, daysDiff: null };

  const daysDiff = Math.round((paymentDate - invoiceDate) / (1000 * 60 * 60 * 24));
  // FIX: allow payment up to 7 days BEFORE invoice date (pre-payments are common)
  // and up to 365 days after
  const match = daysDiff >= -7 && daysDiff <= 365;
  return { match, invoiceDate, paymentDate, daysDiff };
}

function checkGSTIN(invoice, txn) {
  const invoiceGSTIN   = (invoice.vendorGSTIN ?? '').trim().toUpperCase();
  const statementGSTIN = (txn.vendorGSTIN    ?? '').trim().toUpperCase();

  // FIX: if statement has no GSTIN at all (bank statements rarely do),
  // treat as null (inconclusive) rather than false (mismatch)
  if (!invoiceGSTIN || !statementGSTIN) return { match: null, invoiceGSTIN, statementGSTIN };
  return { match: invoiceGSTIN === statementGSTIN, invoiceGSTIN, statementGSTIN };
}

function checkInvoiceRef(invoice, txn) {
  const invNumber = (invoice.invoiceNumber ?? '').trim().toUpperCase();
  if (!invNumber) return { match: null, invoiceRefFound: null };

  const narration = (txn.narration  ?? '').toUpperCase();
  const invRef    = (txn.invoiceRef ?? '').toUpperCase();

  // FIX: also check if any significant portion of the invoice number appears
  // (handles cases like "INV-2024-001" in narration as "20240001")
  const cleanInv = invNumber.replace(/[^A-Z0-9]/g, '');
  const cleanNar = narration.replace(/[^A-Z0-9]/g, '');

  const match = narration.includes(invNumber)
    || invRef === invNumber
    || (cleanInv.length >= 5 && cleanNar.includes(cleanInv));

  return { match, invoiceRefFound: match ? invNumber : null };
}

// ─── Best transaction finder ──────────────────────────────────────────────────

function scoreMatch(invoice, txn) {
  const amt = checkAmount(invoice, txn);
  const ven = checkVendor(invoice, txn);
  const ref = checkInvoiceRef(invoice, txn);
  const gst = checkGSTIN(invoice, txn);
  const dt  = checkDate(invoice, txn);

  // Date is only a soft tie-breaker: reward a plausible gap, never penalise a
  // missing date (when the invoice date is absent we lean on vendor/GSTIN/amount).
  const dateScore = dt.match === true ? 0.10 : 0;

  // Weighted: amount (35%), invoice ref (30%), vendor (20%), GSTIN (15%), date (10%)
  return (
    (amt.match === true ? 0.35 : amt.match === null ? 0.08 : 0) +
    (ref.match === true ? 0.30 : ref.match === null ? 0.04 : 0) +
    (ven.match === true ? 0.20 : ven.match === null ? 0.04 : ven.similarity * 0.15) +
    (gst.match === true ? 0.15 : gst.match === null ? 0.04 : 0) +
    dateScore
  );
}

// ─── Invoice-number match (primary key) ───────────────────────────────────────
// Bank/ledger statements usually reference the invoice number inside the narration
// (e.g. "NEFT/INV-2024-001/ABC TRADERS"). This is the strongest, most reliable link.

function normalizeInvoiceNo(s) {
  return (s ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function findInvoiceNumberMatch(invoice, transactions) {
  const invNum = normalizeInvoiceNo(invoice.invoiceNumber);
  if (!invNum || invNum.length < 4) return null; // too short → unreliable, use fuzzy

  let best = null;
  for (const txn of transactions) {
    const narration = normalizeInvoiceNo(txn.narration);
    const invRef    = normalizeInvoiceNo(txn.invoiceRef);
    const matched =
      narration.includes(invNum) ||
      invRef === invNum ||
      // tolerate trailing/leading noise: last 6 digits of a longer invoice no.
      (invNum.length >= 6 && narration.includes(invNum.slice(-6)));

    if (!matched) continue;

    // Prefer the transaction whose amount also lines up with the grand total
    if (!best || checkAmount(invoice, txn).match) best = txn;
  }
  return best;
}

function findBestMatch(invoice, transactions) {
  if (!transactions?.length) return null;
  let best = null, bestScore = -1;

  for (const txn of transactions) {
    const score = scoreMatch(invoice, txn);
    if (score > bestScore) { bestScore = score; best = txn; }
  }

  // Minimum threshold to consider a match (was 0.35)
  return bestScore >= 0.30 ? best : null;
}

// ─── GST math self-validation ─────────────────────────────────────────────────

export function validateInvoiceMath(invoice, lineItems) {
  const results = [];
  const sum = (key) => lineItems.reduce((acc, li) => acc + parseFloat(li[key] ?? 0), 0);

  const calcTaxable = sum('taxableAmount');
  const calcCGST    = sum('cgstAmount');
  const calcSGST    = sum('sgstAmount');
  const calcIGST    = sum('igstAmount');
  const calcGrand   = calcTaxable + calcCGST + calcSGST + calcIGST + parseFloat(invoice.roundOff ?? 0);

  const check = (field, expected, actual) => ({
    field,
    expected: parseFloat((expected ?? 0).toFixed(2)),
    actual:   parseFloat(parseFloat(actual ?? 0).toFixed(2)),
    ok: Math.abs((expected ?? 0) - parseFloat(actual ?? 0)) < 1.0, // 1 rupee tolerance
  });

  if (lineItems.length > 0) {
    results.push(check('totalTaxable', calcTaxable, invoice.totalTaxable));
    results.push(check('totalCGST',    calcCGST,    invoice.totalCGST));
    results.push(check('totalSGST',    calcSGST,    invoice.totalSGST));
    results.push(check('totalIGST',    calcIGST,    invoice.totalIGST));
    results.push(check('grandTotal',   calcGrand,   invoice.grandTotal));
  }

  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function validateInvoiceAgainstStatement(invoice, transactions) {
  // Primary key: invoice number present in the statement narration.
  const invNumTxn = findInvoiceNumberMatch(invoice, transactions);
  // Fallback: weighted fuzzy match (amount + ref + vendor + date proximity).
  const fuzzyTxn  = findBestMatch(invoice, transactions);

  const bestTxn    = invNumTxn || fuzzyTxn;
  const matchBasis = invNumTxn ? 'INVOICE_NUMBER' : (fuzzyTxn ? 'FUZZY' : null);

  if (!bestTxn) {
    logger.warn(`No matching transaction found for invoice ${invoice.invoiceNumber}`);
    return {
      invoiceId:       invoice.id,
      transactionId:   null,
      amountMatch:     null,
      vendorMatch:     null,
      dateCheck:       null,
      gstinMatch:      null,
      invoiceRefMatch: null,
      overallStatus:   'MISMATCH',
      notes: 'No matching transaction found in statement',
    };
  }

  const amtCheck  = checkAmount(invoice, bestTxn);
  const venCheck  = checkVendor(invoice, bestTxn);
  const dateCheck = checkDate(invoice, bestTxn);
  const gstCheck  = checkGSTIN(invoice, bestTxn);
  // When matched by invoice number, the ref check is inherently satisfied.
  const refCheck  = invNumTxn
    ? { match: true, invoiceRefFound: invoice.invoiceNumber }
    : checkInvoiceRef(invoice, bestTxn);

  // Overall status based only on definitive (non-null) checks.
  const definitive = [amtCheck.match, venCheck.match, dateCheck.match, gstCheck.match, refCheck.match]
    .filter(c => c !== null);
  const passed  = definitive.filter(c => c === true).length;
  const failed  = definitive.filter(c => c === false).length;

  let overallStatus;
  if (failed === 0)                    overallStatus = 'PASSED';
  else if (passed === 0 && failed > 0) overallStatus = 'MISMATCH';
  else                                 overallStatus = 'PARTIAL';

  // Matched by invoice number but the paid amount does NOT match the invoice → hard mismatch.
  if (matchBasis === 'INVOICE_NUMBER' && amtCheck.match === false) {
    overallStatus = 'MISMATCH';
  }

  const notes = [`Matched by: ${matchBasis === 'INVOICE_NUMBER' ? 'invoice number' : 'fuzzy (amount/vendor/ref/date)'}`];
  if (amtCheck.match  === false) notes.push(`Amount mismatch: invoice ₹${amtCheck.invoiceAmt} vs stmt ₹${amtCheck.stmtAmt} (diff ₹${amtCheck.diff})`);
  if (venCheck.match  === false) notes.push(`Vendor mismatch: "${venCheck.invoiceVendor}" vs "${venCheck.statementVendor}" (${(venCheck.similarity*100).toFixed(0)}% match)`);
  if (dateCheck.match === false) notes.push(`Date issue: payment ${dateCheck.daysDiff}d ${dateCheck.daysDiff < -7 ? 'before' : 'after'} invoice`);
  if (gstCheck.match  === false) notes.push(`GSTIN mismatch: ${gstCheck.invoiceGSTIN} vs ${gstCheck.statementGSTIN}`);
  if (refCheck.match  === false) notes.push(`Invoice ref "${invoice.invoiceNumber}" not found in narration`);

  return {
    invoiceId:       invoice.id,
    transactionId:   bestTxn.id,
    amountMatch:     amtCheck.match,
    amountInvoice:   amtCheck.invoiceAmt,
    amountStatement: amtCheck.stmtAmt,
    amountDiff:      amtCheck.diff,
    vendorMatch:     venCheck.match,
    vendorInvoice:   venCheck.invoiceVendor,
    vendorStatement: venCheck.statementVendor,
    dateCheck:       dateCheck.match,
    invoiceDate:     dateCheck.invoiceDate,
    paymentDate:     dateCheck.paymentDate,
    daysDiff:        dateCheck.daysDiff,
    gstinMatch:      gstCheck.match,
    gstinInvoice:    gstCheck.invoiceGSTIN,
    gstinStatement:  gstCheck.statementGSTIN,
    invoiceRefMatch: refCheck.match,
    invoiceRefFound: refCheck.invoiceRefFound,
    overallStatus,
    notes: notes.join(' | ') || null,
  };
}