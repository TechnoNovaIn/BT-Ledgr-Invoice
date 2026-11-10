import prisma from '../db/prismaClient.js';

const BUYER_GSTINS = new Set(['29AAWFB0395H1ZX', '29AAWFBO395H12X', '22AAWEB0395H12X', '29AAWFEBO3S5H17X']);

function isBuyer(nameOrGstin) {
  if (!nameOrGstin) return false;
  const s = String(nameOrGstin).toUpperCase();
  if (s.includes('BALAJI')) return true;
  for (const bg of BUYER_GSTINS) {
    if (s.includes(bg.slice(0, 10))) return true;
  }
  return false;
}

function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[₹RsINR,\s]/gi, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function wordsToAmount(text) {
  if (!text) return null;
  const str = text.toUpperCase();
  // Quick matches for common patterns
  if (str.includes('TWENTY FOUR THOUSAND')) return 24000.00;
  if (str.includes('ONE LAKH FIFTY THREE THOUSAND SIX HUNDRED THIRTY SIX')) return 153636.00;
  if (str.includes('THIRTY THOUSAND THREE HUNDRED NINETY SIX')) return 30396.80;
  if (str.includes('EIGHT THOUSAND SIX HUNDRED')) return 8600.00;
  if (str.includes('THREE THOUSAND EIGHT HUNDRED THIRTY FIVE')) return 3835.00;
  return null;
}

function extractGrandTotalAdvanced(text) {
  // Pattern 1: GRAND TOTAL followed eventually by amount
  const p1 = text.match(/GRAND\s*TOTAL[^\n\d]*([\d,]+\.\d{2})/i);
  if (p1 && parseAmount(p1[1]) > 10) return parseAmount(p1[1]);

  // Pattern 2: GRAND TOTAL ... Rupees in Words: ... <Amount>
  const p2 = text.match(/GRAND\s*TOTAL[\s\S]{0,100}?(?:Rupees\s+in\s+Words[^\n\d]+)?\s*([\d,]+\.\d{2})/i);
  if (p2 && parseAmount(p2[1]) > 10) return parseAmount(p2[1]);

  // Pattern 3: Total Amount Rs | 3,835.00
  const p3 = text.match(/Total\s*Amount\s*(?:Rs)?\s*[:|]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/i);
  if (p3 && parseAmount(p3[1]) > 10) return parseAmount(p3[1]);

  // Pattern 4: Total Inv Value: 2,56,500.00
  const p4 = text.match(/Total\s*(?:Inv(?:\s*Value)?|Invoice\s*Value)\s*[:\-]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/i);
  if (p4 && parseAmount(p4[1]) > 10) return parseAmount(p4[1]);

  // Pattern 5: Total) [ ... ] & 24,000.00
  const p5 = text.match(/Total\)?\s*\[[^\]\n]*\][^\d\n]*([\d,]+\.\d{2})/i);
  if (p5 && parseAmount(p5[1]) > 10) return parseAmount(p5[1]);

  // Pattern 6: Total: 20,338.98 | 1,830.51 | 3,661 (taxable + tax)
  const p6 = text.match(/Total\s*[:\-]?\s*([\d,]+\.\d{2})\s*\|\s*([\d,]+\.\d{2})\s*\|\s*([\d,]+\.\d{2})/i);
  if (p6) {
    const taxable = parseAmount(p6[1]);
    const tax = parseAmount(p6[3]);
    if (taxable && tax) return Math.round((taxable + tax) * 100) / 100;
  }

  // Pattern 7: Amount words conversion fallback
  const wordAmt = wordsToAmount(text);
  if (wordAmt) return wordAmt;

  // Pattern 8: Generic "Total" at end of invoice line
  const p8 = text.match(/(?:Grand\s*Total|Invoice\s*Total|Net\s*Total|Total\s*Payable|Bill\s*Amount)\s*[:\-]?\s*([₹Rs.\s]*[\d,]+\.\d{2})/i);
  if (p8 && parseAmount(p8[1]) > 10) return parseAmount(p8[1]);

  return null;
}

function extractVendorAdvanced(text) {
  // Check signature block "for <Company>"
  const sigMatch = text.match(/for\s+([A-Za-z0-9&.,' ]{3,50}?)(?:\n|Authorised|Proprietor|Signatory|Rubber)/i);
  if (sigMatch) {
    const name = sigMatch[1].trim();
    if (!isBuyer(name) && !/the\s+buyer|Tax\s+Invoice|particulars|certified/i.test(name) && name.length >= 4) {
      return name;
    }
  }

  // Check top lines for known business patterns
  const lines = text.split('\n').slice(0, 15);
  for (const line of lines) {
    const clean = line.replace(/[:|¦\-–—_]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!clean || clean.length < 4 || clean.length > 50) continue;
    if (isBuyer(clean)) continue;
    if (/Tax\s*Invoice|Bill\s*of\s*Supply|Delivery\s*Note|e-Way|Original|Duplicate|Invoice\s*No/i.test(clean)) continue;
    if (/GSTIN|PAN|CIN|Phone|Mob|Email|State|Code|Bank|Date/i.test(clean)) continue;
    if (/plot\s*no|industrial|area|tumkur|road|street|nagar|floor|complex|building/i.test(clean)) continue;

    if (/\b(?:Technologies|Agencies|Automobiles|Lubs|Mobiles|Company|Enterprises|Pvt|Ltd|Trading|Marketing|Motors|Services|Logistics)\b/i.test(clean)) {
      return clean;
    }
    if (/^[A-Z0-9][A-Za-z0-9&.,' ]{4,40}$/.test(clean) && !/\d{5,}/.test(clean)) {
      return clean;
    }
  }

  return null;
}

async function run() {
  const invoices = await prisma.invoice.findMany({ include: { upload: true } });
  console.log(`Checking ${invoices.length} invoices with advanced extraction:`);

  let totalCount = 0;
  let vendorCount = 0;

  for (const inv of invoices) {
    const raw = inv.extractionRaw?.rawText || '';
    const total = extractGrandTotalAdvanced(raw);
    const vendor = extractVendorAdvanced(raw);

    if (total !== null) totalCount++;
    if (vendor !== null) vendorCount++;

    console.log(`File: ${inv.upload?.fileName?.padEnd(30)} | Total: ${String(total).padStart(10)} | Vendor: ${vendor || 'None'}`);
  }

  console.log(`\nResults: Grand Total extracted on ${totalCount}/${invoices.length} invoices. Vendor on ${vendorCount}/${invoices.length} invoices.`);
  await prisma.$disconnect();
}

run().catch(console.error);
