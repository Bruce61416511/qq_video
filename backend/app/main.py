from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import init_db
from .routers import accounts, media, publish
from .services.worker import start_worker
from .config import UPLOAD_DIR

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_worker()
    yield

app = FastAPI(title="视频号助手 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(accounts.router)
app.include_router(media.router)
app.include_router(publish.router)

@app.get("/api/health")
async def health():
    return {"status": "ok"}
