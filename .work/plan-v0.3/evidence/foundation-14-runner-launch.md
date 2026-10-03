# F-14 · `bd`-seam: применить резолвер в `createProcessRunner`

**Статус: READY_FOR_REVIEW**

## Что сделано

1. `ProcessRunnerOptions` получил `launch?: BeadsLaunch`; `binary` сохранён как высший приоритет.
2. `createProcessRunner` больше не подставляет `'bd'` по умолчанию: при отсутствии `binary`/`launch` он вызывает `resolveBeadsLaunch()` и спавнит `[...launch.args, ...command.args]` с `shell: launch.shell` (тип гарантирует `false`).
3. Резолв **ленивый и мемоизированный**: конструктор не бросает (профиль на машине без `bd` не падает на композиции), отказ приходит отклонённым `run`.
4. Создан `tests/beads-runner-launch.test.mjs` — 2 теста (гейт F-14).
5. Побочно (нужно для F-17): тест-хелпер `bd()` и `realAdapter()` в `tests/beads-adapter.test.mjs` переведены на тот же seam.

## Изменённые пути

- Modify `packages/beads-adapter/src/runner.ts` (опции, `launchOf()`, `spawn`)
- Create `tests/beads-runner-launch.test.mjs`
- Modify `tests/beads-adapter.test.mjs` (хелпер `bd()`, `realAdapter()` — см. F-15/F-17)

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/beads-runner-launch.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0 / ℹ skipped 0` — **гейт F-14** |
| Тест 1 (инъекция `launch`) | 0 | Аргумент `a b "c" & d > e` дошёл до ребёнка **одним элементом `argv`**: `deepEqual(argv, ['--title', 'a b "c" & d > e', '--json'])`. Это и есть доказательство «no shell» — шелл переразбил бы строку |
| Тест 2 (`createProcessRunner()` без опций) | 0 | Реальный `bd version` → `code 0`, `stdout` = `bd version 1.3.0 …`; на win32 дополнительно проверено, что `resolveBeadsLaunch().command === process.execPath` и entry оканчивается на `.js` |
| `tsc --noEmit -p packages/beads-adapter/tsconfig.json` | 0 | Ошибок типов нет |
| `tsdown` (точечная сборка пакета) | 0 | `Build complete`, `lib/index.js` реэкспортирует новый seam |

## Инвариант «no shell» (как он закреплён)

- Тип `BeadsLaunch.shell` — литерал `false`, поэтому инъекция `shell: true` не компилируется.
- В `spawn` передаётся `launch.shell` (всегда `false`), а не константа, — то есть инвариант виден в единственном месте, где создаётся процесс.
- Тест 1 проверяет инвариант **поведенчески**: аргумент с пробелами, кавычками и метасимволами `cmd.exe` доходит целиком.

## Ограничения

- Резолв ленивый: первый `run` на win32 без `bd` отклоняется `BeadsLaunchRefusal`. В адаптере он превращается в `ADAPTER_UNAVAILABLE` (см. F-15) — сам runner §42-коды не знает.
- `binary` остаётся высшим приоритетом: тест `realAdapter` больше его не задаёт, но совместимость сохранена.

## Что НЕ проверено

- Одновременные `run` из нескольких потоков (мемоизация без блокировки — гонка даст два одинаковых резолва, оба корректны).
- Поведение при `binary`, указывающем на несуществующий файл (ошибка `ENOENT` уйдёт наружу как раньше).
