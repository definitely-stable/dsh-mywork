# redteam-c-01 · Пространство версий миграций не распределено (блокер)

**Кто:** red-team C (независимый, кампания v0.3). **Дата:** 2026-09-27 ~01:50 (локальное).
**Ревизия плана, против которой сделана проверка** (SHA256, первые 16 знаков):

| Файл | sha256_16 | mtime | bytes |
|---|---|---|---|
| `01-MASTER-PLAN.md` | `870B9565CEAF22B6` | 01:47:11 | 73 484 |
| `20-STEPS-foundation.md` | `FF261966F4415669` | 01:44:57 | 306 507 |
| `21-STEPS-execution.md` | `70FCBA1A2A49E18E` | 01:49:56 | 240 360 |
| `22-STEPS-surface.md` | `3754E8C279C2DE68` | 01:46:33 | 251 457 |
| `23-STEPS-quality.md` | `92B3FC0E4BBD4C17` | 01:10:33 | 146 993 |
| `10-DECISIONS.md` | `6A83312A8293F58F` | 01:14:14 | 308 188 |

Файлы плана правятся прямо во время аудита (mtime сдвигается каждые 1–3 минуты), поэтому все ссылки ниже — на указанную ревизию.

---

## 1. Что установлено

**Одна база, один `user_version`, один список миграций.**

- `20-STEPS-foundation.md:767-787` (F-29): `openStore({ path, migrations: MYWORK_DATABASE_MIGRATIONS })` для `$DSH_HOME/dsh-mywork/state/controller.sqlite`; гейт — «`PRAGMA user_version` открытой базы → **6**; `schema_migrations` содержит 6 строк» (`:780`, `:785`).
- `20-STEPS-foundation.md:791-813` (F-30): «Поднять planner и evidence на `controller.sqlite` (**тот же файл, тот же полный список миграций**)» (`:806`); execution (claim saga) и scheduler — там же (`:807`).
- `20-STEPS-foundation.md:490-517` (F-18): `MYWORK_DATABASE_MIGRATIONS.map(m => m.version)` → `[1,2,3,4,5,6]`; `MYWORK_DATABASE_SCHEMA_VERSION` → `6`; `validateMigrations(...)` **не бросает** — требует строгой возрастающей уникальности версий.
- `evidence/foundation-11-migrations.md:13`: «1+2+1+1+1 = 6 миграций, версии 1,2,3,4,5,6 без пропусков и пересечений»; `:15` — «`version: 7` в репозитории НЕТ».
- `evidence/verify-b-11-steps-E-01-09.md:43`: «`validateMigrations` бросает `invalid-input` при неуникуальной версии (`storage/src/migrations.ts:117-119`: "migrations must be ordered by unique version")».

**Заявки на версии в текущей ревизии шагов:**

| Шаг | Версия | Объект | Где |
|---|---|---|---|
| F-36 | **7** | таблица `background_job` в `controller.sqlite` | `20-STEPS-foundation.md:954` |
| F-40 | **7** | условный `DELETE`-триггер для `artifacts`/`audit_events` | `20-STEPS-foundation.md:1059` («новая миграция версии 7 … версия 7 свободна») |
| E-04 (MW-021) | **7** | таблица `attempt_worktree` в `CLAIM_SAGA_MIGRATIONS` | `21-STEPS-execution.md:217`, `:223`; evidence `:226` — «`PRAGMA user_version` (= 7)» |
| E-17 (MW-024) | **8** | таблица `review_claim` | `21-STEPS-execution.md:463`, гейт `:474` |
| E-22 (MW-025) | **9** | таблица интеграции | `21-STEPS-execution.md:609` |
| E-33 (MW-065) | **10** | `agent_instance_provisioning` + `provisioning_step` | `21-STEPS-execution.md:704` |
| E-36 (MW-066) | **11** | `attempt_write_intent` + индекс | `21-STEPS-execution.md:756` |
| B-12 (MW-047) | **2** | таблицы `board_view`/`board_placement`/`board_revision` в `packages/storage/src/migrations.ts` | `22-STEPS-surface.md:626`, `:628`, `:648` |
| Q-12 (MW-030) | **не указана** | таблица `human_decisions` + индекс | `23-STEPS-quality.md:288-296` |

## 2. Почему это блокер, а не «мелкая правка»

