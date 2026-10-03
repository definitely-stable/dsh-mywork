# MW-005 — Создать Adapter SDK, registry и conformance основу

- Предмет: карточка доски `d1e10b88-4e4f-4775-a6fc-c500e6069459` (MW-005), этап `00-foundation`, обязательные пункты §62 — 32, 33, 34
- Исполнитель: сессия DSH Web, модель `opencode-go/deepseek-v4.1-flash`
- Дата: `2026-09-18 00:11 – 00:35 +05:00`
- Репозиторий: `H:\Repo\DSH-MyWork`
  - base SHA на старте карточки: `e8b3cc226a18e58a85c02063b4afbb7360947393`
  - работа закоммичена поверх `7ebb7b86a135580a68066af8070258ac7928d4a3` (HEAD на момент старта правок; туда MW-004 закоммитил storage): `e074fac`, `0dd69e2`, `44027ee`, `829ec62` — см. §10
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, DSH `0.1.5-rc.2`, `@deepseek-ai/cordis` `4.0.2`
- Статус: **DONE** (проверки §5–§6 пройдены на закоммиченном дереве)

---

## 1. Проверка зависимости MW-003

| Что проверено | Результат |
|---|---|
| Отчёт `reports/MW-003-domain-contracts.md` | Существует (434 строки), статус `DONE` (ревью-статус снят владельцем); §8 описывает независимое ревью (**PASS WITH FINDINGS**, 15 замечаний) и повторную верификацию (**FIXES VERIFIED**, 4 новых дефекта исправлены) |
| Владелец | В сессии прямо сообщил «MW-003 завершено» (то же основание, что зафиксировал MW-004 §1) |
| Проверка по исходникам (не по отчёту) | `packages/contracts/src/*.ts` (10 файлов) и `packages/core/src/*.ts` (8 файлов) на месте; `pnpm run check` на дереве до правок → **exit 0**, 83 pass / 0 fail, smoke 9 `ok` |
| Что MW-003 явно передал в MW-005 | §6.2.1: «Порты §36 не расширялись… Adapter SDK, реестр, capability negotiation и контракт-чеки — предмет MW-005» |
| Наследуемый риск | независимого `MW-002-review.md` в отчётах по-прежнему нет (MW-003 §6.3) — к MW-005 не относится; ревью-статусы MW-002…MW-003 сняты владельцем, работа закрыта |

Правило «зависимость не принята → BLOCKED» применено буквально: отчёт есть, исходники и
тесты воспроизводимо зелёные, передача объёма зафиксирована самим MW-003. Остановки с
BLOCKED не требуется.

---

## 2. Сделано

### 2.1 Решения по объёму (согласованы с владельцем до начала работы)

Владельцу заданы два коротких вопроса; выбраны рекомендованные варианты:

1. **Порты §36.** Все 12 портов получают стабильную идентичность (kind → contractVersion,
   обязательные checks §39), но TypeScript-интерфейсы и fakes добавляются вместе с
   адаптерами: `agent-runtime` есть, `memory` → MW-018 (§62 п.24), sessions → MW-015/020,
   `taskgraph` → MW-010, `task-board` → MW-027. Payload-типы заранее не выдумывались.
2. **Привязка к Cordis (§44).** Сервис `myworkAdapters` публикуется контроллером сейчас.

### 2.2 Каталог стабильных портов (§36, §62 п.32)

`packages/adapter-sdk/src/port-contract.ts`: `PORT_CONTRACTS` — 12 записей в порядке §36
(AgentRuntime, Session, ModelCatalog, TaskGraph, TaskBoard, ContextProvider, Memory,
SkillProvider, Workspace, ArtifactStore, EventBus, LeaseStore) с именем интерфейса и
ревизией контракта `<kind>/v1`; `portContractOf(kind)`; `PORT_CONTRACT_MAJOR = 1`.

