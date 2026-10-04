import io
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image
from scripts.prepare_social_attachment import validate_url, prepare_attachment, MAX_BYTES

URL = 'https://gfcmaxbtscmizsakarvc.supabase.co/storage/v1/object/public/social-reports/2026-10-04/stock-v4-test.png'


def response(data, mime='image/png'):
    fake = MagicMock()
    fake.__enter__.return_value = fake
    fake.headers = {'Content-Type': mime}
    fake.geturl.return_value = URL
    fake.read.return_value = data
    return fake


def test_empty_query_is_stripped_before_download():
    assert validate_url(URL + '?', '2026-10-04') == URL


@pytest.mark.parametrize('url', [URL.replace('https:', 'http:'),
    URL.replace('gfcmaxbtscmizsakarvc.supabase.co', 'example.com'),
    URL.replace('2026-10-04', '2026-10-01'), URL + '?secret=x', URL + '#fragment'])
def test_untrusted_urls_fail_closed(url):
    with pytest.raises(ValueError): validate_url(url, '2026-10-04')


def test_saved_png_is_identical_not_regenerated():
    buffer = io.BytesIO()
    Image.new('RGB', (1200, 1200)).save(buffer, format='PNG')
    original = buffer.getvalue()
    result = prepare_attachment(URL, '2026-10-04', opener=lambda *a, **k: response(original))
    assert Path(result['path']).read_bytes() == original
    assert result['bytes'] == len(original)


def test_invalid_mime_and_oversized_media_are_rejected():
    with pytest.raises(ValueError):
        prepare_attachment(URL, '2026-10-04', opener=lambda *a, **k: response(b'fake', 'text/html'))
    with pytest.raises(ValueError):
        prepare_attachment(URL, '2026-10-04', opener=lambda *a, **k: response(b'x'*(MAX_BYTES+1)))
