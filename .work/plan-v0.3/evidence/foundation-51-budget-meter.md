# foundation-51 — F-51: мост `tokenMeter.measure(...)` → `BudgetCharge`

- **Задача:** `task-2` · **Исполнитель:** `budget` · **Дата:** 2026-09-27 (19:0x, локальное время хоста)
- **Шаг плана:** F-51 (`20-STEPS-foundation.md:1388-1416`), D05 · **Зависит:** F-31, F-43
- **База:** `d0c97bf` (на момент старта) · **Коммит шага:** `db7f14e` · **HEAD проверки:** `db7f14e33bd1a2de37433864e6969b198c6876c8`
- **Статус:** `READY_FOR_REVIEW`

## Проверка зависимостей (по артефактам, не по статусу)

| Зависимость | Артефакт | Команда | Exit | Наблюдение |
|---|---|---|---|---|
| F-31 (composition root) | `packages/controller/src/app.ts`, подсистемы и регистрация в `myworkAdapters` | `node --test --test-isolation=none tests/app-subsystems.test.mjs tests/app-lifecycle.test.mjs` | 0 | `pass 3 / fail 0` |
| F-31 (то же, adapter/store половина) | порты и store | `node --test --test-isolation=none tests/app-adapters.test.mjs tests/app-store.test.mjs` | 0 | `pass 4 / fail 0` |
| F-43 (model availability) | `RouteRefusalReason: model-not-routable` в `packages/core/src/*.ts` | `node --test --test-isolation=none tests/model-availability.test.mjs` + `Select-String -Path packages\core\src\*.ts -Pattern 'model-not-routable'` | 0 | `pass 3 / fail 0`; 2 вхождения `model-not-routable` |

Обе зависимости подтверждены кодом и зелёными тестами до начала работы; «реализовывать вокруг» непринятой зависимости не потребовалось.

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/controller/src/budget-meter.ts` | **Create** — структурный порт `TokenMeterPort`/`TokenMeasurement` (зеркало `token-meter/src/types.ts:22-35`), `MeasurementSource`, `MeasuredCharge extends BudgetCharge`, `bridgeMeasurement()`, `createBudgetMeter()`. Ни платформенный пакет, ни `node:*` не импортируются: только `@dsh-mywork/contracts` (типы) и `@dsh-mywork/core` (`knownAmount`, `modelCallCost`, `readCallTokens`, `unknownAmount`) |
| `packages/controller/src/app.ts` | опция `MyWorkApplicationOptions.tokenMeter?: TokenMeterPort`, поле/геттер `MyWorkApplication.budgetMeter: BudgetMeter \| undefined`, одна строка импорта, привязка `budgetMeter` на композиции. Правки F-63b (`controllerPath`, `adopt: adoptedAllocations(...)`, `journalName`, `adoptedAllocations`) не тронуты — сверено diff'ом |
| `packages/controller/src/index.ts` | один добавленный блок `export { … } from './budget-meter.ts'` |
| `tests/budget-meter.test.mjs` | **Create** — 3 теста |

Порядок коммитов отличается от порядка шагов плана: F-52 → F-53 → F-51. Причина: `packages/controller/src/index.ts` был занят in-flight работой telemetry/UI-потока (F-54/F-55), и Lead выдал его отдельным решением; contracts/core-часть при этом была свободна. Разблокировка зафиксирована сообщениями Lead'а; мой модуль и его проводка закоммичены одним коммитом, как требует карточка.

## Решения D05, зафиксированные этим шагом

1. **`tokens` всегда известны:** `knownAmount(measurement.totalTokens)`. Эвристический итог (`baseline.kind === 'estimated'`) — это измерение, и он известен; пустая поверхность (`'none'`, `totalTokens === 0`) — измеренный ноль, а **не** `unknownAmount`. Это отличие от поведения `chargeConsumption` (там пропуск измерения делает измерение unknown, `core/src/budget.ts:128-129`) — прямое требование F-51 шаг 2, и оно проведено в тесте.
2. **`cost` — только из раскладки, которая существует.** `modelCallCost` ценит input и output отдельно; раскладку несёт только `baseline.kind === 'usage'` (`readCallTokens(baseline.usage)`). Для `estimated`/`none` стоимость `unknownAmount('…carries no input/output split to price')`, а не «итог по цене input»: цена неразложимого итога была бы числом, которого никто не измерял; fail-closed сторона — объявленный cost-лимит отказывает как unverifiable. **Это решение D05, ожидающее подтверждения владельца** (альтернатива — консервативная верхняя граница по большей из двух ставок).
3. **Провенанс едет с зарядом:** `MeasuredCharge` — это `BudgetCharge` (структурно принимается и `chargeConsumption`, и `SchedulerCharge`), плюс обязательные `tokens`, `cost`, `source`, `logRevision`. Никакого второго хранилища: MyWork по-прежнему хранит только `BudgetConsumption`.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/budget-meter.test.mjs` | 0 | **`pass 3` / `fail 0`** (гейт F-51) |
| `Select-String -Path packages\**\src\*.ts -Pattern 'tokenMeter'` | 0 | **15 совпадений** (было 0): `app.ts` — 5, `budget-meter.ts` — 9, `index.ts` — 1 |
| `corepack pnpm --filter @dsh-mywork/controller run build` | 0 | `Build complete` (bundle собирается: `budget-meter` инлайнится в `lib/index.js`) |
| `corepack pnpm --filter @dsh-mywork/controller run typecheck` | 0 | вывод пуст, exit 0 (`MeasuredCharge extends BudgetCharge` с обязательными `tokens`/`cost` проходит при `exactOptionalPropertyTypes: true`) |
| `node .tmp/f51-enforcement-probe.mjs` | 0 | см. ниже |
| `node --test --test-isolation=none tests/scheduler.test.mjs` | 0 | `pass 27 / fail 0` — единственная точка enforcement не сломана |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | 0 | `pass 31 / fail 0` — новые импорты `packages/controller/src` (только `@dsh-mywork/*`) проходят allowlist |

