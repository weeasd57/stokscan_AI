"""Brand-consistent, evidence-only daily cards. No image-generation API calls."""
import hashlib
import io
import math
import re
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from datetime import datetime, timezone

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).parent / 'assets' / 'social'
TITLES = {'stock': 'تحليل سهم', 'accumulation': 'تقرير إشارات التجميع',
          'market': 'وضع السوق المصري', 'follow_up': 'متابعة التحليل السابق'}
GOLD, WHITE, BG = '#f59e0b', '#f8fafc', '#050816'
VERSION = 'v4'
RESHAPER = arabic_reshaper.ArabicReshaper(configuration={'use_unshaped_instead_of_isolated': True})
MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']


def session_label(date):
    day = datetime.strptime(date, '%Y-%m-%d')
    return f'{day.day} {MONTHS[day.month-1]} {day.year}'


def publication_caption(report):
    title = TITLES[report['kind']] + (' | ' + report['symbol'] if report.get('symbol') else '')
    title += ' — جلسة ' + session_label(report['session_date'])
    body = re.sub(r'https?://\S+', '', report.get('content') or '')
    body = re.sub(r'[*`#>]', '', body).strip()
    lines, headers = [], None
    for line in body.splitlines():
        if line.strip().startswith('|'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if all(re.fullmatch(r'[:\- ]+', c or '-') for c in cells): continue
            if headers is None:
                headers = cells
                continue
            lines.append('• ' + cells[0] + ': ' + '؛ '.join(
                f'{headers[i]}: {c}' for i, c in enumerate(cells[1:], 1) if i < len(headers)))
        else:
            headers = None
            lines.append(line)
    body = '\n'.join(lines).strip()
    tags = ['#EGXBOTS', '#البورصة_المصرية', '#تحليل_فني']
    tags.append({'stock':'#تحليل_الأسهم','accumulation':'#تجميع_الأسهم','market':'#EGX','follow_up':'#متابعة_الأسهم'}[report['kind']])
    if report.get('symbol'): tags.append('#' + report['symbol'])
    caption = title + '\n\n' + body + '\n\nتحليل تعليمي — ليس توصية شراء أو بيع.\nhttps://egxbots.com\n\n' + ' '.join(tags)
    # Never silently truncate facts to meet a platform limit.
    if len(caption) > 3800: raise ValueError('Caption needs editorial shortening')
    return title, tags, caption


def number(value, suffix=''):
    try:
        n = float(value)
        if not math.isfinite(n): raise ValueError()
        rounded = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return f'{rounded:,.2f}'.rstrip('0').rstrip('.') + suffix
    except (ValueError, TypeError):
        return '—'


def evidence_data(report, tool):
    for item in report.get('evidence') or []:
        if item.get('tool') == tool:
            if item.get('error') or str(item.get('data_time', ''))[:10] != report['session_date']:
                raise ValueError('Evidence date mismatch')
            return item.get('data') or {}
    raise ValueError('Required evidence missing')


def card_rows(report, previous=None):
    if report.get('status') != 'ready' or not (report.get('validation') or {}).get('ok'):
        raise ValueError('Unverified report')
    kind = report['kind']
    if kind == 'accumulation':
        data = evidence_data(report, 'get_accumulation_stocks')
        stocks = data.get('stocks') or []
        if any(s.get('scan_date') != report['session_date'] for s in stocks):
            raise ValueError('Stale scan')
        return ['أيام التجميع', 'الحجم النسبي', 'درجة التجميع', 'السهم'], [
            [str(s.get('consecutive_acc_days', '—')), number(s.get('vol_ratio'), 'x'),
             number(s.get('acc_score'), '/100'), s['symbol']]
            for s in sorted(stocks, key=lambda s: float(s.get('acc_score') or 0), reverse=True)[:5]]
    if kind == 'market':
        d = evidence_data(report, 'get_market')
        dates = d.get('component_dates') or {}
        if any(dates.get(k) != report['session_date'] for k in ('egx30', 'egx100')):
            raise ValueError('Stale indices')
        return ['التغير اليومي', 'الإغلاق', 'المؤشر'], [
            [number(d.get(k + '_change_pct'), '%'), number(d.get(k)), k.upper()]
            for k in ('egx30', 'egx100')]
    d = evidence_data(report, 'get_stock')
    if d.get('symbol') != report.get('symbol'): raise ValueError('Symbol mismatch')
    if kind == 'follow_up':
        if not previous or previous['session_date'] >= report['session_date'] or previous.get('symbol') != report['symbol']:
            raise ValueError('Matching previous report required')
        p = evidence_data(previous, 'get_stock')
        return ['الجلسة الحالية', 'الجلسة السابقة', 'المقياس'], [
            [number(d.get(key)), number(p.get(key)), label]
            for key, label in [('price', 'الإغلاق'), ('rsi_14_num', 'RSI 14'), ('vol_ratio_num', 'الحجم النسبي')]]
    levels = evidence_data(report, 'get_stock_levels')
    return ['القيمة', 'المقياس'], [
        [number(d.get('price')), 'الإغلاق'], [number(d.get('change_pct_num'), '%'), 'التغير اليومي'],
        [number(d.get('rsi_14_num')), 'RSI 14'], [number(d.get('vol_ratio_num'), 'x'), 'الحجم النسبي'],
        [number(levels.get('support')), 'الدعم'], [number(levels.get('resistance')), 'المقاومة']]


def render_report_image(report, previous=None):
    headings, rows = card_rows(report, previous)
    image = Image.new('RGB', (1200, 1200), BG)
    draw = ImageDraw.Draw(image)

    # Branded diagonal accents, deliberately kept behind the content.
    for x in (-180, 1060):
        draw.polygon([(x, 0),(x+90,0),(x+450,420),(x+360,420)], fill='#0b2035')
        draw.polygon([(x-60,180),(x-25,180),(x+400,620),(x+365,620)], fill='#382a13')
        draw.polygon([(x,1200),(x+70,1200),(x+460,760),(x+390,760)], fill='#0b2035')

    def text(value, x, y, size=32, color=WHITE, width=1040):
        shaped = get_display(RESHAPER.reshape(str(value)))
        font = ImageFont.truetype(str(ASSETS / 'Cairo.ttf'), size, layout_engine=ImageFont.Layout.BASIC)
        font.set_variation_by_axes([900, 0])
        while draw.textlength(shaped, font=font) > width and size > 18:
            size -= 1
            font = ImageFont.truetype(str(ASSETS / 'Cairo.ttf'), size, layout_engine=ImageFont.Layout.BASIC)
            font.set_variation_by_axes([900, 0])
        draw.text((x, y), shaped, font=font, fill=color, anchor='mt')

    def box(x, y, w, h):
        draw.rounded_rectangle((x+9, y+9, x+w+9, y+h+9), radius=14, fill=GOLD)
        draw.rounded_rectangle((x, y, x+w, y+h), radius=14, fill='#061323', outline=WHITE, width=5)

    logo = Image.open(ASSETS / 'logo.png').convert('RGBA')
    logo.thumbnail((140, 140))
    image.paste(logo, (285, 12), logo)
    text('EGX', 545, 27, 86, WHITE, 210)
    text('BOTS', 810, 27, 86, GOLD, 315)
    title = TITLES[report['kind']]
    if report.get('symbol') and report['kind'] in ('stock', 'follow_up'):
        title += ' | ' + report['symbol']
    text(title, 600, 155, 69, WHITE)
    text('جلسة ' + session_label(report['session_date']), 600, 249, 36)
    subtitle = 'عينة من الأسهم مرتفعة السيولة' if report['kind'] == 'accumulation' else 'بيانات الإغلاق اليومية الموثقة'
    text(subtitle, 600, 305, 32)
    box(35, 365, 1130, 425)
    columns = len(headings)
    for i, heading in enumerate(headings):
        text(heading, 45+(i+.5)*1110/columns, 385, 32, WHITE, 1110/columns-24)
    height = 335/max(len(rows), 1)
    for j, row in enumerate(rows):
        top = 443+j*height
        highlight = report['kind'] == 'accumulation' and j < 2
        if highlight: draw.rectangle((45, top, 1155, top+height), fill=GOLD)
        draw.line((45, top, 1155, top), fill=WHITE, width=2)
        for i, value in enumerate(row):
            text(value, 45+(i+.5)*1110/columns, top+10, 39,
                 BG if highlight else WHITE, 1110/columns-24)
    for i in range(1, columns):
        x = 45+i*1110/columns
        draw.line((x, 375, x, 778), fill=WHITE, width=2)
    if not rows: text('لا توجد نتائج مطابقة في العينة', 600, 550, 34)
    box(35, 820, 550, 128)
    box(610, 820, 555, 128)
    left_title, left_value = 'بيانات موثقة', 'قراءة إغلاق وليست سعراً لحظياً'
    right_title, right_value = 'التحليل الكامل', 'متاح على الموقع مع الأدلة والمخاطر'
    if report['kind'] == 'accumulation' and rows:
        stocks = evidence_data(report, 'get_accumulation_stocks')['stocks']
        best_score = max(float(s.get('acc_score') or 0) for s in stocks)
        longest_days = max(int(s.get('consecutive_acc_days') or 0) for s in stocks)
        best = ' و '.join(s['symbol'] for s in stocks if float(s.get('acc_score') or 0) == best_score)
        longest = ' و '.join(s['symbol'] for s in stocks if int(s.get('consecutive_acc_days') or 0) == longest_days)
        right_title, right_value = 'الأبرز في العينة', best + ' : ' + number(best_score, '/100')
        left_title, left_value = 'استمرارية الرصد', longest + ' : ' + str(longest_days) + ' جلسات'
    elif report['kind'] == 'stock':
        d = evidence_data(report, 'get_stock')
        left_title, left_value = 'المرحلة المرصودة', 'محايدة؛ ليست إشارة تجميع' if d.get('wyckoff_phase') == 'neutral' else 'راجع أدلة الاتجاه في التقرير'
    elif report['kind'] == 'follow_up':
        left_title, left_value = 'جلسة المقارنة', session_label(previous['session_date'])
    for x, heading, value in [(310,left_title,left_value),(890,right_title,right_value)]:
        text(heading, x, 829, 34, GOLD, 505)
        text(value, x, 883, 29, WHITE, 505)
    box(40, 981, 1120, 87)
    text('الحجم المرتفع وحده لا يثبت دخول سيولة مؤسسية', 600, 991, 38, GOLD)
    detail = 'العينة لا تمثل السوق كله؛ درجة التجميع ليست احتمال ربح'
    if report['kind'] == 'stock':
        detail = 'الإشارات للمراقبة وليست ضماناً لاتجاه السعر'
    elif report['kind'] == 'follow_up': detail = 'المقارنة بين الإغلاقات لا تثبت اختراقاً وحدها'
    elif report['kind'] == 'market': detail = 'تغير المؤشرات اليومي لا يعبّر وحده عن اتساع السوق'
    text(detail, 600, 1080, 24)
    text('egxbots.com', 600, 1122, 34, GOLD)
    text('تحليل تعليمي — ليس توصية شراء أو بيع', 600, 1170, 19)
    output = io.BytesIO()
    image.save(output, format='PNG', optimize=True)
    return output.getvalue()


def attach_report_images(client, date, job_run_id):
    reports = client.table('daily_social_reports').select('*').eq('session_date', date).eq('job_run_id', job_run_id).eq('status', 'ready').execute().data
    results = {}
    for report in reports:
        kind = report['kind']
        if report.get('image_status') == 'ready' and f'-{VERSION}-' in (report.get('image_url') or '') and report.get('social_caption'):
            results[kind] = 'cached'
            continue
        query = client.table('daily_social_reports').update
        try:
            previous = None
            if kind == 'follow_up':
                prior = client.table('daily_social_reports').select('*').eq('kind', 'stock').eq('status', 'ready').eq('symbol', report['symbol']).lt('session_date', date).order('session_date', desc=True).limit(1).execute().data
                previous = prior[0] if prior else None
            png = render_report_image(report, previous)
            title, tags, caption = publication_caption(report)
            path = f'{date}/{kind}-{VERSION}-{hashlib.sha256(png).hexdigest()[:16]}.png'
            bucket = client.storage.from_('social-reports')
            # Immutable content-addressed path; an interrupted DB write is safe to reconcile.
            try:
                bucket.upload(path, png, {'content-type': 'image/png', 'cache-control': '31536000', 'upsert': 'false'})
            except Exception:
                if bucket.download(path) != png: raise
            url = bucket.get_public_url(path)
            query({'image_status': 'ready', 'image_url': url, 'image_error': None,
                   'social_title': title, 'social_hashtags': tags, 'social_caption': caption,
                   'updated_at': datetime.now(timezone.utc).isoformat()}).eq('session_date', date).eq('kind', kind).eq('job_run_id', job_run_id).execute()
            results[kind] = 'ready'
        except Exception as error:
            query({'image_status': 'failed', 'image_error': type(error).__name__, 'image_url': None}).eq('session_date', date).eq('kind', kind).eq('job_run_id', job_run_id).execute()
            results[kind] = 'failed'
    return results
