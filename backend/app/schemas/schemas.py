from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class AccountOut(BaseModel):
    id: int
    name: str
    status: str
    last_login: str
    channel_name: str = ''
    created_at: datetime
    model_config = {"from_attributes": True}

class MediaOut(BaseModel):
    id: int
    name: str
    filepath: str
    size: str
    duration: str
    status: str
    source: str
    prompt: str = ''
    video_size: str = ''
    video_duration: str = ''
    video_resolution: str = ''
    created_at: datetime
    model_config = {"from_attributes": True}

class MediaShotOut(BaseModel):
    id: int
    media_id: int
    shot_index: int
    scene_prompt: str
    voice_script: str
    duration: str
    clip_path: str
    audio_path: str
    progress: int = 0
    status: str
    model_config = {"from_attributes": True}

class PublishTaskOut(BaseModel):
    id: int
    media_id: int
    account_id: int
    title: str
    tags: str
    status: str
    error_msg: str
    created_at: datetime
    finished_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

class PublishRequest(BaseModel):
    media_id: int
    account_ids: list[int]
    title: str
    tags: str = ""
    schedule_time: Optional[datetime] = None

class ShotItem(BaseModel):
    scene_prompt: str
    voice_script: str
    duration: str = "5"

class GenerateShotsRequest(BaseModel):
    topic: str
    shot_count: int = 3
    shot_duration: str = "5"

class VideoGenerateRequest(BaseModel):
    prompt: str
    size: str = "9:16"
    resolution: str = "1080P"
    shots: list[ShotItem] = []

class SettingOut(BaseModel):
    id: int
    key: str
    value: str
    updated_at: datetime
    model_config = {"from_attributes": True}

class SettingUpdate(BaseModel):
    value: str