# foundation-52 — F-52: значения по умолчанию §30 и поведение при превышении

- **Задача:** `task-2` · **Исполнитель:** `budget` · **Дата:** 2026-09-27 (18:4x–19:0x)
- **Шаг плана:** F-52 (`20-STEPS-foundation.md:1420-1441`), D05 · **Зависит:** F-51
- **Коммит шага:** `4b51094` (6 файлов, +464/−6) · **HEAD проверки:** `db7f14e33bd1a2de37433864e6969b198c6876c8`
- **Статус:** `READY_FOR_REVIEW`

## Проверка зависимости F-51

F-51 закоммичен **после** F-52 (см. порядок в `foundation-51-budget-meter.md`: barrel контроллера был занят чужим потоком). Содержательной зависимости у F-52 от F-51 нет — шаг трогает только `contracts`/`core`, — но формально порядок шагов плана нарушен, и это зафиксировано, а не скрыто. Проверка артефакта F-51 на момент F-52: `packages/controller/src/budget-meter.ts` существовал и `node --test --test-isolation=none tests/budget-meter.test.mjs` давал 3/3 (до коммита F-51).

## Исходная проблема (проверенные факты)

| Факт | Ссылка | Наблюдение |
|---|---|---|
| Лимитов нет ни у кого | `core/src/budget.ts:210-212` | «A limit the request does not charge is not checked at all» — а объявлять значения было негде: `DEFAULT_BUDGET_LIMITS` не существовало |
| Три исхода отказа | `core/src/budget.ts:228,231,234` | `scope-not-measured`, `limit-unverifiable`, `limit-exceeded`; `refuse()` — `:242-254` |
| Гейт отказывает, а не чинит | `core/src/budget.ts:10-12` | выбор из pause/escalate/human — политика вызывающего; отсюда `budgetOutcome` |
| Уже есть счётчики | `core/src/budget.ts:262-263` | `chargeOf(maxAttempts)` = «один attempt = одна единица» — механизм шага переиспользует это, а не изобретает своё |

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/contracts/src/budget.ts` | `BudgetConsumption.steps`, `EMPTY_BUDGET_CONSUMPTION.steps = 0`, `BudgetLimitName \| 'maxSteps'` (девятое имя, §30-восьмёрка сохраняет порядок), `BUDGET_LIMIT_NAMES` + `'maxSteps'`, `BUDGET_LIMIT_SCOPES.maxSteps: 'task'`, `BudgetLimits.maxSteps`, `BudgetRequestKind \| 'step'`, `BUDGET_REQUEST_KINDS` + `'step'`, JSDoc шапки |
| `packages/core/src/budget.ts` | `BudgetCharge.steps`, `chargeConsumption` считает и записывает `steps`, `chargeOf('maxSteps') = request.kind === 'step' ? 1 : undefined`, `usedOf('maxSteps') = consumption.steps`, `requireConsumption` валидирует `steps` |
| `packages/core/src/budget-defaults.ts` | **Create** — `DEFAULT_BUDGET_LIMITS`, `budgetLimitsFrom(config)`, `BudgetOutcome`, `budgetOutcome(decision)` |
| `packages/core/src/index.ts` | один добавленный блок `export { … } from './budget-defaults.ts'` (7 строк) |
| `tests/budget-defaults.test.mjs` | **Create** — 3 теста |
| `tests/budget.test.mjs` | **намеренная правка**: в закреплённый список `BUDGET_LIMIT_NAMES` добавлено девятое имя, в `chargeFor()` — `case 'maxSteps'`, добавлены проверки записи счётчика `steps`, границы шагового потолка и валидации `steps`. Правка видна в diff'е (`+54`), молчаливой подмены нет |

## Таблица «лимит → значение → поведение при превышении»

| Лимит | Значение по умолчанию | Статус значения | Область | Чем заряжается | При превышении |
|---|---|---|---|---|---|
| `maxSteps` | 60 | **КАНОН** (R-16, D05) | `task` (счётчик `steps`, сброс на новой попытке) | `step` (+1) | `refused`/`limit-exceeded` → `needs-attention` (триггер `budget-exhausted`), `retry: false`, причина — сам `BudgetRefusal` |
| `maxTokensPerTask` | 2 000 000 | **КАНОН** (R-16, D05) | `task` | `model-call` tokens | то же |
| `maxAttempts` | 8 | **ПРЕДЛОЖЕНИЕ** — требует подтверждения владельца (D05) | `task` | `attempt` (+1) | то же |
| `maxReviewLoops` | 4 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `review-loop` (+1) | то же |
| `maxPlannerCalls` | 12 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `planner-call` (+1) | то же |
| `maxCostPerTask` | 25 | **ПРЕДЛОЖЕНИЕ** (D05) — единица = единица `ModelRate` деплоя (при «цена за токен» это 25 крупных единиц) | `task` | `model-call` cost | то же |
| `maxOptimizerCostPerDay` | не объявлен | намеренно: ledger'а `optimizer-day` в сборке нет, дефолт дал бы `scope-not-measured` на каждом допуске | — | — | не проверяется |
| `workspaceDailyBudget` | не объявлен | намеренно (то же) | — | — | не проверяется |
| `providerDailyBudget` | не объявлен | намеренно (то же) | — | — | не проверяется |

`budgetLimitsFrom(config)`: отсутствующий или `undefined` ключ сохраняет дефолт; неизвестное имя (`maxStep`) — `TypeError` «§30 declares no budget limit…», а не тихое «лимита нет»; значение проверяется на неотрицательное конечное число; результат заморожен.

`budgetOutcome(decision)`: `admitted` → те же `checks`; `refused` → `{ kind: 'needs-attention', needsAttention: 'budget-exhausted', cause: refusal, retry: false }`. Триггер — существующий `NeedsAttentionReason` §5.7 (`contracts/src/board.ts:362`, «A budget ran out with no retry allowed»), переход `executing → needs-attention` легален (`core/src/task.ts:54-63`). **«Молчаливого retry» нет by type:** `retry: false` — литеральный тип, а не соглашение.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/budget-defaults.test.mjs` | 0 | **`pass 3` / `fail 0`** (гейт F-52) |
| `node --test --test-isolation=none tests/budget.test.mjs` | 0 | `pass 15 / fail 0` — регрессия с намеренной правкой зелёная |
| `corepack pnpm --filter @dsh-mywork/contracts run build` | 0 | `Build complete` |
| `corepack pnpm --filter @dsh-mywork/core run build` | 0 | `Build complete` |
| `corepack pnpm --filter @dsh-mywork/core run typecheck` | 0 | после исправления одной ошибки сужения (`budgetOutcome`, `Property 'kind' does not exist on type 'never'` — discriminant читается как `unknown`, как это делает `requireAmount`) |
| `Select-String -Path packages\core\src\budget-defaults.ts -Pattern 'maxAttempts\|maxTokensPerTask'` | 0 | 3 совпадения (гейт плана «≥2») |
| мутация: `maxSteps: 60` → `maxSteps: 61` в собранном `packages/core/lib/index.js` | 1 | `tests/budget-defaults.test.mjs` → `pass 2 / fail 1` с `AssertionError` на каноническом значении; восстановление из бэкапа → SHA256 совпал, прогон снова `pass 3 / fail 0` exit 0 |

