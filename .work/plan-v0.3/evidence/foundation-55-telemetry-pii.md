# foundation-55 — состав событий и политика PII (F-55, D16/D17)

База: `e28ff0b` (F-54). Шаг F-55 — правка `packages/controller/src/telemetry.ts` и
`tests/telemetry.test.mjs`. Живой профиль `C:\Users\Dmitry\.dsh` не читался и не писался.

## Что сделано

Канал утечки закрыт **белым списком**, а не чёрным. Платформенный пакет не редактирует строки
вызывающего (`product-telemetry-otel/README.md:104`, переанкорено 2026-10-03: было `:103` — «Caller-selected strings are **not redacted
automatically**»), поэтому решение о том, что выносится наружу, целиком наше, и оно выражено как
данные в одном месте:

- `packages/controller/src/telemetry.ts:168` — `PRODUCT_ATTRIBUTE_SHAPES` (9 ключей **и форма
  значения** каждого);
- `packages/controller/src/telemetry.ts:186` — `PRODUCT_ATTRIBUTE_ALLOWLIST` выводится из ключей
  этой таблицы, поэтому ключ без объявленной формы невозможен;
- `packages/controller/src/telemetry.ts:194` — `PRODUCT_EVENT_INPUT_FIELDS` (11 полей события);
- `packages/controller/src/telemetry.ts:464` — `assertAttributeShapes` проверяет значение **каждого**
  атрибута по его форме, включая выведенные из входа (`:481` — `fitsAttributeShape`);
- `packages/controller/src/telemetry.ts:440` — `assertAttributes` отвергает ключ вне списка;
- `packages/controller/src/telemetry.ts:418` — `assertProductEventInput` отвергает поле вне
  закрытого набора, пустой `correlationId` и нечисловой `at`;
- `packages/controller/src/telemetry.ts:384` — сборка атрибутов; попытка переопределить
  производный ключ отвергается.

Формы значений (`ProductAttributeShape`, `telemetry.ts:145`): `identifier` — непустая строка;
`duration-ms` — конечное число ≥ 0; `count` — конечное целое ≥ 0; `outcome` — член закрытого набора;
`operation-domain` — член `OPERATION_DOMAINS` из contracts (`packages/contracts/src/security.ts:45`).

Проверка выполняется **до** разрешения канала (`toProductEvent` вызывается раньше
`probeProductTelemetry`), поэтому негодное событие отвергается и в профиле без коллектора, и
канал при этом даже не опрашивается — это отдельная ассерция теста.

## Таблица «атрибут → разрешён/запрещён → почему»

| Атрибут | Решение | Почему |
|---|---|---|
| `mywork.correlation_id` | разрешён | Ради этого сделан F-54: связь продуктового события со своим audit/outbox. Идентификатор, валидирован `requireIdentifier` (`packages/core/src/guards.ts:46`). |
| `mywork.workspace_id` | разрешён | Идентификатор области; нужен для разреза «где», содержимого не несёт. |
| `mywork.task_id` | разрешён | Идентификатор задачи (§F-55 шаг 1: идентификаторы). |
| `mywork.attempt_id` | разрешён | Идентификатор попытки; без него исход не привязать к попытке. |
| `mywork.operation_id` | разрешён | Идентификатор операции (§44). |
| `mywork.operation_domain` | разрешён, форма `operation-domain` | «Тип операции» из шага 1 — закрытое перечисление §31 (`OPERATION_DOMAINS`, `packages/contracts/src/security.ts:45`); строка вне набора отвергается. |
| `mywork.outcome` | разрешён, форма `outcome` | Исход `succeeded`/`failed`/`refused`; закрытый union, нужен для агрегации. |
| `mywork.duration_ms` | разрешён, форма `duration-ms` | Конечное число ≥ 0 (миллисекунды); `NaN`, `Infinity`, отрицательное и строка отвергаются. |
| `mywork.attempt_count` | разрешён, форма `count` | Конечное целое ≥ 0; строка, дробное и отрицательное отвергаются. |
| `body` | **запрещён** | Обязательное свободное текстовое поле платформенной записи и главный канал утечки. В `ProductEventInput` поля `body` нет и в `PRODUCT_EVENT_INPUT_FIELDS` его нет; значение берётся только из `PRODUCT_EVENT_BODIES` (`telemetry.ts:124-126`) — фиксированная строка на имя события, без подстановки. Передача `body` на верхнем уровне отвергается как неизвестное поле. |
| `prompt` | **запрещён** | Не в белом списке и не поле события. Промпт — прямо запрещённый платформенным инвариантом класс (`product-telemetry-otel/src/index.ts:26`: «never a prompt, response, credential, or file contents»). |
| `content` | **запрещён** | То же: содержимое файла/ответа. |
| `bytes` | **запрещён** | Содержимое артефакта в байтах (RT-5: сканер секретов тела не покрывает). |
| `payload` | **запрещён** | Произвольная полезная нагрузка — форма, в которую утечка помещается целиком. |
| `stderr` | **запрещён** | Вывод процесса: может содержать пути, секреты, содержимое файлов. |
| `stdout` | **запрещён** | То же. |
| любой другой ключ (проверено на `diff`) | **запрещён** | Ключа нет в белом списке ⇒ отказ. Это и есть отличие белого списка от чёрного: ключ, о котором никто не подумал, отвергается по умолчанию. |
| значение, не подходящее форме своего ключа (например строка под `mywork.attempt_count`) | **запрещён** | `assertAttributeShapes` (`telemetry.ts:464-479`) проверяет **значение** по форме ключа; до ревизии B (finding B6) строка `'3 OR 1=1 -- secret notes'` под числовым ключом **уезжала** (`emitted:true`). Проверка идёт по собранной карте атрибутов, поэтому покрывает и значения, выведенные из входа (`NaN`, отрицательная длительность), а не только присланные вызывающим. |
| вложенный объект под разрешённым ключом | **запрещён** | Ни одна форма не допускает объект (`identifier`/`operation-domain`/`outcome` — строка, `duration-ms`/`count` — число), поэтому содержимое нельзя протащить через разрешённое имя. Прежняя формулировка «скалярность проверяется отдельно» была сильнее кода: скалярную ветку для строки под производным ключом перекрывал отказ «is derived from the event» (ревизия B, «невоспроизводимые утверждения» 1), и отдельная скалярная проверка снята как подмножество формы. |
| переопределение производного ключа (например `mywork.outcome`) | **запрещён** | `telemetry.ts:384-397`: иначе событие могло бы заявить исход, которого нет в его имени. |

