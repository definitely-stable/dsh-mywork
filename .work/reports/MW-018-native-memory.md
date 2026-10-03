# MW-018 — Реализовать Memory Fabric и Native Memory

- Статус: **DONE** — выставлен по прямому указанию владельца («изменить статус и коммиты»), а не по результату ревью. Основание приёмки: независимое ревью **PASS WITH FINDINGS** (2 MAJOR / 7 MINOR / 3 NIT, `.tmp/mw018-review/MW-018-review.md`), все находки исправлены, и проверка исправлений тем же ревьюером — **FIXES VERIFIED** (`.tmp/mw018-review/MW-018-fixes-verification.md`) с 2 MINOR + 1 NIT в дельте, которые тоже исправлены (§9.5). Ревью-статус снят владельцем; evidence приёмки — эти два отчёта и прогоны ниже.
- Реализовано: Memory Fabric §23, Native и Disabled providers (§23.8), MemoryContextProvider (§21.5) и явная degraded policy (§49); `tsc` по 12 пакетам — exit 0, `tsdown` по 12 пакетам — exit 0, `smoke: all steps passed`, полный `node --test` — **642 tests / 619 pass / 0 fail / 23 skipped** (базовая линия до правок — 574/551/0/23; новая сюита даёт 68 тестов).
- Base SHA: `9163bb5923aaa0d71aff8af8f1bdedc191fc3661` → head `23432bba0d13d6af244e9ae97d65823812bff2bb` (5 коммитов, §9.7); push/merge/publish/release не выполнялись.
- Ветка `main`, рабочее дерево чистое: `git status --short --untracked-files=all` пуст.

---

## 1. Проверка зависимостей (MW-005, MW-008, MW-016)

| Зависимость | Отчёт и его статус | Исходники (проверено, не по статусу) | Коммиты | Вердикт |
|---|---|---|---|---|
| **MW-005** Adapter SDK | `.work/reports/MW-005-adapter-sdk.md` — **DONE** | `packages/adapter-sdk/src` (8 файлов): `PORT_CONTRACTS.memory = 'MemoryProviderPort'` (`port-contract.ts:34`), `REQUIRED_CONFORMANCE_CHECKS.memory` из 9 пунктов (`conformance.ts:58`), fake-адаптер с `kind: 'memory'` (`testing.ts:859`) | `e074fac`, `0dd69e2`, `44027ee`, `829ec62` | предусловие пройдено |
| **MW-008** Artifact Store и Audit | `.work/reports/MW-008-evidence-audit.md` — **READY_FOR_REVIEW**; независимое ревью **PASS WITH FINDINGS** (1 MAJOR + 3 MINOR + 2 NIT), все находки исправлены, отдельный verify-fixes — **FIXES VERIFIED** (`.tmp/mw008-vfix/MW-008-verify-fixes.md`) | `packages/evidence/src` (7 файлов), `EVIDENCE_SCHEMA_VERSION = 3` | `fbee7a0`… | пройдено **с оговоркой** |
| **MW-016** Context Fabric | `.work/reports/MW-016-context-fabric.md` — **DONE** (статус выставлен прямым указанием владельца) | `packages/contracts/src/context.ts` (`ContextProviderPort`, `ContextCandidate`, `CONTEXT_LEVELS`), `packages/core/src/context.ts` (`discoverContext`, `materializeContextSnapshot`, `assembleContextPrompt`), `tests/context.test.mjs` | `5035661`, `6b9815a`, `a3fc25f`, `9379860`, `bb3955b` | предусловие пройдено |

### 1.1 Что проверено по исходникам, а не по строке статуса

- `pnpm run check` на дереве до правок: полный `node --test` — **574 / 551 / 0 / 23**, exit 0 (число из отчёта MW-017 §4 и воспроизведено как 625 − 51).
- `packages/contracts/src/context.ts` действительно несёт §21.4-кандидата и §21.5-порт, к которым MW-018 обязан подключаться; `packages/contracts/src/authority.ts:126` несёт строку `memory.semantic → memory-provider` (§8), `packages/contracts/src/operation.ts:53` — код `MEMORY_BACKEND_ERROR`, `packages/contracts/src/revisions.ts` — семейство `memory` (§35).
- `packages/contracts/src/ids.ts` не имел `MemoryId` — добавлен (§3), это аддитивная правка.

### 1.2 Оговорка, названная явно

Формальной приёмки владельца у **MW-008** нет: его собственный статус — `READY_FOR_REVIEW`. MW-016 и MW-017 уже строились поверх MW-008 в том же статусе и были закрыты владельцем (`DONE`). Правило карточки «зависимость не принята → BLOCKED» применено буквально: отчёт есть, независимое ревью пройдено, исправления проверены отдельным верификатором, исходники на месте, гейт-прогон зелёный — то есть зависимость как **артефакт** состоятельна, а приёмка карточки MW-008 остаётся за владельцем. Этот выбор задан владельцу вопросом до начала работы, ответ: **«идти дальше, зафиксировать оговорку в отчёте»**. Если владелец считает «принято» синонимом «приёмка зафиксирована», правильное действие — `BLOCKED`, и это его решение, а не вывод автора.

---

## 2. Сделано

### 2.1 Контракты §23 — `packages/contracts/src/memory.ts` (новый, 1403 строки)

- **Скоупы (§23.2)**: `MemoryScopeRef { type, id, parent? }` — `type` остаётся строкой для плагинов; `MEMORY_SCOPE_TYPES` — baseline `global|team|workspace|role|agent|task|attempt`; `GLOBAL_MEMORY_SCOPE`; чистые `memoryScopeKey`, `memoryScopeChain`, `memoryScopeWithin` (совпадение точное по `type`+`id`, включая цепочку родителей; global не подразумевается — запрос называет его сам, §52).
- **Виды (§23.3)**: `MemoryKind` = 9 baseline-видов + открытое расширение.
- **Provenance (§23.5)**: `MemorySourceRef { uri, revision?, type }` — **ссылки, без поля под payload**; `MEMORY_SOURCE_REF_FIELDS` это фиксирует; `MemoryAuthor { component, run? }`.
- **Trust (§23.6)**: `MemoryTrustClass` = `very-high|high|medium|low`, `MEMORY_TRUST_RANK`, таблица `MEMORY_TRUST_CLASSES_BY_SOURCE` (9 классов §23.6 как данные), `contextTrustOfMemoryTrust` — `trusted` только для `very-high`/`high`, всё остальное `untrusted`.
- **Validity (§23.5)**: `MemoryValidity { from?, until? }`, `memoryValidAt`; отсутствующая граница — открытая.
- **Lifecycle (§23.4)**: `MemoryStatus` = `candidate|active|stale|superseded|invalidated|archived`, `SERVED_MEMORY_STATUSES = ['active']`, таблица `MEMORY_TRANSITIONS`, `isAllowedMemoryTransition`, `memoryTransitionTargets`.
- **Запись (§23.5)**: `MemoryRecord` — `statement`, `scope`, `kind`, `sources`, `createdBy`, `trust`, `confidence?`, `validity`, `supersedes`, `status`, §35-`revision`, `contentHash`, `fingerprint`, `retainedAt`, `statusChangedAt`, `reinforcedCount`; закрытая форма `MEMORY_RECORD_FIELDS`.
- **Запросы и результаты**: `MemoryProposal` (+ `validation: 'immediate'|'staged'`), `MemoryRetainRequest/Result`, `MemoryRecallRequest/Result` (+ `MemoryServingDecision`/`MemoryServingReason`), `MemoryReflectRequest/Result`, `MemoryResolveRequest/Result`, `MemoryValidateRequest`, `MemoryTransitionRequest/Result`, `MemoryNamespaceRevision`.
- **Отказы и диагностика (§42, §33, §49)**: `MemoryRefusalReason` (9 причин) + `MEMORY_REFUSAL_CODES` (маппинг на существующие коды §42, новых кодов не вводилось), `MemoryDiagnosticCode` (12) + `MemoryDiagnostic`.
- **Маршруты и политика (§23.9, §49)**: `MemoryRoute { match: { scope? }, primary, optional }` — **маршрутизация по скоупу**, потому что §23.9 и карточка требуют один primary writer на scope; `MemoryPolicy { routes, timeoutMs, diagnosticLimit }`; `DEFAULT_MEMORY_POLICY` — пустые маршруты (неавторизованный скоуп отказывает, а не «куда-нибудь пишет»).
- **Порт провайдера (§23.8)**: `MemoryProviderPort` (`capabilities`, `retain`, `recall`, `reflect?`, `resolve?`, `health`), `MemoryCapabilities`, `MemoryHealth` (это и есть §23.8 `HealthResult`), `MemoryWriteMode`, провайдерские request/outcome-типы, `MemoryProviderBinding`.
- **Порт фабрики**: `MemoryFabricPort` — `retain/recall/reflect/resolve/validate/transition/routeFor/routes/diagnostics/namespaceRevision`.