### Probe: измеренная величина доходит до единственной точки enforcement

`.tmp/f51-enforcement-probe.mjs` (read-only, gitignored) собирает tick планировщика, у которого `PendingWork.budget.charge` — результат `createBudgetMeter(fake).chargeFor(...)`:

```
CHARGED: {"tokens":{"kind":"known","value":1500},"cost":{"kind":"known","value":3500},"source":"usage","logRevision":42} METER_CALLS: 1
AT_CEILING admissions: 1 [["task"]] deferrals: []
OVER_CEILING admissions: 0 deferrals: ["budget-refused"]
METER_CALLS_AFTER_PLANNING: 1
```

- при `maxTokensPerTask: 1500` (ровно на потолке) — 1 допуск, `budgetScopes: ['task']`;
- при `maxTokensPerTask: 1499` — 0 допусков, причина `budget-refused`: решает именно измеренное число;
- `measure()` вызван **один раз** на заряд и ни разу во время планирования — второго учёта нет.

### Точки вызова `decideBudgetAdmission`

`Select-String -Path packages\**\src\*.ts -Pattern 'decideBudgetAdmission\('` даёт три строки: определение `core/src/budget.ts:225`, вызов в точке enforcement `core/src/scheduler.ts:568` и вызов в `core/src/step-breaker.ts:74` (F-53 — переиспользование того же гейта, не второй механизм). Второй точки enforcement для попыток/ревью нет.

## Таблица «лимит → значение → поведение при превышении»

| Лимит | Значение по умолчанию | Статус значения | Область | Чем заряжается | При превышении |
|---|---|---|---|---|---|
| `maxSteps` | 60 | **КАНОН** (R-16, D05) | `task` (счётчик `steps`, сброс на новой попытке) | `step` (+1) | `refused`/`limit-exceeded` → `needs-attention`, `retry: false` |
| `maxTokensPerTask` | 2 000 000 | **КАНОН** (R-16, D05) | `task` | `model-call` tokens | то же |
| `maxAttempts` | 8 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `attempt` (+1) | то же |
| `maxReviewLoops` | 4 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `review-loop` (+1) | то же |
| `maxPlannerCalls` | 12 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `planner-call` (+1) | то же |
| `maxCostPerTask` | 25 | **ПРЕДЛОЖЕНИЕ** (D05; единица = единица `ModelRate` деплоя) | `task` | `model-call` cost | то же |
| `maxOptimizerCostPerDay`, `workspaceDailyBudget`, `providerDailyBudget` | не объявлены | намеренно (нет ledger'ов этих scope в сборке) | — | — | не проверяются: отсутствие лимита ≠ ноль |

Канонический состав значений — «60 шагов и 2 000 000 токенов на попытку» (R-16/D05). Пометка в исходнике: `CANON` / `PROPOSAL` на каждой константе `DEFAULT_BUDGET_LIMITS`; «канон 2M» в плане сформулирован «на попытку», а §30-имя — `maxTokensPerTask` («на задачу») — это формулировка карточки F-52 шаг 4, отмечено как наблюдение, не дефект.

## Что НЕ сделано

- `apply()` в `packages/controller/src/index.ts` **не** читает `ctx.tokenMeter`: композиционный корень принимает порт опцией, но строка плагина его пока не передаёт. Точка вызова появится вместе с путём расходования (claim path / агентский цикл) — эта карточка её не содержит.
- `source`/`logRevision` нигде не сохраняются: `BudgetConsumption` полей провенанса не имеет, и заводить их карточка запрещает (хранится только `BudgetConsumption`).
- Настоящий `TokenMeter` из DSH не инстанцировался: проверен структурный порт + фейк. Платформенный пакет в этом дереве не является зависимостью (и не может: `boundaries.test.mjs` запрещает `@deepseek-ai/*`, кроме cordis).
- Регрессионные наборы вне перечисленных (runtime/session/adapter-*) не прогонялись — это гейт Lead'а.

## Известные отклонения процесса

- Коммиты шагов пришлось упорядочить F-52 → F-53 → F-51 из-за занятого общего barrel'а `packages/controller/src/index.ts` (in-flight работа F-54/F-55). Мои правки `app.ts` ждали в рабочем дереве и были закоммичены вместе с модулем; чужие блоки не стейджились.
- Во время прогонов `packages/beads-adapter/lib` дважды отсутствовал: `pnpm -r run build` валил его сборку по OOM (её `build` — голый `tsdown`). Артефакт восстановлен мной под build-локом сборкой с `--max-old-space-size=8192`; позже исправлено коммитом `61e04e0` (не мой scope).

## Что не проверено

- Поведение моста на реальном измерении живой DSH-сессии (нужен смонтированный профиль; см. выше).
- Влияние стоимости `unknown` для эвристических baseline'ов на реальные задачи (решение D05 п.2 выше) — это то, что должен подтвердить владелец.