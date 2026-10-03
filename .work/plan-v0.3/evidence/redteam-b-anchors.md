# Red Team B — сырые выводы скриптов (кампания v0.3, 2026-09-27)

Скрипты: `.tmp/plan-v03-red-b/{graph,crosschecks,crosschecks2,cedits,sidebyside,stepcards}.ps1`.
Все команды — только чтение; `.work/tasks/**` не изменялся.

## 1. `crosschecks.ps1` — длины файлов, якоря, Board ID

```text
===== 1. line counts (raw split, authoritative) =====
   00-RECON.md                240
   01-MASTER-PLAN.md          443
   10-DECISIONS.md            1847
   20-STEPS-foundation.md     1836
   21-STEPS-execution.md      1156
   22-STEPS-surface.md        1490
   23-STEPS-quality.md        908
   30-CARD-EDITS.md           1385
   .work/tasks/INDEX.md       136
   .work/tasks/tasks.json     1467

===== 2. actual step headings per file =====
   collected step ids: 161

===== 3. every F-NN citation in master plan + card edits, vs the real heading =====
   F-01  real=F                                                                      (cited 11x, first 01-MASTER-PLAN.md:134)
   F-02  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:72)
   F-03  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:202)
   F-04  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:70)
   F-06  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:332)
   F-07  real=F                                                                      (cited 2x, first 30-CARD-EDITS.md:91)
   F-08  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:71)
   F-09  real=F                                                                      (cited 2x, first 01-MASTER-PLAN.md:134)
   F-10  real=F                                                                      (cited 6x, first 01-MASTER-PLAN.md:148)
   F-11  real=F                                                                      (cited 5x, first 01-MASTER-PLAN.md:205)
   F-12  real=F                                                                      (cited 8x, first 01-MASTER-PLAN.md:63)
   F-13  real=F                                                                      (cited 9x, first 01-MASTER-PLAN.md:206)
   F-14  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:73)
   F-15  real=F                                                                      (cited 6x, first 01-MASTER-PLAN.md:207)
   F-16  real=F                                                                      (cited 3x, first 30-CARD-EDITS.md:73)
   F-17  real=F                                                                      (cited 5x, first 01-MASTER-PLAN.md:208)
   F-18  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:333)
   F-19  real=F                                                                      (cited 2x, first 01-MASTER-PLAN.md:148)
   F-20  real=F                                                                      (cited 12x, first 01-MASTER-PLAN.md:158)
   F-21  real=F                                                                      (cited 7x, first 01-MASTER-PLAN.md:213)
   F-22  real=F                                                                      (cited 5x, first 01-MASTER-PLAN.md:330)
   F-23  real=F                                                                      (cited 5x, first 01-MASTER-PLAN.md:213)
   F-24  real=F                                                                      (cited 3x, first 30-CARD-EDITS.md:77)
   F-25  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:214)
   F-26  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:78)
   F-27  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:215)
   F-28  real=F                                                                      (cited 3x, first 30-CARD-EDITS.md:79)
   F-29  real=F                                                                      (cited 1x, first 01-MASTER-PLAN.md:158)
   F-30  real=F                                                                      (cited 2x, first 01-MASTER-PLAN.md:173)
   F-32  real=F                                                                      (cited 2x, first 30-CARD-EDITS.md:79)
   F-33  real=F                                                                      (cited 5x, first 01-MASTER-PLAN.md:331)
   F-34  real=F                                                                      (cited 2x, first 30-CARD-EDITS.md:80)
   F-36  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:81)
   F-37  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:81)
   F-38  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:332)
   F-39  real=F                                                                      (cited 4x, first 01-MASTER-PLAN.md:173)
   F-40  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:82)
   F-41  real=F                                                                      (cited 3x, first 30-CARD-EDITS.md:83)
   F-42  real=F                                                                      (cited 3x, first 30-CARD-EDITS.md:83)
   F-43  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:84)
   F-44  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:85)
   F-50  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:87)
   F-51  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:86)
   F-52  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:86)
   F-53  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:86)
   F-57  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:93)
   F-58  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:89)
   F-59  real=F                                                                      (cited 1x, first 30-CARD-EDITS.md:89)
   TOTAL F-citations: 157   distinct: 48

===== 4. ledger defects: Board ID rows / broken anchors / ВЕРСИЯ / planRevision =====
   cards with a 'Board ID:' line: 55
      MW-001: Board ID: 3cad0e0a-f866-4d39-9323-31b5d4b2f614  
      MW-002: Board ID: cc19da5a-ff24-45ed-8b19-236e02b2556d  
      MW-003: Board ID: 3729ad0f-d4e5-46ec-bb02-35ab4de992b8  
      MW-004: Board ID: 70113eee-e1ce-4c84-951c-a53f2e5b2066  
      MW-005: Board ID: d1e10b88-4e4f-4775-a6fc-c500e6069459  
      MW-006: Board ID: 03c9e1e0-52d3-4f59-a4b5-ace94245a459  
      MW-007: Board ID: 58ec1a48-2fcf-4980-8c03-73219fe73b34  
      MW-008: Board ID: 6b9f3654-8fdb-4422-851f-bf0976c71156  
      MW-009: Board ID: e3d28aba-c719-4b52-8ca5-1352eba96ae7  
      MW-010: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-011: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-012: Board ID: 428eb852-5339-4101-be6b-18d447abe313  
      MW-013: Board ID: 0c6bf5ac-0719-4625-be6d-d197a14b6363  
      MW-014: Board ID: fcffc0c3-f0df-42db-a07a-128fa9fd5dd5  
      MW-015: Board ID: 122cfc2c-e60d-4e0c-abe8-23cb186ada2a  
      MW-016: Board ID: 3228aed0-4319-4733-b575-8e45273fb096  
      MW-017: Board ID: 0e229ea3-c41a-4e85-b9fd-46d9ce86272a  
      MW-018: Board ID: 4040ecd7-d43c-4bbb-bf20-3665c62cdc50  
      MW-019: Board ID: d0cdff7e-eb0a-4dd0-95cd-3a43af6924ca  
      MW-020: Board ID: 46799cb9-b3ae-4eed-b614-d16017ab20bf  
      MW-021: Board ID: 1589a35a-91cd-41a9-930a-65293cce9f90  
      MW-022: Board ID: 1924a37d-592e-4858-a290-6d1b84c3a6f5  
      MW-023: Board ID: 650491a3-db89-4716-abe7-d317d89482e1  
      MW-024: Board ID: 05b08a47-7f0f-4e9a-9b4a-825df16088cc  
      MW-025: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-026: Board ID: bee3760c-8eef-49e7-b588-0a27414e3f38  
      MW-027: Board ID: e5bdbc44-0dfe-4e0c-ab26-2b526d3d3861  
      MW-028: Board ID: 86f92814-522a-4761-9e3c-66f8bde03dff  
      MW-029: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-030: Board ID: 6d13316a-29a6-433d-931a-50fa8b8b76c2  
      MW-031: Board ID: 6eb5bb23-baf6-4260-b885-a66cc3431230  
      MW-032: Board ID: 92e48d64-4b12-44a6-80d2-8f837b019e7f  
      MW-033: Board ID: 1f2ee8a9-f8b0-4981-b6bb-0999d22ce97f  
      MW-034: Board ID: 55c5025b-bb5d-4f7b-b96c-f21d194a035a  
      MW-035: Board ID: d66573e0-720f-419f-ba72-a8a0bfe2d50f  
      MW-036: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-037: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-038: Board ID: a4edddc3-d7b6-4f39-9b89-c6489c026933  
      MW-039: Board ID: c51ae89d-6f5d-49bf-8ebd-8822e10d2e28  
      MW-040: Board ID: 7daa2fc9-9b07-42b4-9b45-4a42861c0ca4  
      MW-041: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-042: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-043: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-044: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-045: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-046: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-047: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-048: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-049: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-050: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-051: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-052: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-053: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-054: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      MW-055: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
   cards with '(строка undefined)': 4   total occurrences: 8
      MW-025: 1
      MW-036: 2
      MW-037: 2
      MW-041: 3

===== 5. INDEX.md header + revision / count of task rows =====
   1: # Задачи
   2: 
   3: Версия плана: v0.2, planRevision 2. Архитектура: `.work/architecture/DSH-My-Work-Architecture-v0.1.md`, решения: `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md`.
   4: 
   5: Карточки со статусом `superseded` не запускаются: их роль передана другим карточкам, и в файле стоит запрет на исполнение.
   6: 
   7: ## Что изменилось в v0.2
   8: 
   9: - Добавлены MW-042…MW-055: контракты доски и проекции, Idea Bank, workflow engine, work types и finish criteria, обсуждение и steering, backend проекции, четыре UI-карточки, мастер импорта и приёмка доски.
   10: - Пересмотрены MW-010 (Beads capability-aware adapter), MW-011 (staged plan mutation), MW-029 (board-поверхность Application API), MW-036 (редактор workflow вынесен), MW-037, MW-041.
   11: - Сняты MW-027 и MW-035: их роль передана board-карточкам.
   12: 
   13: ## 00-foundation
   14: 
   rows matching '| [MW-': 55
   INDEX lines 118-140:
   118: 
   119: | ID | Задача | Зависимости | Статус |
   120: |---|---|---|---|
   121: | [MW-054](MW-054.md) | Реализовать DSH-web compatibility adapter и мастер импорта | MW-047, MW-029, MW-030 | planned |
   122: 
   123: ## Критический путь
   124: 
   125: ```text
   126: MW-009 → MW-010 → MW-011 → MW-047 → MW-029 → MW-048 → MW-049 → MW-050 → MW-053 ─┐
   127:                                                                                   ├→ MW-055 → MW-041
   128: MW-042 (← MW-003) ────────────────────────────────────────────────────────────────┤
   129: MW-054 (← MW-047, MW-029, MW-030) ────────────────────────────────────────────────┘
   130: MW-044 (← MW-011, MW-014, MW-022, MW-025) → MW-045 → MW-051
   131: MW-046 (← MW-012, MW-022, MW-030) → MW-050
   132: MW-052 (← MW-049, MW-042)
   133: ```
   134: 
   135: Не запускать зависимые карточки одним залпом. Перед каждым запуском проверять отчёт каждой зависимости, а не колонку доски.

===== 6. count of entries in the 3.21 tasks.json block vs the claim of 19 =====
   ids in 3.21 JSON block: 18 -> MW-056, MW-057, MW-058, MW-059, MW-060, MW-061, MW-062, MW-063, MW-064, MW-065, MW-066, MW-067, MW-068, MW-069, MW-070, MW-071, MW-073, MW-074
   claim at line 1152: 'Вставить 19 записей'

===== 7. MW-027 / MW-035 archive handling and MW-001 status claims =====
   --- MW-001 (first 6 lines) ---
      1: # MW-001 — Проверить целевой DSH и контракты интеграций
      2: 
      3: Этап: 00-foundation  
      4: Зависимости: нет  
      5: Board ID: 3cad0e0a-f866-4d39-9323-31b5d4b2f614  
      6: Обязательные пункты §62: 
   --- MW-027 (first 6 lines) ---
      1: > **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.
      2: > Заменена на: MW-042, MW-047, MW-048.
      3: > Причина: Формулировка «подключить существующую доску как опциональную проекцию» недостаточна: по решению владельца доска MyWork — first-party control surface с собственной доменной моделью, projection backend, нативными слотами DSH и мастером импорта. Роль MW-027 разделена между MW-042 (контракты и проекция), MW-047 (backend проекции), MW-048 (native host) и MW-050 (взаимодействие).
      4: > Тело ниже сохранено как исторический материал и не является заданием.
      5: 
      6: # MW-027 — Реализовать Task Board production и Null adapters
   --- MW-035 (first 6 lines) ---
      1: > **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.
      2: > Заменена на: MW-048, MW-049, MW-050, MW-053.
      3: > Причина: Состав MW-035 (Overview и Tasks внутри DSH UI) — подмножество board-работы. Экран Tasks заменён девятизонной доской (MW-049), Overview и состояние loading/empty/error/degraded входят в MW-048, взаимодействие с карточкой — в MW-050, тема и доступность — в MW-053.
      4: > Тело ниже сохранено как исторический материал и не является заданием.
      5: 
      6: # MW-035 — Создать My Work UI: Overview и Tasks
   --- MW-038 (first 6 lines) ---
      1: # MW-038 — Добавить Doctor и полный adapter conformance
      2: 
      3: Этап: 07-acceptance  
      4: Зависимости: MW-010, MW-015, MW-019, MW-027, MW-029, MW-031  
      5: Board ID: a4edddc3-d7b6-4f39-9b89-c6489c026933  
      6: Обязательные пункты §62: 34, 35
   --- MW-042 (first 6 lines) ---
      1: # MW-042 — Определить board-контракты, проекцию зон и placement v2
      2: 
      3: Этап: 01b-board  
      4: Зависимости: MW-003  
      5: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      6: Обязательные пункты §62: 
   --- MW-048 (first 6 lines) ---
      1: # MW-048 — Создать @dsh-mywork/web: пакет, client bundle, native slots, theme bridge
      2: 
      3: Этап: 06-ui  
      4: Зависимости: MW-029  
      5: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      6: Обязательные пункты §62: 
   --- MW-055 (first 6 lines) ---
      1: # MW-055 — Провести приёмку доски и верификацию миграции
      2: 
      3: Этап: 07-acceptance  
      4: Зависимости: MW-053, MW-054, MW-031, MW-038, MW-039  
      5: Board ID: не создана — карточка принадлежит доске MyWork, а не legacy ledger  
      6: Обязательные пункты §62: 

```