1. **Версия 7 занята трижды** (F-36, F-40, E-04) в одном общем списке одной базы. `validateMigrations` отвергнет дубликат → F-29/F-30 (этап 2) физически не смогут открыть store после F-36+F-40, а E-04 (этап 4) добавит третью заявку в тот же список. Ни один из трёх шагов не оговаривает, что делит версию с другим; `10-DECISIONS.md:838` (D09) тоже пишет «миграция версии 7 (`background_job`)».
2. **Версия 2 у B-12 конфликтует с evidence v2**, которая уже занимает номер в том же каноническом списке (`evidence/foundation-11-migrations.md:7`: `evidence/src/schema.ts:140` — `version: 2`, name `artifact-audit`). B-12 меняет именно `packages/storage/src/migrations.ts` — то есть локальный список storage, который в композиции склеивается с evidence. Гейт B-12 «`Select-String … -Pattern 'version: 2'` находит миграцию» (`22-STEPS-surface.md:648`) пройдёт, но `validateMigrations` на полном списке упадёт.
3. **B-12 противоречит решению D-5/D08 по существу, а не только по номеру.** Требование B-12 — «`MYWORK_SCHEMA_VERSION` в собранном `lib` равен **2**» (`22-STEPS-surface.md:648`) и «`openStore()` на пустой БД даёт `user_version === 2`» (`:628`). При этом:
   - F-18 вводит `MYWORK_DATABASE_SCHEMA_VERSION = 6` и тест на него (`20-STEPS-foundation.md:510`);
   - D-5 мастера (`01-MASTER-PLAN.md:65`) называет дефектом именно то, что `MYWORK_SCHEMA_VERSION` не описывает базу;
   - `evidence/lead-05-storage.md:41`: «`MYWORK_SCHEMA_VERSION` перестаёт быть константой 1: либо считается от собранного реестра (→6), либо удаляется».
   То есть этап 5 откатывает контракт, введённый на этапе 2 в том же файле `packages/storage/src/migrations.ts`.
4. **Q-12 не называет номер версии вовсе** — единственная миграция этапа 5 без номера, при том что её шаг требует «после открытия store `SELECT name FROM sqlite_master WHERE name='human_decisions'` → одна строка» (`23-STEPS-quality.md:294`). Исполнитель выберет номер сам → ещё одна коллизия.
5. **Гейты этапов зафиксированы на несовместимых числах:** `= 6` (F-18/F-29/F-32), `= 7` (E-04), `= 8` (E-17), `= 10` (E-33), `= 2` (B-12). Проверить их одной последовательностью нельзя: к концу этапа 2 честная версия — 7 или 8, к концу этапа 4 — 11, к концу этапа 5 — 12+. F-32 при этом проверяет «версия схемы — 6» (`20-STEPS-foundation.md:856`), то есть гейт этапа 2 устаревает внутри самого этапа (F-36/F-40 идут после F-32).
6. **Этот класс дефекта уже поймал верификатор B** (`evidence/verify-b-11-steps-E-01-09.md:43`, «Блокер 1 — версия 7 занята трижды»), но тексты шагов не исправлены: на ревизии 01:44–01:49 все три заявки на v7 на месте. Значит исправление не «ещё не сделано случайно», а потеряно между верификацией и планом.

## 3. Что исправить (минимальный пакет)

1. Ввести **карту версий** — один блок в `20-STEPS-foundation.md` (F-18) и ссылку на него из `21/22/23-*`: `1…6` — существующие; `7` — `background_job` (F-36); `8` — триггеры retention (F-40); `9` — `attempt_worktree` (E-04); `10` — `review_claim` (E-17); `11` — интеграция (E-22); `12` — provisioning (E-33); `13` — write-intent (E-36); `14` — `board_view/board_placement/board_revision` (B-12); `15` — `human_decisions` (Q-12). Номера — пример; важно, чтобы они были **разные** и объявлены в одном месте.
2. B-12: заменить `version: 2` на номер из карты; убрать требование «`MYWORK_SCHEMA_VERSION` = 2» и заменить на «`MYWORK_DATABASE_SCHEMA_VERSION` = последний из карты» (согласовано с F-18/D-5).
3. Все гейты вида «`PRAGMA user_version` = N» переписать на «равен последней версии карты на этот момент» (или на конкретный номер из карты, но с оговоркой «на этой ревизии»).
4. Тест F-18 дополнить негативным кейсом: список с дубликатом версии → `invalid-input` (защита от повторения дефекта при добавлении новых миграций).
