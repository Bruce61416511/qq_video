"""
??????
?? ffmpeg + ASS ??????? + ?? + ?????????
"""
import os
import tempfile
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


def _generate_ass(clips: list[dict], durations: list[tuple] = None):
    """Generate ASS subtitle file.
    
    Subtitles are split by fixed character count (default 12 chars/line),
    displayed at normal Chinese speaking speed (~4.5 chars/s).
    If subtitles run shorter than the video clip, a gap is left (no stretching).
    If subtitles exceed the clip, they extend into the next clip's time.
    
    Returns path or None.
    """
    chars_per_line = 12
    chars_per_second = 4.0
    subtitle_delay = 0.15   # 150ms delay so voice starts before text appears
    
    has_any = any(c.get("subtitle", "").strip() for c in clips)
    if not has_any:
        return None
    ass_path = str(Path(tempfile.gettempdir()) / f"sub_{uuid.uuid4().hex}.ass")
    lines = [
        "[Script Info]",
        "Title: Subtitles",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "PlayDepth: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,SimHei,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,4,2,2,10,10,120,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    cumulative = 0.0
    for i, c in enumerate(clips):
        sub_text = c.get("subtitle", "").strip()
        # Use pre-probed durations if available, otherwise probe now
        if durations and i < len(durations):
            clip_dur, audio_dur = durations[i]
        else:
            clip_dur = _probe_duration(c.get("video_path", ""))
            if clip_dur <= 0:
                clip_dur = float(c.get("duration", 5))
            audio_dur = _probe_duration(c.get("audio_path", ""))
        # Use audio duration if available, otherwise fall back to chars_per_second estimate
        if audio_dur <= 0:
            audio_dur = sum(len(s) for s in _split_by_chars(sub_text, chars_per_line)) / chars_per_second if sub_text else 0
        # Each shot's subtitles start at the shot's boundary (trim overflow from previous shot)
        clip_start = cumulative
        shot_time = 0.0  # local time within this shot
        if sub_text:
            segments = _split_by_chars(sub_text, chars_per_line)
            total_chars = sum(len(s) for s in segments)
            if total_chars > 0 and audio_dur > 0:
                for seg in segments:
                    # Scale each segment's duration proportionally to match actual audio duration
                    seg_ratio = len(seg) / total_chars
                    seg_dur = audio_dur * seg_ratio
                    # Stop if we exceed the clip's video duration
                    if shot_time + seg_dur > clip_dur:
                        break
                    start = _ass_time(clip_start + shot_time + subtitle_delay)
                    end = _ass_time(clip_start + shot_time + seg_dur + subtitle_delay)
                    lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{seg}")
                    shot_time += seg_dur
        cumulative = clip_start + clip_dur

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return ass_path


def _split_by_chars(text: str, chars_per_line: int) -> list[str]:
    """Split text into fixed-length chunks, trying to break at natural boundaries.
    Priority: Chinese punctuation > space > hard cut.
    """
    if len(text) <= chars_per_line:
        return [text]
    result = []
    remaining = text
    delimiters = "，。！？；、："
    while remaining:
        if len(remaining) <= chars_per_line:
            result.append(remaining)
            break
        chunk = remaining[:chars_per_line]
        # Look for Chinese punctuation near the end of the chunk
        best = -1
        for d in delimiters:
            pos = chunk.rfind(d)
            if pos > best:
                best = pos
        if best > chars_per_line // 2:
            result.append(remaining[:best + 1])
            remaining = remaining[best + 1:]
        else:
            result.append(chunk)
            remaining = remaining[chars_per_line:]
    return result
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
    cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_str, "-map", video_out, *audio_map, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output_path]
    return await _run_ffmpeg(cmd, output_path)


def _probe_duration(video_path: str) -> float:
    if not video_path or video_path.startswith(("http://", "https://")):
        return 0.0  # skip probing URLs
    """Get actual video duration via ffprobe. Returns 0 on failure."""
    try:
        import json as _json
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10
        )
        if probe.returncode == 0:
            info = _json.loads(probe.stdout)
            return float(info.get("format", {}).get("duration", 0))
    except Exception:
        pass
    return 0.0

async def _concat_clips(clips: list[dict], output_path: str, size: str, resolution: str) -> dict:
    valid_clips = [c for c in clips if c.get("video_path") and (c["video_path"].startswith(("http://", "https://")) or os.path.exists(c["video_path"]))]
    if not valid_clips:
        return {"ok": False, "error": "没有有效视频片段"}
    try:
        # Pre-probe all durations once (video + audio per clip)
        probed_durations = []
        for i, c in enumerate(valid_clips):
            vpath = c.get("video_path", "")
            if vpath.startswith(("http://", "https://")):
                vdur = float(c.get("duration", 5))  # skip probing URLs
            else:
                vdur = _probe_duration(vpath)
                if vdur <= 0:
                    vdur = float(c.get("duration", 5))
            adur = _probe_duration(c.get("audio_path", ""))
            probed_durations.append((vdur, adur))
            # Warn if audio significantly exceeds video (will be truncated)
            if adur > 0 and vdur > 0 and adur > vdur * 1.2:
                overflow_pct = int((adur - vdur) / vdur * 100)
                print(f"[Composer] WARNING: shot {i+1} audio ({adur:.1f}s) exceeds video ({vdur:.1f}s) by {overflow_pct}% -> audio will be truncated")
        ass_file = _generate_ass(valid_clips, probed_durations)
        cmd = ["ffmpeg", "-y"]
        filter_parts = []
        v_indices = []
        a_labels = []
        scale = _scale_filter(size, resolution)
        for i, c in enumerate(valid_clips):
            vi = len([x for x in cmd if x == "-i"])
            cmd.extend(["-i", c["video_path"]])
            v_indices.append(vi)
            vf = f"[{vi}:v]{scale},setsar=1"
            filter_parts.append(f"{vf}[v{vi}]")
            audio_path = c.get("audio_path", "")
            clip_dur = probed_durations[i][0]
            if audio_path and os.path.exists(audio_path):
                ai = len([x for x in cmd if x == "-i"])
                cmd.extend(["-i", audio_path])
                filter_parts.append(f"[{ai}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=whole_dur={clip_dur}[a_pad_{i}]")
                a_labels.append(f"[a_pad_{i}]")
            else:
                filter_parts.append(f"anullsrc=r=44100:cl=stereo:d={clip_dur}[a_pad_{i}]")
                a_labels.append(f"[a_pad_{i}]")
        n = len(v_indices)
        v_concat = "".join(f"[v{vi}]" for vi in v_indices)
        filter_parts.append(f"{v_concat}concat=n={n}:v=1:a=0[vout]")
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
        cmd.extend(["-movflags", "+faststart", output_path])
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