`capabilities.ts`: `AdapterKind` расширен с 8 до 12 значений (порядок §36) — это правка
экспорта MW-002, зафиксирована в §7.2. `defineAdapterManifest` теперь проверяет и ревизию:
она должна быть синтаксически корректной и принадлежать тому же семейству, что и `kind`
(структурная ошибка → `TypeError`).

### 2.3 Version checks (`contract-version.ts`)

Строгий разбор `<family>/v<major>`: `memory`, `memory/v`, `memory/v0`, `memory/v1.0`,
`Memory/v1`, `1.0` не парсятся. `isContractVersionCompatible` — совместимость = то же
семейство и тот же major; другой major — не «новее», а другой контракт.

### 2.4 Registry и capability negotiation (§37, §44)

`registry.ts`:

- `AdapterRegistration` — форма §44 (`kind`, `id`, `contractVersion`, `capabilities`,
  `create(ctx)`); `AdapterCapabilityManifest` — форма §37 (`adapterId`). Единственная точка
  перехода между ними — `manifestOfRegistration` (иначе `id`/`adapterId` разошлись бы).
- `createAdapterRegistry({ observer })`: `register` / `unregister` / `resolve` / `require` /
  `list` / `clear` / `size`.
- **Явные отказы**: несовместимая ревизия → `CONTRACT_MISMATCH`; повторный id →
  `TASK_CONFLICT` (оба — `AdapterRefusal`, `register` бросает); отсутствующая или `false`
  required capability → `CAPABILITY_UNSUPPORTED` с `details.missing`; нет адаптера вообще →
  `ADAPTER_UNAVAILABLE`. Приоритет стабилен: сначала версия, потом capabilities.
- `resolve` возвращает результат, `require` бросает тот же отказ — вызывающий сам выбирает
  стиль; `resolve` не ветвится по имени: решение принимают только `kind`, ревизия и
  объявленные capabilities, порядок — порядок регистрации.
- Наблюдаемость (§38): `AdapterRegistryObserver` (`onRegistered`, `onUnregistered`,
  `onRefused`), отказы видны и в `resolve`, и в `register`.
- `MyWorkAdapters` — публикуемая поверхность без `clear()` (жизненным цикл владеет контроллер).

### 2.5 Единые errors (§38, §42)

`errors.ts`: два уровня, разведённые по назначению.

- `AdapterRefusal` — несёт канонический код §42 и структурно реализует `MyWorkErrorShape`,
  поэтому попадает в `Result`/`fail` без конверсии (проверено тестом: `core.fail(refusal, meta)`).
- `AdapterError` — транспортный словарь внутри адаптера (`unavailable`, `invalid-ref`,
  `conflict`, `version-mismatch`, `timeout`, `cancelled`); **намеренно** не отображается на
  §42: у `timeout`/`cancelled`/`invalid-ref` нет честного канонического кода, и придумывать
  его — значит врать вызывающему (§7.4).
- Хелперы (§38): `adapterUnavailable`, `capabilityUnsupported`, `contractMismatch`.

**Находка по ходу работы (реальная, не косметическая).** Контроллер — публикуемый bundle,
workspace-пакеты в него инлайнятся, поэтому `error instanceof AdapterRefusal` **не работает**
для отказа, поднятого другой копией SDK (тест сначала упал именно на этом). Исправлено
через `static override [Symbol.hasInstance]` с проверкой формы (имя класса + код из
известного набора): отказ, поднятый копией контроллера, распознаётся копией адаптера §7.3.

### 2.6 Conformance kit (§38, §39)

`conformance.ts`:

- `REQUIRED_CONFORMANCE_CHECKS` — транскрипция §39: memory (9), taskgraph (7),
  agent-runtime (7). Остальные порты получат свои списки вместе с интерфейсами.
