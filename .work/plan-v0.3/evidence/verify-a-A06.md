# verify-a-A06 — Профиль, задачи, архитектурные ADR-ссылки

Роль: независимый верификатор (read-only). Живой профиль, живой леджер доски и DSH-чек-аут — только чтение; мутаций нет.
Дата проверки: 2026-09-27. Живой леджер на момент проверки: `ledger-v2.json` schemaVersion 3, revision 324, 55 задач.

---

## Якорь A06-1: 01-MASTER-PLAN.md:61 / 10-DECISIONS.md:1270 — `cordis.patch.yml:20-35`, `:25`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** прочитан `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` целиком (105 строк); сверены `01-MASTER-PLAN.md:61` (D-1) и `10-DECISIONS.md:1270`; слот `web-ui-task-board` подтверждён по живому ростеру (`plugin_manager list_plugins`).
- **Фактическое значение:** `cordis.patch.yml:20-35` — блок с `id: web-ui-task-board` (`:21`); `:22` `config:`; `:25` `config: { sessionDefaultPermission: workspace-write },` — вложено внутрь `config`. `01-MASTER-PLAN.md:61`: «`sessionDefaultPermission` вложен в `config.config` → плагин читает верхний уровень → фактический `read-only`».
- **Оценка severity:** major
- **Комментарий:** Строка, файл и номер строки совпадают с утверждением. Дополнительно подтверждено эмпирически: сводка живого леджера доски отдаёт `"sessionDefaultPermission": "read-only"`, хотя в профиле записано `workspace-write` — то есть вложенность действительно не читается, дефект D-1 жив. Слота-мишень существует: `include:web-ui-task-board` / `@linxin666/dsh-web-all/task-board`, `enabled: true`, `fiberPhase: active` — патч адресует реальную строку, а не «мёртвый» id.

---

## Якорь A06-2: 01-MASTER-PLAN.md:74 — `cordis.patch.yml` (строка `web-ui-task-board`; `auto-review`)

- **Вердикт:** ЛОЖНО (первая половина подтверждена, вторая опровергнута)
- **Что проверено:** `Select-String 'autoRun'` по `cordis.patch.yml` → 7 совпадений; `Select-String -SimpleMatch 'autoRun'` по всем `.js/.ts/.tsx/.mjs` пакетов `@linxin666/dsh-client-ui-task-board` (0.4.3) и `@linxin666/dsh-web-all` (0.4.3) → 0 и 2 совпадения; живые ростры `plugin_manager list_plugins` (218 записей) и `list_bundles` (21 запись); `packages\experimental\auto-review\cordis.patch.yml` в DSH-чек-ауте.
- **Фактическое значение:** `01-MASTER-PLAN.md:74` (D-13): «`autoRun*` ×7 в строке `web-ui-task-board` не читаются 0.4.3; **`auto-review` объявлен в профиле, но не смонтирован**». Факт: ростёр плагинов содержит `{"entryId":"include:auto-review","moduleName":"@deepseek-ai/dsh-experimental-auto-review","enabled":true,"fiberPhase":"active","patchId":"auto-review"}`, а `list_bundles` показывает бандл `@deepseek-ai/dsh-experimental-auto-review` `"enabled": true` со строкой `{"rowId":"auto-review", ... "entryId":"include:auto-review"}`.
- **Оценка severity:** major
- **Комментарий:** Половина про мёртвые ключи верна: в самом пакете доски `autoRun` не встречается ни разу (0 совпадений в `src` и `lib`), 7 ключей лежат в `cordis.patch.yml:27-33` и мертвы. Но вторая половина неверна: `auto-review` **смонтирован и активен** (`fiberPhase: active`). Нюанс к доказательству F-05/`foundation-01-direct.md:58-59`: в `@linxin666/dsh-web-all\lib\client.js` есть 2 совпадения `autoRun` (`:41295` `autoRun: (kind, currentSessionId) => request(\`${prefix}/auto/run\`, {` и `:41680` её вызов) — это метод чужого API «auto», а не ключи конфигурации доски, так что вывод «ключи мертвы» не ломается, но формулировка «0 совпадений в обоих пакетах» неточна. Существенно другое: план исходит из отсутствия `auto-review` и строит на этом пункты приёмки («Select-String по живому профилю не находит `auto-review`», `30-CARD-EDITS.md` C-18/MW-069) и решение D15 — фактически же он живёт в профиле с `allow`-веткой, то есть поверхность шире, чем записано в плане.

---

