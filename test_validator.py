import json, sys, urllib.request
URL = "http://localhost:3100/api/test-chat"
QS = [
    "هل يوجد تصريف على CRST؟ اذكر درجة التصريف وأيام التصريف وتاريخ المسح",
    "CRST سعره 2.92 والمقاومة 2.92، هل هو عند المقاومة أم تحتها؟ احسب النسبة",
    "قلت إن 2.50 دعم، من أي بيانات أو مؤشر جاءت 2.50؟",
    "بناءً على بيانات CRST فقط، ما السيناريوهات المحتملة للجلسة القادمة وما الذي يؤكد كل سيناريو؟",
    "حلل CRST",
]
sel = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else range(len(QS))
for i in sel:
    m = QS[i]
    body = json.dumps({"message": m, "session_summary": "تحليل CRST"}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=240).read().decode("utf-8"))
        print("=" * 76)
        print(f"[{i+1}] Q: {m}")
        print("TOOLS:", "; ".join(f"{t['tool']}({','.join(t['symbols'][:3])})" for t in d.get("tool_summary", [])) or "(none)")
        print("RESP:", (d.get("response") or "").replace(chr(10), " ¶ ")[:750])
    except Exception as e:
        print(f"[{i+1}] Q: {m} -> ERROR: {e}")
