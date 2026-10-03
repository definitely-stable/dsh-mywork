# F-41 · Boundary-тест: расширить `FORBIDDEN` до `@deepseek-ai/dsh*`

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node --test --test-isolation=none tests/boundaries.test.mjs` → **EXIT 0**, `# fail 0`. Запрет перестал быть списком из одного имени, и при этом остался **достижимым**: allowlist для `@deepseek-ai/cordis` введён и проверен в обе стороны (R-08).

## Изменённые пути

- Modify `tests/boundaries.test.mjs` — три запрещающих списка, новый хелпер `forbiddenIn`, константа `ALLOWED_PLATFORM`, шесть мест вызова, два новых теста.

## Что именно изменено

| Место | Было | Стало |
|---|---|---|
| `FORBIDDEN` (домен) | `'@deepseek-ai/cordis'` | `'@deepseek-ai/'` |
| `FORBIDDEN_FOR_STORAGE` (storage/evidence/lease/execution) | `'@deepseek-ai/cordis'` | `'@deepseek-ai/'` |
| `FORBIDDEN_IN_BOARD` (board/theme) | `'@deepseek-ai/cordis'` | `'@deepseek-ai/'` |
| проверка на месте вызова (×6) | `LIST.find(f => lowered.includes(f))` | `forbiddenIn(specifier, LIST)` |

Новый хелпер:

```js
const ALLOWED_PLATFORM = ['@deepseek-ai/cordis']

function forbiddenIn(specifier, forbidden, allowed = []) {
  const lowered = specifier.toLowerCase()
  if (allowed.some(entry => lowered === entry || lowered.startsWith(`${entry}/`))) return undefined
  return forbidden.find(name => lowered.includes(name))
}
```

Allowlist сопоставляется по **целому** спецификатору (и его подпутям), а не по подстроке. Домен, storage, evidence, lease, execution и board вызывают `forbiddenIn` **без** allowlist — им `cordis` не разрешён. Allowlist передаётся только там, где импорт легитимен (см. F-42, `FORBIDDEN_FOR_INFRA`).

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/boundaries.test.mjs` (**ДО правки**) | **0** | `ℹ tests 26 / ℹ pass 26 / ℹ fail 0 / ℹ skipped 0` — базовое число зафиксировано |
| то же (**после расширения трёх списков**) | **0** | `ℹ tests 26 / ℹ pass 26 / ℹ fail 0` — префиксный запрет не задел ни один существующий источник |
| то же (**после добавления двух тестов F-41**) | **0** | `ℹ tests 28 / pass 28 / fail 0` |
| то же (**после F-42**) | **0** | `ℹ tests 31 / ℹ pass 31 / ℹ fail 0 / ℹ skipped 0` |

### Явный тест на allowlist (шаг 4 плана — обязателен)

| Тест | Что доказывает |
|---|---|
| `the widened ban catches the platform family the single-name list missed` | фикстура `import type { Context } from '@deepseek-ai/dsh-sandbox-policy'`: **старый** список из семи имён её не ловит (`undefined`), новый ловит (`'@deepseek-ai/'`) |
| `the cordis allowlist is the only thing that lets a platform import through` | фикстура `import { Service, type Context } from '@deepseek-ai/cordis'`: без allowlist → `'@deepseek-ai/'`; с allowlist → `undefined`; подпуть `@deepseek-ai/cordis/plugin` → `undefined`; соседний пакет `@deepseek-ai/dsh-home-paths` → **по-прежнему** `'@deepseek-ai/'` |

Четвёртая строка важна: без неё allowlist неотличим от «гейт ничего не ловит».

### Шаг 0 плана (проверка неконфликтности двух механизмов) — выполнен

`:186-199` (собранные бандлы) и `specifiersOf` — **разные** механизмы, и они не конфликтуют: тест собранного бандла сравнивает список спецификаторов `packages/controller/lib/index.js` через `assert.deepEqual` с ожиданием `['@deepseek-ai/cordis']` и **не использует** запрещающие списки. Allowlist введён только для запрещающих списков, поэтому поведение `:186-199` не изменилось. Это подтверждено прогоном: тест `the built packages carry exactly the imports they are allowed to` зелёный до и после.

## Ограничения

- Запрет остался **подстрочным и регистронезависимым** (`lowered.includes(name)`), как и был. Это значит, что проза в **обычной** строке (не в комментарии и не в шаблоне — их снимает `scrub`) может дать ложное срабатывание на слово `beads`. Поведение унаследовано, не менялось.
- Allowlist не покрывает случай, когда пакет легитимно импортирует **другой** `@deepseek-ai/dsh-*`: такого пакета сегодня нет, и добавление потребует явной правки `ALLOWED_PLATFORM` — это задумано.
- `FORBIDDEN` для домена и `FORBIDDEN_FOR_STORAGE` **не** получили allowlist: `contracts`/`core`/`storage`/`evidence`/`lease`/`execution` не импортируют `cordis` ни в одном файле (проверено сканом спецификаторов).

## Что НЕ проверено

- Не проверялось, что запрет ловит **реальный файл** с нарушением: это потребовало бы записи в пакет, которым владеет другой поток. Ловимость доказана на фикстурах через **те же две функции**, которые использует скан (`specifiersOf` → `forbiddenIn`), а «скан читает настоящие файлы» доказывают guard'ы «не пусто» из F-42 (каждый проверяет спецификатор, который может прийти только из файла).
- Не проверялось поведение на `.tsx`/`.js` источниках: скан собирает только `['.ts']`.
- Не проверялось, как запрет поведёт себя на спецификаторе вида `@deepseek-ai/` без продолжения (такой импорт невалиден, но `includes` его поймает).
