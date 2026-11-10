import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

req = urllib.request.urlopen('http://localhost:3002/api/invoices')
data = json.loads(req.read().decode('utf-8'))
for inv in data.get('invoices', [])[:8]:
    print("="*70)
    print(f"ID: {inv.get('id')} | Current No: {inv.get('invoiceNumber')} | Current Total: {inv.get('grandTotal')}")
    raw = inv.get('extractionRaw', {}).get('rawText', '')
    print(raw[:1200])

