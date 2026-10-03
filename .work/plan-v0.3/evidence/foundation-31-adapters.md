# F-31 · Composition root: регистрация в `myworkAdapters` (+ точки подключения Context/Memory/Skill)

**Статус: READY_FOR_REVIEW** (с зафиксированным отклонением от буквального текста шага — см. ниже)

## Что сделано

1. `app.start()` публикует в реестр порты, которыми владеет корень: **`artifact-store` (`mywork-evidence`)** и **`lease-store` (`mywork-lease`)**; `app.stop()` снимает их (`handle.unregister()`), поэтому повторный mount не даёт дублей.
2. Владелец жизненного цикла — **один**: `index.ts` регистрирует только эффект `app.stop()`, а `app.stop()` снимает свои регистрации; `adapters.close()` вызывается там же, в единственном эффекте.
3. Создан `tests/app-adapters.test.mjs` — 2 теста (гейт F-31).

## Изменённые пути

- Modify `packages/controller/src/app.ts` (`publish()`, `handles`)
- Modify `packages/controller/src/index.ts` (единственный эффект вместо двух)
- Create `tests/app-adapters.test.mjs`
- Modify `scripts/smoke.mjs` (шаг реестра учитывает опубликованные строки — см. F-32)

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/app-adapters.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0` — **гейт F-31** |
| Тест 1 | 0 | до `start()`: `adapters.size === 0`; после: `list().map(adapterId).sort()` = `['mywork-evidence','mywork-lease']`, kinds = `['artifact-store','lease-store']`, `resolve('artifact-store').ok === true`; после `stop()`: `size === 0`, `resolve('artifact-store').ok === false` |
| Тест 2 (гейт: «не даёт дублей») | 0 | `start → stop → start`: набор id совпадает с первым, `size === 2`; после финального `stop()` — 0 |
| `node scripts/smoke.mjs` | 0 | шаг «the controller publishes myworkAdapters and accepts a compatible adapter» проходит: после монтирования в реестре ровно две опубликованные строки, фейковый `smoke-memory` доводит `size` до 3, `resolve('memory', …)` резолвит его |

## Отклонение от буквального текста шага (обосновано)

Шаг 1 F-31 перечисляет регистрации «taskgraph (Beads), planner, execution, evidence, scheduler». Так сделать **нельзя**, и это не упрощение:

- `ADAPTER_KINDS` (`packages/adapter-sdk/src/capabilities.ts:31`) — закрытый список из двенадцати портов §36: `agent-runtime, session, model-catalog, taskgraph, task-board, context-provider, memory, skill-provider, workspace, artifact-store, event-bus, lease-store`. `defineAdapterManifest` бросает `TypeError` на неизвестный kind, а `portContractOf` — на kind вне §36. Для planner/execution/scheduler **порта нет**, поэтому «зарегистрировать планировщик» невозможно без изобретения нового порта §36 (это решение уровня архитектуры, не шага).
- Taskgraph регистрирует **сама backend-строка**: `beads-adapter/src/plugin.ts:102-111` берёт `myworkAdapters` из контекста и публикует свой манифест; контроллер его только *резолвит* (F-30). Регистрировать Beads из controller значило бы добавить зависимость на backend и сломать §44.
- Поэтому корень публикует ровно те порты, которыми владеет и которые существуют в §36: `artifact-store` (evidence) и `lease-store` (lease). planner/execution/scheduler остаются достижимыми через `app.services`/`app.planner`/`app.saga`/`app.scheduler` (F-30), а не через реестр адаптеров.

## Точки подключения для `23-…` (шаг 5)

- **Context/Memory/Skill** монтируются здесь же, в `app.start()`, через `adapters.register(...)`: их kinds (`context-provider`, `memory`, `skill-provider`) уже есть в §36, поэтому шов готов и второго composition root не потребуется.
- Память, по D10, своего шва к платформе не имеет — она публикуется как адаптер `memory`; текст идёт через `ctx.systemPrompt.section`, навыки — через `ctx.skills` (это точки вне `app.ts`, их владельцы — шаги `23-…`).

## Ограничения

- Опубликованные манифесты объявляют `capabilities: {}` — порты поддерживают базовый контракт и не заявляют дополнительных возможностей. `require(kind, { capabilities: [...] })` для них вернёт `CAPABILITY_UNSUPPORTED`, пока capabilities не будут объявлены явно (это работа шагов, которые начнут требовать конкретные возможности).
- Повторный `start()` после `stop()` создаёт **новые** инстансы портов (новые регистрации с теми же id) — это проверено тестом: набор id тот же, дублей нет.

## Что НЕ проверено

- Резолв `context-provider`/`memory`/`skill-provider` из этого корня (шаги `23-…`).
- Поведение реестра при регистрации адаптера с тем же id извне (дубль id — `TASK_CONFLICT` от реестра, не проверялось этим шагом).
