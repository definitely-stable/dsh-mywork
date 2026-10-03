# foundation-53 — F-53: шаговый circuit-breaker агентского цикла

- **Задача:** `task-2` · **Исполнитель:** `budget` · **Дата:** 2026-09-27 (18:5x)
- **Шаг плана:** F-53 (`20-STEPS-foundation.md:1445-1465`), D05, RT-2 · **Зависит:** F-52
- **Коммит шага:** `88ea6f9` (3 файла, +188) · **HEAD проверки:** `db7f14e33bd1a2de37433864e6969b198c6876c8`
- **Статус:** `READY_FOR_REVIEW`

## Шаг 0: определение «шага агентского цикла» (записано до кода)

> **Шаг — это один раунд агентского цикла внутри одной попытки:** агент предъявляет модели текущий контекст, потребляет ответ и совершает не более одного последующего действия по нему.

Отсюда: шаг — **не** `Attempt` (попытка состоит из многих шагов) и **не** «модельный вызов» в смысле §53 (один шаг может породить несколько вызовов). Счётчик поэтому **по попытке**, а потолок — канонический R-16: 60 шагов на попытку. Определение записано в JSDoc модуля `packages/core/src/step-breaker.ts` (шапка) и продублировано здесь, потому что без него лимит бессмыслен.

## Проверка зависимости F-52

| Артефакт F-52 | Проверка | Exit | Наблюдение |
|---|---|---|---|
| `maxSteps` в `BUDGET_LIMIT_NAMES`/`BudgetLimits`/`BUDGET_LIMIT_SCOPES`, счётчик `steps`, ветки `chargeOf`/`usedOf` | `git show 4b51094 --stat` | 0 | 6 файлов, включая `contracts/src/budget.ts` (+41) и `core/src/budget.ts` (+19) |
| дефолт `maxSteps: 60` | `node --test --test-isolation=none tests/budget-defaults.test.mjs` | 0 | `pass 3 / fail 0` (канон проверяется ассертом) |

Второй механизм не строился: брейкер вызывает тот же `decideBudgetAdmission`, читает то же имя лимита и тот же счётчик.

## Изменённые пути

| Путь | Что сделано |
|---|---|
| `packages/core/src/step-breaker.ts` | **Create** — определение шага в JSDoc, `StepBreakerInput`, `stepBudget(input)`, `stepsOfNewAttempt()`. `stepBudget` сужает лимиты до `{ maxSteps }` (обоснование в JSDoc и в тесте: запрос без измерения токенов сделал бы объявленный token-потолок unverifiable и отказывал бы на каждом шаге), собирает `BudgetConsumption` со `steps` и решает через `decideBudgetAdmission` |
| `packages/core/src/index.ts` | один добавленный блок `export { stepBudget, stepsOfNewAttempt, type StepBreakerInput } from './step-breaker.ts'` (2 строки) |
| `tests/step-breaker.test.mjs` | **Create** — 2 теста (как требует гейт плана `pass 2`) |

**Правило сброса — явное:** счётчик принадлежит одной попытке и обнуляется **только** при `newAttempt: true`. Без этого флага перенесённый счётчик остановил бы задачу, которая сделала retry, на шаговом потолке цикла, которого она не выполняет; тест 2 проверяет и отказ без флага, и допуск с флагом, и `newAttempt: false`.

## Таблица «лимит → значение → поведение при превышении»