### 2.2 Ядро §23 — `packages/core/src/memory.ts` (новый, 1676 строк)

- `createMemoryRevisionRegistry()` — §35-семейство `memory` по fingerprint (как `createSkillRevisionRegistry`).
- `createMemoryFabric(options)`:
  - **Один primary writer на scope (§23.9)**: скоуп → первый подходящий маршрут → его `primary`; нет маршрута или провайдер не связан → отказ `scope-unrouted` (`CONTRACT_MISMATCH`) + диагностика `route-missing`, и **ни одной записи**. Суперсед записи, которой владеет другой провайдер → отказ `not-primary` (`SECURITY_DENIED`).
  - **§23.4-конвейер в `retain`**: валидация предложения на границе → маршрут → `recall` у primary → dedup по `memoryClaimKey` (`scope|kind|нормализованное утверждение`) → conflict detection → §23.6-гейт по trust → запись. Идемпотентность: то же предложение → `created:false`, `reinforced:true`, тот же id и та же §35-ревизия, `reinforcedCount+1`. Другое содержимое того же claim → «Update»: старая запись переводится в `superseded`, публикуется новая (её `supersedes` называет предшественника). Более слабый trust не переписывает более сильный (§23.6) → `conflict` (`TASK_CONFLICT`), и **до** первой записи, поэтому отказ ничего не меняет.
  - **Порядок записи при суперседе**: сначала старые записи → `superseded`, затем новая. Отказ на полпути оставляет память непротиворечивой (либо старый claim ещё держится, либо он снят, и повтор того же предложения дописывает замену); обратный порядок оставил бы два активных claim'а. Атомарности двух записей не заявляется (см. §8).
  - **§49 degraded policy**: `callProvider` спрашивает `health()` перед каждым вызовом и ограничивает вызов дедлайном `policy.timeoutMs`. Недоступность/таймаут: маршрут `optional: true` → пустой ответ с `degraded: true` и диагностиками (`disabled`/`provider-unavailable`/`timeout` + `degraded`); `optional: false` → отказ с кодом §42. **Запись не деградирует никогда** — непринятая запись сообщается отказом. Группировка запроса идёт по паре **(провайдер, право на деградацию)**, а не по одному провайдеру: иначе разрешение optional-скоупа распространялось бы на required-скоуп с тем же primary, и ответ зависел бы от порядка скоупов (находка F1 ревью, §9.3).
  - `recall` применяет одну serving-функцию, сортирует (trust ↓, затем новизна ↓, затем id) и применяет `limit`; деградировавший ответ оставляет по одной диагностике `degraded` **на каждый** покрытый скоуп.
  - `resolve` — ссылка адресуется **по идентичности, а не по скоупу** (§52 разрешает reference links между workspace): locator — кэш «где фабрика видела запись», а не источник истины, поэтому id из снимка или из засеянного провайдера разрешается, а неизвестный даёт `invalid-ref`; если провайдер, который мог бы её держать, недоступен, возвращается причина недоступности, а не ложный `invalid-ref`. Перечисление (`recall`) остаётся скоуп-связанным.
  - `validate`/`transition` — единственный путь смены статуса, по таблице §23.4, с §8-авторизацией; `reflect`/`resolve` не создают записей.
  - `diagnostics()` — ограниченный лог (`diagnosticLimit`, по умолчанию 50, хранится новейшее).
  - `namespaceRevision` — §35-номер namespace по fingerprint обслуженных записей + флаг `degraded`.
  - Идентификаторы записей минтит фабрика, счётчик **на экземпляр фабрики**: две фабрики над одним провайдером не сталкиваются (находка F7 ревью, §9.3).
- `memoryServeRefusal(record, request)` — **одно правило обслуживания** для recall, discovery и materialization: scope → status → validity → kind → minTrust → query.
- `createMemoryContextProvider(options)` → `MemoryContextProvider` (`ContextProviderPort`):
  - `capabilities()` — `classes: ['memory']`, все уровни, `onDemandMaterialization: true`, `scopeKinds` из маршрутов;
  - `discover()` — L0/L1, только утверждение и метаданные; отказ фабрики → `MyWorkError` с кодом §42 (не молчаливый пустой список);
  - `materialize()` — только L2, со сверкой `expectedRevision`/`expectedContentHash` и **той же проверкой обслуживания**, что у discovery (запись, снятая между проходом и выборкой, тело не отдаёт);
  - `serving()` — решения по каждой записи + диагностики + `degraded` + `refusal` (для диагностики);
  - `namespaceRevision()` — для `ContextSnapshot.memoryRevisions`;
  - `memoryTextOf(record, level)` — L0 (вид + первая строка), L1 (утверждение + trust/scope/status), L2 (+ ссылки на источники). Ни на одном уровне нет ничего, что могло бы прийти из payload источника;
  - `itemHashOf(record)` — один хеш на оба уровня: кандидат публикует его, `materialize` его же возвращает, потому что §21.5 заставляет вызывающего назвать ожидаемый хеш. Разные хеши на L1 и L2 делали бы любую выборку тела похожей на «источник уехал» (дефект найден собственным аудитом после первой редакции тестов, §9.3).

### 2.3 Native и Disabled providers — `packages/memory-native` (новый пакет, §45)

- `createNativeMemoryProvider(options)` — процессный `MemoryProviderPort`: `Map` по id, `retain` (`create`/`reinforce`/`replace`; смена **содержимого** под тем же id отклоняется `TASK_CONFLICT` — §23.4 «Supersede» это новая запись, называющая старую; сравнивается весь контент записи, а не только хеш утверждения, иначе `replace` мог бы увести запись в другой workspace или понизить её trust — находка F9 ревью, §9.3), структурный `recall` (по скоупам, `ids`, видам, `limit`), `reflect` (детерминированный дайджест: сколько записей, сколько активных на момент, утверждения активных), `resolve`, `health`, плюс read-only `records()`/`find()`.
- `createDisabledMemoryProvider(options)` — объявляет нулевые возможности, `health()` = `available:false, reason:'disabled'`, а `retain`/`recall`/`resolve` **бросают** `ADAPTER_UNAVAILABLE`: пустой список был бы успешным ответом «ничего не известно», а выключенный backend не должен уметь так говорить.
- Пакет самодостаточен (bundle contracts + core, как scheduler/planner/adapters); fabric читает код ошибки **структурно**, а не через `instanceof`, поэтому встроенная копия `MyWorkError` не превращает конфликт в «недоступность».

### 2.4 Тесты — `tests/memory.test.mjs` (новый, 68 тестов)

