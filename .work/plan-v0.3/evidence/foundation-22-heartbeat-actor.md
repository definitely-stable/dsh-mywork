# F-22 · MW-057б: `heartbeat` передаёт актора, как `claim` (+ два дефекта, вскрытых живым `bd`)

**Статус: READY_FOR_REVIEW**

## Что сделано

1. `BeadsTaskGraphAdapter.heartbeat(id, claimant?)` передаёт актора в `BEADS_ACTOR` — как `claim`.
2. План допускал «прежнее поведение при отсутствии актора»; живой `bd 1.3.0` показал, что это невозможно: **анонимный heartbeat отвергается** (`issue already claimed by <holder>`, exit 1). Поэтому актор берётся из состояния claim (`currentAssignee`) — это и есть владелец lease, который обновляется.
3. Добавлен скриптованный тест на `env` (F-22, шаг 1) и подтверждён живой тест `a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)`.
4. **Побочно, но необходимо для гейта F-17** (0 падений при живом backend) исправлены два дефекта, которые до F-13/F-14/F-15 были невидимы, потому что весь real-`bd` слой пропускался:
   - `reclaim` читал **конверт** `bd reclaim --json` как список (`TypeError: rows.map is not a function`);
   - teardown фикстур падал `EPERM` на живом Dolt-каталоге (флак, делал бы строгий прогон красным).

## Изменённые пути

- Modify `packages/beads-adapter/src/adapter.ts` — `heartbeat` (актор), `reclaim` (конверт + `reclaimRowsOf`/`reclaimedIssueId`), типы `BeadsReclaimPayload`/`BeadsReclaimRow`, `run()` (отказ запуска → `ADAPTER_UNAVAILABLE`, см. F-15)
- Modify `tests/beads-adapter.test.mjs` — тест «heartbeat carries the acting identity in BEADS_ACTOR, exactly like claim»; teardown с ретраями

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `bd heartbeat <id>` **без** актора (claim держит `worker-a`) | **1** | `Error: heartbeat mw-qs2: issue already claimed by worker-a` — анонимный heartbeat не обновляет lease вообще |
| `BEADS_ACTOR=worker-a bd heartbeat <id>` | **0** | `✓ Heartbeat mw-qs2 — hb probe (lease refreshed)` |
| `BEADS_ACTOR=worker-b bd heartbeat <id>` | **1** | `Error: heartbeat mw-qs2: issue already claimed by worker-a` — чужой актор тоже отвергнут (подтверждает: актор обязан быть владельцем) |
| `node --test --test-isolation=none tests/beads-adapter.test.mjs` (**до** правки, только real-тесты) | 1 | `✖ a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)` — `AssertionError: Got unwanted rejection. Actual message: "dsh-mywork: bd heartbeat mw-86f failed (exit 1)"` |
| `bd reclaim --json --older-than 0s` | 0 | `{ "count": 0, "reclaimed": null, "schema_version": 1, "scoped": false }` — **конверт**, а не список |
| `node --test … --test-name-pattern='heartbeat'` (после правок) | 0 | `✔ heartbeat carries the acting identity in BEADS_ACTOR, exactly like claim` + `✔ a heartbeat refreshes a held claim and reclaim reverts a stale one (real bd)` |
| `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` | **0** | `ℹ tests 72 / ℹ pass 72 / ℹ fail 0 / ℹ skipped 0` — **гейт F-22** |
| `Select-String packages\beads-adapter\src\adapter.ts -Pattern 'BEADS_ACTOR'` | 0 | **5** совпадений (`:214` документация `env`, `:538`/`:543` claim, `:625`/`:642` heartbeat) — гейт требует ≥2 |

## Что именно изменено в `heartbeat`

```ts
const actor = claimant ?? (await this.currentAssignee(id))
const result = await this.run(
  ['heartbeat', id],
  undefined,
  actor === undefined ? undefined : { BEADS_ACTOR: actor },
)
```

- Аргументы не изменились: актор **никогда** не становится аргументом (`deepEqual(call.args, ['heartbeat', 'mw-1'])` в тесте).
- Явный `claimant` используется как есть и не требует чтения; без него актор — записанный владелец (один лишний `bd show <id> --json`).
- Обратная совместимость: сигнатура расширена необязательным параметром, `TaskGraphPort` в `contracts` менять не потребовалось; при отсутствии владельца (assignee пуст) сохраняется прежний анонимный вызов.

## Дефект `reclaim`, вскрытый тем же прогоном

- Было: `this.parseJson<BeadsIssueRow[]>('reclaim', result.stdout)` → `rows.map(row => row.id)`; при `reclaimed: null` это `TypeError: rows.map is not a function`, то есть **здоровый** результат «нечего восстанавливать» ронял вызывающего.
- Стало: `reclaimRowsOf(payload)` читает `reclaimed` (список | `null` → `[]`; принимается и «голый список» — форма остальных `bd … --json`); `reclaimedIssueId(row)` берёт `issue_id` (имя поля lease-строки), допускает `id` и **отказывает** (`ADAPTER_UNAVAILABLE`), если в строке нет ни того, ни другого — молча выкинуть восстановленный lease нельзя.
- Наблюдаемое сейчас: `reclaimed: null` → `[]`, живой тест `reclaim` проходит.

## Ограничения

- **Заполненный** список `reclaimed` на этой машине получить не удалось: lease живого claim не истекает (`reclaim` его не трогает — это и проверяет тест), TTL через CLI/env не настраивается (`BD_LEASE_TTL`/`BEADS_LEASE_TTL` не сработали), `bd sql` в embedded-режиме отвечает `'bd sql' is not yet supported in embedded mode`, отрицательный `--older-than` отвергается (`must not be negative`). Поэтому имя поля строки (`issue_id`) выведено из бинаря: в `bd.exe` есть JSON-теги `issue_id`, `lease_expires_at`, `assignee` и тип `types.ReclaimedLease`; в коде допущены оба имени и включён fail-closed отказ.
- Teardown фикстур теперь ретраит `rmSync` (`maxRetries: 5`, `retryDelay: 200`) и в крайнем случае печатает предупреждение вместо падения: иначе живой Dolt-каталог делал бы строгий прогон красным случайным образом. **Проверено, что после правки фикстуры удаляются**: контрольный прогон одного real-теста не оставил нового каталога в `%TEMP%`. От прогонов **до** правки осталось **23** каталога `%TEMP%\dsh-mywork-beads-*` (~44 МБ суммарно) — их я не удалял (рекурсивные удаления вне моих условий), они ждут уборки Lead'ом; плюс мой ручной probe-стенд `%TEMP%\bd-heartbeat-probe-de6bb261` (~5 МБ).
- `currentAssignee` делает дополнительный вызов `bd show`; на «горячем» пути heartbeat это +1 процесс (приемлемо: heartbeat идёт по таймеру, не в цикле).

## Что НЕ проверено

- Строка `reclaimed` с реальными данными (см. выше) — единственное место, где форма поля не подтверждена живым выводом.
- Поведение heartbeat, когда lease уже истёк/восстановлен: `bd` документирует отказ («heartbeat fails so the worker learns to stop»), адаптер вернёт `ADAPTER_UNAVAILABLE` — тестом не покрыто.
