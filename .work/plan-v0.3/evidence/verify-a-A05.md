# verify-a-A05 — routing / model availability / budget / scheduler (D20, D05, D11)

Ревизия репозитория MyWork: `git rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`, `git status --short` — пусто (H:\Repo\DSH-MyWork).
Проверялось только чтением: `read` / `grep` по `H:\Repo\DSH-MyWork\packages\**`, `tests\**`, `.work\plan-v0.3\*.md`. Ни мутаций, ни install/build, ни прогонов тестов.

## Якорь A05-1: 10-DECISIONS.md:1712,1713,1719 → packages/contracts/src/routing.ts:110-135,:113-114 + packages/core/src/routing.ts:98-122

- **Вердикт:** НЕВЕРНАЯ СТРОКА (вторая половина утверждения верна по сути, но привязана к другому файлу; первая половина совпадает дословно)
- **Что проверено:** read `packages\contracts\src\routing.ts` offset 100 limit 60 (строки 110-135); read `packages\core\src\routing.ts` offset 80 limit 70 (строки 98-122); read `10-DECISIONS.md` offset 1700 limit 80 (строки 1712, 1713, 1719); read `packages\core\src\scheduler.ts` offset 184 limit 45 (`refusalOf` 190-198); read `packages\controller\src\dsh-session.ts` offset 590 limit 45 (строки 599-628); grep по `.work\plan-v0.3\*.md` (`unavailable` → 10-DECISIONS.md:1730,1753 — только `route-unavailable`)
- **Фактическое значение:**
  - `packages/contracts/src/routing.ts:113` `/** The catalog does not register the provider, so the route does not exist. */` / `:114` `| 'route-absent'`; `:110-124` — семь значений, `:127-135` — `ROUTE_REFUSAL_REASONS` (7 имён)
  - `packages/core/src/routing.ts:104` `const listed = await port.listModels(provider.id)` / `:113-115` `catch (error) { outages.push(Object.freeze({ provider: provider.id, detail: describeFailure(error) })) }`
  - «4 отказа схлопываются в `unavailable`»: `packages/controller/src/dsh-session.ts:599-602, 606-609, 619-622, 625-628` — четыре `throw new AdapterError('unavailable', …)` внутри одного пути `#pinPermission` (`:591-630`); формулировка — `01-MASTER-PLAN.md:167` «перестать схлопывать 4 отказа в `unavailable`»
- **Оценка severity:** minor
- **Комментарий:** Первая половина точна: `route-absent` действительно определён через «каталог не регистрирует **провайдера**» (`:113-114`), и это же определение продублировано в планировщике — `scheduler.ts:195` `if (!catalog.providers.some(entry => entry.id === provider)) return 'route-absent'`. Ссылки 10-DECISIONS.md:1712/1713/1719 и диапазоны `:110-135`, `:127-135`, `readModelCatalog` `98-122`, `outages` `113-115`, `listModels` `104-112` — все совпадают дословно. Вторая половина («4 отказа схлопываются в unavailable») к маршрутизации отношения не имеет и в указанных строках 10-DECISIONS.md не встречается: речь о четырёх отказах сессионного пина прав, схлопнутых в `unavailable`; фактический источник — `packages/controller/src/dsh-session.ts:599-628` и `01-MASTER-PLAN.md:167`. Смежная находка (не дефект якоря): планировщик не считает пустой `listModels` отказом — `scheduler.ts:170-172` «A model the catalog does not list is **not** unavailable», а `refusalOf` (`:190-198`) не возвращает причину для зарегистрированного провайдера без аутэджа, то есть ветка `route-unavailable` (`:545-547`) на пустом каталоге вообще не срабатывает.

## Якорь A05-2: 10-DECISIONS.md:1724,1725,1750 → packages/core/src/budget.ts:10-12 + packages/core/src/routing.ts:90-93