- `runConformance({ kind, checks, clock, adapterId?, contractVersion? })` — тайминг через
  `ClockPort` (в тестах `FakeClock`), `failed` на throw, `skipped` с причиной на
  `skipConformance(reason)`, и `missing` — требования §39, которые прогон **не** покрыл.
  Kit никогда не выдаёт непроведённую проверку за pass.
- `commonAdapterChecks` — 8 общих контрактных проверок, применимых к адаптеру любого порта:
  ревизия и `kind` согласованы, несовместимая ревизия отказ, повторный id отказ, `/false/`
  и отсутствующая capability отказ, порт без адаптера → `ADAPTER_UNAVAILABLE`, обнаружение
  по объявлению (не по id), обратимость регистрации.
- `agentRuntimeChecks` — реализуемая сейчас часть §39 для `AgentRuntimePort`: `create`,
  `create refuses a duplicate run`, `status`, `stop`.
- `FakeAdapter` + `fakeAdapterRegistration` в `./testing`: регистрируемый fake, который
  считает вызовы и умеет падать по сценарию.

### 2.7 Cordis-привязка (§44)

`packages/controller/src/index.ts`: `apply` публикует второй сервис
`myworkAdapters` (`MyWorkAdaptersService extends Service implements MyWorkAdapters<undefined>`)
и снимает его эффектом `mywork adapters shutdown`; `close()` очищает registry, поэтому
выгрузка плагина не оставляет регистраций. `MYWORK_ADAPTERS_SERVICE` добавлен в
`@dsh-mywork/contracts`; контроллер получил devDependency `@dsh-mywork/adapter-sdk` и
`alwaysBundle` для него.

---

## 3. Приёмка: требование → где доказано

| Требование карточки | Реализация | Проверка |
|---|---|---|
| Несовместимая версия даёт явный отказ | `register` → `CONTRACT_MISMATCH`; `resolve(..., { contractVersion })` → `CONTRACT_MISMATCH` | `tests/adapters.test.mjs`: «an incompatible contract revision is refused as CONTRACT_MISMATCH»; smoke-шаг 11; mutation A |
| Ложная/отсутствующая required capability даёт явный отказ | `negotiate` → `CAPABILITY_UNSUPPORTED` + `details.missing` (и `false`, и отсутствующий ключ) | тесты: явно оба случая («declared false», «not declared»); mutation B |
| Совместимый fake регистрируется/удаляется | `register` + handle `unregister()`; `unregister` идемпотентен; `clear()` на выгрузке | тест «a compatible fake adapter registers, is discovered, and unregisters»; smoke-шаги 10 и 12; mutation C |
| Core не ветвится по имени провайдера | решение принимают `kind`/ревизия/capabilities; у registry нет name-lookup | тест «core and contracts keep no provider-specific branch» (скан исходников core/contracts после снятия комментариев + поверхность API registry); тест «discovery goes by declaration, never by adapter id»; mutation D |

---

## 4. Изменённые и новые файлы

Коммиты сделаны (карточка разрешала коммит отдельным поручением владельца), см. §10.
`git status` чист: в дереве нет ни чужих незавершённых файлов, ни остатка моих правок.

```text
 M README.md                                +26 −1   (раздел «Адаптеры», строка структуры)
 M packages/adapter-sdk/package.json        +1 −1    (description)
 M packages/adapter-sdk/tsdown.config.ts    +6 −0    (alwaysBundle contracts: коды §42 читаются в рантайме)
 M packages/adapter-sdk/src/capabilities.ts +74 −15  (12 портов §36, проверка ревизии, supportedCapabilities)
 M packages/adapter-sdk/src/errors.ts       +143 −6  (AdapterRefusal, хелперы, cross-copy identity)
 M packages/adapter-sdk/src/index.ts        +65 −1   (экспорты SDK)
 M packages/adapter-sdk/src/testing.ts      +71 −0   (FakeAdapter, fakeAdapterRegistration)
 M packages/contracts/src/index.ts          +7 −0    (MYWORK_ADAPTERS_SERVICE)
 M packages/controller/package.json         +1 −0    (devDependency adapter-sdk)
 M packages/controller/src/index.ts         +111 −9  (сервис myworkAdapters + эффект)
 M packages/controller/tsdown.config.ts     +1 −1    (alwaysBundle adapter-sdk)
 M pnpm-lock.yaml                           +3 −0    (link на adapter-sdk в importer контроллера)
 M scripts/smoke.mjs                        +43 −0   (три шага про адаптеры)
?? packages/adapter-sdk/src/contract-version.ts   81 строка
?? packages/adapter-sdk/src/port-contract.ts      61 строка
?? packages/adapter-sdk/src/registry.ts          379 строк
?? packages/adapter-sdk/src/conformance.ts       477 строк
?? tests/adapters.test.mjs                       486 строк
```

