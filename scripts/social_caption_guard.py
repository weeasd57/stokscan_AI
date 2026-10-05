"""Validate platform caption limits without silently truncating financial text."""
import argparse
import json
import sys


def utf16_length(text):
    return len(text.encode('utf-16-le')) // 2


def validate_caption(text, platform, title=''):
    if platform not in ('facebook', 'tiktok'):
        raise ValueError('Unsupported platform')
    # UTF-16 includes both units of emoji; conservative for desktop/API counters.
    count = utf16_length(text)
    title_count = utf16_length(title)
    if not text.strip():
        raise ValueError('Empty caption')
    if platform == 'tiktok':
        if title_count > 90:
            raise ValueError(f'TikTok title exceeds 90 characters: {title_count}')
        if count + title_count > 2000:
            raise ValueError(f'TikTok caption exceeds 2000 characters: {count + title_count}')
    return {'platform': platform, 'characters': count,
            'title_characters': title_count, 'ok': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=('facebook', 'tiktok'), required=True)
    parser.add_argument('--title', default='')
    args = parser.parse_args()
    print(json.dumps(validate_caption(sys.stdin.read(), args.platform, args.title)))