См. §5 — каждый пункт приёмки карточки привязан к конкретному тесту; 13 тестов добавлены вторым проходом по находкам независимого ревью и собственному аудиту, ещё 4 — третьим, по находкам прохода `verify-fixes` (§9.3, §9.6).

### 2.5 Решения по объёму (названы, чтобы ревьюер мог оспорить)

1. **Durability не заявляется.** По прямому решению владельца (вопрос задан до начала работы) Native provider — процессный реестр, как skill registry в MW-017 §6.3. §23.1 требует «долговременной» памяти; этот провайдер ею не является, и это сказано в его собственном docstring, а не умолчано.
2. **Маршрутизация только по scope.** §23.9 и карточка говорят «один primary writer на scope»; `match.kind` не вводился, потому что два писателя для одного скоупа по видам — ровно тот случай, который §23.9 запрещает.
3. **`supersedes` = то, что запись реально заменила.** При неявном обновлении (тот же claim, другое содержимое) новая запись называет предшественника в `supersedes`; иначе `replacedBy` в диагностике «устаревания» неоткуда взять.
4. **Dedup учитывает только `active`/`candidate`.** `stale`/`superseded`/`invalidated`/`archived` claim не держат, поэтому повтор утверждения создаёт новую активную запись, а не «усиливает» снятую.
5. **Reinforce не меняет trust/sources/confidence.** Повторное наблюдение того же утверждения считается, но не переписывает провенанс; чтобы поднять trust, публикуется новая запись (Update).
6. **Отказы маппятся на существующие коды §42** (`TASK_CONFLICT`, `SECURITY_DENIED`, `CONTRACT_MISMATCH`, `ADAPTER_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`); новых кодов в `MyWorkErrorCode` не добавлено, хотя для «запись не найдена» точного кода в словаре нет — выбран ближайший (`TASK_CONFLICT`), и это видно в `MEMORY_REFUSAL_CODES`.
7. **Дедлайн — настенный таймер**, а не инъецируемые часы: дедлайн, который вызывающий может подвинуть, не является дедлайном. Инъецируемый клок задаёт только отметки времени.
8. **Reflection не ретайнится.** §23.8 не говорит, что делать с результатом; превращение рефлексии в запись — путь обучения §25, а не этого порта.
9. **Вне объёма, названо явно:** conformance-набор §39 для `memory` (в `packages/adapter-sdk/src/conformance.ts:13-14` он отнесён к карточке, монтирующей внешний адаптер, то есть MW-019), регистрация в §44-реестре `myworkAdapters` и Cordis-привязка порта — как и в MW-017 §6.4; связывание конфигурационных `memoryRoutes` (строки в слоях конфигурации) с §23.9-маршрутами.

---

## 3. Изменённые и новые файлы

| Путь | Состояние | Строк (всего) | SHA-256 |
|---|---|---|---|
| `packages/contracts/src/memory.ts` | новый | 1403 | `D337BBE97CE84D47B4AB3D35A9E10D71D3B7C97941C67EEF2429524D17D2E7DF` |
| `packages/core/src/memory.ts` | новый | 1676 | `5878AE04D3142A21AF121D12DF65C6D490203B5A82EC7377E8B800855B3B80B6` |
| `packages/memory-native/package.json` | новый | — | `1C3B650BEA1D70DD0FEDAF3B495093ED69BDA2D301860CC8BB84DD17CA6548C6` |
| `packages/memory-native/tsconfig.json` | новый | — | `90B77E850BC92EECD27B0F0659ABCAFCEFF610CF4E02F8494A06E787B069F6E2` |
| `packages/memory-native/tsdown.config.ts` | новый | — | `DC101B1CC22B5C93D9AF8C1BA2442C197FC8C20AFD29E9B187E108B4CD324F8F` |
| `packages/memory-native/src/index.ts` | новый | 30 | `B718F84B369BB557946957C984C0D47996DBFBFAA87D8EB7B9ADB663D67962C3` |
| `packages/memory-native/src/native.ts` | новый | 354 | `375B39B243143CF6B2CF6D7B9018A378886152294A72082C3621431B7EA4B43A` |
| `packages/memory-native/src/disabled.ts` | новый | 98 | `DBAC8D4FAE283B94679C0881C723B8DA17AE1EA7813C7DF21A5A10D347D87E96` |
| `tests/memory.test.mjs` | новый | 1236 (68 тестов) | `04851CE9A2224DAAD3A36A342C488ADB47EFA42D417B25342E8DA78AF8CA7865` |
| `packages/contracts/src/ids.ts` | изменён (+3) | — | — |
| `packages/contracts/src/index.ts` | изменён (+1) | — | — |
| `packages/core/src/index.ts` | изменён (+17) | — | — |
| `tests/lib/fixtures.mjs` | изменён (+4) | — | — |
| `pnpm-lock.yaml` | изменён (+9) | — | — |

Строки — общее число строк файла (ревью F10: первая редакция отчёта называла непустые строки, что вводило в заблуждение).

`git diff --stat 9163bb5..HEAD`: 14 файлов, +4883 строки (5 коммитов, §9.7). `packages/*/lib/` — артефакты сборки, gitignored (`.gitignore:14`), в diff не входят. Пробы, бэкапы и логи мутаций лежат в `.tmp/` (gitignored), отчёт — в `.work/` (gitignored).

Чужие файлы не изменялись: `packages/evidence/**`, `packages/storage/**`, `packages/lease/**`, `packages/execution/**`, `packages/scheduler/**`, `packages/planner/**`, `packages/beads-adapter/**`, `packages/controller/**`, `packages/adapter-sdk/**`, `scripts/**`, остальные тесты — ни одного изменения. Живой профиль DSH, доска разработки и чужие проекты не трогались.

**О `pnpm-lock.yaml`.** `pnpm install` в этой песочнице падает (`create the temporary package manager install directory` → `Отказано в доступе. (os error 5)`, exit 1) — то же ограничение, что зафиксировал MW-016 §4 для `pnpm run build`. Поэтому importer-блок нового пакета добавлен **руками**, ровно в той форме, которую pnpm пишет для `workspace:*`-ссылок (`specifier: workspace:*` + `version: link:../…`), и проверен скриптом `.tmp/mw018-lockfile-check.mjs`, который сверяет каждый importer с `devDependencies` соответствующего `package.json` (§4).

---

