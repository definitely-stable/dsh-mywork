# MW-013 — Добавить model routing и бюджетный admission

- Карточка: `.work/tasks/MW-013.md` (Board ID `0c6bf5ac-0719-4625-be6d-d197a14b6363`)
- Этап: 01-runtime. Обязательные пункты §62: **7** (DSH model/provider selection), **38** (Budget guards)
- Разделы архитектуры: §14 (735), §15 (779), §29 (1896), §30 (1928), §53 (2514); дополнительно §13.1/§13.3 (627/656), §21.6 (1202), §36, §44
- Base SHA: `5d7b80d1e602ac9fddce1e2372a6349d13af57ab`. Head SHA: `3bc6c78a077174a9497488ed137082294b705a34` (7 коммитов, см. §10). **Коммиты выполнены по отдельному поручению владельца.** Push/merge/publish/release не выполнялись.
- Статус: **DONE** — работа завершена и закоммичена (`3bc6c78`, §10); ревью-статус снят решением владельца (отдельным поручением «фиксы и изменения статуса с коммитами»). Evidence приёмки — независимое ревью (**PASS WITH FINDINGS**: 1 MAJOR + 5 MINOR + 2 NIT) и верификация исправлений (**FIXES PARTIALLY VERIFIED**; остаток N1 закрыт, §8), плюс проверки на закоммиченном дереве (`pnpm run check` → exit 0, 444 tests / 421 pass / 0 fail). **Что осталось непроверенным и названо, а не скрыто:** третьего прохода по свежим правкам N1–N3 не было (мутации этих правок ловятся — §5), а приёмка владельцем как отдельный акт не фиксировалась: этот статус выставлен по его прямому указанию, а не выведен автором из self-review.

## 0. Как читать этот отчёт

§5 — команды и exit codes, §6 — evidence (включая mutation check и пробу против реального SDK), §7 — что
не проверено и что осталось за рамками, §8 — независимое ревью. Всё, что заявлено как «проверено»,
проверено командой из §5; числа воспроизводимы.

## 1. Проверка зависимостей (MW-005, MW-006, MW-007)

Проверялось **по исходникам, git и прогону**, а не по колонке доски (`.work/README.md`: «колонка «Готово»
сама по себе не доказывает приёмку»).

| Зависимость | Отчёт | Исходники / git | Прогон | Результат |
|---|---|---|---|---|
| **MW-005** Adapter SDK | `reports/MW-005-adapter-sdk.md` (359 строк), статус **DONE**; §8 фиксирует независимое ревью | `packages/adapter-sdk/src` (8 файлов), коммиты `e074fac`, `0dd69e2`, `44027ee`, `829ec62` | `pnpm run check` на старте → exit 0 | предусловие пройдено |
| **MW-006** конфигурация/Team | `reports/MW-006-team-config.md` (203 строки), статус **READY_FOR_REVIEW**; независимое ревью **PASS WITH FINDINGS** (2 MAJOR / 3 MINOR / 2 NIT), все замечания исправлены, повторно верификатором **не** проверялись | `contracts/src/config.ts`, `contracts/src/team.ts`, `core/src/config.ts`, `core/src/team.ts`, `core/src/graph.ts`; коммиты `2bbb5d9`, `962f696`, `352e378`, `fbee7a0` | tree зелёный на старте | предусловие пройдено с оговоркой ниже |
| **MW-007** permissions/границы | `reports/MW-007-security.md` (234 строки), статус **READY_FOR_REVIEW**; раунд 1 **PASS WITH FINDINGS**, раунд 2 **FIXES PARTIALLY VERIFIED**; правки V1–V11 независимо не перепроверялись (§9 отчёта), остаточные границы эвристики секретов названы в §6 | `packages/core/src/security.ts`, `packages/contracts/src/security.ts`, `tests/security.test.mjs` (38 тестов), коммиты MW-007 | tree зелёный на старте | предусловие пройдено с оговоркой ниже |

**Оговорка, названная явно, а не замолчанная.** Формальной приёмки владельца у MW-006 и MW-007 нет: оба
остаются `READY_FOR_REVIEW`, а правки MW-007 после верификации раунда 2 не перепроверялись независимо.
Это ровно то состояние, на котором запускались MW-008, MW-009, MW-010, MW-011 и MW-012: в отчётах
MW-007 (§1) и MW-012 (§1) такое предусловие названо пройденным по отчёту + исходникам + зелёному
конвейеру, и владелец эти карточки принял. MW-013 идёт по тому же правилу и по той же причине: отчёт,
исходники, коммиты и зелёный конвейер воспроизводимы (MW-005 — `DONE`, у MW-006/007 независимое ревью
проведено и его находки закрыты). Если владелец считает «принято» синонимом «приёмка владельца
зафиксирована», правильным действием был бы `BLOCKED` — это решение владельца, и оно названо здесь,
чтобы его можно было принять, не перечитывая переписку. **Постфактум:** владелец принял эту оговорку,
продолжив карточку и отдельно поручив коммиты и снятие ревью-статуса (§10), поэтому оговорка остаётся
записанной, но открытым вопросом больше не является.

Зависимости MW-013 от неверифицированных *дельт* MW-006/007 нет: карточка использует словарь контрактов
(`ModelPolicy`, §30-лимиты), `myworkAdapters` и `Result`/типизированные отказы, то есть принятые и
покрытые тестами части, а не спорные правки безопасности.

**Чужая незавершённая работа не тронута.** На старте `git status` показывал одно изменение —
`.gitignore` (правило про архивы `*.rar/*.zip/*.7z`, добавлено другой сессией, не закоммичено). Оно
сохранено как есть; MW-013 его не редактировал и не откатывал.

## 2. Решения, согласованные с владельцем, и решения по объёму

**Согласовано с владельцем до начала работы** (batched-вопрос, оба ответа получены):

