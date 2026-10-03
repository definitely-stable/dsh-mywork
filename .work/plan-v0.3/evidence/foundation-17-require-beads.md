# F-17 · Skip реального backend → падение в CI-профиле

**Статус: READY_FOR_REVIEW** (тестовая половина; правка `.github/workflows/ci.yml` — за потоком scripts/CI, task-6)

## Что сделано

1. В `tests/beads-adapter.test.mjs` введён строгий режим: при `MYWORK_REQUIRE_BEADS === '1'` и недоступном backend файл **бросает на загрузке**, а не пишет предупреждение в `stderr`.
2. Сообщение строится из фактического результата пробы (`describeBeadsProbe`) и содержит причину, код ОС и команду установки.
3. Прогнаны три профиля: `bd` есть + strict, `bd` нет + soft, `bd` нет + strict.
4. Передано требование потоку scripts/CI (task-6) через Lead'а: в CI-профиле должно быть `MYWORK_REQUIRE_BEADS=1` в том job'е, где `bd` реально устанавливается, и отдельный job `beads-backend`, падающий при неудаче установки. Сам `.github/` я не трогал.

## Изменённые пути

- Modify `tests/beads-adapter.test.mjs` (блок `if (!HAS_BD)`, хелперы `bd()`/`realAdapter()`, заголовок файла)

## Таблица «команда → exit code → наблюдение»

| Профиль | Команда | exit | Наблюдение |
| --- | --- | --- | --- |
| `bd` есть + strict | `$env:MYWORK_REQUIRE_BEADS='1'; node --test --test-isolation=none tests/beads-adapter.test.mjs` | **0** | `ℹ tests 72 / ℹ pass 72 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0 / ℹ cancelled 0` — **гейт F-17**. План ожидал `# pass 70`; фактически **72**, потому что добавлены два теста (F-16 «skip notice» и F-22 «heartbeat actor») |
| `bd` нет + soft | тот же файл, `bd` скрыт (PATH без npm-каталогов, `APPDATA`/`LOCALAPPDATA`/`npm_config_prefix` пусты), переменная не выставлена | 0 | `ℹ tests 72 / ℹ pass 49 / ℹ fail 0 / ℹ skipped **23**` — ровно те 23 молчаливых пропуска из `FINAL-REPORT` §8.1, локальная разработка без `bd` остаётся зелёной |
| `bd` нет + strict | то же + `MYWORK_REQUIRE_BEADS='1'` | **1** | `ℹ tests 1 / ℹ pass 0 / ℹ fail 1 / ℹ skipped 0`, `Error: beads-adapter: the real-bd contract checks are SKIPPED — bd is unavailable: binary-not-found (code=BEADS_BINARY_NOT_FOUND); …; install Beads 1.3.0 with "npm install -g @beads/bd@1.3.0" and check \`bd version\`. These are not passes.` |
| сообщение о пропуске (soft, `bd` нет) | — | — | `bd is unavailable: binary-not-found (code=BEADS_BINARY_NOT_FOUND); …install Beads 1.3.0 with "npm install -g @beads/bd@1.3.0"…` — причина названа, команда исправления приложена |

Как скрывался `bd` (симуляция отсутствия): `PATH` = только каталог Node + `System32`/`Windows`, `APPDATA`/`LOCALAPPDATA`/`npm_config_prefix` — пустые строки. Это отключает все три источника `findBeadsEntry`, поэтому проба честно отвечает `binary-not-found`, а не «`bd` сломан».

## Контракт для CI (требование потоку scripts/CI)

- В job'е, где `bd` **обязан** быть: `MYWORK_REQUIRE_BEADS: '1'` → пропуск становится падением.
- Установка backend'а — отдельный job `beads-backend`, который падает при неудаче установки: «не удалось поставить backend» и «backend сломан» должны быть различимы (риск из плана).
- Установка: `npm install -g @beads/bd@1.3.0` (фактический пакет на этой машине: `@beads/bd@1.3.0`, bin `bin/bd.js`).

## Ограничения

- Строгий режим проверяет **факт доступности** backend'а, а не его здоровье: `bd version` с exit 0 достаточно. Дальнейшие отказы (нет workspace, сломан Dolt) видны как падения конкретных тестов.
- «23 пропуска» — число на этой ревизии файла; после F-21/F-22 часть тестов добавлена/изменена, но набор реальных тестов остался тем же (23).

## Что НЕ проверено

- Поведение в реальном CI-раннере (Linux): на этой машине проверены только win32-профили, а `MYWORK_REQUIRE_BEADS` в `.github/` ещё не прописан — это задача task-6.
- Симуляция отсутствия `bd` через пустые переменные окружения (реальная машина без `bd` не проверялась).