## 4. Команды и exit codes

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `9163bb5923aaa0d71aff8af8f1bdedc191fc3661`, ветка `main` |
| `git add <файлы слоя> && git commit -F .tmp/mw018-msg-N.txt` (5 коммитов) | **0** ×5 | `56c5265`, `133b59d`, `43e84e9`, `1c1f091`, `23432bb`; после каждого `git status --short` чист |
| `git log 9163bb5..HEAD --format='%h %(trailers:key=Cards,valueonly)'` | 0 | трейлер `Cards: MW-018.` во всех пяти |
| `git diff --name-only 9163bb5..HEAD` | 0 | ровно 14 путей, ни одного чужого |
| `node scripts/smoke.mjs` + полный `node --test` на закоммиченном `23432bb` | **0** | `smoke: all steps passed`, **642 / 619 / 0 / 23**; `git status --short --untracked-files=all` пуст |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/<p>/tsconfig.json` (12 пакетов) | **0** ×12 | `TSC_FAILED=0`, ни одного диагностического сообщения (логи `.tmp/mw018-tsc-<p>.log`) |
| `node ../../node_modules/tsdown/dist/run.mjs` в каждом пакете (12 пакетов) | **0** ×12 | `BUILD_FAILED=0`, все бандлы пересобраны (логи `.tmp/mw018-build-<p>.log`) |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed` |
| `node --test --test-isolation=none tests/memory.test.mjs` | **0** | **68 tests / 68 pass / 0 fail** (51 → 64 → 68 по мере исправлений) |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` | **0** | **642 tests / 619 pass / 0 fail / 23 skipped** (база 574/551/0/23 → +68 тестов, регрессий нет) |
| `node .tmp/mw018-lockfile-check.mjs` | **0** | `importers=13 packages=12 failures=0`; `ok packages/memory-native: @dsh-mywork/contracts, @dsh-mywork/core` |
| `pnpm install` (дважды, второй раз с `TEMP`/`TMPDIR` внутри workspace и `--store-dir .pnpm-store`) | **1** ×2 | **отказ песочницы, а не дефект:** `create the temporary package manager install directory` → `Отказано в доступе. (os error 5)` |
| `pwsh -File .tmp\mw018-mutations.ps1` (6 мутаций) | 0 (скрипт) | каждая мутация даёт адресный отказ; восстановление — SHA-256 (§7) |
| `pwsh -File .tmp\mw018-mutation-m1c.ps1` (обе копии фильтра) | 0 (скрипт) | 60 pass / **4 fail**, включая «a record in one workspace is not a record in another»; восстановление обоих бандлов побайтово |
| `pwsh -File .tmp\mw018-mutations-delta.ps1` (5 мутаций по исправлениям F1–F9) | 0 (скрипт) | M6…M10 — по одному-два адресных отказа, все `RESTORED_IDENTICAL=True` (§7.1) |
| `pwsh -File .tmp\mw018-mutations-n.ps1` (4 мутации по исправлениям N1–N3 и R-1) | 0 (скрипт) | M11…M14 — по одному адресному отказу, все `RESTORED_IDENTICAL=True` (§7.2) |
| независимое ревью (read-only субагент) | — | **PASS WITH FINDINGS** (2 MAJOR / 7 MINOR / 3 NIT); все четыре контрольных числа воспроизведены; свои 4 мутации R-A…R-D на копиях бандлов (§9) |
| проверка исправлений (тот же ревьюер, `verify-fixes`) | — | **FIXES VERIFIED**: все 12 находок закрыты, подтверждено поведением «до/после» и 6 своими мутациями V-A…V-F; в дельте 2 MINOR + 1 NIT (§9.4–§9.6) |
| `node scripts/smoke.mjs` + полный `node --test` **после** мутаций, исправлений и правки lockfile | **0** | `smoke: all steps passed`, **642 / 619 / 0 / 23** — итоговое состояние дерева зелёное |

---

## 5. Приёмка карточки → чем доказано

| Требование карточки | Чем доказано (тесты в `tests/memory.test.mjs`) |
|---|---|
| **Изоляция workspace (§52)** | `a record in one workspace is not a record in another` (запись w1 не видна в w2, но по-прежнему видна в w1); `a task-scoped record is visible to the workspace it declares as its parent`; `global memory is served only to a request that names the global scope`; плюс мутация M1c, которая ломает **обе** копии фильтра и валит ровно эти тесты (§7) |
| **Idempotent retain** | `the same claim proposed twice is one record, reinforced rather than duplicated` (`created:false`, `reinforced:true`, тот же id, та же §35-ревизия, `reinforcedCount=1`, в провайдере одна строка); `whitespace and case do not make a second record`; `retrying an update reinforces the record it published, not the one it replaced` |
| **Конфликт** | `a weaker statement cannot rewrite a stronger record (§23.6)` — отказ `conflict`/`TASK_CONFLICT`, диагностика `conflict`, провайдер держит одну неизменённую запись; `a stronger statement updates the record it repeats, and the old one stops being served`; `an explicit supersede of a weaker record by a stronger one is applied`; `a record is superseded only by the provider that writes its scope` (`not-primary`) |
| **Устаревание** | `a record whose validity window closed is not served, and the recall says so` (reason `outside-validity` + диагностика), `a record whose window has not opened is not served`, `a validity window that ends before it starts is refused at the boundary`; решения по каждой записи: `considered[].reason`/`replacedBy`; `a superseded record is refused by materialization even after it was proposed as context` |
| **Invalid ref** | `a reference nobody holds is refused as an invalid ref, and a held one resolves` (`invalid-ref`/`TASK_CONFLICT` + диагностика); `an explicit supersede of an unknown record is refused, and nothing is written` (провайдер пуст); `validating a record that is not a Candidate is refused`; `the lifecycle refuses a move it does not declare, and allows the ones it does` |
| **Timeout** | `a provider that never answers degrades an optional route inside the policy timeout` (реальный дедлайн, `degraded:true`, диагностики `timeout`+`degraded`, замер паузы); `a provider that never answers refuses a required route with the timeout reason` (и `retain` тоже) |
| **Недоступность optional memory допустима только по policy и видна в diagnostics** | `a disabled backend degrades an optional route and says so` (`ok:true`, пусто, `degraded:true`, диагностики `disabled`+`degraded`, запись в `fabric.diagnostics()`); `a required route refuses instead of degrading` (`provider-unavailable`/`ADAPTER_UNAVAILABLE`); `a write never degrades: a disabled backend refuses the retention`; `diagnostics are bounded and keep the newest`; `a scope with no route has no primary writer, and the fabric refuses rather than guessing` |
| **Raw transcripts не копируются в prompt** | `a raw transcript reaches the prompt as a reference and never as content` — полный путь discovery → snapshot → `assembleContextPrompt`: утверждение в prompt есть, текст транскрипта (`TRANSCRIPT-MARKER-9f3a …`) — нет, item получает `placement: 'data'`, `mandatory: false`, prompt обёрнут `<<<mywork:data>>>`; `discovery proposes a statement at L1 and carries no source payload` (провенанс цитирует `session:abc#turn-4`, а `MEMORY_SOURCE_REF_FIELDS` не содержит ни `text`, ни `content`, ни `payload`, ни `body`); `medium trust is proposed as data, and never as an instruction`; мутация M5 (§7) показывает, что проверка провенанса не вакуумна |
| **retain/recall/optional reflect (§23.8)** | `reflection is served where the provider implements it, and is not retained`; `a provider without reflection is refused, not answered with an empty digest` (`reflect-unsupported`/`CAPABILITY_UNSUPPORTED`) |
| **Scopes/kinds/provenance/trust/validity (§23.2–§23.6)** | `a claim is scoped: the same statement in another scope is another record`; `a claim is kinded…`; `a record below the trust floor is left out of a recall and named`; `served records come back strongest first, then newest`; `the claim key is the scope, the kind, and the normalized statement` |
| **Один primary writer на scope (§23.9)** | `a scope is written by the provider its route names, and read back from it`; `a route that names an unbound provider is refused, not silently served elsewhere`; `a record is superseded only by the provider that writes its scope` |
| **§23.4 lifecycle целиком** | `a staged proposal is a Candidate that is not served until it is validated`; `the serving rule names every reason it can refuse a record` (не-вакуумный цикл: сначала `assert.equal(MEMORY_SERVING_REASONS.length, 7)`, затем по кейсу на каждую причину) |
| **§8 authority** | `only the memory-provider actor may retain` (`SECURITY_DENIED`) |
| **§21.2 L0/L1/L2 (§62 п.20)** | `§21.2 levels are disclosed as the card asks: L0 is an abstract, L2 the provenance`; `materialization serves the statement with its provenance and refuses a lower level`; `discovery serves nothing when the fabric asks for another class`; `the namespace revision is stable while memory is unchanged, and moves when it changes` |
| **§62 п.24 (Memory Fabric interfaces)** | `packages/contracts/src/memory.ts`: `MemoryProviderPort` (§23.8) + `MemoryFabricPort` + маршруты/политика; `a fabric built without a policy refuses every scope rather than remembering`; `a policy route must say whether memory is optional, because §49 turns on it` |
| **§62 п.25 (Native Memory provider)** | `packages/memory-native`: `the native provider refuses to rewrite a record it already holds`; `the native provider answers structurally: by scope, by kind, by id and by limit`; `the disabled provider declares nothing and fails closed`; `a proposal is validated at the boundary` |

