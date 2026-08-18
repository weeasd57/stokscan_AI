import json, sys, urllib.request

url = "http://localhost:3100/api/test-chat"
msgs = sys.argv[1:]
for m in msgs:
    body = json.dumps({"message": m}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            d = json.loads(r.read().decode("utf-8"))
        print("=" * 70)
        print("Q:", m)
        print("TOOLS:", json.dumps(d.get("tool_summary"), ensure_ascii=False))
        print("LATENCY_MS:", d.get("latency_ms"))
        print("RESPONSE:", (d.get("response") or "")[:800])
    except Exception as e:
        print("Q:", m, "-> ERROR:", e)
