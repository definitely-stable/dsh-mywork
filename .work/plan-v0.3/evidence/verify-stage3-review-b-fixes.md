# Verify-fixes B — B2/B6/B4/B5 после delta-раунда (`db7f14e..3e67584`)

**Ревизор:** `review-b` (read-only). **Задача:** `task-13` (claimed, revision 2). **Режим:** verify-fixes — не второе
ревью, а проверка своего же списка findings по ID.
**Зафиксированный tip:** `3e67584ca8e300e03ccbee9bfa63625b120d8a30`, `git status --short` → 0 строк (дерево чистое на
протяжении всей проверки). Дельта: 5 коммитов (`68b99ea` B4, `3e67584` B2/B5/B6 + `be02c6b`/`4a269e9`/`373091e` —
web/pack/peer, вне моего скоупа). Затронутые моими findings файлы: `packages/core/src/worker-surface.ts`,
`packages/core/src/index.ts`, `packages/controller/src/telemetry.ts`, `packages/storage/src/journal-file.ts`,
`tests/worker-surface.test.mjs`, `tests/telemetry.test.mjs`.
**Мутация собранного артефакта:** `packages/core/lib/index.js` — SHA256
`51CDF5E17E72377EAF7A00F2B1BC1CDC12174445968172AEE62E4E68ADAB6A46` до и **точно тот же** после восстановления
(`IDENTICAL=true`), повторный прогон зелёный.

---

## Вердикт

**FIXES VERIFIED.**

Все шесть пунктов моего списка находятся в одном из двух состояний, и каждое подтверждено командой: **B2, B4, B5,
B6 — VERIFIED** (B2 — с мутационной проверкой, B5 — с фальсификацией в обе стороны, B6 — с воспроизведением
исходной полезной нагрузки и трёх режимов отказа канала); **B1 — NOT VERIFIED, открыт осознанно** и ничем в дельте
не замаскирован; **B3 — NOT VERIFIED, остаток по решению**, запись в гейт-отчёте честная. Новых дефектов,
внесённых правками, я не нашёл; одна новая граница поведения зафиксирована ниже как риск при подключении (N1).

| Finding | Verdict | Доказательство (команда → наблюдение) |
|---|---|---|
| **B2** MAJOR fail-open allowlist'а | **VERIFIED** | `node .tmp/review-b/verify-probe.mjs` → пустое пересечение: `THREW WorkerSurfaceError typed=true reason=no-allowlisted-tools correlationId=corr-2 registered=[…]`, **`restrict calls = 0`**; тот же отказ на второй пустой ветке (`permissions: []`); применённый путь: `report keys=["allowed","correlationId","filtered"]`, `restricted`/`reason` отсутствуют. `node --test --test-isolation=none tests/worker-surface.test.mjs tests/telemetry.test.mjs` → `tests 9 / pass 9 / fail 0`. **Мутация:** `if (allow.length === 0) {` → `if (false) {` в собранном `packages/core/lib/index.js` (SHA256 `…AB6A46` → `A8B7C4B5…B28C`) → `tests/worker-surface.test.mjs` **красный**: `✖ the restrict filter carries allow only, and an empty intersection is refused`, `AssertionError: the empty intersection must be refused, not reported`, `pass 2 / fail 1`; восстановление → `IDENTICAL=true`, повторный прогон `pass 9 / fail 0`. |
| **B6** MINOR формы значений + fail-open канала | **VERIFIED** | `verify-probe.mjs`: моя исходная нагрузка `mywork.attempt_count: '3 OR 1=1 -- secret notes'` → `REFUSED TypeError: … must be a finite non-negative integer`; дополнительно отвергнуты `1.5`, `-1`, `Infinity`, `true`, `duration_ms:'1250'`, `duration_ms:-1`, `NaN`, пустой идентификатор, домен-имя файла, а также **производные** значения (`durationMs: NaN/-5`, `attemptCount: 2.5`, `operationDomain: 'exfiltrate'`, `correlationId: '   '`); доставлено 4 записи — только законные. Канал: `absent → telemetry-disabled`, `lookup throws → telemetry-unavailable`, `emit throws → telemetry-failed`; malformed-событие отвергнуто **до** обращения к каналу (`lookups=0`). `tests/telemetry.test.mjs` → `pass 6 / fail 0`. |
| **B4** MINOR докблок read-only | **VERIFIED** | `git show 68b99ea -- packages/storage/src/journal-file.ts` → «Read-only **at the SQL level** … That is not the same as "touches no file": opening a WAL database read-only still lets SQLite create or map its `-shm` and `-wal` sidecars … (measured by review B: a read of `controller.sqlite` left a 32 KiB `-shm` behind)». Формулировка совпадает с моим измерением и больше не переобещает: SQL-часть («no pragma, no statement writes») верна, файловый эффект назван явно. |
| **B5** NIT вакуумная проверка | **VERIFIED** (с остатком, см. R2) | `verify-b5.mjs` воспроизводит проверку дословно на 7 вариантах: реальный источник — зелёный; **алиас импорта** (`IMPLEMENTATION_WRITE_PERMISSIONS as WRITER_SET`) → `namedConstants=1/2` → **красный**; копия в конце файла одной строкой / тремя строками / конкатенацией → **красная** на дубликат-скане. То есть обе манипуляции из мандата действительно ловятся. |
| **B1** MAJOR deny-only не подключён | **NOT VERIFIED — открыт** | `node .tmp/review-b/b1-recheck.mjs` → `transitionReview(to:approved) as an automatic approver -> OK state=approved`; `ruleOnAutoReview(allow) → human-decision-required/security-change`; `HumanDecision present: false`. `git diff db7f14e..3e67584 -- packages/core/src/review.ts` → **0 строк**. Молчаливого «закрытия» нет: `git log db7f14e..3e67584 --format='%s%n%b'` не содержит ни `B1`, ни `deny-only`, ни `E-40`, а шапка `3e67584` перечисляет только `Steps: F-54, F-55, F-56`. |
| **B3** MINOR ложное усыновление | **NOT VERIFIED — остаток** | `git diff --stat db7f14e..3e67584 -- packages/controller/src/migration-allocator.ts packages/controller/src/app.ts` → **пусто** (тронут только `journal-file.ts`, это B4). Поведение не изменилось и не заявлялось исправленным. |

