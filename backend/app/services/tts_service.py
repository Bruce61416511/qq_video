"""
TTS 语音合成服务
参考 MoneyPrinterTurbo: app/services/voice.py
支持 Edge TTS (免费) / OpenAI TTS / ChatTTS
"""
import os
import subprocess
import tempfile
import httpx
from pathlib import Path
from ..config import get_setting, UPLOAD_DIR


async def generate_voice(text: str, voice_id: str = None, output_path: str = None) -> str:
    """Generate voice audio from text. Returns file path to .mp3 or .wav.

    Priority: Edge TTS (free/no key) > OpenAI TTS > fallback placeholder
    """
    if not text or not text.strip():
        return ""

    service = await get_setting("tts_service")
    api_key = await get_setting("tts_api_key")

    # Default output directory
    if output_path is None:
        output_dir = UPLOAD_DIR / "audio"
        output_dir.mkdir(exist_ok=True)
        import uuid
        output_path = str(output_dir / f"tts_{uuid.uuid4().hex}.mp3")

    # Edge TTS is free and works without key
    if not service or service == "edge_tts" or (service == "edge_tts" and not api_key):
        return await _edge_tts(text, output_path, voice_id)

    if service == "bailian_tts":
        model = await get_setting("tts_model") or "qwen-audio-3.0-tts-flash"
        voice = await get_setting("tts_voice") or "longanhuan_v3.6"
        return await _bailian_tts(text, output_path, api_key, model, voice)

    if service == "openai_tts":
        return await _openai_tts(text, output_path, api_key, voice_id)

    if service == "chattss":
        return await _chattts(text, output_path)

    # Default: try edge_tts
    return await _edge_tts(text, output_path, voice_id)


async def _edge_tts(text: str, output_path: str, voice_id: str = None) -> str:
    """Edge TTS - free, good quality Chinese voices."""
    voice = voice_id or "zh-CN-XiaoxiaoNeural"  # warm female voice
    try:
        # Use edge-tts CLI
        # Try full path for edge-tts first
    edge_exe = "edge-tts"
    possible_paths = [
        os.path.expandvars(r"%APPDATA%\Python\Python314\Scripts\edge-tts.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python314\Scripts\edge-tts.exe"),
        "edge-tts",
    ]
    for p in possible_paths:
        if os.path.exists(p) or p == "edge-tts":
            edge_exe = p
            break
    cmd = [
            edge_exe,
            "--voice", voice,
            "--text", text,
            "--write-media", output_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            print(f"[TTS] edge-tts error: {proc.stderr}")
            return ""
        return output_path
    except FileNotFoundError:
        print("[TTS] edge-tts not installed, run: pip install edge-tts")
        return ""
    except Exception as e:
        print(f"[TTS] error: {e}")
        return ""



async def _bailian_tts(text: str, output_path: str, api_key: str, model: str = "qwen-audio-3.0-tts-flash", voice: str = "longanhuan_v3.6") -> str:
    """Aliyun Bailian TTS via dashscope SDK. Model: qwen-audio-3.0-tts-flash"""
    try:
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer
        
        dashscope.api_key = api_key
        synthesizer = SpeechSynthesizer(
            model=model,
            voice=voice,
        )
        audio = synthesizer.call(text)
        
        if audio and len(audio) > 100:
            with open(output_path, "wb") as f:
                f.write(audio)
            return output_path
        else:
            print(f"[TTS] Bailian: empty audio response")
    except Exception as e:
        print(f"[TTS] Bailian error: {e}")
    
    return ""

async def _openai_tts(text: str, output_path: str, api_key: str, voice_id: str = None) -> str:
    """OpenAI TTS API."""
    voice = voice_id or "alloy"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "tts-1",
                    "input": text,
                    "voice": voice,
                },
            )
            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return output_path
            else:
                print(f"[TTS] OpenAI error: {resp.status_code} {resp.text}")
                return ""
    except Exception as e:
        print(f"[TTS] OpenAI error: {e}")
        return ""


async def _chattts(text: str, output_path: str) -> str:
    """ChatTTS - local or API. Placeholder for now."""
    print("[TTS] ChatTTS not yet integrated, using edge-tts fallback")
    return await _edge_tts(text, output_path)