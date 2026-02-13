"""
Скрипт авторизации Telethon.
Запусти один раз: python auth.py
Введи номер телефона и код из Telegram — получишь файл .session.
"""

import os
import asyncio

from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()

API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION_FILE = os.getenv("TELEGRAM_SESSION_FILE", "userbot.session")

if not API_ID or not API_HASH:
    print("Ошибка: заполни TELEGRAM_API_ID и TELEGRAM_API_HASH в файле .env")
    exit(1)


async def main():
    client = TelegramClient(SESSION_FILE, API_ID, API_HASH)
    await client.connect()

    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"Уже авторизован как: {me.first_name} (id={me.id})")
        print(f"Файл сессии: {SESSION_FILE}")
        await client.disconnect()
        return

    phone = input("Введи номер телефона (в формате +7...): ").strip()
    await client.send_code_request(phone)

    code = input("Введи код из Telegram: ").strip()

    try:
        await client.sign_in(phone, code)
    except Exception as e:
        if "Two-steps verification" in str(e) or "password" in str(e).lower():
            password = input("Введи пароль двухфакторной аутентификации: ").strip()
            await client.sign_in(password=password)
        else:
            raise

    me = await client.get_me()
    print(f"\nУспешно авторизован как: {me.first_name} (id={me.id})")
    print(f"Файл сессии сохранён: {SESSION_FILE}")
    print("Теперь можно запускать app.py")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