---

## Таблица «что изменено → что проверено»

| Проверка | Команда | Exit | Наблюдение |
|---|---|---|---|
| Живой tip и чистота | `git rev-parse HEAD`; `git status --short` | 0 / 0 | `3e67584…`; 0 строк — дерево чистое, правок поверх ревизии нет |
| Целевые наборы | `node --test --test-isolation=none tests/worker-surface.test.mjs tests/telemetry.test.mjs` | 0 | `tests 9 / pass 9 / fail 0 / cancelled 0`, `duration_ms 60` (до правки было 3+4=7 тестов) |
| Границы + review + deny-only | `… tests/boundaries.test.mjs tests/review.test.mjs tests/auto-review-deny-only.test.mjs` | 0 | `tests 44 / pass 44 / fail 0` — новый импорт `OPERATION_DOMAINS` в controller не нарушил границы, B1-путь не изменился |
| Восстановление версий (регрессия B3) | `… tests/allocator-recovery.test.mjs` | 0 | `tests 4 / pass 4 / fail 0` — дельта аллокатор не тронула |
| Сборка актуальна | mtime `lib/` vs `src/`: core 19:42 > 19:29, controller 19:44 > 19:24, storage 19:42 > 19:17 | — | тесты и пробы читают **собранный** код, содержащий правки (иначе `WorkerSurfaceError` просто не существовал бы) |
| Проба B2/B6 | `node .tmp/review-b/verify-probe.mjs` | 0 | см. таблицу вердикта; 40+ утверждений, все наблюдения выше |
| Мутация B2 (до) | `node .tmp/review-b/mutate-b2.mjs before` | 0 | `PRISTINE_SHA256=51CDF5E1…AB6A46` = `BACKUP_SHA256` |
| Мутация B2 | `node .tmp/review-b/mutate-b2.mjs mutate`; `node --test --test-isolation=none tests/worker-surface.test.mjs` | 0 / **1** | единственное вхождение guard'а заменено; тест красный **именно на нужном утверждении**: `the empty intersection must be refused, not reported`; `pass 2 / fail 1` |
| Восстановление | `node .tmp/review-b/mutate-b2.mjs restore`; `verify` | 0 | `RESTORED_SHA256 = CURRENT_SHA256 = BACKUP_SHA256 = 51CDF5E1…AB6A46`, `IDENTICAL=true`; повторный прогон `pass 9 / fail 0` |
| Фальсификация B5 | `node .tmp/review-b/verify-b5.mjs` | 0 | 7 вариантов, вердикты в таблице вердикта; остаток R2 |
| Перепроверка B1 | `node .tmp/review-b/b1-recheck.mjs` | 0 | `OK state=approved` на текущем tip; см. таблицу вердикта |
| Записи в отчётах | чтение `foundation-stage3-gate.md:72-85,117,124`, `foundation-55:114-131`, `foundation-56:148-162`, `foundation-54:72-82` | — | B1/B3/B4/B5/B6 записаны с моими ID и точными формулировками; см. «Записи и что в них неточно» |

---

## Новые дефекты, внесённые правками

### N1 · MINOR · `packages/controller/src/telemetry.ts:464-479` (валидация теперь покрывает производные значения)

**Что изменилось.** `assertAttributeShapes` (`:464`) выполняется по **собранной** карте атрибутов, то есть проверяет
и значения, выведенные из типизированного входа. Это именно то, чего не хватало (B6), и на сегодняшнем дереве это
безопасно: `emitProductEvent` не вызывается ничем, кроме теста (проверено в ревизии B, `grep` не изменился).
**Что это значит для подключения.** `emitProductEvent` бросает `TypeError` — то есть отказ приходит не в телеметрию,
а в вызывающего: `durationMs: Number.NaN` (например, `Date.now() - undefined`), `durationMs: -5` при кривых часах,
`attemptCount: 2.5`, пустой `taskId` теперь **валит вызов**, тогда как до правки запись просто уезжала. Контракт
модуля это разрешает («a malformed event is refused in every profile»), тесты это фиксируют намеренно
(`tests/telemetry.test.mjs:251` — `refuse('a NaN duration', …)`), и `emitProductEvent` — не путь исполнения попытки. Поэтому MINOR, а не
регрессия: при проводке F-54 владельцу нужно решить, нормализовать ли производные значения до шейп-гейта или
считать NaN/отрицательную длительность дефектом вызывающего. Я не считаю это дефектом правки — считаю границей,
которую следует знать до проводки.

