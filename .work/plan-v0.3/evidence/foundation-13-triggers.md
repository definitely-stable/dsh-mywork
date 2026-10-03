# Триггеры, запрещающие DELETE/UPDATE на artifacts и audit_events (MyWork, read-only)

## ПОДТВЕРЖДЕНО
- CMD Select-String -Path H:\Repo\DSH-MyWork\packages\evidence\src\*.ts -Pattern "CREATE TRIGGER|RAISE\(|BEFORE DELETE|BEFORE UPDATE|AFTER UPDATE|DROP TRIGGER" → SUCCESS=True, MATCHES=12, полный вывод:
- packages/evidence/src/schema.ts:65 + :67 — CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts → SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
- packages/evidence/src/schema.ts:70 + :72 — CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts → SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
- packages/evidence/src/schema.ts:92 + :94 — CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events → SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
- packages/evidence/src/schema.ts:97 + :99 — CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events → SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
- packages/evidence/src/schema.ts:115 + :118 — CREATE TRIGGER IF NOT EXISTS artifacts_no_replace BEFORE INSERT ON artifacts (WHEN EXISTS ... artifact_id = NEW.artifact_id) → SELECT RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}');
- packages/evidence/src/schema.ts:121 + :124 — CREATE TRIGGER IF NOT EXISTS audit_events_no_replace BEFORE INSERT ON audit_events (WHEN EXISTS ... audit_id = NEW.audit_id) → SELECT RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}');
- packages/evidence/src/schema.ts:47-61 — CREATE TABLE artifacts (...) STRICT: :48 artifact_id TEXT PRIMARY KEY, :49 hash TEXT NOT NULL, :50 kind TEXT NOT NULL, :51 workspace_id TEXT NOT NULL, :52 correlation_id TEXT NOT NULL, :53 content_type TEXT NOT NULL, :54 size INTEGER NOT NULL, :55 created_at INTEGER NOT NULL, :56 task_id TEXT, :57 attempt_id TEXT, :58 review_id TEXT, :59 causation_id TEXT, :60 bytes BLOB NOT NULL
- packages/evidence/src/schema.ts:75-88 — CREATE TABLE audit_events (...) STRICT: :76 position INTEGER PRIMARY KEY AUTOINCREMENT, :77 audit_id TEXT NOT NULL UNIQUE, :78 type TEXT NOT NULL, :79 workspace_id TEXT NOT NULL, :80 correlation_id TEXT NOT NULL, :81 occurred_at INTEGER NOT NULL, :82 task_id TEXT, :83 attempt_id TEXT, :84 review_id TEXT, :85 agent_id TEXT, :86 artifact_id TEXT, :87 causation_id TEXT — BLOB-колонок в audit_events нет
- packages/evidence/src/schema.ts:63 artifacts_workspace ON artifacts(workspace_id, created_at); packages/evidence/src/schema.ts:90 audit_events_workspace ON audit_events(workspace_id, position)
- packages/evidence/src/schema.ts:138-153 — EVIDENCE_MIGRATIONS: version 2 (:140) name EVIDENCE_TABLES_MIGRATION_NAME='artifact-audit' (:32) → exec(EVIDENCE_TABLES_DDL) (:143); version EVIDENCE_SCHEMA_VERSION=3 (:26, :147) name EVIDENCE_SCHEMA_NAME='evidence-immutability' (:29, :148) → exec(EVIDENCE_REPLACE_GUARDS_DDL) (:150)
- CMD node -e "import('file:///H:/Repo/DSH-MyWork/packages/evidence/lib/index.js') … EVIDENCE_MIGRATIONS[i].up({exec})" → MIGRATION 2 artifact-audit: RAISE(ABORT, 'mywork.artifact.immutable') и RAISE(ABORT, 'mywork.audit.append-only') (маркеры :35, :38 подставлены); MIGRATION 3 evidence-immutability: те же маркеры, триггеры IF NOT EXISTS
- CMD Select-String -Path H:\Repo\DSH-MyWork\packages\*\src\*.ts,H:\Repo\DSH-MyWork\tests\*.mjs -Pattern "DELETE FROM" → MATCHES=5, ни одного на artifacts/audit_events в src: packages/execution/src/store.ts:259 (claim_step), packages/lease/src/lease.ts:256 (controller_lease), packages/planner/src/store.ts:312 (plan_mutation_step)
- tests/evidence.test.mjs:278 DELETE FROM artifacts WHERE artifact_id = ? и tests/evidence.test.mjs:442 DELETE FROM audit_events — обе обёрнуты в databaseRefusal(...) с ожиданием ARTIFACT_IMMUTABLE_MARKER / AUDIT_APPEND_ONLY_MARKER, т.е. кода, реально удаляющего эти строки, нет
- tests/evidence.test.mjs:161-171 — на живой БД ожидается ровно 6 триггеров (artifacts/audit_events × no_delete/no_replace/no_update); tests/evidence.test.mjs:244 DROP TRIGGER artifacts_no_update — единственное вхождение в репозитории, только в тесте подмены байтов
- CMD node -e "require('node:sqlite') …" → recursive_triggers default = {"recursive_triggers":0}; REPLACE при одном delete-guard: SUCCEEDED {"id":"a","v":"2"} — обоснование BEFORE INSERT-гарда (:103-113) воспроизведено

## ОПРОВЕРГНУТО / УТОЧНЕНО
- УТОЧНЕНО: «соединение работает с recursive_triggers = 0» (packages/evidence/src/schema.ts:10, :106) нигде не выставляется кодом: grep "recursive_triggers" по packages дал только эти два комментария, а packages/storage/src/sql.ts:127-139 ставит лишь foreign_keys=ON и journal_mode=WAL — это дефолт SQLite, подтверждено node -e.
- УТОЧНЕНО: EVIDENCE_MIGRATIONS не композируется ни в одном рантайм-пути репозитория — только в tests/evidence.test.mjs:45, :457, :459, tests/plan-mutation.test.mjs:106, tests/claim-saga.test.mjs:72 и в doc-комментариях; в корне репо нет src/, apps/, bin/ (только packages, scripts, tests, .tmp), т.е. entry point, применяющего эти триггеры, в репозитории отсутствует.
- УТОЧНЕНО: в живом профиле триггеры неактивны — C:\Users\Dmitry\.dsh\profiles\web\node_modules не содержит @dsh-mywork / dsh-mywork, команда поиска дала пустой вывод, exit code 1.
- Дополнительно (не опровержение): других CREATE TRIGGER на artifacts/audit_events в packages нет — только packages/lease/src/schema.ts:58 и packages/execution/src/schema.ts:145 на своих таблицах; в packages/evidence/lib/index.js:75-133 тот же DDL, что в src (паритет сборки).

## НЕ ПРОВЕРЕНО
- Не запускал tests/evidence.test.mjs и полный прогон (запрет) — факт отказа БД при DELETE/UPDATE подтверждён кодом тестов, а не прогоном.
- Не проверял на реальном .db-файле: в репозитории и профиле нет БД с применёнными миграциями 2/3, живого экземпляра схемы не нашёл.
- Не смотрел C:\Reposit\deepseek-harness\deepseek-harness и не проверял, вызывает ли платформа миграции MyWork (вопрос был про MyWork, связка вне репозитория).
- Удаление строк artifacts/audit_events искал только по заданным маскам (packages\*\src\*.ts, tests\*.mjs); .work/, .analysis/, .tmp/ и документацию на этот шаблон не сканировал.
