import json, sys, urllib.request
url = "http://localhost:3100/api/test-chat"
msg, summary = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
body = json.dumps({"message": msg, "session_summary": summary}, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
d = json.loads(urllib.request.urlopen(req, timeout=180).read().decode("utf-8"))
print("Q:", msg, "| PRIOR:", summary or "(none)")
print("TOOLS:", json.dumps(d.get("tool_summary"), ensure_ascii=False))
print("RESPONSE:", (d.get("response") or "")[:700])