### N2 · NIT · `packages/controller/src/telemetry.ts:366-380` (`telemetry-disabled` покрывает два разных случая)

`probeProductTelemetry` возвращает `telemetry-disabled` и когда сервиса нет (`:374`), и когда сервис есть, но `emit`
не функция (`:378`). Докблок `:10` и `:251-258` описывает `disabled` как «(no service)» / «a profile that does not
mount telemetry» — то есть формулировка уже кода для второго случая. Наблюдение, не дефект: различить их было бы
полезно, но словарь специально ограничен тремя причинами. Минимальный фикс — уточнить докблок («no service, or one
without a callable `emit`»).

---

## Записи и что в них неточно (B1/B3 и отчёты авторов)

- **B1 записан честно.** `foundation-stage3-gate.md:72` — «**открыто осознанно**: F-57 закрывает словарь; проводка —
  этап 4 (E-40/MW-069). Ни один артефакт этапа не заявляет обратное»; `:83` — «До проводки R-22 держится на
  отсутствии вызова, а не на правиле»; `:117` — «приоритет проводки deny-only правила относительно остальных работ
  этапа 4». Это ровно моя формулировка из B1, включая её точность. Коммит `3e67584` тему не задевает.
- **B3 записан как остаток, без переобещания.** `:74` — «записано как остаток (§5.3)»; `:85` — «заимствование
  версий зеркалит журнал, а журнал — авторитет; ручная правка журнала не детектируется (нет контрольной суммы).
  Потери схемы ревьюер не показал». Второе предложение — точно моя оговорка; я проверил, что дельта не трогала
  `migration-allocator.ts`/`app.ts`.
- **Неточность в ссылке (NIT-уровня, не влияет на выводы):** `foundation-55-telemetry-pii.md:55` ссылается на
  `assertAttributeShapes (telemetry.ts:464-479)`, тогда как функция занимает `:464-479` вместе с хелпером
  `fitsAttributeShape`, который начинается на `:481`; сам диапазон указывает на правильное место, но на единицу
  уже, чем описанная в тексте проверка. Проверять нечего — это цитата, а не утверждение о поведении.
- **`foundation-56-worker-surface.md:148-154`** описывает B2 как отказ и добавляет причину («у вызывающего не было
  отказа, который нельзя проигнорировать») — совпадает с кодом и с моей находкой.
- **Отметка об исходном дефекте теста снята корректно:** `tests/telemetry.test.mjs:188-192` теперь говорит, что
  прежняя скалярная формулировка была недостижима именно для названного случая (ревизия B, «невоспроизводимые
  утверждения» 1), и проверка заменена на шейп-гейт.

---

## Что осталось непроверенным и почему

1. **B1 по-прежнему открыт** — это не «непроверенное», а подтверждённое состояние: `transitionReview(to:'approved')`
   даёт `approved` на `3e67584`. Владелец — этап 4 (`E-40`/`MW-069`). Ничто в дельте не заявляет обратного.
2. **B3 по-прежнему остаток** — поведение не менялось; потерю схемы я не показывал ни в ревизии B, ни сейчас, и не
   показываю.
3. **R1 (остаток B5):** проверка вывода allowlist'а из констант остаётся текстовой эвристикой. Мои варианты
   показали, что она ловит алиас и копию в конце файла, но **копия в двойных кавычках** (`["workspace.write",
   "git.write", "shell"]`) остаётся зелёной, как и список, разнесённый по трём строкам по одному элементу. Полное
   закрытие этого класса — сравнение `WORKER_SURFACE_PERMISSIONS`/`WORKER_TOOLS_BY_PERMISSION` с константами
   contracts по значению, а не скан исходника; NIT остаётся NIT.
4. **Живой сеанс воркера** не поднимался (read-only, живой профиль вне границ), поэтому «фильтр действительно сужает
   поверхность живой сессии» и «`restrict` не отвергнет переданные имена» — по-прежнему утверждение по источнику
   платформы. Правка B2 этот вопрос не меняет, но и не закрывает.
5. **Полный прогон воркспейса** — вне скоупа; гейт Lead'а (`833/833/0 skipped`, typecheck 13/13, build/smoke exit 0)
   я не перепроверял и не подтверждаю своими числами.
6. **`emit` без `productTelemetry` в живом контроллере** (композиция F-54) не проверялся: `emitProductEvent`
   по-прежнему не вызывается путями исполнения, а монтаж сервиса — предмет F-54/этапа 4.