### 5.1 Тесты, добавленные после первого прохода (находки ревью, дельта-проверки и собственный аудит)

| Источник | Что добавлено | Тест |
|---|---|---|
| F1 (MAJOR) | required-скоуп не деградирует из-за optional-скоупа с тем же primary; ответ не зависит от порядка скоупов; `discover` падает, а не молчит | `a required scope does not degrade because an optional scope shares its provider` |
| F1 (диагностика) | деградировавший ответ называет **каждый** покрытый скоуп | `a degraded answer names every scope it covers` |
| F2 (MAJOR) | `reflect` при висящем провайдере — отказ с кодом §42 и диагностикой, а не исключение | `reflection against a provider that never answers is a refusal, not a thrown error` |
| F2 (второй путь) | `reflect` при выключенном провайдере — отказ `provider-unavailable` с диагностикой `disabled` | `reflection against a disabled provider is refused with the §42 code and a diagnostic` |
| F3 | фабричный `limit` возвращает ровно столько записей в документированном порядке | `the fabric-level limit returns exactly that many records, in the documented order` |
| F3 | claim, который держит `stale`-запись, публикуется заново, а не «усиливается» | `a claim held by a stale record is published anew rather than reinforced` |
| F4 | `validation:'immediate'` по тому же claim не «усиливает» Candidate, а публикует активную запись | `an immediate proposal does not reinforce the Candidate that was waiting on it` |
| F5 | lifecycle-проверка на пути materialization действительно может отказать (окно закрылось между проходом и выборкой) | `materialization refuses a record whose window closed after it was proposed` |
| F7 | две фабрики над одним провайдером пишут обе | `two fabrics over one provider both retain` |
| F8 | свежая фабрика разрешает запись, которую провайдер уже держит; неизвестный id — по-прежнему `invalid-ref` | `a fresh fabric resolves a record the provider already holds` |
| F9 | `replace` не может увести запись в другой скоуп или понизить trust, но смена состояния разрешена | `the native provider refuses a replace that moves the record to another scope` |
| собственный аудит | хеш кандидата и хеш тела совпадают; `materialize` принимает ожидаемый хеш | `the hash a candidate publishes is the hash materialization returns` |
| собственный аудит | снапшот с `requestedFullContent` действительно материализует memory-item на L2 | `a snapshot that asks for the full content of a memory item materializes it` |
| N1 (MINOR) | `replace` не может сдвинуть `retainedAt` (по нему идёт порядок выдачи) | `a replace cannot move when a record was retained` |
| N2 (MINOR) | неизвестная ссылка остаётся `invalid-ref`, даже когда чужой провайдер недоступен, а сам факт недоступности виден в диагностике | `an unknown reference stays an invalid ref even when another provider is down` |
| R-1 (MINOR, собственный) | недоступность провайдера, который **держал** запись, — это отказ по доступности, а не ложный `invalid-ref` | `a reference whose provider went down is an outage, not an invalid ref` |
| N3 (NIT) | диагностика отказа не зависит от порядка перечисления скоупов | `a refusal carries the same diagnostics whichever order the scopes are listed in` |

---

## 6. Evidence

### 6.1 Полный конвейер (итоговое состояние дерева)

```
TSC_FAILED=0
BUILD_FAILED=0
smoke: all steps passed
ℹ tests 642   ℹ pass 619   ℹ fail 0   ℹ skipped 23
FULL_TEST_EXIT=0
```

### 6.2 Сквозной путь «память → prompt» (фрагмент из пробы `.tmp/mw018-probe.mjs`, exit 0)

```
[12] candidates= [ 'memory:mem-2|memory|trusted|L1' ]
[13] snapshot kind= materialized
[14] placements= [ 'memory:mem-2:data' ]
[15] prompt has statement= true
[16] prompt has raw transcript= false
[17] prompt= "<<<mywork:data>>> kind=memory source=memory-fabric\n[experience] Run the narrow check first, then widen by risk.\ntrust: very-high | scope: workspace:w1 | status: active\n<<<mywork:end>>>"
```

### 6.3 Ключевые отказы (из той же пробы)

```
[2] idempotent created= false reinforced= true count= 1 same id= true
[5] update created= true superseded= [ 'mem-1' ] id= mem-2
[7] weaker update refused= conflict TASK_CONFLICT
[8] invalid ref refused= invalid-ref TASK_CONFLICT
[9] optional degraded ok= true records= 0 degraded= true codes= [ 'disabled', 'degraded' ]
[10] required refused= provider-unavailable ADAPTER_UNAVAILABLE
[11] timeout after 20 ms ok= true degraded= true codes= [ 'timeout', 'degraded' ]
```

---

## 7. Mutation-check (проверка, что тесты умеют падать)

Драйвер: `.tmp/mw018-mutations.ps1`, `.tmp/mw018-mutation-m1c.ps1`. Каждая мутация глушит **тело** одной функции в собранном бандле (имя сохранено), затем прогоняется узкая сюита, бандл восстанавливается из бэкапа, и восстановление доказывается SHA-256. Числа ниже — прогон на итоговой сюите (64 теста); на первой редакции (51 тест) те же мутации валили те же тесты, счётчики были на 13 меньше.

| # | Мутация (файл) | Exit | Наблюдение |
|---|---|---|---|
| M1 | `memoryScopeWithin` игнорирует id скоупа — копия в `packages/core/lib/index.js` | 1 | 63 pass / **1 fail**: `the serving rule names every reason it can refuse a record` |
| M1b | то же — копия в `packages/memory-native/lib/index.js` | 1 | 63 pass / **1 fail**: `the native provider answers structurally: by scope, by kind, by id and by limit` |
| M1c | то же в **обеих** копиях | 1 | 60 pass / **4 fail**: `a record in one workspace is not a record in another`, `a task-scoped record is visible to the workspace it declares as its parent`, `the serving rule names every reason…`, `the native provider answers structurally…` |
| M2 | `dedupable` → `false` (дедупликация не срабатывает) | 1 | 57 pass / **7 fail**: все тесты идемпотентности, обновления, суперседа и staged/immediate |
| M3 | гейт §23.6 → `if (false)` | 1 | 63 pass / **1 fail**: `a weaker statement cannot rewrite a stronger record (§23.6)` |
| M4 | причина `disabled` подменена на `provider-unavailable` | 1 | 60 pass / **4 fail**: три теста disabled-провайдера и `reflect` при выключенном провайдере |
| M5 | ссылки на источники не попадают в провенанс | 1 | 62 pass / **2 fail**: `discovery proposes a statement at L1 and carries no source payload`, `materialization serves the statement with its provenance…` |

**Что M1/M1b/M1c показывают по существу:** изоляция §52 держится **двумя** слоями — провайдер фильтрует по скоупу, и serving-функция фабрики фильтрует повторно. Поэтому M1 или M1b по отдельности валят только свой адресный тест, а тест изоляции остаётся зелёным; M1c (обе копии) валит уже и его. Это осознанное свойство, а не совпадение: «невидимость» записи не должна зависеть от того, честно ли провайдер отфильтровал выдачу.

