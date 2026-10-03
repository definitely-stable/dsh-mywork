ВОПРОС: product-telemetry в DSH — имя сервиса, методы, схема события (DSH = C:\Reposit\deepseek-harness\deepseek-harness)

ПОДТВЕРЖДЕНО
Get-ChildItem packages -Recurse -Directory -Filter "*telemetry*" → exit 0, 3 каталога: packages\host\product-telemetry-otel, packages\session\session-telemetry, packages\session\session-telemetry-otel
Пакет: DSH:packages/host/product-telemetry-otel/package.json:2 = "@deepseek-ai/dsh-host-product-telemetry-otel", :4 version "0.1.7-rc.2"
(а) имя сервиса в ctx: DSH:packages/host/product-telemetry-otel/src/index.ts:15 `productTelemetry: ProductTelemetry`; :102 `super(ctx, 'productTelemetry')`
(б) публичный метод ровно один: DSH:packages/host/product-telemetry-otel/src/index.ts:162 `emit(record: ProductTelemetryRecord): void` (синхронная постановка в очередь, без ожидания сети)
(б) каталог подтверждает одну сигнатуру: DSH:packages/extensions/tool-cordis/src/api-catalog.ts:1756 `emit(record: ProductTelemetryRecord): void` (ключ :1751; переанкорено 2026-10-03: было `:1706` и `:1701`)
(б) прочие экспорты: DSH:packages/host/product-telemetry-otel/src/index.ts:20 ProductTelemetryScalar, :23 ProductTelemetryRecord, :37 Config, :65 Config(схема+дефолты :66-76), :80 `export default class ProductTelemetry extends Service`
(в) обязательные поля события: DSH:packages/host/product-telemetry-otel/src/index.ts:25 `eventName: string`, :27 `body: string`, :29 `timestamp: number` (Unix ms)
(в) опциональные поля: DSH:packages/host/product-telemetry-otel/src/index.ts:31 `severityNumber?: SeverityNumber` (по умолчанию INFO, :163), :33 `attributes?: Record<string, scalar | Record<string, scalar>>`
(в) на emit добавляются: DSH:packages/host/product-telemetry-otel/src/index.ts:166 `observedTimestamp: Date.now()`, :167-168 `severityNumber` + `severityText`
(г) политики PII/секретов в самом пакете НЕТ: runtime-редакции, allow/deny-списка полей и валидации содержимого в src нет
(г) есть только doc-инварианты: DSH:packages/host/product-telemetry-otel/src/index.ts:26 «never a prompt, response, credential, or file contents»; README.md:56 и README.md:104 «Caller-selected strings are not redacted automatically. This package does not decide product disclosure or consent policy.» (переанкорено 2026-10-03: было `:103`)
(г) единственная защита в коде — изоляция заголовков: DSH:packages/host/product-telemetry-otel/src/index.ts:113 headers = {Content-Type, x-channel}; покрыто тестом DSH:packages/host/product-telemetry-otel/tests/telemetry.spec.ts:101-114 (ambient OTEL_EXPORTER_OTLP_HEADERS не наследуются)
(г) редакция живёт в ДРУГОМ пакете: DSH:packages/session/session-telemetry/src/index.ts:25-43 waterfall 'session-telemetry/record' (правил не содержит, «exports data is exactly as clean as the rules a deployment mounts»)
Кто использует productTelemetry — только тесты и генераторы, продуктивных потребителей в чекауте нет:
DSH:packages/host/product-telemetry-otel/tests/fixtures/driver.ts:31 `ctx.get('productTelemetry')`
DSH:packages/host/product-telemetry-otel/tests/telemetry.spec.ts:72 `ctx.productTelemetry`, :107/:128/:137/:146/:182 `.emit(event)`
DSH:packages/extensions/tool-cordis/src/api-catalog.ts:1751 `key: 'productTelemetry'` (переанкорено 2026-10-03: было `:1701`)
DSH:scripts/gen-cordis-catalog.ts:55 `productTelemetry: 'product-telemetry.md'`; DSH:scripts/gen-doc-graphs.ts:409-410 `key: 'productTelemetry'`
OTel-слой: Get-ChildItem packages -Recurse -Filter "*otel*" → exit 0, 3 пути: packages\host\product-telemetry-otel, packages\session\session-telemetry-otel, packages\session\session-telemetry-otel\tests\otel.spec.ts
OTel-слой: DSH:packages/host/product-telemetry-otel/src/index.ts:11 LoggerProvider+BatchLogRecordProcessor, :116 OTLPExporterBase+JsonLogsSerializer; README.md:68 «No global OTel provider is installed»

ОПРОВЕРГНУТО / УТОЧНЕНО
УТОЧНЕНО: каталог называется product-telemetry-otel; каталога ровно «product-telemetry» нет, а фильтр "*telemetry*" дал 3 каталога, а не 1
ОПРОВЕРГНУТО: методов track()/event() нет — grep 'track' по пакету product-telemetry-otel → 0 совпадений
УТОЧНЕНО: `export class` отсутствует — DSH:packages/host/product-telemetry-otel/src/index.ts:80 объявляет `export default class ... extends Service`
ОПРОВЕРГНУТО: в живом профиле web продуктовая телеметрия НЕ смонтирована — Test-Path C:\Users\Dmitry\.dsh\profiles\web\node_modules\@deepseek-ai\dsh-host-product-telemetry-otel → False; Select-String 'telemetry' в cordis.patch.yml → пусто; cordis.yml = `[]`
УТОЧНЕНО: «telemetry» в profiles\web\node_modules — другой механизм, не cordis-сервис: анонимный heartbeat Web UI family на https://dsh-market.com/api/telemetry/event (C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\src\client\telemetry.ts:25-27)
УТОЧНЕНО: DSH_TELEMETRY_DISABLED гасит только строку 'session-telemetry-otel' (DSH:packages/boot/app-boot/src/profile-context.ts:39 и :52-54), к productTelemetry не относится; у продукта opt-out = просто не монтировать плагин
УТОЧНЕНО: рядом есть второй сервис — DSH:packages/session/session-telemetry/src/index.ts:21 `sessionTelemetry`, :147 `super(ctx,'sessionTelemetry')`, методы emit/flush?/shutdown (:105, :117, :131) — не путать с productTelemetry

НЕ ПРОВЕРЕНО
фактический приём событий коллектором https://dsh-otel-collector.deepseeksvc.com/v1/logs не проверялся: сетевых вызовов не делал (read-only, внешний сервис)
tests/telemetry.spec.ts отдельным прогоном не запускал — схема события подтверждена чтением src/index.ts:23-34, а не тестом
потребители вне packages (apps/, .tsx/.js/.mjs) не покрыты полным grep — поиск по *.ts всего чекаута дал 24 совпадения, все внутри пакета, тестов и scripts
WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-17-telemetry.md