## Команды и наблюдения

| Команда | exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/telemetry.test.mjs` (только новый кейс, до реализации) | 1 | **красный**: `Missing expected exception (TypeError): attribute "prompt" must be refused`, `tests 4 / pass 3 / fail 1` |
| `corepack pnpm --filter @dsh-mywork/controller run typecheck` | 1 | Единственная ошибка — `../core/src/budget-defaults.ts(144,107): error TS2339` (файл task-2, не мой); по `telemetry.ts` ошибок нет |
| `corepack pnpm --filter @dsh-mywork/controller run build` (под `.tmp/build.lock`, лок ждал 29 попыток по 8 с — его держал параллельный билд) | 0 | `✔ Build complete in 51781ms`, `lib/index.js 462.23 kB` |
| `node --test --test-isolation=none tests/telemetry.test.mjs` (после реализации) | 0 | `tests 4 / pass 4 / fail 0 / cancelled 0`, `duration_ms 90.5` |
| Мутация M1: в собранном `lib/index.js` `body` перестал быть фиксированным | 1 | `pass 2 / fail 2`, упал кейс 1 (`an attempt outcome becomes one event of a closed set with a fixed body`) |
| Мутация M2: в собранном `lib/index.js` условие белого списка заменено на `if (false)` | 1 | тот же прогон: упал кейс 4 (`Missing expected exception (TypeError): attribute "prompt" must be refused`) |
| Восстановление бандла из копии, SHA256 до/после | 0 | `PRISTINE_SHA256 = RESTORED_SHA256 = 8BE915AB28E489ED5A6A574086A921A24F3B63356A17D0ED94A9350F653684D1`; повторный прогон `pass 4 / fail 0` |

Вывод после реализации:

```
✔ an attempt outcome becomes one event of a closed set with a fixed body (1.6813ms)
✔ emit reports telemetry disabled when the profile mounts no service (0.2528ms)
✔ emit delivers exactly one record when the service is present (0.2513ms)
✔ the attribute allowlist refuses a forbidden or unknown key at every level (0.6055ms)
ℹ tests 4 / ℹ pass 4 / ℹ fail 0
```

## Почему проверка не ломается о чужой билд

`tests/telemetry.test.mjs` больше не берёт `repoRoot` из `tests/lib/fixtures.mjs`: тот отказывается
загружаться, пока отсутствует `lib/` **любого** пакета, а дерево собирается несколькими
воркстримами сразу — параллельный билд task-2 уронил прогон сообщением
`missing build output: packages/evidence/lib/index.js, packages/lease/lib/index.js,
packages/beads-adapter/lib/index.js, packages/scheduler/lib/index.js`, к телеметрии отношения не
имеющим. Теперь корень репозитория выводится из расположения самого теста, и сюита зависит ровно от
одного бандла — контроллера.

## Цитата RT-5 (из `FINAL-REPORT`, приведена в `20-STEPS-foundation.md:1509`)

> «подтверждён частично (heartbeat 0.4.3 жив, выключателя нет; сканер секретов не покрывает тела)»

## Границы

- **Не сделано:** OTel-экспортёр (D16); редакция/маскирование значений — здесь только граница
  «что выносится наружу», механику удаления тел владеет `plan-quality` (F-38…F-40,
  `23-STEPS-quality.md`); профиль не менялся; выключатель экспорта не добавлялся (F-55 его не
  требует — выключение = не монтировать плагин, см. `foundation-17-telemetry.md:31`).
- Согласование с `23-STEPS-quality.md` (шаг 5 F-55) выполнено **только чтением** границы
  ответственности: F-38…F-40 владеют сканером тел, здесь — политика выноса наружу. Файлы
  `23-STEPS-quality.md` не правились.
- **Не проверено:** поведение на реальном коллекторе — `productTelemetry` в живом профиле не
  смонтирован (`foundation-17-telemetry.md:29`); проверка идёт на фейковом контексте.
- **Зависимости от D-решений.** D16 (`01-MASTER-PLAN.md` §7.1, строка D16): «Свой `audit`/`outbox` —
  истина; `ctx.productTelemetry.emit` — **единственный наружный канал**; OTel не строим; **PII — только
  явные поля**» — «только явные поля» и есть белый список этого шага. D17 («Окна хранения по таблицам +
  `VACUUM` + сканер тел; секрет → refuse, не redact») владеет **хранением и сканированием тел**
  артефактов и памяти, то есть другим концом трубы: здесь решается, что **выносится наружу**, там — что
  и сколько **лежит внутри**. Требования D17 в этом шаге не реализуются и не проверяются — это записано
  как граница, а не как выполненное.

## Ревизия B, finding B6 (MINOR): форма значений и fail-open канала

Проверка: `.work/plan-v0.3/evidence/verify-stage3-review-b.md`; находка B6 воспроизведена ревизором
командой `node -e '… attributes:{"mywork.attempt_count":"3 OR 1=1 -- secret notes"}'` →
`{"emitted":true,…}`: строка уезжала под ключом, который по типу обязан быть числом. Вторая половина
той же находки: бросающий `ctx.get('productTelemetry')` **пробрасывал** исключение, то есть
нарушалось задокументированное «an absent channel must not crash an attempt».

**Исправлено:**

1. `PRODUCT_ATTRIBUTE_SHAPES` (`telemetry.ts:168`) — у каждого ключа объявлена форма значения;
   `PRODUCT_ATTRIBUTE_ALLOWLIST` выводится из ключей таблицы, поэтому ключ без формы невозможен.
2. `assertAttributeShapes` (`telemetry.ts:464`) проверяет значения **собранной** карты атрибутов —
   то есть и выведенные из входа (`durationMs: NaN`, `attemptCount: -1`), и присланные вызывающим.
   Отдельная проверка «значение — скаляр» снята как подмножество формы.
3. `probeProductTelemetry` (`telemetry.ts:366-382`) ловит бросок `ctx.get`, а `emitProductEvent`
   (`telemetry.ts:348`) — бросок `emit`. Результат различает три причины: `telemetry-disabled`
   (сервиса нет), `telemetry-unavailable` (поиск бросил), `telemetry-failed` (канал отказал записи).
   Негодное событие по-прежнему **отвергается** при любой из трёх: запись строится до разрешения канала.

**Команды и наблюдения (delta):**

| Команда | exit | Наблюдение |
|---|---|---|
| `corepack pnpm --filter @dsh-mywork/controller run typecheck` | 0 | ошибок нет |
| `corepack pnpm --filter @dsh-mywork/controller run build` (под `.tmp/build.lock`) | 0 | `✔ Build complete in 66549ms` |
| `node --test --test-isolation=none tests/telemetry.test.mjs` | 0 | `tests 6 / pass 6 / fail 0` (было 4; добавлены кейс форм и кейс недоступного канала) |
| Приёмочная команда (task-10) | 0 | `tests 12 / pass 12 / fail 0` |
| Мутация M2 в собранном `packages/controller/lib/index.js`: условие `if (!fitsAttributeShape(shape, value))` → `if (false)` | 1 | `pass 3 / fail 3`: падают кейсы 4, 5 и 6 — форма не проверяется, вложенный объект и `NaN` доезжают |
| Мутация M3 там же: `try { candidate = ctx.get(…) } catch { … }` → прямой вызов без перехвата | 1 | `pass 5 / fail 1`; падает ровно кейс 6 `telemetry never fails an attempt: an unusable channel is reported, not thrown` |
| Восстановление бандла, SHA256 до/после | 0 | `CTRL_RESTORED=True` (`D7042F2B22DAF4EA978536F0377830315AE52B8DDEFDE146A01A7456723A768C`); повторный прогон `pass 12 / fail 0` |

**Что по-прежнему не проверено:** поведение на реальном коллекторе (сервис в живом профиле не
смонтирован) и `emit` живого платформенного сервиса — обе ветки fail-open проверены на фейковых
контекстах. Проверка значения по форме ограничена объявленными формами: она не утверждает, что
непустая строка-идентификатор «безопасна», — она утверждает, что под числовым ключом строки не будет.
