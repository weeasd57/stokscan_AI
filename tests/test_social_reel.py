from pathlib import Path
from types import SimpleNamespace
import pytest
from scripts import prepare_social_reel as reels


def test_render_has_intro_audio_and_complete_uncropped_report():
    command = reels.render_command('ffmpeg', 'intro.mp4', 'report.png', 'out.mp4')
    filters = command[command.index('-filter_complex') + 1]
    assert '[0:a]' in filters and 'anullsrc=r=48000:cl=stereo' in command
    assert 'concat=n=2:v=1:a=1' in filters
    assert 'pad=1080:1920' in filters and 'crop=' not in filters
    assert command[command.index('-t') + 1] == '23'
    assert '+faststart' in command and 'libx264' in command


def test_reel_reused_for_both_platforms(tmp_path, monkeypatch):
    report = tmp_path / 'report.png'; report.write_bytes(b'image-fixture')
    intro = tmp_path / 'intro.mp4'; intro.write_bytes(b'intro-fixture')
    monkeypatch.setattr(reels.tempfile, 'gettempdir', lambda: str(tmp_path))
    monkeypatch.setattr(reels, 'ffmpeg_executable', lambda: 'ffmpeg')
    calls = []
    def render(command, **kwargs):
        calls.append(command)
        Path(command[-1]).write_bytes(b'\x00\x00\x00\x20ftypisom' + b'fixture')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(reels.subprocess, 'run', render)
    first = reels.prepare_reel(report, intro_path=intro)
    second = reels.prepare_reel(report, intro_path=intro)
    assert len(calls) == 1 and first == second
    assert first['mime'] == 'video/mp4'


def test_missing_intro_fails_without_rendering(tmp_path):
    with pytest.raises(ValueError, match='intro is missing'):
        reels.prepare_reel(tmp_path/'report.png', intro_path=tmp_path/'missing.mp4')
