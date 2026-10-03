import io
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image
from api.social_report_images import card_rows, render_report_image, attach_report_images, number, publication_caption, VERSION


def report(kind='stock'):
    records = json.loads(Path('docs/daily-social-reports-live.json').read_text(encoding='utf-8'))['reports']
    row = next(r for r in records if r['kind'] == kind)
    return {**row, 'session_date': row['date'], 'status': 'ready'}


def previous():
    return {'session_date': '2026-09-30', 'symbol': 'CCAP', 'evidence': [
        {'tool': 'get_stock', 'data_time': '2026-09-30', 'data': {'symbol': 'CCAP', 'price': 6.63}}]}


@pytest.mark.parametrize('kind', ['stock', 'accumulation', 'market', 'follow_up'])
def test_templates_are_valid_square_pngs(kind):
    png = render_report_image(report(kind), previous() if kind == 'follow_up' else None)
    image = Image.open(io.BytesIO(png))
    assert image.format == 'PNG' and image.size == (1200, 1200)
    assert len(png) < 5242880


def test_accumulation_uses_filtered_stocks_not_aliases():
    row = report('accumulation')
    row['evidence'][0]['data']['stocks'] = row['evidence'][0]['data']['stocks'][:2]
    _, rows = card_rows(row)
    assert len(rows) == 2
    assert rows[0][-1] == 'GBCO'


def test_unverified_and_stale_reports_fail_closed():
    row = report()
    row['validation'] = {'ok': False}
    with pytest.raises(ValueError): render_report_image(row)
    row = report()
    row['evidence'][0]['data_time'] = '2026-09-30'
    with pytest.raises(ValueError): render_report_image(row)
    with pytest.raises(ValueError): render_report_image(report('follow_up'))
    assert number(float('nan')) == '—'
    assert number(None) == '—'
    assert number(4.425, 'x') == '4.43x'


def test_existing_images_are_not_uploaded_again():
    client = MagicMock()
    row = {**report(), 'image_status': 'ready', 'image_url': f'https://example.com/stock-{VERSION}-a.png', 'social_caption': 'verified caption'}
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = [row]
    assert attach_report_images(client, row['session_date'], 'job') == {'stock': 'cached'}
    client.storage.from_.assert_not_called()


def test_failed_upload_never_marks_image_ready():
    client = MagicMock()
    row = report()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = [row]
    client.storage.from_.return_value.upload.side_effect = RuntimeError('upload failed')
    client.storage.from_.return_value.download.side_effect = RuntimeError('missing')
    assert attach_report_images(client, row['session_date'], 'job') == {'stock': 'failed'}
    assert client.table.return_value.update.call_args.args[0]['image_status'] == 'failed'


def test_caption_contains_title_site_and_relevant_hashtags():
    title, tags, caption = publication_caption(report())
    assert 'CCAP' in title and '1 أكتوبر 2026' in title
    assert '#CCAP' in tags and '#البورصة_المصرية' in tags
    assert 'https://egxbots.com' in caption
    assert 'https://t.me' not in caption


def test_markdown_tables_are_converted_to_readable_points():
    _, _, caption = publication_caption(report('follow_up'))
    assert '|---' not in caption and '| البند' not in caption
    assert '6.63' in caption and '6.88' in caption
