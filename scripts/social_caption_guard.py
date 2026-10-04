"""Validate platform caption limits without silently truncating financial text."""
import argparse
import json
import sys


def validate_caption(text, platform):
    if platform not in ('facebook', 'tiktok'):
        raise ValueError('Unsupported platform')
    # UTF-16 includes both units of emoji; conservative for desktop/API counters.
    count = len(text.encode('utf-16-le')) // 2
    if not text.strip():
        raise ValueError('Empty caption')
    if platform == 'tiktok' and count > 2000:
        raise ValueError(f'TikTok caption exceeds 2000 characters: {count}')
    return {'platform': platform, 'characters': count, 'ok': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=('facebook', 'tiktok'), required=True)
    args = parser.parse_args()
    print(json.dumps(validate_caption(sys.stdin.read(), args.platform)))