Размеры правленых файлов: `capabilities.ts` 129, `errors.ts` 182, `index.ts` 72,
`testing.ts` 226, `controller/src/index.ts` 223, `contracts/src/index.ts` 124,
`scripts/smoke.mjs` 264 (было 221). Раскладка по коммитам — §10.

---

## 5. Команды и exit codes

| Команда | Exit | Что доказывает |
|---|---|---|
| `pnpm install` | 0 | 6 workspace-проектов; `@dsh-mywork/adapter-sdk` слинкован в контроллер (junction) |
| `pnpm --filter @dsh-mywork/adapter-sdk run typecheck` | 0 | строгий `tsc` по новому SDK (после правки `static override`) |
| `pnpm --filter @dsh-mywork/controller run typecheck` | 0 | типы сервиса `myworkAdapters` |
| `pnpm run check` (typecheck + build + smoke + test) | 0 | **98 pass / 0 fail**, smoke **12 `ok`** |
| `node --test --test-isolation=none tests/adapters.test.mjs` | 0 | 15 pass / 0 fail — вся приёмка §3 |
| `node scripts/smoke.mjs` | 0 | 12 шагов, включая публикацию `myworkAdapters` и снятие регистраций при unload |
| `node scripts/verify-profile.mjs --dsh-bin <checkout>/apps/cli/lib/bin.js` | 0 | **verify:profile: PASS** — tarball ставится и профиль грузится/выгружается; «user profile untouched (3 fingerprint(s) unchanged)» |
| mutation A: `isContractVersionCompatible` → `true` в собранном `adapter-sdk/lib/errors-*.js` | тест 1 | 11 pass / **4 fail** — проверки версий не вакуумны |
| mutation B: `supportsCapability` → `true` в `adapter-sdk/lib/index.js` | тест 1 | 10 pass / **5 fail** — negotiation ловится |
| mutation C: `close()` сервиса → `return 0` в `controller/lib/index.js` | тест 1, smoke 1 | 14/1 в тестах и `FAIL unload drops the registrations together with the service` |
| mutation D: `export const SMOKE_PROVIDER_BRANCH = 'beads'` в `core/src/index.ts` | тест 1 | 14 pass / **1 fail** — скан провайдерских имён работает |
| восстановление: `pnpm run build` + `pnpm run check` | 0 | дерево возвращено, 98 pass |
| mutation-правки в исходниках после себя: `git status packages/core/src` | — | пусто (мутация D откатана побайтово) |
| `pnpm run check` после коммитов (§10), на дереве `829ec62` | 0 | закоммиченное состояние зелёное: 98 pass / 0 fail, smoke 12 `ok` |
| `git status --short --untracked-files=all` после коммитов | — | пусто: незакоммиченного нет |

---

## 6. Evidence

### 6.1 Полный конвейер

