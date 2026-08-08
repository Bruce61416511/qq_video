"""
??????
?? ffmpeg + ASS ??????? + ?? + ?????????
"""
import os
import subprocess
import uuid
from pathlib import Path
from ..config import UPLOAD_DIR


async def compose_video(
    clips: list[dict],
    output_path: str = None,
    size: str = "9:16",
    resolution: str = "1080P",
) -> dict:
    if not clips:
        return {"ok": False, "error": "??????"}
    if output_path is None:
        output_path = str(UPLOAD_DIR / f"composed_{uuid.uuid4().hex}.mp4")
    if len(clips) == 1 and clips[0].get("video_path") and os.path.exists(clips[0]["video_path"]):
        return await _merge_single(clips[0], output_path, size, resolution)
    return await _concat_clips(clips, output_path, size, resolution)


def _generate_ass(clips: list[dict]):
    """Generate ASS subtitle file. Returns path or None."""
    has_any = any(c.get("subtitle", "").strip() for c in clips)
    if not has_any:
        return None
    ass_path = str(UPLOAD_DIR / f"sub_{uuid.uuid4().hex}.ass")
    lines = [
        "[Script Info]",
        "Title: Subtitles",
        "ScriptType: v4.00+",
        "PlayDepth: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,SimHei,28,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,4,2,2,10,10,80,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    cumulative = 0.0
    for c in clips:
        sub_text = c.get("subtitle", "").strip()
        dur = float(c.get("duration", 5))
        if sub_text:
            start = _ass_time(cumulative)
            end = _ass_time(cumulative + dur)
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{sub_text}")
        cumulative += dur

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return ass_path


def _ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

async def _merge_single(clip: dict, output_path: str, size: str, resolution: str) -> dict:
    video_path = clip.get("video_path", "")
    audio_path = clip.get("audio_path", "")
    if not video_path or not os.path.exists(video_path):
        return {"ok": False, "error": f"???????: {video_path}"}
    ass_file = _generate_ass([clip])
    vf_parts = [_scale_filter(size, resolution), "setsar=1"]
    inputs = ["-i", video_path]
    if audio_path and os.path.exists(audio_path):
        inputs += ["-i", audio_path]
    filter_complex = []
    filter_complex.append(f"[0:v]{",".join(vf_parts)}[vout]")
    if audio_path and os.path.exists(audio_path):
        filter_complex.append("[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[aout]")
        audio_map = ["-map", "[aout]"]
    else:
        audio_map = ["-map", "0:a?"]
    if ass_file:
        ass_path_fixed = ass_file.replace("\\", "/")
        ass_escaped = ass_path_fixed.replace(":", "\\:")
        filter_complex.append(f"[vout]ass=filename='{ass_escaped}'[vfinal]")
        video_out = "[vfinal]"
    else:
        video_out = "[vout]"
    filter_str = ";".join(filter_complex)
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_str, "-map", video_out, *audio_map, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", output_path]
    return await _run_ffmpeg(cmd, output_path)

async def _concat_clips(clips: list[dict], output_path: str, size: str, resolution: str) -> dict:
    valid_clips = [c for c in clips if c.get("video_path") and os.path.exists(c.get("video_path", ""))]
    if not valid_clips:
        return {"ok": False, "error": "?????????"}
    try:
        ass_file = _generate_ass(valid_clips)
        cmd = ["ffmpeg", "-y"]
        filter_parts = []
        v_indices = []
        a_indices = []
        has_audio = False
        scale = _scale_filter(size, resolution)
        for i, c in enumerate(valid_clips):
            vi = len([x for x in cmd if x == "-i"])
            cmd.extend(["-i", c["video_path"]])
            v_indices.append(vi)
            vf = f"[{vi}:v]{scale},setsar=1"
            filter_parts.append(f"{vf}[v{vi}]")
            audio_path = c.get("audio_path", "")
            if audio_path and os.path.exists(audio_path):
                ai = len([x for x in cmd if x == "-i"])
                cmd.extend(["-i", audio_path])
                a_indices.append(ai)
                filter_parts.append(f"[{ai}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a{ai}]")
                has_audio = True
            else:
                filter_parts.append(f"[{vi}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a{vi}]")
                a_indices.append(vi)
                has_audio = True
        n = len(v_indices)
        v_concat = "".join(f"[v{vi}]" for vi in v_indices)
        filter_parts.append(f"{v_concat}concat=n={n}:v=1:a=0[vout]")
        if has_audio:
            a_labels = [f"[a{ai}]" for ai in a_indices]
        else:
            a_labels = [f"[anull{vi}]" for vi in v_indices]
        a_concat = "".join(a_labels)
        filter_parts.append(f"{a_concat}concat=n={n}:v=0:a=1[aout]")
        if ass_file:
            ass_path_fixed = ass_file.replace("\\", "/")
            ass_escaped = ass_path_fixed.replace(":", "\\:")
            filter_parts.append(f"[vout]ass=filename='{ass_escaped}'[vfinal]")
            video_out = "[vfinal]"
        else:
            video_out = "[vout]"
        cmd.extend(["-filter_complex", ";".join(filter_parts)])
        cmd.extend(["-map", video_out, "-map", "[aout]"])
        cmd.extend(["-c:v", "libx264", "-preset", "fast", "-crf", "23"])
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])
        cmd.extend(["-shortest", "-movflags", "+faststart", output_path])
        return await _run_ffmpeg(cmd, output_path)
    except Exception as e:
        return {"ok": False, "error": str(e)}

async def _run_ffmpeg(cmd: list, output_path: str) -> dict:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        if proc.returncode != 0:
            print(f"[Composer] ffmpeg error: {proc.stderr[-800:]}")
            return {"ok": False, "error": f"ffmpeg failed: {proc.stderr[-300:]}"}
        if os.path.exists(output_path):
            import json
            probe = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", output_path], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)
            duration = 0
            if probe.returncode == 0:
                info = json.loads(probe.stdout)
                duration = round(float(info.get("format", {}).get("duration", 0)))
            return {"ok": True, "path": output_path, "duration": duration}
        else:
            return {"ok": False, "error": "???????"}
    except FileNotFoundError:
        return {"ok": False, "error": "ffmpeg ???????? ffmpeg"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _scale_filter(size: str, resolution: str) -> str:
    targets = {
        ("9:16", "1080P"): "scale=1080:1920",
        ("9:16", "720P"): "scale=720:1280",
        ("16:9", "1080P"): "scale=1920:1080",
        ("16:9", "720P"): "scale=1280:720",
        ("1:1", "1080P"): "scale=1080:1080",
        ("1:1", "720P"): "scale=720:720",
    }
    return targets.get((size, resolution), "scale=1080:1920")