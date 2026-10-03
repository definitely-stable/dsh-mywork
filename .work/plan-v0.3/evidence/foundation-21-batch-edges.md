# F-21 · MW-057а: тест `batch`-рёбер читает `id` / `dependency_type`

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Шаг 1 плана: найдено место чтения несуществующего поля — `tests/beads-adapter.test.mjs`, тест `bd batch commits dep add and dep remove in one transaction (real bd)`: `listed.map(edge => edge.depends_on_id)`.
2. Чтение заменено на `edge.id` (и комментарий объясняет, почему `depends_on_id` не находится); ассерты о составе рёбер **не ослаблены**: добавленное ребро обязано присутствовать, удалённое — отсутствовать.
3. Сырой вывод `bd` снят и приложен ниже.
4. Капability `batch-dep-remove` не менялась (она подтверждена живым `bd`).

## Изменённые пути

- Modify `tests/beads-adapter.test.mjs` (тест batch-рёбер; F-21 — правка **чтения полей**, не адаптера)

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `Select-String tests\beads-adapter.test.mjs -Pattern 'depends_on_id\|dependency_type'` | 0 | `depends_on_id` был ровно в одном месте (чтение в batch-тесте), `dependency_type` — в скриптованном тесте `dependencies are read from the target-issue row bd dep list returns` |
| `bd dep add mw-a6e mw-kix` | 0 | `✓ Added dependency: mw-a6e (edge a) depends on mw-kix (edge b) (blocks)` |
| `bd dep list mw-a6e --json` | 0 | Строка — **target issue**: поля `id` (= `mw-kix`), `title`, `status`, `priority`, `issue_type`, `owner`, `created_at`, `created_by`, `updated_at`, **`dependency_type: "blocks"`**. Поля `depends_on_id` в ответе **нет** — чтение его даёт пустой граф |
| `"dep add a c`ndep remove a b" \| bd batch` | **0** | `batch: 2 operations committed` + `line 1: dep.add mw-a6e->mw-7ac` / `line 2: dep.remove mw-a6e->mw-kix` — capability `batch-dep-remove` **подтверждена** |
| `bd dep list mw-a6e --json` после batch | 0 | Осталось одно ребро: `id: mw-7ac`, `dependency_type: "blocks"`; `mw-kix` исчез — удаление в той же транзакции сработало |
| `node --test --test-isolation=none --test-name-pattern='batch' tests/beads-adapter.test.mjs` | 0 | Все batch-тесты проходят, включая исправленный «commits dep add and dep remove in one transaction (real bd)» |
| `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` | **0** | `pass 72 / fail 0 / skipped 0` — **гейт F-21** в составе F-17 |

## Почему это не «правка теста под результат»

Изменено только **чтение поля** ответа `bd`. Ни один ассерт о составе рёбер не ослаблен: по-прежнему требуется наличие добавленного ребра и отсутствие удалённого, а сырой JSON `bd dep list` приложен выше. Альтернатива (объявить `batch-dep-remove: false`) отвергнута: `bd batch` реально закоммитил 2 операции с exit 0.

## Ограничения

- `bd 1.3.0` на этой машине — единственная проверенная версия; форма ответа `dep list --json` (`id`/`dependency_type`) зафиксирована сырым выводом.

## Что НЕ проверено

- Поведение `bd dep list --json` на других версиях Beads (схема версионируется полем `schema_version` у других команд; у `dep list` его нет).
- Рёбра типов, отличных от `blocks` (в скриптованном тесте есть `relates-to`, но не против живого `bd`).
