# dsh-mywork

MyWork — плагин для DeepSeek Harness (DSH), который ведёт длительную работу
нескольких агентов: команды и роли, граф задач, попытки и lease, контекст,
review, память и доска. Репозиторий содержит каркас v0.1 (этап `00-foundation`).

План и рабочие материалы лежат в `.work/` (каталог исключён из Git):
архитектура, план исполнения, карточки задач и отчёты.

## Структура

```text
packages/contracts     @dsh-mywork/contracts    — доменные контракты, имена сервисов, порты
packages/core          @dsh-mywork/core         — чистые политики: переходы состояний, authority, конфигурация §6 и Team Work §13, граф, часы, routing §29, бюджет §30 и Context Fabric §21
packages/storage       @dsh-mywork/storage      — durable state: SQLite, schemaVersion, миграции, outbox/inbox
packages/lease         @dsh-mywork/lease        — controller lease §5.3, монотонный epoch и lifecycle §16.1/§49
packages/adapter-sdk   @dsh-mywork/adapter-sdk  — каталог портов §36, registry и capability negotiation §37/§44, conformance kit §39, ошибки и fakes
packages/controller    @dsh-mywork/controller   — Cordis-плагин (bundle) и его patch-слой
tests/                 доменные тесты (node:test, без LLM; один тест поднимает процесс-потомок)
scripts/               smoke, локальная упаковка и проверка изолированного профиля
```

Границы `contracts → core → adapter-sdk → controller` соблюдены: контроллер
зависит от нижних пакетов, обратных зависимостей нет. Пакеты пока `private`:
публикация в реестр не выполняется и требует отдельного решения владельца.

Домен описан контрактами (Task/Attempt/Review, Role/Blueprint/Identity,
revisions, `OperationMeta`, `Result`/`MyWorkError`, event envelope, матрица
authority §8) и чистыми переходами состояний в `core`: переход либо возвращает
следующее состояние с событиями, либо типизированную ошибку (`STALE_REVISION`,
`STALE_FENCE`, `LEASE_LOST`, `TASK_CONFLICT`, `UNSCHEDULABLE`, `SECURITY_DENIED`).
Домен не импортирует DSH, Beads и конкретные memory-провайдеры — это проверяется
тестом `tests/boundaries.test.mjs`.

## Конфигурация и Team Work

