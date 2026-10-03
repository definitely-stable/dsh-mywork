# Поток D: контекст, память, сессии, маршрутизация моделей, evidence

**Вердикт потока:** §39 и §40 подтверждены кодом и тестами полностью (включая fencing, frozen snapshot, revisions/hashes, mandatory-overflow=refusal, семь scope-семейств памяти), **но обе подсистемы не подключены к рантайму** — у Context Fabric и Memory Fabric нет ни одного потребителя вне тестов; §26 подтверждён; §48 подтверждён по запрету копирования транскрипта и опровергнут по навигации (`SessionLink` объявлен, но не производится и не тестируется — D-40); §38 подтверждён частично — список операций и `/permission`-seam реальны, но conformance не покрывает 2 из 3 политик и ветку «нет живого агента»; §37 подтверждён и **усилен**: в DSH «listed ≠ routable» различается тремя независимыми механизмами, а `resolveModelInfo` для некаталожной модели не падает, а возвращает `defaultContextWindow = 1 000 000` — значит `resolveModelInfo` вообще не годится как проба доступности; §41 подтверждён (8 MiB на request extension), а байтовых бюджетов у MyWork нет ни на одном транспорте. Все 50 CLAIMS имеют статус verified, но одно из них (D-40) фиксирует факт, **опровергающий формулировку документа** «Board уже имеет `SessionLink`».

## 1. Что проверено и как

| Утверждение | Как проверял (файл:строка / команда) | Результат |
|---|---|---|
| MyWork: L0/L1/L2 как закрытый набор, L2 = fetch-on-request | `packages/contracts/src/context.ts:38-50` | подтверждено |
| MyWork: `MANDATORY_CONTEXT_CLASSES` = policy/role-contract/task-contract | `packages/contracts/src/context.ts:108-112` | подтверждено |
| MyWork: `INSTRUCTION_CONTEXT_CLASSES` совпадает с mandatory, но объявлен отдельно | `packages/contracts/src/context.ts:125-129` (комментарий 119-124) | подтверждено |
| MyWork: trust — одно значение `'trusted'`, всё остальное = data | `packages/contracts/src/context.ts:155-168`; `packages/core/src/context.ts:830-832` | подтверждено |
| MyWork: маршрут без окна → `context-window-undisclosed` | `packages/core/src/context.ts:222-225` | подтверждено |
| MyWork: mandatory не обрезается — отказ при переполнении | `packages/core/src/context.ts:249-274` | подтверждено |
| MyWork: mandatory без оценки токенов / без revision+hash / просроченный → отказ | `packages/core/src/context.ts:250-258` | подтверждено |
| MyWork: дедуп по uri, первый в порядке discovery побеждает | `packages/core/src/context.ts:235-244` | подтверждено |
| MyWork: ранжирование не зависит от порядка ответов провайдеров | `packages/core/src/context.ts:878-890`; тест `tests/context.test.mjs` «ranking does not depend on the order the providers answered in» | подтверждено |
| MyWork: frozen snapshot (deepFreeze + fingerprint + registry revision) | `packages/core/src/context.ts:622-631`, `1403` (deepFreeze) | подтверждено |
| MyWork: provenance = ссылки, не payload | `packages/contracts/src/context.ts:188-205`; `packages/core/src/context.ts:988-1025` | подтверждено |
| MyWork: fencing данных + нейтрализация fence-токена в provider-controlled полях | `packages/core/src/context.ts:752-756`, `794-801`, `1028-1048` | подтверждено |
| MyWork: drift-верификация различает string / null / absent | `packages/core/src/context.ts:634-749` | подтверждено |
| MyWork: `DshModelCatalog` оборачивает ровно 3 метода + `context?.contextWindow` | `packages/controller/src/model-catalog.ts:63-80`, `94-128` | подтверждено |
| MyWork: `ModelCatalogPort` не имеет метода доступности | `packages/contracts/src/model-catalog.ts:113-129` | подтверждено |
| MyWork: `CatalogSnapshot.outages` реально производится и потребляется | `packages/core/src/routing.ts:98-120`; `packages/core/src/scheduler.ts:176-196` | подтверждено |
| DSH: «listed ≠ routable» на уровне провайдера | `packages/api/session-controller/src/catalog.ts:64-70` (`routableProviders`, `failures`) | подтверждено |
| DSH: preflight выбора модели | `packages/api/session-controller/src/commands.ts:151-155`, `379-384`; `catalog.ts:80-90` | подтверждено |
| DSH: отдельная проверка настроенности API-ключа | `packages/api/session-controller/src/catalog.ts:97-116` | подтверждено |
| DSH: UI-состояние `routable` + `pending` | `packages/client/ui-model-selection/src/client/directory.ts:17-34`, `141-178` | подтверждено |
| DSH: `resolveModelInfo` не падает на некаталожной модели | `packages/llm/llm-deepseek/src/adapter.ts:37-39`; `packages/llm/llm-deepseek/src/model-info.ts:61-67`; `packages/llm/llm-deepseek/src/defaults.ts:6` | подтверждено (новое) |
| MyWork: session-операции create/list/selectModel/prompt/cancel/follow | `packages/controller/src/dsh-session.ts:173-219`, `664-719` | подтверждено |
| MyWork: `/permission <preset>` как единственный seam | `packages/controller/src/dsh-session.ts:591-630` | подтверждено |
| DSH: `/permission` действительно host-команда UI | `packages/client/ui-permission-presets/src/client/index.ts:126-130` | подтверждено |
| MyWork: тесты адаптера покрывают только `workspace-write` | `tests/runtime.test.mjs:44-48` (SCOPE), `440-464` | подтверждено (пробел) |
| MyWork: памяти scopes = 7 базовых семейств | `packages/contracts/src/memory.ts:56-67` | подтверждено |
| MyWork: никакой связи TeamId с DSH Agent Teams | `Select-String -Pattern 'agent-teams\|agentTeam\|teammate'` по `packages/**/*.ts`, `tests/**/*.mjs` → 0 совпадений | подтверждено |
| DSH: лимит request extension 8 MiB | `packages/session/session-log-deepseek/src/index.ts:39-53`, `203-223`; `git show 193f9ce413` | подтверждено |
| DSH: лимиты вложений | `packages/attachment/attachment-local/src/index.ts:34-58`, `150-158` | подтверждено |
| DSH: tool-result pruner 8192/4096/1024 символа | `packages/compaction/compaction-tool-result-pruner/src/config.ts:7-14` | подтверждено |
| MyWork: транскрипт не копируется (`carriesTranscript: false`, refs-only) | `packages/contracts/src/session.ts:425-426`, `944-945`; `packages/core/src/session.ts:729-748`, `981` | подтверждено |
| MyWork: `SessionEvent` не несёт payload | `packages/contracts/src/agent-runtime.ts:147-155`; нормализация `packages/controller/src/dsh-session.ts:755-773` | подтверждено |
| MyWork: в БД нет ни одной таблицы под события/сообщения | grep `CREATE TABLE` по `packages/**/*.ts` → 14 таблиц, ни одной session/event/message (список в §2.48) | подтверждено |
| MyWork: `SessionLink` не производится и не тестируется | grep `SessionLink` по `packages/**`, `tests/**` → ровно 1 совпадение — объявление `packages/contracts/src/board.ts:336` | подтверждено (пробел) |
| MyWork: нет ни одного `DELETE` для outbox/inbox_dedup/artifacts/audit | grep `DELETE FROM` по `packages/**/*.ts` → 3 совпадения, все в других таблицах (`execution/src/store.ts:259`, `lease/src/lease.ts:256`, `planner/src/store.ts:312`) | подтверждено (новое) |
| MyWork: артефакты лежат BLOB внутри SQLite и удалять их запрещено триггером | `packages/evidence/src/schema.ts:47-73` (`bytes BLOB NOT NULL`, `artifacts_no_delete`), `packages/evidence/src/artifacts.ts:165-180` | подтверждено (новое) |
| MyWork: сканер секретов покрывает только идентификаторы/типы, не тело артефакта и не память | `packages/evidence/src/metadata.ts:55-72`, `106-128`, `178-186`, `208-218`; вызовы — только `metadata.ts:111`, `213` + `packages/core/src/security.ts:245` | подтверждено (новое) |
| MyWork: оценка токенов — эвристика `ceil(chars/4)`, токенизатора нет | `packages/core/src/memory.ts:1647-1649`; `packages/core/src/skill.ts:982-983`; grep `tokenizer` → 0 совпадений | подтверждено (новое) |
| DSH: та же эвристика, но с накладными расходами на блок/роль | `packages/llm/token-meter/src/estimate.ts:12-19`, `42-63`, `88-91` | подтверждено (новое) |
| DSH: токен-метр различает cache read/write, MyWork — нет | `packages/llm/token-meter/src/projection.ts:14-17`, `turn-usage.ts:14-34`; `packages/contracts/src/budget.ts:194-199` | подтверждено (новое) |
| DSH: `follow` — единственный доступный MyWork способ чтения лога; `fork`/`page`/`projections`/`search` не обёрнуты | `packages/controller/src/dsh-session.ts:173-219`; grep `fork` по `packages/controller/src/*.ts` → 0; DSH: `packages/api/session-controller/src/index.ts:414` (`@Remote('fork')`), `468` (`page`), `491` (`projections`) | подтверждено |

## 2. Разбор по разделам документа

### §26. Fresh/fork teammate context и SessionWindow

**ВЕРДИКТ: ПОДТВЕРЖДЕНО с оговоркой о неполноте модели.** MyWork-сторона §26 реализована буквально, DSH-сторона описана документом верно, но путь fork в MyWork отсутствует целиком — утверждение «fork допустим только как explicit runtime strategy» сегодня не проверяемо, потому что стратегии нет.

Доказательства по MyWork:

- Строка «new Attempt → fresh execution context/session» исполнена: `buildFreshSessionPlan` и `FRESH_SESSION_PLAN_FIELDS` (`packages/contracts/src/session.ts:931-949`), политика — `DEFAULT_FRESH_SESSION_POLICY` (`packages/contracts/src/session.ts:108`).
- «retry/rework → new Attempt + fresh session» и «транскрипт не переносится» проверены тестами: `tests/session.test.mjs:555` («a retry creates a new attempt and a new session, and carries no transcript»), `565` («a rejection creates a new attempt and a new session»).
- «context rollover → same Attempt + new SessionWindow»: `tests/session.test.mjs:419`, `741` («two windows of one attempt are recognisable as the same attempt»), `574` («pressure is the one trigger that stays inside the attempt»).
- Запрет на «дефолтный fork» зашит и в контракт: `carriesTranscript: boolean` объявлен как «False always: §22.3 forbids carrying the whole transcript» — `packages/contracts/src/session.ts:944-945`, значение `carriesTranscript: false` в `packages/core/src/session.ts:981`.
- Единственная структура, которой вообще разрешено переходить между окнами, — `historyRefs`, и она валидируется как ссылка: `packages/core/src/session.ts:729-748` (`isReference`, лимит длины ссылки — `748`), тест `tests/session.test.mjs:699-712` (тело из 2189 символов отвергнуто, `dsh://session/session-1#turn-4` принято).

Доказательства по DSH:

