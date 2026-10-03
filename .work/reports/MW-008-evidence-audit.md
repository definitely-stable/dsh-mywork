# MW-008 — Добавить Artifact Store и append-only Audit

- Предмет: карточка доски `6b9f3654-8fdb-4422-851f-bf0976c71156` (MW-008), этап `00-foundation`, обязательные пункты §62 — 30, 31
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e` (HEAD на старте реализации)
  - собственных коммитов нет: коммит не поручался; head = рабочее дерево поверх `fbee7a0`
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, Windows, pwsh
- Статус: **DONE** — Artifact Store §32 и append-only Audit §34 реализованы; `pnpm run check` = exit 0, **173 pass / 0 fail** в основном дереве и **167 pass / 0 fail** в изолированной замороженной копии (разница — тесты, дописанные параллельной сессией MW-007 уже после снятия копии); новые тесты карточки — 19, все зелёные. Статус переведён из `READY_FOR_REVIEW` в `DONE` по прямому указанию владельца (сессия MW-020); акт приёмки — это указание, а не вывод автора.
- Независимое ревью: **PASS WITH FINDINGS** (1 MAJOR + 3 MINOR + 2 NIT) — все находки исправлены (§8.3).
- Независимая проверка исправлений: **FIXES VERIFIED** — все шесть находок закрыты; три остаточных дефекта самих правок (1 MINOR + 2 NIT) тоже исправлены (§8.4).
- Числа — снимок замороженной копии `.tmp/mw008-verify`. В живом дереве параллельно работает сессия MW-007 и дописывает свои тесты, поэтому общее число объявлений там больше.

---

## 1. Проверка зависимостей

| Зависимость | Как проверено | Результат |
|---|---|---|
| **MW-004** | отчёт `reports/MW-004-storage.md` (`DONE`, ревью-статус снят владельцем); исходники `packages/storage/src` (10 файлов); коммиты `a032a30`…`7ebb7b8` | предусловие пройдено |
| **MW-007** | отчёт `reports/MW-007-security.md` — `READY_FOR_REVIEW`; исходники `packages/contracts/src/security.ts`, `packages/core/src/security.ts`, `tests/security.test.mjs`; `pnpm run check` → **exit 0** на момент gate | предусловие пройдено с оговоркой |

Оговорки, названные явно:

1. **Формальной приёмки владельца нет ни у MW-006, ни у MW-007** (`READY_FOR_REVIEW`). Работа продолжена по прямому указанию владельца в сессии («продолжи») и по проверенным артефактам — то же основание, по которому исполнитель MW-007 продолжил поверх MW-006.
2. **Ловушка «файл отчёта есть — значит сделано» не сработала.** `.work\reports\MW-007-security.md` на момент первой проверки **существовал**, но содержал `BLOCKED` и строку «код MW-007 не писался». Gate проверялся по исходникам, а не по наличию файла (§10).
3. **Живой писатель.** MW-007 писался параллельной сессией: `packages/contracts/src/security.ts` записан за 1 секунду до замера (01:16:37 при времени 01:16:38). Реализовывать MW-007 самому было нельзя — это была бы запись в чужие незакоммиченные файлы.

---

## 2. Сделано

### 2.1 Контракты (§32, §33, §34)

| Файл | Содержимое |
|---|---|
| `packages/contracts/src/artifact.ts` (167) | `ARTIFACT_SCHEMA`; `ArtifactKind` + `ARTIFACT_KINDS` — 11 типов §32; `ArtifactMetadata` + закрытый `ARTIFACT_METADATA_FIELDS`; `ArtifactRef` + `ARTIFACT_REF_FIELDS`; `ArtifactPutRequest` + `ARTIFACT_PUT_REQUEST_FIELDS`; `Artifact` |
| `packages/contracts/src/audit.ts` (113) | `AUDIT_SCHEMA`; `AuditEventType` + `AUDIT_EVENT_TYPES` — 11 имён §34; закрытый `AUDIT_ENTRY_FIELDS`; `AuditEntry`, `AuditRecord` (+ `position`) |
| `packages/contracts/src/ids.ts` | `ArtifactId`, `AuditId` (аддитивно) |
| `packages/contracts/src/index.ts` | два новых экспорта (в файле есть и правка MW-007) |

Ни в одной схеме нет свободнотекстового поля: детали лежат в артефакте, audit ссылается на него по `artifactId` — разделение §8 («сводка в MyWork DB, текст в Artifact Store»). Необъявленное поле — отказ, а не запись.

### 2.2 Новый пакет `@dsh-mywork/evidence`

| Файл | Содержимое |
|---|---|
| `src/schema.ts` (136) | **Две** миграции: **v2** `artifact-audit` — таблицы `artifacts` и `audit_events` (**STRICT**) и четыре триггера `*_no_update`/`*_no_delete`; **v3** `evidence-immutability` — два триггера `*_no_replace` (BEFORE INSERT, `WHEN EXISTS …`, `IF NOT EXISTS`). Маркеры `mywork.artifact.immutable`, `mywork.audit.append-only`; `EVIDENCE_SCHEMA_VERSION = 3` |
| `src/artifacts.ts` (216) | `putArtifact` / `getArtifact` / `sha256Hex`: идемпотентный повтор (те же байты и описание → `created: false`), конфликт при расхождении, чтение пересчитывает SHA-256 и сверяет и с ref, и со строкой |
| `src/audit.ts` (184) | `appendAuditEntry` / `readAuditLog` (+ фильтры workspace/type/limit): идемпотентность по `auditId`, `audit-conflict` при противоречии, позиция из `last_insert_rowid()` |
| `src/metadata.ts` (327) | Валидаторы закрытых схем (форма идентификатора, media type, hex-SHA-256, safe integer, членство в словаре) + скан известных форм секретов в двух записях провайдерских ключей |
| `src/store.ts` (123) | `createArtifactStore` / `createAuditLog` поверх структурного `EvidenceStore`; проверка применённой миграции (`schema-missing` в точке сборки); инъекция часов |
| `src/errors.ts` (68), `src/index.ts` (48) | Свой словарь кодов и публичная поверхность |

Ключевые решения:

1. **Иммутабельность обеспечивает база, и против всех форм записи.** `UPDATE`/`DELETE` абортятся триггерами, а `BEFORE INSERT … WHEN EXISTS` закрывает `INSERT OR REPLACE` — иначе REPLACE переписал бы строку через путь, который **не** вызывает delete-триггер: ядро открывает БД с `recursive_triggers = 0` (`packages/storage/src/sql.ts`). Это была реальная дыра, найденная ревью (F1).
2. **Защита живёт в отдельной миграции (v3), а не в правке v2.** Применённую миграцию не редактируют: БД, созданная прежней сборкой, молча осталась бы без guard'ов. Отдельная версия доводит такую БД до того же состояния, что и свежую, — и это проверено тестом (N-2).
3. **Audit — таблица, а не лог.** §34 («Audit ≠ log») реализован буквально: аудит пишется в durable SQLite, поэтому ротация логов не имеет файла, который можно усечь.
4. **Durable, а не файловый CAS.** Байты лежат в BLOB той же БД: атомарность с метаданными, никакой новой поверхности для path-escape; WAL и транзакции — из ядра MW-004.
5. **`storage` — зависимость только по типам** (`import type`), поэтому в бандле остаются только `node:*`; композицию миграций делает вызывающий. Закреплено проверкой границ.
6. **Fail-fast:** фабрики проверяют схему и отвечают `schema-missing` в точке сборки, а не SQL-ошибкой позже.

### 2.3 Тесты и границы

- `tests/evidence.test.mjs` (505 строк, **19 тестов**).
- `tests/boundaries.test.mjs` (+91 строка, **4 проверки**): разрешённые импорты слоя; **запрет value-импорта `@dsh-mywork/storage`**; отсутствие runtime-зависимостей в манифесте; домен не импортирует evidence; самодостаточность бандла.
- `tests/lib/fixtures.mjs` (+4 строки): сборка evidence.

---

## 3. Изменённые и новые файлы

Новые (этой карточки):

```text
packages/contracts/src/artifact.ts     167   packages/evidence/src/metadata.ts   327
packages/contracts/src/audit.ts        113   packages/evidence/src/artifacts.ts  216
packages/evidence/src/schema.ts        136   packages/evidence/src/audit.ts      184
packages/evidence/src/errors.ts         68   packages/evidence/src/store.ts      123
packages/evidence/src/index.ts          48   tests/evidence.test.mjs             505
packages/evidence/package.json  tsconfig.json  tsdown.config.ts
```

Изменённые:

```text
 packages/contracts/src/ids.ts       |   6 ++     (ArtifactId, AuditId)
 packages/contracts/src/index.ts     |   3 ++     (2 моих экспорта + 1 правка MW-007)
 tests/boundaries.test.mjs           |  91 +++    (+4 проверки слоя evidence)
 tests/lib/fixtures.mjs              |   4 ++     (сборка evidence)
 tsconfig.base.json                  |   1 +      (path @dsh-mywork/evidence)
 pnpm-lock.yaml                      |  импортёр packages/evidence
