# dsh-mywork

MyWork — плагин для DeepSeek Harness (DSH), который ведёт длительную работу
нескольких агентов: команды и роли, граф задач, попытки и lease, контекст,
review, память и доска. Репозиторий содержит каркас v0.1 (этап `00-foundation`).

План и рабочие материалы лежат в `.work/` (каталог исключён из Git):
архитектура, план исполнения, карточки задач и отчёты.

## Структура

```text
packages/contracts     @dsh-mywork/contracts    — доменные контракты, имена сервисов, порты
packages/core          @dsh-mywork/core         — чистые политики: переходы состояний, authority, конфигурация, часы
packages/storage       @dsh-mywork/storage      — durable state: SQLite, schemaVersion, миграции, outbox/inbox
packages/adapter-sdk   @dsh-mywork/adapter-sdk  — манифесты возможностей адаптеров, ошибки, детерминированные fake-реализации
packages/controller    @dsh-mywork/controller   — Cordis-плагин (bundle) и его patch-слой
tests/                 доменные тесты (node:test, без LLM; один тест поднимает процесс-потомок)
scripts/               smoke, локальная упаковка и проверка изолированного профиля
```

Границы `contracts → core → adapter-sdk → controller` соблюдены: контроллер
зависит от нижних пакетов, обратных зависимостей нет. Пакеты пока `private`:
публикация в реестр не выполняется и требует отдельного решения владельца.

Домен описан контрактами (Task/Attempt/Review, Role/Blueprint/Identity,
revisions, `OperationMeta`, `Result`/`MyWorkError`, event envelope, матрица
authority §8) и чистыми переходами состояний в `core`: переход либо возвращает
следующее состояние с событиями, либо типизированную ошибку (`STALE_REVISION`,
`STALE_FENCE`, `LEASE_LOST`, `TASK_CONFLICT`, `UNSCHEDULABLE`, `SECURITY_DENIED`).
Домен не импортирует DSH, Beads и конкретные memory-провайдеры — это проверяется
тестом `tests/boundaries.test.mjs`.

## Runtime state

Runtime-данные не лежат в репозитории: `@dsh-mywork/storage` открывает SQLite под
`$DSH_HOME/dsh-mywork/state/` (§7 архитектуры), в WAL, с явной версией схемы
(`PRAGMA user_version`) и журналом миграций. Мутация и события, которые она
породила, коммитятся одной транзакцией (`BEGIN IMMEDIATE`), а потребитель
записывает `eventId` в `inbox_dedup`, поэтому повторная доставка события не
применяет эффект второй раз. Тесты поднимают свои базы во временных каталогах и
живого профиля DSH не касаются.

## Требования

- Node.js >= 22.18 (проверено на 24.19.0)
- pnpm 12.4.2 (пин в `packageManager`)
- DSH 0.1.5-rc.2 — для `verify:profile`

## Команды

```sh
pnpm install
pnpm run typecheck      # tsc --noEmit по каждому пакету
pnpm run build          # tsdown → lib/ каждого пакета
pnpm run smoke          # воспроизводимый smoke: mount/dispose плагина без LLM
pnpm run test           # доменные тесты (нужен предварительный build)
pnpm run check          # typecheck + build + smoke + test
pnpm run pack:local     # pnpm pack контроллера в .tmp/pack
pnpm run verify:profile # упаковка + установка и boot в изолированном DSH-профиле
```

`pnpm run test` запускает `node --test --test-isolation=none` по
`tests/**/*.test.mjs`: обычный `node --test` поднимает по процессу на файл и в
ограниченном (sandbox) шелле падает со `spawn EPERM` — то же ограничение, что и
у esbuild в `verify:profile`. Тесты не требуют модели, сети и подпроцессов.

`verify:profile` создаёт изолированный `DSH_HOME` в `.tmp/verify-profile`,
устанавливает собранный tarball через `dsh plugin --profile <name> add`,
проверяет составленный конфиг и загружает профиль, после чего удаляет
временные данные. Рабочий профиль пользователя при этом не используется.
CLI DSH можно задать явно: `node scripts/verify-profile.mjs --dsh-bin <path>`.

Если `dsh` запускается из исходников и в ограниченном (sandbox) шелле падает
со `spawn EPERM` (esbuild не может создать pipe), укажите собранный CLI:

```sh
node scripts/verify-profile.mjs --dsh-bin <checkout>/apps/cli/lib/bin.js
```

## Плагин

`@dsh-mywork/controller` объявляет `dsh.bundle.patch` и потому становится
слоем профиля после установки:

```sh
dsh plugin --profile mywork add ./dsh-mywork-controller-0.1.0.tgz
dsh --profile mywork --dump-config
dsh --profile mywork
```

Плагин публикует сервис `myworkController` и снимает его при выгрузке
(`ctx.effect`). Строка конфигурации `diagnostics: true` включает одну
диагностическую строку на mount/stop в stderr.
