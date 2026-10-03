# foundation-56 — allowlist инструментов worker-поверхности (F-56, D15)

База: `500c566` (F-55). Изменённые файлы: `packages/core/src/worker-surface.ts` (создан),
`packages/core/src/index.ts` (добавлен один блок `export { … } from './worker-surface.ts'`,
`index.ts:468`), `tests/worker-surface.test.mjs` (создан).

## Цитата D15

> «**Allowlist** worker-поверхности (scoped `agent.ctx.tools.restrict`/`guard`) + `auto-review`
> **только deny**» … «deny-only режима в платформе нет — это правило MyWork из ADR026»
> (`01-MASTER-PLAN.md` §7.1, строка D15)

> «Запрет `cordis_*`/dynamic/`plugin_manager`; `auto-review` только deny; права роли — через
> `sandbox-policy`/`fs-observation-policy`» (там же, краткая строка D15)

## Почему allowlist, а не denylist — механизм

`packages/core/tools/src/index.ts:1114-1117` (DSH-чекаут): `restrict` считает **неизвестное имя
ошибкой** — причём и в `allow`, и в `deny`:

```
const known = this.view(scope).restrictableNames
const unknown = [...allow ?? [], ...deny ?? []].filter(name => !known.has(name))
if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool…`)
```

Значит denylist для ещё не зарегистрированных инструментов (`task_board_*`, динамические плагины)
**невыразим by construction**: его нельзя даже собрать. Allowlist этой проблемы не имеет, потому что
пересекается с тем, что композиция реально зарегистрировала: `workerTools(available)`
(`worker-surface.ts:122`) — и в фильтр попадают только существующие имена. Это проверено не только
тестом: пробник на реальном инвентаре дал `FILTER_NAMES_UNKNOWN: 0` (см. ниже).

## Источник и не-дублирование

| `файл:строка` | Что |
|---|---|
| `packages/contracts/src/security.ts:201` | `REVIEWER_DEFAULT_PERMISSIONS = ['workspace.read','git.read','tests','review.approve']` |
| `packages/contracts/src/security.ts:212` | `IMPLEMENTATION_WRITE_PERMISSIONS = ['workspace.write','git.write','shell']` |
| `packages/core/src/worker-surface.ts:38` | `WORKER_SURFACE_PERMISSIONS` — **спред этих двух импортированных констант**, новых прав не вводится |
| `packages/core/src/worker-surface.ts:52` | `WORKER_TOOLS_BY_PERMISSION` — тип `Record<Permission, readonly string[]>`, **тотальный** по словарю прав: новое право в контрактах = ошибка компиляции здесь, а не молчаливая дыра |
| `packages/core/src/worker-surface.ts:83` | `workerToolAllowlist(permissions)` — вывод имён из набора прав |
| `packages/core/src/worker-surface.ts:108` | `WORKER_TOOL_ALLOWLIST` — объявленная поверхность по умолчанию |
| `packages/core/src/worker-surface.ts:194` | `applyWorkerSurface(tools, input)` — вызов `tools.restrict({ allow })` (`:207`) + отчёт |
| `packages/core/src/worker-surface.ts:207` | сам вызов: `tools.restrict(Object.freeze({ allow }))` — **без `deny`** |

`Permission` — закрытый union (`packages/contracts/src/team.ts:34-58`, 12 значений). Раньше в MyWork
не было ни одного упоминания `allowlist`/`restrict` (проверено grep'ом в этой кампании: 0).

## Список инструментов: до и после фильтра

«До» — фактический инвентарь имён инструментов платформы, снятый с DSH-чекаута:
`get files packages,apps -Recurse *.ts | regex "defineTool\(\{\s*name:\s*'([a-z0-9_]+)'"` → **60 имён**
(включая примеры/фикстуры самого чекаута: `greet`, `always_fail`, `reverse_text`, `template_echo`,
`large_value`).

```
ДО (60): always_fail, ask_user_question, bash, cordis_inspect_list, cordis_inspect_query, create_goal,
edit, get_goal, glob, greet, grep, interrupt_agent, job_kill, job_list, job_output, large_value,
list_agents, list_mcp_resource_templates, list_mcp_resources, list_subagent_models,
load_workspace_dependencies, lsp, plugin_manager, present, pwsh, ralph, read, read_image,
read_mcp_resource, reverse_text, schedule_create, schedule_delete, schedule_list, schedule_update,
send_message, session_event_read, session_event_search, session_event_trace, session_search,
session_trace, skill, spawn_teammate, str_replace_editor, team_task_create, team_task_get,
team_task_list, team_task_update, template_echo, terminal_close, terminal_list, terminal_open,
terminal_read, terminal_send, terminal_signal, todo_write, update_goal, wait_agent, web_fetch,
web_search, write

