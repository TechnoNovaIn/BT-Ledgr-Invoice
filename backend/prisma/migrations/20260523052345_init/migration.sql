-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'VALIDATED', 'MISMATCH', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('REGEX', 'OLLAMA');

-- CreateEnum
CREATE TYPE "StatementType" AS ENUM ('BANK', 'LEDGER');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PENDING', 'PASSED', 'MISMATCH', 'PARTIAL');

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceUpload" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "vendorName" TEXT,
    "vendorAddress" TEXT,
    "vendorGSTIN" TEXT,
    "vendorPAN" TEXT,
    "buyerName" TEXT,
    "buyerAddress" TEXT,
    "buyerGSTIN" TEXT,
    "totalTaxable" DECIMAL(14,2),
    "totalCGST" DECIMAL(14,2),
    "totalSGST" DECIMAL(14,2),
    "totalIGST" DECIMAL(14,2),
    "totalCess" DECIMAL(14,2),
    "roundOff" DECIMAL(8,2),
    "grandTotal" DECIMAL(14,2),
    "extractionMethod" "ExtractionMethod" NOT NULL DEFAULT 'REGEX',
    "extractionRaw" JSONB,
    "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "slNo" INTEGER,
    "description" TEXT,
    "hsnSac" TEXT,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "rateInclTax" DECIMAL(14,2),
    "rateExclTax" DECIMAL(14,2),
    "taxableAmount" DECIMAL(14,2),
    "cgstRate" DECIMAL(5,2),
    "cgstAmount" DECIMAL(14,2),
    "sgstRate" DECIMAL(5,2),
    "sgstAmount" DECIMAL(14,2),
    "igstRate" DECIMAL(5,2),
    "igstAmount" DECIMAL(14,2),
    "cessRate" DECIMAL(5,2),
    "cessAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2),

    CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementUpload" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "statementType" "StatementType" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3),
    "valueDate" TIMESTAMP(3),
    "narration" TEXT,
    "referenceNo" TEXT,
    "debit" DECIMAL(14,2),
    "credit" DECIMAL(14,2),
    "balance" DECIMAL(14,2),
    "vendorName" TEXT,
    "vendorGSTIN" TEXT,
    "invoiceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationResult" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amountMatch" BOOLEAN,
    "amountInvoice" DECIMAL(14,2),
    "amountStatement" DECIMAL(14,2),
    "amountDiff" DECIMAL(14,2),
    "vendorMatch" BOOLEAN,
    "vendorInvoice" TEXT,
    "vendorStatement" TEXT,
    "dateCheck" BOOLEAN,
    "invoiceDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "daysDiff" INTEGER,
    "gstinMatch" BOOLEAN,
    "gstinInvoice" TEXT,
    "gstinStatement" TEXT,
    "invoiceRefMatch" BOOLEAN,
    "invoiceRefFound" TEXT,
    "overallStatus" "ValidationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_uploadId_key" ON "Invoice"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationResult_invoiceId_key" ON "ValidationResult"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceUpload" ADD CONSTRAINT "InvoiceUpload_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "InvoiceUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementUpload" ADD CONSTRAINT "StatementUpload_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "StatementUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationResult" ADD CONSTRAINT "ValidationResult_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationResult" ADD CONSTRAINT "ValidationResult_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
