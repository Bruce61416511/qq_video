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

class VideoGenerateRequest(BaseModel):
    prompt: str
    size: str = "9:16"
    duration: str = "10"
    resolution: str = "1080P"

class SettingOut(BaseModel):
    id: int
    key: str
    value: str
    updated_at: datetime
    model_config = {"from_attributes": True}

class SettingUpdate(BaseModel):
    value: str