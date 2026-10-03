# F-44 · Session conformance: причины отказа сессии и 8 тестов

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node --test --test-isolation=none tests/session-conformance.test.mjs` → **EXIT 0, 8 тестов / 8 pass / 0 fail**. Регрессии: `tests/session.test.mjs` + новый файл → **59 / 59 pass / 0 fail**; затронутый набор (см. таблицу) → **189 / 189 pass / 0 fail**. Живой дом не тронут: `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → **False**.

## Изменённые пути

- Modify `packages/contracts/src/session.ts` — словарь `SessionRefusalReason` (`:978`), `SESSION_REFUSAL_REASONS` (`:998`), `SESSION_REFUSAL_CODES` (`:1016`); один пункт в шапке модуля («Three further rules» → «Four further rules»).
- Modify `packages/controller/src/dsh-session.ts` — карта `ADAPTER_CODE_OF_REFUSAL` (`:294`), класс `DshSessionRefusal` (`:315`), **11** мест отказа переведены на него (`:392, :449, :465, :568, :664, :671, :684, :690, :868, :871, :878`), обновлены doc-комментарии модуля и `#pinPermission`.
- Create `tests/session-conformance.test.mjs` — 676 строк, **8** тестов.
- Create `.work/plan-v0.3/evidence/foundation-44-session-conformance.md` — этот файл.

Ничего больше не тронуто: `packages/contracts/src/index.ts`, чужие пакеты, чужие тесты и план-файлы — без изменений; коммитов и тегов нет.

## Что сделано

1. **Словарь причин** — по образцу `ROLLOVER_REFUSAL_REASONS`/`ROLLOVER_REFUSAL_CODES` (`packages/contracts/src/session.ts:846-867`): union + frozen-список + карта на канонические `MyWorkErrorCode`. Имена буквально из шага 4 плана.
2. **Различимость в контроллере.** Отказ теперь несёт причину: `DshSessionRefusal extends AdapterError` с полями `reason: SessionRefusalReason` и `refusalCode: MyWorkErrorCode` (из `SESSION_REFUSAL_CODES`). Все 11 мест отказа переведены на него.
3. **`AdapterErrorCode` не расширен**, и ни один транспортный код не изменён: `invalid-ref` / `unavailable` / `conflict` остались ровно там, где были. Поэтому `tests/runtime.test.mjs` (17/17 pass) продолжает проходить **без правок** — его закрепы `adapterErrorWith('unavailable')` на `:459` и `:471` и `adapterErrorWith('conflict')` на `:523` остались верными.
4. **8 тестов**: `read-only`, `danger-full-access`, «нет живого агента» (три непокрытые ветки) + по тесту на каждую из четырёх причин + тест «четыре причины не схлопываются» + тест «каждая объявленная причина достижима, список и карта согласованы».

### Почему подкласс, а не что-то другое

| Вариант | Почему отклонён |
|---|---|
| Новые значения в `AdapterErrorCode` | Запрещено задачей: тип документирован как adapter-internal (`packages/adapter-sdk/src/errors.ts:21`), и он транспортный, а не причинный. |
| `AdapterRefusal` (`details.reason`) | Класс живёт в `packages/adapter-sdk` — вне моего write-scope. Кроме того, смена класса на `AdapterRefusal` сломала бы `isAdapterError`-закрепы `tests/runtime.test.mjs` (чужой файл). |
| Причина в тексте сообщения | Сообщение документально «never parsed by callers» (`errors.ts:126`); тест, разбирающий текст, — хрупкий. |
| **`DshSessionRefusal extends AdapterError`** | Аддитивно: `name` остаётся `AdapterError`, поэтому `isAdapterError()` и `Symbol.hasInstance` через границу бандла продолжают работать; причина едет данными рядом с кодом. |

Побочный эффект на публичную поверхность: `controller/src/index.ts` ре-экспортирует фиксированный список имён из `dsh-session.ts` (`:84-112`) и **не** ре-экспортирует новый класс; этот файл — за другим потоком, поэтому не тронут. Тест поэтому читает `error.reason` / `error.refusalCode` по факту (duck-typing), а не импортирует класс. См. «Что НЕ проверено», п. 3.

