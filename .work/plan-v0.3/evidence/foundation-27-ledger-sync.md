# F-27 · Сверка `done`-множеств трёх леджеров + гейт этапа 1

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node scripts/ledger-sync.mjs` → **EXIT 0**, отчёт с `doneViolations: 7` и объяснённым числом. Расхождение «доска vs `tasks.json` vs `INDEX.md`» теперь обнаруживается командой.

## Изменённые пути

- Create `scripts/ledger-sync.mjs` — `compareLedgers()` (чистая, не бросает), `parseIndex`, `parseJustifications`, `humanId`, `formatReport`, CLI с `--board`, `--tasks`, `--index`, `--justifications`, `--json`, `--strict`.
- Create `tests/ledger-sync.test.mjs` — 2 теста на фикстуре.

## Источник доски: почему не `board-export.json`

План перечисляет три леджера и называет доску authority. Файл `.work/tasks/board-export.json` **для этого не годится**: это снимок от 16.09, `revision 82`, 41 карточка, **все в `backlog`, ноль исполнений** — он старше всех прогонов и не содержит ни одного `done`. Поэтому доска читается из живого Host-леджера:

```
C:\Users\Dmitry\.dsh\task-board\ledger-v2.json   (revision 325, 55 задач)
```

Путь выводится из `USERPROFILE`/`HOME` и переопределяется флагом `--board`. HTTP-вариант (`GET /api/task-board/state`) отвергнут: `web_fetch` не пускает на `127.0.0.1` (non-public IP), а прямой файл — тот же Host-леджер без сетевой зависимости.

**Ключ соединения.** На доске `id` — UUID, а `MW-0NN` живёт только в префиксе заголовка. В `tasks.json` и `INDEX.md` — наоборот, `MW-0NN`. Поэтому соединение идёт по токену `MW-\d{3}`, извлечённому из заголовка доски.

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/ledger-sync.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0` — гейт плана `pass 2 / fail 0` |
| `node scripts/ledger-sync.mjs` | **0** | `board revision: 325`; `cards compared: 55`; `executions: 31 total = 20 succeeded + 11 failed`; **`doneViolations: 7`**; `failed executions on done cards: 7; outside done cards: 4` |
| `node scripts/ledger-sync.mjs --justifications …\foundation-09-done-failed.md` | 0 | `doneViolations: 0`; `justified (D19 line present): 7 — MW-003, MW-004, MW-005, MW-006, MW-007, MW-008, MW-043` |
| `node scripts/ledger-index.mjs --check` | **0** | `--check OK (55 cards)` — INDEX.md согласован с `tasks.json` |
| `git tag --list 'v0.1.0-m1'` | 0 | пусто — тег ставит Lead (границы задачи) |

### `doneViolations = 7` — ценз D19

| Карточка | Падений | `sessionId` падения |
|---|---|---|
| MW-003, MW-004, MW-005, MW-006, MW-007, MW-008, MW-043 | по 1 | **отсутствует** — отказ до создания сессии, поэтому отчёт печатает `(no session — failed before launch)` |

Совпадает с цензом F-09 (`foundation-09-done-failed.md`): 7 карточек, по одному падению, ни у одного падения нет сессии.

### Цифра 9 из `FINAL-REPORT` §8.2 P9 опровергнута арифметикой

Отчёт печатает это сам, чтобы цифру нельзя было переписать задним числом:

```
note: FINAL-REPORT §8.2 P9 states "9 failed executions on done cards".
      The board says 7. 9 matches neither that nor the whole-ledger
      tally of 11, so the report's figure is refuted, not differently counted.
```

Разложение, посчитанное скриптом, а не вручную: всего **11** падений = **7** на `done`-карточках + **4** вне `done` (MW-001 ×1, MW-002 ×2, MW-016 ×1). Число 9 не равно ни 7, ни 11 и не соответствует никакому естественному подмножеству. При этом §8.1 («20 succeeded / 11 failed») **воспроизведён точно** — значит, источник ошибки именно в P9, а не в исходных числах.

### 55 расхождений статуса — это не 55 дефектов

Отчёт печатает `status mismatches: 55` — то есть расходятся все карточки. Это не 55 дефектов, а следствие разных словарей: доска ведёт **исполнение** (`backlog`/`done`/`failed`), а `tasks.json` — **планирование** (`planned`/`superseded`); эти слова не могут совпасть ни на одной карточке. Скрипт объясняет это отдельной строкой и предлагает читать `doneViolations` как меру согласия по закрытию. Именно этот факт стоит за формулировкой `FINAL-REPORT` §8.1 «статусы согласованы только по количеству» — теперь он измерен.

## Ограничения

- `compareLedgers` сравнивает статусы **буквально**. Семантическое отображение (`planned`+`done` на доске ⇒ закрыто) сознательно не введено: план требует отчёт о расхождении, а не сглаживание. Мера согласия по закрытию — `doneViolations`.
- Justification-строки не хранятся ни в одном леджере. Они берутся из внешнего файла (`--justifications`, по умолчанию — evidence F-09), и без флага отчёт даёт «сырой» ценз 7 — именно его требует гейт плана.
- `--strict` (exit 1 при расхождении или нарушении) существует, но **не** подключён к CI: пока словари леджеров разные, строгий режим был бы красен всегда.
- Скрипт читает Host-леджер напрямую и не берёт блокировку (`ledger-v2.lock` игнорируется): чтение во время чужой записи может дать снимок «между» изменениями. Для отчёта это допустимо, для гейта — нет.

## Что НЕ проверено

- Не проверялось поведение при отсутствующем Host-леджере: CLI печатает сообщение и выходит с кодом **2** — этот путь не прогонялся.
- Не проверялся `--json` на реальных данных (только наличие ветки).
- Не проверялось, что `parseIndex` устойчив к ручной правке таблиц внутри маркеров (например, к снятой ссылке `[MW-001](MW-001.md)`): регулярка требует ровно такую форму ячейки ID.
- Гейт этапа 1 целиком **не закрыт этим шагом**: команда `MYWORK_REQUIRE_BEADS=1 … tests/beads-adapter.test.mjs` даёт `fail 1` (реальный отказ `bd heartbeat`) — см. `foundation-25-ci.md`. Тег `v0.1.0-m1` ставит Lead.

## Поправка Lead'а (после закрытия потока beads)

Пункт про `fail 1` — **снимок промежуточного состояния** (поток beads ещё правил `heartbeat`). На замороженном дереве (`07e6850`, тег `v0.1.0-m1`): `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` → **tests 72 / pass 72 / fail 0 / skipped 0**, exit 0. Тег `v0.1.0-m1` создан Lead'ом на `07e6850`; гейт этапа 1 сведён в `foundation-stage1-gate.md`.

Независимый ревьюер этапа 1 пересчитал разложение по леджеру сам и подтвердил: `31 = 20 succeeded + 11 failed`, `7` на `done`, `4` вне; цифра «9» на текущем леджере не воспроизводится (историческую девятку проверить нечем — `board-export.json` это снимок rev 82 с нулём исполнений).
