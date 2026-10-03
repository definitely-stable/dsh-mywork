# F-30 · Composition root: lease / planner / execution / scheduler / evidence

**Статус: READY_FOR_REVIEW**

## Что сделано

1. `app.start()` поднимает пять подсистем в порядке зависимостей: **evidence → lease (activate) → planner → execution → scheduler**; `app.services` перечисляет их в этом же порядке, `stop()` снимает в обратном.
2. Часы инъектируются во **все** подсистемы (`options.clock`, по умолчанию `systemClock`) — D11: `createControllerLifecycle`, `createPlanner`, `createClaimSaga`, `createScheduler`, `createArtifactStore` получают один и тот же `ClockPort`.
3. Task graph — **ленивый порт через реестр**: `adapters.require('taskgraph')` вызывается на каждом обращении (Proxy), поэтому backend-строка (например `beads-adapter`) может смонтироваться позже корня, а её отсутствие даёт типизированный `ADAPTER_UNAVAILABLE`, а не падение композиции.
4. Создан `tests/app-subsystems.test.mjs` — 1 тест (гейт F-30).

## Изменённые пути

- Modify `packages/controller/src/app.ts`
- Create `tests/app-subsystems.test.mjs`

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-subsystems.test.mjs` | **0** | `ℹ tests 1 / ℹ pass 1 / ℹ fail 0` — **гейт F-30** |
| `Select-String packages\controller\src\app.ts -Pattern 'openStore\('` | 0 | **2** — ровно registry + controller, не больше (гейт F-30) |
| Тест: `app.services.map(s => s.name)` | 0 | `['evidence','lease','planner','execution','scheduler']` |
| Тест: `app.lease.info().instanceId` / `isWriter()` | 0 | `'test-instance'` (инъекция работает) / `true` — единственный контроллер держит lease |
| Тест: `app.scheduler.snapshot()` | 0 | `{ running: false, ticks: 0 }` — рантайм поднят, таймер не вооружён (осознанно, см. ограничения) |
| Тест: `app.evidence.artifacts.put(...)` | 0 | первый `put` → `created: true`, повторный → `created: false` (идемпотентность через ту же базу) |
| Тест: `app.migrations.allocate({ key: 'subsystems-probe' })` | 0 | **9** — номер выдан после журнала (v6) и уже занятых заявок 7 и 8; повторный вызов даёт тот же 9 (F-63 привязан к живой базе). Поправка Lead'а после независимого ревью: в первой редакции стояло «7» — это было верно до подключения миграций F-36/F-40 |
| `tsc --noEmit -p packages/controller/tsconfig.json` | 0 | ошибок типов нет |

## Как устроены порты, которых не было

- **Task graph** — `new Proxy({} as TaskGraphPort, …)`: каждый вызов метода резолвит адаптер заново и передаёт аргументы как есть. Захват инстанса «на старте» заморозил бы первого зарегистрированного и не пережил бы замену backend'а.
- **Scheduler state** (`read()`) — пустое наблюдение (нет очереди, ревью, инстансов, агентов, workspace'ов; каталог пуст). Тик по пустому наблюдению ничего не допускает — это честный ответ, пока нет проекций очереди.
- **Scheduler admit** (`admit()`) — решения складываются в `app.admissions` (наблюдаемы), а не теряются. Передача в §9-сагу требует `OperationMeta`, которого у планировщика нет; это отдельная карточка.

## Ограничения

- **Scheduler не вооружён**: `app.start()` его конструирует и делает достижимым, но не вызывает `scheduler.start()`. Вооружать таймер, который принимает решения по пустому наблюдению, — шум; владелец рантайма делает это, когда появится чтение очереди. Гейт F-30 этого не требует (в нём только `services` и число `openStore(`).
- `reconcile` lease возвращает нули (пример из JSDoc `lease/src/index.ts:19`) — настоящая сверка неполных операций отдельная карточка.
- `admissions` не ограничен по размеру: планировщик не вооружён, поэтому на практике пуст.
- Порядок «lease до planner/saga» сохранён сознательно: пассивный контроллер не должен раздавать планировщик, который менял бы scope, которым он не руководит.

## Что НЕ проверено

- Реальный `TaskGraphPort` из реестра: тест не регистрирует taskgraph-адаптер, поэтому ветка «адаптер найден» проверяется только типами и кодом Proxy (ветка «адаптер отсутствует» — типизированный отказ).
- Поведение scheduler при непустом наблюдении и при `scheduler.start()` — вне шага.
- Достижимость 12 пакетов (F-45) — считает отдельный шаг; здесь доказано только то, что пять подсистем конструируются и живут.
