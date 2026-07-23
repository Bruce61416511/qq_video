import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, Enum, func
from ..database import Base
import enum

class AccountStatus(str, enum.Enum):
    offline = "offline"
    online = "online"
    expired = "expired"

class MediaStatus(str, enum.Enum):
    ready = "ready"
    generating = "generating"
    failed = "failed"

class TaskStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"

class Account(Base):
    __tablename__ = "accounts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    status = Column(Enum(AccountStatus), default=AccountStatus.offline)
    cookies = Column(Text, nullable=True)
    last_login = Column(String(50), default="")
    channel_name = Column(String(100), default="")
    created_at = Column(DateTime, default=datetime.datetime.now)

class Media(Base):
    __tablename__ = "media"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    size = Column(String(20), default="")
    duration = Column(String(20), default="")
    status = Column(Enum(MediaStatus), default=MediaStatus.ready)
    source = Column(String(20), default="upload")
    prompt = Column(Text, default="")
    video_size = Column(String(20), default="")
    video_duration = Column(String(20), default="")
    video_resolution = Column(String(10), default="")
    created_at = Column(DateTime, default=datetime.datetime.now)

class PublishTask(Base):
    __tablename__ = "publish_tasks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    media_id = Column(Integer, nullable=False)
    account_id = Column(Integer, nullable=False)
    title = Column(Text, default="")
    tags = Column(String(500), default="")
    status = Column(Enum(TaskStatus), default=TaskStatus.pending)
    error_msg = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.datetime.now)
    finished_at = Column(DateTime, nullable=True)

class Setting(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.datetime.now, onupdate=datetime.datetime.now)