```

Чужие файлы не изменялись: незакоммиченная работа параллельной сессии по MW-007 (`packages/contracts/src/security.ts`, `packages/core/src/security.ts`, `tests/security.test.mjs`, `packages/contracts/src/team.ts`, `packages/core/src/index.ts`, `README.md`) и каталоги `.analysis/`, `.dsh/`, `.forge/` не тронуты. Все прогоны проверок и мутаций выполнялись в изолированной копии `.tmp/mw008-verify` (`git worktree add --detach`): соседняя сессия однажды уже удалила `packages/evidence/lib` своей сборкой с `clean: true` в момент моей проверки.

---

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` / `git status --porcelain` (старт) | 0 | `fbee7a0…`; в дереве незакоммиченная работа MW-007 (не моя) |
| `pnpm run check` на дереве MW-007 (gate) | 0 | **138 pass / 0 fail** — dependency пройдена (на момент gate) |
| `pnpm install` | 0 | 7 workspace-проектов, `Lockfile passes supply-chain policies (69 entries)` |
| `pnpm --filter @dsh-mywork/evidence run typecheck` | 0 | strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `pnpm --filter @dsh-mywork/evidence run build` | 0 | `tsdown` → `lib/index.js` + `.d.ts` |
| `node --test --test-isolation=none tests/evidence.test.mjs` | 0 | **19 pass / 0 fail** |
| `pnpm run check` (изолированная копия, итог) | **0** | smoke `all steps passed`, **167 pass / 0 fail** |
| `pnpm run check` (основное дерево, финальный) | **0** | smoke `all steps passed`, **173 pass / 0 fail** (включая тесты, дописанные соседней сессией) |
| проба ревьюера `.tmp/mw008-review/probe.mjs` до исправления | 0 | `[P1] BYPASS`, `[P2] BYPASS`, `[P4] … sk_live_… ACCEPTED` |
| та же проба после исправлений | 0 | `[P1] BLOCKED` (`mywork.artifact.immutable`), `[P2] BLOCKED` (`mywork.audit.append-only`), `[P4] … REFUSED secret-material`, `[P6] OK` |
| mutation-check A–F (изолированная копия) | 1 каждая | §7 |
| восстановление бандла после каждой мутации | 0 | **19 pass / 0 fail**, якоря триггеров на месте |