```text
$ pnpm run check
ok   plugin module exposes the bundle entry shape
ok   mount publishes myworkController and freezes its snapshot
ok   unload removes the service and settles the controller
ok   diagnostics config writes one line per lifecycle transition
ok   configuration resolution accepts defaults and rejects malformed rows
ok   a malformed row config fails the plugin load loudly
ok   FakeClock advances, resolves, and cancels deterministically
ok   FakeAgentRuntime records runs and fails like the port contract
ok   adapter manifests validate before registration
ok   the controller publishes myworkAdapters and accepts a compatible adapter
ok   an incompatible revision or a required capability is refused explicitly
ok   unload drops the registrations together with the service
smoke: all steps passed
ℹ tests 98   ℹ pass 98   ℹ fail 0   ℹ skipped 0
CHECK_EXIT=0
```

### 6.2 Изолированный профиль (публикационная форма не сломана)

```text
$ node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js
ok   packed …\dsh-mywork-controller-0.1.0.tgz
ok   created isolated profile mywork-verify from the sdk-minimal template
ok   dsh plugin add installed the packed bundle
ok   profile bundles reconciled: ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller"]
ok   composed profile contains the controller layer, row, and overlay config
ok   profile boot mounted and unloaded the controller
     dsh-mywork: controller mounted service=myworkController version=0.1.0 contexts=control
     dsh-mywork: controller stopped service=myworkController version=0.1.0 uptimeMs=65
ok   user profile untouched (3 fingerprint(s) unchanged)
ok   removed the isolated work directory
verify:profile: PASS
```

### 6.3 Ключевые проверки приёмки (фрагменты)

```text
✔ the §36 port catalog declares every stable port with one contract revision      (12 портов, agent-runtime…lease-store)
✔ an incompatible contract revision is refused as CONTRACT_MISMATCH               memory/v2 против memory/v1, details.required
✔ a required capability declared false or absent is refused as CAPABILITY_UNSUPPORTED
                                                                                  missing: ['recall'], missing: ['structuredScopes']
✔ a compatible fake adapter registers, is discovered, and unregisters              size 1 → resolve ok → unregister true → ADAPTER_UNAVAILABLE → false
✔ registration is refused for a duplicate id and cleared with the registry          TASK_CONFLICT; clear() → 2
✔ discovery goes by declaration, never by adapter id                                неспособный зарегистрирован первым, выбран способный
✔ a refusal is a canonical error shape and travels through Result                   core.fail(refusal, meta) → code ADAPTER_UNAVAILABLE
✔ the common conformance checks pass for a compatible adapter                       8/8, missing = весь список §39 для memory
✔ the common conformance checks fail and skip loudly instead of passing             фабрика падает → failed; нет false-capability → skipped с причиной
✔ the agent-runtime suite passes for the fake and reports the §39 names it cannot cover
                                                                                  passed 4; missing ['resume','late event','cancellation','process restart']
                                                                                  сломанный runtime → failed ['create refuses a duplicate run','status','stop']
✔ the controller publishes myworkAdapters and drops every registration on unload    register/require/list → unload → сервис undefined, handle.unregister() false
✔ core and contracts keep no provider-specific branch                              сканы исходников + поверхность registry без name-lookup
✔ the adapter SDK and the controller bundle stay self-contained                    adapter-sdk/lib: только относительные импорты; controller/lib: только @deepseek-ai/cordis
```

### 6.4 Сверка примеров API с реальной архитектурой/кодом

| Механизм | Источник |
|---|---|
| Список 12 портов, «Core packages не импортируют конкретные integrations» | §36 (строка 2093) |
| Манифест `{adapterId, kind, contractVersion, capabilities}`, «Core не содержит provider-specific branches» | §37 (строка 2116) |
| Состав SDK: contracts, registration/compatibility helpers, capability schema, conformance, error helpers, observability hooks, fakes | §38 (строка 2140) |
| Обязательные проверки Memory / TaskGraph / AgentRuntime | §39 (строки 2155–2195) — перенесены дословно |
| `register({ kind, id, contractVersion, create(ctx) })` | §44 (строка 2309) — форма регистрации сохранена как `id` |
| Канонические коды `ADAPTER_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`, `CONTRACT_MISMATCH`, `TASK_CONFLICT` | §42 (строка 2253) и `packages/contracts/src/operation.ts` |
| `ClockPort`/`FakeClock` для тайминга проверок, `MyWorkErrorShape` для отказа | существующие контракты MW-002/MW-003, новых абстракций не вводилось |
| Cordis `Service`, `ctx.effect`, `ctx.get`, TS-private вместо `#` | `packages/controller/src/index.ts` (MW-002) и его отчёт §5.4 |

