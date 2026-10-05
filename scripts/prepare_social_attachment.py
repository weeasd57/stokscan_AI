"""Copy one verified, immutable report PNG for the desktop mediaFiles connector.

No LLM calls, no image generation, no publishing and no database writes.
"""
import argparse
import hashlib
import io
import json
import tempfile
import urllib.request
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from PIL import Image

HOST = 'gfcmaxbtscmizsakarvc.supabase.co'
MAX_BYTES = 5 * 1024 * 1024


def validate_url(url, session_date):
    date.fromisoformat(session_date)
    parsed = urlsplit(url)
    prefix = f'/storage/v1/object/public/social-reports/{session_date}/'
    if (parsed.scheme != 'https' or parsed.netloc != HOST or parsed.username
            or not parsed.path.startswith(prefix) or not parsed.path.endswith('.png')
            or parsed.query or parsed.fragment or '..' in parsed.path):
        raise ValueError('Not an immutable report image for the requested session')
    return urlunsplit(parsed)


def prepare_attachment(url, session_date, opener=None, *, platform='facebook'):
    if platform not in ('facebook', 'tiktok'):
        raise ValueError('Unsupported platform')
    url = validate_url(url, session_date)
    with (opener or urllib.request.urlopen)(url, timeout=25) as response:
        if response.headers.get('Content-Type', '').split(';')[0] != 'image/png':
            raise ValueError('Expected image/png')
        if response.geturl() != url:
            raise ValueError('Unexpected media redirect')
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid or oversized PNG')
    with Image.open(io.BytesIO(data)) as image:
        if image.format != 'PNG' or image.size != (1200, 1200):
            raise ValueError('Unexpected report dimensions')
        image.verify()
    if platform == 'tiktok':
        with Image.open(io.BytesIO(data)) as image:
            rgba = image.convert('RGBA')
            background = Image.new('RGBA', image.size, '#050816')
            background.alpha_composite(rgba)
            buffer = io.BytesIO()
            background.convert('RGB').resize((1080, 1080), Image.Resampling.LANCZOS).save(buffer, format='JPEG', quality=95,
                                           subsampling=0, optimize=True)
            data = buffer.getvalue()
        if len(data) > MAX_BYTES:
            raise ValueError('Oversized JPEG')
        with Image.open(io.BytesIO(data)) as image:
            if image.format != 'JPEG' or image.mode != 'RGB' or image.size != (1080, 1080):
                raise ValueError('Invalid TikTok JPEG')
            image.verify()
    mime = 'image/jpeg' if platform == 'tiktok' else 'image/png'
    extension = 'jpg' if platform == 'tiktok' else 'png'
    folder = Path(tempfile.mkdtemp(prefix='egxbots-social-'))
    output = folder / f'{session_date}-report.{extension}'
    output.write_bytes(data)
    return {'path': str(output.resolve()), 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data), 'session_date': session_date, 'mime': mime,
            'platform': platform, 'width': 1080 if platform == 'tiktok' else 1200,
            'height': 1080 if platform == 'tiktok' else 1200}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--date', required=True)
    parser.add_argument('--platform', choices=('facebook', 'tiktok'), default='facebook')
    args = parser.parse_args()
    print(json.dumps(prepare_attachment(args.url, args.date, platform=args.platform)))


if __name__ == '__main__':
    main()