Изолированная копия: `git worktree add --detach .tmp/mw008-verify fbee7a0`, поверх скопировано рабочее дерево, свой `node_modules` и своя сборка.

---

## 5. Приёмка: пункт → проверка

| Пункт приёмки карточки | Тест |
|---|---|
| «Повторная запись с иным содержимым не перезаписывает artifact» | `a second write under the same id with other bytes is refused and changes nothing`, `rewriting the same artifact with the same evidence is idempotent`, `the database itself refuses to rewrite or delete an artifact`, `a REPLACE that would rewrite a row is refused, not applied` |
| «хеш проверяется при чтении» | `a read verifies the stored bytes against the hash they are stored under`, `a reference naming another hash is refused, and an unknown id is not found` |
| «секреты не попадают в метаданные» | `secret material has no way into the artifact metadata` (PEM, JWT, `AKIA…`, `sk-live-…`, `sk_live_…`, `sk_test_…`, `name=value`, необъявленное поле, не-media-type) |
| «Audit переживает restart и log rotation» | `the audit survives a restart`, `the audit survives log rotation because it is not a log file` |
| Объём: append-only audit §34 | `the audit appends §34 events and reads them back in order`, `every §34 event type is accepted and an unknown one is refused` (с не-вакуумной проверкой «11 имён»), `retrying an audit row is a no-op, and contradicting it is refused`, `the database itself refuses to rewrite or delete an audit row` |
| Объём: evidence с workspace/task/attempt/correlation ID | `an artifact round-trips with its identity, its metadata, and its hash` |
| Объём: «отделить audit от обычной ротации логов» | `the audit survives log rotation…`: в каталоге нет файлов, кроме БД и её WAL-спутников; после усечения и удаления лог-файла аудит на месте |
| Схема, миграция, границы, типы значений | `the evidence schema is applied up to version 3 with its journal row` (журнал `[1 outbox-inbox, 2 artifact-audit, 3 evidence-immutability]`, шесть триггеров), `a database created before the replace guards reaches them by migration`, `opening a database without the evidence migration fails where it is wired`, `the evidence tables reject a value of the wrong type instead of coercing it` |
| Обратная сторона fail-closed: законные id не блокируются | `legitimate identifiers are not mistaken for secrets` (`sk_workspace_alpha_1`, `task-sk-1234`, `ev-1`, `W-1`, `commit-<40 hex>` приняты) |

