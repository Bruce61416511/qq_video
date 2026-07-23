"""
视频合成服务
参考 MoneyPrinterTurbo: app/services/video.py
使用 ffmpeg 将视频片段 + 音频 + 字幕合成为最终视频
"""
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from ..config import UPLOAD_DIR


async def compose_video(
    clips: list[dict],
    output_path: str = None,
    size: str = "9:16",
    resolution: str = "1080P",
) -> dict:
    """Compose video from clips array.
    
    Each clip: {
        "video_path": str,   # video file path
        "audio_path": str,   # audio file path
        "subtitle": str,     # subtitle text
        "duration": float,   # duration in seconds
    }
    
    Returns {"ok": True, "path": "...", "duration": ...} or {"ok": False, "error": "..."}
    """
    if not clips:
        return {"ok": False, "error": "没有视频片段"}

    if output_path is None:
        output_path = str(UPLOAD_DIR / f"composed_{uuid.uuid4().hex}.mp4")

    # If only one clip with video+audio, just copy it
    if len(clips) == 1 and clips[0].get("video_path") and os.path.exists(clips[0]["video_path"]):
        # Single clip with audio - use ffmpeg to merge
        return await _merge_single(clips[0], output_path, size, resolution)

    # Multiple clips - concat with ffmpeg
    return await _concat_clips(clips, output_path, size, resolution)


async def _merge_single(clip: dict, output_path: str, size: str, resolution: str) -> dict:
    """Merge single video clip with audio."""
    video_path = clip.get("video_path", "")
    audio_path = clip.get("audio_path", "")
    subtitle = clip.get("subtitle", "")

    if not video_path or not os.path.exists(video_path):
        return {"ok": False, "error": f"视频文件不存在: {video_path}"}

    vf_parts = [_scale_filter(size, resolution)]

    # Build ffmpeg command
    inputs = ["-i", video_path]
    if audio_path and os.path.exists(audio_path):
        inputs += ["-i", audio_path]

    filter_complex = []
    # Video track
    filter_complex.append(f"[0:v]{','.join(vf_parts)}[vout]")

    # Audio
    if audio_path and os.path.exists(audio_path):
        filter_complex.append("[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]")
        audio_map = ["-map", "[aout]"]
    else:
        audio_map = ["-map", "0:a?"]

    # Subtitles
    if subtitle:
        subtitle_filter = _drawtext_filter(subtitle)
        filter_complex.append(f"[vout]{subtitle_filter}[vfinal]")
        video_out = "[vfinal]"
    else:
        video_out = "[vout]"

    filter_str = ";".join(filter_complex)
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-map", video_out,
        *audio_map,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        output_path,
    ]

    return await _run_ffmpeg(cmd, output_path)