- Различие fresh/fork — это флаг провайдера, а не режим сессии: `SubagentProvider.inheritsParentContext` (`packages/subagent/subagent/src/types.ts:344-354`), имя провайдера — `'spawn' | 'fork' | 'acp'` (`types.ts:345`).
- Fork материализуется в durable-заголовке сессии: `parentSession`, `isSeeded` (`seedLength`), `delegationDepth` (`packages/llm/llm-deepseek/src/../../session-log-deepseek/src/types.ts:14`; `packages/session-query/session-query-sqlite/src/schema.ts:113-125`; восстановление флага — `session-query-sqlite/src/index.ts:955`: `isSeeded: row.seed_length !== null`).
- Fork-seed не проходит как «своя» история в телеметрии: `packages/session/session-telemetry-otel/src/index.ts:57-59` (`if (event.seq < session.inheritedEventCount) return false`).
- Навигация по детям отделена от fork-наследования: `packages/subagent/subagent/src/projection-types.ts:70` («Direct children in parent catalog event order, **excluding fork-inherited facts**»).

Что это меняет для плана: §26 не требует правок. Требуется другое — зафиксировать в ADR, что MyWork-адаптер физически не умеет fork (см. §38: `DshSessionController` не объявляет `fork`), поэтому «fork как explicit runtime strategy после отдельного архитектурного решения» — не запрет, который кто-то может нарушить случайно, а отсутствующая функциональность. Пока это так, риск §26 («fork притащит незафиксированную историю») равен нулю, но и «reviewer/helper с inherited context» не существует.

### §37. Model Catalog требует ревизии

**ВЕРДИКТ: ПОДТВЕРЖДЕНО и УСИЛЕНО.** Документ прав в обеих половинах, но недооценивает проблему: на маршруте `deepseek` `resolveModelInfo` не является даже слабой пробой доступности — для модели, которой нет в каталоге, он возвращает синтезированную запись с окном контекста, равным дефолту деплоймента.

**(а) Что именно оборачивает `DshModelCatalog`.** Ровно четыре вещи, и ни одной больше:

1. `listProviders()` → `DshLlmRegistry.listProviders()` → `{id, name}` (`packages/controller/src/model-catalog.ts:63-65`, `94-96`).
2. `listModels(provider)` → `{provider, id, name, description?}` (`model-catalog.ts:67-72`, `103-111`).
3. `resolveModelInfo(provider, model)` → `{provider, id, name, context?}` (`model-catalog.ts:74-79`, `119-128`).
4. `resolved.context?.contextWindow` — единственное поле, которое читается из `context`; весь остальной `LlmResolvedModelInfo` (`defaultMaxTokens`, `reasoning`, `inputModalities`, `systemPromptUpdate`, `toolUpdate`) отбрасывается (`model-catalog.ts:120-127`).

Порт, в который это заворачивается, объявляет три метода и **ни одного метода доступности** (`packages/contracts/src/model-catalog.ts:113-129`). Отсутствие доступности компенсируется только на уровне провайдера: `readModelCatalog(port)` собирает `CatalogSnapshot` с `providers`/`models`/`outages` и не путает «провайдер не зарегистрирован» с «провайдер не ответил» (`packages/core/src/routing.ts:98-120`), а `scheduler` читает `catalog.outages` как основание для refusal `provider-outage` (`packages/core/src/scheduler.ts:190-196`). Это ровно та ось, которую документ называет нужной, — но она доведена только до `provider`, тогда как §37 говорит о `model`.

**(б) Есть ли в DSH отдельное состояние доступности/настройки аккаунта и pending selection.** Да, и их три независимых:

1. **Host-каталог**: `buildModelCatalog` (`packages/api/session-controller/src/catalog.ts:20-72`) возвращает `routableProviders` — список групп, у которых `listModels` ответил непустым списком (`catalog.ts:64-65`, `68`), и `failures` — изолированные отказы по провайдеру (`catalog.ts:53-62`, `70`). Пустая группа отбрасывается (`catalog.ts:65`), поэтому «провайдер ответил, но моделей нет» и «провайдер не ответил» различимы: первый исчезает из `routableProviders`, второй попадает в `failures`.
2. **Preflight выбора**: `modelAvailable(ctx, selection)` (`catalog.ts:80-90`) сначала проверяет регистрацию провайдера, затем `listModels` и наличие модели в нём; отказ `listModels` конвертируется в `RemoteError('session/model-unavailable')` (`catalog.ts:84-88`). Эту же функцию вызывает `selectModel` (`commands.ts:151-155`) и preflight отправки сообщения (`commands.ts:379-384`), то есть `selectModel` — действительно последний preflight authority, как и пишет документ (`§37`: «реальный `selectModel` остаётся последним preflight authority»).
3. **Account/credentials**: `hasProviderApiKey(ctx)` (`catalog.ts:97-116`) проверяет настроенность API-ключей **независимо** от доступности моделей (комментарий `catalog.ts:93`); состояние аккаунта — `AccountView.status: 'signed-out' | 'credential-stored'` (`packages/credentials/deepseek-account/src/types.ts:31-36`) с явной оговоркой, что «stored ≠ server validated» (`types.ts:31`); отказы аккаунтного маршрута приходят кодами `ACCOUNT_SIGN_IN_REQUIRED`, `ACCOUNT_TOKEN_INVALID`, `ACCOUNT_QUOTA_EXCEEDED_CODE` (`packages/llm/llm-deepseek-account/src/index.ts:21-33`).
4. **UI pending selection**: `ModelDirectoryState` (`packages/client/ui-model-selection/src/client/directory.ts:17-34`) держит `routable: boolean | null` («Whether the current selection is present in the available catalog; null while unresolved», `directory.ts:22-23`), `retainedEffort` («Saved effort caption retained when the selected model is unavailable», `directory.ts:20-21`), `pending: ModelSelection | null` («Selection submitted by the latest `select` until it settles», `directory.ts:30-31`) и `status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'` (`directory.ts:28-29`). Вычисление `routable` — `directory.ts:164-165`; при отсутствии выбора в каталоге UI сохраняет `current` и подпись effort, но не врёт про доступность (`directory.ts:150-160`).

**(в) Насколько это хуже, чем в документе.** `resolveModelInfo` непригоден как проба доступности на маршруте `deepseek`:

- Адаптер переопределяет `resolveModel` и синтезирует ответ: `override resolveModel(provider, model, _signal?) { return Promise.resolve(modelInfo(...)) }` (`packages/llm/llm-deepseek/src/adapter.ts:37-39`).
- `modelInfo` ищет модель в каталоге соединения и, **не найдя**, подставляет дефолтное окно: `const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow` (`packages/llm/llm-deepseek/src/model-info.ts:66-67`), при этом для некаталожной записи возвращается `{provider, id: model, name: model, inputModalities: ['text']}` (`model-info.ts:71-75`) — то есть успешный `LlmResolvedModelInfo` с именем, равным id.
- Дефолт не мал: `DEFAULT_CONTEXT_WINDOW = 1_000_000` (`packages/llm/llm-deepseek/src/defaults.ts:6`).
- `listModels` для этого же адаптера возвращает `discoverModels?.(provider) ?? []` (`adapter.ts:34-36`), а `discoverModels` в конфигурации опционален (`packages/llm/llm-deepseek/src/types.ts:99-101`).

Итог: у одного и того же провайдера `listModels` может вернуть `[]` (и провайдер выпадет из `routableProviders`), тогда как `resolveModelInfo(provider, 'произвольная-строка')` вернёт `contextWindow: 1_000_000`. Только `'UNKNOWN_MODEL'` (объявлен в `packages/contracts/src/model-catalog.ts:69` как «код DSH») действительно бросается — но, по факту grep, только в pi-ai-адаптере (`packages/llm/llm-pi-ai/src/adapter.ts:260`); в `llm-deepseek` он не встречается. Значит для маршрута `deepseek` различие «absent route» (комментарий `packages/contracts/src/model-catalog.ts:9-13`, обещающий разные решения §29) недостижимо: неизвестная модель выглядит как известная с окном 1M, и §39-отказ `context-window-undisclosed` (`packages/core/src/context.ts:223-225`) на этом маршруте практически не срабатывает.

**(г) Провайдер-нейтральный контракт `ModelAvailability`.** Документ даёт минимальный тип из четырёх полей (`§37`: provider, model, state, reason). Минимум корректен, но недостаточен: он не говорит, **наблюдалась ли** доступность и **чем** она установлена, поэтому `unknown` смешает «адаптер не умеет» и «спросили, но не ответили», а это ровно та ошибка, которую уже запрещает `CatalogSnapshot` (outage ≠ absent, `packages/core/src/model-catalog.ts:71-83`). Предлагаемая форма:

```ts
/** Как установлено состояние: наблюдение, отказ или отсутствие наблюдения. */
export type ModelAvailabilityEvidence =
  | 'listed'          // модель присутствовала в listModels этого провайдера
  | 'resolved'        // resolveModelInfo вернул запись, отличную от синтетической
  | 'unlisted'        // провайдер ответил, модели в listModels нет
  | 'provider-outage' // провайдер зарегистрирован, но не ответил
  | 'provider-absent' // провайдер не зарегистрирован
  | 'credential-missing' // аккаунт/ключ не настроены (DSH: hasProviderApiKey === false)
  | 'unobservable'    // у адаптера нет способа узнать

export interface ModelAvailability {
  readonly provider: string
  readonly model: string
  readonly state: 'available' | 'unavailable' | 'unknown'
  readonly evidence: ModelAvailabilityEvidence
  /** Причина для человека; обязательна при state !== 'available'. */
  readonly reason?: string
  /** Кто наблюдал: id адаптера, чтобы «unknown» не приписывался платформе. */
  readonly observedBy: string
  /** Наблюдение стареет; без этого cached 'available' станет ложью. */
  readonly observedAt: EpochMs
  /** Контекстное окно, если провайдер его публикует; отсутствие — не 0 и не дефолт. */
  readonly contextWindow?: number
}
```

Поведение при unknown, которое надо зафиксировать явно:

- `unknown` **не** блокирует маршрут, но **запрещает** считать его `available`: планировщик обязан трактовать `unknown` как «нужен preflight», а не как «ок».
- `unknown` **не** даёт бюджета: контекстный бюджет по-прежнему выводится только из опубликованного окна (`packages/core/src/context.ts:139-160`), а синтетический `contextWindow` из `model-info.ts:67` должен помечаться `evidence: 'resolved'` с `synthetic: true` — иначе MyWork построит бюджет на дефолте деплоймента.
- `unavailable` с `evidence: 'credential-missing'` — это то, что UI показывает как «нужно войти», а не как «модель сломана» (`packages/credentials/deepseek-account/src/types.ts:32-35`).
- `unavailable` с `evidence: 'provider-outage'` — это `CatalogOutage`, и он уже есть как данные (`packages/contracts/src/model-catalog.ts:78-83`).

**Где встраивается, без ломки существующих карточек:**

