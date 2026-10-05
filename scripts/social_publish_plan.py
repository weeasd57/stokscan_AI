"""Prepare verified report payloads; no generation, reservation or publishing.

Input: JSON {session_date, reports, jobs}. Output: a two-platform plan. The
publisher MUST atomically reserve it via reserve_daily_social_publications first.
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from scripts.prepare_social_attachment import validate_url
from scripts.social_caption_guard import utf16_length, validate_caption

CAIRO = ZoneInfo('Africa/Cairo')
DISCLAIMER = 'تحليل تعليمي — ليس توصية شراء أو بيع.'
SAFETY = re.compile(r'المخاطر|السيناريو|الخلاصة|⚠')


def platform_caption(report, platform):
    title = report['social_title'].strip()
    original = report['social_caption'].replace('\\n', '\n').strip()
    link = ('https://egxbots.com?utm_source=' + platform
            + '&utm_medium=social&utm_campaign=daily_reports'
            + '&utm_content=' + report['kind'])
    full = re.sub(r'https://egxbots\.com(?:\?[^\s]*)?/?', link, original)
    if platform == 'facebook':
        validate_caption(full, platform)
        return full
    full = ' '.join(full.split())  # Metricool photo API does not support line breaks.
    if utf16_length(full) + utf16_length(title) <= 1800:
        validate_caption(full, platform, title)
        return full

    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', original) if p.strip()]
    body = [p for p in paragraphs if p != title and not p.startswith('#')
            and 'https://' not in p and p != DISCLAIMER
            and not p.startswith('✅')]
    if not body or not any(SAFETY.search(p) for p in body):
        raise ValueError('Long caption requires explicit risks/scenarios; editorial review needed')
    required = {0} | {i for i, p in enumerate(body) if SAFETY.search(p)}
    tags = ' '.join(report.get('social_hashtags') or ['#EGXBOTS', '#البورصة_المصرية'])
    prefix = f'ملخص {title}. التحليل الكامل على الموقع.'

    def render(indices):
        return ' '.join((' '.join([prefix] + [body[i] for i in sorted(indices)]
                                  + [DISCLAIMER, link, tags])).split())

    selected = set(required)
    summary = render(selected)
    # Preserve complete facts/risk paragraphs. Fail instead of truncating a sentence.
    validate_caption(summary, platform, title)
    for i in range(len(body)):
        candidate = render(selected | {i})
        if utf16_length(candidate) + utf16_length(title) <= 1800:
            selected.add(i)
    summary = render(selected)
    validate_caption(summary, platform, title)
    return summary


def build_plan(session_date, reports, jobs, now=None):
    day = date.fromisoformat(session_date)
    now = (now or datetime.now(CAIRO)).astimezone(CAIRO)
    if day != now.date() or day.weekday() not in (0, 2):
        raise ValueError('Only the current Monday/Wednesday session may be scheduled')
    completed = {str(j['id']) for j in jobs if j.get('job_type') == 'daily_bot'
                 and j.get('status') == 'completed'
                 and j.get('completed_at')
                 and datetime.fromisoformat(j['completed_at'].replace('Z', '+00:00')).astimezone(CAIRO).date() == day}
    ready = {}
    for r in reports:
        if (r.get('session_date') == session_date and r.get('status') == 'ready'
                and r.get('image_status') == 'ready' and (r.get('validation') or {}).get('ok') is True
                and str(r.get('job_run_id')) in completed and '-v4-' in (r.get('image_url') or '')
                and r.get('social_caption') and r.get('social_title')):
            validate_url(r['image_url'], session_date)
            ready[r['kind']] = r
    order = ('market', 'stock', 'accumulation', 'follow_up') if day.weekday() == 0 else ('stock', 'market', 'accumulation', 'follow_up')
    report = next((ready[k] for k in order if k in ready), None)
    if report is None:
        raise ValueError('No verified image/report from a completed current-session job')
    tiktok_at = max(datetime.combine(day, time(18, 45), CAIRO), now + timedelta(minutes=10))
    if tiktok_at.date() != day:
        raise ValueError('Too late for this session; do not publish a historical report')
    facebook_at = datetime.combine(day + timedelta(days=1), time(10), CAIRO)
    posts = []
    for platform, at in [('tiktok', tiktok_at), ('facebook', facebook_at)]:
        text = platform_caption(report, platform)
        info = {'publicationDate': {'dateTime': at.strftime('%Y-%m-%dT%H:%M:%S'),
                                    'timezone': 'Africa/Cairo'},
                'text': text, 'providers': [{'network': platform}],
                'autoPublish': True, 'draft': False, 'saveExternalMediaFiles': True}
        if platform == 'tiktok':
            info['tiktokData'] = {'title': report['social_title']}
        posts.append({'platform': platform, 'date': at.isoformat(), 'info': info,
                      'image_url': report['image_url'],
                      'caption_check': validate_caption(text, platform, report['social_title'] if platform == 'tiktok' else '')})
    return {'session_date': session_date, 'kind': report['kind'], 'job_run_id': report['job_run_id'],
            'reservation': {'p_session_date': session_date, 'p_kind': report['kind'],
                            'p_tiktok_at': tiktok_at.isoformat()}, 'posts': posts}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', help='JSON file; stdin when omitted')
    args = parser.parse_args()
    with open(args.input, encoding='utf-8') if args.input else sys.stdin as stream:
        data = json.load(stream)
    print(json.dumps(build_plan(data['session_date'], data['reports'], data['jobs']), ensure_ascii=False))