| Лимит | Значение по умолчанию | Статус значения | Область | Чем заряжается | При превышении |
|---|---|---|---|---|---|
| `maxSteps` | 60 | **КАНОН** (R-16, D05) | `task`; счётчик `BudgetConsumption.steps`, сброс на новой попытке по явному `newAttempt: true` | `request.kind === 'step'` (+1) | `{ kind: 'refused', refusal: { limit: 'maxSteps', scope: 'task', reason: 'limit-exceeded', used, requested } }` — та же форма, что у любого лимита §30 |
| `maxTokensPerTask` | 2 000 000 | **КАНОН** (R-16, D05) | `task` | `model-call` tokens | то же (через ту же точку enforcement `core/src/scheduler.ts:568`) |
| `maxAttempts` | 8 | **ПРЕДЛОЖЕНИЕ** (D05, ждёт владельца) | `task` | `attempt` (+1) | то же |
| `maxReviewLoops` | 4 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `review-loop` (+1) | то же |
| `maxPlannerCalls` | 12 | **ПРЕДЛОЖЕНИЕ** (D05) | `task` | `planner-call` (+1) | то же |
| `maxCostPerTask` | 25 | **ПРЕДЛОЖЕНИЕ** (D05; единица = единица `ModelRate`) | `task` | `model-call` cost | то же |
| `maxOptimizerCostPerDay`, `workspaceDailyBudget`, `providerDailyBudget` | не объявлены | намеренно (нет ledger'ов scope в этой сборке) | — | — | не проверяются |

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/step-breaker.test.mjs` | 0 | **`pass 2` / `fail 0`** (гейт плана F-53 шаг 5) |
| `node --test --test-isolation=none tests/step-breaker.test.mjs tests/budget.test.mjs` | 0 | **`pass 17` / `fail 0`**, exit 0 (гейт F-53 и регрессия) |
| `corepack pnpm --filter @dsh-mywork/core run build` | 0 | `Build complete` (после добавления barrel-строки) |
| `corepack pnpm --filter @dsh-mywork/core run typecheck` | 0 | вывод пуст, exit 0 |
| мутация: `case "maxSteps": return knownAmount(consumption.steps);` → `return knownAmount(0);` в собранном `packages/core/lib/index.js` | 1 | `tests/step-breaker.test.mjs` → `tests 2 / pass 0 / fail 2` с двумя реальными `AssertionError` (в т.ч. «without the reset the cycle stops on the carried count»); `tests/budget.test.mjs` → `pass 14 / fail 1` |
| восстановление бэкапа + повторный прогон | 0 | SHA256 совпал с исходным; `pass 17 / fail 0`, exit 0 |
| `node --test --test-isolation=none tests/scheduler.test.mjs` | 0 | `pass 27 / fail 0` — точка enforcement попыток не затронута |

Тесты F-53: (1) четвёртый шаг при потолке 3 → `refused`/`limit-exceeded` с `used = 3`, `requested = 1`, при потолке `{}` — допуск, при объявленном token-потолке брейкер читает только `maxSteps`, некорректные счётчики/потолки → `TypeError`; (2) сброс: без флага — отказ, с `newAttempt: true` — допуск с `used = 0`, `newAttempt: false` — отказ, канон 59/60/60+новая попытка.

## Что НЕ сделано

- **Никто не вызывает `stepBudget`:** агентского цикла (runtime, считающий раунды) в дереве ещё нет — брейкер это механизм, точка вызова принадлежит карточке runtime. Это главное ограничение шага.
- Шаги нигде не записываются в `BudgetConsumption` реальным путём: `chargeConsumption` умеет считать `steps` (проверено тестом), но вызовов из рантайма нет.
- `steps` не выведены в `SchedulerCharge`/`SchedulerWorkBudget`: шаги происходят внутри попытки, а не на её допуске.
- Ежедневные/провайдерские лимиты не задействованы (см. таблицу).

## Что не проверено

- Поведение брейкера на реальном длинном цикле (нет самого цикла).
- Взаимодействие шагового потолка с retry-политикой исполнения (кто именно передаёт `newAttempt: true` и в какой момент) — решение будущей карточки runtime; здесь зафиксировано только правило.

## Известные отклонения процесса (важно для ревьюера)

- В коммит `88ea6f9` попал **чужой блок** барреля `packages/core/src/index.ts` (11 строк, экспорт `AUTO_REVIEW_*` из `./review.ts`, работа F-57): `git add <файл>` стейджит файл целиком, а F-57-поток уже застейджил свой блок. Итог: один коммит-окно вершина не проходила `typecheck` (экспорт ссылался на символы, которых в `review.ts` этого коммита ещё не было); следующая чужая фиксация `28793b3` (F-57) это закрыла, сейчас `git show HEAD:packages/core/src/review.ts | Select-String 'AUTO_REVIEW_'` даёт совпадения и `typecheck core` exit 0. Lead решил историю не переписывать (вариант «а»).
- Процессное исправление, принятое после этого: перед коммитом общего барреля грепать **застейдженный** hunk (`git diff --cached -- <файл>`) на строки вне своего блока, а не доверять числу строк. Применено к F-51.
- Во время прогонов `packages/beads-adapter/lib` дважды отсутствовал из-за OOM его сборки в чужом `pnpm -r run build`; артефакт восстанавливался мной под build-локом с `--max-old-space-size=8192` (позже исправлено коммитом `61e04e0`). Один из прогонов мутации из-за этого был недействителен и перезапущен после восстановления — в отчёте оставлены только валидные прогоны.
