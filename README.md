# 🛒 Zyra.ee — Telegram Ads Marketplace

**Децентрализованная биржа рекламы в Telegram-каналах с оплатой через USDT на блокчейне TON.**

Zyra.ee — это Telegram Mini App, в которой рекламодатели покупают размещения в каналах, а администраторы каналов зарабатывают на публикациях. Все расчёты проходят через изолированные escrow-кошельки, что гарантирует безопасность обеих сторон.

> 🤖 **Live-бот:** [@adszyra_bot](https://t.me/adszyra_bot)

---

## 📋 О проекте

Zyra решает проблему доверия между рекламодателями и владельцами каналов. В текущих реалиях покупка рекламы в Telegram — это переписка в личке, предоплата на карту и надежда, что пост не удалят через час. Zyra автоматизирует весь процесс: от выбора канала до верификации публикации и выплаты.

### Как это работает

```
Рекламодатель                     Zyra                          Админ канала
     │                             │                                  │
     │  1. Выбирает канал          │                                  │
     │  2. Пишет текст рекламы     │                                  │
     │  3. Оплачивает USDT ────────▶  Escrow-кошелёк (изолированный)  │
     │                             │                                  │
     │                             │  4. Уведомляет админа ───────────▶
     │                             │                                  │
     │                             │  ◀──────── 5. Публикует пост     │
     │                             │                                  │
     │                             │  6. Верифицирует: пост на месте? │
     │                             │                                  │
     │                             │  7. Выплата (−20% комиссия) ─────▶
     │                             │                                  │
```

### Ключевые возможности

- 🔍 **Каталог каналов** с фильтрами (тематика, цена, подписчики, охваты, ERR)
- 🛒 **Корзина и checkout** — оформление нескольких размещений в одном заказе
- 💰 **Escrow на TON** — каждый платёж создаёт отдельный кошелёк; средства заморожены до верификации
- ✅ **Автоматическая верификация** — бот проверяет, что пост действительно опубликован
- 📊 **Реальные охваты** — подписчики и средний охват подтягиваются через MTProto API (Telethon)
- 📢 **Рекламные кампании** — рекламодатель создаёт кампанию с бюджетом, администраторы подают заявки
- 🔐 **Шифрование ключей** — приватные ключи escrow-кошельков зашифрованы AES-256-GCM
- 💸 **Возврат средств** — деньги можно вернуть до принятия заказа

---

## 🏗️ Архитектура

Проект состоит из трёх компонентов:

```
┌──────────────────────────────────────────────────────────┐
│                    Telegram Mini App                      │
│              React + TypeScript + TonConnect              │
│                  (frontend/src/)                          │
└──────────────────────┬───────────────────────────────────┘
                       │ REST API
                       ▼
┌──────────────────────────────────────────────────────────┐
│                   Node.js Backend                         │
│            Express + TypeScript + PostgreSQL               │
│     TON SDK (@ton/core, @ton/ton, @ton/crypto)           │
│                  (backend/src/)                           │
│                                                          │
│  Фоновые задачи (каждые 30 сек):                         │
│  • processPendingPayments — проверка оплат               │
│  • processScheduledPayouts — выплаты админам             │
│  • processPendingCampaignPayments — оплата кампаний      │
│  • processCampaignApplicationPayouts — выплаты по заявкам│
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP + API Key
                       ▼
┌──────────────────────────────────────────────────────────┐
│                Zyra Views (Python)                        │
│           FastAPI + Telethon (MTProto API)                │
│                    (app.py)                               │
│                                                          │
│  • Подписчики канала                                     │
│  • Средний охват последних 20 постов                     │
│  • Проверка существования поста                          │
└──────────────────────────────────────────────────────────┘
```

### Технический стек

| Компонент | Технологии |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, TonConnect UI |
| **Backend** | Node.js, Express, TypeScript, PostgreSQL, pg |
| **TON** | @ton/core, @ton/ton, @ton/crypto, TonCenter API, TonAPI |
| **Views Service** | Python, FastAPI, Telethon (MTProto), uvicorn |
| **Процесс-менеджер** | PM2 |

---

## 🚀 Быстрый старт

### Требования

- **Node.js** >= 18
- **Python** >= 3.10
- **PostgreSQL** >= 14
- **Telegram Bot** (создать через [@BotFather](https://t.me/BotFather))
- **Telegram API** credentials (получить на [my.telegram.org/apps](https://my.telegram.org/apps))
- **TonAPI** ключ (получить на [tonapi.io](https://tonapi.io))
- **TonCenter** API ключ (получить через [@tonapibot](https://t.me/tonapibot))

### 1. Клонирование

```bash
git clone https://github.com/IlyaTonNonDev/zyra-builders-contest.git
cd zyra-builders-contest
```

### 2. Настройка базы данных

```bash
# Создать базу и пользователя
sudo -u postgres psql -c "CREATE USER ads_user WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE ads_marketplace OWNER ads_user;"
```

Таблицы создаются автоматически при запуске бекенда.

### 3. Настройка Views Service (Python)

```bash
# Создать виртуальное окружение
python3 -m venv venv
source venv/bin/activate

# Установить зависимости
pip install -r requirements.txt

# Скопировать и заполнить .env
cp .env.example .env
# Заполнить: TELEGRAM_API_ID, TELEGRAM_API_HASH, SERVICE_API_KEY

# Авторизация Telethon (один раз)
python auth.py
# Ввести номер телефона и код из Telegram
```

### 4. Настройка Backend

```bash
cd backend

# Установить зависимости
npm install

# Скопировать и заполнить .env
cp .env.example .env
# Заполнить все переменные (см. раздел «Переменные окружения»)
```

### 5. Настройка Frontend

```bash
cd frontend
npm install
```

### 6. Запуск (3 терминала)

```bash
# Терминал 1 — Views Service
source venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8000

# Терминал 2 — Backend
cd backend
npm run dev

# Терминал 3 — Frontend
cd frontend
npm run dev
```

### 7. Настройка Telegram бота

```bash
# Установить webhook (для production)
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-api-domain.com/telegram/webhook"

# Для Telegram Mini App — настроить Web App URL в BotFather
```

### После запуска

| Сервис | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| Views Service | http://localhost:8000 |
| Health check (backend) | http://localhost:3000/health |
| Health check (views) | http://localhost:8000/health |

---

## ⚙️ Переменные окружения

### Backend (`backend/.env`)

| Переменная | Описание | Пример |
|---|---|---|
| `BOT_TOKEN` | Токен Telegram-бота от BotFather | `123456:ABC-DEF...` |
| `BOT_USERNAME` | Username бота (без @) | `adszyra_bot` |
| `PORT` | Порт HTTP-сервера | `3000` |
| `DATABASE_URL` | Строка подключения к PostgreSQL | `postgres://user:pass@localhost:5432/ads_marketplace` |
| `TONAPI_KEY` | Ключ TonAPI | |
| `TON_ESCROW_ADDRESS` | Адрес основного escrow-кошелька | |
| `TON_USDT_JETTON` | Адрес USDT jetton master | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |
| `TONCENTER_API_KEY` | Ключ TonCenter API | |
| `ESCROW_ENCRYPTION_KEY` | 32-байтный ключ шифрования (hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SERVICE_COMMISSION_PERCENT` | Комиссия сервиса (0.2 = 20%) | `0.2` |
| `SERVICE_COMMISSION_ADDRESS` | Кошелёк для получения комиссии | |
| `PAYOUT_DELAY_MINUTES` | Задержка перед выплатой после верификации | `3` |
| `VIEWS_SERVICE_URL` | URL Views-микросервиса | `http://127.0.0.1:8000` |
| `VIEWS_SERVICE_API_KEY` | API-ключ для Views-сервиса | |

### Views Service (`.env` в корне)

| Переменная | Описание |
|---|---|
| `TELEGRAM_API_ID` | API ID из [my.telegram.org](https://my.telegram.org/apps) |
| `TELEGRAM_API_HASH` | API Hash из my.telegram.org |
| `TELEGRAM_SESSION_FILE` | Имя файла сессии Telethon (по умолчанию `userbot.session`) |
| `SERVICE_API_KEY` | Должен совпадать с `VIEWS_SERVICE_API_KEY` в backend |

---

## 📡 API

### Аутентификация

API использует **Telegram Mini App initData** для аутентификации. Заголовок:

```
Authorization: tma <initData>
```

Публичные эндпоинты (без авторизации):
- `GET /health`
- `POST /auth/telegram`
- `GET /channels`
- `GET /campaigns`
- `GET /campaigns/:id`
- `POST /telegram/webhook`

### Основные эндпоинты

#### Auth

| Метод | URL | Описание |
|---|---|---|
| `POST` | `/auth/telegram` | Авторизация через Telegram initData |
| `GET` | `/users/:telegramId/roles` | Получить роли пользователя |
| `POST` | `/users/roles` | Назначить роль |

#### Каталог каналов

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/channels` | Список каналов (с фильтрами) |
| `GET` | `/channels/my/:telegramId` | Мои каналы |
| `POST` | `/channels/register` | Зарегистрировать канал |
| `PATCH` | `/channels/:telegramId/card` | Обновить карточку канала |

**Фильтры для `GET /channels`:**

```
?topic=crypto&minPrice=10&maxPrice=500&minSubscribers=1000&minViews=100&minErr=1&maxErr=50
```

Доступные тематики: `business`, `crypto`, `education`, `entertainment`, `lifestyle`, `news`, `tech`

#### Корзина и заказы

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/cart/:telegramId` | Получить корзину |
| `POST` | `/cart/add` | Добавить в корзину |
| `DELETE` | `/cart/remove/:orderId` | Удалить из корзины |
| `POST` | `/cart/checkout` | Оформить заказ |
| `GET` | `/orders/:telegramId` | Мои заказы |

#### Платежи

| Метод | URL | Описание |
|---|---|---|
| `POST` | `/payments/:groupId/create` | Создать платёж → получить escrow-адрес и Tonkeeper ссылку |
| `POST` | `/payments/:paymentId/refresh` | Проверить статус оплаты на блокчейне |
| `POST` | `/payments/:paymentId/refund` | Инициировать возврат |

#### Кампании

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/campaigns` | Список активных кампаний |
| `POST` | `/campaigns` | Создать кампанию |
| `GET` | `/campaigns/:id` | Детали кампании |
| `POST` | `/campaigns/:id/apply` | Подать заявку на кампанию |
| `POST` | `/campaigns/:id/applications/:appId/accept` | Принять заявку |
| `POST` | `/campaigns/:id/applications/:appId/reject` | Отклонить заявку |
| `POST` | `/campaigns/:id/close` | Закрыть кампанию (возврат остатка) |

#### Views Service (Python)

| Метод | URL | Описание |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/stats` | Получить охваты канала |
| `POST` | `/post-check` | Проверить существование поста |

---

## 💰 Escrow-система

Ключевая особенность проекта — **полноценный escrow на блокчейне TON**.

### Принцип работы

1. При каждом платеже генерируется **отдельный TON-кошелёк** (WalletContractV5R1)
2. Рекламодатель отправляет USDT на этот escrow-адрес через Tonkeeper
3. Бекенд отслеживает поступление средств через TonAPI (каждые 30 секунд)
4. После верификации публикации из escrow отправляются **две транзакции**:
   - 80% → кошелёк администратора канала
   - 20% → кошелёк сервиса (комиссия)

### Безопасность escrow

- **Изоляция** — каждый платёж имеет свой кошелёк; компрометация одного не затрагивает остальные
- **Шифрование** — приватные ключи шифруются AES-256-GCM с уникальным IV
- **Мастер-ключ** — `ESCROW_ENCRYPTION_KEY` хранится только в `.env` (chmod 600)
- **Auth Tag** — обеспечивает целостность шифротекста
- **Мнемоника не хранится** — после генерации ключевой пары мнемоника уничтожается
- **Санитизация API** — зашифрованные ключи вырезаются из ответов клиенту
- **Проверка прав `.env`** — сервер не запустится, если `.env` доступен другим пользователям

### Lifecycle платежа

```
draft → pending_payment → pending → accepted → verification_pending → verifying → processing → sent
                                       │                                                         │
                                       └── rejected → refund_pending → refunded                  │
                                                                                                 ▼
                                                                                           payout sent
```

---

## 🗃️ Схема базы данных

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   users      │     │   roles       │     │   user_roles      │
│ id           │◄────│ id            │     │ user_id → users   │
│ telegram_id  │     │ name          │     │ role_id → roles   │
│ created_at   │     └──────────────┘     └──────────────────┘
└──────┬───────┘
       │
       ▼
┌──────────────────┐     ┌──────────────────┐
│   channels        │     │ channel_post_views│
│ id                │     │ channel_telegram_id│
│ telegram_id       │     │ view_count        │
│ title, username   │     │ created_at        │
│ topic, price_usdt │     └──────────────────┘
│ subscribers       │
│ avg_views, err    │
│ payout_address    │
│ added_by_user_id  │
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  order_groups     │     │   orders          │     │   payments        │
│ id                │◄────│ group_id          │     │ order_group_id    │
│ telegram_id       │     │ channel_telegram_id│    │ status            │
│ status            │     │ ad_text           │     │ amount/fee/total  │
│ created_at        │     │ publish_at        │     │ escrow_address    │
└──────────────────┘     │ price_usdt        │     │ escrow_private_key│
                          │ publish_status    │     │ payer_address     │
                          │ verify_status     │     │ paid_tx_hash      │
                          └──────────────────┘     │ payout_tx_hash    │
                                                    └──────────────────┘

┌──────────────────┐     ┌────────────────────────┐
│   campaigns       │     │ campaign_applications   │
│ id                │◄────│ campaign_id             │
│ advertiser_user_id│     │ channel_id              │
│ ad_text           │     │ proposed_price          │
│ budget_usdt       │     │ status                  │
│ price_per_post    │     │ published_message_id    │
│ remaining_usdt    │     │ verify_status           │
│ escrow_address    │     │ payout_status           │
│ status            │     │ payout_tx_hash          │
└──────────────────┘     └────────────────────────┘
```

---

## 📁 Структура проекта

```
.
├── app.py                    # Views Service — FastAPI + Telethon (охваты каналов)
├── auth.py                   # Скрипт авторизации Telethon (одноразовый)
├── requirements.txt          # Python-зависимости
├── .env.example              # Шаблон .env для Views Service
│
├── backend/
│   ├── .env.example          # Шаблон .env для бекенда
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # Точка входа — Express, PM2, фоновые задачи
│       ├── db.ts             # PostgreSQL pool + миграции (auto-create tables)
│       ├── authMiddleware.ts # Аутентификация через Telegram initData
│       ├── telegram.ts       # Валидация initData (HMAC-SHA256)
│       ├── telegramBot.ts    # Обёртка над Telegram Bot API
│       ├── escrowWallet.ts   # Генерация кошельков + AES-256-GCM шифрование
│       ├── tonApi.ts         # Работа с TonAPI (события, балансы, jettons)
│       ├── toncenter.ts      # Отправка транзакций через TonCenter
│       ├── helpers.ts        # Утилиты — комиссии, выплаты, верификация
│       ├── envSecurity.ts    # Проверка прав .env файла (chmod 600)
│       ├── logger.ts         # Логгер с дедупликацией и truncation
│       ├── asyncHandler.ts   # Обёртка для async Express handlers
│       └── routes/
│           ├── auth.ts       # Авторизация, роли
│           ├── channels.ts   # CRUD каналов, фильтры каталога
│           ├── cart.ts       # Корзина
│           ├── orders.ts     # Заказы, публикация, верификация
│           ├── payments.ts   # Платежи, escrow, выплаты, возвраты
│           ├── campaigns.ts  # Кампании, заявки, выплаты
│           └── webhook.ts    # Telegram webhook (обновления каналов)
│
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx           # Главный компонент — роутинг, стейт, API
        ├── App.css           # Стили
        ├── types.ts          # TypeScript типы
        └── components/
            ├── CatalogTab.tsx       # Каталог каналов с фильтрами
            ├── CartTab.tsx          # Корзина и оплата
            ├── OrdersTab.tsx        # Мои заказы
            ├── MyChannelTab.tsx     # Управление каналом
            ├── CampaignsTab.tsx     # Кампании и заявки
            └── CampaignTextBlock.tsx # Компонент текста кампании
```

---

## 🔒 Безопасность

| Мера | Реализация |
|---|---|
| **Аутентификация** | Telegram initData с HMAC-SHA256 валидацией |
| **Шифрование ключей** | AES-256-GCM с уникальным IV для каждого escrow-кошелька |
| **Защита `.env`** | Сервер не запустится при permissions выше `chmod 600` |
| **API-ключи** | Views-сервис защищён `X-Api-Key` заголовком |
| **Rate limiting** | Telegram API retry_after обработка |
| **Логирование** | Truncation + дедупликация (секреты не утекают в логи) |
| **Санитизация** | Приватные ключи вырезаются из всех API-ответов |
| **CORS** | Настроен для разрешённых доменов |
| **Graceful shutdown** | Корректное завершение с закрытием DB pool |

---

## 🚀 Production-деплой

### PM2

```bash
# Backend
cd backend && npm run build
pm2 start dist/index.js --name ads-backend

# Views Service
pm2 start /path/to/venv/bin/uvicorn \
  --name zyra-views \
  --cwd /path/to/project \
  --interpreter /path/to/venv/bin/python \
  -- app:app --host 127.0.0.1 --port 8000

pm2 save
pm2 startup
```

### Nginx (пример)

```nginx
# Backend API
server {
    listen 443 ssl;
    server_name api.zyra.ee;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Frontend
server {
    listen 443 ssl;
    server_name app.zyra.ee;

    root /opt/ads-marketplace/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Telegram Webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://api.zyra.ee/telegram/webhook"
```

---

## 🧪 Тестирование

### Health checks

```bash
# Backend
curl http://localhost:3000/health
# → {"status":"ok"}

# Views Service
curl http://localhost:8000/health
# → {"ok":true}
```

### Проверка Views Service

```bash
curl -X POST http://localhost:8000/stats \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{"channel": "@telegram"}'
# → {"ok":true,"stats":{"subscribers":11386473,"avg_views":1723409,"recent_posts":20}}
```

### Чек-лист функционала

- [ ] Авторизация через Telegram Mini App
- [ ] Каталог каналов с фильтрами
- [ ] Добавление канала, подтягивание охватов
- [ ] Корзина → checkout → оплата через Tonkeeper
- [ ] Автоверификация поста после публикации
- [ ] Выплата админу канала (−20% комиссия)
- [ ] Создание кампании → подача заявки → публикация → выплата
- [ ] Возврат средств при отклонении/удалении поста

---

## 🗺️ Roadmap

### Реализовано ✅

- Каталог каналов с реальными охватами (MTProto)
- Escrow-система с изолированными кошельками
- Рекламные кампании с заявками
- Автоверификация публикаций
- Система возвратов
- Уведомления через Telegram Bot API
- Комиссия сервиса (настраиваемый %)

### Планируется 🔜

- Cloud KMS для мастер-ключа шифрования (вместо .env)
- Ротация ключей шифрования escrow-кошельков
- Аудит-логирование расшифровки приватных ключей
- Отдельная БД/таблица для секретов с ограниченным доступом
- Dashboard с аналитикой для рекламодателей
- Рейтинг каналов и отзывы
- Поддержка медиа-контента в рекламных постах
- Multi-language поддержка интерфейса
- Docker Compose для development-окружения

---

## 🤖 Использование ИИ

**100% кода в этом проекте написано с помощью ИИ** (Claude / Cursor IDE).

Это включает:
- архитектуру и проектирование БД,
- backend (Express, PostgreSQL, TON SDK),
- frontend (React, TonConnect),
- Views-сервис (FastAPI, Telethon),
- escrow-логику и шифрование,
- деплой-скрипты и конфигурацию,
- данный README.

Все решения проверялись и тестировались вручную. ИИ использовался как инструмент для генерации и итерации кода при полном контроле со стороны автора.

---

## 📄 Лицензия

MIT