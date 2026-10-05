# Backend

Kotlin + Spring Boot 3.5, Spring JDBC (без JPA), PostgreSQL 16 + PostGIS, Flyway, S3 (SeaweedFS локально).
Контракт — `/shared/openapi.yaml`. DTO написаны вручную по контракту; соответствие проверяют интеграционные тесты.

## Запуск

```bash
docker compose -f infra/docker-compose.yml up -d db seaweedfs s3-init
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
```

API — `http://localhost:8080/api/v1`. Миграции из `/infra/db/migration` применяются при старте.

Вход в dev-профиле (без OAuth):

```bash
curl -s -X POST localhost:8080/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"mod@local","displayName":"Модератор","role":"moderator"}'
```

## Тесты

```bash
cd backend && ./gradlew test
```

Нужен Docker: тесты поднимают `postgis/postgis:16-3.4` через Testcontainers.

## Настройки (переменные окружения)

| Переменная | Назначение |
|---|---|
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | Подключение к Postgres |
| `JWT_SECRET` | Ключ HS256 для access-токенов, ≥ 32 байт. Обязателен вне `dev` — без него сервер не стартует |
| `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | OAuth client id через запятую. Пусто — вход через провайдера выключен |
| `CORS_ALLOWED_ORIGINS` | Разрешённые origin веб-клиента |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | Хранилище. `S3_PUBLIC_ENDPOINT` — адрес, который попадёт в pre-signed URL (как его видит браузер) |

## Что реализовано (шаг 2)

- Вход: Google/Apple ID token, dev-вход, refresh с ротацией и обнаружением повторного использования, выход, `/me`.
- Справочник категорий, районы (список, карточка, создание и изменение модератором).
- Маршруты: создание, правки с проверкой базовой ревизии, одобрение, отклонение, откат, история, очередь модерации, флаг `publish` для модераторов.
- Поиск: bbox по всем геообъектам, радиус от маркера, район с подрайонами, текст (триграммы), диапазон категорий, тип; курсорная пагинация для всех сортировок; точки для карты.
- Pre-signed URL для загрузки в S3.

Остальные эндпоинты контракта (фото, треки, документы, восхождения, комментарии, жалобы) — шаг 4, пока отвечают `404`.