- **Вердикт:** НЕВЕРНАЯ СТРОКА (цитаты в указанных строках дословны, но `BudgetConsumption` там не объявлен — тип живёт в `contracts`, и форма шире заявленной)
- **Что проверено:** read `packages\core\src\budget.ts` limit 40 (строки 1-40, в т.ч. импорт `:23`); read `packages\contracts\src\budget.ts` offset 28 limit 40 (строки 36-47, 50-56); read `packages\core\src\routing.ts` offset 80 limit 70 (строки 90-93); read `10-DECISIONS.md` offset 1700 limit 80 (строки 1724, 1725, 1750); grep `interface BudgetConsumption` по `packages\contracts\src` → `packages\contracts\src\budget.ts:36`
- **Фактическое значение:**
  - `packages/contracts/src/budget.ts:36-47` `export interface BudgetConsumption {` / `:38 readonly tokens: BudgetAmount` / `:40 readonly cost: BudgetAmount` / `:42 readonly attempts: number` / `:44 readonly reviewLoops: number` / `:46 readonly plannerCalls: number`
  - `packages/core/src/budget.ts:10-12` «The gate refuses, it does not repair: §30's three outcomes (pause, escalate, human decision) are workflow policy, and choosing one of them here would invent a fallback the architecture leaves to the caller.»
  - `packages/core/src/routing.ts:91-93` «its failure propagates instead of being flattened into an empty catalog, which routing would answer with a misleading `route-absent`»
- **Оценка severity:** major
- **Комментарий:** Обе цитаты решений 1724/1725/1750 совпадают с первоисточником дословно и относятся к принципу «отказ, а не repair». Но `BudgetConsumption` в `packages/core/src/budget.ts` не объявлен — он там только импортируется типом (`:23` из `@dsh-mywork/contracts`); фактическое объявление — `packages/contracts/src/budget.ts:36-47`, и оно содержит **пять** обязательных полей, а не два. Форма `{tokens, cost}` — репозиторный шорткат (`00-RECON.md:161`, `01-MASTER-PLAN.md:69`), полная форма зафиксирована в `23-STEPS-quality.md:468`, `evidence/quality-04.md:18`, `20-STEPS-foundation.md:1279`. Для карточки, которая «переиспользует» тип и добавляет лимит шагов (`10-DECISIONS.md:529`), шорткат опасен: `attempts`/`reviewLoops`/`plannerCalls` уже входят в форму.

## Якорь A05-3: 10-DECISIONS.md:1730,1753 / 01-MASTER-PLAN.md:279 → packages/core/src/scheduler.ts:545-547 и :568

- **Вердикт:** НЕВЕРНАЯ СТРОКА (утверждение «точка входа одна» верно и `scheduler.ts:568` точен; строка мастер-плана указана неверно — фактически `:291`)
- **Что проверено:** read `packages\core\src\scheduler.ts` offset 530 limit 60 (строки 545-547, 568); read `packages\core\src\scheduler.ts` offset 168 limit 16 (`:176`); grep `decideBudgetAdmission\(` по `packages\**\*.ts` → 2 совпадения; read `10-DECISIONS.md` offset 1700 limit 80 (строки 1730, 1753); read `01-MASTER-PLAN.md` offset 265 limit 30 (строки 279 и 291)
- **Фактическое значение:**
  - `scheduler.ts:545-547` `// §29: a candidate with no usable route is not a candidate.` / `if (!readRouteAvailability(blueprint.modelPolicy, tick.catalog).available) {` / `return { reason: 'route-unavailable', scopes: Object.freeze([]) }`
  - `scheduler.ts:568` `const decision: BudgetDecision = decideBudgetAdmission({ limits: workspace.budget, ledgers, request })`
  - `01-MASTER-PLAN.md:291` «точка входа одна (`scheduler.ts:568`), второй учёт токенов запрещён»; `:279` — строка D20 «Model availability»
- **Оценка severity:** minor
- **Комментарий:** Обе ссылки на исходник точны: `:545-547` — ровно тот `route-unavailable`, о котором говорят 1730/1753, и `:176` `export function readRouteAvailability(policy: ModelPolicy, catalog: CatalogSnapshot): RouteAvailability` тоже совпадает. «Точка входа одна» подтверждено грепом: `decideBudgetAdmission` определён в `packages/core/src/budget.ts:217` и вызывается ровно один раз — `scheduler.ts:568` (согласуется с `20-STEPS-foundation.md:1265` и `evidence/quality-04.md:21`). Но названная строка мастер-плана `:279` — это строка D20 (model availability), а фраза «точка входа одна (`scheduler.ts:568`)» лежит на `:291` (строка D05); расхождение 12 строк, за допуском ±10.

