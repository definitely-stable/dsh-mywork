# Evidence: red-team A — коллизии версий миграций и пустые гейты

## 1. Фактические версии схемы (замер, 2026-09-27)

| Пакет | Файл:строка | Версия | Имя |
|---|---|---|---|
| storage | `packages/storage/src/migrations.ts:50` | **1** | `outbox-inbox` (`MYWORK_MIGRATIONS = [OUTBOX_INBOX]`, `:91`) |
| evidence | `packages/evidence/src/schema.ts:140` | **2** | `EVIDENCE_MIGRATIONS[0]` |
| evidence | `packages/evidence/src/schema.ts:147` | **3** | `EVIDENCE_SCHEMA_VERSION = 3` (`:26`) |
| lease | `packages/lease/src/schema.ts:68` | **4** | `LEASE_SCHEMA_VERSION = 4` (`:22`) |
| planner | `packages/planner/src/schema.ts:150` | **5** | `PLAN_MUTATION_SCHEMA_VERSION = 5` (`:36`) |
| execution | `packages/execution/src/schema.ts:155` | **6** | `CLAIM_SAGA_SCHEMA_VERSION = 6` (`:48`) |

Канонический реестр (F-18/D08) склеивает все пять списков в один, версии 1…6, и передаётся в
`openStore` (F-19 делает список обязательным). Валидатор:

```
packages/storage/src/migrations.ts:111-129  validateMigrations()
   :117  if (migration.version <= previous)
   :118    throw new StorageError('invalid-input', `... must be ordered by unique version,
                                          ${migration.version} follows ${previous}`)
```

## 2. Коллизия «версия 7» — три шага на одну версию

| Шаг | Файл плана (снапшот) | Дословно |
|---|---|---|
| F-36 | `20-…:952` | «канонический список миграций содержит миграцию **версии 7** с таблицей **`background_job`**» |
| F-37 | `20-…:971` | Create `packages/storage/src/background-jobs.ts` (реализация той же v7) |
| F-40 | `20-…:1057` | «**новая миграция версии 7** (версия 7 **свободна** — проверено: `version: 7` в `packages/*/src/*.ts` и в `tests` → 0 совпадений)» |
| E-04 | `21-…:214,216,222` | «миграция `v7`», «`CREATE TABLE attempt_worktree(...)`», «`PRAGMA user_version` (= 7)» |

Все три — в одном `controller.sqlite` (D09: «истина — `controller.sqlite`»; E-04/F-29: тот же файл,
тот же полный список миграций). Реестр с двумя `version: 7` не проходит `validateMigrations` →
store не открывается, F-20 (journal consistency) отвергает базу, F-29 (composition root) не поднимается.
F-40 сам объявляет v7 свободной, будучи в одном файле с F-36, который её уже занял.

## 3. Коллизия «версия 2» — B-12 против evidence

`22-STEPS-surface.md:624` (B-12): «Modify `packages/storage/src/migrations.ts` (новая миграция
`version: 2`, `name: 'board-projection'`)», гейт `:646` — «`Select-String … -Pattern 'version: 2'` находит
миграцию».
Факт: `version: 2` уже занята `EVIDENCE_MIGRATIONS[0]` (`evidence/src/schema.ts:140`). В каноническом
реестре — дубль версии → тот же отказ `migrations must be ordered by unique version`.

## 4. Литерал `[1,2,3,4,5,6]` против шагов этапа 4

F-18 (`20-…:517`, шаг 1) требует тест `MYWORK_DATABASE_MIGRATIONS.map(m => m.version)` → `[1,2,3,4,5,6]`,
гейт — `# pass 3`.
Этап 4 добавляет: v7 (E-04), v8 (E-19), v9 (E-28 «миграция `v9`»), v10 (E-34), v11 (E-37).
Ни один шаг не предписывает обновить тест из F-18 → после первого же шага этапа 4 гейт этапа 1 краснеет.

## 5. Контрпримеры к пустым гейтам (воспроизводимые)

| Шаг | Гейт | Контрпример «пройти, ничего не сделав» |
|---|---|---|
| F-11 | `git status --porcelain pnpm-lock.yaml` → пусто | Уже пусто (проверено). Достаточно ничего не делать |
| F-22 | `node --test tests/beads-adapter.test.mjs` → `# fail 0` И `Select-String adapter.ts -Pattern 'BEADS_ACTOR'` → ≥2 | Сегодня: `# fail 0` (23 skip) и **3** совпадения (`:182` комментарий, `:495` комментарий, `:500` claim) |
| F-16 | `node --test tests/beads-adapter.test.mjs 2>&1 \| Select-String -Pattern 'EPERM'` → 0 | Удалить весь блок `if (!HAS_BD) { … }` (`:64-73`) — 0 совпадений; при этом честное предупреждение исчезает. Падение тестов не ловится: `Select-String` не пробрасывает exit code |
| F-51 | `Select-String packages\**\src\*.ts -Pattern 'tokenMeter'` → ≥1 (было 0) | Добавить строку `// TODO: tokenMeter` в любой `packages/*/src/*.ts` — гейт зелёный, моста нет |
| F-49 | `"private": true` → 12, `"files"` → 12 | Сегодня ровно 12/12. Любой шаг, добавивший пакет (E-03 `worktree-adapter`, E-14 `gate-runner`, F-58 `packages/web`), ломает число; гейт — снимок корпуса, а не свойство |
| F-19 | `Select-String -Path packages\**\src\*.ts -Pattern 'openStore\('` → «0 вызовов без явного `migrations`» | Команда возвращает 11 строк (в основном JSDoc-комментарии: `evidence/src/index.ts:14`, `store.ts:8`, `schema.ts:135`). «0» недостижимо буквально; оценка требует глаз |
| F-41 | `node --test tests/boundaries.test.mjs` → `# fail 0` | Гейт зелёный и **до** правки: `FORBIDDEN` применён только к наборам contracts/core/storage/evidence (`tests/boundaries.test.mjs:111-124`) — там `@deepseek-ai/*` нет вовсе |
| E-01 | `(… Select-String -Pattern 'execFile\|spawnSync\|rev-parse\|worktree add' -SimpleMatch).Count` → 0 | `-SimpleMatch` отключает регулярку, поэтому ищется **литерал** `execFile\|spawnSync\|rev-parse\|worktree add`. Замер: тот же шаблон на `tests/beads-adapter.test.mjs` даёт 0 `-SimpleMatch` против **3** без него. Гейт не может стать красным, даже если в `packages/**/src` появится `spawnSync('git', …)` |
| E-42 | «`user_version` равен **полному** числу миграций (не пустой список)» | Требование сформулировано через само себя: «полное число» не задано числом, проверка сводится к «> 0» |
| F-27 | «отчёт с **объяснённым** числом `doneViolations`» | Объяснение — текст для человека; машинного критерия нет (7 либо «расхождение объяснено») |
| F-08 | «текст правила присутствует в `INDEX.md`, и F-27 воспроизводит список нарушителей» | Проверяется наличие прозы в markdown; любая формулировка проходит |
| F-58 | «панель видна в GUI **после перезагрузки страницы**» | Наблюдение человеком в браузере; требует установки нового плагина в живой профиль (вне границ кампании) |
| F-12 | «отступ — как у `plugin:`» (команда 3) | Сравнение отступов глазами |
| F-02 | `Test-Path "$env:BACKUP_ROOT\dsh-profile-<date>\profiles\web\cordis.patch.yml"` → True | `$env:BACKUP_ROOT` нигде не определён до шага 2; при пустом значении путь вырождается в `\dsh-profile-<date>\…` |
