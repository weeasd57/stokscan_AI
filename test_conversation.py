# -*- coding: utf-8 -*-
"""Multi-turn conversation tests: session state, inheritance, compound questions."""
import json, sys, urllib.request

URL = "http://localhost:3100/api/test-chat"

SCENARIOS = {
    # A) الوراثة: سؤال سهم ثم متابعات بدون ذكر الاسم — يجب توريث COMI بشكل صحيح
    #    ثم أسئلة سوق عامة/شركة غير معروفة — يجب ألا تورث COMI
    "A_session_inheritance": [
        "حلل سهم كومي",
        "هو نازل كام النهاردة؟",
        "اخباره ايه",
        "دلتا للطباعة رأيكم إيه",
        "هات اسهم التجميع",
        "هات اعلى 5 اسهم هذا الاسبوع",
    ],
    # B) الأسئلة المركبة: أمرين في رسالة واحدة
    "B_compound": [
        "حلل كومي وهات اسهم التجميع",
        "سعر راميدا كام واخبار كومي ايه",
        "ايه اسهم التجميع وترتيب الاسهم بالسيولة هذا الشهر",
    ],
    # C) فهم عام: أسئلة سوق متنوعة بدون سياق سابق
    "C_general": [
        "السوق عامل ايه النهاردة",
        "انهي قطاع سيولته اعلى",
        "ايه اخبار البنوك",
        "اشتري ايه",
        "ايه الفرق بين التجميع والتصريف",
        "هات ارخص 10 اسهم",
    ],
}

def run(name, messages):
    body = json.dumps({"messages": messages}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode("utf-8"))

def main():
    selected = sys.argv[1:] or list(SCENARIOS)
    for name in selected:
        msgs = SCENARIOS[name]
        print("#" * 78)
        print(f"## SCENARIO {name}")
        try:
            data = run(name, msgs)
        except Exception as e:
            print("SCENARIO ERROR:", e)
            continue
        for t in data.get("turns", []):
            print("-" * 78)
            print(f"Q: {t['q']}  ({t['latency_ms']}ms)")
            tools = "; ".join(
                f"{x['tool']}[{x.get('stock_count') if x.get('stock_count') is not None else len(x.get('symbols', []))}]"
                + (f"({','.join(x['symbols'][:4])})" if x.get("symbols") else "")
                for x in t["tools"]
            ) or "(no tools)"
            print(f"TOOLS: {tools}")
            print(f"SESSION: sym={t['session_after']['current_symbol']} last={t['session_after']['last_symbols']} sum={t['session_after']['summary']}")
            resp = (t["response"] or "").replace("\n", " ¶ ")
            print(f"RESP: {resp[:320]}")

if __name__ == "__main__":
    main()
