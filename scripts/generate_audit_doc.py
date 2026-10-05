import json
import os

def load_json(p):
    for enc in ['utf-8-sig', 'utf-16', 'utf-8']:
        try:
            with open(p, 'r', encoding=enc) as f:
                return json.load(f)
        except Exception:
            pass
    return []

def main():
    msgs = load_json('dump_messages.json')
    analytics = load_json('dump_analytics.json')

    with open('audit_report_clean.txt', 'w', encoding='utf-8') as out:
        out.write(f"Total messages since deploy: {len(msgs)}\n")
        out.write(f"Total analytics records: {len(analytics)}\n\n")

        for i, m in enumerate(msgs):
            mid = m.get('id')
            role = m.get('role')
            content = m.get('content', '')
            created = m.get('created_at')
            sid = m.get('session_id')
            meta = m.get('metadata') or {}

            out.write(f"================================================================================\n")
            out.write(f"MESSAGE #{i+1} | ID: {mid} | Date (UTC): {created} | Role: {role}\n")
            out.write(f"Session ID: {sid}\n")
            out.write(f"================================================================================\n")
            out.write(f"{content}\n\n")
            out.write(f"METADATA:\n")
            out.write(f"  response_origin: {meta.get('response_origin')}\n")
            out.write(f"  response_task: {meta.get('response_task')}\n")
            review = meta.get('publication_review')
            if review:
                out.write(f"  publication_review: passed={review.get('passed')}, final_passed={review.get('final_passed')}, reasons={review.get('reasons')}\n")
            plan = meta.get('plan')
            if plan:
                out.write(f"  plan: intent={plan.get('intent')}, tools={plan.get('tools')}, symbols={plan.get('entities', {}).get('symbols')}\n")
            tools = meta.get('tools') or meta.get('tools_used')
            if tools:
                out.write(f"  tools_used: {tools}\n")
            out.write("\n")

    print("Successfully generated audit_report_clean.txt")

if __name__ == '__main__':
    main()
