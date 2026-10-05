from datetime import datetime

import pytest

from scripts.social_publish_plan import build_plan, platform_caption, CAIRO
from scripts.social_caption_guard import validate_caption


def report(day='2026-10-05', kind='market'):
    return dict(session_date=day, kind=kind, job_run_id='job', status='ready',
                image_status='ready', validation={'ok': True},
                image_url=f'https://gfcmaxbtscmizsakarvc.supabase.co/storage/v1/object/public/social-reports/{day}/{kind}-v4-abc.png',
                social_title=f'جلسة {day}', social_caption=f'جلسة {day}\n\nالإغلاق 6.85 وحجم التداول 1.12x.\n\nالمخاطر: الزخم غير مؤكد.\n\nالخلاصة: انتظار التأكيد.\n\nhttps://egxbots.com\n\n#EGXBOTS',
                social_hashtags=['#EGXBOTS'])


def job(day='2026-10-05'):
    return dict(id='job', job_type='daily_bot', status='completed', completed_at=f'{day}T14:30:00Z')


def test_schedule_and_tracking_keep_session_date_on_next_day_facebook():
    result = build_plan('2026-10-05', [report()], [job()], datetime(2026, 10, 5, 18, 30, tzinfo=CAIRO))
    tt, fb = result['posts']
    assert tt['date'] == '2026-10-05T18:45:00+03:00'
    assert fb['date'] == '2026-10-06T10:00:00+03:00'
    assert 'جلسة 2026-10-05' in fb['info']['text']
    assert 'utm_source=tiktok' in tt['info']['text']
    assert '\n' not in tt['info']['text']
    assert 'media' not in tt['info']


def test_wednesday_prefers_stock_and_late_run_gets_one_future_time():
    result = build_plan('2026-10-07', [report('2026-10-07'), report('2026-10-07', 'stock')],
                        [job('2026-10-07')], datetime(2026, 10, 7, 19, tzinfo=CAIRO))
    assert result['kind'] == 'stock'
    assert result['posts'][0]['date'] == '2026-10-07T19:10:00+03:00'


@pytest.mark.parametrize('mutation', [dict(status='generating'), dict(image_status='error'),
    dict(validation={'ok': False}), dict(job_run_id='wrong'), dict(image_url='https://example.com/a-v4-.png')])
def test_unverified_reports_fail_closed(mutation):
    r = report(); r.update(mutation)
    with pytest.raises(ValueError):
        build_plan('2026-10-05', [r], [job()], datetime(2026, 10, 5, 18, tzinfo=CAIRO))


def test_previous_session_unfinished_job_and_unscheduled_day_rejected():
    with pytest.raises(ValueError):
        build_plan('2026-10-05', [report()], [job()], datetime(2026, 10, 6, 18, tzinfo=CAIRO))
    with pytest.raises(ValueError):
        build_plan('2026-10-06', [report('2026-10-06')], [job('2026-10-06')], datetime(2026, 10, 6, 18, tzinfo=CAIRO))
    incomplete = job(); incomplete['status'] = 'running'
    with pytest.raises(ValueError):
        build_plan('2026-10-05', [report()], [incomplete], datetime(2026, 10, 5, 18, tzinfo=CAIRO))


def test_long_caption_keeps_complete_facts_scenarios_risks_and_disclaimer():
    r = report(kind='stock')
    facts = 'الإغلاق 6.85، الدعم 5.65 والمقاومة 7.87 وحجم التداول 1.12x.'
    positive = 'السيناريو الإيجابي: اختراق 7.87 بسيولة داعمة.'
    negative = 'السيناريو السلبي: كسر 5.65 يلغي النظرة الإيجابية.'
    risk = 'المخاطر: الزخم غير مؤكد، ولا يكفي حجم التداول لتأكيد الاتجاه.'
    conclusion = 'الخلاصة: انتظار التأكيد؛ ليست هناك شروط دخول واضحة.'
    r['social_caption'] = '\n\n'.join([r['social_title'], facts, 'تفاصيل إضافية. ' * 220,
                                            positive, negative, risk, conclusion])
    text = platform_caption(r, 'tiktok')
    for fragment in [facts, positive, negative, risk, conclusion, 'ليس توصية شراء أو بيع']:
        assert fragment in text
    assert validate_caption(text, 'tiktok', r['social_title'])['ok']
    assert 'تفاصيل إضافية' not in text
    assert 'تفاصيل إضافية' in platform_caption(r, 'facebook')


def test_oversized_required_risks_rejected_instead_of_truncated():
    r = report(); r['social_caption'] = 'حقائق.\n\nالمخاطر: ' + 'تحذير. ' * 400
    with pytest.raises(ValueError, match='exceeds'):
        platform_caption(r, 'tiktok')


def test_title_and_combined_utf16_limit():
    assert validate_caption('ع' * 1910, 'tiktok', 'ع' * 90)['ok']
    with pytest.raises(ValueError, match='caption'):
        validate_caption('ع' * 1911, 'tiktok', 'ع' * 90)
    with pytest.raises(ValueError, match='title'):
        validate_caption('نص', 'tiktok', '📊' * 46)


def test_cairo_offset_after_dst_and_cross_month_schedule():
    result = build_plan('2026-08-31', [report('2026-08-31')], [job('2026-08-31')],
                        datetime(2026, 8, 31, 18, 30, tzinfo=CAIRO))
    assert result['posts'][1]['date'].startswith('2026-09-01T10:00')
    result = build_plan('2026-11-02', [report('2026-11-02')], [job('2026-11-02')],
                        datetime(2026, 11, 2, 18, 30, tzinfo=CAIRO))
    assert result['posts'][0]['date'].endswith('+02:00')
