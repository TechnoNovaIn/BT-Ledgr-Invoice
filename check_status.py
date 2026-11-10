import json
import urllib.request

try:
    req = urllib.request.urlopen('http://localhost:3002/api/invoices')
    data = json.loads(req.read().decode('utf-8'))
    invoices = data.get('invoices', [])
    print(f"=== INVOICES ({len(invoices)}) ===")
    for inv in invoices:
        vname = (inv.get('vendorName') or '')[:30]
        print(f"ID: {inv['id'][:8]} | No: {inv.get('invoiceNumber')} | Vendor: {vname} | Date: {inv.get('invoiceDate')} | GST: {inv.get('vendorGSTIN')} | Total: {inv.get('grandTotal')}")

    req_st = urllib.request.urlopen('http://localhost:3002/api/statements')
    data_st = json.loads(req_st.read().decode('utf-8'))
    statements = data_st.get('statements', [])
    print(f"\n=== STATEMENTS ({len(statements)}) ===")
    for st in statements:
        print(f"ID: {st['id'][:8]} | File: {st.get('fileName')} | Type: {st.get('statementType')} | Status: {st.get('status')} | TxCount: {st.get('_count', {}).get('transactions') or len(st.get('transactions', []))}")
except Exception as e:
    print(f"Error: {e}")