## Таблица причин и обоснование маппинга

Все прецеденты — в том же файле `packages/contracts/src/session.ts`.

| Причина | Канонический код §42 | Обоснование и прецедент в файле |
|---|---|---|
| `session-missing` | `SESSION_NOT_FOUND` | Идентичность не разрешится никогда. Код документально: «The referenced session does not exist» (`operation.ts:54-55`). Прецедент: `'window-closed' → 'SESSION_NOT_FOUND'` (`session.ts:861`). |
| `session-not-live` | `STALE_REVISION` | Запись у вызывающего отстала от живого runtime: запись жива, агента нет. Прецедент той же формы: `'stale-window' → 'STALE_REVISION'` (`session.ts:860`) — «the expectation of the caller no longer matches the window» (`:826-830`). |
| `session-scope-mismatch` | `CONTRACT_MISMATCH` | Вызывающий и запись расходятся в составе запуска. Прецеденты: `'capsule-attempt-mismatch'` (капсула другого attempt) и `'capsule-invalid'` (капсула другой задачи/workspace) → `CONTRACT_MISMATCH` (`session.ts:862-863`), плюс `'attempt-mismatch'` (`:859`). |
| `runtime-unavailable` | `ADAPTER_UNAVAILABLE` | Адаптер за портом не может обслужить вызов: нет поверхности, нет команды, или ответ нечитаем. Прецедент: `'session-create-failed' → 'ADAPTER_UNAVAILABLE'` (`session.ts:865`). |

**Альтернатива `SECURITY_DENIED` отклонена**: она закреплена за self-approval/эскалацией (`packages/core/src/security.ts:141-148, 186-192` — `self-approval`, `permission-missing`, `harness-policy`, `path-escape`), то есть за решением авторизации, а не за состоянием сессии.

## Сайты отказа: было → стало

Столбец «было» — транспортный код до правки; «стало» — причина + канонический код. Транспортный код намеренно не изменён (см. п. 3 выше), поэтому таблица плана «было `unavailable` → стало `<код>`» читается как «стало различимой причиной и каноническим кодом».

| # | Место в `dsh-session.ts` (было → стало) | Условие | Было | Стало: причина | Транспортный код | Код §42 |
|---|---|---|---|---|---|---|
| 1 | `:330` → `:392` | ростер не знает сессию (`cancel`) | `invalid-ref` | `session-missing` | `invalid-ref` | `SESSION_NOT_FOUND` |
| 2 | `:388` → `:449` | лог открылся без кадра | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |
| 3 | `:404` → `:465` | лог открылся кадром, который биндинг не читает | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |
| 4 | `:506` → `:568` | ростер не знает сессию (`status`) | `invalid-ref` | `session-missing` | `invalid-ref` | `SESSION_NOT_FOUND` |
| 5 | `:600` → `:664` | профиль не даёт agent registry / command runtime | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |
| 6 | **`:607` → `:671`** | **`agents.get(sessionId) === undefined`** | `unavailable` | **`session-not-live`** | `unavailable` | `STALE_REVISION` |
| 7 | `:620` → `:684` | в деплое нет `/permission` | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |
| 8 | `:626` → `:690` | команда отказала в политике | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |
| 9 | `:800` → `:868` | платформа: `session/not-found` | `invalid-ref` | `session-missing` | `invalid-ref` | `SESSION_NOT_FOUND` |
| 10 | `:803` → `:871` | платформа: `session/conflict` / `agent-preset/conflict` / `session/invalid-time-zone` | `conflict` | `session-scope-mismatch` | `conflict` | `CONTRACT_MISMATCH` |
| 11 | `:808` → `:878` | нераспознанный отказ платформы | `unavailable` | `runtime-unavailable` | `unavailable` | `ADAPTER_UNAVAILABLE` |