## 2. `crosschecks2.ps1` — нумерация шагов F-01…F-62 и все F-ссылки

```text
   step ids parsed: 161  (F:62 E:52 B:0 Q:47)

===== A. step-id ranges per file (declared in 20-STEPS 0.1 vs real) =====
   F-01    20-STEPS-foundation.md      56  Рабочий bootstrap `pnpm`: диагноз и канонический runner
   F-02    20-STEPS-foundation.md      88  Внешняя копия живого профиля `C:\Users\Dmitry\.dsh`
   F-03    20-STEPS-foundation.md     108  Процедура восстановления профиля и её проверка на копии
   F-04    20-STEPS-foundation.md     126  Гейт прав: поднять `sessionDefaultPermission` на уровень строки
   F-05    20-STEPS-foundation.md     152  Удалить мёртвые ключи `autoRun*` из строки `web-ui-task-board`
   F-06    20-STEPS-foundation.md     174  Доказать, что гейт прав снят: карточка без ручного подтверждения запускается
   F-07    20-STEPS-foundation.md     193  Архивировать `superseded` MW-027 и MW-035
   F-08    20-STEPS-foundation.md     212  Правило «карточка не становится `done` при `failed`-исполнении»
   F-09    20-STEPS-foundation.md     230  Инвентаризация `done`-карточек с `failed`-исполнениями
   F-10    20-STEPS-foundation.md     249  Чистка рабочего каталога: только по явному пути, с префильтром
   F-11    20-STEPS-foundation.md     281  Грязный `pnpm-lock.yaml`: зафиксировать или откатить
   F-12    20-STEPS-foundation.md     299  Гейт этапа 0
   F-13    20-STEPS-foundation.md     379  `bd`-seam: резолвер JS-entry через `process.execPath`
   F-14    20-STEPS-foundation.md     406  `bd`-seam: применить резолвер в `createProcessRunner`
   F-15    20-STEPS-foundation.md     426  `bd`-seam в пробе и в диагностике (Doctor)
   F-16    20-STEPS-foundation.md     445  Тест `beads-adapter`: честная проба и удаление ложного EPERM-текста
   F-17    20-STEPS-foundation.md     469  Skip реального backend → падение в CI-профиле
   F-18    20-STEPS-foundation.md     490  Единый реестр миграций `MYWORK_DATABASE_MIGRATIONS`
   F-19    20-STEPS-foundation.md     521  Запретить открытие store без канонического набора миграций
   F-20    20-STEPS-foundation.md     542  Migration journal: проверка целостности при открытии
   F-21    20-STEPS-foundation.md     564  MW-057а: тест `batch`-рёбер читает `id` / `dependency_type`
   F-22    20-STEPS-foundation.md     587  MW-057б: `heartbeat` передаёт актора, как `claim`
   F-23    20-STEPS-foundation.md     610  `scripts/lib/process.mjs`: ветка `shell: true` ведёт в битый `pnpm`-шим
   F-24    20-STEPS-foundation.md     635  `packController` идемпотентность: удалять одноимённый `.tgz` до пака
   F-25    20-STEPS-foundation.md     661  Минимальный CI и тег `v0.1.0-m1`
   F-26    20-STEPS-foundation.md     686  Производный `INDEX.md` с `lastSyncedRevision`
   F-27    20-STEPS-foundation.md     709  Сверка `done`-множеств трёх леджеров + гейт этапа 1
   F-28    20-STEPS-foundation.md     743  Composition root: application service `myworkApplication`
   F-29    20-STEPS-foundation.md     767  Composition root: открыть `controller.sqlite` полным списком миграций
   F-30    20-STEPS-foundation.md     791  Composition root: поднять lease / planner / execution / scheduler / evidence
   F-31    20-STEPS-foundation.md     817  Composition root: регистрация в `myworkAdapters` (+ точки подключения Context/Memory/Skill)
   F-32    20-STEPS-foundation.md     842  Composition root: smoke в изолированном `DSH_HOME`
   F-33    20-STEPS-foundation.md     864  Атомарная запись состояния: `writeFileAtomic`
   F-34    20-STEPS-foundation.md     887  Атомарная запись: `withFileLock` и single-writer дисциплина
   F-35    20-STEPS-foundation.md     910  SQLite-настройки открытия: `synchronous` и `auto_vacuum`
   F-36    20-STEPS-foundation.md     938  Durable jobs: выбор носителя
   F-37    20-STEPS-foundation.md     967  Durable jobs: реализация реестра поверх таблицы `background_job`
   F-38    20-STEPS-foundation.md     989  Retention: `DELETE` и окна хранения для `outbox` / `inbox_dedup` / `audit_events`
   F-39    20-STEPS-foundation.md    1017  Retention: `VACUUM` и возврат места файловой системе
   F-40    20-STEPS-foundation.md    1037  Retention: BLOB-артефакты под триггерами — механика удаления
   F-41    20-STEPS-foundation.md    1071  Boundary-тест: расширить `FORBIDDEN` до `@deepseek-ai/dsh*`
   F-42    20-STEPS-foundation.md    1094  Boundary-тест: сканировать `scheduler` / `planner` / `adapter-sdk` / `controller` / `memory-native`
   F-43    20-STEPS-foundation.md    1118  Model availability: порт и `RouteRefusalReason: model-not-routable`
   F-44    20-STEPS-foundation.md    1147  Session conformance: 8 тестов на политики прав и ветку «нет живого агента»
   F-45    20-STEPS-foundation.md    1172  Boundary + достижимость: зафиксировать рост достижимых пакетов
   F-46    20-STEPS-foundation.md    1195  Гейт этапа 2
   F-47    20-STEPS-foundation.md    1218  Peer-контракт: инвентаризация реально используемых сервисов `ctx.*`
   F-48    20-STEPS-foundation.md    1244  Peer-контракт: `peerDependencies` в `controller` (и только он держит гейт)
   F-49    20-STEPS-foundation.md    1277  Публикуемость: `private: true` → `publishConfig` и `files`
   F-50    20-STEPS-foundation.md    1305  Матрица совместимости и ADR-пакет
   F-51    20-STEPS-foundation.md    1327  Бюджет: мост `ctx.tokenMeter.measure(...)` → `BudgetCharge`
   F-52    20-STEPS-foundation.md    1359  Бюджет: значения по умолчанию и поведение при превышении
   F-53    20-STEPS-foundation.md    1384  Шаговый circuit-breaker
   F-54    20-STEPS-foundation.md    1408  OTel: экспорт существующего `correlationId`
   F-55    20-STEPS-foundation.md    1442  OTel: состав событий и политика PII
   F-56    20-STEPS-foundation.md    1463  Allowlist инструментов worker-поверхности
   F-57    20-STEPS-foundation.md    1501  `auto-review` только deny
   F-58    20-STEPS-foundation.md    1525  Installable UI-пакет `@dsh-mywork/web`: структура и `dsh.client`-манифест
   F-59    20-STEPS-foundation.md    1553  `@dsh-mywork/web`: префикс `data-mw-*` и `store` слота
   F-60    20-STEPS-foundation.md    1573  Гейт этапа 3
   F-61    20-STEPS-foundation.md     323  Пресет `mode: cordis` для карточек MyWork + запрет устаревшей «фермы» имён
   F-62    20-STEPS-foundation.md     351  Гейт прав: 33 из 55 карточек формально требуют подтверждения

===== B. every F-NN citation in master plan / card edits / other step files =====
   total F-citations across 6 files: 272
   F-01  x14  real: Рабочий bootstrap `pnpm`: диагноз и канонический runner  [20-STEPS-foundation.md:56]
   F-02  x1   real: Внешняя копия живого профиля `C:\Users\Dmitry\.dsh`  [20-STEPS-foundation.md:88]
   F-03  x4   real: Процедура восстановления профиля и её проверка на копии  [20-STEPS-foundation.md:108]
   F-04  x1   real: Гейт прав: поднять `sessionDefaultPermission` на уровень строки  [20-STEPS-foundation.md:126]
   F-06  x4   real: Доказать, что гейт прав снят: карточка без ручного подтверждения запускается  [20-STEPS-foundation.md:174]
   F-07  x2   real: Архивировать `superseded` MW-027 и MW-035  [20-STEPS-foundation.md:193]
   F-08  x1   real: Правило «карточка не становится `done` при `failed`-исполнении»  [20-STEPS-foundation.md:212]
   F-09  x2   real: Инвентаризация `done`-карточек с `failed`-исполнениями  [20-STEPS-foundation.md:230]
   F-10  x6   real: Чистка рабочего каталога: только по явному пути, с префильтром  [20-STEPS-foundation.md:249]
   F-11  x5   real: Грязный `pnpm-lock.yaml`: зафиксировать или откатить  [20-STEPS-foundation.md:281]
   F-12  x9   real: Гейт этапа 0  [20-STEPS-foundation.md:299]
   F-13  x11  real: `bd`-seam: резолвер JS-entry через `process.execPath`  [20-STEPS-foundation.md:379]
   F-14  x1   real: `bd`-seam: применить резолвер в `createProcessRunner`  [20-STEPS-foundation.md:406]
   F-15  x10  real: `bd`-seam в пробе и в диагностике (Doctor)  [20-STEPS-foundation.md:426]
   F-16  x3   real: Тест `beads-adapter`: честная проба и удаление ложного EPERM-текста  [20-STEPS-foundation.md:445]
   F-17  x5   real: Skip реального backend → падение в CI-профиле  [20-STEPS-foundation.md:469]
   F-18  x17  real: Единый реестр миграций `MYWORK_DATABASE_MIGRATIONS`  [20-STEPS-foundation.md:490]
   F-19  x7   real: Запретить открытие store без канонического набора миграций  [20-STEPS-foundation.md:521]
   F-20  x29  real: Migration journal: проверка целостности при открытии  [20-STEPS-foundation.md:542]
   F-21  x14  real: MW-057а: тест `batch`-рёбер читает `id` / `dependency_type`  [20-STEPS-foundation.md:564]
   F-22  x5   real: MW-057б: `heartbeat` передаёт актора, как `claim`  [20-STEPS-foundation.md:587]
   F-23  x5   real: `scripts/lib/process.mjs`: ветка `shell: true` ведёт в битый `pnpm`-шим  [20-STEPS-foundation.md:610]
   F-24  x3   real: `packController` идемпотентность: удалять одноимённый `.tgz` до пака  [20-STEPS-foundation.md:635]
   F-25  x7   real: Минимальный CI и тег `v0.1.0-m1`  [20-STEPS-foundation.md:661]
   F-26  x1   real: Производный `INDEX.md` с `lastSyncedRevision`  [20-STEPS-foundation.md:686]
   F-27  x4   real: Сверка `done`-множеств трёх леджеров + гейт этапа 1  [20-STEPS-foundation.md:709]
   F-28  x9   real: Composition root: application service `myworkApplication`  [20-STEPS-foundation.md:743]
   F-29  x2   real: Composition root: открыть `controller.sqlite` полным списком миграций  [20-STEPS-foundation.md:767]
   F-30  x3   real: Composition root: поднять lease / planner / execution / scheduler / evidence  [20-STEPS-foundation.md:791]
   F-31  x10  real: Composition root: регистрация в `myworkAdapters` (+ точки подключения Context/Memory/Skill)  [20-STEPS-foundation.md:817]
   F-32  x7   real: Composition root: smoke в изолированном `DSH_HOME`  [20-STEPS-foundation.md:842]
   F-33  x8   real: Атомарная запись состояния: `writeFileAtomic`  [20-STEPS-foundation.md:864]
   F-34  x2   real: Атомарная запись: `withFileLock` и single-writer дисциплина  [20-STEPS-foundation.md:887]
   F-35  x1   real: SQLite-настройки открытия: `synchronous` и `auto_vacuum`  [20-STEPS-foundation.md:910]
   F-36  x7   real: Durable jobs: выбор носителя  [20-STEPS-foundation.md:938]
   F-37  x5   real: Durable jobs: реализация реестра поверх таблицы `background_job`  [20-STEPS-foundation.md:967]
   F-38  x8   real: Retention: `DELETE` и окна хранения для `outbox` / `inbox_dedup` / `audit_events`  [20-STEPS-foundation.md:989]
   F-39  x5   real: Retention: `VACUUM` и возврат места файловой системе  [20-STEPS-foundation.md:1017]
   F-40  x5   real: Retention: BLOB-артефакты под триггерами — механика удаления  [20-STEPS-foundation.md:1037]
   F-41  x5   real: Boundary-тест: расширить `FORBIDDEN` до `@deepseek-ai/dsh*`  [20-STEPS-foundation.md:1071]
   F-42  x8   real: Boundary-тест: сканировать `scheduler` / `planner` / `adapter-sdk` / `controller` / `memory-native`  [20-STEPS-foundation.md:1094]
   F-43  x1   real: Model availability: порт и `RouteRefusalReason: model-not-routable`  [20-STEPS-foundation.md:1118]
   F-44  x1   real: Session conformance: 8 тестов на политики прав и ветку «нет живого агента»  [20-STEPS-foundation.md:1147]
   F-45  x5   real: Boundary + достижимость: зафиксировать рост достижимых пакетов  [20-STEPS-foundation.md:1172]
   F-50  x1   real: Матрица совместимости и ADR-пакет  [20-STEPS-foundation.md:1305]
   F-51  x1   real: Бюджет: мост `ctx.tokenMeter.measure(...)` → `BudgetCharge`  [20-STEPS-foundation.md:1327]
   F-52  x1   real: Бюджет: значения по умолчанию и поведение при превышении  [20-STEPS-foundation.md:1359]
   F-53  x1   real: Шаговый circuit-breaker  [20-STEPS-foundation.md:1384]
   F-57  x1   real: `auto-review` только deny  [20-STEPS-foundation.md:1501]
   F-58  x1   real: Installable UI-пакет `@dsh-mywork/web`: структура и `dsh.client`-манифест  [20-STEPS-foundation.md:1525]
   F-59  x3   real: `@dsh-mywork/web`: префикс `data-mw-*` и `store` слота  [20-STEPS-foundation.md:1553]

===== C. Board ID inventory =====
   'Board ID: не создана'  -> 21 cards: MW-010, MW-011, MW-025, MW-029, MW-036, MW-037, MW-041, MW-042, MW-043, MW-044, MW-045, MW-046, MW-047, MW-048, MW-049, MW-050, MW-051, MW-052, MW-053, MW-054, MW-055
   'Board ID: <guid>'       -> 34 cards: MW-001, MW-002, MW-003, MW-004, MW-005, MW-006, MW-007, MW-008, MW-009, MW-012, MW-013, MW-014, MW-015, MW-016, MW-017, MW-018, MW-019, MW-020, MW-021, MW-022, MW-023, MW-024, MW-026, MW-027, MW-028, MW-030, MW-031, MW-032, MW-033, MW-034, MW-035, MW-038, MW-039, MW-040

===== D. which cards/README mention Board ID as a needed mapping =====
Select-String: H:\Repo\DSH-MyWork\.tmp\plan-v03-red-b\crosschecks2.ps1:60
Line |
  60 |  Select-String -Path (Join-Path $root '.work\plan-v0.3\*.md'), (Join-P …
     |  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | не удается найти путь "H:\Repo\DSH-MyWork\.work\tasks\MW-073.md", поскольку он не существует.

===== E. duplicate-action detector: same catch-phrase in F/E/B/Q steps =====
   atomic-write     x2   F-33, F-34
   bd-seam          x3   F-13, F-14, Q-32
   budget-breaker   x8   Q-23, Q-28, Q-47, F-47, E-49, F-51, E-52, F-60
   ci-tag           x4   F-25, F-27, Q-46, Q-47
   doctor           x8   F-02, F-15, Q-30, Q-31, Q-32, Q-33, Q-47, F-48
   durable-jobs     x5   Q-26, E-33, F-36, F-37, F-60
   human-decision   x13  Q-08, Q-09, Q-11, Q-19, E-24, E-29, Q-30, Q-36, Q-41, Q-47, E-52, F-57, F-60
   index-ledger     x5   F-07, F-08, F-26, F-27, F-60
   invariants       x3   Q-35, E-38, Q-47
   migrations-reg   x12  E-04, Q-06, Q-12, F-18, F-19, F-29, F-30, E-34, E-42, Q-42, E-52, F-60
   model-avail      x4   Q-35, F-43, Q-47, F-60
   needs-attention  x5   Q-08, Q-09, Q-30, E-47, E-52
   otel             x9   E-09, Q-27, Q-43, F-46, Q-47, F-54, F-55, F-56, F-60
   peer-manifest    x8   F-41, Q-45, Q-47, F-47, F-48, F-49, F-50, F-60
   provisioning     x6   E-32, E-33, E-34, E-35, E-52, F-60
   retention        x11  E-02, E-06, F-35, F-38, F-39, Q-40, F-40, F-46, Q-47, E-52, F-60
   skip-fail        x14  Q-05, F-08, F-14, F-16, F-17, F-21, F-25, F-27, Q-32, Q-46, Q-47, F-48, E-52, F-60
   web-package      x4   F-49, F-58, F-59, F-60
   worker-surface   x12  Q-37, E-38, Q-38, E-39, E-40, Q-47, F-47, F-48, E-52, F-56, F-57, F-60
   worktype         x9   E-17, Q-19, Q-20, Q-21, Q-23, E-24, E-32, Q-47, E-52

```


