# foundation-tests — гигиена тестов: скретч-`DSH_HOME` вместо живого дома

- **Задача:** `task-14` · **Исполнитель:** `hygiene-ops` · **Дата:** 2026-09-27 · **Статус:** `READY_FOR_REVIEW`
- **Инцидент:** прогон `tests/routing.test.mjs` (14:36:42) смонтировал контроллер и создал SQLite в **живом** доме пользователя `C:\Users\Dmitry\.dsh\dsh-mywork\state\*.sqlite`. Файлы удалены Lead'ом; каталог возвращён к состоянию «не существовал».

## Изменённые пути (ровно три файла, как в задаче)

| Путь | Что сделано |
|---|---|
| `tests/lib/tmp-home.mjs` | **Create** — `scratchDshHome(name)`, `assertScratchHome()`, `scratchRoot`. Импортирует только `node:fs`, `node:path`, `node:url` — собранные бандлы не тянет, поэтому вызывается **до** их импорта |
| `tests/runtime.test.mjs` | хелпер импортируется первой строкой (13), `scratchDshHome('runtime')` вызван на 27 — **до** импорта бандлов на 44; `assertScratchHome()` добавлен в 13 тестов, которые монтируют контроллер или создают/стартуют `DshAgentRuntime` |
| `tests/memory-beads.test.mjs` | хелпер первой строкой (29), `scratchDshHome('memory-beads')` на 43 — **до** импорта контроллера на 861; `assertScratchHome()` в монтирующем тесте §44 (855) |

Хелпер идемпотентен (первый вызов в процессе побеждает, повторный ничего не пересоздаёт), ничего не удаляет — скретч-дом остаётся в `.tmp` для разбора после падения.

## Команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` **ДО** | — | **False** |
| `DSH_HOME='C:\Users\Dmitry\.dsh'` → `assertScratchHome()` | 0 | **отказ**: `DSH_HOME resolves to "C:\Users\Dmitry\.dsh", which is not inside "H:\Repo\DSH-MyWork\.tmp"` (живой дом при этом не читается — только сравнение путей) |
| `DSH_HOME=''` → `assertScratchHome()` | 0 | **отказ**: `DSH_HOME is not set; call scratchDshHome('<suite>') before importing a bundle that opens state` |
| `node --test --test-isolation=none tests/runtime.test.mjs` | 0 | **`# pass 17` / `# fail 0`** (гейт) |
| `node --test --test-isolation=none tests/memory-beads.test.mjs` | 0 | **`# pass 17` / `# fail 0`** (гейт) |
| `Test-Path 'C:\Users\Dmitry\.dsh\dsh-mywork'` **ПОСЛЕ** | — | **False** (в т.ч. `…\dsh-mywork\state` → False) |
| `Get-ChildItem .tmp -Directory -Filter '*-dsh-home'` | 0 | `runtime-dsh-home` 2 файла / 442 368 Б; `memory-beads-dsh-home` 2 / 442 368; плюс дома соседних потоков: `adapters-`, `routing-` (по 2 файла) и пустые `app-*` |

Куда именно ушло состояние (доказательство, что пин работает):

```text
.tmp\runtime-dsh-home\dsh-mywork\state\controller.sqlite
.tmp\runtime-dsh-home\dsh-mywork\state\registry.sqlite
.tmp\memory-beads-dsh-home\dsh-mywork\state\controller.sqlite
.tmp\memory-beads-dsh-home\dsh-mywork\state\registry.sqlite
```

То есть ровно те два файла, которые раньше появлялись в живом доме, теперь создаются внутри `<repo>/.tmp/<suite>-dsh-home/`.

## Невакуумность проверки

- Позитивный ассерт устроен так, что проверяет **принадлежность** `.tmp`, а не «отсутствие живого дома»: сравнение `realpathSync` обоих путей и `relative()` — при выходе за `.tmp` бросает.
- Негативные ветви проверены запуском (две строки в таблице выше): и «живой дом», и «переменная не задана» отвергаются.
- **Mutation-прогон (снять пин и убедиться, что тест краснеет) сознательно не делался:** снятие `scratchDshHome('runtime')` — это и есть воспроизведение инцидента, то есть прогон записал бы SQLite в живой дом. Вместо этого эквивалентное доказательство дано негативными ветвями хелпера: без пина `assertScratchHome()` бросает **до** открытия состояния, и вызывается он в начале каждого такого теста.

## Что не проверено / ограничения

- Четыре теста в `runtime.test.mjs` (§39-набор и три проверки сбоев) работают на scripted-стенде `FakeAgentRuntime` и не касаются ни контроллера, ни `DSH_HOME` — ассерт в них не добавлен сознательно, чтобы не создавать видимость защиты там, где состояния не открывается. Все 13 тестов, которые создают/стартуют `DshAgentRuntime` или монтируют контроллер, ассерт имеют.
- Хелпер **не** является глобальным tripwire: он проверяет только то, что переменная указывает в `.tmp`. Тест, который вообще не вызывает `scratchDshHome`, он не поймает — именно поэтому вызов стоит на уровне модуля, до импорта бандлов.
- Скретч-дома намеренно не удаляются (в задаче этого нет): каждый ~442 КБ, лежат в `.tmp` (вне git) и служат уликой после падения. Накопление со временем — кандидат на уборку в конце кампании.
- `tests/app-*.test.mjs`, `tests/routing.test.mjs`, `tests/adapters.test.mjs` вне моего scope (env-ops и board-ops); их дома видны в списке `.tmp` выше, но их корректность я не проверял.
- Проверка `Test-Path` живого дома сделана через существование каталога: если бы тест создал **файл** вне `dsh-mywork`, это не поймалось бы. Ограничение принято: инцидент был именно про каталог состояния.