Сайты 1 и 4 (ростер) в списке задачи не названы, но говорят ровно то же «сессии нет»: они переведены вместе с остальными, иначе один и тот же отказ нёс бы причину в одних путях и не нёс в других. `gateway/cancelled` намеренно остаётся обычным `AdapterError('cancelled')` — отмена не является ни одной из четырёх причин.

## Тесты (8/8) и что каждый доказывает

| # | Тест | Доказательство |
|---|---|---|
| 1 | `read-only` | Пин уходит как `/permission read-only`, и контракт (`HARNESS_POLICY_CEILING['read-only']`) не допускает `workspace.write`: гейт отказывает с `SECURITY_DENIED` / `details.reason = 'harness-policy'` — отказ, а не «попробуй ещё»; чтение при этом разрешено. |
| 2 | `danger-full-access` | Пин `danger-full-access`, потолок допускает `workspace.write`, гейт авторизует; **на диск ничего не записано** (`existsSync(TOUCHED) === false`). |
| 3 | нет живого агента | `agents.get` → `undefined` даёт `session-not-live` / `STALE_REVISION`, а не `runtime-unavailable`; политика не пинится, промпт не admitted. |
| 4 | `session-missing` | Принятие незнакомой сессии и чтение ростера дают одну причину / `SESSION_NOT_FOUND`. |
| 5 | `session-scope-mismatch` | Противоречащий workspace и противоречащий preset дают одну причину / `CONTRACT_MISMATCH`. |
| 6 | `runtime-unavailable` | Шесть способов «деплой не может обслужить» (неизвестный сбой, нет command runtime, нет `/permission`, команда отказала, лог без кадра, лог с нечитаемым кадром) — одна причина; запуск не стартует без политики. |
| 7 | четыре причины не схлопываются | Четыре отказа → четыре разные причины и четыре разных канонических кода; `session-not-live` и `runtime-unavailable` имеют **один** транспортный код — именно поэтому причина едет рядом с кодом. |
| 8 | достижимость и согласованность | `Object.keys(probes).sort()` ⇔ `SESSION_REFUSAL_REASONS.sort()` (прецедент `tests/session.test.mjs:519`), каждая причина достижима, `SESSION_REFUSAL_CODES` покрывает ровно список, каждое значение — реальный код из `MYWORK_ERROR_CODES`, повторов нет. |

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/contracts run build` | **0** | `✔ Build complete in 1094ms`, `lib\index.js 75.49 kB` |
| `corepack pnpm --filter @dsh-mywork/controller run build` | **0** | `✔ Build complete in 45202ms`, `lib\index.js 438.05 kB` (heap 8192 в скрипте пакета) |
| `corepack pnpm --filter @dsh-mywork/contracts run typecheck` | **0** | `tsc --noEmit` — исчерпывающность `Record<SessionRefusalReason, MyWorkErrorCode>` |
| `corepack pnpm --filter @dsh-mywork/controller run typecheck` | **0** | `tsc --noEmit` — исчерпывающность `Record<SessionRefusalReason, AdapterErrorCode>` |
| `node --test --test-isolation=none tests/session-conformance.test.mjs` | **0** | **8 tests / 8 pass / 0 fail**, `duration_ms 72.6` — гейт F-44 |
| `node --test --test-isolation=none tests/session.test.mjs tests/session-conformance.test.mjs` | **0** | **59 / 59 pass / 0 fail** |
| `node --test --test-isolation=none tests/runtime.test.mjs` | **0** | **17 / 17 pass / 0 fail** — закрепы транспортных кодов не сломаны |
| `node --test --test-isolation=none tests/session-conformance.test.mjs tests/session.test.mjs tests/security.test.mjs tests/model-availability.test.mjs tests/routing.test.mjs tests/runtime.test.mjs tests/adapters.test.mjs` | **0** | **151 / 151 pass / 0 fail** |
| `node --test --test-isolation=none tests/boundaries.test.mjs tests/app-adapters.test.mjs tests/app-lifecycle.test.mjs tests/app-store.test.mjs tests/app-subsystems.test.mjs` | **0** | **38 / 38 pass / 0 fail** — бандл контроллера остался самодостаточным |
| Мутация (см. ниже), затем `node --test … tests/session-conformance.test.mjs` | **1** | **5 pass / 3 fail** — падают ровно тесты 3, 7, 8 |
| `corepack pnpm --filter @dsh-mywork/controller run build` (восстановление) | **0** | `✔ Build complete in 43110ms`; мутированный литерал отсутствует |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` | — | **False** (после всех прогонов) |

