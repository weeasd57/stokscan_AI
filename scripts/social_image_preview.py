"""Render actual saved LLM evidence locally; optional service-only image upload."""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from api.social_report_images import render_report_image, attach_report_images


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--upload-date')
    args = parser.parse_args()
    if args.upload_date:
        from dotenv import load_dotenv
        from supabase import create_client
        load_dotenv(ROOT / '.env')
        load_dotenv(ROOT / 'web' / '.env.local', override=True)
        client = create_client(os.getenv('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL'],
                               os.environ['SUPABASE_SERVICE_ROLE_KEY'])
        rows = client.table('daily_social_reports').select('job_run_id').eq('session_date', args.upload_date).limit(1).execute().data
        if not rows: raise ValueError('No reports for requested date')
        print(attach_report_images(client, args.upload_date, rows[0]['job_run_id']))
        return
    reports = json.loads((ROOT / 'docs/daily-social-reports-live.json').read_text(encoding='utf-8'))['reports']
    output = ROOT / 'docs' / 'social-preview'
    output.mkdir(exist_ok=True)
    # Historical close verified by the original live test. Missing indicators stay missing.
    previous = {'session_date': '2026-09-30', 'symbol': 'CCAP', 'evidence': [
        {'tool': 'get_stock', 'data_time': '2026-09-30', 'data': {'symbol': 'CCAP', 'price': 6.63}}]}
    for record in reports:
        report = {**record, 'session_date': record['date'], 'status': 'ready'}
        png = render_report_image(report, previous if report['kind'] == 'follow_up' else None)
        path = output / (report['kind'] + '.png')
        path.write_bytes(png)
        print(str(path))


if __name__ == '__main__':
    main()