**Инцидент в первом прогоне M1c (назван честно).** Первая версия скрипта брала имя бэкапа из имени файла (`index.js`), поэтому бэкап `core` был перезаписан бандлом `memory-native`, и восстановление подменило `packages/core/lib/index.js`. Это было **обнаружено** проверкой `RESTORED_IDENTICAL=False` и падением сюиты (1 pass / 50 fail), а не оставлено незамеченным. Исправление: `tsdown` пересобрал `core`, SHA совпал с до-мутационным (`A79B6736F2C50FA0EFBD83DCF5596EAFFC1EC384379B45D666121CF99F84C54C` — сборка детерминирована, то есть подмена полностью устранена), затем скрипт поправлен на различные имена бэкапов и M1c прогнан заново: `RESTORED[both] IDENTICAL=True`. Итоговый полный прогон после всех мутаций — 638/615/0/23, exit 0.

**Ограничение доказательства:** мутации M1b/M1c относятся к `packages/memory-native/lib/index.js` и `packages/core/lib/index.js`; обе копии после прогонов побайтово восстановлены (`CORE_SHA=7F230DF1034B4F842AE352B793E2F222790EB6445D7A73A58B167197B9E50DBB`, `NATIVE_SHA=60DB7D946958DC15B1C73AB6FFB6898B30FB6BE3B40FF5C487DEFE8F41BF558B` — значения после исправлений по находкам ревью; до них были `A79B6736…`/`6D2CC0E1…`, и обе пары совпадают с тем, что оставил соответствующий прогон).

### 7.1 Мутации по исправлениям находок ревью (`.tmp/mw018-mutations-delta.ps1`)

| # | Мутация (что возвращается к дефекту) | Exit | Наблюдение |
|---|---|---|---|
| M6 | кандидат публикует хеш своего уровня, а не общий `itemHashOf` | 1 | 62 pass / **2 fail**: `the hash a candidate publishes is the hash materialization returns`, `a snapshot that asks for the full content of a memory item materializes it` |
| M7 | группировка recall только по провайдеру (F1) | 1 | 63 pass / **1 fail**: `a required scope does not degrade because an optional scope shares its provider` |
| M8 | `reflect` пропускает охрану отказа (F2) | 1 | 62 pass / **2 fail**: `reflection against a provider that never answers is a refusal, not a thrown error`, `reflection against a disabled provider is refused with the §42 code and a diagnostic` |
| M9 | native `replace` сравнивает только `contentHash` (F9) | 1 | 63 pass / **1 fail**: `the native provider refuses a replace that moves the record to another scope` |
| M10 | `validation` убран из fingerprint (F4) | 1 | 63 pass / **1 fail**: `an immediate proposal does not reinforce the Candidate that was waiting on it` |

Все пять восстановлены побайтово (`RESTORED_IDENTICAL=True` ×5), после прогона сюита — **64/64, exit 0**.

### 7.2 Мутации по исправлениям дельта-прохода (`.tmp/mw018-mutations-n.ps1`)

| # | Мутация (что возвращается к дефекту) | Exit | Наблюдение |
|---|---|---|---|
| M11 | недоступность провайдера-владельца больше не сообщается (R-1) | 1 | 67 pass / **1 fail**: `a reference whose provider went down is an outage, not an invalid ref` |
| M12 | неудача неотносимого провайдера снова становится ответом (N2) | 1 | 67 pass / **1 fail**: `an unknown reference stays an invalid ref even when another provider is down` |
| M13 | группы снова идут в порядке карты (N3) | 1 | 67 pass / **1 fail**: `a refusal carries the same diagnostics whichever order the scopes are listed in` |
| M14 | `replace` снова может сдвинуть `retainedAt` (N1) | 1 | 67 pass / **1 fail**: `a replace cannot move when a record was retained` |

Все четыре восстановлены побайтово, после прогона сюита — **68/68, exit 0**; итоговые бандлы `CORE_SHA=2686084314E030ACE3DE3F7C3C358C899E8E13EA5C82AEADD044738C6828132E`, `NATIVE_SHA=9CDACBE08736DF8DA32BC5F8E1B7774067D0BD1978858794B99B6560E888C781`.

---

## 8. Ограничения и что осталось непроверенным

1. **Независимое ревью проведено** (read-only субагент, свежий контекст) — вердикт **PASS WITH FINDINGS**, исправления проверены тем же ревьюером (**FIXES VERIFIED**); его дельта-находки N1–N3 и собственный остаточный дефект R-1 исправлены и покрыты тестами (§9). Приёмка карточки остаётся за владельцем: ни ревью, ни проверка исправлений её не заменяют.
2. **MW-008 остаётся `READY_FOR_REVIEW`** (§1.2). Это решение владельца, а не вывод автора.
3. **Durability нет.** Native provider процессный: рестарт процесса теряет реталнутую память. Долговечное хранилище — отдельное решение (схема, миграции, §47 `memory_routes`), в объём карточки не входило и владельцем не запрашивалось. Следствие, названное явно: идентификаторы записей минтит фабрика со счётчиком на экземпляр, поэтому провайдер, переживающий процесс, нуждается в собственном источнике id — это работа карточки, которая его связывает.
4. **Суперсед — две записи, не одна транзакция.** Порядок (сначала старые → `superseded`, затем новая) выбран так, чтобы отказ на полпути не оставлял двух активных claim'ов, а повтор предложения дописывал замену. Атомарность не заявляется; ADR024-подобный staged-путь для памяти не строился.
5. **§39 conformance-набор для `memory` не реализован** — по комментарию в `packages/adapter-sdk/src/conformance.ts:13-14` он относится к карточке, монтирующей внешний адаптер (MW-019); `REQUIRED_CONFORMANCE_CHECKS.memory` остаётся списком из 9 пунктов, и ни один из них не помечен как покрытый. Приёмка MW-018 проверена тестами сюиты, а не kit'ом.
6. **Регистрация в `myworkAdapters` и Cordis-привязка не делались** (как и в MW-017 §6.4): `createMemoryContextProvider` — реализация `ContextProviderPort` внутри ядра, а не внешний адаптер; строка плагина в профиле не добавлялась.
7. **Конфигурационные `memoryRoutes` не связаны с §23.9-маршрутами.** В конфигурации это `string[]` (`packages/contracts/src/config.ts:175`), у которого пока нет потребителя; сопоставление строк и маршрутов — решение карточки, которая соберёт рантайм.
8. **Коллизия нотации L0/L1/L2 ↔ D0/D1/D2.** v0.2-decisions §5.8 требует переименовать disclosure-шкалу §21.2 в `D0/D1/D2` и утверждает, что в кодовой базе нет типа/константы, где `L0/L1/L2` относятся к контексту. Фактически `packages/contracts/src/context.ts:38` (MW-016) использует `ContextLevel = 'L0'|'L1'|'L2'`, а `AutonomyLevel` не существует вовсе. MW-018 следует **реализованному** контракту (§21.5-порт типизирован `ContextLevel`), менять чужой принятый контракт не стал; это находка для владельца, а не правка этой карточки.
9. **Reflection не ретайнится** и не становится контекстом автоматически; его текст — дайджест провайдера, а не обслуживаемая запись. `optional`-маршрут не делает рефлексию деградируемой: у неё нет «пустой, но успешной» формы, поэтому недоступность всегда отказ с диагностикой (это названо в коде и проверено тестом).
10. **Дедлайн — настенный таймер.** Тест «timeout» поэтому опирается на реальные ~5 мс и проверяет, что пауза не меньше 4 мс; инъецируемый клок на дедлайн не влияет (это записано и в коде).
11. **Порог trust для контекста — бинарный.** `medium`/`low` → `untrusted` (§21.4), поэтому средняя по §23.6 память всегда едет как `data`; это осознанное прочтение, названное в §2.5.
12. **Таблица §23.6 «класс источника → trust» — справочные данные, а не правило вывода** (ревью F6). Ключи таблицы — это *классы источников* §23.6 (`tool-output`, `generated-summary`, …), которых в предложении нет: `sources` несут uri/revision/type, а trust объявляется писателем. Сверять объявленный trust с таблицей механически нельзя, не выдумывая класс; поэтому таблица и `memoryTrustOfSource` остаются публичным справочником, а инвариант «слабый trust не переписывает сильный» держится на объявленном классе. Это записано в docstring контракта.
13. **Путь ссылки не проверяет скоуп — это названо, а не умолчано** (ревью F5). §52 разрешает reference links между workspace, поэтому `resolve`/`materialize` адресуют запись по идентичности, а перечисление (`recall`/`discover`) остаётся скоуп-связанным; на пути materialization scope-условие serving-правила не может не пройти, и это сказано в коде. Проверка там не вакуумна для того, ради чего она стоит: статус и окно валидности (тест `materialization refuses a record whose window closed after it was proposed`).
14. **`MEMORY_BACKEND_ERROR` не используется** (ревью F12): недоступность и таймаут маппятся на `ADAPTER_UNAVAILABLE` — тот же выбор, что у Beads-адаптера и контекстной фабрики (`contracts/src/context.ts:646`), а `MEMORY_BACKEND_ERROR` оставлен для «бэкенд ответил неправильно», чего снаружи не наблюдать. Записано в docstring `MEMORY_REFUSAL_CODES`.
15. **Платных/живых LLM-проб не делалось** (запрещено карточкой): свойства памяти доказаны на литералах и фейках, а не на прогоне модели.
16. **`pnpm install`/`pnpm run check` в песочнице не выполняются** (os error 5), поэтому lockfile-блок написан руками и проверен структурно (§3, §4); канонический `pnpm run check` владельцу стоит прогнать один раз на своей машине.
17. **README не обновлялся**: список пакетов в его разделе «Структура» уже отстаёт на пять пакетов (нет `evidence`, `execution`, `planner`, `scheduler`, `beads-adapter`), и дописывать в него одну строку про `memory-native` значило бы закрепить расхождение. Приведение списка в порядок — отдельная правка владельца.
18. **Доска разработки и живой профиль DSH не изменялись**; `.beads`/ledger не трогались.
19. **Правило для ссылки при недоступном провайдере выбрано явно** (архитектура этот случай не описывает, находки N2/R-1): если владелец ссылки **известен** фабрике — отказ по доступности (`provider-unavailable`, повтор уместен); если владелец неизвестен и недоступен лишь неотносимый провайдер — ответ остаётся `invalid-ref`, а недоступность видна диагностикой (иначе опечатка в id становится вечным retry). Правило сформулировано в `fetchOwned` и проверено двумя тестами.

