import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

req = urllib.request.urlopen('http://localhost:3002/api/invoices')
data = json.loads(req.read().decode('utf-8'))
for inv in data.get('invoices', [])[:4]:
    print("="*60)
    print(f"ID: {inv['id']} | Extracted No: {inv.get('invoiceNumber')} | Vendor: {inv.get('vendorName')} | Total: {inv.get('grandTotal')}")
    raw = inv.get('extractionRaw') or {}
    text = raw.get('rawText', '')
    print("--- RAW TEXT (first 600 chars) ---")
    print(text[:600])

print("\n" + "="*60)
print("=== STATEMENTS ===")
req_st = urllib.request.urlopen('http://localhost:3002/api/statements')
data_st = json.loads(req_st.read().decode('utf-8'))
for st in data_st.get('statements', []):
    st_id = st['id']
    req_detail = urllib.request.urlopen(f'http://localhost:3002/api/statements/{st_id}')
    st_data = json.loads(req_detail.read().decode('utf-8'))
    print(f"Statement: {st.get('fileName')} ({st_id})")
    txs = st_data.get('transactions', [])
    print(f"Total transactions: {len(txs)}")
    for t in txs[:5]:
        print(f"  Tx: Date={t.get('transactionDate')} | Ref={t.get('referenceNo')} | Debit={t.get('debit')} | Credit={t.get('credit')} | Narration={t.get('narration')[:50]}")