---

## 6. Evidence

### 6.1 Полный конвейер (изолированная копия)

```text
$ pnpm install
Scope: all 7 workspace projects
✓ Lockfile passes supply-chain policies (69 entries)
INSTALL_EXIT=0

$ pnpm run check
smoke: all steps passed
ℹ tests 167   ℹ pass 167   ℹ fail 0
WT_CHECK_EXIT=0
```

### 6.2 Новые тесты (19)

```text
✔ the evidence schema is applied up to version 3 with its journal row
✔ an artifact round-trips with its identity, its metadata, and its hash
✔ a second write under the same id with other bytes is refused and changes nothing
✔ rewriting the same artifact with the same evidence is idempotent
✔ a read verifies the stored bytes against the hash they are stored under
✔ a reference naming another hash is refused, and an unknown id is not found
✔ the database itself refuses to rewrite or delete an artifact
✔ secret material has no way into the artifact metadata
✔ legitimate identifiers are not mistaken for secrets              # после N-1
✔ a database created before the replace guards reaches them by migration   # после N-2
✔ the audit appends §34 events and reads them back in order
✔ every §34 event type is accepted and an unknown one is refused
✔ retrying an audit row is a no-op, and contradicting it is refused
✔ the database itself refuses to rewrite or delete an audit row
✔ the audit survives a restart
✔ the audit survives log rotation because it is not a log file
✔ a REPLACE that would rewrite a row is refused, not applied       # после F1
✔ opening a database without the evidence migration fails where it is wired
✔ the evidence tables reject a value of the wrong type instead of coercing it
ℹ tests 19   ℹ pass 19   ℹ fail 0
```

### 6.3 Как проверяется «хеш при чтении»

