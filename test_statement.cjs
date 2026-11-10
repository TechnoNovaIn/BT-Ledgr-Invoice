const fs = require('fs');
const pdfParse = require('pdf-parse');

async function run() {
  const file = '/opt/ledgr/backend/uploads/statements/86771254-1cc2-47a1-b432-0fbaaff65f08.pdf';
  if (!fs.existsSync(file)) {
    console.log('File not found:', file);
    return;
  }
  const buffer = fs.readFileSync(file);
  const data = await pdfParse(buffer);
  console.log('=== PDF-PARSE TEXT (first 2500 chars) ===');
  console.log(data.text.slice(0, 2500));
}

run().catch(console.error);