---

## 3. `anchoraudit.ps1` — адресация решений и шагов

```text

### A. `01-MASTER-PLAN.md:NNN` anchors in 30-CARD-EDITS.md
anchor count = 67
  landing on an EMPTY line ............ 16
  landing on a table separator |---| .. 4
  landing on a heading ................ 2
  structurally impossible landings .... 22 of 67
  anchors whose claim names a D-NN .... 32; cited line does NOT contain that D-NN: 32
  30-CE:176 cites :257 for D15 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:211 cites :247 for D05 -> actual line: | **B. Поверхность → конвейер** (§65 документа) | Ранняя видимость прогресса и о
  30-CE:244 cites :256 for D14 -> actual line: ## 7. Сводка решений (детали — `10-DECISIONS.md`)
  30-CE:244 cites :105 for D14 -> actual line: 3. **Durable-состояние.** Запись состояния атомарна (temp+rename/WAL), миграции 
  30-CE:254 cites :252 for D10 -> actual line: **Условие пересмотра:** если владелец хочет видеть доску раньше (например, для д
  30-CE:265 cites :252 for D10 -> actual line: **Условие пересмотра:** если владелец хочет видеть доску раньше (например, для д
  30-CE:273 cites :252 for D10 -> actual line: **Условие пересмотра:** если владелец хочет видеть доску раньше (например, для д
  30-CE:282 cites :259 for D17 -> actual line: |---|---|---|
  30-CE:310 cites :257 for D15 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:327 cites :257 for D15 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:361 cites :255 for D13 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:370 cites :243 for D01 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:389 cites :253 for D11 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:397 cites :251 for D09 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:406 cites :258 for D16 -> actual line: | ID | Решение | Рекомендация плана (при отсутствии решения владельца) |
  30-CE:465 cites :250 for D09 -> actual line: **Решение плана:** A с одним исключением — **инсталлируемость** (peer-контракт +
  30-CE:514 cites :245 for D03 -> actual line: |---|---|---|
  30-CE:514 cites :295 for D03 -> actual line: | D09 | Своя таблица **`background_job` в `controller.sqlite`** | `jobs-local` —
  30-CE:554 cites :260 for D18 -> actual line: | D01 | Транспорт Web | Compile spike Typert ≤1 день; если дороже — HTTP/SSE чер
  30-CE:597 cites :301 for D02 -> actual line: | D15 | **Allowlist** worker-поверхности (scoped `agent.ctx.tools.restrict`/`gua
  30-CE:663 cites :246 for D04 -> actual line: | **A. Конвейер → поверхность** (рекомендация плана) | Доска — контроллер над ис
  30-CE:697 cites :255 for D13 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:706 cites :253 for D11 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:949 cites :233 for D12 -> actual line: MW-030 (HumanDecision) ──→ MW-046
  30-CE:950 cites :366 for D18 -> actual line: | # | Вопрос | Рекомендация плана | Что блокирует |
  30-CE:984 cites :255 for D13 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:1032 cites :251 for D09 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:1049 cites :257 for D15 -> actual line: <ПУСТАЯ СТРОКА>
  30-CE:1065 cites :262 for D20 -> actual line: | D03 | Workflow-движок | Не регистрироваться в `ctx.workflowEngine`; переименов
  30-CE:1082 cites :261 for D19 -> actual line: | D02 | Модель зон доски | По умолчанию — дешёвый вариант: сохранить 9 зон, выне
  30-CE:1106 cites :248 for D06 -> actual line: | **C. Гибрид** | Немедленно: минимальный read-only Backend проекции + панель-за
  30-CE:1320 cites :318 for D19 -> actual line: 9. Единый реестр миграций **нельзя** положить в `packages/storage` — `tests/boun

  where the D-IDs actually live in 01-MASTER-PLAN.md:
    D01: 260, 287
    D02: 261, 288
    D03: 262, 289
    D04: 263, 290
    D05: 264, 291
    D06: 265, 292
    D07: 266, 293
    D08: 267, 294
    D09: 268, 295
    D10: 269, 296
    D11: 270, 297
    D12: 271, 298
    D13: 272, 299
    D14: 273, 300
    D15: 274, 301
    D16: 275, 302
    D17: 276, 303
    D18: 277, 304
    D19: 278, 305
    D20: 279, 306

### B. 30-CARD-EDITS.md §0.6 mapping table: cited `20-STEPS-foundation.md:NNN` vs the real heading
  30-CE:70   cites :124   -> contains F-03    nearest heading F-04@126 <<< МИМО
  30-CE:70   cites :172   -> contains F-05    nearest heading F-06@174 <<< МИМО
  30-CE:71   cites :210   -> contains F-07    nearest heading F-08@212 <<< МИМО
  30-CE:71   cites :228   -> contains F-08    nearest heading F-09@230 <<< МИМО
  30-CE:72   cites :86    -> contains F-01    nearest heading F-02@88 <<< МИМО
  30-CE:72   cites :106   -> contains F-02    nearest heading F-03@108 <<< МИМО
  30-CE:73   cites :314   -> contains F-12    nearest heading F-61@323 <<< МИМО
  30-CE:73   cites :341   -> contains F-61    nearest heading F-62@351 <<< МИМО
  30-CE:73   cites :361   -> contains F-62    nearest heading F-62@351 <<< МИМО
  30-CE:73   cites :380   -> contains F-13    nearest heading F-13@379 <<< МИМО
  30-CE:74   cites :499   -> contains F-18    nearest heading F-18@490 <<< МИМО
  30-CE:75   cites :522   -> contains F-19    nearest heading F-19@521 <<< МИМО
  30-CE:76   cites :425   -> contains F-14    nearest heading F-15@426 <<< МИМО
  30-CE:76   cites :456   -> contains F-16    nearest heading F-16@445 <<< МИМО
  30-CE:76   cites :477   -> contains F-17    nearest heading F-17@469 <<< МИМО
  30-CE:77   cites :595   -> contains F-22    nearest heading F-22@587 <<< МИМО
  30-CE:77   cites :545   -> contains F-20    nearest heading F-20@542 <<< МИМО
  30-CE:77   cites :571   -> contains F-21    nearest heading F-21@564 <<< МИМО
  30-CE:78   cites :620   -> contains F-23    nearest heading F-23@610 <<< МИМО
  30-CE:78   cites :643   -> contains F-24    nearest heading F-24@635 <<< МИМО
  30-CE:79   cites :677   -> contains F-25    nearest heading F-26@686 <<< МИМО
  30-CE:79   cites :701   -> contains F-26    nearest heading F-27@709 <<< МИМО
  30-CE:79   cites :725   -> contains F-27    nearest heading F-27@709 <<< МИМО
  30-CE:79   cites :751   -> contains F-28    nearest heading F-28@743 <<< МИМО
  30-CE:79   cites :776   -> contains F-29    nearest heading F-29@767 <<< МИМО
  30-CE:80   cites :798   -> contains F-30    nearest heading F-30@791 <<< МИМО
  30-CE:80   cites :821   -> contains F-31    nearest heading F-31@817 <<< МИМО
  30-CE:81   cites :868   -> contains F-33    nearest heading F-33@864 <<< МИМО
  30-CE:81   cites :897   -> contains F-34    nearest heading F-34@887 <<< МИМО
  30-CE:82   cites :919   -> contains F-35    nearest heading F-35@910 <<< МИМО
  30-CE:82   cites :947   -> contains F-36    nearest heading F-36@938 <<< МИМО
  30-CE:82   cites :967   -> contains F-37    nearest heading F-37@967 (ТОЧНО)
  30-CE:83   cites :992   -> contains F-38    nearest heading F-38@989 <<< МИМО
  30-CE:83   cites :1015  -> contains F-38    nearest heading F-39@1017 <<< МИМО
  30-CE:84   cites :1039  -> contains F-40    nearest heading F-40@1037 <<< МИМО
  30-CE:85   cites :1063  -> contains F-40    nearest heading F-41@1071 <<< МИМО
  30-CE:86   cites :1234  -> contains F-47    nearest heading F-48@1244 <<< МИМО
  30-CE:86   cites :1266  -> contains F-48    nearest heading F-49@1277 <<< МИМО
  30-CE:86   cites :1291  -> contains F-49    nearest heading F-50@1305 <<< МИМО
  30-CE:87   cites :1212  -> contains F-46    nearest heading F-47@1218 <<< МИМО
  30-CE:89   cites :1417  -> contains F-54    nearest heading F-54@1408 <<< МИМО
  30-CE:89   cites :1441  -> contains F-54    nearest heading F-55@1442 <<< МИМО
  30-CE:90   cites :54    -> contains <до F-01> nearest heading F-01@56 <<< МИМО
  30-CE:91   cites :191   -> contains F-06    nearest heading F-07@193 <<< МИМО
  30-CE:93   cites :1393  -> contains F-53    nearest heading F-53@1384 <<< МИМО
  anchors in §0.6: 45; of them NOT landing on a heading: 44

### C. master plan §4 stage ranges vs 20-STEPS-foundation §0.1
  20-STEPS: | Этап | Шаги | Тема | Гейт этапа |
  20-STEPS: |---|---|---|---|
  20-STEPS: | **0** — разблокировка и гигиена | F-01…F-12 + **F-61, F-62** | профиль, права, `superseded`, правило `done`, копия профиля, безопасная чистка, runner, пресет `cordis`, масштаб гейта прав | F-12, затем F-61, F-62 |
  20-STEPS: | **1** — проверяемость существующего | F-13…F-27 | `bd`-seam, backend без skip, реестр миграций, journal, CI+тег, производный INDEX, сверка леджеров | F-27 |
  20-STEPS: | **2** — соединение подсистем | F-28…F-46 | composition root, атомарность, WAL, durable jobs, retention/VACUUM/сканеры-механика, boundary, model availability, session conformance | F-46 |
  20-STEPS: | **3** — контракты и решения | F-47…F-60 | peer-контракт, публикуемость, бюджет/шаги поверх `token-meter`, OTel, запреты worker-поверхности, UI-пакет | F-60 |
  20-STEPS: 
  01-MASTER-PLAN:134: **Состав (шаги `F-01…F-09` в `20-STEPS-foundation.md`):**
  01-MASTER-PLAN:148: **Состав (шаги `F-10…F-19`):**
  01-MASTER-PLAN:158: **Состав (шаги `F-20…F-29`; пересечения с `Q-*` — по ссылке):**
  01-MASTER-PLAN:173: **Состав (шаги `F-30…F-39` + `10-DECISIONS.md`):**

### D. master plan §5 F-references vs the real F-headings
  01-MASTER-PLAN:201: F-01 гейт прав ─┬─→ разблокирует все карточки MW-044…MW-055
      F-01 фактически = Рабочий bootstrap `pnpm`: диагноз и канонический runner
  01-MASTER-PLAN:202: F-03 правило done┴─→ ЭТАП 1
      F-03 фактически = Процедура восстановления профиля и её проверка на копии
  01-MASTER-PLAN:205: F-10 bd-seam ──→ F-11 тест batch-рёбер ──→ F-12 heartbeat-актор ──→ MW-010/MW-011 доказуемы
      F-10 фактически = Чистка рабочего каталога: только по явному пути, с префильтром
      F-11 фактически = Грязный `pnpm-lock.yaml`: зафиксировать или откатить
      F-12 фактически = Гейт этапа 0
  01-MASTER-PLAN:206: F-13 миграции ──→ ЭТАП 2 (composition root требует канонического списка)
      F-13 фактически = `bd`-seam: резолвер JS-entry через `process.execPath`
  01-MASTER-PLAN:207: F-15 CI+тег ────→ все последующие этапы (гейты исполняются в CI)
      F-15 фактически = `bd`-seam в пробе и в диагностике (Doctor)
  01-MASTER-PLAN:208: F-17 леджеры ───→ правило приёмки для всех карточек
      F-17 фактически = Skip реального backend → падение в CI-профиле
  01-MASTER-PLAN:211: F-20 composition root ──┬─→ MW-022 worker (нужен живой store)
      F-20 фактически = Migration journal: проверка целостности при открытии
  01-MASTER-PLAN:213: └─→ F-21 durable state / journal ──→ F-23 durable jobs
      F-21 фактически = MW-057а: тест `batch`-рёбер читает `id` / `dependency_type`
      F-23 фактически = `scripts/lib/process.mjs`: ветка `shell: true` ведёт в битый `pnpm`-шим
  01-MASTER-PLAN:214: F-25 boundary-тест ──→ этап 4 (изоляция слоёв)
      F-25 фактически = Минимальный CI и тег `v0.1.0-m1`
  01-MASTER-PLAN:215: F-27 model availability ──→ MW-013/MW-022
      F-27 фактически = Сверка `done`-множеств трёх леджеров + гейт этапа 1

### E. master plan §14 "первые три действия" vs the real steps
  01-MASTER-PLAN:434: 1. **F-01**: поднять `sessionDefaultPermission` на уровень `config` в строке `web-ui-task-board` (`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35`) и удалить мёртвые `autoRun*`; проверить запуском одной карточки с правом `workspace-write`.
  01-MASTER-PLAN:435: 2. **F-06**: сделать внешнюю копию `C:\Users\Dmitry\.dsh` и записать процедуру восстановления (единственный невосстановимый ресурс в контуре).
  01-MASTER-PLAN:436: 3. **F-10**: починить `bd`-seam (резолв JS-entry через `process.execPath`) — без этого MW-010/MW-011 остаются недоказуемыми, а на `batch-dep-remove` стоит staged-план MW-011/ADR024.
  01-MASTER-PLAN:440: **Рабочий вход в проект (проверено):** вместо сломанного `pnpm` использовать `corepack pnpm <script>` (`corepack pnpm --version` → `12.4.2`, exit 0). Полный план починки шима — `20-STEPS-foundation.md` F-01…F-12.

```