1. **Неизвестный расход = fail closed.** Если usage не сообщён или у маршрута нет тарифа, лимит
   становится непроверяемым, и новый admission по нему **отклоняется** с причиной; ничего не считается
   нулём.
2. **Привязка к реальному DSH-каталогу живёт в существующем пакете `controller`**: строка делает
   `ctx.get('llm')` → регистрирует порт `model-catalog` в `myworkAdapters`. Новый пакет не создаётся.

**Решения по объёму, принятые внутри карточки** (названы, чтобы ревьюер мог их оспорить):

- `D1`. **Граница лимита включительная.** Расход, ровно попадающий в потолок (`used + requested ==
  declared`), допускается; следующая единица — нет. Для счётчиков это значит: `maxAttempts: 8` при
  `attempts: 7` допускает восьмую попытку, при `attempts: 8` — уже нет. Лимит, объявленный как `0`,
  является жёстким стопом, а не отсутствующим лимитом.
- `D2`. **Объявленный лимит, который запрос не измерил, тоже отклоняется.** Отсутствие оценки — не
  утверждение «это бесплатно»: `request.tokens`/`request.cost` отсутствуют → `limit-unverifiable`.
  Иначе `maxCostPerTask` обходится забывчивостью вызывающего. Оценки существуют по архитектуре: §21.6
  считает бюджет от реального маршрута и окна.
- `D3`. **Лимит проверяется только тем запросом, который его расходует.** Исчерпанный `maxAttempts` не
  останавливает review loop (у него свой лимит), а `maxOptimizerCostPerDay` не управляет обычным
  model call.
- `D4`. **Отсутствие маршрута и outage — разные отказы.** Провайдер не зарегистрирован → `route-absent`;
  зарегистрирован, но не ответил → `provider-outage`; ответил кодом DSH `UNKNOWN_MODEL` (`llm-pi-ai:
  provider "x" has no configured model "y"`) → снова `route-absent`. Код берётся из реального SDK, а не
  выдуман: он и есть сигнал «маршрута нет».
- `D5`. **Неизвестное окно контекста не выдаётся за подходящее.** Если требуется ёмкость, а адаптер её
  не опубликовал — `context-window-undisclosed`; если опубликовал меньше требуемого —
  `context-window-too-small`. Без требования окно остаётся в provenance **отсутствующим**, не нулевым.
- `D6`. **Escalation — только по явному разрешению запроса** (`allowEscalation`). Значение по умолчанию
  для разработки — `DEVELOPMENT_MODEL_POLICY` = `opencode-go/deepseek-v4.1-flash`, `fallback: []`,
  `escalation: []`: платная frontier-модель не выбирается автоматически (§62 п.7). Кандидат escalation
  без разрешения не «пропускается молча», а записывается в разбор как `withheld` /
  `escalation-not-permitted`, и провайдер даже не опрашивается (тест это утверждает).
- `D7`. **Что делать с исчерпанным бюджетом — не решает бюджетный гейт.** §30 перечисляет pause /
  escalate / human decision; выбор одного из них здесь был бы выдуманным fallback, поэтому гейт только
  отклоняет admission и называет причину, а выбор оставляет workflow (MW-014/MW-044).
- `D8`. **Settlement не сообщает измерение, которого ему не дали.** `chargeConsumption` записывает
  пропущенную размерность как **unknown** с причиной, а не как ноль и не «как было»: пропуск
  измерения — не утверждение, что расход равен нулю, и лента, тихо прибавившая `0`, позволила бы
  следующему admission пройти под потолком, который уже превышен. Настоящий ноль — это измерение,
  поэтому его нужно назвать явно (`knownAmount(0)`). Неизвестность не «лечится» поздним измеренным
  расходом: `addAmounts` её сохраняет, и лимит остаётся непроверяемым, пока scope не будет измерен
  заново. (Первая редакция этого решения оставляла `consumption` прежней и опиралась на гейт — это было
  неверно, см. §8.3, N1.)

## 3. Сделано

### 3.1 Контракты (`packages/contracts`)

- `src/model-catalog.ts` (новый, 98 строк) — порт §36 `ModelCatalogPort`, повторяющий **реальный** DSH
  LLM registry: `listProviders()` (синхронный, как в DSH), `listModels(provider)`,
  `resolveModelInfo(provider, model)`; типы `CatalogProvider`, `CatalogModel`, `ResolvedCatalogModel` с
  **опциональным** `contextWindow` (нет значения — нет утверждения о ёмкости) и константа
  `CATALOG_UNKNOWN_MODEL = 'UNKNOWN_MODEL'` — код DSH, которым порт отличает отсутствующий маршрут от
  outage.
- `src/routing.ts` (новый, 188 строк) — словарь §29: `ModelRoute`, `parse`/`format`, `ModelRouteRole`
  (`preferred`/`fallback`/`escalation`), шесть триггеров §29, `ModelRouteRequest`,
  `RouteRefusalReason` (7 значений), `RouteEvaluation`, `ModelRouteProvenance`,
  `ModelRouteDecision` и `DEVELOPMENT_MODEL_POLICY`. Решение, выбравшее маршрут, **несёт** provenance —
  получить маршрут без записи о нём нельзя.
