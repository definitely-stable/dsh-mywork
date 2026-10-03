# foundation-54 — экспорт `correlationId` через `ctx.productTelemetry` (F-54, D16)

База: `d0c97bfa8adb8e22ed4493d853f0dd4895fe18c9` (`git rev-parse HEAD` → exit 0).
Ветка: рабочее дерево, общий с task-2 (budget); конфликтов по моим файлам не было.

## Что сделано

`correlationId` перестал быть только внутренним полем: попытка, дошедшая до исхода,
отдаёт наружу **продуктовое событие** через платформенный сервис `productTelemetry`.
OTel-экспортёр **не строится** — D16 это прямо запрещает:

> «Свой audit/outbox с `correlationId` — истина; `productTelemetry` — наружу; **OTel-экспортёр не строим**»
> (`.work/plan-v0.3/20-STEPS-foundation.md:1473`)

## Изменённые файлы

| Файл | Что |
|---|---|
| `packages/controller/src/telemetry.ts` | создан: `toProductEvent`, `emitProductEvent`, `resolveProductTelemetry`, закрытый набор имён и фиксированные `body` |
| `packages/controller/src/index.ts` | добавлен один блок `export { … } from './telemetry.ts'` (общий barrel, append-only) |
| `tests/telemetry.test.mjs` | создан: 3 кейса F-54 |

## Команды и наблюдения

| Команда | exit | Наблюдение |
|---|---|---|
| `Select-String -Path packages\**\src\*.ts -Pattern 'productTelemetry'` (до правки) | 0 | **0 совпадений** — экспорта не было |
| `Get-ChildItem packages -Recurse -Filter *.ts \| ? FullName -match '\\src\\' \| Select-String 'productTelemetry'` (до правки) | 0 | **0 совпадений** (второй, независимый от `**` способ — совпал) |
| `corepack pnpm --filter @dsh-mywork/controller run build` (под `.tmp/build.lock`) | 0 | `✔ Build complete in 57356ms`, `lib/index.js 450.33 kB` |
| `node --test --test-isolation=none tests/telemetry.test.mjs` | 0 | `# tests 3`, `# pass 3`, `# fail 0`, `# cancelled 0`, `duration_ms 154.66` |
| `Select-String -Path packages\**\src\*.ts -Pattern 'productTelemetry'` (после правки) | 0 | **22 совпадения**: `packages/controller/src/telemetry.ts` ×18, `packages/controller/src/index.ts` ×4 → гейт «≥1 (было 0)» выполнен |
| тот же поиск рекурсивным `Get-ChildItem` (после правки) | 0 | **22 совпадения** — те же файлы |

Вывод теста построчно:

```
✔ an attempt outcome becomes one event of a closed set with a fixed body (2.5998ms)
✔ emit reports telemetry disabled when the profile mounts no service (0.3555ms)
✔ emit delivers exactly one record when the service is present (0.3697ms)
ℹ tests 3 / ℹ pass 3 / ℹ fail 0
```

## Источник `correlationId` (`файл:строка`)

| `файл:строка` | Что там |
|---|---|
| `packages/core/src/guards.ts:28` | `readonly correlationId: string` — поле `OperationMetaInput` |
| `packages/core/src/guards.ts:46` | `requireIdentifier(input.correlationId, 'correlationId')` — значение валидировано и непусто |
| `packages/core/src/guards.ts:51` | `correlationId: input.correlationId` — попадает в `OperationMeta` |
| `packages/controller/src/dsh-session.ts:282` | `export const DSH_REQUEST_ID_PREFIX = 'dsh-mywork-'` — источник идентификатора на периферии (DSH request id) |
| `packages/controller/src/dsh-session.ts:847` | `return \`${DSH_REQUEST_ID_PREFIX}${crypto.randomUUID()}\`` — генерация |
| `packages/controller/src/telemetry.ts:223` | `'mywork.correlation_id': input.correlationId` — точка, где корреляция становится **атрибутом продуктового события** |

## API `productTelemetry` (не перепроверялся, взят из `evidence/foundation-17-telemetry.md`)

- имя сервиса: `productTelemetry` (DSH `packages/host/product-telemetry-otel/src/index.ts:15`, `:102`);
- единственный публичный метод: `emit(record): void`, синхронная постановка в очередь (`:162`);
- обязательные поля записи: `eventName` (`:25`), `body` (`:27`), `timestamp` (`:29`);
- опциональные: `severityNumber` (`:31`), `attributes` (`:33`);
- **политики PII в пакете нет**; doc-инвариант `:26` — «never a prompt, response, credential, or file contents», `README.md:104` — «Caller-selected strings are **not redacted automatically**» (переанкорено 2026-10-03: было `:103`).

Поэтому `body` — главный канал утечки, и в F-54 он **фиксированная строка на имя события**
(`packages/controller/src/telemetry.ts:171` читает только `PRODUCT_EVENT_BODIES`), а не шаблон:
`ProductEventInput` не имеет поля, из которого `body` мог бы быть построен. Полный белый список
атрибутов — F-55.

## Границы

- Платформенный пакет **не импортируется**. Форма записи объявлена локально структурно
  (`ProductTelemetryRecord`), сервис читается через `ctx.get('productTelemetry')`;
  `tests/boundaries.test.mjs` запрещает любой `@deepseek-ai/*`, кроме `@deepseek-ai/cordis`.
  **Уточнено (delta по ревизии B):** на момент F-54 модуль не импортировал вообще ничего; в F-55/B6
  он импортирует `OPERATION_DOMAINS` и тип `OperationDomain` из `@dsh-mywork/contracts` — это
  workspace-пакет, который бандл контроллера инлайнит, а не платформенный пакет. Прежняя
  формулировка «не импортирует ничего» этим изменением перестала быть верной.
- `emit` — fail-open: без сервиса возвращается `{ emitted: false, reason: 'telemetry-disabled' }`,
  исключение не бросается (проверено кейсом 2).
  **Уточнено (delta по ревизии B, finding B6):** изначально fail-open покрывал только отсутствие
  сервиса — бросок `ctx.get` пробрасывался наружу, что противоречило этой же формулировке. Теперь
  причин три: `telemetry-disabled` (сервиса нет), `telemetry-unavailable` (поиск бросил),
  `telemetry-failed` (`emit` бросил); ни одна не роняет попытку. Подробности и мутации —
  `foundation-55-telemetry-pii.md`, раздел «Ревизия B, finding B6».
- Запись строится **до** разрешения канала (`packages/controller/src/telemetry.ts`, `emitProductEvent`
  вызывает `toProductEvent` первым), поэтому негодное событие отвергается и в профиле без коллектора.
- **Не сделано:** OTel-экспортёр не строился (D16); `severityNumber` не выставляется — платформа
  подставляет INFO; профиль не менялся (живой `C:\Users\Dmitry\.dsh` не читался и не писался);
  сетевых вызовов к коллектору не было.

## Ограничения проверки

- Экспорт **не включался в живом профиле** и не наблюдался на реальном коллекторе: в живом профиле
  `productTelemetry` не смонтирован (`evidence/foundation-17-telemetry.md:29`), поэтому проверено
  только поведение с фейковым контекстом (кейсы 2 и 3).
- Тест импортирует собранный бандл контроллера, а не монтирует его; `DSH_HOME` всё равно
  пришпилен к `.tmp/telemetry-dsh-home` через `tests/lib/tmp-home.mjs` с положительной проверкой.