## Якорь A05-4: 10-DECISIONS.md:1758 → packages/contracts/src/model-catalog.ts:121

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\contracts\src\model-catalog.ts` offset 95 limit 50 (строки 113-128, объявление `ModelCatalogPort`); read `10-DECISIONS.md` offset 1700 limit 80 (строка 1758)
- **Фактическое значение:** `packages/contracts/src/model-catalog.ts:121` `listModels(provider: string): Promise<readonly CatalogModel[]>`; 10-DECISIONS.md:1758 «Контракты: `ModelCatalogPort` (`packages/contracts/src/model-catalog.ts:121` — `listModels(provider)`) сохраняет форму…»
- **Оценка severity:** info
- **Комментарий:** Строка и цитата совпадают буквально; интерфейс `ModelCatalogPort` — `:113-129`, метод `listModels` — первый после `listProviders` (`:115`), `resolveModelInfo` — `:128`. Утверждение «форма сохраняется» верно и для решения B: новый порт availability не требует правки этой подписи.

## Якорь A05-5: 10-DECISIONS.md:1764 → packages/controller/src/model-catalog.ts:98-111

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\controller\src\model-catalog.ts` offset 80 limit 50 (строки 98-111, класс `DshModelCatalog`); read `packages\core\src\routing.ts` offset 80 limit 70 (строки 113-115 — ловля); read `10-DECISIONS.md` offset 1700 limit 80 (строка 1764)
- **Фактическое значение:** `:101` `@throws whatever the registry raised: a missing adapter or an unreachable provider is an outage.` / `:103-104` `async listModels(provider: string): Promise<readonly CatalogModel[]> {` / `const models = await this.#llm.listModels(provider)` — без `try/catch`; 10-DECISIONS.md:1764 «…в `packages/controller/src/model-catalog.ts:98-111` исключение провайдера пробрасывается, а `readModelCatalog` его ловит»
- **Оценка severity:** info
- **Комментарий:** Цитата соответствует коду: комментарий-контракт `:98-102` прямо называет недоступного провайдера аутэджем, тело `:103-111` не перехватывает исключение, а `readModelCatalog` ловит его на `packages/core/src/routing.ts:113-115`. Само решение 1764 честно помечает как непроверенное, откуда именно приходит `provider-outage` (`llm` или адаптер) — эта неопределённость сохраняется, я её не снимал.

## Якорь A05-6: 10-DECISIONS.md:1718,1719 / 1759 → tests/routing.test.mjs

- **Вердикт:** ПОДТВЕРЖДЕНО (по букве утверждения «тесты маршрутизации существуют»); в ref-строках есть ложное утверждение — см. severity
- **Что проверено:** glob `tests/*.mjs` (28 файлов, `routing.test.mjs` есть); read `tests\routing.test.mjs` offset 200 limit 30; grep по `tests\routing.test.mjs` (`^test\(` → 20 блоков; `route-absent` → :69,:196,:197,:209,:282,:349,:356); grep `ROUTE_REFUSAL_REASONS` по всему `H:\Repo\DSH-MyWork` → 1 совпадение (объявление `packages\contracts\src\routing.ts:127`), в `tests\**` — 0; grep `model-not-routable` по `packages\**\*.ts` → 0; read `10-DECISIONS.md` offset 1700 limit 80 (строки 1718, 1719, 1751, 1759)
- **Фактическое значение:**
  - `tests/routing.test.mjs` — 452 строки, 20 `test(...)`: `:202` `test('a registered provider that serves no such model is an absent route, not an outage'…)` / `:209` `assert.equal(decision.reason, 'route-absent', 'the provider answered; the route simply does not exist')`; `:218` аутэдж, `:229/:245` контекстные окна, `:268` escalation, `:306/:318/:332` `catalog-invalid`
  - 10-DECISIONS.md:1718 «тест на исчерпываемость существует: `tests/routing.test.mjs`»; :1751 «существующий тест исчерпываемости продолжает работать — это и есть проверяемость»