Тест не доверяет API: он **портит строку в обход защиты** (снимает триггер и перезаписывает BLOB), после чего `get` обязан отказать. SHA-256 в тестах считается **независимо** (`node:crypto` в самом тесте), а не функцией пакета.

### 6.4 Изоляция

Все БД — в свежих каталогах `mkdtemp` под `os.tmpdir()` с префиксом `dsh-mywork-evidence-`; `after()` удаляет **только** созданные этим набором каталоги, проверяя префикс перед удалением; сверяется fingerprint живого `$DSH_HOME/dsh-mywork` до и после. Живой профиль DSH **не изменяется**; читается только read-only fingerprint (`existsSync`/`readdirSync`), записи нет. Падающий прогон может оставить временный каталог (открытый handle на Windows) — `after()` в этом случае печатает предупреждение, а не молчит; зелёный прогон не оставляет ничего.

---

## 7. Mutation-check (проверка, что тесты не вакуумные)

Мутации вносятся в **собранный** бандл изолированной копии, исходники не меняются; драйвер `.tmp/evidence-mutate.mjs`, якоря берутся из бандла.

| # | Что сломано в бандле | Результат |
|---|---|---|
| A | скан секретов: `if (pattern.test(value))` → `false` | 18 pass / **1 fail** — `secret material has no way into the artifact metadata` |
| B | проверка хеша при чтении → `false` | 18 pass / **1 fail** — `a read verifies the stored bytes against the hash they are stored under` |
| C | `if (sameArtifact(stored, metadata))` → `true` | 18 pass / **1 fail** — `a second write under the same id with other bytes is refused…` |
| D | тело `artifacts_no_update` → `SELECT 1` (имя сохранено) | 18 pass / **1 fail** — `the database itself refuses to rewrite or delete an artifact` |
| E | тело `audit_events_no_delete` → `SELECT 1` (имя сохранено) | 18 pass / **1 fail** — `the database itself refuses to rewrite or delete an audit row` |
| F | условие `artifacts_no_replace` → `WHEN 0` (имя сохранено) | 17 pass / **2 fail** — `a REPLACE that would rewrite a row is refused, not applied` и `a database created before the replace guards reaches them by migration` (оба теста держат этот guard) |

После каждой мутации бандл восстанавливался из бэкапа; доказательство восстановления — **19 pass / 0 fail** и якоря триггеров на месте.

**Два урока, которые стоит сохранить.** Первая редакция D/E только *переименовывала* триггеры, поэтому падали проверки имени, а не поведенческие тесты (находка F3 ревью). Попытка сделать тело «тихим» через `RAISE(IGNORE, '…')` оказалась невалидным SQL — падали 16 тестов из 17, потому что не собиралась схема, и такое «доказательство» не стоит ничего. Корректная форма — валидное тело-заглушка `SELECT 1` при сохранённом имени. Мутация, ломающая больше, чем проверяемое свойство, — это не доказательство.

---

## 8. Независимое ревью и исправления

### 8.1 Как проводилось

По указанию владельца запущен отдельный субагент со свежим контекстом (`3fcf529b…`), read-only, с мандатом на состязательную проверку и словарём `PASS` / `PASS WITH FINDINGS` / `FAIL`. Ему переданы: перечень файлов автора, восемь утверждений для опровержения, изолированная копия для прогонов без гонки с соседней сессией и драйвер мутаций для самостоятельной перепроверки. Ревьюер вёл собственные пробы (`.tmp/mw008-review/probe*.mjs`, `strong-mutations.mjs`, `fix-semantics.mjs`) и исходники не менял.

### 8.2 Вердикт

**PASS WITH FINDINGS** — приёмка карточки проходит по исходникам и независимым пробам; одна **заявленная** инварианта опровергнута (F1), остальное — MINOR/NIT. Ревьюер воспроизвёл числа отчёта, перепроверил все пять прежних мутаций, подтвердил границы слоя, соответствие §32/§34 построчно и process-честность (§1, §9).

### 8.3 Находки ревью и что сделано