ALLOWLIST (10): write, edit, str_replace_editor, pwsh, bash, read, read_image, glob, grep, lsp

ПОСЛЕ (10): bash, edit, glob, grep, lsp, pwsh, read, read_image, str_replace_editor, write

ОТБРОШЕНО (50): always_fail, ask_user_question, cordis_inspect_list, cordis_inspect_query,
create_goal, get_goal, greet, interrupt_agent, job_kill, job_list, job_output, large_value,
list_agents, list_mcp_resource_templates, list_mcp_resources, list_subagent_models,
load_workspace_dependencies, plugin_manager, present, ralph, read_mcp_resource, reverse_text,
schedule_create, schedule_delete, schedule_list, schedule_update, send_message, session_event_read,
session_event_search, session_event_trace, session_search, session_trace, skill, spawn_teammate,
team_task_create, team_task_get, team_task_list, team_task_update, template_echo, terminal_close,
terminal_list, terminal_open, terminal_read, terminal_send, terminal_signal, todo_write, update_goal,
wait_agent, web_fetch, web_search
```

Целевые имена D15 (`cordis_*`, `plugin_manager`, dynamic) — в отброшенных. Отчёт для аудита:

```
FILTER (1): {"allow":["bash","edit","glob","grep","lsp","pwsh","read","read_image","str_replace_editor","write"]}
REPORT: correlationId=corr-f56 restricted=true reason=restricted allowed=10 filtered=50
FILTER_NAMES_UNKNOWN: 0
```

## Команды и наблюдения

| Команда | exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/worker-surface.test.mjs` (до сборки `core`) | 1 | красный: `TypeError: core.workerTools is not a function`, `tests 3 / pass 0 / fail 3` |
| `corepack pnpm --filter @dsh-mywork/core run typecheck` | 0 | ошибок нет (в т. ч. по `worker-surface.ts`) |
| `corepack pnpm --filter @dsh-mywork/core run build` (под `.tmp/build.lock`) | 0 | `✔ Build complete in 35077ms`, `lib/index.js 461.60 kB` |
| `node --test --test-isolation=none tests/worker-surface.test.mjs` (после сборки) | 0 | `tests 3 / pass 3 / fail 0 / cancelled 0`, `duration_ms 29.35` |
| `node .tmp/f56-surface-after.mjs` (пробник «до/после») | 0 | списки выше; `filtered=50`, `FILTER_NAMES_UNKNOWN: 0` |
| Мутация M1 в собранном `lib/index.js`: `if (!granted.has(permission)) continue;` → `if (false) continue;` | 1 | `pass 0 / fail 3`; тест 2 упал на `a narrower set must narrow the surface` |
| Мутация M2 там же: `workerTools` возвращает вход без фильтра | 1 | тот же прогон; тесты 1 и 3 упали на `deep-equal` |
| Восстановление бандла из копии, SHA256 до/после | 0 | `PRISTINE = RESTORED = D06689A04A2E6A326C86F1E460C10F35F35CBB0CAF21D3BF12FDAEA47AB2BCF4`; повторный прогон `pass 3 / fail 0` |

Вывод после реализации:

```
✔ workerTools keeps the allowlisted tools and drops everything else (1.8048ms)
✔ the allowlist is derived from the contracts permission sets, not authored beside them (0.8374ms)
✔ the restrict filter carries allow only, and the report names what it removed (0.2904ms)
ℹ tests 3 / ℹ pass 3 / ℹ fail 0
```

## Открытый вопрос D15: распространяется ли фильтр на субагентов worker'а

**Ответ: да, распространяется — по источнику, не пробой.** Ребёнок создаётся внутри окна создания
родителя, и его scope наследует цепочку родителя:

> «…a per-child restriction **intersects with everything its chain admits**»
> (`packages/subagent/subagent/src/child-agent.ts:186-187`)

Механика — пересечение по цепочке при выборке:

> «Restrictions intersect across the whole chain: any scope on it may mask an inherited name for
> everything nested inside it» — `if (layers.every(layer => layer.admits(name))) visible.set(name, definition)`
> (`packages/core/tools/src/index.ts:1198-1200`)

**Границы этого ответа (записаны, а не замолчаны):**

1. Собственные регистрации scope **вне фильтра**: `packages/core/tools/src/index.ts:1202-1208`
   («The scope's own registrations last, shadowing an inherited name and **outside the filter above**»).
   То есть worker, зарегистрировавший инструмент в своём scope, увидит его вопреки allowlist.
   `restrict` режет унаследованное, а не своё.
2. Транспорт `run_code` ограничить нельзя вообще: `packages/core/tools/src/index.ts:1111-1112`
   (и он исключён из фильтра — `:1215-1217`).
3. Проверено чтением исходников, **не** живом сеансом: снять фактический `ctx.tools` →
   `view().visible` worker-сессии в этой кампании не удалось (в плане это помечено `~`, §7.2).
   Поэтому «после» выше — это allowlist, пересечённый с инвентарём платформы, а не с живой сессией.

## Что не сделано

- Новые типы прав не вводились (запрет F-56): источник — только `security.ts:201,212`.
- `deny` не используется нигде: `worker-surface.ts:261` передаёт ровно `{ allow }`, и тест
  проверяет `Object.keys(filter) deepEqual ['allow']`.
- Плагины профиля не трогались, живой `C:\Users\Dmitry\.dsh` не читался и не писался;
  `workerTools.restrict` в живом сеансе не вызывался — вызов делает вызывающая сторона,
  передавая scoped `agent.ctx` (`core/tools/src/index.ts:1100`: context-global `restrict`
  бросает исключение).
- Пустое пересечение — **отказ**, а не состояние отчёта (исправлено по ревизии B, finding B2).
  `applyWorkerSurface` бросает типизированную `WorkerSurfaceError` с `reason: 'no-allowlisted-tools'`,
  и `restrict` при этом не вызывается: `restrict({ allow: [] })` замаскировал бы весь scope, включая
  зарегистрированное позже. Отчёта в этом случае **не существует**, поэтому `filtered` не может
  назвать инструменты, которых сессия не теряет. Прежняя формулировка («решение зафиксировано тестом,
  а не оставлено на усмотрение вызывающего молча») была сильнее кода и снята: тест фиксировал
  значение отчёта, а у вызывающего не было отказа, который нельзя проигнорировать.

## Ревизия B: findings B2/B5 и что изменилось

Проверка: `.work/plan-v0.3/evidence/verify-stage3-review-b.md` (ревизор `review-b`, `task-8`),
вердикт **PASS WITH FINDINGS**; B2 — MAJOR, B5 — NIT, исправлены здесь; B1 (MAJOR) и B3/B4/B6 —
не этот шаг (B6 исправлен в `packages/controller/src/telemetry.ts`, см. `foundation-55`).

### B2 (MAJOR): пустое пересечение было fail-open

**Что было не так.** Ветка возвращала `{restricted:false, reason:'no-allowlisted-tools'}`, `restrict`
не вызывался, а `filtered` перечислял инструменты, которых сессия **не теряет**. Проба ревизора:
`restrict called: 0 times`, `filtered: [plugin_manager, cordis_list, task_board_run]`, сессия
сохраняет все три. Для контроля безопасности «не применил фильтр» обязано быть отказом.

**Как исправлено** (`packages/core/src/worker-surface.ts`):

| `файл:строка` | Что |
|---|---|
| `worker-surface.ts:136` | `WorkerSurfaceReason = 'no-allowlisted-tools'` — причина отказа (та же экспортируемая, что и раньше, но теперь это отказ, а не состояние) |
| `worker-surface.ts:155` | `WorkerSurfaceError` — типизированная ошибка отказа |
| `worker-surface.ts:194` | `WorkerSurfaceReport` больше не несёт `restricted`/`reason`: отчёт существует только для применённого фильтра |
| `worker-surface.ts:251-259` | пустое пересечение → `throw new WorkerSurfaceError('no-allowlisted-tools', …)` **до** любого вызова `restrict` |
| `worker-surface.ts:261-266` | отчёт возвращается **после** `tools.restrict(...)`, поэтому `filtered` называет реально снятое |

Ошибка несёт `reason`, `correlationId` и `registered` — то есть отказ привязан к попытке и говорит,
что именно было зарегистрировано. Стиль — как у `MigrationAllocatorError`
(`packages/controller/src/migration-allocator.ts:119-141`): типизированный класс + `is…`-guard.

### B5 (NIT): структурная проверка читала шапку подстрокой

Было: `source.slice(0, source.indexOf("from '@dsh-mywork/contracts'"))` + подстрочный поиск — не
отличает импорт от упоминания в комментарии и не видит копию ниже шапки. Стало
(`tests/worker-surface.test.mjs`): разбор **спецификаторов импорта** регуляркой
`import { … } from '<specifier>'` (как в `tests/boundaries.test.mjs`), проверка, что спецификатор
`@dsh-mywork/contracts` найден и что в его списке имён есть обе константы; плюс скан **всего файла**
на строку с двумя членами одного набора.

### Команды и наблюдения (delta)

| Команда | exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/core run typecheck` | 0 | ошибок нет |
| `corepack pnpm --filter @dsh-mywork/core run build` (под `.tmp/build.lock`) | 0 | `✔ Build complete in 28328ms` |
| `node --test --test-isolation=none tests/worker-surface.test.mjs` | 0 | `tests 3 / pass 3 / fail 0` |
| Приёмочная команда: `node --test --test-isolation=none tests/worker-surface.test.mjs tests/telemetry.test.mjs tests/auto-review-deny-only.test.mjs` | 0 | `tests 12 / pass 12 / fail 0` |
| Мутация M1 в собранном `packages/core/lib/index.js`: `if (allow.length === 0) {` → `if (false) {` (отказ заменён прежним молчаливым поведением) | 1 | `pass 2 / fail 1`; упал именно тест 3: `the empty intersection must be refused, not reported` |
| Мутация M4a: в `packages/core/src/worker-surface.ts` дописана строка `const LEAKED_COPY = ['workspace.read', 'git.read']` | 1 | `pass 2 / fail 1`: `this line looks like a copy of a permission set` |
| Мутация M4b: импорт `REVIEWER_DEFAULT_PERMISSIONS as REVIEWER_PERMS` | 1 | `pass 2 / fail 1`: `the reviewer set must be imported` |
| Восстановление: SHA256 `packages/core/lib/index.js` и `packages/core/src/worker-surface.ts` до/после мутаций | 0 | `CORE_RESTORED=True`, `SRC_RESTORED=True`; повторный приёмочный прогон `pass 12 / fail 0` |

### Что этот шаг по-прежнему НЕ гарантирует

- **Вызывающего нет.** `applyWorkerSurface` не вызывается ни одним путём исполнения (ревизор B,
  команда 14): отказ сработает, когда вызов появится (E-40/MW-069), но сам по себе шаг живой сессии
  не защищает. Ревизор B отметил это как смягчающее обстоятельство B2 — здесь оно записано, а не
  использовано как оправдание.
- `tools.restrict` в живом scoped-контексте не вызывался; `appliesTo`-вопроса мандата в репозитории
  нет (ревизор B, команда 16).
