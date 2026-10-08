"""Render one reusable vertical reel from the saved report and approved intro.

No LLM, provider or publication calls. Both networks share the same MP4.
Install the desktop dependency once: pip install imageio-ffmpeg==0.6.0
"""
import hashlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

INTRO = Path(__file__).resolve().parents[1] / 'api/assets/social/logo-intro-vertical.mp4'
INTRO_SECONDS = 5
REPORT_SECONDS = 18
MAX_VIDEO_BYTES = 25 * 1024 * 1024


def ffmpeg_executable():
    installed = shutil.which('ffmpeg')
    if installed:
        return installed
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise RuntimeError('Install imageio-ffmpeg==0.6.0 on the publishing desktop') from error


def render_command(executable, intro, report, output):
    filters = (
        '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,'
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x050816,setsar=1,fps=30,'
        f'trim=duration={INTRO_SECONDS},setpts=PTS-STARTPTS[v0];'
        '[1:v]scale=1000:1000:force_original_aspect_ratio=decrease,'
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x050816,setsar=1,fps=30,'
        f'trim=duration={REPORT_SECONDS},setpts=PTS-STARTPTS[v1];'
        '[0:a]aformat=sample_rates=48000:channel_layouts=stereo,'
        f'apad,atrim=duration={INTRO_SECONDS},asetpts=PTS-STARTPTS[a0];'
        f'[2:a]atrim=duration={REPORT_SECONDS},asetpts=PTS-STARTPTS[a1];'
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]'
    )
    return [executable, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', str(intro), '-loop', '1', '-i', str(report),
            '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
            '-filter_complex_threads', '1', '-filter_complex', filters,
            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast',
            '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
            '-t', str(INTRO_SECONDS + REPORT_SECONDS), str(output)]


def prepare_reel(report_path, *, intro_path=INTRO):
    report, intro = Path(report_path), Path(intro_path)
    if not intro.is_file():
        raise ValueError('Approved logo intro is missing; do not publish an image fallback')
    fingerprint = hashlib.sha256(report.read_bytes() + intro.read_bytes()
                                + b'egxbots-reel-v1-1080x1920-30fps-5s-18s').hexdigest()
    folder = Path(tempfile.gettempdir()) / 'egxbots-social-reels'
    folder.mkdir(exist_ok=True)
    output = folder / f'{fingerprint}.mp4'
    if not output.exists():
        executable = ffmpeg_executable()
        with tempfile.TemporaryDirectory(prefix='egxbots-reel-render-') as working:
            partial = Path(working) / 'reel.mp4'
            result = subprocess.run(render_command(executable, intro, report, partial),
                                    capture_output=True, text=True, timeout=120)
            if result.returncode:
                raise RuntimeError('Reel rendering failed: ' + result.stderr[-600:])
            validate_video(partial)
            os.replace(partial, output)
    validate_video(output)
    return {'path': str(output.resolve()), 'mime': 'video/mp4', 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'width': 1080, 'height': 1920, 'duration_seconds': 23,
            'intro_seconds': INTRO_SECONDS, 'format': 'reel'}


def validate_video(path):
    if not 0 < path.stat().st_size <= MAX_VIDEO_BYTES:
        raise ValueError('Invalid or oversized reel')
    with path.open('rb') as stream:
        if stream.read(12)[4:8] != b'ftyp':
            raise ValueError('Expected an actual MP4 reel')