---

## 7. Ограничения и что осталось непроверенным

1. **Интерфейсы портов, кроме `AgentRuntimePort`, не определены** — это решение владельца
   (вариант A): объявлены kind, ревизия `…/v1` и требования §39, а TypeScript-интерфейсы
   приходят с карточкой интеграции (`memory` → MW-018, `taskgraph` → MW-010, sessions →
   MW-015/020, `task-board` → MW-027). Следствие: conformance-suites для memory/taskgraph
   пока не исполняемы, и kit честно показывает их в `missing`, а не как pass.
2. **AgentRuntime покрыт на 3 из 7 имён §39**: `resume`, `late event`, `cancellation`,
   `process restart` требуют операций, которых в текущем `AgentRuntimePort` нет. Они
   остаются в `REQUIRED_CONFORMANCE_CHECKS` и в `missing`; выдумывать семантику (например,
   что `stop` == `cancellation`) не стал.
3. **Одна копия SDK в профиле.** Bundle инлайнит SDK, поэтому идентичность ошибок решена
   формой (`Symbol.hasInstance`), но *registry* двух копий — это два разных registry:
   пакет-адаптер (MW-010/015) обязан регистрироваться в сервисе контроллера
   (`ctx.get('myworkAdapters')`), а не создавать свой registry. Это зафиксировано в §8.4 как
   вопрос: альтернатива — вынести SDK в `neverBundle` и публиковать как общую зависимость
   (тогда потребуется снять `private` и решить вопрос установки tarball-ом).
4. **Нет отображения транспортных кодов на §42.** `timeout`/`cancelled`/`invalid-ref`
   остаются неканоническими намеренно: у них нет честного канонического кода. Вызывающий,
   который смотрит только на §42, этих состояний не увидит — это задокументировано в
   `errors.ts`, но остаётся решением, которое стоит подтвердить.
5. **Диагностика registry не подключена к `diagnostics: true`.** Наблюдаемость есть в виде
   `AdapterRegistryObserver` (и сервис принимает observer в конструкторе), но `apply` его не
   подключает: контракт MW-002 «ровно две диагностические строки на mount/stop» проверяется
   smoke-шагом, и менять его в этой карточке не стал. Подключение — за MW-038 (Doctor).
6. **`verify:profile` доказывает загрузку bundle целиком**, но не публикацию `myworkAdapters`
   отдельной пробой: скрипт MW-002 проверяет только диагностику контроллера. Публикация
   сервиса подтверждена in-process (smoke + тест «the controller publishes myworkAdapters…»),
   то есть тем же механизмом Cordis, что и `myworkController`.
7. **`BOUNDED_CONTEXTS` остался `['control']`**: `adapters` из §46 не добавлен, чтобы не
   менять экспорт и smoke-ожидание MW-002 без решения владельца (§8.1).
8. **`ADAPTER_KINDS` расширен с 8 до 12 и переупорядочен в порядке §36** — это правка
   экспорта MW-002. Семантика не менялась, но порядок массива теперь соответствует
   комментарию. Потребителей вне репозитория нет.
9. **Параллельная работа MW-004.** В ходе карточки другая сессия коммитила storage
   (`a032a30`…`7ebb7b8`). Её файлы (`packages/storage/**`, `tests/storage*.mjs`,
   `tests/lib/*`, `tests/boundaries.test.mjs`, `tsconfig.base.json`, `.gitignore`) не
   изменялись; правка `README.md` аддитивная и её содержимое цело (видно по `git diff README.md`).
   `tests/lib/fixtures.mjs` намеренно не трогал — новый тест импортирует собранные пакеты сам.
