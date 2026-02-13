"""
Zyra Views — микросервис для сбора охватов публичных Telegram-каналов.
Использует Telethon (MTProto API) для чтения просмотров постов.
Запуск: uvicorn app:app --port 8000
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from telethon import TelegramClient
from telethon.tl.functions.channels import GetFullChannelRequest

load_dotenv()

# ─── Конфигурация ────────────────────────────────────────────────────
API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION_FILE = os.getenv("TELEGRAM_SESSION_FILE", "userbot.session")
SERVICE_API_KEY = os.getenv("SERVICE_API_KEY", "")

if not API_ID or not API_HASH:
    raise RuntimeError("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH")

if not SERVICE_API_KEY:
    raise RuntimeError("Missing SERVICE_API_KEY — set it in .env")

app = FastAPI(title="Zyra Views", version="1.0.0")
client = TelegramClient(SESSION_FILE, API_ID, API_HASH)


# ─── Модели запросов ─────────────────────────────────────────────────
class StatsRequest(BaseModel):
    channel: str  # @username, t.me/username или https://t.me/username


class PostCheckRequest(BaseModel):
    channel: str
    message_id: int


# ─── Утилиты ─────────────────────────────────────────────────────────
def normalize_channel(channel: str) -> str:
    """Приводит ссылку/имя канала к формату @username."""
    if channel.startswith("https://t.me/"):
        return "@" + channel.replace("https://t.me/", "")
    if channel.startswith("t.me/"):
        return "@" + channel.replace("t.me/", "")
    return channel if channel.startswith("@") else f"@{channel}"


def verify_api_key(x_api_key: str = Header(None)):
    """Проверка API-ключа из заголовка X-Api-Key."""
    if x_api_key != SERVICE_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


async def ensure_client():
    """Убеждаемся, что Telethon подключён и авторизован."""
    if not client.is_connected():
        await client.connect()
    if not await client.is_user_authorized():
        raise HTTPException(status_code=401, detail="Userbot session is not authorized")


async def get_channel_info(channel_entity):
    """Получает базовую информацию о канале."""
    title = getattr(channel_entity, "title", None)
    username = getattr(channel_entity, "username", None)
    participants = None
    try:
        full = await client(GetFullChannelRequest(channel=channel_entity))
        participants = getattr(full.full_chat, "participants_count", None)
    except Exception:
        participants = getattr(channel_entity, "participants_count", None)
    return {
        "title": title,
        "username": f"@{username}" if username else None,
        "subscribers": participants,
    }


# ─── Startup ─────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    await ensure_client()


# ─── Эндпоинты ───────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """Проверка работоспособности сервиса."""
    return {"ok": True}


@app.post("/stats")
async def stats(payload: StatsRequest, x_api_key: str = Header(None)):
    """
    Получить охваты публичного канала.
    Возвращает: подписчики, средний охват последних 20 постов, кол-во постов.
    """
    verify_api_key(x_api_key)
    await ensure_client()

    channel = normalize_channel(payload.channel)

    try:
        entity = await client.get_entity(channel)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Channel {channel} not found")

    info = await get_channel_info(entity)

    messages = await client.get_messages(entity, limit=20)
    views = [m.views for m in messages if isinstance(m.views, int)]
    avg_views = round(sum(views) / len(views)) if views else None

    return {
        "ok": True,
        "channel": channel,
        "stats": {
            "subscribers": info.get("subscribers"),
            "avg_views": avg_views,
            "recent_posts": len(views),
        },
        "info": info,
    }


@app.post("/post-check")
async def post_check(payload: PostCheckRequest, x_api_key: str = Header(None)):
    """
    Проверить, существует ли пост в канале.
    Полезно для подтверждения публикации рекламного поста.
    """
    verify_api_key(x_api_key)
    await ensure_client()

    channel = normalize_channel(payload.channel)

    try:
        entity = await client.get_entity(channel)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Channel {channel} not found")

    message = await client.get_messages(entity, ids=payload.message_id)
    if not message:
        return {"ok": True, "exists": False}

    return {
        "ok": True,
        "exists": True,
        "views": message.views if isinstance(message.views, int) else None,
        "date": message.date.isoformat() if getattr(message, "date", None) else None,
        "edit_date": message.edit_date.isoformat() if getattr(message, "edit_date", None) else None,
    }
