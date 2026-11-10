import prisma from '../db/prismaClient.js';
import { parseInvoiceWithRegex } from './regexParser.js';

async function testInvoices() {
  const invoices = await prisma.invoice.findMany({
    include: { upload: true }
  });

  console.log(`Loaded ${invoices.length} invoices from database.`);
  for (const inv of invoices) {
    const rawText = inv.extractionRaw?.rawText || '';
    const res = parseInvoiceWithRegex(rawText);
    const parsed = res.data;
    console.log('----------------------------------------------------');
    console.log(`File: ${inv.upload?.fileName}`);
    console.log(`  CURRENT: No=${inv.invoiceNumber} | Vendor=${inv.vendorName?.slice(0,25)} | Total=${inv.grandTotal}`);
    console.log(`  PARSER:  No=${parsed.invoiceNumber} | Vendor=${parsed.vendorName?.slice(0,25)} | Total=${parsed.grandTotal} | Date=${parsed.invoiceDate ? parsed.invoiceDate.toISOString().slice(0,10) : null} | Conf=${res.confidence.toFixed(2)}`);
  }
  await prisma.$disconnect();
}

testInvoices().catch(console.error);