1. `packages/contracts/src/model-catalog.ts` — рядом с `ModelCatalogPort` добавить **отдельный** порт `ModelAvailabilityPort` (не метод в `ModelCatalogPort`): иначе адаптер, не умеющий readiness, обязан реализовать метод-заглушку, а `portContractVersion` (`packages/controller/src/model-catalog.ts:167`) начнёт врать о возможностях.
2. `packages/controller/src/model-catalog.ts` — `DshModelCatalog` получает второй адаптер `dsh-llm-availability` того же `llm`-сервиса; наличие метода определяется структурно, как уже сделано для `isLlmRegistry` (`model-catalog.ts:131-138`). При `listProviders` без `listModels`-ответа — `unknown`, не `unavailable`.
3. `packages/core/src/routing.ts` — `evaluateRoute` получает необязательный `availability` рядом с `catalog` (`routing.ts:202-285`), и новый `RouteRefusalReason` `model-not-routable` **только** для `state === 'unavailable'`; `unknown` идёт прежним путём и решается `selectModel`.
4. `packages/scheduler/src/service.ts` — `readRouteAvailability` (`packages/core/src/scheduler.ts:176`) продолжает работать по `CatalogSnapshot`; `ModelAvailability` добавляется как второй, более точный источник, а не как замена.
5. Extension point для карточки MW-013 (`routing-budget`): §29-триггер «provider outage» (`packages/contracts/src/routing.ts`) уже существует; добавляется симметричный `model-unavailable`, и он же становится основанием для `needs-attention` `adapter-unavailable-with-live-attempt` (`packages/contracts/src/board.ts:359-360`) без нового состояния.

### §38. Session adapter: conformance усилить

**ВЕРДИКТ: ПОДТВЕРЖДЕНО (список операций и `/permission`-seam — точно), ЧАСТИЧНО по conformance.** Все шесть операций на месте, seam реален и хрупок ровно так, как сказано; из перечисленных документом проверок отсутствуют две: «every supported policy» и «no live agent».

**(а) Точный список session-операций, которые использует MyWork-адаптер.** Шесть, объявленных структурно в `DshSessionController` (`packages/controller/src/dsh-session.ts:173-219`):

| Операция | Сигнатура в адаптере | Где вызывается |
|---|---|---|
| `create` | `{cwd?, sessionId?, agentPreset?}` → `{sessionId, agentPreset?}` (`dsh-session.ts:174-179`) | `#create` (`345-363`), `start` (`450-458`), `resume` (`475-484`) |
| `list` | `({cursor?}, signal)` → `{items: {sessionId, running}[]}` (`187-190`) | `#sessionExists` (`412-420`), `status` (`500-517`) |
| `selectModel` | `{sessionId, provider?, model, reasoningEffort?}` → `{selected}` (`191-197`) | `#assertScope` (`562-575`) |
| `prompt` | `{requestId, sessionId, mode: 'queue'\|'steer', content}` (`198-207`) | `#prompt` (`633-649`), режим всегда `'queue'` (`640`) |
| `cancel` | `{sessionId}` → `{accepted}` (`208-213`) | `cancel` (`326-342`), `stop` (`526-529`) |
| `follow` | `({address, maxMessages?}, signal)` → `AsyncIterable<frame>` (`214-218`) | `#events` (`378-408`) |

Дополнительно используются два не-session сервиса: `agents.get(sessionId)` (`dsh-session.ts:227-230`) и `commands.execute(agent, line, attachments, signal)` (`238-246`) — оба нужны только для `/permission`. Признак живости всех шести — `isSessionController` (`710-719`), который перечисляет ровно эти имена. Это соответствует DSH: `@Remote('create'|'list'|'selectModel'|'prompt'|'cancel')` и `@Remote({mode:'stream'}) follow` (`packages/api/session-controller/src/index.ts:272`, `251`, `282`, `425`, `456`, `479`).

**Чего адаптер не использует, хотя DSH это даёт**: `fork` (`index.ts:414`), `page` (`468`), `projections` (`491`), `search` (`262`), `attachment` (`436`), `rename` (`402`), `control` (`519`), `updateQueue` (`446`). Grep по `packages/controller/src/*.ts` на `fork` — 0 совпадений. Практическое следствие: §48 (переход к предыдущему `SessionWindow`) не имеет под собой ни `projections`, ни `parentSession`-навигации — только `sessionId`, который MyWork сохранил сам.

**(б) Реальность и хрупкость seam через `/permission`.** Seam реален: адаптер идёт в `commands.execute(agent, '/permission ' + permission, [], signal)` (`dsh-session.ts:611-613`), а DSH действительно проводит UI через ту же команду — `live.command('/permission ' + preset)` и проверку `result.value.matched` (`packages/client/ui-permission-presets/src/client/index.ts:126-130`).

Хрупкость видна прямо в коде адаптера, потому что он вынужден обслуживать четыре разных отказа:

1. Нет command runtime или agent registry → `AdapterError('unavailable')` (`dsh-session.ts:596-603`).
2. Нет живого агента для сессии → `AdapterError('unavailable')` с текстом «has no live agent» (`604-610`).
3. Команды нет вообще — платформа вернула `undefined` → `AdapterError('unavailable')` «this deployment has no `/permission` command» (`618-623`).
4. Команда есть и отказала → `execution.result.kind !== 'success'` → `AdapterError('unavailable')` с текстом команды (`624-629`).

Все четыре схлопываются в один код `unavailable`, то есть вызывающий не отличает «документ не тот» от «агент не поднят». Плюс команда исполняется **после** `selectModel` и **до** `prompt` (`#assertScope` вызывается в `start` на строке `459`, `#prompt` — на `460`), и отказ действительно останавливает запуск: тест `tests/runtime.test.mjs:440-464` проверяет, что после отказа `session.prompt` не вызван ни разу (`451`, `463`). Побочный эффект: permission-pin оставляет след в логе как событие `permission/preset` (`tests/runtime.test.mjs:596-603`), то есть права пиннятся через пользовательский путь и видны в истории — это и хорошая новость (аудит), и хрупкость (команда может изменить текст/формат и адаптер поймает это только как `unavailable`).

Ещё одна хрупкость, которой документ не называет: `resume` повторно вызывает `commands.execute` при каждом подъёме (`tests/runtime.test.mjs:495-500` — два вызова на два старта), потому что «session is re-scoped rather than assumed». Если команда в новой версии DSH станет недоступна для сессии, у которой уже есть pin, `resume` упадёт там, где раньше работал; тест это фиксирует как ожидаемое поведение, а не как риск.

**(в) Какие conformance-проверки отсутствуют.** Проверено чтением `tests/runtime.test.mjs` (717 строк, 17 тестов):

| Требование §38 | Есть? | Доказательство |
|---|---|---|
| every supported policy | **нет** — пиннится только `workspace-write` | `tests/runtime.test.mjs:44-48` (`SCOPE.permission = 'workspace-write'`); `read-only` и `danger-full-access` (`packages/contracts/src/security.ts:119-123`) не пиннятся ни в одном тесте |
| resumed session | частично — «after a process restart» через `detachAll` | `tests/runtime.test.mjs:466-500` |
| cold session | **нет** — нет теста, где сессия есть в `list`, но её нет в `agents` на момент `selectModel` | `agents.get` → ветка `604-610` не покрыта |
| missing command | есть | `tests/runtime.test.mjs:440-451` (`noPermissionCommand: true`) |
| no live agent | **нет** — `detachAll()` вызывается только в тестах про `stop` (`530`) и resume (`476`), и ни один не проверяет pin | `dsh-session.ts:604-610` — непокрытая ветка |
| refusal | есть | `tests/runtime.test.mjs:453-463` (`presets: ['read-only']` → `unknown preset`) |

Дополнительно не покрыто: `selectModel`, вернувший **другой** маршрут, чем просили (контракт обещает «the route the deployment *resolved*, not the one we asked for» — `dsh-session.ts:10-13`; тест `389-427` проверяет лишь happy path и отсутствие выдуманных дефолтов); `commands`/`agents` отсутствуют в профиле целиком (ветка `596-603`); `execution.result.kind === 'success'`, но без текста.

**(г) Конкретный список тестов, которые надо добавить** (в `tests/runtime.test.mjs`, не меняя фейк структурно):

1. `for (const policy of HARNESS_POLICIES)`: старт со `scope.permission = policy` → ровно один `commands.execute` с `/permission ${policy}` и успешный `prompt`.
2. `scope.permission = 'danger-full-access'` при фейке с `presets: ['read-only','workspace-write']` → `AdapterError('unavailable')`, `session.prompt` не вызван, `activeTurn` не начат.
3. cold/no-live-agent: `dsh.detachAll()` **после** `create` и до `start`/`resume` → отказ с текстом про «no live agent», и отдельная проверка, что `session.create` при этом уже случился и сессия durable.
4. missing command runtime: профиль без `commands` (`fakeDsh({ api: { controller, agents } })`) → отказ «serves no agent registry or command runtime»; и симметрично без `agents`.
5. `selectModel` вернул другой маршрут: фейк отвечает `selected: {provider: 'fallback', model: 'other'}` → возвращённый `handle.route` равен **ответу платформы**, а не запросу.
6. resumed/cold `selectModel`: сессия существует, но `selectModel` падает `session/not-found` → код `invalid-ref`, а не `unavailable` (проверка `mapDshFailure`, `dsh-session.ts:796-811`).
7. Отказ команды, у которой `result.kind === 'success'`, но `text` отсутствует → успешный pin (ветка `627`, где `?? 'the command refused'`).
8. Идемпотентность `#pinPermission`: повторный `resume` дважды пиннит одну политику и оба раза попадает в лог (`dsh-session.ts:491`).

### §39. Context Fabric сильнее prompt inheritance

**ВЕРДИКТ: ПОДТВЕРЖДЕНО ПОЛНОСТЬЮ.** Все восемь свойств реализованы, шесть из них — с прямыми тестами; ни одно не является декларацией в комментарии.

| Свойство §39 | Доказательство |
|---|---|
| L0/L1/L2 | `packages/contracts/src/context.ts:38-50` (`ContextLevel`, `CONTEXT_LEVELS`, `CONTEXT_FULL_LEVEL = 'L2'`); провайдер памяти объявляет все три уровня и запрещает discovery на L2 (`packages/core/src/memory.ts:1376-1383`, `1443-1457`) |
| mandatory context не обрезается | `packages/core/src/context.ts:249-274`: три отказа (`mandatory-expired`, `mandatory-tokens-unknown`, `mandatory-unverifiable`) и два переполнения (`mandatory-overflow`, `reserves-overflow`) — все возвращают `refused`, ни одна ветка не урезает элемент; тесты «mandatory context is never trimmed to fit: the run is refused instead», «mandatory context one token past its ceiling blocks admission» |
| отказ route при отсутствии measured context window | `packages/core/src/context.ts:222-225` (`context-window-undisclosed`) **и** независимо `packages/core/src/routing.ts:265-271` (`RouteRefusalReason: 'context-window-undisclosed'`); тесты «a route that published no window yields no budget and no admission», «a route that published nothing is refused rather than rolled over» (`tests/session.test.mjs:192`) |
| trust определяет instruction/data placement | `packages/contracts/src/context.ts:108-129` (две таблицы), `packages/core/src/context.ts:907-920` (`selectionOf`: instruction только при `isInstructionContextClass && isTrustedContextCandidate`), `downgraded` фиксируется в снапшоте (`560`, `710`) |
| frozen snapshot | `packages/core/src/context.ts:626-631` (`deepFreeze` + `registry.revisionOf(fingerprint)`), `1403-1406`; тест «a snapshot is frozen whole» |
| revisions/hashes | `packages/contracts/src/context.ts:650-677` (`ContextSnapshotRevisions`), `802-813` (`contextWindow`, `contentHashes`), реестр ревизий `packages/core/src/context.ts:91-118`; тест «re-materializing the same context keeps the revision, a changed one gets the next» |
| provenance | `packages/contracts/src/context.ts:181-205`; сборка `packages/core/src/context.ts:987-1025`; слияние provenance тела при L2-materialization (`592`, `1011-1025`); provenance — только ссылки, тело в неё не попадает ни на одном пути |
| explicit data fencing | `packages/core/src/context.ts:752-756` (`<<<mywork:data>>>` / `<<<mywork:end>>>`), `798-801` (fence вокруг data-секции), `1046-1048` (`neutralize` вставляет zero-width space в `<<<`), и нейтрализуются не только тело, но и `kind`, `source`, `uri`, `revision` (`796`, `800`, `1028-1035`); три теста: «untrusted content cannot close its own data fence», «provider-controlled metadata cannot close a data fence either», «untrusted mandatory context is shown as data, never as an instruction» |