## Якорь A06-3: 01-MASTER-PLAN.md:75 / 10-DECISIONS.md:1650 — `.work/tasks/MW-001.md`, `MW-027.md`, `MW-035.md`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `ledger-v2.json` (55 задач, revision 324) — отбор по `MW-001|MW-016|MW-027|MW-035`; `task_board_list` с `includeArchived`; `.work/tasks/tasks.json` (группировка статусов: 53 `planned` + 2 `superseded`); шапки карточек `MW-027.md:1-8`, `MW-035.md:1-8`; `.work/tasks/INDEX.md:69,97`; `Get-ChildItem .work\reports -match 'MW-001'`; `FINAL-REPORT.md:325` (§7.4(3)) и `:593` (§12.3(7)).
- **Фактическое значение:** `ledger-v2.json`: `MW-001` → `status "failed"`, `archivedAt 1789665740576`; `MW-027` → `status "backlog"`, `archivedAt 1789753502873`; `MW-035` → `status "backlog"`, `archivedAt 1789753502890`. `MW-027.md:1`: «> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.» Отчётов по MW-001 два: `MW-001-target-capabilities.md` (48 011 Б) и `MW-001-review.md` (25 739 Б).
- **Оценка severity:** minor
- **Комментарий:** Обе половины утверждения верны: MW-001 действительно числится `failed` при двух отчётах (и двух исполнениях, `executionCount: 2`), MW-027/MW-035 помечены `superseded` в карточках, `tasks.json` и `INDEX.md`, а их статус в живом леджере — `backlog`. Найденное расхождение — в хвосте строки-рефа D-14 и в `FINAL-REPORT.md:325`: «лежат в backlog **и формально запускаемы**». Обе карточки с 2026-09-18 22:45:02 (локальное время, Asia/Yekaterinburg) находятся в архиве (`counts.archived = 3` — MW-001, MW-027, MW-035), а архивированные участники не запускаются: `src/host-ledger.ts:868-875` — «Archived members never run», плюс `:738,:776` — «archived task is read-only». Значит пункт плана «F: архивировать `superseded` MW-027/MW-035» (`01-MASTER-PLAN.md:137`) в живом леджере уже выполнен, а «формально запускаемы» устарело. Замечание: снимок `.work/tasks/board-export.json` (41 задача) поля `archivedAt` не содержит вовсе (0 вхождений строки), поэтому по нему архивное состояние не видно — этим и объясняется формулировка анализа.

---

## Якорь A06-4: 10-DECISIONS.md:1058,173 — `.work/tasks/MW-047.md:21`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `10-DECISIONS.md:1058` и `:173`; `MW-047.md:21` (строка приёмки).
- **Фактическое значение:** `MW-047.md:21`: «SSE-кадр не содержит карточек, только revision/projectionRevision/cursor/degraded.» и «Проекция не пишет audit: пятьдесят перемещений внутри зоны дают ноль audit-строк и пятьдесят бампов ревизии.» `10-DECISIONS.md:1058`: ««SSE-кадр не содержит карточек, только revision/projectionRevision/cursor/degraded» (`.work/tasks/MW-047.md:21`), «Проекция не пишет audit: пятьдесят перемещений внутри зоны дают ноль audit-строк» (там же)».
- **Оценка severity:** info
- **Комментарий:** Обе цитаты найдены дословно на указанной строке; вторая усечена в цитировании на «и пятьдесят бампов ревизии», смысл не искажён. `10-DECISIONS.md:173` ссылается на тот же `MW-047.md:21` как на требование поверхности (SSE-кадр + проекция) — соответствует тексту строки. Строка действительно используется как довод-блокер «доске без attempts нечего показывать» (:1058) — контекст цитаты передан верно.

---

## Якорь A06-5: 10-DECISIONS.md:1499,1511 — `.work/tasks/MW-048.md:18,21`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `10-DECISIONS.md:1499` и `:1511`; `MW-048.md:18` (объём) и `:21` (приёмка).
- **Фактическое значение:** `MW-048.md:18`: «Создать packages/web (@dsh-mywork/web) с exports["./client"], манифестом dsh.client (platform web) и собственной сборкой lazy-CJS формата (banner window.__ModuleLoader__.load)… dsh.client.inject — это ребро порядка загрузки бандлов, а не объявление externals, и react в нём не значится. Зарегистрировать native слоты **main (key mywork)** и **sidebar.panellist (id mywork)** с навигацией через **ctx.layout.selectPanel**…». `MW-048.md:21`: «Ни один модуль не резолвится через dsh.client.inject… и попытка получить модуль иначе падает на build-gate, а не в рантайме.»
- **Оценка severity:** info
- **Комментарий:** Цитаты в `:1499` (`:18` — lazy-CJS/PLATFORM_MODULES/`dsh.client.inject`) и в `:1511` (`:21` — «в бандле нет hex-литералов» и «`dsh.client.inject` — ребро порядка загрузки, не объявление externals») совпадают с первоисточником дословно. Формулировка якоря «про id панели и layout» соответствует именно `:18`: `main (key mywork)` / `sidebar.panellist (id mywork)` и `ctx.layout.selectPanel`. Это же место подтверждает корректность довода `:1504` о том, что в манифесте 0.4.3 externals не объявлены (`dsh.client.inject` перечисляет пакеты).

---

