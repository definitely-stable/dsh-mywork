# foundation-11: миграции MyWork — 5 списков, версии, version 7, openStore

## ПОДТВЕРЖДЕНО
- packages/storage/src/migrations.ts:91 — `MYWORK_MIGRATIONS = Object.freeze([OUTBOX_INBOX])` = 1 элемент; сам объект packages/storage/src/migrations.ts:50 `version: 1` (name `outbox-inbox`, :51).
- packages/storage/src/migrations.ts:94 — `MYWORK_SCHEMA_VERSION` вычисляется из последнего элемента списка (литерала версии нет).
- packages/evidence/src/schema.ts:138 — `EVIDENCE_MIGRATIONS = Object.freeze([` — ровно ДВА элемента, закрытие списка :153.
- packages/evidence/src/schema.ts:140 — `version: 2` (первый элемент, name = EVIDENCE_TABLES_MIGRATION_NAME :141).
- packages/evidence/src/schema.ts:147 — `version: EVIDENCE_SCHEMA_VERSION` (ПОСЛЕДНИЙ элемент списка) = packages/evidence/src/schema.ts:26 `EVIDENCE_SCHEMA_VERSION = 3`.
- ИТОГ по ключевому вопросу: ДА — EVIDENCE_MIGRATIONS = версии 2 И 3. Точные якоря: version 2 → packages/evidence/src/schema.ts:140; version 3 → packages/evidence/src/schema.ts:147 (значение из :26); последний элемент списка = :147.
- packages/lease/src/schema.ts:66 — `LEASE_MIGRATIONS = Object.freeze([` = 1 элемент; packages/lease/src/schema.ts:68 `version: LEASE_SCHEMA_VERSION`; значение packages/lease/src/schema.ts:22 `LEASE_SCHEMA_VERSION = 4`.
- packages/planner/src/schema.ts:148 — `PLAN_MUTATION_MIGRATIONS = Object.freeze([` = 1 элемент; packages/planner/src/schema.ts:150 `version: PLAN_MUTATION_SCHEMA_VERSION`; значение packages/planner/src/schema.ts:36 `PLAN_MUTATION_SCHEMA_VERSION = 5`.
- packages/execution/src/schema.ts:153 — `CLAIM_SAGA_MIGRATIONS = Object.freeze([` = 1 элемент; packages/execution/src/schema.ts:155 `version: CLAIM_SAGA_SCHEMA_VERSION`; значение packages/execution/src/schema.ts:48 `CLAIM_SAGA_SCHEMA_VERSION = 6`.
- Сводка: 1+2+1+1+1 = 6 миграций, версии 1,2,3,4,5,6 без пропусков и пересечений (ядро владеет schema_migrations, см. packages/storage/src/migrations.ts:97-103).
- `Select-String -Path H:\Repo\DSH-MyWork\packages\*\src\*.ts -Pattern "version: 7"` exit 0, вывод «SRC matches: 0»; та же команда по `packages\*\tests\*.ts` — «TESTS matches: 0».
- Расширенный поиск `Get-ChildItem H:\Repo\DSH-MyWork -Recurse -File -Include *.ts,*.mjs,*.js,*.json,*.md` (искл. node_modules, lib, .git, .pnpm-store) + `Select-String -Pattern "version:\s*7\b"` exit 0, вывод пустой → миграции версии 7 в репозитории НЕТ (максимум 6).
- openStore(: команда по `packages/*/src/*.ts` → «SRC openStore matches: 11»; по `packages/*/tests/*.ts` → «TESTS openStore matches: 0» (каталога tests внутри пакетов не существует).
- openStore( по существующему дереву: `packages` (все *.ts вне node_modules/lib) = 11; `H:\Repo\DSH-MyWork\tests` (repo-root, *.mjs) = 45. Разбивка tests: storage.test.mjs 22, lease.test.mjs 8, claim-saga.test.mjs 4, evidence.test.mjs 4, plan-mutation.test.mjs 4, storage-crash.test.mjs 3.

## ОПРОВЕРГНУТО / УТОЧНЕНО
- Уточнение к команде из вопроса: каталога `packages/*/tests/` в репозитории нет — тесты лежат в H:\Repo\DSH-MyWork\tests\*.mjs (29 файлов + tests\lib\). Поэтому «0» во второй команде — не отсутствие вызовов, а неверный путь; фактическое второе число = 45.
- В 4 из 5 списков версии записаны НЕ литералами: version: LEASE_SCHEMA_VERSION (:68), PLAN_MUTATION_SCHEMA_VERSION (:150), CLAIM_SAGA_SCHEMA_VERSION (:155), EVIDENCE_SCHEMA_VERSION (:147). Литералы есть только у packages/storage/src/migrations.ts:50 (1) и packages/evidence/src/schema.ts:140 (2). Grep по `version: 7` структурно не мог бы найти будущие версии, записанные через константу.
- Из 11 совпадений `openStore(` в packages только одно — реальный вызов (packages/storage/src/store.ts:83); остальные 10 — в комментариях-docblock (evidence/src/index.ts:14, evidence/src/schema.ts:135, evidence/src/store.ts:8, execution/src/index.ts:18, execution/src/schema.ts:28, lease/src/index.ts:13, lease/src/schema.ts:14, planner/src/index.ts:17, planner/src/schema.ts:16, storage/src/index.ts:6). То же смещение применимо к числу 45 в tests (там вызовы реальные, но разбивка по файлам дана выше).

## НЕ ПРОВЕРЕНО
- Не запускал `validateMigrations`/`runMigrations` и не открывал никакой SQLite реально — все шесть версий выведены статически из исходников; фактический `PRAGMA user_version` на диске не читал.
- Не проверял tests/plan-mutation/claim-saga на ожидание конкретного номера версии (например, ассерты `MYWORK_SCHEMA_VERSION === N`) — вне заданного объёма.
- Не поднимал statuses/содержимое иных баз: DSH-платформа C:\Reposit\deepseek-harness\deepseek-harness и профиль C:\Users\Dmitry\.dsh\profiles\web не читались (в вопросе не требовались).

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-11-migrations.md
