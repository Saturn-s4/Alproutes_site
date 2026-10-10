# Web

Next.js 16 (App Router), TypeScript, MapLibre GL JS. Клиент API `/api/v1` backend на Kotlin, своей логики и БД нет.

## Запуск

```bash
docker compose -f infra/docker-compose.yml up -d db seaweedfs s3-init
cd backend && ./gradlew bootRun --args='--spring.profiles.active=dev'
cd web && npm install && npm run dev
```

Открыть `http://localhost:3000`. Вход — `/login` (dev-вход backend, без OAuth).

## Как устроено

- **Типы API** генерируются из `/shared/openapi.yaml` (`npm run gen:api`, запускается автоматически перед `dev` и `build`). Файл `src/lib/api/schema.d.ts` не коммитится. Запросы — через `openapi-fetch`, типизированный по этим типам.
- **Прокси.** Браузер ходит на `/api/v1/*` того же origin, Next проксирует на `API_URL` (`next.config.ts`). Серверные компоненты обращаются к `API_URL` напрямую.
- **SSR.** Каталог, страницы районов (`/areas/[slug]`) и маршрутов (`/routes/[slug]`) рендерятся на сервере ради индексации. Карта (`/`) — клиентская.
- **Язык и тема** хранятся в cookie (`lang`, `theme`), чтобы сервер сразу рендерил нужный вариант. Тема: системная / тёмная / светлая.
- **Сессия** — пара токенов в `localStorage`, обновление access-токена в один поток (требование контракта).
- **Карта** — растровые тайлы OpenTopoMap. В тёмной теме они инвертируются paint-свойствами raster-слоя, а не CSS-фильтром, поэтому линии и точки сохраняют свои цвета. Воркер MapLibre копируется в `public/maplibre` (`npm run prepare:assets`): бандлер не умеет разрешать его путь сам.
- **Фото.** Страница маршрута показывает фото описания (подписи из ревизии) и галерею участников (`inDescription=false`, подгрузка по курсору), полноэкранный просмотр — `Lightbox`. Картинки берутся напрямую из публичного бакета.
- **PDF** открываются встроенным просмотрщиком браузера в `iframe`: `/api/v1/documents/{id}/download` отвечает редиректом на временную ссылку. pdf.js понадобится, когда нужен будет свой интерфейс просмотра (мобильные браузеры PDF в iframe показывают плохо).
- **Стили** перенесены из `web-prototype/src/styles` (вариант A).

## Зависимости

| Пакет | Зачем |
|---|---|
| `next`, `react`, `react-dom` | стек из CLAUDE.md |
| `maplibre-gl` | карта (CLAUDE.md: только MapLibre) |
| `openapi-fetch` | типизированный fetch по сгенерированным типам, ~6 КБ |
| `openapi-typescript` (dev) | генерация типов из контракта |