| # | Severity | Находка | Исправление и доказательство |
|---|---|---|---|
| **F1** | **MAJOR** | Триггеры покрывали только `UPDATE`/`DELETE`, а при `recursive_triggers = 0` `INSERT OR REPLACE` (обычный DML, без DDL) переписывает строку: проба показала подмену байтов артефакта и строки аудита | Добавлены `artifacts_no_replace` и `audit_events_no_replace` (BEFORE INSERT, `WHEN EXISTS …`). **Проба ревьюера после правки:** `[P1] BLOCKED :: INSERT OR REPLACE threw=Error: mywork.artifact.immutable; get(forged ref)=THREW hash-mismatch; put(original) -> created=false`; `[P2] BLOCKED :: … threw=Error: mywork.audit.append-only; rows=[["au-1","task.created",1]]`. Добавлен регрессионный тест и мутация F |
| **F2** | MINOR | Шаблон `provider-key` ловил только дефисную запись: `sk_live_…`/`sk_test_…` принимались, а тест использовал дефисную форму и «проходил» | Добавлена вторая запись шаблона; кейсы `sk_live_…`, `sk_test_…` в тесте секретов. Проба ревьюера: `artifactId="sk_live_a1B2…" -> REFUSED secret-material`, `rows stored=0` |
| **F3** | MINOR | Мутации D/E только переименовывали триггеры, то есть доказывали проверки имени, а не защиту | Драйвер переведён на глушение **тела** (`SELECT 1`, имя сохранено); D и E валят ровно адресные тесты (§7) |
| **F4** | MINOR | §33 объявляет 11 correlation-измерений; в таблицах нет `sessionId`, `roleRevision`, `workflowRevision`, `controllerInstance` | Осознанно **отложено** и записано в §9.2; обоснование («добавление nullable-колонки не переписывает строки») проверено экспериментом независимого верификатора: `ALTER TABLE ADD COLUMN` ×4 на заполненной БД — строки бит-в-бит те же, `page_count` 15→15, триггеры целы, миграция v3 через раннер даёт журнал `[1,2,3]` |
| **F5** | NIT | `assert.equal(audit.read().length, AUDIT_EVENT_TYPES.length)` прошёл бы на пустом словаре | Добавлена проверка `assert.equal(contracts.AUDIT_EVENT_TYPES.length, 11)`; верификатор подтвердил экспериментом: без неё цикл вакуумен |
| **F6** | NIT | Отчёт утверждал, что живой профиль «не читался», тогда как тест читает его fingerprint | Формулировка §6.4 уточнена; в самом тесте шапка тоже поправлена (N-3) |

### 8.4 Независимая проверка исправлений

Запущен отдельный субагент в режиме `verify-fixes` (`11b716aa…`, read-only): пройти по F1–F6, воспроизвести **поведение**, а не описание, и поискать дефекты, внесённые правками. Его вердикт — **FIXES VERIFIED**:

- F1 подтверждён не только на `INSERT OR REPLACE`, а на **16 формах записи**: `REPLACE INTO`, UPSERT `DO UPDATE`/`DO NOTHING`, `UPDATE OR REPLACE`, `UPDATE … FROM`, `DELETE`, `INSERT … SELECT`, мультистрочный `INSERT` с коллизией — все `BLOCKED+INTACT` (строка артефакта бит-в-бит та же, строка аудита сохраняет `type` и `position`); защита переживает переоткрытие БД. `INSERT OR IGNORE` по существующему id тоже бросает (fail-closed, легальных путей не касается).
- F3: D/E/F дают ровно один адресный отказ каждая, восстановление доказано SHA бандла и прогоном `19/0`.
- F5: обнуление `AUDIT_EVENT_TYPES` в бандле валит ровно один тест; вариант теста без строки 337 — вакуумен, то есть проверка реально держит.
- F6: `C:\Users\Dmitry\.dsh\dsh-mywork` `exists=False` до и после полного `check`.
- Исходники == бандл: пересборка байт-в-байт, live == frozen == rebuilt.