### Мутационная проверка (тест, который не может упасть — дефект, а не тест)

В собранном `packages/controller/lib/index.js` причина сайта 6 подменена на `runtime-unavailable` (`MUTATION_APPLIED`), прогон дал `pass 5 / fail 3`:

- ✖ `a session with no live agent is refused as not-live, not as an outage`
- ✖ `the four causes never collapse into one another`
- ✖ `every declared refusal cause is reachable, and the list and the map agree`

Артефакт восстановлен пересборкой (не правкой бандла), `BUILD_EXIT=0`.

## Изоляция от живого дома

`tests/session-conformance.test.mjs` вызывает `scratchDshHome('session-conformance')` (общий хелпер `tests/lib/tmp-home.mjs`, он уже был в дереве) **до** динамического импорта бандла контроллера, и `assertScratchHome()` в каждом тесте. Каталог прогона — `.tmp/session-conformance-dsh-home`; живой профиль не адресуется даже на чтение. Проверено после всех прогонов: `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` → **False**.

## Что НЕ проверено

1. **Реальная запись на диск** под `danger-full-access` не выполнялась — это прямо вне рамок шага (риск плана: «проверять контракт порта, а не фактическую запись»). Проверено: какой режим пинован, что потолок допускает `workspace.write`, что гейт авторизует, и что файла нет.
2. **Платформенный enforcement** (`sandbox-policy` + `fs-observation-policy`) не включался: это шаг владельца `23-…`/§9.1 (MW-007/015), здесь проверялся контракт MyWork.
3. **Ре-экспорт `DshSessionRefusal` через `packages/controller/src/index.ts`.** Файл за другим потоком и не тронут, поэтому класс доступен только из `dsh-session.ts`. Тест это учитывает (duck-typing). Решение для Lead: если публичная поверхность должна включать класс, это правка одной строки в `index.ts:85-112` — вне моего write-scope.
4. **Union как тип** (`SessionRefusalReason`) проверен только компилятором (два `Record<SessionRefusalReason, …>` в `tsc --noEmit` дают исчерпывающность); во время выполнения перечислим `SESSION_REFUSAL_REASONS`.
5. **Repo-wide гейт не запускался** — по инструкции кампании его гоняет Lead. Прогнаны только затронутые наборы (таблица выше). Полносуточный прогон `node --test --test-isolation=none "tests/**/*.test.mjs"` не выполнялся; взаимодействия быть не должно by construction: `scratchDshHome` идемпотентен («first call in a process wins», `tests/lib/tmp-home.mjs:48-56`), а мои тесты не зависят от конкретного имени скретч-каталога.
6. **`session/invalid-time-zone`** замаплен на `session-scope-mismatch` вместе с остальными `conflict`-кодами, но отдельным тестом не покрыт (в фейке такого кода нет); это заявленное, а не проверенное соответствие.

## Открытые риски для ревьюера

- Транспортный код `session-not-live` — `unavailable` (как и было). Различимость обеспечивает `reason`/`refusalCode`, а не `AdapterErrorCode`; если ревью ожидало смену именно транспортного кода на сайте 6, это осознанное расхождение с планом, обоснованное запретом расширять `AdapterErrorCode` и сохранением закрепов `tests/runtime.test.mjs`.
- Причина едет на *копии* класса из инлайн-бандла контроллера. Кросс-бандловый `instanceof` работает (проверено `adapterSdk.isAdapterError`), поля `reason`/`refusalCode` — обычные свойства экземпляра и через границу бандла читаются.