## Якорь A06-6: 10-DECISIONS.md:1059,1252,1639 — `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:339` + ADR021 ред. 2026-09-18

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md` — заголовки ADR (`Select-String '^#+\s*ADR0\d\d'`), строки 1-20, 205-235 и 330-350; сверены `10-DECISIONS.md:1059,1252,1639`; перекрёстно `01-MASTER-PLAN.md:292` (D06) и `10-DECISIONS.md:542,551,594,1792`.
- **Фактическое значение:** Существуют ровно ADR016…ADR028 (`:83` `## ADR016` … `:377` `## ADR028`), включая `:211` `## ADR021. Native DSH slots first, DSH-web adapter second`. `:339` (внутри ADR026): «**Decision.** L2 по умолчанию: worker → детерминированная verification → независимый AI-review → human integration gate → integrate → done. Reviewer обязан отличаться от worker'а и не иметь прав `IMPLEMENTATION_WRITE_PERMISSIONS`… `done` требует **и** review, **и** интеграции.» ADR021 в редакции владельца: `:224` «**Судьба legacy-плагина (решение владельца, 2026-09-18).**… После верифицированного cutover строка `web-ui-task-board` **убирается из профиля**. Это убирает три вещи…: безусловный daily-heartbeat на `dsh-market.com` без выключателя, DOM-наблюдатель на `document.body` и инъекцию в центральную колонку, а также риск того, что кто-то включит legacy auto-run…».
- **Оценка severity:** info
- **Комментарий:** ADR021 в редакции 2026-09-18 существует: дата фиксации документа — `:9` «Дата фиксации: 2026-09-18», а решение внутри ADR021 помечено «(решение владельца, 2026-09-18)»; так его и называют план (`01-MASTER-PLAN.md:292`) и решения (`10-DECISIONS.md:542,594,1792`). Про legacy board/heartbeat ADR021 говорит ровно то, что пересказывает план: строка удаляется после верифицированного per-workspace cutover, и среди трёх доводов есть «безусловный daily-heartbeat без выключателя». Все три ссылки (`:1059`, `:1252`, `:1639`) ведут на `…v0.2-decisions.md:339` и соответствуют тексту ADR026. Отдельно: план сам фиксирует, что один из трёх доводов ADR021 устарел (DOM-наблюдателя в 0.4.3 нет — `10-DECISIONS.md:597`), и просит правку ADR021 (`:608-610`); в файле этот довод на `:224` пока не исправлен, то есть ADR-действие не выполнено.

---

## Якорь A06-7: 01-MASTER-PLAN.md:64 — `.work/plan-v0.3/evidence/lead-05-storage.md`, `lead-06-composition-root.md`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `01-MASTER-PLAN.md:64` (D-4); `lead-05-storage.md:7`; `lead-06-composition-root.md:5-7` и `:19`; повторная read-only проверка `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → `False` и наличия `.tmp\plan-v03-lead\graph.mjs` → `True`.
- **Фактическое значение:** `lead-05-storage.md:7`: «`pwsh` → `DSH_HOME=C:\Users\Dmitry\.dsh`, `Test-Path $DSH_HOME\dsh-mywork` → **False** (exit 0), т.е. живой БД нет». `lead-06-composition-root.md:5-7`: «`node .tmp/plan-v03-lead/graph.mjs .` → **exit 0**. Пакетов 12; **достижимо из controller = 4**… **Недостижимо = 8**». `lead-06-composition-root.md:19`: «Порядок списка миграций… **падает**: probe → `StorageError invalid-input: migrations must be ordered by unique version, 2 follows 4`. Верный порядок — evidence (v2,v3) до lease (v4)».
- **Оценка severity:** info
- **Комментарий:** Все три факта присутствуют в указанных файлах в указанных формулировках; D-4 ссылается именно на эти два свидетельства. Дополнительно проверена актуальность первого факта на сегодня: `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → `False` (то есть живого состояния MyWork по-прежнему нет), скрипт `graph.mjs` на месте. Оба свидетельства — снимки состояния на 2026-09-27, сами по себе они не перепроверялись повторным прогоном (полный прогон graph/probe запрещён рамками проверки), но их цитируемость и соответствие D-4 подтверждены.

---

## Сводка

| Якорь | Вердикт | Severity |
|---|---|---|
| A06-1 | ПОДТВЕРЖДЕНО | major |
| A06-2 | ЛОЖНО (вторая половина) | major |
| A06-3 | ПОДТВЕРЖДЕНО | minor |
| A06-4 | ПОДТВЕРЖДЕНО | info |
| A06-5 | ПОДТВЕРЖДЕНО | info |
| A06-6 | ПОДТВЕРЖДЕНО | info |
| A06-7 | ПОДТВЕРЖДЕНО | info |

**Итог:** подтверждено 6, неверная строка 0, ложно 1, не существует 0, устарело 0, не проверено 0.

**Что осталось непроверенным и почему**

- Повторные прогоны `node .tmp/plan-v03-lead/graph.mjs` и probe-composition не выполнялись: запрет на прогоны/сборку в рамках этой проверки; проверена цитируемость и (для `Test-Path`) актуальность.
- Поведение `auto-review` в рантайме (реальные решения `allow/deny` на вызовах) не наблюдалось — проверен только факт монтирования и активности фибры через `plugin_manager list_plugins`.
- Точное время архивации MW-027/MW-035 выведено из `archivedAt` живого леджера (1789753502873 / 1789753502890 → 2026-09-18 22:45:02 Asia/Yekaterinburg), а не из лога операции: журнал операций доски не читался.
