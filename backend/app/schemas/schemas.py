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