Дополнительно, чего §39 не называет, но что тоже верно:

- §21.1 («провайдер не может ничего вставить в prompt») держится **по построению типа**: `assembleContextPrompt(snapshot)` принимает только `ContextSnapshot` и бросает `TypeError` на всё остальное (`packages/core/context.ts:775-778`); тест «prompt assembly accepts a snapshot and nothing else».
- Дедупликация uri сделана на уровне admission и работает даже против двойного списания в mandatory (`packages/core/context.ts:235-244`, тест «a duplicated mandatory claim does not double-charge the ceiling»).
- L2-тело, раздувшееся больше плана, **не** принимается молча: `materialized-overflow` с пересчётом и по assembly, и по bucket (`packages/core/src/context.ts:560-582`).

**Что это меняет.** Ничего в §39 править не нужно. Но §39 нельзя читать как «бюджет точен»: окно берётся у провайдера, а расход — из эвристики провайдера же (см. §4, D-33/D-34: `ceil(text.length / 4)` в `packages/core/src/memory.ts:1647-1649` и `packages/core/src/skill.ts:982-983`). Плюс, как показано в §37(в), на маршруте `deepseek` окно почти всегда «опубликовано» дефолтом деплоймента, поэтому отказ `context-window-undisclosed` — защита от адаптера без окна, а не от неизвестной модели.

### §40. Memory Fabric и Team scope

**ВЕРДИКТ: ПОДТВЕРЖДЕНО (scopes — точно, отождествления нет), но документ не замечает, что «explicit mapping» невозможно не из-за типов, а из-за отсутствия самого объекта.**

**(а) Scopes в коде.** Ровно те семь, что перечислены в документе, и ровно в том порядке: `packages/contracts/src/memory.ts:56-67` (`BaseMemoryScopeType = 'global' | 'team' | 'workspace' | 'role' | 'agent' | 'task' | 'attempt'`, `MEMORY_SCOPE_TYPES`). Четыре свойства, которые §40 обязан учитывать:

1. Scope — **данные, а не тип**: `MemoryScopeType = BaseMemoryScopeType | (string & {})` (`memory.ts:70`), `parent` — явная ссылка, а не выведенная иерархия (`memory.ts:72-87`), адрес — `type:id` без родителя (`memory.ts:92-102`).
2. Видимость — по цепочке родителей и точному совпадению: `memoryScopeWithin` (`memory.ts:118-133`) плюс `memoryScopeChain` (`104-116`). Global **не** подразумевается: его надо назвать (`memory.ts:124-126`, `GLOBAL_MEMORY_SCOPE` — `139`).
3. Мост в Context Fabric — одна функция в каждую сторону и больше нигде: `contextScopeOfMemory` / `memoryScopeOfContext` (`memory.ts:141-158`), переименование `type` ↔ `kind` ровно здесь.
4. Изоляция между workspace — это **свойство совпадения, а не запрет**: запись одного workspace не видна другому, если запрос не назвал её scope; но `resolve` по идентификатору памяти работает независимо от scope, и это задокументировано как намеренное (§52, ссылка через границу workspace) — `packages/core/src/memory.ts:1507-1511`.

**(б) Отсутствие отождествления TeamId MyWork и DSH Agent Teams.** Подтверждено двумя способами:

- `TeamId` — собственный брендированный id MyWork (`packages/contracts/src/team.ts:21`, `390-392`), используемый в `Team.id`; никакой связи с sessionId/roster DSH рядом нет.
- Grep по `packages/**/*.ts` и `tests/**/*.mjs` на `agent-teams|agentTeam|AgentTeams|teammate` — **0 совпадений**. То есть MyWork не просто «не отождествляет» TeamId с Agent Teams — он вообще не знает о существовании Agent Teams. Это лучше, чем type cast, но и означает, что «explicit mapping» пока не с чем строить: в MyWork нет идентификатора DSH-команды, а в DSH-команде нет MyWork-команды.

**(в) Что нужно для explicit mapping.** Минимум три вещи, и все три — новые, а не переименование:

1. **Поле-носитель, а не соглашение.** У `Team` (`packages/contracts/src/team.ts:390-402`) добавить `external?: { readonly kind: 'dsh-agent-team'; readonly rootSessionId: SessionId; readonly boundAt: EpochMs }` — по образцу того, как `ContextProvenanceRef` несёт `revision`/`contentHash` (`packages/contracts/src/context.ts:188-197`). Без поля mapping будет жить в чьей-то голове.
2. **Обратный индекс.** `MemoryScopeRef` уже позволяет `type: 'team', id: <TeamId>` (`packages/contracts/src/memory.ts:80-87`), но ничто не мешает записать туда `id: <rootSessionId>`; значит нужен **валидатор**: `team` scope обязан ссылаться на существующий `Team.id`, а не на произвольную строку. В `MemoryFabricPort` (`packages/contracts/src/memory.ts:1298`) сегодня такого валидатора нет — есть только маршрутизация по scope (`memoryRouteMatches`, `883-890`).
3. **Явное направление перевода.** Правило должно быть «MyWork TeamId — authority, DSH rootSessionId — атрибут», потому что обратное направление (sessionId → TeamId) неоднозначно: у одной DSH-команды может не быть MyWork-команды вовсе, а сессия живёт дольше попытки (`packages/contracts/src/board.ts:336-347` — `SessionLink.active`).

**Практический совет, которого нет в документе:** не вводить `TeamId`-mapping в память вообще, пока не появится сценарий, где память команды должна читаться другим деплойментом. Сегодня `team`-scope в MyWork не используется ни одним провайдером: `memory-native` объявляет все семь семейств, но пишет в тот scope, который назвал вызывающий (`packages/memory-native/src/native.ts:87-88`, `157-184`), а `memory-beads` явно не занимается lifecycle (`packages/beads-adapter/src/memory.ts` — нет ни одного `archiv`/`prune`/`delete`). Mapping без потребителя — лишний контракт.

**Сверх §40: у Memory Fabric нет ни одного потребителя в рантайме.** `createMemoryFabric` и `createMemoryContextProvider` определены в `packages/core/src/memory.ts:170`, `1368` и **только** реэкспортированы (`packages/core/src/index.ts:408-409`); `createNativeMemoryProvider` — по той же схеме (`packages/memory-native/src/native.ts:84`, `packages/memory-native/src/index.ts:21`). Единственный плагин, который что-то регистрирует, — beads: он кладёт **провайдера** в `myworkAdapters` и на этом останавливается (`packages/beads-adapter/src/memory-plugin.ts:93-122`), ни разу не вызвав `createMemoryFabric`. Контроллер монтирует ровно две вещи — каталог моделей и DSH-рантайм (`packages/controller/src/index.ts:123`, `127`). Следствие: семь scopes, trust-классы, lifecycle и dedup существуют как библиотека и как тесты (`tests/memory.test.mjs` — 68 кейсов, `tests/memory-beads.test.mjs` — 17), но в работающем профиле ни одна запись памяти не проходит через них. §40 описывает **готовую модель, а не работающий контур**; это самая существенная поправка к чтению §40 (и §39, см. ниже).

### §41. DSH request-extension size limit

**ВЕРДИКТ: ПОДТВЕРЖДЕНО, формулировка «недавний fix» — точна; перечень транспортов в MyWork пуст.** Лимит есть ровно там, где описано, применяется он на одном конкретном расширении, а вывод документа («token budget надо дополнить byte/serialization budgets») подтверждается тем, что в MyWork таких бюджетов нет ни одного.

**(а) Где в DSH лимит request extension.** Механизм двухслойный:

1. **Слой контракта адаптера** — `prepareRequestExtensions` больше не роняет запрос: если объединённый payload не сериализуется, отправляется базовый запрос, а имена пропущенных полей уходят в `onOmitted` (`packages/llm/llm-deepseek/src/request-extensions.ts:36-44`); коллизия поля расширения с базовым запросом остаётся жёсткой ошибкой `REQUEST_EXTENSION` (`31-35`). Приёмка (`extensions.accept()`) вызывается только после успешного HTTP-ответа и обёрнута в тот же код (`45-54`), а хук `onExtensionsOmitted` подключён в `packages/llm/llm-deepseek/src/adapter.ts:106-112`.
2. **Слой конкретного контрибьютора** — 8 MiB на одно поле: `maxBytes: z.number().step(1).min(1).default(8 * 1024 * 1024)` (`packages/session/session-log-deepseek/src/index.ts:53`), учёт в UTF-8 байтах через `Buffer.byteLength` (`index.ts:118-134`), жадный набор самого длинного префикса, который влезает (`index.ts:203-213`), и явное сообщение о том, что аплоад стоит на месте до следующего запроса (`index.ts:220-224`).