10. **Не проверено:** поведение при двух конкурирующих адаптерах одного порта с разными
    capabilities (проверено только «первый подходящий»), реальные адаптеры (MW-010/015/019/027),
    конкурентная регистрация из нескольких плагинов одной сессией Cordis, поведение при
    горячей перезагрузке профиля (`patchReload: live`).

---

## 8. Открытые вопросы к владельцу

1. Добавлять ли `adapters` в `BOUNDED_CONTEXTS` контроллера (§46) — сейчас контекст один,
   `control`?
2. Подключать ли `AdapterRegistryObserver` к строке `diagnostics: true` (и как это
   совместить с контрактом «ровно две строки»), или всю наблюдаемость отдать Doctor (MW-038)?
3. Утверждается ли набор 12 kind'ов и ревизия `…/v1` как стабильная поверхность, под которую
   MW-010/015/018/027 добавляют интерфейсы портов в `@dsh-mywork/contracts`?
4. Оставляем ли SDK инлайняемым в bundle (ошибки различаются по форме) или выносим
   `@dsh-mywork/adapter-sdk` в общую (`neverBundle`) зависимость с единым registry в профиле?
5. Нужно ли адаптерам видеть `size`/`list` чужого порта через сервис (сейчас видят), или
   публикуемая поверхность должна быть только `register`/`unregister`?

---

## 9. Воспроизведение проверок

Все команды ниже прогнаны на закоммиченном дереве (§10) и воспроизводимы:

1. `pnpm install && pnpm run check` — ожидается exit 0: 98 pass, smoke 12 `ok`.
2. Приёмка §3 по коду (не по тестам): `packages/adapter-sdk/src/registry.ts`
   (`register`, `negotiate`) и `errors.ts` (канонические коды).
3. Mutation-проверки §5 (A–D): тесты должны падать.
4. «Нет ветвления по имени провайдера» независимо: `git grep -n "beads\|hindsight\|openviking" -- packages/core/src packages/contracts/src`
   (должны остаться только упоминания в комментариях §8/§37-прозе), и убедиться, что в
   `resolve` нет параметра имени.
5. Решения §2.5/§7.3 (identity ошибок через `Symbol.hasInstance`) и §8.4.

---

## 10. Коммиты

Четыре коммита поверх `7ebb7b8` (ветка `main`), push не выполнялся:

| SHA | Сообщение | Содержимое |
|---|---|---|
| `e074fac` | `feat(adapter-sdk): add the stable ports, registry, and conformance kit` | 10 файлов, +1341 −25: `port-contract.ts`, `contract-version.ts`, `registry.ts`, `conformance.ts`, `capabilities.ts`, `errors.ts`, `index.ts`, `testing.ts`, `package.json`, `tsdown.config.ts` |
| `0dd69e2` | `feat(controller): publish the myworkAdapters registry service` | 5 файлов, +119 −5: `controller/src/index.ts`, `controller/{package.json,tsdown.config.ts}`, `contracts/src/index.ts`, `pnpm-lock.yaml` |
| `44027ee` | `test(adapters): cover negotiation, the registry lifecycle, and conformance` | 2 файла, +529: `tests/adapters.test.mjs`, `scripts/smoke.mjs` |
| `829ec62` | `docs(readme): document the adapter registry and the SDK` | 1 файл, +25 −1: `README.md` |

Отчёт и карточки лежат в `.work/`, который исключён из Git правилом `/.work/`, поэтому в
коммиты не попадают — по замыслу проекта.
6. Оценить ограничения §7, прежде всего «3 из 7 имён §39 для agent-runtime» и «порты, кроме
   agent-runtime, без интерфейсов» — это прямое следствие выбранного варианта A.
