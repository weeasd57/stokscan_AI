import os
import sys

# Add project root to python path
sys.path.append(os.path.abspath('.'))

# Removed import to avoid error
# Let's replicate the TS logic in python:

SHARIA_COMPLIANT_EGX_SYMBOLS = [
  "ISPH", "AMOC", "ICFC", "IFAP", "OCDI", "RMDA", "ACGC", "ARCC", "CIRA",
  "ETRS", "ETEL", "MPCO", "ORWE", "MTIE", "ORAS", "ORHD", "EFIH", "EFID",
  "PHDC", "SAUD", "FAITA", "FAIT", "JUFO", "RACC", "SKPC", "OLFI", "EGAS",
  "LCSW", "TMGH", "MASR", "ATQA", "MCQE", "EGAL", "ADIB"
]

SHARIA_SET = set(s.upper() for s in SHARIA_COMPLIANT_EGX_SYMBOLS)

def is_sharia_compliant(symbol):
    if not symbol:
        return False
    base = symbol.upper().split(".")[0]
    return base in SHARIA_SET

from api.stock_ai import _init_supabase, supabase as _supabase

try:
    _init_supabase()
    res = _supabase.table("scan_results").select("symbol,status").execute()
    for row in res.data:
        sym = row.get("symbol")
        status = row.get("status")
        print(f"Symbol: {sym} | Status: {status} | Sharia: {is_sharia_compliant(sym)}")
except Exception as e:
    print(e)