---

## 9. Независимое ревью: вердикт, находки, исправления

### 9.1 Как проводилось

Отдельный субагент со свежим контекстом, read-only, словарь `PASS` / `PASS WITH FINDINGS` / `FAIL`, отчёт `.tmp/mw018-review/MW-018-review.md`. Ему были переданы: пути и SHA-256 пяти файлов под ревью, критерии приёмки, разделы архитектуры с якорями, ожидаемые числа и известные ловушки окружения; **не** передавались переписка, diff, коммиты и рассуждения автора. На момент ревью работа ещё не была закоммичена, поэтому `git worktree` был неприменим: ревьюер работал read-only по живому дереву, а весь scratch держал в `.tmp/mw018-review/`; дерево на время ревью не менялось (SHA всех пяти файлов и обоих бандлов до и после совпали).

### 9.2 Вердикт

**PASS WITH FINDINGS** — 2 MAJOR / 7 MINOR / 3 NIT. Все четыре контрольных числа воспроизведены ровно (`tsc` 12×exit 0, smoke exit 0, сюита 51/51, полный прогон 625/602/0/23), перечень изменённых путей и SHA совпали, ложных утверждений в отчёте не найдено. Ревьюер вёл собственные пробы (`probe.mjs`, `probe2.mjs`, `probe3.mjs`) и 4 собственные мутации на копиях бандлов: R-A (сортировка) и R-C (`namespaceRevision`) валят сюиту — то есть она не вакуумна; R-B (`limit`) и R-D (граница `dedupable` для `stale`) остались зелёными — это стало находкой F3.

### 9.3 Находки и что сделано

| # | Severity | Находка | Исправление и доказательство |
|---|---|---|---|
| **F1** | **MAJOR** | Скопы группировались по `primary`, а группа хранила один маршрут: `recall([workspace optional, role required])` деградировал для **обязательного** скоупа, ответ зависел от порядка скоупов, `discover` молча возвращал `[]` | Группировка по паре **(провайдер, право на деградацию)**; диагностика `degraded` — по одной на каждый покрытый скоуп. Тесты: `a required scope does not degrade because an optional scope shares its provider` (оба порядка + `discover` бросает), `a degraded answer names every scope it covers`. Мутация M7 валит адресный тест |
| **F2** | **MAJOR** | `reflect` звал `capabilities()` мимо `callProvider`: публичный API отклонялся приватной `MemoryDeadlineExceeded`, `fabric.diagnostics()` оставался пуст, ветка `optional` была мертва | `capabilities()` идёт через `callProvider` (health + дедлайн), отказ возвращается с кодом §42 и диагностикой; мёртвая ветка удалена, а невозможность деградировать у рефлексии названа в коде. Тесты: `reflection against a provider that never answers…`, `reflection against a disabled provider…`. Мутация M8 валит оба |
| **F3** | MINOR | Фабричный `limit` и граница `dedupable` для `stale` не покрыты тестами (мутации R-B/R-D оставались зелёными) | Добавлены `the fabric-level limit returns exactly that many records, in the documented order` и `a claim held by a stale record is published anew rather than reinforced` |
| **F4** | MINOR | `validation` не входил в fingerprint: повтор `immediate` по `candidate` давал «успешное усиление» и необслуживаемую запись | `validation` добавлен в `fingerprintOf`, поэтому immediate-предложение заменяет Candidate, а не усиливает его. Тест `an immediate proposal does not reinforce the Candidate that was waiting on it`; мутация M10 валит его |
| **F5** | MINOR | `resolve`/`materialize` без скоупа; scope-условие serving-правила на пути materialization не может не пройти и нигде не объяснено | Названо явно в коде и в контракте (`MemoryFabricPort.resolve`, §52 разрешает reference links; перечисление остаётся скоуп-связанным). Добавлен тест на то, ради чего проверка там стоит: `materialization refuses a record whose window closed after it was proposed` |
| **F6** | MINOR | Таблица §23.6 «класс источника → trust» не читается никем; `web`-источник с `trust:'very-high'` переписывает very-high запись | Таблица названа **справочными данными** в docstring контракта, с причиной: ключи — классы источников §23.6, которых предложение не несёт, поэтому механически сверить объявленный trust не с чем (см. §8.12) |
| **F7** | MINOR | Процессный счётчик id: вторая фабрика над тем же провайдером получала коллизию, а причина отказа выдавалась за §23.6-конфликт | Счётчик стал **на экземпляр фабрики** (`mem-<instance>-<n>`); ограничение для переживающего процесс провайдера названо (§8.3). Тест `two fabrics over one provider both retain` |
| **F8** | MINOR | Свежая фабрика не разрешала запись, которую провайдер уже держит, и сообщала ложный `invalid-ref` | Locator стал кэшем: при промахе ссылка ищется у провайдеров, названных маршрутами (в порядке маршрутов), «не найдено» отличается от «провайдер недоступен». Тест `a fresh fabric resolves a record the provider already holds`; попутно исправлено: ответ провайдера «нет такой записи» (TASK_CONFLICT) больше не выдаётся за конфликт |
| **F9** | MINOR | native `replace` сравнивал только `contentHash`, поэтому мог увести запись в другой скоуп или понизить trust | Сравнивается весь контент записи (`sameContent`: утверждение, скоуп, вид, источники, автор, trust, confidence, validity, `supersedes`, ревизия, fingerprint); состояние (`status`/`statusChangedAt`/`reinforcedCount`) — то, что `replace` и должен менять. Тест `the native provider refuses a replace that moves the record to another scope`; мутация M9 валит его |
| **F10** | NIT | «Строк» в отчёте означало непустые строки | §3 называет общее число строк и оговаривает меру |
| **F11** | NIT | Дубль `DEFAULT_MEMORY_POLICY` в ядре и в контрактах | Ядро импортирует контрактную константу, локальная удалена |
| **F12** | NIT | `MEMORY_BACKEND_ERROR` не используется, выбор кода не назван | Выбор назван в docstring `MEMORY_REFUSAL_CODES` и в §8.14 |
| — | **MAJOR** | **Собственный аудит (найден после первой редакции тестов, до ревью не дошёл):** кандидат публиковал хеш L1-текста, а `materialize` возвращал хеш L2-текста; §21.5 передаёт хеш кандидата как `expectedContentHash`, поэтому любая выборка тела памяти падала бы `materialization-failed` | Один `itemHashOf(record)` на оба уровня. Тесты `the hash a candidate publishes is the hash materialization returns` и `a snapshot that asks for the full content of a memory item materializes it`; мутация M6 валит оба |

