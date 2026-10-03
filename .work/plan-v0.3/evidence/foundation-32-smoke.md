# F-32 · Composition root: smoke в изолированном `DSH_HOME`

**Статус: READY_FOR_REVIEW** — это и есть **гейт этапа 2 (часть A)**: `node scripts/smoke.mjs` → EXIT=0 и `controller.sqlite` существует в изолированном доме.

## Что сделано

1. `scripts/smoke.mjs` выставляет `process.env.DSH_HOME` на свежий каталог `.tmp/smoke-home` **до** первого монтирования (и до первого `resolveMyWorkLayout()`): каталог сначала удаляется, потом создаётся, поэтому устаревшая база не может «пройти» проверку сама.
2. Добавлены два шага: «the mount opens controller.sqlite in the isolated home» (существование, ненулевой размер, `registry.sqlite`, и guard'ы изоляции) и «the state database carries the canonical schema» (после выгрузки: `openStore` через `@dsh-mywork/storage`, `schemaVersion === 6`, журнал `[1..6]`).
3. Шаг реестра адаптеров обновлён: реестр после монтирования больше **не пуст** (F-31 публикует `mywork-evidence` и `mywork-lease`), поэтому проверка теперь называет эти две строки явно, а фейковый `smoke-memory` доводит размер до 3.

## Изменённые пути

- Modify `scripts/smoke.mjs` (изолированный дом, два новых шага, шаг реестра)
- Create `.work/plan-v0.3/evidence/foundation-32-smoke.md`

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed`; `ok`-шагов **14** (было 13; гейт требует ≥14), `FAIL` — **0** |
| `Test-Path '<repo>\.tmp\smoke-home\dsh-mywork\state\controller.sqlite'` | 0 | **True** — **гейт этапа 2, часть A** |
| `Test-Path '<repo>\.tmp\smoke-home\dsh-mywork\state\registry.sqlite'` | 0 | True (шаг проверяет оба файла) |
| Шаг «the mount opens controller.sqlite…» | 0 | размер > 0; `resolve(dshHome)` начинается с `<repo>\.tmp`, не равен `~/.dsh` и не равен `%TEMP%` — живой профиль не адресуется |
| Шаг «the state database carries the canonical schema» | 0 | `schemaVersion` = 6, `migrations.map(m => m.version)` = `[1,2,3,4,5,6]`; читается **после** выгрузки, поэтому второй handle не мешает |
| Шаг «the controller publishes myworkAdapters…» | 0 | после монтирования: `['mywork-evidence','mywork-lease']`; с фейковым адаптером `size === 3`; `resolve('memory', {capabilities:['retain','recall']})` → ok |
| Шаг «diagnostics config writes one line per lifecycle transition» | 0 | ровно **2** строки в stderr — приложение не добавило третью (диагностика композиции намеренно не пишется, иначе существующий ассерт был бы ослаблен) |

## Изоляция (главный риск шага)

`apply` резолвит layout из `DSH_HOME` → `~/.dsh`, то есть **монтаж контроллера пишет в дом по умолчанию**. Smoke поэтому выставляет `DSH_HOME` внутри процесса; тесты `app-*.test.mjs` всегда передают `dshHome` явно. Важно: `tests/adapters.test.mjs` тоже монтирует контроллер и `DSH_HOME` не выставляет (файл вне моего write-scope) — при прогоне он создаст `dsh-mywork/state/*.sqlite` в живом доме. Это заявка владельцу/Lead'у, а не дефект F-32.

## Ограничения

- Smoke не удаляет `.tmp/smoke-home` в конце: каталог остаётся как артефакт прогона (и как доказательство для гейта). Уборка `.tmp` — за потоком гигиены.
- Проверка схемы идёт **вторым** соединением (через `openStore`), уже после `fiber.dispose()`; это сознательно: так проверяется и то, что приложение отпустило handle.
- Smoke по-прежнему keyless и не запускает подпроцессов.

## Что НЕ проверено

- Поведение smoke при недоступном для записи `$DSH_HOME` (ожидание: падение монтирования — `apply` дожидается `start()`).
- Полный `verify:profile` с новым composition root (вне шага; гейт F-46 гоняет Lead).