- **Оценка severity:** major
- **Комментарий:** Файл тестов маршрутизации существует и содержателен (ref 1719 про `readModelCatalog` тоже точен). Но заявленный в 1718/1751 «тест на исчерпываемость» отсутствует: `ROUTE_REFUSAL_REASONS` встречается в репозитории ровно один раз — в собственном объявлении (`packages/contracts/src/routing.ts:127`), ни один тест его не читает; семь причин проверяются поодиночке (`route-absent`, `provider-outage`, `context-window-undisclosed/too-small`, `escalation-not-permitted`, `catalog-invalid`), перечисления нет. Это materially важно: обоснование варианта B («существующий тест исчерпываемости продолжает работать — это и есть проверяемость», 1751) опирается на несуществующий тест. Дополнительно: `model-not-routable` в коде отсутствует (0 совпадений в `packages\**\*.ts`), т.е. тест из 1759 — план, а не факт; и текущее поведение уже отдаёт `route-absent` для зарегистрированного провайдера без запрошенной модели (`tests/routing.test.mjs:202-215`, detail `/serves no model "sonnet"/`), поэтому вариант B меняет ожидание этого теста, а не только добавляет значение в список.

## Якорь A05-7: 10-DECISIONS.md:1330,1342,1373,1415 → audit.ts:27,65,104-128,134 + storage/src/outbox.ts:54 + evidence/src/schema.ts:75 + storage/src/store.ts:30-39

- **Вердикт:** ПОДТВЕРЖДЕНО (все цитаты D16 дословны; две формулировки-описания неточны — см. severity)
- **Что проверено:** read `packages\contracts\src\audit.ts` limit 135 (строки 27, 65, 88-101, 104-129, 132-135); read `packages\storage\src\outbox.ts` offset 30 limit 40 (строки 32-45, 48-62, 54); read `packages\evidence\src\schema.ts` offset 45 limit 45 (строки 47, 60, 75); read `packages\storage\src\store.ts` offset 15 limit 50 (строки 30-39); read `10-DECISIONS.md` offset 1320 limit 110 (строки 1330, 1342, 1373, 1415)
- **Фактическое значение:**
  - `audit.ts:27` `export const AUDIT_SCHEMA = 'mywork.audit/v1'`; `:65` `export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = Object.freeze([`; `:104` `export interface AuditEntry {`…`:128 readonly causationId?: EventId`; `:134 readonly position: number` (в `AuditRecord`, `:132`)
  - `outbox.ts:54` `readonly correlationId: CorrelationId`; `evidence/src/schema.ts:75` `CREATE TABLE audit_events (` (артефакты `:47`, `:60` `bytes BLOB NOT NULL`)
  - `store.ts:30-33` «One unit of work: a mutation plus, in the same commit, the events it emits and the inbox rows that record the deliveries it consumed.»
- **Оценка severity:** minor
- **Комментарий:** Все семь цитат совпадают с первоисточником буквально, включая `:104-128` (последнее поле — `causationId`) и `:132-134`. Две неточности в описаниях D16: (1) 1330 называет `outbox.ts:54` «в записи outbox», тогда как это поле входа `OutboxAppendInput` (`:48-62`) — в хранимом `OutboxRecord` (`:32-45`) поля `correlationId` нет, корреляция едет внутри `envelope`; (2) 1342 говорит про «доставку события в одной транзакции с мутацией», тогда как `store.ts:30-39` гарантирует транзакционную **запись** события (и inbox-строк), а доставка происходит позже — у `OutboxRecord` есть `status`/`deliveredAt` (`:36,:44`). Существо гарантии outbox-паттерна это не отменяет.

## Итог

| № | Якорь | Вердикт | Severity |
|---|---|---|---|
| A05-1 | E1 · route-absent + 4 отказа → unavailable | НЕВЕРНАЯ СТРОКА | minor |
| A05-2 | E2 · BudgetConsumption {tokens, cost} | НЕВЕРНАЯ СТРОКА | major |
| A05-3 | E3 · точка входа одна (scheduler.ts:568) | НЕВЕРНАЯ СТРОКА | minor |
| A05-4 | E4 · contracts/model-catalog.ts:121 | ПОДТВЕРЖДЕНО | info |
| A05-5 | E5 · controller/model-catalog.ts:98-111 | ПОДТВЕРЖДЕНО | info |
| A05-6 | E6 · tests/routing.test.mjs | ПОДТВЕРЖДЕНО (ref 1718/1751 ложно) | major |
| A05-7 | E7 · цитаты D16 | ПОДТВЕРЖДЕНО | minor |

Наиболее значимая находка: `10-DECISIONS.md:1718/1751` обосновывает проверяемость варианта B ссылкой на «существующий тест исчерпываемости» `ROUTE_REFUSAL_REASONS`, которого в репозитории нет (0 совпадений по `tests/`).
