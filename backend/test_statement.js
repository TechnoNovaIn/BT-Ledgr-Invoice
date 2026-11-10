import fs from 'fs';
import path from 'path';

async function run() {
  const file = '/opt/ledgr/backend/uploads/statements/86771254-1cc2-47a1-b432-0fbaaff65f08.pdf';
  if (!fs.existsSync(file)) {
    console.log('File not found:', file);
    return;
  }
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = mod.default;
  const buffer = fs.readFileSync(file);
  const data = await pdfParse(buffer);
  console.log('=== PDF-PARSE TEXT (first 3000 chars) ===');
  console.log(data.text.slice(0, 3000));
}

run().catch(console.error);