### Почему `steps`-запрос отказывает на полном наборе дефолтов (зафиксировано тестом)

`decideBudgetAdmission({ limits: DEFAULT_BUDGET_LIMITS, … request: { kind: 'step' } })` → `refused`/`limit-unverifiable` на `maxTokensPerTask`: шаг не измеряет токены, а объявленный token-потолок без измерения неверифицируем (§30). Именно поэтому `stepBudget` (F-53) читает только `maxSteps`. Это записано тестом, а не оставлено читателю.

## Что НЕ сделано

- **Режим «предупреждать, не останавливать»** (Шаг 0 карточки F-52: «первый прогон — в режиме warn») не реализован: поведение этого шага — останавливать (`refused` → `needs-attention`). Warn-режим — решение владельца, и его нельзя было выбирать за него.
- Шесть значений (кроме двух канонических) **не подтверждены владельцем**; в исходнике они помечены `PROPOSAL` построчно. → **Закрыто 2026-09-27: владелец подтвердил значения как рекомендовано (см. §«Решение владельца» ниже); пометки `PROPOSAL` в `budget-defaults.ts` заменены на `CONFIRMED`.**
- Единица `maxCostPerTask` каноном не зафиксирована; 25 осмысленно только как «единица `ModelRate` деплоя».
- Нет чтения значений из конфигурации деплоя (профиля/строки плагина): точка настройки — программная `budgetLimitsFrom()`.
- Значения не подключены к `SchedulerWorkspaceState.budget` (это поле объявляет деплой); `DEFAULT_BUDGET_LIMITS` пока никем не потребляется в рантайме.

## Что не проверено

- Прогон репозиторных наборов целиком — гейт Lead'а.
- Влияние дефолтов на реальную работу (риск карточки «значения остановят реальную работу») — только владелец может подтвердить на реальном прогоне.

## Известные отклонения процесса

- Первая версия `budgetOutcome` не компилировалась (сужение union до `never`); ошибка поймана `typecheck` и исправлена в том же шаге.
- Во время шага `packages/beads-adapter/lib` отсутствовал из-за OOM его сборки в чужом `pnpm -r run build` (исправлено позже коммитом `61e04e0`); прогон пришлось делать после восстановления артефакта под build-локом.

## Решение владельца (D05, 2026-09-27)

Владелец подтвердил значения **как рекомендовано**: четыре бывших предложения становятся дефолтами, с которыми развёртывание работает.

| Лимит | Значение | Статус после решения |
|---|---|---|
| `maxSteps` | 60 | канон (R-16) — не менялся |
| `maxTokensPerTask` | 2 000 000 | канон (R-16) — не менялся |
| `maxAttempts` | 8 | **подтверждено владельцем** |
| `maxReviewLoops` | 4 | **подтверждено владельцем** |
| `maxPlannerCalls` | 12 | **подтверждено владельцем** |
| `maxCostPerTask` | 25 | **подтверждено владельцем** (единица — единица `ModelRate` развёртывания) |
| `maxOptimizerCostPerDay`, `workspaceDailyBudget`, `providerDailyBudget` | не объявлены | **подтверждено владельцем**: лимит без ledger'а не объявляется, развёртывание с ledger'ами объявляет его через `budgetLimitsFrom` |

Формулировки «PROPOSAL (D05, owner confirmation required)» в `packages/core/src/budget-defaults.ts` заменены на «CONFIRMED (D05, 2026-09-27)»: держать в коде статус «ждёт решения» после решения — ложное утверждение, а не осторожность. Значения по-прежнему переопределяются через `budgetLimitsFrom(config)`, поведение при превышении не менялось (`refused` → `needs-attention` с `budget-exhausted` и `BudgetRefusal`, `retry: false`).
