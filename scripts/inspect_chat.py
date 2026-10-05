import json
import sys

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    def load_json(path):
        for enc in ['utf-8-sig', 'utf-16', 'utf-8']:
            try:
                with open(path, 'r', encoding=enc) as f:
                    return json.load(f)
            except Exception:
                pass
        raise RuntimeError(f"Could not load {path}")

    msgs = load_json('dump_messages.json')
    analytics = load_json('dump_analytics.json')

    print(f"Total messages: {len(msgs)}")
    print(f"Total analytics records: {len(analytics)}")
    print("=" * 80)

    for i, m in enumerate(msgs):
        role = m.get('role')
        content = m.get('content', '')
        meta = m.get('metadata') or {}
        created = m.get('created_at')
        sid = m.get('session_id')
        mid = m.get('id')
        print(f"\n--- [{i+1}] ID: {mid} | Date: {created} | Role: {role} | Session: {sid} ---")
        if role == 'user':
            print(f"QUERY: {content}")
        else:
            print(f"RESPONSE:\n{content}")
            print(f"METADATA:")
            print(f"  response_origin: {meta.get('response_origin')}")
            print(f"  response_task: {meta.get('response_task')}")
            print(f"  tools: {meta.get('tools') or meta.get('tools_used')}")
            print(f"  publication_review: {json.dumps(meta.get('publication_review'), ensure_ascii=False)}")
            if meta.get('plan'):
                print(f"  plan: intent={meta['plan'].get('intent')}, tools={meta['plan'].get('tools')}, symbols={meta['plan'].get('entities', {}).get('symbols')}")

        matching_analytics = [a for a in analytics if a.get('message_id') == mid or (role == 'assistant' and a.get('session_id') == sid and abs((len(a.get('response_text') or '') - len(content))) < 10)]
        if matching_analytics:
            for a in matching_analytics:
                print(f"  ANALYTICS: intent={a.get('intent')}, symbols={a.get('symbols')}, elapsed_ms={a.get('response_time_ms')}, verified={a.get('verification_passed')}")

if __name__ == '__main__':
    main()
