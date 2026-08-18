import json, sys, urllib.request
url = "http://localhost:3100/api/test-chat"
body = json.dumps({
    "message": sys.argv[1],
    "session_summary": sys.argv[2] if len(sys.argv) > 2 else None,
    "session_symbol": sys.argv[3] if len(sys.argv) > 3 else None,
    "session_last_symbols": sys.argv[4].split(",") if len(sys.argv) > 4 and sys.argv[4] else [],
}, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
d = json.loads(urllib.request.urlopen(req, timeout=180).read().decode("utf-8"))
print("PLAN entities.symbols:", d.get("plan", {}).get("entities", {}).get("symbols"))
print("PLAN tools:", d.get("plan", {}).get("tools"))
print("TOOLS:", json.dumps(d.get("tool_summary"), ensure_ascii=False)[:300])
print("RESP:", (d.get("response") or "")[:200].replace(chr(10), " / "))
