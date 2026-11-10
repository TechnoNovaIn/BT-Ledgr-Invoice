import prisma from './src/db/prismaClient.js';
import { extractStatement } from './src/services/statementParser.js';
import { parseInvoiceWithRegex } from './src/services/regexParser.js';

async function main() {
  console.log('===========================================================');
  console.log('      BT LEDGR — REPROCESSING ALL INVOICES & STATEMENTS   ');
  console.log('===========================================================');

  // 1. Reprocess Statements
  const statements = await prisma.statementUpload.findMany();
  console.log(`\n[1/2] Reprocessing ${statements.length} statement files...`);

  for (const st of statements) {
    console.log(`\nProcessing statement: ${st.fileName} (ID: ${st.id})`);
    try {
      const { statementType, transactions } = await extractStatement(st.filePath);
      console.log(`  -> Extracted ${transactions.length} transactions (${statementType})`);

      // Delete old transactions
      await prisma.transaction.deleteMany({ where: { statementId: st.id } });

      // Insert new transactions
      if (transactions.length > 0) {
        await prisma.transaction.createMany({
          data: transactions.map(t => ({ ...t, statementId: st.id })),
        });
      }

      // Update statement status
      await prisma.statementUpload.update({
        where: { id: st.id },
        data: {
          statementType,
          status: 'DONE',
        },
      });
      console.log(`  ✓ Successfully updated statement ${st.fileName} with ${transactions.length} transactions.`);
    } catch (err) {
      console.error(`  ✗ Error processing statement ${st.fileName}:`, err.message);
    }
  }

  // 2. Reprocess Invoices
  const invoices = await prisma.invoice.findMany({
    include: { upload: true }
  });
  console.log(`\n[2/2] Reprocessing ${invoices.length} invoices with new regex engine...`);

  let updatedCount = 0;
  for (const inv of invoices) {
    const rawText = inv.extractionRaw?.rawText || '';
    if (!rawText) {
      console.log(`  Skipping ${inv.upload?.fileName} (no rawText)`);
      continue;
    }

    const res = parseInvoiceWithRegex(rawText);
    const d = res.data;

    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        invoiceNumber: d.invoiceNumber || inv.invoiceNumber,
        invoiceDate:   d.invoiceDate || inv.invoiceDate,
        dueDate:       d.dueDate || inv.dueDate,
        vendorName:    d.vendorName || inv.vendorName,
        vendorGSTIN:   d.vendorGSTIN || inv.vendorGSTIN,
        vendorPAN:     d.vendorPAN || inv.vendorPAN,
        buyerName:     d.buyerName || inv.buyerName,
        buyerAddress:  d.buyerAddress || inv.buyerAddress,
        buyerGSTIN:    d.buyerGSTIN || inv.buyerGSTIN,
        grandTotal:    d.grandTotal != null ? d.grandTotal : inv.grandTotal,
        totalTaxable:  d.totalTaxable != null ? d.totalTaxable : inv.totalTaxable,
        totalCGST:     d.totalCGST != null ? d.totalCGST : inv.totalCGST,
        totalSGST:     d.totalSGST != null ? d.totalSGST : inv.totalSGST,
        totalIGST:     d.totalIGST != null ? d.totalIGST : inv.totalIGST,
        totalCess:     d.totalCess != null ? d.totalCess : inv.totalCess,
        roundOff:      d.roundOff != null ? d.roundOff : inv.roundOff,
        extractionRaw: {
          ...inv.extractionRaw,
          confidence: res.confidence,
        },
      },
    });

    updatedCount++;
    console.log(`  ✓ ${inv.upload?.fileName?.padEnd(30)} | No: ${String(d.invoiceNumber || '').padEnd(16)} | Vendor: ${String(d.vendorName || '').slice(0, 25).padEnd(25)} | Total: ₹${d.grandTotal || '-'}`);
  }

  console.log(`\n===========================================================`);
  console.log(`Finished: Reprocessed ${statements.length} statements & ${updatedCount} invoices.`);
  console.log(`===========================================================`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error during reprocessing:', err);
  process.exit(1);
});