### 9.4 Повторная проверка исправлений

Тот же ревьюер, режим `verify-fixes` (`.tmp/mw018-review/MW-018-fixes-verification.md`): **FIXES VERIFIED** — все 12 находок закрыты и подтверждены **поведением**, а не описанием: одни и те же пробы прогнаны против нового бандла и против сохранённой дореформенной копии, поэтому у каждой строки есть «до/после». Свои 6 мутаций на копиях новых бандлов (V-A…V-F, восстановление побайтово) валят ровно адресные тесты, включая те две проверки (F3), которые в первом проходе оставались зелёными. Отдельно подтверждён дефект хеша L1≠L2: на старом бандле `equal:false` и `TypeError` при `expectedContentHash`, и `context.ts:547` действительно передаёт хеш кандидата — то есть дефект был реальным, а не теоретическим.

### 9.5 Дельта-находки проверки исправлений

| # | Severity | Находка | Исправление и доказательство |
|---|---|---|---|
| **N1** | MINOR | `sameContent` не сравнивал `retainedAt`, поэтому `replace` мог его переписать (принято `999999`) и этим изменить порядок выдачи — при том что docstring называл список изменяемых полей закрытым | `retainedAt` добавлен в сравнение; тест `a replace cannot move when a record was retained`, мутация M14 валит его |
| **N2** | MINOR | Обход провайдеров запоминал **первую** неудачу, поэтому недоступность провайдера чужого скоупа превращала «записи нет» в `provider-unavailable` (и то же для опечатки в `supersedes`) — вызывающий, повторяющий на `ADAPTER_UNAVAILABLE`, повторял бы опечатку вечно | `provider-unavailable` возвращается только для **известного владельца** (locator); неудача неотносимого провайдера оставляет ответ `invalid-ref`, а сама неудача едет в диагностике отказа. Тест `an unknown reference stays an invalid ref even when another provider is down`, мутация M12 валит его |
| **N3** | NIT | Ответ стал независим от порядка скоупов, а диагностика отказа — нет (`["disabled","degraded","disabled"]` против `["disabled"]`) | Группы обрабатываются в детерминированном порядке: сначала required, затем по id провайдера. Тест `a refusal carries the same diagnostics whichever order the scopes are listed in`, мутация M13 валит его |
| **N4** | NIT | §2.1/§2.2 отчёта противоречили исправленному §3 (незакрытая половина F10) | §2.1/§2.2 называют общее число строк |
| **R-1** | MINOR (найден автором, не ревьюером) | Неудача **кэшированного** владельца не запоминалась: запись, чей провайдер упал, разрешалась как `invalid-ref` | Ошибка владельца возвращается как `provider-unavailable`; тест `a reference whose provider went down is an outage, not an invalid ref`, мутация M11 валит его |

**Семантический выбор, названный явно (N2/R-1).** Архитектура не описывает, что делать со ссылкой, когда провайдер, который мог её держать, недоступен. Выбранное правило: **известный владелец** → отказ по доступности (ссылка не разрешена и не опровергнута, повтор уместен); **неотносимый провайдер** → ответ остаётся `invalid-ref`, а недоступность видна диагностикой (иначе опечатка в id превращается в вечный retry). Это правило сформулировано в коде (`fetchOwned`) и в §8.

### 9.6 Итог

Сюита памяти **68/68**, полный прогон **642 / 619 / 0 / 23**, `smoke: all steps passed`, `tsc`/`tsdown` по 12 пакетам — exit 0; мутации M1–M5, M1c, M6–M10 и M11–M14 дают адресные отказы, все бандлы восстановлены побайтово. Третий проход проверки (на дельту N1–N3/R-1) не запускался: предыдущий проход не нашёл ни BLOCKER, ни MAJOR, а объём дельты — четыре узкие правки, каждая покрыта тестом и мутацией; при желании владельца он запускается одной короткой сессией.

### 9.7 Статус и коммиты

**DONE** — статус выставлен прямым указанием владельца («изменить статус и коммиты»), ревью-статус снят владельцем. Основание приёмки: ревью **PASS WITH FINDINGS** и проверка исправлений **FIXES VERIFIED** (§9.2, §9.4), плюс прогоны §4 на закоммиченном дереве.

Пять коммитов, один на слой, баррель едет вместе с модулями, которые он экспортирует; трейлер `Cards: MW-018.` в каждом. Отчёт и сообщения коммитов лежат в `.work/` и `.tmp/`, то есть вне индекса.

| Коммит | Слой | Файлы |
|---|---|---|
| `56c5265` | `feat(contracts)` | `packages/contracts/src/memory.ts`, `ids.ts`, `index.ts` |
| `133b59d` | `feat(core)` | `packages/core/src/memory.ts`, `packages/core/src/index.ts` |
| `43e84e9` | `feat(memory-native)` | `packages/memory-native/**` (6 файлов) |
| `1c1f091` | `test(memory)` | `tests/memory.test.mjs`, `tests/lib/fixtures.mjs` |
| `23432bb` | `chore(workspace)` | `pnpm-lock.yaml` |

Base `9163bb5` → head `23432bba0d13d6af244e9ae97d65823812bff2bb`; `git status --short --untracked-files=all` пуст, `git diff --name-only 9163bb5..HEAD` — ровно 14 путей карточки. Push, merge, publish и release не выполнялись: отдельного поручения на них не было. Следующая карточка (MW-019) не начиналась; доска разработки, живой профиль DSH и `.beads`/ledger не трогались.

---

## 10. Как воспроизвести

```powershell
# 1. типы и сборка (pnpm в песочнице недоступен — шаги вызываются напрямую)
foreach ($p in 'contracts','core','storage','evidence','lease','adapter-sdk','beads-adapter','planner','execution','scheduler','controller','memory-native') {
  node node_modules/typescript/bin/tsc --noEmit -p "packages/$p/tsconfig.json"
  Push-Location "packages/$p"; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location
}
# 2. проверки
node scripts/smoke.mjs
node --test --test-isolation=none tests/memory.test.mjs
node --test --test-isolation=none "tests/**/*.test.mjs"
# 3. доказательства карточки
node .tmp/mw018-lockfile-check.mjs
pwsh -File .tmp\mw018-mutations.ps1
pwsh -File .tmp\mw018-mutation-m1c.ps1
pwsh -File .tmp\mw018-mutations-delta.ps1
pwsh -File .tmp\mw018-mutations-n.ps1
```
