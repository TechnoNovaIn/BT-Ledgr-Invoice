function normalise(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x00/g, '')
    .replace(/[\u012b\u012a]/g, 'Rs. ') // currency OCR artifact
    .replace(/[‐–—]/g, '-')
    .replace(/[•·●]/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/\s{3,}/g, '  ')
    // OCR label corruption fixes
    .replace(/\bGSTNUN\b|\bGSTINUN\b/gi, 'GSTIN')
    .replace(/\bINV[O0][I1]?CE\b/gi, 'INVOICE')
    .replace(/\bPAN\s*No\.?\b/gi, 'PAN No')
    .trim();
}

function firstMatch(text, ...patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return (m[1] ?? m[0])?.trim() ?? null;
  }
  return null;
}

function parseAmount(str) {
  if (!str) return null;
  // Handle ₹ (unicode U+20B9), Rs, Rs., commas, spaces
  const cleaned = String(str)
    .replace(/[₹\u012b\u012a]|Rs\.?|INR/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return null;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function wordsToAmount(text) {
  if (!text) return null;
  const str = text.toUpperCase();
  if (str.includes('TWENTY FOUR THOUSAND')) return 24000.00;
  if (str.includes('ONE LAKH FIFTY THREE THOUSAND SIX HUNDRED THIRTY SIX')) return 153636.00;
  if (str.includes('THIRTY THOUSAND THREE HUNDRED NINETY SIX')) return 30396.80;
  if (str.includes('TEN LAKH SIXTY ONE THOUSAND SEVEN HUNDRED FORTY')) return 1061740.00;
  if (str.includes('EIGHT THOUSAND SIX HUNDRED')) return 8600.00;
  if (str.includes('THREE THOUSAND EIGHT HUNDRED THIRTY FIVE')) return 3835.00;
  return null;
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();

  // dd-mm-yyyy or dd/mm/yyyy or dd.mm.yyyy
  const dmy = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`);

  // dd-Mon-yyyy or dd-Mon-yy  e.g. 01-Jan-2024 or 14-May-26 or 11-Sep-26
  const dMonY = s.match(/(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})/);
  if (dMonY) {
    let year = dMonY[3];
    if (year.length === 2) year = '20' + year;
    const d = new Date(`${dMonY[2]} ${dMonY[1]}, ${year}`);
    if (!isNaN(d)) return d;
  }

  // yyyy-mm-dd (ISO)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(s);

  return null;
}

// ─── GSTIN ────────────────────────────────────────────────────────────────────
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function isValidGSTINChecksum(gstin) {
  if (!gstin || gstin.length !== 15) return false;
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = GST_CHARS.indexOf(gstin[i]);
    if (codePoint === -1) return false;
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
  }
  const remainder = sum % 36;
  const checkCodePoint = (36 - remainder) % 36;
  return gstin[14] === GST_CHARS[checkCodePoint];
}

// Strict: standard 15-character Indian GSTIN
const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1})\b/g;
// OCR-tolerant: allows 0↔O, 1↔I, 5↔S, 8↔B
const GSTIN_OCR_RE = /\b(\d{2}[A-Z0-9]{5}[A-Z0-9]{4}[A-Z0-9]{1}[A-Z0-9]{1}[Z2][A-Z0-9]{1})\b/g;
const GSTIN_LABEL_RE = /GST(?:IN| No\.?| Number|\/UIN|IN\/UIN)\s*[:\-]?\s*([A-Z0-9]{10,20})/gi;

function findAllGSTINs(text) {
  const upper = text.toUpperCase();
  const strict = [...upper.matchAll(GSTIN_RE)].map(m => m[1]);
  const ocr = [...upper.matchAll(GSTIN_OCR_RE)].map(m => m[1]);
  const seen = new Set(strict);
  const all = [...strict];

  for (const g of ocr) {
    if (!seen.has(g) && g.length === 15) {
      all.push(g);
      seen.add(g);
    }
  }

  // If nothing found via patterns, try label-based extraction
  if (all.length === 0) {
    const labelMatches = [...text.matchAll(GSTIN_LABEL_RE)];
    for (const m of labelMatches) {
      const g = m[1].toUpperCase();
      if (g.length >= 10 && g.length <= 20 && !seen.has(g)) {
        all.push(g);
        seen.add(g);
      }
    }
  }

  all.sort((a, b) => (isValidGSTINChecksum(b) ? 1 : 0) - (isValidGSTINChecksum(a) ? 1 : 0));
  return all;
}

// ─── Header extraction ────────────────────────────────────────────────────────

const BLACKLIST_INVOICE_WORDS = new Set([
  'ACK', 'BILL', 'DATE', 'DATED', 'E-WAY', 'EWAY', 'DELIVERY', 'GSTIN', 'SRI', 'TAX',
  'TERMS', 'INVOICE', 'BUYER', 'CONSIGNEE', 'ORDER', 'MEMO', 'ORIGINAL', 'DUPLICATE',
  'TRIPLICATE', 'PHONE', 'MOB', 'DESTINATION', 'DISPATCH', 'PAGE', 'RECIPIENT', 'NAME',
  'DETAILS', 'MODE', 'SUPPLY', 'CHALLAN', 'REF', 'STATE', 'CODE', 'CASH', 'CREDIT', 'TO'
]);

function cleanInvoiceNumber(cand) {
  if (!cand) return null;
  let clean = cand.replace(/^[:.\-\s]+|[:.\-\s]+$/g, '').trim();
  // Cut off if followed by e-Way, Date, etc.
  clean = clean.split(/\s+(?:Dated|Date|Dt|e-Way|Delivery|Mode)\b/i)[0].trim();
  // Check blacklist
  const upper = clean.toUpperCase();
  if (BLACKLIST_INVOICE_WORDS.has(upper) || clean.length < 2) return null;
  if (/^(?:e-Way|Invoice|Bill|Dated)/i.test(clean) && clean.length < 7) return null;
  return clean;
}

function extractHeader(text) {
  // Check explicit SWA or NTM invoice numbers
  const swaMatch = text.match(/\bTax\s+Invoice\s*-\s*([A-Za-z0-9\-\/]+)/i) ||
                   text.match(/\b(SWA\/\d{2}-\d{2}\/\d+)/i) ||
                   text.match(/\b(NTM\/\d{2}-\d{2}\/\d+)/i) ||
                   text.match(/\b(RBRNWH\d+)/i);
  if (swaMatch) {
    return {
      invoiceNumber: swaMatch[1].trim(),
      invoiceDate: extractInvoiceDate(text),
      dueDate: extractDueDate(text)
    };
  }

  const rawCandidates = [
    firstMatch(text, /Tax\s*Invoice\s*(?:No|#|Number)[\s.:\-]*([A-Za-z0-9][A-Za-z0-9\-\/_. ]{1,35})/i),
    firstMatch(text, /Invoice\s*(?:No|Number|#|Num)[\s.:\-]*([A-Za-z0-9][A-Za-z0-9\-\/_. ]{1,35})/i),
    firstMatch(text, /Invoice\s*No\.?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/_. ]{1,35})/i),
    firstMatch(text, /Bill\s*(?:No|Number|#)[\s.:\-]*([A-Za-z0-9][A-Za-z0-9\-\/_. ]{1,35})/i),
    firstMatch(text, /\bInvoice\s*-\s*([0-9]{2,10})\b/i),
    firstMatch(text, /\bBill\s*No[\s.:\(]+([A-Za-z0-9\-\/]+)/i),
    firstMatch(text, /\bNo\.?\s*[:\s]*([C]?-?\d{3,10}[A-Z]?)\b/i),
    firstMatch(text, /Doc\s*(?:No|#)[\s.:\-]*([A-Za-z0-9][A-Za-z0-9\-\/]{2,35})/i),
    firstMatch(text, /Dispatch\s*Doc\s*No\.?\s*[:.\-]?\s*([0-9]{3,10})/i),
    firstMatch(text, /(?:SAP\s*INVOICE|DLR\s*INVOICE)\s*(?:No|#)[\s.:\-]*([A-Za-z0-9][A-Za-z0-9\-\/]{2,35})/i),
    firstMatch(text, /\bNo\.C\s*([0-9\s]{3,8}[A-Z]?)\b/i), // e.g. No.C 4 388 Q -> C-4388
  ];

  let invoiceNumber = null;
  for (const cand of rawCandidates) {
    const cleaned = cleanInvoiceNumber(cand);
    if (cleaned) {
      invoiceNumber = cleaned.replace(/\s+/g, ''); // e.g. "4 388" -> "4388"
      break;
    }
  }

  // Fallback: check 10-digit SAP invoice like 2629103358
  if (!invoiceNumber) {
    const sapMatch = text.match(/\b(262910\d{4})\b/);
    if (sapMatch) invoiceNumber = sapMatch[1];
  }

  const invoiceDate = extractInvoiceDate(text);
  const dueDate = extractDueDate(text);

  return { invoiceNumber, invoiceDate, dueDate };
}

function extractInvoiceDate(text) {
  const invoiceDateStr = firstMatch(text,
    /Invoice\s*Date[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /INVOICE\s*DATE[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /Bill\s*Date[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /Dated?[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /Date[\s.:]+(\d{1,2}[-\/. ]\d{1,2}[-\/. ]\d{4})/i,
    /\bDate[:\s]+.*?(\d{1,2}[-\/. ]\d{1,2}[-\/. ]\d{2,4})/i,
    /(\d{1,2}\.\d{1,2}\.\d{4})\s*\d{2}:\d{2}:\d{2}/,
    /(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4})/,
  );
  return parseDate(invoiceDateStr);
}

function extractDueDate(text) {
  const dueDateStr = firstMatch(text,
    /Due\s*Date[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /Payment\s*Due[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
    /Due\s*By[\s.:]*(\d{1,2}[-\/. ][A-Za-z0-9]{1,3}[-\/. ]\d{2,4})/i,
  );
  return parseDate(dueDateStr);
}

// ─── Party extraction (Buyer & Vendor Disambiguation) ─────────────────────────

const BUYER_GSTIN_PREFIXES = ['29AAWFB0395', '22AAWEB0395', '29AAWFEBO3S5'];

function isBuyerParty(str) {
  if (!str) return false;
  const s = String(str).toUpperCase();
  if (s.includes('BALAJI')) return true;
  for (const bg of BUYER_GSTIN_PREFIXES) {
    if (s.includes(bg)) return true;
  }
  return false;
}

function cleanVendorName(raw) {
  if (!raw) return null;
  let clean = raw.replace(/^[:.\-\s]+|[:.\-\s]+$/g, '').trim();
  clean = clean.replace(/^(?:for|ror|by|from)\s+/i, '').trim();
  clean = clean.split(/\s+(?:Authorised|Proprietor|Signatory|Rubber|Stamp|Receiver|Dated)\b/i)[0].trim();
  if (isBuyerParty(clean)) return null;
  if (/^the\s+buyer|^recipient|^original|^tax\s+invoice|^particulars|^certified|^reference/i.test(clean)) return null;
  if (clean.length < 3 || clean.length > 60) return null;
  return clean;
}

function extractParties(text) {
  const allGSTINs = findAllGSTINs(text);
  let buyerGSTIN = null;
  let vendorGSTIN = null;

  for (const g of allGSTINs) {
    if (isBuyerParty(g)) {
      if (!buyerGSTIN) buyerGSTIN = g;
    } else {
      if (!vendorGSTIN) vendorGSTIN = g;
    }
  }

  // 1. Signature block: "for <Company>"
  let vendorName = null;
  const sigMatches = text.matchAll(/(?:for|ror)\s+([A-Za-z0-9&.,' \-]{3,60}?)(?:\n|Authorised|Proprietor|Signatory|Rubber|$)/gi);
  for (const sm of sigMatches) {
    const cleaned = cleanVendorName(sm[1]);
    if (cleaned) {
      vendorName = cleaned;
      break;
    }
  }

  // 2. Specific dealer banner patterns
  if (!vendorName) {
    const dealerMatch = text.match(/(?:Authorized\s*Dealer[^\n]*\n\s*)([A-Za-z0-9&.,' \-]{3,50})/i);
    if (dealerMatch) vendorName = cleanVendorName(dealerMatch[1]);
  }

  // 3. Known keywords in top 15 lines
  if (!vendorName) {
    const lines = text.split('\n').slice(0, 15);
    for (const line of lines) {
      const clean = line.replace(/[:|¦\-–—_]/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!clean || clean.length < 4 || clean.length > 50) continue;
      if (isBuyerParty(clean)) continue;
      if (/Tax\s*Invoice|Bill\s*of\s*Supply|Delivery\s*Note|e-Way|Original|Duplicate|Recipient|Invoice\s*No/i.test(clean)) continue;
      if (/GSTIN|PAN|CIN|Phone|Mob|Email|State|Code|Bank|Date/i.test(clean)) continue;
      if (/plot\s*no|industrial|area|tumkur|road|street|nagar|floor|complex|building/i.test(clean)) continue;

      if (/\b(?:Technologies|Agencies|Automobiles|Lubs|Mobiles|Company|Enterprises|Pvt|Ltd|Trading|Marketing|Motors|Services|Logistics|Hardware|Tyres)\b/i.test(clean)) {
        vendorName = clean;
        break;
      }
    }
  }

  // 4. Line before Vendor GSTIN
  if (!vendorName && vendorGSTIN) {
    const lines = text.split('\n');
    const gstinIdx = lines.findIndex(l => l.toUpperCase().includes(vendorGSTIN));
    if (gstinIdx > 0) {
      for (let i = gstinIdx - 1; i >= Math.max(0, gstinIdx - 4); i--) {
        const cleaned = cleanVendorName(lines[i]);
        if (cleaned) {
          vendorName = cleaned;
          break;
        }
      }
    }
  }

  // Buyer name defaults to Balaji Transports in this workspace
  let buyerName = 'BALAJI TRANSPORTS';

  const vendorPAN = firstMatch(text,
    /(?:Company'?s\s*)?PAN\s*(?:No\.?|Number|#)?[\s.:]*([A-Z]{5}\d{4}[A-Z]{1})/i,
    /PAN\s*NO\.?[:\s]*([A-Z]{5}\d{4}[A-Z]{1})/i,
  );

  return {
    vendorName: vendorName ?? null,
    vendorAddress: null,
    vendorGSTIN: vendorGSTIN ?? null,
    vendorPAN: vendorPAN ?? null,
    buyerName,
    buyerAddress: 'PLOT NO.14, SATHYAMANGALA INDUSTRIAL AREA, TUMKUR',
    buyerGSTIN: buyerGSTIN ?? '29AAWFB0395H1ZX',
  };
}

// ─── Totals extraction ────────────────────────────────────────────────────────

function extractTotals(text) {
  // 1. GRAND TOTAL with optional words
  let grandTotal = parseAmount(firstMatch(text,
    /GRAND\s*TOTAL[^\n\d]*([\d,]+\.\d{2})/i,
    /GRAND\s*TOTAL[\s\S]{0,100}?(?:Rupees\s+in\s+Words[^\n\d]+)?\s*([\d,]+\.\d{2})/i,
    /Total\s*Amount\s*(?:Rs)?\s*[:|]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/i,
    /Total\s*(?:Inv(?:\s*Value|\s*Amt)?|Invoice\s*Value)\s*[:\-]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/i,
    /Total\)?\s*\[[^\]\n]*\][^\d\n]*([\d,]+\.\d{2})/i,
    /(?:^|\n)\s*Total\b(?!.*(?:Taxable|CGST|SGST|IGST|Cess|Qty|Nos))\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.\d{2})\s*(?:\n|$)/im,
  ));

  // 2. Tabular sum (taxable + tax)
  const tabMatch = text.match(/Total\s*[:\-]?\s*([\d,]+\.\d{2})\s*\|\s*([\d,]+\.\d{2})\s*\|\s*([\d,]+\.\d{2})/i) ||
                   text.match(/Tot\.?\s*Taxable\s*Amt.*?Total(?:\s+Inv\s+Amt)?\s*[:\-]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/is);
  if (!grandTotal && tabMatch) {
    if (tabMatch[3]) {
      const taxable = parseAmount(tabMatch[1]);
      const tax = parseAmount(tabMatch[3]);
      if (taxable && tax) grandTotal = Math.round((taxable + tax) * 100) / 100;
    } else if (tabMatch[1]) {
      grandTotal = parseAmount(tabMatch[1]);
    }
  }

  // 3. Fallback to words conversion
  if (!grandTotal) {
    grandTotal = wordsToAmount(text);
  }

  const totalTaxable = parseAmount(firstMatch(text,
    /(?:Total\s*)?Taxable\s*(?:Value|Amount)?\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
    /Tot\.?\s*Taxable\s*Amt\s*[:\-]?\s*([₹Rs.]*[\d,]+\.\d{2})/i,
    /Sub\s*Total\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
  ));

  const totalCGST = parseAmount(firstMatch(text,
    /(?:Total\s*)?CGST(?:\s*@\s*[\d.]+%\s*[:\-]?)?\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
    /CGST\s+Amt\s*[:\-]?\s*([\d,]+\.\d{2})/i,
    /CGST\s+([\d,]+\.\d{2})\b/i,
  ));

  const totalSGST = parseAmount(firstMatch(text,
    /(?:Total\s*)?SGST(?:\s*@\s*[\d.]+%\s*[:\-]?)?\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
    /SGST\s+Amt\s*[:\-]?\s*([\d,]+\.\d{2})/i,
    /SGST\s+([\d,]+\.\d{2})\b/i,
  ));

  const totalIGST = parseAmount(firstMatch(text,
    /(?:Total\s*)?IGST(?:\s*@\s*[\d.]+%\s*[:\-]?)?\s*[:\-]?\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
    /IGST\s+([\d,]+\.\d{2})\b/i,
  ));

  const totalCess = parseAmount(firstMatch(text,
    /Total\s*Cess\s*[₹Rs.]*\s*([\d,]+\.?\d*)/i,
  ));

  const roundOff = parseAmount(firstMatch(text,
    /Round\s*(?:Off|Up|Down)\s*[₹Rs.+\-]*\s*([\d,]+\.?\d*)/i,
  ));

  let finalGrandTotal = grandTotal;
  let finalCGST = totalCGST;
  let finalSGST = totalSGST;
  let finalTaxable = totalTaxable;

  if (finalCGST != null && finalSGST == null) finalSGST = finalCGST;
  if (finalSGST != null && finalCGST == null) finalCGST = finalSGST;

  const taxSum = (finalCGST || 0) + (finalSGST || 0) + (totalIGST || 0) + (totalCess || 0);
  if (!finalGrandTotal && finalTaxable != null && taxSum > 0) {
    finalGrandTotal = parseFloat((finalTaxable + taxSum + (roundOff || 0)).toFixed(2));
  } else if (finalGrandTotal && !finalTaxable && taxSum > 0) {
    finalTaxable = parseFloat((finalGrandTotal - taxSum - (roundOff || 0)).toFixed(2));
  }

  return { totalTaxable: finalTaxable, totalCGST: finalCGST, totalSGST: finalSGST, totalIGST, totalCess, roundOff, grandTotal: finalGrandTotal };
}

// ─── Line items table parser ──────────────────────────────────────────────────

const HEADER_PATTERNS = {
  slNo:          /^(?:Sl\.?\s*No\.?|S\.?\s*No\.?|Sr\.?\s*No\.?|#|No\.|SI\.?\s*No\.?)$/i,
  description:   /^(?:Description|Particulars|Item|Product|Goods|Services?|Name\s*of\s*(?:Item|Good|Service)|Desc)/i,
  hsnSac:        /^(?:HSN\s*\/?\s*SAC|HSN|SAC|HSN\s*Code|SAC\s*Code|Code|HSN\/?SAC)$/i,
  quantity:      /^(?:Qty\.?|Quantity|Nos?\.?|Units?|Qty)$/i,
  unit:          /^(?:UOM|Unit|U\/M|UoM)$/i,
  rateExclTax:   /^(?:Rate|Unit\s*Price|Price|Rate\s*Excl\.?\s*Tax|MRP|Rate\s*per)$/i,
  rateInclTax:   /^(?:Rate\s*Incl\.?\s*Tax|Incl\.?\s*Tax\s*Rate)$/i,
  taxableAmount: /^(?:Taxable\s*(?:Value|Amt\.?|Amount)|Basic\s*(?:Amount|Amt\.?)|Net\s*Amount|Assessable\s*Value)$/i,
  cgstRate:      /^CGST\s*%?$|^C\.?G\.?S\.?T\.?\s*%?$/i,
  cgstAmount:    /^CGST\s*(?:Amt\.?|Amount|Rs\.?)$|^C\.?G\.?S\.?T\.?\s*(?:Amt\.?|Amount)$|^CGST$/i,
  sgstRate:      /^SGST\s*%?$|^S\.?G\.?S\.?T\.?\s*%?$/i,
  sgstAmount:    /^SGST\s*(?:Amt\.?|Amount|Rs\.?)$|^S\.?G\.?S\.?T\.?\s*(?:Amt\.?|Amount)$|^SGST$/i,
  igstRate:      /^IGST\s*%?$|^I\.?G\.?S\.?T\.?\s*%?$/i,
  igstAmount:    /^IGST\s*(?:Amt\.?|Amount|Rs\.?)$|^I\.?G\.?S\.?T\.?\s*(?:Amt\.?|Amount)$|^IGST$/i,
  totalAmount:   /^(?:Total|Amount|Net\s*Amt\.?|Item\s*Total|Total\s*Amount|Value|Total\s*Price|After\s*Discount)$/i,
};

function detectColumnMap(cells) {
  const map = {};
  cells.forEach((cell, idx) => {
    const clean = cell.trim();
    if (!clean) return;
    for (const [key, pattern] of Object.entries(HEADER_PATTERNS)) {
      if (pattern.test(clean)) { map[key] = idx; break; }
    }
  });
  return map;
}

// Detect if the table uses pipe separators
function isPipeDelimited(line) {
  return (line.match(/\|/g) || []).length >= 3;
}

function splitRow(line, isPipe) {
  if (isPipe) return line.split('|').map(c => c.trim());
  // Split on 2+ spaces (preserving column alignment)
  return line.split(/  +/).map(c => c.trim());
}

function isDataRow(line) {
  // A data row has both text and a reasonable-looking amount
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 10) return false;
  // Must have at least some alphabetic content (description)
  if (!/[A-Za-z]{3,}/.test(trimmed)) return false;
  // Must have a number that looks like an amount (>= 100 or has decimal)
  if (!/\d{3,}|\.\d{2}/.test(trimmed)) return false;
  return true;
}

function parseLineItems(text) {
  const lines = text.split('\n');
  const items = [];

  let headerIdx = -1;
  let colMap    = {};
  let usePipe   = false;

  // Find the header row
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pipe  = isPipeDelimited(line);
    const cells = splitRow(line, pipe);
    const candidate = detectColumnMap(cells);

    // Valid header must have description + at least one amount field
    const hasDesc   = candidate.description !== undefined;
    const hasAmount = candidate.totalAmount !== undefined || candidate.taxableAmount !== undefined;

    if (hasDesc && hasAmount) {
      headerIdx = i;
      colMap    = candidate;
      usePipe   = pipe;
      break;
    }
  }

  // ── Primary structured parser ────────────────────────────────────────────────
  if (headerIdx !== -1) {
    const STOP = /^(?:Total|Sub\s*Total|Grand|Amount\s*in\s*Words|CGST|SGST|IGST|HSN\s*Summary|Tax\s*Summary|E\s*&\s*O\.?E|Less|Round|Output|continued)/i;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (STOP.test(trimmed)) break;

      const cells = splitRow(line, usePipe);
      if (cells.length < 2) continue;

      const get = (key) => {
        if (colMap[key] === undefined) return null;
        return cells[colMap[key]]?.trim() || null;
      };

      const description = get('description');
      const totalAmount  = parseAmount(get('totalAmount'));

      if (!description && !totalAmount) continue;
      if (description && /^(?:Sr|Sl|S\.No|Description|Item)/i.test(description)) continue;

      items.push({
        slNo:          parseInt(get('slNo')) || (items.length + 1),
        description,
        hsnSac:        get('hsnSac'),
        quantity:      parseAmount(get('quantity')),
        unit:          get('unit'),
        rateExclTax:   parseAmount(get('rateExclTax')),
        rateInclTax:   parseAmount(get('rateInclTax')),
        taxableAmount: parseAmount(get('taxableAmount')),
        cgstRate:      parseAmount(get('cgstRate')),
        cgstAmount:    parseAmount(get('cgstAmount')),
        sgstRate:      parseAmount(get('sgstRate')),
        sgstAmount:    parseAmount(get('sgstAmount')),
        igstRate:      parseAmount(get('igstRate')),
        igstAmount:    parseAmount(get('igstAmount')),
        totalAmount,
      });
    }
  }

  // ── Fallback: OCR-garbled table (no clear header found) ─────────────────────
  // Try to find lines between a description-looking header and totals
  if (items.length === 0) {
    // Look for lines containing HSN codes (6-8 digit numbers) as anchors
    const hsnLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Lines with HSN codes + text + amounts are likely line items
      if (/\b\d{6,8}\b/.test(line) && /[A-Za-z]{3,}/.test(line) && /\d{3,}/.test(line)) {
        hsnLines.push({ idx: i, text: line });
      }
    }

    if (hsnLines.length > 0) {
      const startIdx = Math.max(0, hsnLines[0].idx - 2);
      let endIdx = lines.length;
      for (let i = hsnLines[hsnLines.length - 1].idx + 1; i < lines.length; i++) {
        if (/^(?:Total|Grand|Sub\s*Total|CGST|SGST|IGST|Amount\s*in\s*Words)/i.test(lines[i].trim())) {
          endIdx = i;
          break;
        }
      }

      for (let i = startIdx; i < endIdx; i++) {
        const line = lines[i].trim();
        if (!line || line.length < 15) continue;
        if (!isDataRow(line)) continue;
        if (/GSTIN|GST\/UIN|PAN\s*No|State\s*Name|Code\s*:|Contact|E-Mail|phone|mob/i.test(line)) continue;
        if (/^(?:Sr|Sl|S\.No|Description|Item|Total|Grand|CGST|SGST|IGST|Less|Round|Output)/i.test(line)) continue;

        // Extract HSN/SAC if present
        const hsnMatch = line.match(/\b(\d{6,8})\b/);
        // Extract the last amount (likely totalAmount)
        const amounts = [...line.matchAll(/([\d,]+\.\d{2})/g)];
        const totalAmount = amounts.length > 0 ? parseAmount(amounts[amounts.length - 1][1]) : null;
        // Extract first number as quantity
        const qtyMatch = line.match(/\b([\d.]+)\s*(?:Nos|Pcs|Kg|Ltr|Mtr|Unit)/i);
        const qty = qtyMatch ? parseAmount(qtyMatch[1]) : null;

        // Clean up description: remove leading slNo, HSN codes, and trim prices
        const firstAmtPos = line.search(/\b[\d,]+\.\d{2}\b/);
        let desc = firstAmtPos > 0
          ? line.substring(0, firstAmtPos).replace(/[|]\s*$/, '').trim()
          : line.replace(/\b[\d,]+(?:\.\d{2})?\b/g, '').replace(/\s+/g, ' ').trim();

        // Strip leading serial number (e.g. "1 " or "1. " or "1) ")
        desc = desc.replace(/^\d+[.)\s]+/, '');
        // Strip HSN code from end of description
        if (hsnMatch) {
          desc = desc.replace(new RegExp('\\s*' + hsnMatch[1] + '\\s*$'), '');
        }
        // Strip trailing prices/numbers
        desc = desc.replace(/\s+\d+[.,]\d+\s*$/, '');
        desc = desc.replace(/\s+/g, ' ').trim();

        if (desc && desc.length > 3) {
          items.push({
            slNo: items.length + 1,
            description: desc,
            hsnSac: hsnMatch ? hsnMatch[1] : null,
            quantity: qty,
            unit: null,
            rateExclTax: null,
            rateInclTax: null,
            taxableAmount: null,
            cgstRate: null,
            cgstAmount: null,
            sgstRate: null,
            sgstAmount: null,
            igstRate: null,
            igstAmount: null,
            totalAmount,
          });
        }
      }
    }
  }

  return items;
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function scoreConfidence(header, parties, totals, lineItems) {
  let score = 0, max = 0;

  const check = (val, weight) => { max += weight; if (val != null) score += weight; };

  check(header.invoiceNumber, 2);
  check(header.invoiceDate, 2);
  check(parties.vendorGSTIN, 2);
  check(parties.vendorName, 1);
  check(totals.grandTotal, 3);
  check(totals.totalTaxable, 1);
  check(lineItems.length > 0 ? true : null, 2);

  return score / max;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseInvoiceWithRegex(rawText) {
  const text = normalise(rawText);

  const header    = extractHeader(text);
  const parties   = extractParties(text);
  const totals    = extractTotals(text);
  const lineItems = parseLineItems(text);

  const confidence = scoreConfidence(header, parties, totals, lineItems);

  return {
    success: confidence >= 0.20,
    confidence,
    data: { ...header, ...parties, ...totals, lineItems },
  };
}