**Три остаточных дефекта самих правок — все исправлены:**

| # | Severity | Дефект правки | Исправление |
|---|---|---|---|
| **N-1** | MINOR | Расширенный шаблон `sk[-_]…` отклонял как секрет законный id вида `sk[-_]` + 16 символов (`sk_workspace_alpha_1`, `corr-sk_live_local_12345`) | Шаблон разделён на два: `/\bsk-[A-Za-z0-9_-]{16,}\b/` (дефисная запись, включая `sk-proj-…`) и `/\bsk_(?:live\|test)_[A-Za-z0-9_-]{16,}\b/` (underscore-провайдеры). Оба FP сняты, 6/6 прежних детекций сохранены (в т.ч. секрет с `-`/`_` в хвосте, который теряла альтернатива верификатора). Добавлен тест `legitimate identifiers are not mistaken for secrets` |
| **N-2** | NIT | DDL миграции **v2** был изменён без подъёма версии: БД, созданная прежней сборкой, осталась бы без `*_no_replace` (верификатор воспроизвёл остаточную дыру) | Guard'ы вынесены в **отдельную миграцию v3** `evidence-immutability` с `CREATE TRIGGER IF NOT EXISTS`; `EVIDENCE_SCHEMA_VERSION = 3`. Добавлен тест `a database created before the replace guards reaches them by migration`: БД, открытая только с v2 (четыре триггера), после открытия с полным списком получает guard'ы и отклоняет `INSERT OR REPLACE` |
| **N-3** | NIT | Шапка `tests/evidence.test.mjs` утверждала, что набор не читает состояние под `$DSH_HOME`, тогда как строки 50-58 читают fingerprint | Формулировка исправлена: состояние не записывается, снимается только read-only fingerprint |

После этих правок повторно прогнаны: `pnpm run check` в изолированной копии → **exit 0, 167 pass / 0 fail**; evidence-набор → **19/19**; проба ревьюера → `[P1]/[P2] BLOCKED`, `[P4]` отказы, `[P6] OK`; мутации → адресные отказы (§7).

---

## 9. Ограничения и что осталось за рамками