- `src/budget.ts` (новый, 264 строки) — словарь §30: `BudgetAmount` (`known` | `unknown` с причиной),
  `BudgetConsumption`, восемь лимитов ровно под именами §30, `BUDGET_LIMIT_SCOPES`
  (task / workspace-day / optimizer-day / provider-day), `BudgetRequest`, `BudgetLedger`,
  `BudgetCheck`/`BudgetRefusal`/`BudgetDecision`, а также `ModelCallTokens`/`ModelRate`/`ModelRateTable`
  (§53: тарифы deployment'а, не каталога — DSH цен не публикует).

### 3.2 Чистая политика (`packages/core`)

- `src/routing.ts` (новый, 383 строки) — `readModelCatalog(port)` (провайдеры, модели, outage'ы;
  «не ответил» не сворачивается в «пусто»), `selectModelRoute({ request, catalog, port })`,
  `routeModel({ request, port })`, `formatModelRoute`/`parseModelRoute` (provider — до **первого**
  слэша, поэтому `openrouter/anthropic/x` разбирается верно). Разбор кандидатов в порядке политики:
  невалидная запись → `invalid-route`; провайдер не зарегистрирован → `route-absent`; outage → 
  `provider-outage`; отказ resolve с кодом `UNKNOWN_MODEL` → `route-absent`; ответ о другом маршруте или
  окно, не являющееся положительным счётчиком → `catalog-invalid`; окно не опубликовано/мало → отказ;
  иначе маршрут выбран, и §29-provenance собран. Ошибки формы запроса/политики — `TypeError`
  (программная ошибка), ошибки данных политики — типизированный отказ.
- `src/budget.ts` (новый, 418 строк) — `knownAmount`/`unknownAmount`/`amountValue`/`addAmounts`
  (unknown отравляет сумму), `chargeConsumption` (счётчики складываются, токены/стоимость — через
  `addAmounts`; измерение, которого в charge нет, ничего не выдумывает), `readCallTokens` (usage
  отсутствует или невалиден → `unknown` с причиной), `modelCallCost` (нет тарифа → `unknown`, не 0; не
  оба счётчика известны → `unknown`), `modelRateOf`, и сам гейт
  `decideBudgetAdmission({ limits, ledgers, request })`.

### 3.3 Привязка к реальному DSH (`packages/controller`)

- `src/model-catalog.ts` (новый, 175 строк) — `DshLlmRegistry` (структурное описание настоящего сервиса
  `llm`: `ListProviders`/`listModels`/`resolveModelInfo` с вложенным `context.contextWindow`,
  скопированное с реального SDK, а не импортированное — иначе в бандле появился бы второй внешний
  импорт), класс `DshModelCatalog implements ModelCatalogPort` и `mountModelCatalog(ctx, adapters)`:
  находит `ctx.get('llm')`, регистрирует `kind: 'model-catalog'`, `id: 'dsh-llm'`,
  `contractVersion: 'model-catalog/v1'`, capabilities `{ providers, models, contextWindow }` в
  `myworkAdapters` и снимает регистрацию эффектом фибры. Отсутствующий или неполный сервис — это
  **сообщение**, а не падение строки: контроллер монтируется, в лог идёт `warn`, регистрации нет.
- `src/index.ts` — `apply()` вызывает `mountModelCatalog`; публичная поверхность привязки
  реэкспортируется (нужна пробе и диагностике).

### 3.4 FakeProvider и тесты

- `packages/adapter-sdk/src/testing.ts` — `FakeModelCatalog implements ModelCatalogPort`: литеральный
  каталог (`providers`, `models` с окнами, `outages`), запись того, что у него **спрашивали**
  (`listedProviders`, `askedRoutes`), и отказ `UNKNOWN_MODEL` для маршрута, которого провайдер не
  обслуживает. Запись вызова идёт до ответа, поэтому «спросили ли вообще» проверяемо, а не вакуумно.
- `tests/routing.test.mjs` (новый, 452 строки) — 19 тестов.
- `tests/budget.test.mjs` (новый, 488 строк) — 15 тестов.
- `README.md` — раздел «Model routing и бюджет (§29, §30)».

### 3.5 Приёмка карточки → чем доказано

| Требование карточки | Тест |
|---|---|
| FakeProvider проверяет лимит ровно на границе | `a token limit admits a charge that lands exactly on the ceiling and refuses the next token`, `an attempt limit admits the attempt that lands on the ceiling and refuses the one past it`, `the per-day scopes are checked against their own ledgers` (4+1 == 5 допускается), `a priced run is stopped by its own ceiling…`, `a required context window is honoured exactly at the boundary and refused one token past it` |
| …outage | `a provider in outage is routed around, and the outage is what the provenance records`, `an outage with no fallback is refused with the outage, not with the absence`, `an outage recorded in the snapshot is not re-asked through the exact-model lookup`, `the catalog is read once per provider, and an outage stays distinguishable from an empty catalog` |
| …отсутствие маршрута | `an unregistered provider is refused as an absent route, never as an outage`, `a registered provider that serves no such model is an absent route, not an outage` |
| Неизвестные cost/usage не выдаются за ноль | `an unmeasured amount is unknown with its reason, never zero`, `a call whose usage nobody reported leaves the token total unknown`, `a route without a rate has an unknown cost, and an unknown count cannot be priced`, `a settlement never reports a measurement it was not given`, `an unmeasured settlement cannot be laundered by a later measured admission`, `an undisclosed window is refused when required and stays absent — never zero — when not` |
| Исчерпание бюджета останавливает admission и выдаёт причину | `a priced run is stopped by its own ceiling, with the reason and the numbers` (refusal: `limit=maxCostPerTask`, `scope=task`, `used=500`, `requested=500`, `reason=limit-exceeded`), `a declared limit the request does not measure is refused, not treated as free` (обе половины, cost и tokens), `a limit whose scope the caller never measured is refused`, `an unknown total makes its limit unverifiable even when the request measures itself`, `every §30 limit is declared, scoped, and actually read by the gate` |
| Реальный DSH model catalog, preferred/fallback/escalation, availability, окно | §6.4 — проба против настоящего `LlmRuntime`; `the controller registers the DSH registry as the model-catalog port, and unload removes it` |
| Лимиты tokens/cost/attempts/review loops/planner/optimizer/workspace/provider | `every §30 limit is declared, scoped, and actually read by the gate` (8/8 доведены до отказа нулевым потолком), `a malformed limit, ledger, or request fails loud` (закрытая форма имён: опечатка `maxTokensPerTasks` — `TypeError`, а не «лимитов нет») |
| Route записывается в provenance | `the preferred route is selected, and its §29 provenance records the actual route` — маршрут, роль, триггер, окно и весь разбор; решение `routed` невозможно без provenance; запись переживает JSON round-trip |
| Для разработки default — OpenCode Go Flash без автоматического перехода на платный frontier | `the development default is the flashed model and leaves no room for an automatic escalation`, `escalation is opt-in: the escalation route is withheld and never asked` (провайдер escalation не опрашивается) |

## 4. Изменённые и новые файлы

Новые (8):

| Файл | Строк / непустых |
|---|---|
| `packages/contracts/src/model-catalog.ts` | 98 / 93 |
| `packages/contracts/src/routing.ts` | 188 / 175 |
| `packages/contracts/src/budget.ts` | 264 / 243 |
| `packages/core/src/routing.ts` | 390 / 372 |
| `packages/core/src/budget.ts` | 472 / 446 |
| `packages/controller/src/model-catalog.ts` | 175 / 162 |
| `tests/routing.test.mjs` | 452 / 402 |
| `tests/budget.test.mjs` | 488 / 434 |

Изменённые (6, `git diff --stat`: 245 вставок / 5 удалений):

| Файл | Изменение |
|---|---|
| `packages/contracts/src/index.ts` | +3: экспорт трёх новых модулей |
| `packages/core/src/index.ts` | +30/−6: экспорт routing/budget и уточнение docstring |
| `packages/controller/src/index.ts` | +16: `mountModelCatalog` в `apply` + публичный реэкспорт привязки |
| `packages/adapter-sdk/src/testing.ts` | +152/−2: `FakeModelCatalog` |
| `README.md` | +45/−1: раздел §29/§30 и строка про core в «Структуре» |
| `.gitignore` | **не мой** — чужое незакоммиченное изменение, сохранено как есть |

Схема БД, живой профиль DSH, доска и чужие проекты не менялись. Файлы MW-012/MW-011 не редактировались.

## 5. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево: только ` M .gitignore` (чужая работа), HEAD `5d7b80d1e602ac9fddce1e2372a6349d13af57ab` |
| `pnpm run check` (baseline, до правок) | 0 | **tests 410, pass 387, fail 0, skipped 23**; smoke 12 `ok` |
| `pnpm run typecheck` (первый прогон) | **1** | `core/src/budget.ts(361,96): error TS2339: Property 'kind' does not exist on type 'never'` — сужение union-а в `requireAmount`; затем `adapter-sdk/src/testing.ts(216,5) TS4104` и `(237,10) TS2540` — `readonly` на мутируемом поле outage-скрипта |
| `pnpm run typecheck` (после исправлений) | 0 | все 11 пакетов `Done` |
| `pnpm run build` | 0 | сборка всех пакетов, `Build complete` |
| `node --test --test-isolation=none tests/budget.test.mjs` | 0 | **tests 14, pass 14, fail 0** |
| `node --test --test-isolation=none tests/routing.test.mjs` | 1 → 0 | сначала 4 pass / 11 fail: несогласованная сигнатура `routeModel(port, request)` против `selectModelRoute({ request, … })` в тестах, плюс фейк записывал только обслуженные листинги; после исправления (единый объект-аргумент `routeModel({ request, port })`, запись вызова до ответа) — **19 pass / 0 fail** |
| **mutation M2**: `used.value + charged.value > declared` → `>=` в `packages/core/lib/index.js` | 1 | **4 fail**: обе границы (токены, попытки), per-day scope и «priced run» — граница проверяется не вакуумно |
| **mutation M4**: `unknownAmount("the provider reported no usage for this call")` → `knownAmount(0)` | 1 | **2 fail**: неизвестный usage как ноль ловится |
| **mutation M3**: `if (failureCode(error) === "UNKNOWN_MODEL")` → `if (false)` | 1 | **2 fail**: отсутствие маршрута, свёрнутое в outage, ловится. Первая попытка M3 использовала шаблон из исходника и в бандле **не совпала** — прогон дал 29 pass / 0 fail, то есть «мутация не применена»; после `mutation landed: True` эффект наблюдается. Это записано как предупреждение о текстовых мутациях, а не как успех |
| **mutation M5 (из ревью, F2)**: `request.tokens ?? unmeasured("tokens")` → `request.tokens` | 1 | **2 fail**: токеновая половина D2 теперь покрыта |
| **mutation M6 (из ревью, F4)**: outage-шорткат по снимку → `if (false)` | 1 | **2 fail**: провайдер в outage не «переспрашивается» через resolve |
| **mutation M7 (из ревью, F1)**: `charged` снова сообщает `tokens: known(0)` для неданного измерения | 1 | **1 fail**: `a settlement never reports a measurement it was not given` |
| **mutation M8 (из ревью, F5)**: закрытая форма `limits` отключена | 1 | **1 fail**: опечатка в имени лимита больше не выглядит как «лимитов нет» |
| **mutation N1a (из verify-fixes)**: пропущенная размерность снова пишется как `known(0)` | 1 | **2 fail**: `a settlement never reports a measurement it was not given`, `an unmeasured settlement cannot be laundered by a later measured admission` |
| **mutation N1b (из verify-fixes)**: лента игнорирует неизвестность и не отравляет итог | 1 | **3 fail**: тот же остаток плюс `a call whose usage nobody reported leaves the token total unknown` |
| **mutation N2 (из verify-fixes)**: отказ от объекта с прототипом снят | 1 | **1 fail**: `a malformed limit, ledger, or request fails loud` |
| **mutation N3 (из verify-fixes, ранее выживала M10)**: сводная причина = последний кандидат | 1 | **1 fail**: `a refusal names the first candidate that failed, while the walk keeps every reason` — тест, добавленный именно для этого пина |
| восстановление: копия `packages/core/lib/index.js` из `.tmp/core-index.pristine2.js`, затем `pnpm run build` | 0 | дерево возвращено: 32 pass / 0 fail, далее полный `check` |
| `node --test --test-isolation=none tests/boundaries.test.mjs` | 1 → 0 | сначала `packages/core/lib/index.js imports` → фактически `['advertises nothing']`: **проза в doc-комментарии** попала в скан модульных спецификаторов. Реальный импорт не появлялся; формулировка переписана → **26 pass / 0 fail** |
| проверка после правок ревью: `pnpm run build` + `pnpm run test` | 1 → 0 | второй такой же случай — проза `from "the answer was a refusal"` в докблоке фейка уже в **бандле** `adapter-sdk/lib/testing.js`; тест `the adapter SDK and the controller bundle stay self-contained` поймал это как внешний импорт. Формулировка переписана; добавлена собственная сверка бандлов регуляркой `\bfrom\s*['"]…['"]` — «мусорных» спецификаторов нет ни в одном из пяти артефактов |
| `pnpm run check` (итоговый) | 0 | **tests 444, pass 421, fail 0, skipped 23** — +34 к baseline (19 routing + 15 budget), прежние 387 не сломаны |
| `node scripts/verify-profile.mjs --dsh-bin C:\Reposit\deepseek-harness\deepseek-harness\apps\cli\lib\bin.js` | 0 | `verify:profile: PASS`; bundle ставится в **изолированный** DSH home, профиль грузится и выгружается (`controller mounted` / `stopped`), «user profile untouched (3 fingerprint(s) unchanged)» |
| `node .tmp/mw013-probe.mjs` (проба, §6.4) | 0 | `PROBE_OK` — привязка и routing работают против настоящего `LlmRuntime` |

## 6. Evidence

### 6.1 Прогон домена (фрагмент)

```
ℹ tests 444   ℹ pass 421   ℹ fail 0   ℹ skipped 23
✔ a token limit admits a charge that lands exactly on the ceiling and refuses the next token
✔ an attempt limit admits the attempt that lands on the ceiling and refuses the one past it
✔ a declared limit the request does not measure is refused, not treated as free
✔ a settlement never reports a measurement it was not given
✔ an unknown total makes its limit unverifiable even when the request measures itself
✔ a limit whose scope the caller never measured is refused
✔ a declared limit of zero is a hard stop, not an absent limit
✔ the per-day scopes are checked against their own ledgers
✔ every §30 limit is declared, scoped, and actually read by the gate
✔ the preferred route is selected, and its §29 provenance records the actual route
✔ a provider in outage is routed around, and the outage is what the provenance records
✔ an outage recorded in the snapshot is not re-asked through the exact-model lookup
✔ a catalog that cannot name its providers at all fails loud instead of inventing a route
✔ an unregistered provider is refused as an absent route, never as an outage
✔ a registered provider that serves no such model is an absent route, not an outage
✔ a required context window is honoured exactly at the boundary and refused one token past it
✔ an undisclosed window is refused when required and stays absent — never zero — when not
✔ escalation is opt-in: the escalation route is withheld and never asked
✔ the controller registers the DSH registry as the model-catalog port, and unload removes it
✔ a profile without the llm service mounts the controller and registers no catalog adapter
```

### 6.2 Граница лимита — точные числа (из теста)

Потолок `maxTokensPerTask: 1000`: `used=999 + requested=1` → `admitted`, запись проверки
`{ limit: 'maxTokensPerTask', scope: 'task', declared: 1000, used: 999, requested: 1 }`;
`used=1000 + requested=1` → `refused`, `reason: 'limit-exceeded'`; `used=1000 + requested=0` → `admitted`.
Потолок `maxAttempts: 8`: `attempts=7` + попытка → `admitted`; `attempts=8` + попытка → `refused`.
Потолок `maxCostPerTask: 500` с тарифом `2`/`3` за токен: первый вызов (100+100 токенов = 500) → `admitted`
ровно на потолке, второй такой же → `refused` с `used: 500`, `requested: 500`.

### 6.3 Изоляция и процессная чистота

- Живой профиль DSH не адресовался: `verify:profile` работал с `DSH_HOME=.tmp/verify-profile/home` и
  подтвердил неизменность пользовательских манифестов (3 fingerprint'а).
- Scratch — только `.tmp/` (проба и копия бандла). Доска разработки, леджер Beads, схемы БД и чужие
  пакеты не трогались.
- Платные LLM-пробы не запускались, другая модель не вызывалась, субагенты-исполнители не запускались.

### 6.4 Проба против реального SDK (keyless) — `.tmp/mw013-probe.mjs`

Проба грузит **настоящие** `LlmRuntime` и `Context` из чекаута DSH
(`packages/llm/llm/lib/index.js`, `llm.LlmRuntime` = сервис `llm`), регистрирует в реальном реестре
stub-адаптер (без сети, без ключа, без профиля) и прогоняет через него привязку MW-013:

```
real DSH packages loaded: function function
real listProviders(): [{"id":"probe","name":"Probe probe"}]
snapshot: {"providers":[{"id":"probe","name":"Probe probe"}],
           "models":[{"provider":"probe","id":"probe-flash","name":"Probe Flash"}],"outages":[]}
real resolveModelInfo(): {"provider":"probe","id":"probe-flash","name":"Probe Flash","contextWindow":64000}
at the boundary: routed {"provider":"probe","model":"probe-flash"} 64000
past the boundary: refused context-window-too-small
unserved model: {"candidate":"probe/ghost","route":{"provider":"probe","model":"ghost"},"role":"preferred",
                 "outcome":"refused","reason":"route-absent",
                 "detail":"probe: provider \"probe\" has no configured model \"ghost\""}
unregistered provider: refused route-absent
PROBE_OK
```

То есть: структурный тип привязки совпадает с реальным реестром; вложенное `context.contextWindow`
доходит до порта; граница окна держится на реальном реестре; **реальный** отказ `UNKNOWN_MODEL`
классифицируется как `route-absent`, а не как outage.

### 6.5 Сверка примеров API с реальным SDK (не по памяти)

Прочитано в чекауте `C:\Reposit\deepseek-harness\deepseek-harness`:

- `packages/llm/llm/src/types.ts` — `LlmProviderInfo { id, name }`, `LlmModelInfo { provider, id, name,
  description?, inputModalities? }`, `LlmResolvedModelInfo` c `context?: { contextWindow: number }`,
  `TokenUsage { inputTokens, outputTokens, totalTokens? }`.
- `packages/llm/llm/src/index.ts` — `LlmRuntime` (`super(ctx, 'llm')`), `listProviders()`,
  `listModels(provider)`, `resolveModelInfo(provider, model)`, коды `INVALID_CATALOG`, `INVALID_MODEL_INFO`.
- `packages/llm/llm-pi-ai/src/adapter.ts` — `UNKNOWN_MODEL` для модели, которой у маршрута нет.
- Живой профиль владельца (только чтение): `provider: opencode-go`, `model: deepseek-v4.1-flash`
  (`settings.yaml`, `agent-default-model`) — отсюда значение по умолчанию для разработки.
  Секреты не читались и в отчёт не попадали.

## 7. Ограничения и что осталось непроверенным

1. **Durability бюджета и provenance — не эта карточка.** MW-013 владеет решением (§29/§30) и записью
   provenance как значением; персистентность ленты расходов и запись маршрута в строку attempt делает
   путь admission (MW-014) поверх схемы, которую поставил MW-012. Таблица `attempt` и её миграции в
   MW-013 сознательно не менялись, чтобы не переписывать чужой слой. Проверено только, что запись
   самодостаточна и переживает JSON round-trip.
2. **Расписание и eligibility по бюджету — MW-014.** Здесь есть гейт (`decideBudgetAdmission`), но нет
   scheduler'а: кто и когда его вызывает, решает следующая карточка. Аналогично `pause / escalate /
   human decision` (§30) — политика caller'а (`D7`).
3. **Тарифы — конфигурация deployment'а.** DSH цен не публикует, поэтому `ModelRateTable` объявлен, но
   загрузка тарифов из слоёв §6 в объём не входит: без тарифа стоимость честно неизвестна, и
   fail-closed правило (`D2`) останавливает работу, пока тариф не задан. Это ожидаемое поведение по
   решению владельца, а не дефект, но оно заметно: при объявленном `maxCostPerTask` и отсутствии тарифов
   работа встанет.
4. **Живой профиль владельца не проверялся.** Привязка проверена тремя способами: на **настоящем**
   `LlmRuntime` из чекаута DSH (проба §6.4), на реальном Cordis-контексте с fake-сервисом `llm` (тест) и
   на изолированном профиле (`verify:profile`). Здесь важная поправка, найденная ревью (F6): в шаблоне
   `sdk-minimal` сервис `llm` **есть** — `packages/bundle/sdk-minimal/cordis.patch.yml` монтирует
   `- id: llm / name: '@deepseek-ai/dsh-llm'`, и ни один прогон `verify:profile` не выдал строку
   «`llm` is not mounted». То есть в собранном профиле привязка нашла **настоящий** реестр, а не
   отработала ветку «сервиса нет» — результат сильнее того, что было записано здесь ранее (прежняя
   формулировка «сервиса `llm` там, вероятно, нет» была неверной). Что происходит при монтировании в
   живой профиль владельца, по-прежнему **не проверялось** — это его решение и отдельное действие.
5. **`FakeModelCatalog` покрывает использованные пути, а не весь порт.** Например, «listModels вернул
   модели, но resolve упал с transport-кодом» проверяется inline-стабами в тесте, а не фейком.
6. **Зависимости приняты по артефактам, а не отдельным актом владельца** — см. оговорку в §1
   (владелец принял её, продолжив карточку; открытым вопросом она больше не является).
7. **Два поведения оставлены осознанно и названы, а не «исправлены»** (F7, F8 из §8.1): бросающий
   синхронный `listProviders()` распространяется наружу (сворачивать его в пустой каталог значило бы
   ответить «маршрута нет» там, где никто не был опрошен), и сводная причина отказа — причина первого
   кандидата (первичная диагностика; весь разбор с outage'ами лежит в `evaluations`). Оба теперь
   закреплены тестами (`a catalog that cannot name its providers at all fails loud…`,
   `a refusal names the first candidate that failed…`), а не только докблоками.
8. Независимое ревью MW-013 — §8; исправления по находкам первого ревью прошли **verify-fixes**
   (`FIXES PARTIALLY VERIFIED`, остаток N1 закрыт), но **третьего прохода по свежим правкам не было** —
   ревью-статус снят владельцем до него, и это записано в шапке отчёта как остающаяся неопределённость.

## 8. Независимое ревью

**Вердикт ревьюера: `PASS WITH FINDINGS`** — 1 MAJOR + 5 MINOR + 2 NIT. Ревьюер работал отдельным
субагентом в режиме review (read-only, состязательно), со своими пробами и мутациями: он
воспроизвёл все числа этого отчёта (§5) — `pnpm run check` 439/416/0 (на момент ревью, до правок),
routing 16/16, budget 13/13, мутации автора M2/M3/M4 = 4/2/2 падения, `verify:profile: PASS`,
`PROBE_OK` — и подтвердил три критерия приёмки **своими** вызовами, а не тестами автора. Он же нашёл
два места, где тесты не могли упасть (F2, F4), и одно неверное утверждение в этом отчёте (F6).

Запуск назван явно, потому что ограничение карточки запрещает субагентов-**исполнителей** и платные
пробы, но не отменяет требование не считать self-review приёмкой: ревьюеру отдельно запрещены свои
субагенты, платные пробы, другие модели, запись вне `.tmp/` и любое касание живого профиля, доски и
чужих файлов. Ему были переданы приоритетные гипотезы для опровержения и явный список вне объёма.

### 8.1 Находки и их судьба

| # | Severity | Находка | Что сделано |
|---|---|---|---|
| F1 | **MAJOR** | `chargeConsumption` дефолтила пропущенное измерение в `knownAmount(0)` и **сообщала его как измеренный ноль** в `charged`, вопреки «no zero default»; проба: `chargeConsumption(c, { attempts: 1 })` → admission проходит при `maxTokensPerTask: 1` («потратили, но не записали») | **Исправлено в два прохода.** Сначала `charged` перестал выдумывать ноль (размерность отсутствовала), но верификатор показал остаточную дыру (N1 ниже): `consumption` при пропуске оставалась прежней, и **следующий измеряющий себя** admission проходил с `used = 0`, то есть потолок можно было молча превысить. Итог: пропущенная размерность записывается как **unknown** (`unknownAmount("the charge measured no tokens, …")`), настоящий ноль требует явного `knownAmount(0)`, а `addAmounts` не даёт позднему измеренному расходу «вылечить» неизвестность. Тест `an unmeasured settlement cannot be laundered by a later measured admission` воспроизводит ровно пробу верификатора |
| N1 | MINOR (остаток F1) | «Пропуск размерности + измеряющий себя наследник» остаётся невидимым для гейта: settlement `{attempts: 1}` → admission `tokens: known(200)` при лимите 1000 → admitted с `used={known,0}` | **Исправлено** тем же изменением: `consumption.tokens` становится unknown, и такой admission отклоняется `limit-unverifiable` (мутации «omitted-dimension-as-zero» → 2 падения, «ledger-ignores-unknown» → 3 падения) |
| N2 | NIT | Закрытая форма `limits` смотрела только own-ключи: `Object.create({maxTokensPerTasks: 0})` → admitted | **Исправлено.** `requirePlainLimits` отвергает не-плоский объект (прототип, отличный от `Object.prototype`/`null`, и массивы), а обход имён идёт и по цепочке прототипов — так унаследованное валидное имя тоже не применяется без проверки. Мутация «prototype-refusal-disabled» → 1 падение |
| N3 | NIT | F8 (сводная причина = первый кандидат) был закреплён только докблоком: мутация «reason последнего кандидата» выживала 18/18 | **Исправлено.** Тест `a refusal names the first candidate that failed, while the walk keeps every reason` (preferred → `route-absent`, fallback → `provider-outage`) различает первое и последнее; мутация «summary-reason-last-candidate» → 1 падение |
| F2 | MINOR | Токеновая половина правила D2 не покрыта: мутация «снять `request.tokens ?? unmeasured('tokens')`» выживала 13/13 | **Исправлено.** Добавлены проверки token-половины, включая потолок `0` с неизмеренным запросом; мутация M5 теперь даёт 2 падения (§5) |
| F3 | MINOR | Фейк писал `resolvedRoutes` только при успешном resolve, поэтому `deepEqual(…, [])` не различал «спросили» и «не спросили»; докблок был неверен | **Исправлено.** Геттер переименован в `askedRoutes` и пишет маршрут **до** ответа; тесты обновлены: «маршрута нет» теперь доказывается пустым `askedRoutes`, а «провайдер обслуживает, но модель не та» — наоборот, `['glm/sonnet']` |
| F4 | MINOR | Мутация «снять outage-шорткат по снимку» выживала 16/16: фейк отвечал одинаковым текстом и на листинг, и на resolve | **Исправлено.** Отказы фейка теперь разные (`did not answer the catalog listing` / `… the exact model lookup`), тест про outage проверяет именно листинговую фразу, и добавлен тест `an outage recorded in the snapshot is not re-asked through the exact-model lookup` со стабом, который ответил бы успешно, если бы его спросили. Мутация M6 теперь даёт 2 падения |
| F5 | MINOR | Неизвестные ключи `limits` игнорировались: `{ maxTokensPerTasks: 0 }` (опечатка) → admitted | **Исправлено.** Форма `limits` закрыта (как формы §13): неизвестное имя — `TypeError`. Мутация M8 ловится |
| F6 | MINOR | **Неверный факт в отчёте**: в шаблоне `sdk-minimal` сервис `llm` есть (`packages/bundle/sdk-minimal/cordis.patch.yml`, строка `- id: llm / name: '@deepseek-ai/dsh-llm'`), warn не срабатывал | **Исправлено в §7.4.** Проверено мной независимо: повторный `verify:profile` прошёл без строки «не смонтирован», то есть в собранном профиле привязка действительно нашла настоящий реестр — вывод сильнее прежнего |
| F7 | MINOR | `readModelCatalog` не ловит бросающий синхронный `listProviders()` — исключение вместо типизированного отказа; для реального DSH недостижимо | **Оставлено осознанно, но зафиксировано.** Сворачивать это в пустой каталог нельзя: routing ответил бы `route-absent` («маршрута нет»), хотя никто не был опрошен. Поведение задокументировано в `readModelCatalog` (`@throws`) и закреплено тестом `a catalog that cannot name its providers at all fails loud instead of inventing a route` |
| F8 | NIT | `refused.reason` = причина первого кандидата (при outage на fallback отказ выглядит как `route-absent`) | **Оставлено и закреплено тестом** (после N3): причина первого кандидата — первичная диагностика (отказ preferred), а весь разбор с outage'ами лежит в `evaluations`, поэтому ничего не скрыто |
| F9 | NIT (процесс) | Карточка требует BLOCKED при непринятых зависимостях, MW-006/007 в `READY_FOR_REVIEW`; автор пошёл по прецеденту MW-012 §1 | Подтверждено как **честная оговорка, не подмена приёмки**; решение за владельцем (§1) |

### 8.2 Что ревьюер подтвердил своими пробами

Граница «ровно на границе» собственным прогоном по всем восьми лимитам и совпадение `used`/`requested`
в отказе с объектами решения; fail-closed гейта (`ledgers: []`, `{kind:'maybe'}`, `NaN`, unknown
`used`/`charged`, `scope-not-measured`); «неизвестное ≠ ноль» для `readCallTokens`/`modelCallCost`/
`addAmounts`/`modelRateOf`; различие absence/outage и все ветки классификации, включая `UNKNOWN_MODEL`,
`catalog-invalid` и окна `0/-1/1.5/'128000'/NaN`, а также точную границу окна; withheld escalation не
только не выбирается, но и не опрашивается; `DEVELOPMENT_MODEL_POLICY` без fallback/escalation;
структурный тип сверен с реальным SDK (`llm`, синхронный `listProviders`, `context.contextWindow`,
`UNKNOWN_MODEL` из `llm-pi-ai`); бандл контроллера импортирует только `@deepseek-ai/cordis`;
§30-имена verbatim по архитектуре (строки 1933–1940); provenance самодостаточна и переживает JSON
round-trip; зависимости MW-005/006/007 подтверждены отчётами, статусами и коммитами; процессно чисто
(нет коммитов/push/stash, `.gitignore` и живой профиль не тронуты). Пробы и логи ревьюера —
`.tmp/rev013/` (scratch удалён при закрытии карточки).

### 8.3 Верификация исправлений (verify-fixes): `FIXES PARTIALLY VERIFIED` → закрыто

Второй независимый субагент проверил **дельту**, а не карточку заново: он воспроизвёл мутации
M5–M8 (2/2/1/1 падения — совпало), добавил свои M9 (старый порядок записи `askedRoutes` → 2 падения)
и M10 (сводная причина = последний кандидат → **18/18 pass**, то есть тест не различал), сверил
SHA256 бандлов до и после мутаций и подтвердил, что F2–F7 и F9 закрыты так, как заявлено.

**F1 он закрыл лишь частично** и это было верно: `charged` перестал выдумывать ноль, но `consumption`
при пропуске размерности оставалась прежней, поэтому следующий **измеряющий себя** admission проходил
с `used = 0` — потолок можно было молча превысить (его проба A/B против C/D). Моя прежняя формулировка
«страж — это гейт» была **неверна**: гейт проверяет ожидающий запрос, а не уже записанный расход.
Находки N1 (MINOR), N2 и N3 (NIT) закрыты в §8.1, каждая — со своей мутацией; N4 (устаревший scratch
прошлого ревью в `.tmp/rev013/`) — не артефакт карточки и удалён вместе с прочим scratch.

**Итог: все девять находок первого ревью и три находки верификации закрыты; независимой проверки
этих правок (третий проход) не проводилось** — статус карточки снят владельцем до этого прохода, и это
названо в шапке отчёта, а не подразумевается проверенным.

### 8.4 Что осталось непроверенным (вне объёма, по перечню верификатора)

Baseline `410/387/23` (нужен tree на base SHA), мутации автора M2–M4 (их воспроизводил первый
ревьюер), живой профиль владельца (адресуется только на чтение санкционированным `verify:profile` —
3 fingerprint'а; записи нет), доска и БД (не читались; по `git status` ни один файл storage/схемы/
доски не изменён), рекурсивный поиск по всему `.tmp/` (таймаут; проверено `.tmp/**/*.mjs` — 198
файлов — плюс логи верхнего уровня).

## 10. Коммиты

По отдельному поручению владельца («фиксы и изменения статуса с коммитами»). Серия из семи коммитов,
по одному на слой, `type(scope): subject`, тело объясняет *почему*, трейлер `Cards: MW-013.` в каждом:

| SHA | Коммит | Содержимое |
|---|---|---|
| `f85f88d` | `feat(contracts): add the model catalog port, §29 routing, and §30 budget vocabulary` | 3 новых модуля контрактов + barrel |
| `ee127d1` | `feat(core): add the model routing policy and the budget admission gate` | `core/routing.ts`, `core/budget.ts` + barrel |
| `171a715` | `feat(controller): bind the DSH LLM registry as the model-catalog port` | `controller/model-catalog.ts` + вызов в `apply` |
| `487255d` | `feat(adapter-sdk): add the model catalog fake` | `FakeModelCatalog` |
| `d1e02cd` | `test: cover model routing and the budget admission boundary` | оба новых набора тестов |
| `337ea69` | `docs(readme): document model routing and the budget gate` | раздел README |
| `3bc6c78` | `chore(repo): ignore workspace archive snapshots` | правило `/*.rar`, `/*.zip`, `/*.7z` |

**Про `chore(repo)`.** Этот файл (`.gitignore`) карточке не принадлежит: правило про архивы лежало в
рабочем дереве **до** начала MW-013, его добавила другая сессия, и оно не было закоммичено. Коммит
сделан по поручению владельца закоммитить незавершённую работу, отдельным последним коммитом и с
прямым указанием в теле, что это не работа карточки. Причина не оставлять его в дереве: на диске лежит
`DSH-MyWork.rar` (41,4 МБ), и без правила он попадает в первый же `git add -A`.

Проверки после коммитов (не на рабочем дереве, а на закоммиченном состоянии): `pnpm run check` →
**exit 0**, tests 444 / pass 421 / fail 0 / skipped 23, smoke 12 `ok`; трейлеры подтверждены
`git log --format='%(trailers:key=Cards,valueonly)'` для всех семи. Рабочее дерево чистое
(`git status --short` пуст), push/merge/publish/release не выполнялись.

## 11. Воспроизведение

```sh
pnpm install
pnpm run check                                                   # ожидается exit 0: 444 tests, 421 pass, 0 fail
node --test --test-isolation=none tests/routing.test.mjs          # 19 pass
node --test --test-isolation=none tests/budget.test.mjs           # 15 pass
node scripts/verify-profile.mjs --dsh-bin <checkout>/apps/cli/lib/bin.js   # verify:profile: PASS
node .tmp/mw013-probe.mjs                                          # PROBE_OK (нужен чекаут DSH, ключ не нужен)
```

Base SHA для отчёта: `5d7b80d`; head `3bc6c78` (7 коммитов, §10). Коммит `3bc6c78` — чужая
незакоммиченная правка `.gitignore`, закоммиченная по поручению владельца отдельно от работы карточки.