Коммит, которым это пришло, — `193f9ce413` «fix(llm): keep oversized request extensions from blocking model requests (#5168)», 2026-09-24; проверено, что он **предок** базовой ревизии документа: `git merge-base --is-ancestor 193f9ce413 477b4f420553e8a52c2fbccc464d7561b239c443` → exit 0. То есть §41 описывает состояние, актуальное и на текущем HEAD, а не «ожидаемый фикс».

**(б) Какие ещё транспортные лимиты есть.**

| Транспорт | Лимит | Доказательство |
|---|---|---|
| optional request extension (поле контрибьютора) | 8 MiB UTF-8 на поле, конфигурируемо; остаток переносится на следующий запрос | `packages/session/session-log-deepseek/src/index.ts:39-53`, `203-224` |
| request extension как класс | нет лимита на суммарный payload; при несериализуемости — деградация до базового запроса с логированием | `packages/llm/llm-deepseek/src/request-extensions.ts:36-44` |
| вложения: одна картинка / сообщение / пиксели / размерность | 20 MiB (`DEFAULT_MAX_IMAGE_BYTES`), 20 штук (`DEFAULT_MAX_IMAGES_PER_MESSAGE`), 200 MiB суммарно (`DEFAULT_MAX_MESSAGE_IMAGE_BYTES`), 64 Мпикс, 8192 px | `packages/attachment/attachment-local/src/index.ts:34-42`, `150-158` |
| вложения: нормализованное изображение | 2048×2048 пикс, 4 MiB (`DEFAULT_NORMALIZED_IMAGE_MAX_BYTES`), параллелизм 8 | `packages/attachment/attachment-local/src/index.ts:50-58` |
| изображения внутри одного запроса к модели | 128 MiB файловых байт, 20 MiB inline base64, до 600 изображений | `packages/llm/llm-deepseek/src/config.ts:33-38`; `packages/llm/llm-deepseek/src/request-pricing.ts:20` |
| загрузка файла в Files API | 128 MiB | `packages/llm/llm-deepseek/src/files-api.ts:14` |
| tool result | **не транспортный лимит**: детерминированное прунинг-правило компакции 8192 симв. порог, 4096 head, 1024 tail | `packages/compaction/compaction-tool-result-pruner/src/config.ts:7-14`, `36-65` |
| текст промпта | лимита нет — grep по `packages/api/**/*.ts` на `PROMPT_MAX\|MAX_PROMPT\|text.length >` даёт только несвязанные совпадения (единственный найденный `length`-лимит в API — 240 code points на поисковый сниппет, `packages/api/session-controller/src/types.ts:199-200`) | проверено grep |
| строка целиком | ограничение движка (V8), не политика | мотивировка коммита `193f9ce413` |

**(в) Какие byte/serialization-бюджеты нужны MyWork.** Сегодня их нет ни одного:

- В `packages/contracts/src/budget.ts` все восемь лимитов — счётчики, токены или стоимость (`BUDGET_LIMIT_NAMES`: `maxTokensPerTask`, `maxCostPerTask`, `maxAttempts`, `maxReviewLoops`, `maxPlannerCalls`, `maxOptimizerCostPerDay`, `workspaceDailyBudget`, `providerDailyBudget` — `budget.ts:59-87`); байтового измерения нет.
- Единственное байтовое поле — `ArtifactMetadata.size`, и оно объявлено как «so a reader can bound what it is about to load» (`packages/contracts/src/artifact.ts:112`), то есть граница — обязанность читателя; писатель не ограничен ничем (`packages/evidence/src/artifacts.ts:132-181` — размер берётся из `bytes.byteLength`, без порога).
- Контекстный бюджет чисто токенный (`packages/contracts/src/context.ts:465-482`), поэтому «большой, но дешёвый по токенам» item (например, длинная строка без пробелов) пройдёт admission и упрётся уже в транспорт.
- Request extension как понятие в MyWork отсутствует: адаптер отправляет один `content: [{type:'text', text: prompt}]` (`packages/controller/src/dsh-session.ts:636-644`).

Предлагаемый минимальный набор (все — новые поля существующих контрактов, ни одна карточка не ломается):

1. `ContextBudget` → `readonly bytes: { readonly assembly: number; readonly perItem: number }` рядом с токенными (`packages/contracts/src/context.ts:465-482`); источник — конфигурация деплоймента, а не каталог моделей.
2. `ContextCandidate`/`ContextMaterialized` → `readonly byteLength?: number` рядом с `estimatedTokens` (`packages/contracts/src/context.ts:245`, `356`), с тем же правилом «absent ≠ 0», что уже применено к токенам.
3. `ContextRefusalReason` → `'item-too-large'` и `'assembly-bytes-exceeded'` (`packages/contracts/src/context.ts:602-631`) с кодами `CONTEXT_BUDGET_EXCEEDED`.
4. `AgentStartRequest` → `readonly promptByteLimit?: number` (`packages/contracts/src/agent-runtime.ts:66-76`; сегодня поле `prompt: string` — «Task text handed to the agent», `agent-runtime.ts:72-73`, и уходит в платформу как единственный текстовый блок, `packages/controller/src/dsh-session.ts:636-644`), чтобы отказ происходил **до** `session.prompt`, а не как `session/agent-busy` из платформы.
5. `ArtifactPutRequest` → `readonly maxBytes?: number` и отказ `artifact-too-large` (`packages/evidence/src/metadata.ts:241-275`, `packages/evidence/src/errors.ts:13-32`); сегодня `EvidenceErrorCode` такой причины не имеет.
6. Сериализационный бюджет снапшота: `canonicalForm(built)` уже строит каноническую форму (`packages/core/src/context.ts:622`) — считать её длину и записывать в снапшот как `fingerprintBytes` (одна строка, ноль новых абстракций).

### §48. Session navigation

**ВЕРДИКТ: ЧАСТИЧНО.** Запрет на копирование транскрипта обеспечен сильно (три независимых механизма), а навигация — нет: `SessionLink` объявлен, но не производится, не потребляется и не тестируется; переход к предыдущему `SessionWindow` не на чем построить, потому что MyWork не сохраняет даже список окон.

**(а) Запрет на копирование транскрипта — механизмов три, все в коде:**

1. **Тип не имеет поля для тела.** `CheckpointCapsule.historyRefs: readonly string[]` — «References to the history behind the checkpoint, **never the history itself**» (`packages/contracts/src/session.ts:425-426`); `carriesTranscript: boolean` объявлен как всегда `false` («§22.3 forbids carrying the whole transcript», `session.ts:944-945`) и выставляется `carriesTranscript: false` (`packages/core/src/session.ts:981`).
2. **Валидация отвергает тело.** `isReference` пропускает только `scheme://…` без пробелов и с ограниченной длиной (`packages/core/src/session.ts:736-748`); тесты прямо это фиксируют: 2189 символов тела, пустая строка, `'totally not a uri'` и `'session-1'` отвергнуты, `dsh://session/session-1#turn-4`, `artifact://art-1`, `issue://MW-020` приняты (`tests/session.test.mjs:699-712`), плюс отдельная проверка отсутствия полей `transcript` и `messages` (`tests/session.test.mjs:714-722`).
3. **Адаптер физически не читает payload.** `SessionEvent` — это `{seq, type, time}` и больше ничего (`packages/contracts/src/agent-runtime.ts:147-155`), а `pageOf` собирает страницу, беря из платформенной записи ровно `record.event.seq/type/time` (`packages/controller/src/dsh-session.ts:755-773`). Плюс в `events` намеренно не читаются `header` и `cursor` кадра (`dsh-session.ts:747-751`), то есть даже идентичность сессии не протекает через этот путь.

Отягчающая проверка: в MyWork **нет ни одной таблицы** под события или сообщения. Полный список `CREATE TABLE` по `packages/**/*.ts` — 16 таблиц: `artifacts`, `audit_events` (`packages/evidence/src/schema.ts:47`, `75`), `claim_intent`, `claim_step`, `attempt`, `task_fence` (`packages/execution/src/schema.ts:88`, `111`, `120`, `139`), `controller_lease` (`packages/lease/src/schema.ts:48`), `plan_revision`, `plan_mutation`, `plan_mutation_step`, `admission_hold`, `work_proposal`, `blocker_gate_decision` (`packages/planner/src/schema.ts:60`, `66`, `87`, `100`, `112`, `130`), `outbox`, `inbox_dedup`, `schema_migrations` (`packages/storage/src/migrations.ts:54`, `72`, `98`). Транскрипту физически некуда попасть.

Отягчающая деталь со стороны DSH: **сам DSH** дублирует текст сессий в производный SQLite-индекс — FTS5-таблица `persisted_docs` с полем `text` (`packages/session-query/session-query-sqlite/src/schema.ts:126-137`) и temp-таблица `live_docs` (`141-169`). Индекс объявлен производным и одноразовым (`schema.ts:1`, версия 8 — `8`, сброс схемы при несовпадении — `64-67`, `96-101`), но это тот самый «второй экземпляр транскрипта на диске», о котором §48 не говорит: запрет адресован MyWork DB, а не машине.

**(б) `SessionLink` — мёртвый контракт.** Объявлен один раз (`packages/contracts/src/board.ts:336-347`, поля `sessionId`, `attemptId?`, `roleId?`, `active`, `startedAt`) с правильным комментарием «reference the board renders, never a copy» (`board.ts:330-335`). Grep по `packages/**` и `tests/**` даёт **ровно одно** совпадение — само объявление. Следствия:

- `BoardCard` (§49) не может отрендерить ссылку на сессию: producer'а нет.
- Тест «транскрипт не копируется» проверяет капсулу чекпоинта, а не board-проекцию; то есть §48 выполнен в layer'е SessionWindow и не проверен в layer'е Board.
- Навигация «к предыдущей SessionWindow» невозможна даже в принципе: `SessionWindow` знает `ordinal` и `attemptId` (`packages/contracts/src/session.ts:145-178`), но ни одна таблица/структура не хранит список окон попытки — таблица `attempt` содержит `revisions` (`packages/contracts/src/attempt.ts:119-120`), а не окна.

**(в) Что в DSH реально есть для навигации** (и что MyWork не использует):

- `parentSession` и `delegationDepth` — durable поля заголовка сессии (`packages/session-query/session-query-sqlite/src/schema.ts:113-125`), доступные как фильтр поиска (`session-query-sqlite/src/query.ts:160`).
- `subagentCatalog` — проекция «direct children in parent catalog event order, excluding fork-inherited facts» (`packages/subagent/subagent/src/projection-types.ts:68-71`), плюс `subagentTiming` и `subagent` identity с предохранителем от подмены fork-seed'ом (`projection-types.ts:50-57`, `74-83`).
- `isSeeded: row.seed_length !== null` (`session-query-sqlite/src/index.ts:955`) — то, чем UI отличает fork от собственной истории.
- Трассировка вверх по `parentSession` (`packages/session-query/session-query/src/tracing.ts:135-155`).

Ни одно из этого MyWork не читает: `DshSessionController` не объявляет ни `projections`, ни `search`, ни `fork` (§38(а)). Значит §48 требует не «UI-кнопки», а одного нового метода адаптера.

## Расхождения документа с кодом (сводно, только §26–§48)

| № | Утверждение документа | Что в коде | Класс |
|---|---|---|---|
| 1 | §37: «`DshModelCatalog` wraps listProviders/listModels/resolveModelInfo + contextWindow… но не различает listed и routable» | Верно, но сильнее: `resolveModelInfo` на маршруте `deepseek` **не падает** на некаталожной модели и возвращает `contextWindow: 1_000_000` из дефолта деплоймента (`packages/llm/llm-deepseek/src/model-info.ts:66-67`, `defaults.ts:6`) | недооценка |
| 2 | §37: «в DSH есть отдельное отслеживание availability/account setup» | Верно и точнее, чем сказано: три независимых состояния — Host `routableProviders`/`failures` (`catalog.ts:64-70`), preflight `modelAvailable` (`catalog.ts:80-90`), account `signed-out`/`credential-stored` (`packages/credentials/deepseek-account/src/types.ts:32-35`), плюс UI `routable: boolean \| null` (`directory.ts:22-23`) | подтверждение с уточнением |
| 3 | §38: «permission pin идёт через команду `/permission`» | Верно; но conformance отсутствует для 2 из 3 политик и для ветки «no live agent» (`tests/runtime.test.mjs:44-48`; ветка `packages/controller/src/dsh-session.ts:604-610` не покрыта) | подтверждение с пробелом |
| 4 | §39: «Context Fabric уже сильнее Agent Teams prompt inheritance» | Архитектурно верно, **но не подключено**: `materializeContextSnapshot`/`assembleContextPrompt` не вызываются нигде, кроме тестов (grep по `packages/**/*.ts` — только определения и реэкспорты `packages/core/src/index.ts:357-367`); контроллер монтирует лишь каталог и рантайм (`packages/controller/src/index.ts:123`, `127`) | недоговорка (главная) |
| 5 | §39: «route без measured context window → refusal» | Реализовано дважды (`packages/core/src/context.ts:223-225`, `packages/core/src/routing.ts:265-271`), но на `deepseek`-маршруте почти недостижимо из-за дефолтного окна (§37(в)) | подтверждение с оговоркой |
| 6 | §40: «Memory уже поддерживает scopes» | Верно как библиотека и как 85 тестов; в рантайме не подключено: `createMemoryFabric` не вызывается нигде, beads регистрирует только провайдера (`packages/beads-adapter/src/memory-plugin.ts:113-122`) | недоговорка |
| 7 | §40: «MyWork TeamId нельзя отождествлять с DSH Agent Teams TeamId» | Верно; отождествления нет вообще (0 совпадений по `agent-teams\|teammate`), но и объекта для mapping нет | подтверждение |
| 8 | §41: «недавний DSH fix ограничивает размер optional request extension» | Верно, 8 MiB на поле `dsh_session_log` (`packages/session/session-log-deepseek/src/index.ts:53`); коммит `193f9ce413` — предок базовой ревизии документа (exit 0) | подтверждение |
| 9 | §48: «Board уже имеет `SessionLink`» | `SessionLink` **объявлен** (`packages/contracts/src/board.ts:336`), но не производится, не потребляется и не тестируется — 1 совпадение на весь репозиторий | опровержение формулировки «имеет» |
| 10 | §48: «DSH предоставляет устойчивые session references/subagent navigation primitives» | Верно (`parentSession`, `delegationDepth`, `subagentCatalog`, `isSeeded`), но MyWork их не использует: ни `projections`, ни `search`, ни `fork` не обёрнуты (`packages/controller/src/dsh-session.ts:173-219`) | подтверждение с пробелом |

## 3. Правки к плану MyWork

Правки сформулированы так, чтобы их можно было применить к существующим карточкам без переписывания плана.

**MW-013 (routing-budget) — добавить два пункта приёмки.**

1. `resolveModelInfo` не является пробой доступности: приёмка «маршрут выбран только из `listModels`» обязана быть проверена тестом, а не комментарием. Тест: подставить порт, который отвечает на `resolveModelInfo` успешно, но `listModels` возвращает `[]` либо бросает — планировщик обязан выдать `provider-outage`/`model-not-routable`, а не выбрать маршрут.
2. Новый контракт `ModelAvailability` + `ModelAvailabilityPort` (§37(г)) с правилом «`unknown` не даёт бюджета»: тест «a route observed as unknown publishes no synthetic context window» — прямой ответ на `model-info.ts:66-67`.

**MW-015 (dsh-runtime) — усилить conformance §38 (8 тестов из §38(г)) и добавить метод навигации.**

1. Восемь тестов из §38(г) — в `tests/runtime.test.mjs`; фейк уже поддерживает `presets`, `noPermissionCommand`, `detachAll`, поэтому новых абстракций не требуется.
2. Развести коды отказов permission-pin: сейчас все четыре ветки (`dsh-session.ts:596-610`, `618-629`) дают `unavailable`. Нужны как минимум `unavailable` + `detail.kind` (`no-command-runtime`, `no-live-agent`, `no-command`, `refused`) — иначе §6.2 board-состояние `needs-attention` `adapter-unavailable-with-live-attempt` (`packages/contracts/src/board.ts:359-360`) не отличит «профиль не тот» от «агент упал».
3. Добавить в `DshSessionController` минимальный метод навигации (для §48): `projections({sessionId})` → `{parentSessionId?, delegationDepth?, seeded: boolean, childSessionIds: readonly string[]}` — по образцу `@Remote('projections')` (`packages/api/session-controller/src/index.ts:490-491`) и с `isSeeded` из `seed_length` (`session-query-sqlite/src/index.ts:955`). Без него §48 — только UI-работа над пустым источником.

**MW-016 (context-fabric) — приоритет №1: подключить fabric к пути попытки.**

Сейчас контракт есть, реализации есть, тестов 57, а потребителя нет. Минимальная правка: в `packages/execution/src/service.ts` (путь admission→attempt) вызвать `discoverContext` → `materializeContextSnapshot` → `assembleContextPrompt` и передать результат в `AgentStartRequest.prompt` вместо сегодняшнего свободного текста (`packages/controller/src/dsh-session.ts:633-649`). Приёмка: тест, в котором попытка без снапшота не может быть запущена (сегодня это не так), и тест «item, которого нет в снапшоте, не попадает в prompt» — на уровне попытки, а не на уровне `assembleContextPrompt`.

**MW-018/MW-019 (native/external memory) — сделать fabric обязательным звеном.**

Приёмка «провайдер памяти зарегистрирован» недостаточна: нужна приёмка «запись проходит через `createMemoryFabric` и отказывается без актора `memory-provider`» (`packages/core/src/memory.ts:163-166`, `packages/core/src/authority.ts` — `assertWriteAuthority`). Сегодня beads-плагин регистрирует порт напрямую (`memory-plugin.ts:113-122`), то есть §8-мандат `memory.semantic` не применяется.

**MW-020 (sessions) — три правки.**

1. `SessionLink` либо наполнить (producer в board-проекции + тест «карточка ссылается на сессию, а не на её содержимое»), либо снять из контракта. Мёртвый контракт в `board.ts` — риск, что §49-агрегат будет спроектирован вокруг несуществующего поля.
2. Зафиксировать `ordinal` окон попытки в durable-структуре (новая таблица или поле `attempt`), иначе §48 «перейти к предыдущей SessionWindow» нереализуем.
3. Байтовые бюджеты из §41(в) — сюда же, потому что именно этот поток владеет checkpoint/rollover и решает, что уходит в артефакт.

**MW-021…MW-026 (execution) — группа, которой нужен новый предикат на секреты.** `assertNoSecretMaterial` вызывается только для идентификаторов и media type (`packages/evidence/src/metadata.ts:111`, `213`) и для credential-ref (`packages/core/src/security.ts:245`). Тело артефакта (`packages/evidence/src/artifacts.ts:179`), `statement` памяти и тела контекстных items не сканируются ничем. Нужен один предикат «before persist / before prompt» с тем же списком шаблонов (`metadata.ts:55-72`) — и решение, что делать при совпадении: отказ (как сейчас у `artifactId`) или редакция.

## 4. Новое, чего не было в документе и в плане

Нумерация совпадает с CLAIMS (`D-NN`), усилие S/M/L, влияние и риск — по трёхбалльной шкале.

**N1 (D-27, S, влияние высокое, риск низкий). `resolveModelInfo` не проверяет доступность, а `listModels` может быть пуст по конфигурации.** `llm-deepseek` синтезирует запись и подставляет `defaultContextWindow = 1_000_000` (`packages/llm/llm-deepseek/src/model-info.ts:66-67`, `defaults.ts:6`), а `listModels` возвращает `discoverModels?.(provider) ?? []` (`adapter.ts:34-36`) при опциональном `discoverModels` (`types.ts:99-101`). Значит на этом маршруте «модель есть в каталоге» и «модель маршрутизируема» — не просто разные вещи, а **разные источники**: одна и та же модель может отсутствовать в `listModels` и успешно резолвиться. Правка MW-013 обязана опираться только на `listModels` и на `selectModel`.

**N2 (D-28, S, влияние высокое, риск низкий). Отказ `context-window-undisclosed` защищает не от того.** Он срабатывает, когда адаптер не опубликовал окно; на `deepseek` адаптер публикует дефолт деплоймента для любой строки. Значит §39-свойство «route без measured context window → refusal» технически выполнено, а по существу — нет: «measured» подменяется «default». Нужен третий признак в `ResolvedCatalogModel`: `contextWindowSource: 'provider' | 'deployment-default'` (`packages/contracts/src/model-catalog.ts:45-58`), и политика, которая для `deployment-default` считает бюджет, но помечает снапшот.

**N3 (D-33, S, влияние среднее, риск средний). Оценка токенов — `ceil(chars/4)` без структурных накладных.** `packages/core/src/memory.ts:1647-1649`, `packages/core/src/skill.ts:982-983`; токенизатора в зависимостях нет (grep `tokenizer` → 0). DSH использует ту же плотность, но добавляет `BLOCK_OVERHEAD = 4` на блок и `ROLE_OVERHEAD = 4` на сообщение (`packages/llm/token-meter/src/estimate.ts:12-19`, `88-91`) и ценит схему инструментов отдельно (`99-102`). MyWork считает только текст, то есть систематически **недооценивает** относительно метра самого DSH; для CJK и кода ошибка идёт в другую сторону (1 символ ≈ 1 токен). Практическое следствие: безопасный запас `safetyReserve = 0.18` (`packages/contracts/src/context.ts:438`) может быть съеден ошибкой оценки на длинном контексте.

**N4 (D-29, M, влияние среднее, риск низкий). Prompt caching не учитывается в стоимости.** `ModelCallTokens` — только `input`/`output` (`packages/contracts/src/budget.ts:194-199`), цена — `inputPerToken`/`outputPerToken` (`budget.ts:207-216`, расчёт `packages/core/src/budget.ts:181-188`). При этом DSH различает `cacheReadTokens`/`cacheWriteTokens` (`packages/llm/token-meter/src/projection.ts:14-17`, `turn-usage.ts:14-34`) и имеет два модельных механизма ровно под кеш-стабильность: `systemPromptUpdate: 'in-history'` и `toolUpdate: 'addition-only'` (`packages/llm/llm/src/types.ts:390-407`). Итог: MyWork переоценивает дешёвое (попадание в кеш) и недооценивает дорогое (запись кеша) одинаково — обе величины идут по одной ставке. Нужны `cacheRead`/`cacheWrite` в `ModelCallTokens` и три ставки в `ModelRate`, иначе `maxCostPerTask` (`budget.ts:118-120`) — не бюджет, а оценка.

**N5 (D-31, M, влияние высокое, риск средний). Ретенция необратима по построению.** `artifacts` хранит тело как `bytes BLOB NOT NULL` внутри SQLite (`packages/evidence/src/schema.ts:60`), а `artifact_no_delete`/`artifact_no_update` и `artifacts_no_replace` запрещают удаление и замену на уровне БД (`schema.ts:65-73`, `115-119`); то же для `audit_events` (`75-100`, `121-125`). Ни `DELETE`, ни `VACUUM`, ни retention-политики в MyWork нет: grep `DELETE FROM` по всем `packages/**/*.ts` даёт три совпадения, и все — про промежуточные шаги саг (`packages/execution/src/store.ts:259`, `packages/lease/src/lease.ts:256`, `packages/planner/src/store.ts:312`). Плюс `outbox` копит доставленные события с полем `payload TEXT NOT NULL` навсегда (`packages/storage/src/migrations.ts:54-70`; поиск — `packages/storage/src/outbox.ts:207`, ни одного удаления), а `inbox_dedup` — все пары `(consumer, event_id)` (`migrations.ts:71-78`). Это не «утечка», а спроектированная монотонность: единственный способ уменьшить БД — снять триггеры вручную. Нужна явная позиция: либо архивация наружу (артефакт → файл, в БД только метаданные), либо `retention` с внешним «evidence export» до удаления — но не молчание.

**N6 (D-32, S, влияние высокое, риск низкий). Сканер секретов покрывает 3 из 6 мест, где секрет может приземлиться.** Шаблоны хорошие — PEM, AWS, GitHub, `sk-`, Stripe, Slack, JWT, `credential-assignment` (`packages/evidence/src/metadata.ts:55-72`), и тесты на них есть (`tests/evidence.test.mjs:292-297`). Но проверяются только `artifactId`-подобные идентификаторы (`metadata.ts:106-128`), `contentType` (`208-218`) и credential-ref (`packages/core/src/security.ts:245`). Не проверяются: тело артефакта (`packages/evidence/src/artifacts.ts:179` вставляет `valid.bytes` без сканирования), `statement` памяти (`packages/core/src/memory.ts:1036-1089` — `normalizeProposal` требует только непустую строку), текст контекстного item (`packages/core/src/context.ts:1100-1152` — `requireCandidate` про trust/level/revision, не про содержимое). При этом PII не покрыт ни одним шаблоном даже там, где сканер работает: `credential-assignment` ловит `token=…`, но не e-mail/телефон/имя. Нужен один общий предикат и решение `refuse` vs `redact`; сегодня поведение заявлено в комментарии («guard, not a classification», `metadata.ts:48-54`), но не распространено на содержимое.

**N7 (D-30, S, влияние среднее, риск средний). `memory-native` теряет всё при рестарте, а revisions памяти в снапшоте остаются числом.** Провайдер держит `Map` (`packages/memory-native/src/native.ts:92`) и прямо объявлен «not durable» (`native.ts:11-16`), но снапшот фиксирует ревизию namespace памяти как обязательный элемент frozen-identity (`packages/contracts/src/context.ts:664-665` — `readonly memory?: Revision`). После перезапуска процесса записи исчезают, а реестр ревизий пересоздаётся с 1 (`packages/core/src/memory.ts:111-124`, `Map` в процессе), поэтому зафиксированная в снапшоте ревизия указывает на namespace, которого больше нет. «Висячей» ссылки при этом не возникает (капсула чекпоинта указывает на `dsh://session/...`, а не на память), но повторная материализация того же uri уже невозможна, и `verifyContextSnapshot` честно скажет `missing` (`packages/core/src/context.ts:696-698`). Это корректное поведение при неверной конфигурации: деплоймент с включённой памятью обязан привязывать durable-провайдера, и это надо проверять при монтировании, а не обнаруживать дрейфом на следующем запуске.

**N8 (D-34, S, влияние среднее, риск низкий). Ревизии снапшота и памяти не durable — reproducibility держится на fingerprint, а не на номере.** `createContextSnapshotRevisionRegistry` нумерует от 1 по `Map<fingerprint, Revision>` (`packages/core/src/context.ts:105-118`), `createMemoryRevisionRegistry` — так же (`packages/core/src/memory.ts:111-124`); обе структуры живут в процессе, и ни одна из 16 таблиц не хранит контекстные ревизии (единственная `plan_revision` — `packages/planner/src/schema.ts:60` — про план). Значит «revisions/hashes» из §39 воспроизводимы только через `fingerprint` (каноническая форма, `packages/core/src/context.ts:622`), а `revision` — это порядковый номер внутри процесса: после рестарта та же попытка получит другой номер при том же fingerprint. Для аудита это надо сказать вслух: сверять надо `fingerprint`, а `revision` годится только внутри одной жизни процесса. Плюс **сам снапшот нигде не сохраняется** — `ContextSnapshot` встречается только в `packages/contracts/src/context.ts`, `packages/core/src/context.ts`, реэкспорте `packages/core/src/index.ts` и тестах; §21.7 называет его «critical audit artifact», но audit-артефакт, живущий в памяти одного процесса, аудитом не является.

**N9 (D-35, S, влияние низкое, риск низкий). Диагностика памяти ограничена, деградация — по-маршрутная, и это сделано хорошо.** Лог диагностик обрезается до `diagnosticLimit` (`packages/core/src/memory.ts:224`: `while (log.length > policy.diagnosticLimit) log.shift()`), отказ обязательного маршрута отличается от деградации опционального (`memory.ts:659-691` — отказ только при `!group.optional`), а health-проба идемпотентна по таймауту (`memory.ts:305-323`). Единственное, чего не хватает, — «предохранителя»: каждая recall заново платит `policy.timeoutMs` ожидания недоступного провайдера (`memory.ts:320`), потому что состояние здоровья не кешируется между вызовами. При недоступном провайдере и частых recall это линейный штраф по времени попытки; нужен либо короткий TTL на отрицательный health, либо счётчик последовательных отказов.

**N10 (D-36, S, влияние низкое, риск низкий). Дедупликация памяти работает внутри области видимости и не проверяет `supersedes`.** Ключ претензии — `scope|kind|normalized statement` (`packages/core/src/memory.ts:973-991`), сравнение идёт по тому, что вернул провайдер (`memory.ts:964-971` — «reinforceable» = `active|candidate`, «supersedable» = `active|candidate|stale`). Значит одна и та же фраза в двух workspace — две разные записи (это правильно по §52), но `supersedes` — просто список строк: ничто не проверяет, что названные id существуют и видимы тому же автору (`memory.ts:1077-1079` — только `requireText` на каждом id). Ссылка на несуществующую запись не отвергается, а `memory-beads` затем просто не найдёт её при resolve. Нужна проверка существования на границе retain — это дешевле, чем разбираться с «висячим» supersede потом.

## 5. Открытые вопросы и что я НЕ проверял

1. **Не проверял**, как `llm`-сервис DSH отвечает на `resolveModelInfo` для незарегистрированного **провайдера**: код `registration(provider)` (`packages/llm/llm/src/index.ts:740-750`) прочитан не до конца, код ошибки не установлен. Поэтому D4-утверждение («`UNKNOWN_MODEL` только в pi-ai») ограничено маршрутом `deepseek` и pi-ai.
2. **Не проверял** поведение `llm-pi-ai` для каталожной/некаталожной модели: адаптер переопределяет `resolveModel` (`packages/llm/llm-pi-ai/src/adapter.ts:289`) и бросает `UNKNOWN_MODEL` (`260`), но полный путь не прочитан. Это влияет на то, насколько достижим `evidence: 'unlisted'` в предлагаемом `ModelAvailability`.
3. **Не проверял** фактический размер продовых `C:\Users\Dmitry\.dsh`-баз и SQLite-индексов сессий: все оценки роста — из кода, не измерены. Формулировка «не измерено» относится ко всем числам роста.
4. **Не проверял** `attachment-local/src/request-image.ts` и `store.ts` глубже констант: возможно, там есть второй, более жёсткий лимит на суммарный запрос.
5. **Не проверял** `session-persistence-jsonl` и `session-projection-cache`: §48 требует «не копировать транскрипт», и DSH-сторона (jsonl-лог + проекции) в этом отчёте описана только через SQLite-индекс.
6. **Не проверял** `tool-result-pruner` в действии: прочитана только конфигурация; насколько часто он срабатывает и есть ли у него собственный `index.ts`-инвариант (файл `packages/compaction/compaction-tool-result-pruner/src/index.ts` не читался).
7. **Не проверял** тесты MW-отчётов на предмет расхождений с кодом: `MW-016`, `MW-018`, `MW-020` прочитаны не полностью (файлы 33–74 КБ), использованы только косвенные признаки через код и тесты.
8. **Не проверял** `packages/skill/src/*` и `tests/skill.test.mjs` в объёме потока: `estimateTokens` в `packages/core/src/skill.ts:982-983` найден grep'ом, но контур skill→context не разбирался (28 тестов не читались).
9. **Не проверял** `packages/execution/src/service.ts` целиком: вывод «fabric не подключён» получен repo-wide grep'ом по именам функций, а не чтением пути попытки. Если вызов происходит через реэкспорт с другим именем, вывод ослабляется; однако `discoverContext`/`materializeContextSnapshot`/`assembleContextPrompt`/`verifyContextSnapshot` — единственные входы контура, и их нет ни в одном файле, кроме определений и реэкспортов.
10. **Не проверял** работу GUI: всё, что сказано о навигации и `SessionLink`, — из контрактов и тестов, не из клика по интерфейсу.

## 6. CLAIMS

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
| D-01 | Context Fabric объявляет ровно три уровня L0/L1/L2, и L2 — единственный, получаемый по запросу | `packages/contracts/src/context.ts:38-50` | verified |
| D-02 | Mandatory-классы — policy, role-contract, task-contract; таблица instruction-классов объявлена отдельно, хотя сегодня совпадает | `packages/contracts/src/context.ts:108-112`, `125-129` | verified |
| D-03 | Единственное значение trust, разрешающее instruction-позицию, — строка `'trusted'`; всё остальное, включая отсутствие, читается как data | `packages/contracts/src/context.ts:155-168`; `packages/core/src/context.ts:830-832`, `907-920` | verified |
| D-04 | Маршрут без опубликованного context window отказывает admission кодом `context-window-undisclosed` до любого подсчёта бюджета | `packages/core/src/context.ts:222-225` | verified |
| D-05 | Mandatory-контекст никогда не обрезается: переполнение потолка или резервов даёт `refused`, а не усечение | `packages/core/src/context.ts:249-274`; `tests/context.test.mjs` (кейсы mandatory) | verified |
| D-06 | Mandatory-item без оценки токенов, без revision и без contentHash, либо просроченный, отказывает попытку отдельными причинами | `packages/core/src/context.ts:250-258`; `packages/contracts/src/context.ts:603-620` | verified |
| D-07 | Ранжирование optional-контекста детерминировано (relevance, затем дешевизна, затем uri) и не зависит от порядка ответов провайдеров | `packages/core/src/context.ts:878-890`; тест «ranking does not depend on the order the providers answered in» | verified |
| D-08 | Снапшот замораживается целиком (`deepFreeze`) и получает revision по канонической форме (fingerprint) | `packages/core/src/context.ts:622-631`, `1403-1406` | verified |
| D-09 | Provenance — только ссылки (`source`, `uri`, `revision?`, `contentHash?`) и не может нести тело источника | `packages/contracts/src/context.ts:188-205`; `packages/core/src/context.ts:987-1025` | verified |
| D-10 | Data-секция обёрнута fence-токенами, а токен нейтрализуется во всех provider-controlled полях — теле, uri, source, kind, revision | `packages/core/src/context.ts:752-756`, `794-801`, `1028-1048` | verified |
| D-11 | `assembleContextPrompt` принимает только `ContextSnapshot` и бросает `TypeError` на всё остальное, поэтому §21.1 держится по построению типа | `packages/core/src/context.ts:775-778`; тест «prompt assembly accepts a snapshot and nothing else» | verified |
| D-12 | Верификация различает три состояния идентичности: строку (опубликовано), `null` (источник перестал публиковать = drift `unverifiable`) и отсутствие поля (не смотрели) | `packages/core/src/context.ts:634-749`; `packages/contracts/src/context.ts:861-871` | verified |
| D-13 | `DshModelCatalog` оборачивает ровно `listProviders`, `listModels`, `resolveModelInfo` и читает из ответа только `context.contextWindow`, отбрасывая reasoning/maxTokens/модальности | `packages/controller/src/model-catalog.ts:63-80`, `94-128` | verified |
| D-14 | `ModelCatalogPort` не содержит метода доступности; различие «не зарегистрирован» и «не ответил» существует только на уровне `CatalogSnapshot.outages` провайдера | `packages/contracts/src/model-catalog.ts:113-129`, `78-100`; `packages/core/src/routing.ts:98-120` | verified |
| D-15 | DSH различает «listed» и «routable» на уровне провайдера: `routableProviders` содержит только провайдеров с непустым ответом `listModels`, а отказы уходят в `failures` | `packages/api/session-controller/src/catalog.ts:64-70` | verified |
| D-16 | DSH имеет отдельный preflight выбора модели, вызываемый и `selectModel`, и перед отправкой сообщения | `packages/api/session-controller/src/catalog.ts:80-90`; `commands.ts:151-155`, `379-384` | verified |
| D-17 | DSH имеет независимую проверку настроенности API-ключей, не связанную с доступностью моделей, и отдельное состояние аккаунта `signed-out`/`credential-stored` | `packages/api/session-controller/src/catalog.ts:97-116`; `packages/credentials/deepseek-account/src/types.ts:31-36` | verified |
| D-18 | UI DSH держит `routable: boolean \| null`, `pending: ModelSelection \| null` и `retainedEffort`, то есть различает «выбрано» и «доступно» | `packages/client/ui-model-selection/src/client/directory.ts:17-34`, `141-178` | verified |
| D-19 | На маршруте `deepseek` `resolveModelInfo` не падает на некаталожной модели и возвращает успешный ответ с окном, равным дефолту деплоймента 1 000 000 | `packages/llm/llm-deepseek/src/adapter.ts:37-39`; `model-info.ts:61-67`; `defaults.ts:6` | verified |
| D-20 | `listModels` у `llm-deepseek` возвращает `discoverModels?.(provider) ?? []`, а `discoverModels` опционален, поэтому каталог может быть пуст при рабочем `resolveModelInfo` | `packages/llm/llm-deepseek/src/adapter.ts:34-36`; `types.ts:99-101` | verified |
| D-21 | MyWork-адаптер использует ровно шесть session-операций: create, list, selectModel, prompt, cancel, follow | `packages/controller/src/dsh-session.ts:173-219`, `710-719` | verified |
| D-22 | Permission pin выполняется host-командой `/permission <preset>` через command runtime и падает до `prompt`, если команда недоступна или отказала | `packages/controller/src/dsh-session.ts:591-630`, `459-460`; `packages/client/ui-permission-presets/src/client/index.ts:126-130`; `tests/runtime.test.mjs:440-464` | verified |
| D-23 | Conformance адаптера не покрывает `read-only` и `danger-full-access` и не покрывает ветку «нет живого агента» в permission-pin | `tests/runtime.test.mjs:44-48` (только `workspace-write`); `packages/controller/src/dsh-session.ts:604-610` — ветка без теста | verified |
| D-24 | Четыре разных отказа permission-pin схлопываются в один код `AdapterError('unavailable')`, неотличимый для вызывающего | `packages/controller/src/dsh-session.ts:596-603`, `604-610`, `618-623`, `624-629` | verified |
| D-25 | Memory Fabric объявляет семь базовых scope-семейств, scope — данные, видимость считается по цепочке родителей с точным совпадением `type:id`, global не подразумевается | `packages/contracts/src/memory.ts:56-67`, `70-87`, `92-133`, `139` | verified |
| D-26 | MyWork не имеет ни одного упоминания DSH Agent Teams, поэтому отождествления `TeamId` не существует не только в типах, но и в коде | grep `agent-teams\|agentTeam\|AgentTeams\|teammate` по `packages/**/*.ts`, `tests/**/*.mjs` → 0 совпадений; `packages/contracts/src/team.ts:21`, `390-392` | verified |
| D-27 | `resolveModelInfo` непригоден как проба доступности: на маршруте `deepseek` он отвечает успешно для любой строки модели | D-19 + D-20 | verified |
| D-28 | Отказ `context-window-undisclosed` на маршруте `deepseek` практически недостижим, потому что окно подставляется дефолтом деплоймента | D-04 + D-19 | verified |
| D-29 | Учёт стоимости в MyWork не различает cache read и cache write: `ModelCallTokens` имеет только input/output, а ставка — одна на input | `packages/contracts/src/budget.ts:194-199`, `207-216`; `packages/core/src/budget.ts:181-188` | verified |
| D-30 | `memory-native` — процесс-локальный `Map`, объявленный как недолговечный; рестарт теряет все записи при сохранённых revisions в других структурах | `packages/memory-native/src/native.ts:11-16`, `92`, `232-243` | verified |
| D-31 | Ретенция evidence необратима: тела артефактов лежат BLOB в SQLite, а DELETE и UPDATE запрещены триггерами БД; ни одного удаления для artifacts/audit/outbox/inbox_dedup в коде нет | `packages/evidence/src/schema.ts:47-73`, `115-125`; `packages/storage/src/migrations.ts:54-78`; grep `DELETE FROM` по `packages/**/*.ts` → 3 совпадения, все вне этих таблиц | verified |
| D-32 | Сканер секретов применяется только к идентификаторам, content-type и credential-ref; тела артефактов, statement памяти и тела контекстных items не сканируются | `packages/evidence/src/metadata.ts:55-72`, `111`, `178-186`, `208-218`; `packages/evidence/src/artifacts.ts:179`; `packages/core/src/memory.ts:1036-1089` | verified |
| D-33 | Оценка токенов в MyWork — эвристика `ceil(length / 4)` без структурных накладных, токенизатора в зависимостях нет | `packages/core/src/memory.ts:1647-1649`; `packages/core/src/skill.ts:982-983`; grep `tokenizer` → 0 | verified |
| D-34 | Ревизии контекстных снапшотов и памяти нумеруются в процессе и не персистятся; ни одна из 16 таблиц MyWork не хранит контекстные ревизии или сам снапшот | `packages/core/src/context.ts:105-118`; `packages/core/src/memory.ts:111-124`; перечень таблиц: `evidence/src/schema.ts:47,75`, `execution/src/schema.ts:88,111,120,139`, `lease/src/schema.ts:48`, `planner/src/schema.ts:60,66,87,100,112,130`, `storage/src/migrations.ts:54,72,98` | verified |
| D-35 | Диагностика памяти ограничена `diagnosticLimit`, отказ обязательного маршрута отличается от деградации опционального, а health-проба ограничена таймаутом | `packages/core/src/memory.ts:216-224`, `305-323`, `659-691` | verified |
| D-36 | Дедупликация памяти идёт по ключу `scope \| kind \| normalized statement` относительно ответа провайдера, а список `supersedes` не проверяется на существование записей | `packages/core/src/memory.ts:973-991`, `963-971`, `1077-1079` | verified |
| D-37 | В DSH размер optional request extension ограничен 8 MiB на поле (UTF-8) с переносом остатка, а несериализуемый объединённый запрос деградирует до базового с логированием | `packages/session/session-log-deepseek/src/index.ts:39-53`, `118-134`, `181-224`; `packages/llm/llm-deepseek/src/request-extensions.ts:36-44` | verified |
| D-38 | Лимит request extension присутствовал уже на базовой ревизии документа: коммит `193f9ce413` — её предок | `git merge-base --is-ancestor 193f9ce413 477b4f420553e8a52c2fbccc464d7561b239c443` → exit 0 | verified |
| D-39 | Транспортные лимиты DSH: 20 изображений и 200 MiB на сообщение, 20 MiB на изображение, 128 MiB файловых байт в запросе, 8 MiB на extension; лимита на текст промпта нет | `packages/attachment/attachment-local/src/index.ts:34-42`, `150-158`; `packages/llm/llm-deepseek/src/config.ts:33-38`; grep по `packages/api/**/*.ts` | verified |
| D-40 | `SessionLink` объявлен, но не производится, не потребляется и не тестируется — единственное совпадение на репозиторий | `packages/contracts/src/board.ts:336-347`; grep `SessionLink` по `packages/**`, `tests/**` → 1 | verified |
| D-41 | MyWork не хранит транскрипт: `historyRefs` валидируются как ссылки, `carriesTranscript` всегда `false`, `SessionEvent` не содержит payload, ни одна таблица не описывает события | `packages/core/src/session.ts:729-748`, `981`; `packages/contracts/src/session.ts:425-426`, `944-945`; `packages/contracts/src/agent-runtime.ts:147-155`; `packages/controller/src/dsh-session.ts:755-773` | verified |
| D-42 | Сам DSH дублирует текст сессий в производный FTS5-индекс SQLite (`persisted_docs`, `live_docs`), который при несовпадении версии схемы сбрасывается целиком | `packages/session-query/session-query-sqlite/src/schema.ts:1`, `8`, `64-67`, `96-101`, `126-169` | verified |
| D-43 | Context Fabric не имеет ни одного потребителя в рантайме: `discoverContext`, `decideContextAdmission`, `materializeContextSnapshot`, `assembleContextPrompt`, `verifyContextSnapshot` встречаются только в определениях и реэкспорте | grep по `packages/**/*.ts`; `packages/core/src/index.ts:357-367` | verified |
| D-44 | Memory Fabric тоже не подключена: `createMemoryFabric` и `createMemoryContextProvider` только реэкспортированы, а beads-плагин регистрирует провайдера напрямую, минуя мандат `memory.semantic` | `packages/core/src/index.ts:408-409`; `packages/beads-adapter/src/memory-plugin.ts:113-122`; `packages/controller/src/index.ts:123`, `127` | verified |
| D-45 | MyWork-адаптер не обёртывает `fork`, `page`, `projections`, `search`, хотя DSH их предоставляет, поэтому навигация §48 не имеет источника | `packages/controller/src/dsh-session.ts:173-219`; grep `fork` по `packages/controller/src/*.ts` → 0; `packages/api/session-controller/src/index.ts:414`, `468`, `491` | verified |
| D-46 | Байтовых бюджетов в MyWork нет: все шесть лимитов бюджета токенные или стоимостные, а `ArtifactMetadata.size` объявлен как обязанность читателя, не writers' порог | `packages/contracts/src/budget.ts:59-90`; `packages/contracts/src/artifact.ts:110-114`; `packages/evidence/src/artifacts.ts:132-181` | verified |
| D-47 | DSH-метр токенов использует ту же плотность 4 символа на токен, но добавляет накладные 4 на блок и 4 на роль, то есть считает больше MyWork при том же тексте | `packages/llm/token-meter/src/estimate.ts:12-19`, `42-63`, `88-91`; `packages/core/src/memory.ts:1647-1649` | verified |
| D-48 | DSH различает fresh и fork как флаг `inheritsParentContext` провайдера, а fork фиксируется в durable-заголовке (`parentSession`, `seedLength`, `delegationDepth`) и не проходит как своя история в телеметрии | `packages/subagent/subagent/src/types.ts:344-354`; `packages/session-query/session-query-sqlite/src/schema.ts:113-125`, `index.ts:955`; `packages/session/session-telemetry-otel/src/index.ts:57-59` | verified |
| D-49 | Ветка `provider-absent` опирается на код `UNKNOWN_MODEL`, который по факту бросает только pi-ai-адаптер; для `llm-deepseek` такого кода в исходниках нет | grep `UNKNOWN_MODEL` по `packages/llm/**/src/**` → 1 совпадение (`packages/llm/llm-pi-ai/src/adapter.ts:260`) | verified |
| D-50 | Слушатель оценки доступности должен строиться на `listModels` и `selectModel`, а не на `resolveModelInfo` | следует из D-19, D-20, D-27 и D-16 | verified |

