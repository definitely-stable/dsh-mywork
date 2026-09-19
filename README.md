# dsh-mywork

MyWork — плагин для DeepSeek Harness (DSH), который ведёт длительную работу
нескольких агентов: команды и роли, граф задач, попытки и lease, контекст,
review, память и доска. Репозиторий содержит каркас v0.1 (этап `00-foundation`).

План и рабочие материалы лежат в `.work/` (каталог исключён из Git):
архитектура, план исполнения, карточки задач и отчёты.

## Структура

```text
packages/contracts     @dsh-mywork/contracts    — доменные контракты, имена сервисов, порты
packages/core          @dsh-mywork/core         — чистые политики: переходы состояний, authority, конфигурация §6 и Team Work §13, граф, часы
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
