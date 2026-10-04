import pytest
from scripts.social_caption_guard import validate_caption


def test_tiktok_boundary():
    assert validate_caption('ع' * 2000, 'tiktok')['ok']
    with pytest.raises(ValueError, match='exceeds'):
        validate_caption('ع' * 2001, 'tiktok')


def test_emoji_are_counted_conservatively():
    assert validate_caption('📊', 'tiktok')['characters'] == 2
    with pytest.raises(ValueError):
        validate_caption('📊' * 1001, 'tiktok')


def test_facebook_full_report_is_not_truncated():
    assert validate_caption('ع' * 3800, 'facebook')['characters'] == 3800


def test_empty_caption_is_rejected():
    with pytest.raises(ValueError):
        validate_caption(' ', 'tiktok')