Рабочая область конфигурируется в одном из режимов §6: `global` (использует
глобальные Team, workflow, blueprints, memory routes и pool policies), `isolated`
(владеет своими namespace'ами Team Work, Task Graph и memory, настройками
workflow, ревизиями агентов и лимитами) и `inherit` — режим по умолчанию,
который применяет цепочку overlays `platform-default → global → team → workflow →
workspace → task`. `core.resolveWorkspaceConfig` сводит цепочку в одно
resolved-состояние: объекты (blueprint-пины, лимиты §14, namespace'ы) сливаются по
ключам, скаляры и массивы заменяются верхним слоем. Слой, которому режим не
делегирует домен (workspace-слой в `global`), — типизированный отказ
(`CONTRACT_MISMATCH`), а не молчаливое игнорирование; runtime-namespace
workspace-scoped в любом режиме (§52), поэтому его не может задать ни один слой
(`SECURITY_DENIED`).

Resolved-состояние получает `ConfigRevision`: реестр `createConfigRevisionRegistry`
выдаёт номер по каноническому fingerprint'у, поэтому одинаковое состояние
сохраняет ревизию, а изменённое получает следующую. При admission попытки
`core.resolveAttemptRevisions` фиксирует набор ревизий (§35) — опубликованная
позже ревизия blueprint'а влияет только на следующий запуск, а runtime-дескриптор
и сессия остаются на попытке, не на durable identity (ADR-004). Границы
зависимостей графа задач проверяет `core.assertWorkspaceLocalEdges`: ребро между
workspace'ами запрещено (§52), а artifact/reference-ссылки — нет.

## Права и границы (§31)

Права роли применяются в runtime, а не просьбой в prompt: каждая операция
проходит через `core.authorizeOperation`, у которого ровно два входа — грант
(`AuthorizationContext`: permissions blueprint'а, один workspace, действующая
политика harness) и запрос операции (`OperationRequest`: домен §31, действие,
workspace, необязательные path и credential reference). Ни промпт, ни запись
memory не могут расширить грант: в этих схемах нет полей, куда они могли бы
попасть, а лишнее поле — отказ (`TypeError`), а не молчаливое игнорирование.

Обязательное право выводится из пары `domain.action` по таблице
`OPERATION_PERMISSIONS`, а не передаётся вызывающим, поэтому запросить «право
послабее, чем нужно операции» нельзя. Неизвестная пара — отказ
(`unknown-operation`): неизвестная capability не даёт разрешения. Право вне
гранта — тоже отказ (`permission-missing`), а не эскалация. Политика harness —
второй потолок: для файловых и shell-эффектов `HARNESS_POLICY_CEILING` не даёт
авторизовать то, что платформа всё равно отклонит (`harness-policy`).

Границы workspace проверяются текстово и до файловой системы: `isWithinRoot`
канонизирует путь (разделители, `.`, `..`), сравнивает посегментно — поэтому
`C:\ws-evil` не внутри `C:\ws` — и отказывает при выходе за `workspaceRoot`
(`path-escape`) или за worktree попытки (`worktree-escape`). Сегмент, который
Win32 всё равно обрежет (заканчивается на `.` или пробел), тоже отказ: иначе
сравнивался бы один путь, а открывался другой. Операция, которая трогает
файловую систему (`filesystem.*`, `git.*`), обязана назвать путь: без пути
проверять нечего, поэтому такой запрос отклоняется (`path-missing`), а не
авторизуется. Абсолютный путь в общий checkout вместо своего worktree — это и
есть escape; относительный путь разрешается относительно границы, а в решении
(`AuthorizationDecision.path` + `boundaryRoot`) видно, какой корень проверялся.
Операция в чужом workspace отклоняется (`foreign-workspace`, §52), самоодобрение —
тоже (`self-approval`; идентификаторы сравниваются без учёта регистра и
Unicode-композиции), как и одобрение без личности воркера
(`unverifiable-independence`).

Reviewer по умолчанию read-only, и правило принадлежит *одобрению*, а не флагу:
грант, который может одобрять (`review.approve`), не имеет права держать
`workspace.write`, `git.write` или `shell` — иначе он отклоняется целиком как
дефект конфигурации (`reviewer-write-grant`), а не сужается молча.
`REVIEWER_DEFAULT_PERMISSIONS` содержит чтение, diff, verification и approve.
Схемы закрыты: значение с унаследованными полями (`Object.create`) или с
symbol-полем отклоняется, а лишнее поле — отказ (проверяются и неперечислимые
собственные ключи). Границы этой закрытости названы честно: `Proxy`, который лжёт
про свои ключи, в процессе не поймать, а объект из другого realm (`node:vm`)
отклоняется, потому что «обычность» проверяется по `Object.prototype` этого realm.

Что осознанно **не** входит в границу пути: `mcp.invoke` пути не имеет, поэтому
MCP-инструмент с файловым эффектом ограничен только своим правом и самим MCP-сервером
(MCP-рантайма в дереве ещё нет); `shell` ограничен потолком политики harness и рабочим
каталогом, который привяжет рантайм (MW-015).

Секреты в грант не попадают: `secrets.use` принимает только credential reference
(`assertCredentialReference` отклоняет PEM, JWT — в том числе за `Bearer`, —
вендорские токены, присваивания вида `password=`, hex-ключи от 32 символов и
длинные непрозрачные base64-подобные прогоны как `secret-material`). Проверка
консервативна в обе стороны и это её осознанные границы: ссылка без признаков
секрета принимается независимо от того, какое хранилище она называет
(`dsh:credential/deploy-key`, `op://prod/db-password:prod`), а длинный
непрозрачный идентификатор, смешивающий регистр и цифры, отклоняется, даже если
это просто id. Гейты §28 (release, миграции, production) не решаются правом: гейт
отказывает (`human-gate`), потому что их решает человек.

## Model routing и бюджет (§29, §30)

Политика §13.1 называет `preferred`, `fallback` и `escalation`, а маршрут выбирает
живой каталог: строка контроллера находит сервис DSH `llm`, оборачивает его
(`listProviders` / `listModels` / `resolveModelInfo`, включая вложенный
`context.contextWindow`) в порт `model-catalog` §36 и регистрирует его в
`myworkAdapters`, поэтому policy запрашивает каталог по kind, а не по имени DSH.
`core.routeModel`/`core.selectModelRoute` идут по кандидатам в порядке политики и
различают три отказа, которые ведут к разным решениям: провайдер не
зарегистрирован — `route-absent`; зарегистрирован, но не ответил — `provider-outage`;
ответил кодом DSH `UNKNOWN_MODEL` — снова `route-absent`, а не outage. Окно
контекста берётся из каталога: если оно не опубликовано или меньше требуемого,
кандидат отклоняется (`context-window-undisclosed` / `context-window-too-small`), а
не считается подходящим, и в provenance неизвестное окно остаётся отсутствующим, а
не нулевым.

Escalation — только по явному разрешению запроса (`allowEscalation`), поэтому
значение по умолчанию для разработки `DEVELOPMENT_MODEL_POLICY` —
`opencode-go/deepseek-v4.1-flash` с пустыми `fallback` и `escalation`: платная
frontier-модель не выбирается автоматически. Каждое успешное решение несёт
`ModelRouteProvenance` (фактический маршрут, роль в политике, триггер §29, окно и
все рассмотренные кандидаты), так что маршрут нельзя получить без записи о нём;
сохраняет эту запись путь admission (MW-014/MW-015).

§30 реализован как `core.decideBudgetAdmission`: восемь лимитов
(`maxTokensPerTask`, `maxCostPerTask`, `maxAttempts`, `maxReviewLoops`,
`maxPlannerCalls`, `maxOptimizerCostPerDay`, `workspaceDailyBudget`,
`providerDailyBudget`) проверяются в порядке §30, и первый сработавший возвращает
`limit`, `scope`, `declared`, `used`, `requested` и причину. Граница включительная:
расход, ровно попадающий в потолок, допускается, следующий — нет. Неизвестное не
становится нулём: `core.readCallTokens` даёт `unknown` с причиной, если провайдер не
сообщил usage, `core.modelCallCost` — если у маршрута нет тарифа, а сама сумма
остаётся неизвестной (`addAmounts`). Такой лимит становится непроверяемым, и
admission по нему отклоняется с `limit-unverifiable` (или `scope-not-measured`,
если для scope не передан ledger), а не проходит «на всякий случай»; запись о
расходе (`core.chargeConsumption`) записывает пропущенное измерение как `unknown`,
а не как ноль, поэтому «потратили, но не записали» не растворяется в ленте.
Имена лимитов — закрытая форма: опечатка в имени (`maxTokensPerTasks`) —
`TypeError`, а не «лимитов не объявлено». Что делать с исчерпанным бюджетом —
pause, escalate или human decision — решает caller: в §30 это политика workflow, а
не решение бюджетного гейта.

Проверки: `tests/routing.test.mjs` (каталог, outage против отсутствия маршрута,
граница окна, withheld escalation, привязка к реальному `llm`) и
`tests/budget.test.mjs` (граница лимита, неизвестные usage/cost, остановка
admission). FakeProvider — `FakeModelCatalog` в `@dsh-mywork/adapter-sdk/testing`.

## Context Fabric и snapshots (§21, §35, §53)

§21.1 отдаёт весь model-visible context одному владельцу. Провайдеры возвращают
*кандидатов* и тела, и у порта `context-provider` нет метода, который что-либо
публикует: `ContextProviderPort` — это `capabilities` / `discover` /
`materialize`, а в prompt контекст попадает только через
`core.assembleContextPrompt`, который принимает исключительно
`ContextSnapshot`. Провайдер, которого нет в замороженном snapshot, вставить
ничего не может — это свойство конструкции, а не соглашение.

Конвейер односторонний: `core.discoverContext` → `core.decideContextAdmission` →
`core.materializeContextSnapshot` → `core.verifyContextSnapshot`. Discovery
опрашивает все привязки и записывает по одному наблюдению на провайдера;
недоступный провайдер не срывает проход (его отказ остаётся в `detail`), а
провайдер, не ответивший про capabilities, не получает ни одного вопроса.
Классы, о которых просил запрос, фильтрует сам Fabric, что бы адаптер ни сделал с
запросом.

Бюджет §21.6 считается от реального маршрута: `resolveContextBudget` применяет
доли политики к окну, которое опубликовал выбранный route, и сначала удерживает
`workingReserve` и `safetyReserve` — то, что нужно попытке, чтобы работать и
вообще ответить. Политика по умолчанию — числа §21.6 как они есть
(`DEFAULT_CONTEXT_POLICY`). Маршрут, не опубликовавший окно, не получает бюджета
вообще (`context-window-undisclosed`): неизвестное окно не читается как
нулевое, ровно как неизвестная сумма §30.

Mandatory-контекст (`policy`, `role-contract`, `task-contract`) выбирается при
любой релевантности, но не подрезается: превышение потолка `mandatory.maxFraction`
блокирует admission (`mandatory-overflow`, код `CONTEXT_BUDGET_EXCEEDED`), а
превышение assembly-бюджета — `reserves-overflow`. Неизмеримое или непроверяемое
mandatory-контекст тоже отказ, а не «пройдёт на всякий случай»:
`mandatory-tokens-unknown` без оценки токенов и `mandatory-unverifiable` без
revision и content hash. Явный ноль токенов — измерение пустого элемента, а не
ошибка: «не измерено» это отсутствие поля. Опциональные items берутся в порядке
ранга (заявленная релевантность, затем более дешёвый, затем uri — порядок не
зависит от того, в каком порядке ответили провайдеры) и удерживаются целевыми
долями `workspaceCanon` / `memory` / `dependencies`; остаток assembly-бюджета
доступен классам без своей цели. Один uri — один item: два провайдера вправе
адресовать один элемент (native и внешний memory-провайдер по §62 пп. 25–26), и
повторный претендент записывается в `dropped` как `duplicate-uri`, а не удваивает
расход и не срывает попытку. Время материализации обязательно: решение, принятое
против выдуманных часов, — другое решение.

L2 загружается только по запросу: `requestedFullContent` называет uri, тела
которых нужно получить, остальные items остаются на уровне discovery и
рендерятся ссылкой. Если тело уже пришло при discovery на уровне L2, порт не
спрашивается вовсе — иначе провайдер, честно объявивший
`onDemandMaterialization: false`, отказывал бы в теле, которое Fabric уже держит.
Тело, которое провайдер не отдаёт — нет привязки, нет `onDemandMaterialization`,
отказ порта, устаревшая revision или **ответ на более низком уровне, чем
запрошено**, — отказывает snapshot целиком (`materialization-failed`): молчаливого
понижения до обзора нет, и метка уровня в снапшоте всегда описывает то, что
реально пришло. Тело, оказавшееся больше запланированного — сверх assembly-бюджета
или сверх целевой доли своего класса, — отказ `materialized-overflow`.

Trust решает размещение, а не отбор. `instruction` получает только класс из
`INSTRUCTION_CONTEXT_CLASSES` с trust ровно `trusted`; всё остальное — `data`,
включая untrusted mandatory-контекст (`downgraded: true`), потому что «показать
как данные» и «сказать, что делать» — разные вещи. Данные рендерятся в
ограждённой секции, и токен ограждения нейтрализуется **во всём, что пришло от
источника**: в теле, а также в uri, source, классе и revision, которые Fabric
подставляет вокруг него. Ограждение, стерегущее только тело, обходится
метаданными — источник, собравший uri из своих данных, закрыл бы секцию и
продолжился бы как обычный текст промпта.

Snapshot §21.7 замораживается целиком (`deepFreeze`), фиксирует revisions
(`task`/`role`/`blueprint`/`workflow` + per-skill), маршрут, tool surface, хеши,
оценки токенов, отброшенных кандидатов с причинами и provenance каждого item;
fingerprint — канонический вид, из которого реестр чеканит revision семейства
`context-snapshot` (§35). Маршрут копируется в снапшот, а не кладётся по ссылке:
заморозка снапшота не должна достигать объектов вызывающего. Повторная
материализация не переписывает snapshot: `verifyContextSnapshot` сравнивает
замороженные revision/hash с тем, что источник говорит сейчас, и различает три
состояния наблюдения — строка («источник опубликовал это»), `null` («источник не
публикует там, где снапшот заморозил значение» → дрейф `unverifiable`) и
отсутствие поля («вызывающий не смотрел» → не доказательство ни в какую сторону).

Проверки: `tests/context.test.mjs` (бюджет от окна, граница потолка, ранжирование
и цели, L2 по запросу, downgrade по trust, неизменяемость snapshot, drift).
Fake — `FakeContextProvider` в `@dsh-mywork/adapter-sdk/testing`.

## Controller lease и lifecycle (§5.3, §16.1, §49)

Одновременно менять runtime state одного installation scope имеет право ровно
один Controller (§5.3). Это право — строка `controller_lease` в
`$DSH_HOME/dsh-mywork/state/controller.sqlite`: `@dsh-mywork/lease` выдаёт его
через compare-and-set внутри одной транзакции, поэтому два контроллера,
одновременно претендующие на истёкший lease, не могут оба увидеть успех —
проигравший получает `held-by-other`, потому что его `UPDATE` не меняет ни одной
строки.

`epoch` — токен failover. Он увеличивается при каждой передаче лидерства, в том
числе когда тот же инстанс переполучает lease после собственного истечения,
поэтому epoch вытесненного контроллера навсегда строго меньше текущего. Понижение
epoch запрещено триггером базы, а не только кодом слоя, так что обойти это
внутри БД нельзя. Проверка `holdsLeadership(scope, instanceId, epoch, at)`
требует и личность, и epoch: одного epoch недостаточно, потому что проигравший
претендент видит epoch победителя.

Lifecycle следует порядку §16.1: `activate()` получает lease, открывает stores и
выполняет reconcile, и только потом открывает admission. Контроллер, которому
лидерство не досталось, переходит в `passive` и не открывает ничего. `dispose()`
идёт в обратном порядке — сначала закрывает admission, затем stores и лишь потом
отдаёт lease, — чтобы преемник не начал писать, пока предшественник ещё
завершает мутацию. Всё это работает без открытой вкладки: lifecycle запускается
активацией плагина, а истечение lease видно по durable-состоянию, а не по
событию UI. Провалившаяся активация возвращает lease, чтобы не блокировать
здорового преемника до истечения.

## Runtime state

Runtime-данные не лежат в репозитории: `@dsh-mywork/storage` открывает SQLite под
`$DSH_HOME/dsh-mywork/state/` (§7 архитектуры), в WAL, с явной версией схемы
(`PRAGMA user_version`) и журналом миграций. Мутация и события, которые она
породила, коммитятся одной транзакцией (`BEGIN IMMEDIATE`), а потребитель
записывает `eventId` в `inbox_dedup`, поэтому повторная доставка события не
применяет эффект второй раз. Тесты поднимают свои базы во временных каталогах и
живого профиля DSH не касаются.

## Требования

- Node.js >= 22.18 (проверено на 24.19.0)
- pnpm 12.4.2 (пин в `packageManager`)
- DSH 0.1.5-rc.2 — для `verify:profile`

## Команды

```sh
pnpm install
pnpm run typecheck      # tsc --noEmit по каждому пакету
pnpm run build          # tsdown → lib/ каждого пакета
pnpm run smoke          # воспроизводимый smoke: mount/dispose плагина без LLM
pnpm run test           # доменные тесты (нужен предварительный build)
pnpm run check          # typecheck + build + smoke + test
pnpm run pack:local     # pnpm pack контроллера в .tmp/pack
pnpm run verify:profile # упаковка + установка и boot в изолированном DSH-профиле
```

`pnpm run test` запускает `node --test --test-isolation=none` по
`tests/**/*.test.mjs`: обычный `node --test` поднимает по процессу на файл и в
ограниченном (sandbox) шелле падает со `spawn EPERM` — то же ограничение, что и
у esbuild в `verify:profile`. Тесты не требуют модели, сети и подпроцессов.

`verify:profile` создаёт изолированный `DSH_HOME` в `.tmp/verify-profile`,
устанавливает собранный tarball через `dsh plugin --profile <name> add`,
проверяет составленный конфиг и загружает профиль, после чего удаляет
временные данные. Рабочий профиль пользователя при этом не используется.
CLI DSH можно задать явно: `node scripts/verify-profile.mjs --dsh-bin <path>`.

Если `dsh` запускается из исходников и в ограниченном (sandbox) шелле падает
со `spawn EPERM` (esbuild не может создать pipe), укажите собранный CLI:

```sh
node scripts/verify-profile.mjs --dsh-bin <checkout>/apps/cli/lib/bin.js
```

## Плагин

`@dsh-mywork/controller` объявляет `dsh.bundle.patch` и потому становится
слоем профиля после установки:

```sh
dsh plugin --profile mywork add ./dsh-mywork-controller-0.1.0.tgz
dsh --profile mywork --dump-config
dsh --profile mywork
```

Плагин публикует сервис `myworkController` и снимает его при выгрузке
(`ctx.effect`). Строка конфигурации `diagnostics: true` включает одну
диагностическую строку на mount/stop в stderr.

## Адаптеры

Второй сервис плагина — `myworkAdapters` (§44): registry, в который адаптер
регистрирует своё объявление, а policy запрашивает порт по kind и требуемым
capabilities, никогда по имени провайдера. Несовместимая версия контракта
(`memory/v2` при `memory/v1`) и отсутствующая/ложная capability дают явный
отказ: `CONTRACT_MISMATCH` и `CAPABILITY_UNSUPPORTED` из канонического словаря
§42. При выгрузке плагина сервис и все регистрации снимаются вместе с ним.

```ts
// Сервис опубликован контроллером: ctx.get('myworkAdapters') (§44).
adapters.register({
  kind: 'memory',
  id: 'openviking',
  contractVersion: 'memory/v1',
  capabilities: { retain: true, recall: true, reflect: false },
  create: () => new OpenVikingAdapter(ctx),
})
```

Каталог портов §36, правила совместимости версий, conformance kit §39 и
детерминированные fakes живут в `@dsh-mywork/adapter-sdk`; сам SDK не
импортирует DSH и ничего не знает о конкретных интеграциях.