1. **Коммита нет** (не поручался); push/merge/publish/release не выполнялись.
2. **§33-измерения отложены (F4).** Таблицы несут workspace/task/attempt/review/agent/correlation/causation — ровно то, что называет карточка. `sessionId`, `roleRevision`, `workflowRevision`, `controllerInstance` не добавлены: добавление nullable-колонки в SQLite не переписывает существующие строки и совместимо с триггерами (проверено экспериментом, §8.3 F4), поэтому это отдельная миграция v4, когда появится потребитель (наблюдаемость §33), а не заранее.
3. **Рантайм не подключён.** Порт `ArtifactStorePort` (§36) и маршрутизация через авторизацию §31 — предмет карточки, монтирующей рантайм (MW-015): `packages/adapter-sdk/src/port-contract.ts` прямо говорит, что интерфейс порта добавляет связывающая интеграция. Стор — не точка авторизации: он проверяет *форму* записи, право записи решает вызывающий (MW-007 `authorizeOperation`).
4. **Скан секретов — защита по форме, а не классификатор.** Ловятся формы, которые агент реально вставляет (PEM, провайдерские ключи в обеих записях, JWT, `name=value`), плюс узкий алфавит и лимит длины идентификатора. Короткий секрет без метки формой неотличим; настоящий механизм — credential references §31 (MW-007). Осознанно **не** добавлено правило «длинная hex-строка — секрет»: git SHA-1 (40 hex) — законный идентификатор артефакта вида `commit`, и такой id проверен как принимаемый.
5. **DDL-обход остаётся возможен.** Вызывающий с правом на схему снимет триггер и перепишет строку (проба P3 ревьюера: `BYPASS (DDL required)`; `VACUUM INTO` guard'ы сохраняет, обход требует именно `DROP TRIGGER` на копии). Это граница любой защиты внутри той же БД; против неё работает не триггер, а изоляция прав (§31/MW-007) и внешний бэкап (MW-040).
6. **Дублирование детектора.** В `core/src/security.ts` (MW-007) есть свой разбор секрет-материала, но он не экспортирован как отдельный предикат; чтобы не править чужой незакоммиченный файл, MW-008 несёт собственный узкий скан. Консолидация — небольшая отдельная правка для владельца §31.
7. **`openStore` заменяет список миграций, а не дополняет его** (`options.migrations ?? MYWORK_MIGRATIONS`): забыть ядро при композиции легко. Обе фабрики это ловят (`schema-missing`), но сам footgun — свойство API хранилища (MW-004), здесь только обойдён.
8. **Общее дерево и снимок чисел.** Проверка включает незакоммиченную работу MW-007, поэтому «167»/«173» — состояние дерева, а не только этой карточки: в основном дереве соседняя сессия продолжает дописывать `tests/security.test.mjs` (173 против 167 в копии, снятой раньше). Мои 19 тестов и 4 проверки границ отделимы (§2.3).
9. **Тест различает два вида отказа:** `refusal()` проверяет типизированные `EvidenceError`, а нарушения триггеров приходят как SQLite-ошибки с маркером — для них отдельный `databaseRefusal()`.
10. **Падающий прогон может оставить временный каталог** в TEMP (открытый handle на Windows); `after()` печатает это явно. Это унаследованное поведение набора storage (MW-004 §6.4), а не новое.

---

## 10. Предыдущий прогон этой карточки (BLOCKED, история)

Первая попытка MW-008 остановилась со статусом **BLOCKED**: зависимость MW-007 не была выполнена — `.work/reports/MW-007-security.md` **существовал**, но содержал `BLOCKED` и «код MW-007 не писался»; под ней не был закрыт MW-006. Тогда же зафиксировано, что техническое ядро MW-008 разблокировано, а заблокированы именно security-критерии (политика секретов, изоляция workspace), и что владелец выбрал вариант «остаться на BLOCKED, сначала MW-006 и MW-007».

Причина устранена: MW-006 закрыт (коммиты `2bbb5d9`…`fbee7a0`), MW-007 поставлен параллельной сессией (`READY_FOR_REVIEW`), gate перепроверен по исходникам и пройден.

---

## 11. Как воспроизвести

```powershell
cd H:\Repo\DSH-MyWork
git rev-parse HEAD                          # fbee7a0b1d0703b5b2bdd581c05e81c3c19a2f7e
pnpm install                                # exit 0, 7 workspace projects
node --test --test-isolation=none tests/evidence.test.mjs   # exit 0, 19 pass / 0 fail

# Изолированная копия (не соревнуется с параллельной сессией за сборку):
git worktree add --detach .tmp/mw008-verify fbee7a0
# … скопировать рабочее дерево поверх, затем:
cd .tmp\mw008-verify; pnpm install; pnpm run check          # exit 0, 167 pass / 0 fail

# Проба ревьюера на обход иммутабельности (читает замороженную копию):
node ..\mw008-review\probe.mjs                              # ожидается P1/P2 BLOCKED

# Mutation-check:
node ..\evidence-mutate.mjs apply F packages\evidence\lib\index.js
node --test --test-isolation=none tests\evidence.test.mjs   # ожидается 2 fail
node ..\evidence-mutate.mjs restore packages\evidence\lib\index.js
```

Изолированная копия после проверок **удалена** (снята с учёта `git worktree remove`, каталог убран скриптом `.tmp/cleanup-mw008.mjs` с явным deny-list), поэтому воспроизведение начинается с её создания. Пробы ревьюера и драйвер мутаций оставлены в `.tmp/` как след проверки; чужие каталоги в `.tmp/` (`.tmp/mw004-verify`, `.tmp/mw006`, `.tmp/mw008-review` соседних карточек) не тронуты.