async def _concat_clips(clips: list[dict], output_path: str, size: str, resolution: str) -> dict:
    """Concatenate multiple clips with per-clip subtitle + audio overlay."""
    valid_clips = [c for c in clips if c.get("video_path") and os.path.exists(c.get("video_path", ""))]

    if not valid_clips:
        return {"ok": False, "error": "没有有效的视频片段"}

    try:
        cmd = ["ffmpeg", "-y"]
        filter_parts = []
        v_indices = []
        a_indices = []
        has_audio = False

        scale = _scale_filter(size, resolution)

        for i, c in enumerate(valid_clips):
            # Video input
            vi = len([x for x in cmd if x == "-i"])
            cmd.extend(["-i", c["video_path"]])
            v_indices.append(vi)

            # Subtitle text
            sub_text = c.get("subtitle", "").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")
            
            # Scale filter
            vf = f"[{vi}:v]{scale}"
            
            if sub_text:
                # Split long text into 2 lines at natural break point
                text = sub_text
                mid = len(text) // 2
                for sep in ["，", ",", " ", "。", "！"]:
                    idx = text.find(sep, mid - 5)
                    if 15 < idx < len(text) - 5:
                        mid = idx + 1
                        break
                line1 = text[:mid].strip()
                line2 = text[mid:].strip() if mid < len(text) else ""

                if line2:
                    vf += (
                        f",drawtext=text='{line1}':fontcolor=white:fontsize=32:"
                        "box=1:boxcolor=black@0.5:boxborderw=6:"
                        "x=(w-text_w)/2:y=h-th-80,"
                        f"drawtext=text='{line2}':fontcolor=white:fontsize=32:"
                        "box=1:boxcolor=black@0.5:boxborderw=6:"
                        "x=(w-text_w)/2:y=h-th-30"
                    )
                else:
                    vf += (
                        f",drawtext=text='{line1}':fontcolor=white:fontsize=32:"
                        "box=1:boxcolor=black@0.5:boxborderw=6:"
                        "x=(w-text_w)/2:y=h-th-55"
                    )

            filter_parts.append(f"{vf}[v{vi}]")

            # Audio input
            audio_path = c.get("audio_path", "")
            if audio_path and os.path.exists(audio_path):
                ai = len([x for x in cmd if x == "-i"])
                cmd.extend(["-i", audio_path])
                a_indices.append(ai)
                filter_parts.append(
                    f"[{ai}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a{ai}]"
                )
                has_audio = True
            else:
                # Generate silent audio for this clip
                dur = c.get("duration", 5)
                filter_parts.append(f"anullsrc=r=44100:cl=stereo:d={dur}[anull{vi}]")
                a_indices.append(vi)  # virtual index for silent audio

        n = len(v_indices)

        # Concat video
        v_concat = "".join(f"[v{vi}]" for vi in v_indices)
        filter_parts.append(f"{v_concat}concat=n={n}:v=1:a=0[vout]")

        # Concat audio
        if has_audio:
            a_labels = [f"[a{ai}]" for ai in a_indices]
        else:
            a_labels = [f"[anull{vi}]" for vi in v_indices]
        a_concat = "".join(a_labels)
        filter_parts.append(f"{a_concat}concat=n={n}:v=0:a=1[aout]")

        cmd.extend(["-filter_complex", ";".join(filter_parts)])
        cmd.extend(["-map", "[vout]", "-map", "[aout]"])
        cmd.extend(["-c:v", "libx264", "-preset", "fast", "-crf", "23"])
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])
        cmd.extend(["-shortest", "-movflags", "+faststart", output_path])

        return await _run_ffmpeg(cmd, output_path)

    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _run_ffmpeg(cmd: list, output_path: str) -> dict:
    """Run ffmpeg and check result."""
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min timeout
        )
        if proc.returncode != 0:
            print(f"[Composer] ffmpeg error: {proc.stderr[:500]}")
            return {"ok": False, "error": f"ffmpeg failed: {proc.stderr[:200]}"}

        if os.path.exists(output_path):
            import json, re
            # Get duration
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", output_path],
                capture_output=True, text=True, timeout=10,
            )
            duration = 0
            if probe.returncode == 0:
                info = json.loads(probe.stdout)
                duration = round(float(info.get("format", {}).get("duration", 0)))

            return {"ok": True, "path": output_path, "duration": duration}
        else:
            return {"ok": False, "error": "输出文件未生成"}

    except FileNotFoundError:
        return {"ok": False, "error": "ffmpeg 未安装，请先安装 ffmpeg"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _scale_filter(size: str, resolution: str) -> str:
    """Generate scale filter for target size/resolution."""
    targets = {
        ("9:16", "1080P"): "scale=1080:1920",
        ("9:16", "720P"): "scale=720:1280",
        ("16:9", "1080P"): "scale=1920:1080",
        ("16:9", "720P"): "scale=1280:720",
        ("1:1", "1080P"): "scale=1080:1080",
        ("1:1", "720P"): "scale=720:720",
    }
    return targets.get((size, resolution), "scale=1080:1920")


def _drawtext_filter(text: str) -> str:
    """Generate drawtext filter for subtitles."""
    # Escape special chars for ffmpeg
    safe = text.replace(":", "\\:").replace("'", "\\'")
    return (
        f"drawtext=text='{safe}':"
        "fontcolor=white:fontsize=48:"
        "box=1:boxcolor=black@0.5:boxborderw=10:"
        "x=(w-text_w)/2:y=h-th-60"
    )