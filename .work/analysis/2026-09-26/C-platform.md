# Поток C: платформа DSH rc.2 — Typert Remote, Web Slots, dsh.client/bundle, compat-gate, toolchain, schedule, request-extension

**Вердикт потока:** все несущие API §20–§24, §30–§36, §41 в rc.2 существуют и подтверждены кодом, но документ недооценивает цену Web-интеграции (Typert Remote требует воспроизвести сборочный конвейер DSH, а клиент отказывается монтировать SRC-дескрипторы) и умалчивает три дефекта плана — отсутствие `@deepseek-ai/dsh*`-peer’ов, отсутствие `dsh.client` у MyWork-пакетов и неисполняемость `dsh.engines.dsh`.

**Развёрнуто:** документ в разделах §20–§24, §30–§36, §41, §62–§63 **в основном верен по фактам** (все несущие API существуют и найдены в коде rc.2), но **существенно неполон по цене и по обязательным предпосылкам**: Typert Remote для MyWork требует воспроизведения сборочного конвейера самого DSH (TS-анализатор декораторов + face-агрегаты + `tsdown`-плагин), клиентская половина DSH **отказывается** монтировать SRC-дескрипторы без строгих кодеков (`docs/api-gateway.md:139`), а рабочая практика внешнего плагина на rc.2 (`@linxin666/dsh-client-ui-task-board` 0.4.3) вообще обходится без собственного Remote: HTTP-маршруты через `ctx.webServer` + Host-вызовы `ctx.typertGateway`. Плюс три прямых дефекта в плане: (1) MyWork-манифест не заявляет ни одного `@deepseek-ai/dsh*`-peer, поэтому compat-gate §33 для него **молчит**; (2) ни один из трёх MyWork-пакетов не объявляет `dsh.client`, поэтому нативной панели `sidebar.panellist`+`main` сегодня взяться не из чего; (3) `dsh.engines.dsh`, которым пользуются два независимых сторонних издателя, в DSH **не читается никем** — версия-контракт обязан быть в `peerDependencies`.

**Режим работы потока:** только чтение чужого кода; мутирующих экспериментов не выполнялось (worktree не создавалась — см. §5). Единственный записанный файл — этот отчёт.

---

## 1. Что проверено и как

| Утверждение | Как проверял | Результат |
|---|---|---|
| Коммит `cad6fef2fd` отключает schedule/time-context в shipped web-композиции | `git show --stat --oneline cad6fef2fd` (exit 0), затем `git show cad6fef2fd -- packages/bundle/web-app` | ПОДТВЕРЖДЕНО: в `packages/bundle/web-app/cordis.patch.yml` добавлены `disabled: true` к строкам `time-context`, `schedule`, `ui-schedule` |
| Коммит `193f9ce413` ограничивает размер request extension и не блокирует запрос | `git show --stat --oneline 193f9ce413` (exit 0), `git show 193f9ce413 -- '*src*'` | ПОДТВЕРЖДЕНО с оговоркой: лимит 8 MiB применён к одной contribution (`dsh_session_log`), а fallback «без extensions» живёт в DeepSeek-адаптере |
| `@Remote` / `@RemoteScope` / stream / uplink / cancellation существуют | read `packages/typert/protocol/src/index.ts:152–257`, `packages/typert/protocol/src/types.ts:40–124,330–421` | ПОДТВЕРЖДЕНО, все семь пунктов §20 |
| Клиентские сервисы называются `ctx.remote.<namespace>` | read `packages/api/gateway/src/client/index.ts:154,752–754`; `docs/api-gateway.md:60,91` | ПОДТВЕРЖДЕНО: `super(ctx,'remote')`, ключ ребёнка `remote.${namespace}` |
| Host-сервис `sessionController` и его Remote-namespace | read `packages/api/session-controller/src/index.ts:99,136,251–519` | ПОДТВЕРЖДЕНО: сервис `sessionController`, namespace `session` (имена не совпадают) |
| Слот `sidebar.panellist` и keyed `main` существуют и таковы по контракту | read `docs/subsystems/slots.md:113–188`; `packages/client/ui-sidebar/src/client/contract/slots.ts:32–35`; `packages/client/ui-layout/src/client/index.ts:73` | ПОДТВЕРЖДЕНО; id записи в `sidebar.panellist` == ключ панели `main` |
| `ctx.slots.inject` / `register` / `provideRoot` — реальные методы сервиса `slots` | read `packages/client/ui-renderer/src/client/registry.ts:160,181,209,312` | ПОДТВЕРЖДЕНО |
| React-компонент слота не получает `ctx` | read `packages/client/ui-slots/src/index.ts:242–258,601–610`; `docs/subsystems/slots.md:77` | ПОДТВЕРЖДЕНО на уровне типа: `ComposedProps` не содержит `Context` |
| `dsh.client` = `{platform, inject, external, immediately}` и требует `exports["./client"]` | read `packages/client/modules/src/client/manifest.ts:161–181`; `packages/client/modules/src/index.ts:823–858`; `packages/util/package-manifest/src/types.ts:80–94` | ПОДТВЕРЖДЕНО; отсутствие `./client` при объявленном `dsh.client` — жёсткая ошибка (`index.ts:847`) |
| `PLATFORM_MODULES` — фиксированный список 9 модулей | read `packages/client/web/src/platform.ts:8–18` | ПОДТВЕРЖДЕНО (см. §3.4) |
| Клиентский бандл — CJS-обёртка `window.__ModuleLoader__.load({id, factory})` | read `packages/client/tsdown.client.ts:3,473–499,618–623`; head `@linxin666/dsh-web-all/lib/client.js` | ПОДТВЕРЖДЕНО (и подтверждено фактическим файлом в профиле) |
| `agent-team-profile` — один bundle из domain+tool+client-ui | read `packages/experimental/agent-team-profile/package.json`, `cordis.patch.yml`, `src/index.ts:8` | ПОДТВЕРЖДЕНО с уточнением: client-половина приходит отдельным пакетом со своим `dsh.client`, а сам profile-пакет `dsh.client` не объявляет |
| compat-gate проверяет `peerDependencies` на `@deepseek-ai/dsh*` | read `packages/boot/app-boot/src/plugin-compatibility.ts:61–88` | ПОДТВЕРЖДЕНО, включая «нет `peerDependencies` → нет ограничения» (`:68`) |
| Несовместимый bundle → `skippedBundles`, отчёт один раз за старт | read `packages/boot/app-boot/src/profile.ts:665–682,113–122`; `apps/cli/src/profile-boot.ts:170` | ПОДТВЕРЖДЕНО |
| Exemption — только после risk acknowledgement, exact pair | read `packages/boot/app-boot/src/profile-compatibility.ts:20–38,95–139` | ПОДТВЕРЖДЕНО (`--accept-risk`, ключ `name@version` + точная версия runtime, файл 0600) |
| Bounded pnpm / lock takeover / PID-reuse / leftover pnpm | read `packages/boot/plugin-manager/src/index.ts:48–60,182–186,451–483`; `operations.ts:203–240,377–383`; `packages/util/atomic-write/src/index.ts:110–177,212–266` | ПОДТВЕРЖДЕНО; takeover и PID-reuse живут в `dsh-atomic-write`, не в plugin-manager |
| engines/TS/pnpm DSH против MyWork | read `package.json` DSH и MyWork, `tsconfig.base.json` обоих, `vendor/cordis/package.json` | ПОДТВЕРЖДЕНО с новыми деталями (см. §2 «§35») |
| Http-путь внешнего плагина вместо Remote | read `@linxin666/dsh-client-ui-task-board/src/index.ts:35,321,388`, `host-runner.ts:259–265`, `protocol.ts:13`; `packages/host/webserver/src/index.ts:42,145,166`; `packages/api/gateway/src/index.ts:227,345,374` | ПОДТВЕРЖДЕНО: плагин публикует свой HTTP API и вызывает shipped Remote с Host-стороны |
| `dsh.engines.dsh` читается DSH | grep `engines` по `packages/boot/**` → 0 совпадений; grep `engines[?:.]` по `packages/**/*.ts` → только объявление типа в `util/package-manifest/src/types.ts:23,56–66` | ОПРОВЕРГНУТО: поле декларативное, не исполняется |
| Контракт `data-dsh-panel-entry` / `semantic-attrs-v1.md` существует в DSH | grep `data-dsh-panel-entry|data-dsh-taskboard|semantic-attrs` по `packages/**/*.ts` → 0; отдельный поиск файла `semantic-attrs*` по репозиторию → нет файла | ОПРОВЕРГНУТО как контракт DSH: это конвенция третьей стороны |
| MyWork-контроллер объявляет только Cordis peer | read `packages/controller/package.json` (MyWork) | ПОДТВЕРЖДЕНО: `peerDependencies: { "@deepseek-ai/cordis": "^4.0.2" }` |

Дополнительно прочитано (без вывода команд, чтение файлов): `docs/api-gateway.md`, `docs/cookbook/adding-a-remote-api.md`, `docs/subsystems/slots.md`, `docs/user/develop/basic/publish.md`, `packages/typert/generator/src/{workspace,tsdown-plugin,index}.ts`, `packages/schedule/schedule/src/{index,runtime,domain,tools,storage,types}.ts` (выборочно), `scripts/{pack.mjs,verify-profile.mjs}` MyWork, `C:\Users\Dmitry\.dsh\profiles\web\{package.json,cordis.yml,cordis.patch.yml}` и исходники `@linxin666/dsh-client-ui-task-board` / `@linxin666/dsh-web-all`.

---

## 2. Разбор по разделам документа

### §19. «Правильный Web data path MyWork» — ЧАСТИЧНО (нет механизма, есть направление)

Раздел задаёт цепочку «Host read model → unary snapshot + watch stream → client store → Slots». В rc.2 все звенья существуют по отдельности (`@Remote` unary, `@Remote({mode:'stream'})`, `packages/client/store`, слоты), но **раздел не называет ни одного конкретного API** и потому не проверяем буквально. Проверяемое следствие: «Browser не хранит canonical TaskState» — это дисциплина, а не платформенное ограничение; платформа не мешает клиенту держать произвольный store (`packages/client/store` — обычный сервис client-side).

Что это меняет: в §3 нужно дописать, что «watch stream» в rc.2 — это `@Remote({mode:'stream'})`, возвращающий `AsyncIterable`, и что **разрыв потока — не ошибка вызова, а завершение итератора** (`packages/typert/protocol/src/types.ts:95–124`: «when the carrier is lost, iteration fails with the carrier error and the handle is finished»). Требование §62 «stream loss → degraded/recovering, а не fake empty» ложится на клиентский store и не поддержано платформой.

### §20. «DSH Typert Remote API» — ПОДТВЕРЖДЕНО по API, но НЕПОЛНО по предпосылкам (главная правка потока C)

Все восемь перечисленных возможностей найдены в коде:

| Возможность §20 | Доказательство |
|---|---|
| Host services через `TypertRemoteService` | `packages/typert/protocol/src/index.ts:166–180` (ctor биндит `serviceKey` и `namespace`) |
| `@Remote` | `packages/typert/protocol/src/index.ts:198–225` (перегрузки: голый декоратор, `@Remote('name')`, `@Remote({mode:'stream'})`) |
| `@RemoteScope` | `packages/typert/protocol/src/index.ts:250–257` |
| typed `RemoteError` codes | `packages/typert/protocol/src/types.ts:49–67`; `remote-error.ts:12–44`; 19 инфраструктурных кодов — `packages/api/gateway/src/remote-error-codes.ts:15–36` |
| generated Host/client descriptors | `packages/typert/generator/src/{analyzer,emitter}.ts`; артефакты по `docs/api-gateway.md:105–115` |
| unary RPC | `packages/api/gateway/src/index.ts:345` (`invoke`) |
| `@Remote({ mode: 'stream' })` | `packages/typert/protocol/src/index.ts:216–221`; `types.ts:330` |
| AsyncIterable / RemoteStream | `packages/typert/protocol/src/types.ts:93` |
| cancellation | `types.ts:359–363` (`signal` как последний параметр, вне wire-args); `types.ts:407–408` (`RemoteInvocation.signal`) |
| uplink client→host | `types.ts:355–358,409–420`; `types.ts:106–124` (`RemoteStreamHandle.send/end/dispose`) |
| `ctx.remote.<namespace>` | `packages/api/gateway/src/client/index.ts:154,752–754`; `docs/api-gateway.md:60` |

Чего в §20 нет и что меняет план:

1. **Клиентская половина не выводится из рантайма.** `docs/api-gateway.md:139`: «The Client does not discover decorators from the running Host, and the Client Remote refuses to mount SRC descriptors that lack strict codecs». То есть запуск DSH из исходников (`node --import tsx/esm`, как идёт текущий GUI) даёт Host-диспетчеризацию через SRC-fallback, но **клиент обязан иметь ранее сгенерированные `lib/typert.remote-client.*`**.
2. **Генерация — часть сборочного конвейера DSH, а не библиотека «под ключ».** `docs/api-gateway.md:99–101`: Host-фаза `tsc -b tsconfig.host.json` + `tsdown --env.DSH_BUILD_FACE host`, Client-фаза отдельная; `packages/typert/generator/src/tsdown-plugin.ts:86` создаёт `WorkspaceTypertGenerator(root)`, где `root` — «directory containing face aggregate tsconfigs» (`workspace.ts:37–44`). Внешний репозиторий должен сам собрать face-агрегаты и подключить `@deepseek-ai/dsh-typert-generator/tsdown`.
3. **Строгие требования к манифесту-контрибьютору** (`workspace.ts:90–147`): `exports['./typert'] = {types:'./lib/typert.host.d.ts', default:'./lib/typert.host.js'}`, а при наличии Remote-методов ещё и `exports['./remote'] = {types:'./lib/typert.remote-client.d.ts', default:'./lib/typert.remote-client.js'}`, и **оба файла обязаны быть перечислены в `files`** — иначе генератор падает с `TypertAnalysisError`. Для dual-face пакета добавляется субпуть `./client/typert` (`workspace.ts:96`).
4. **Асимметрия имён сервиса и namespace.** Сервис `sessionController` (`packages/api/session-controller/src/index.ts:136`) отдаётся клиенту как `ctx.remote.session` (`:98–99`). Host-код MyWork обращается к `ctx.get('sessionController')` (`packages/controller/src/dsh-session.ts:57`), клиентский — к `ctx.remote.session`. Ошибка на эту тему не диагностируется отдельно: неизвестный namespace даёт `gateway/service-unavailable`/`gateway/definition-unavailable`.
5. **Namespace занимает двухсегментные `/api`-эндпоинты.** `packages/api/gateway/src/index.ts:313–319`: Gateway «claim»-ит только эндпоинты из двух сегментов, у которых есть строгий дескриптор **или активная SRC-метка**; `collectSrcClaims()` (`:322–336`) собирает метки из `remoteMethods()`. Следствие для MyWork: если объявить namespace `mywork` с `@Remote board()` и одновременно поднять свой HTTP-маршрут `/api/mywork/board` через `ctx.webServer`, маршрут будет перехвачен Remote (в SRC-режиме — после первого `apply`).
6. **`RemoteResult` не reject-ит.** `types.ts:70–78`: «The Remote face itself folds carrier failures into the error branch, so no consumer wraps a call to recover one; only assembly faults (arity, an unmounted method, a missing Context adapter) still reject». Значит, обработка ошибок на клиенте MyWork — это ветка `!result.ok`, а не `try/catch`.
7. **Расхождение документации и кода (находка).** `docs/cookbook/adding-a-remote-api.md:94–103` показывает манифест-блок без поля `files`, тогда как `workspace.ts:109–114,143–147` **требует** присутствия сгенерированных файлов в `files` и бросает исключение, если манифест `files` не содержит их (в том числе когда `files` отсутствует вовсе: `files = Array.isArray(manifest.files) ? manifest.files : []`). Cookbook в текущем виде приведёт к падению генерации.

**Альтернатива, проверенная фактом на этой машине.** Внешний плагин `@linxin666/dsh-client-ui-task-board` 0.4.3 (установлен в живом профиле, исходники на месте) **не объявляет ни одного собственного Remote-метода**, но инжектит `typertGateway` (`src/index.ts:35`) и вызывает shipped-эндпоинты с Host-стороны: `this.gateway.invoke({namespace, method, args})` и `this.gateway.stream(...)` (`src/host-runner.ts:259–265`), например `session.create` (`:316`), `session.rename` (`:322`), `session.projections` (`:346`), `session.selectModel` (`:381`), `session.prompt` (`:390`), `session.page` (`:484`), `agentPresets.list` (`:291`). Свой клиентский API плагин отдаёт по HTTP: `ctx.webServer.register(route)` (`src/index.ts:388`) с префиксом `/api/task-board` (`src/protocol.ts:13`; маршруты — `src/host-routes.ts:188,197,220,250`). Сервисы платформы подтверждены: `webServer` (`packages/host/webserver/src/index.ts:145`) с `register(route: WebRoute): () => void` (`:166`, тип `WebRoute` — `:42`); Host-gateway `typertGateway` (`packages/api/gateway/src/index.ts:227`) с `invoke` (`:345`) и `stream` (`:374`).

**Вывод для §20:** Remote остаётся правильным выбором для типизированного контракта и stream/uplink, но он **не бесплатен** и **не обязателен**: HTTP-через-`webServer` — равноправный путь, который даёт произвольные формы запроса/ответа и не требует сборочного конвейера Typert, но не даёт типизации, `RemoteResult`, uplink, отмены по `AbortSignal` и защиты от коллизий с Remote-namespace. MyWork платит за Remote ровно тем, что принимает сборочную зависимость от `@deepseek-ai/dsh-typert-generator` (TS 6.0.3 внутри генератора — см. §35).

### §21. «Browser mutations только через domain commands» — ПОДТВЕРЖДЕНО как дисциплина, ОТСУТСТВУЕТ механизм

Платформа не предоставляет ничего похожего на «command с expected revision»: единственный типизированный отказ — `RemoteError` с кодом домена (`docs/cookbook/adding-a-remote-api.md:51–88`). Образец «CAS-команды» есть в самой платформе: `Schedule.update` принимает `request.expected` (полную наблюдённую запись) и возвращает non-mutating conflict-результат (`packages/schedule/schedule/src/index.ts:369–386`). Это подтверждает реализуемость §21, но не даёт MyWork ничего «из коробки»: коды вида `mywork/version-conflict` нужно объявлять declaration merging в `RemoteErrorDetailsMap` (`docs/cookbook/adding-a-remote-api.md:62–72`).

### §22. «Native DSH Web Surface» — ПОДТВЕРЖДЕНО, с тремя уточнениями

Проверено: root-scoped `sidebar.panellist` (`packages/client/ui-sidebar/src/client/contract/slots.ts:35`), root-scoped keyed `main` (`packages/client/ui-layout/src/client/index.ts:73`), typed `SlotMap` (`packages/client/ui-slots/src/index.ts:26`), `ctx.slots.inject()` и `register()` (`packages/client/ui-renderer/src/client/registry.ts:209,181`), lifecycle через эффекты Cordis (`registry.ts:242`), `dsh.client`-метаданные (`packages/client/modules/src/client/manifest.ts:161–181`). iframe/DOM-injection действительно не нужны.

Уточнения, которых в §22 нет:

1. **Список панелей и keyed `main` связаны по id.** `ui-sidebar/src/client/contract/slots.ts:32–34`: «Global panel icons. Each list id addresses the matching main panel»; `SidebarPanelMetadata` (`:77–79`) — «List id and matching main panel key». Регистрация MyWork: `sidebar.panellist` с `id: 'mywork'` **и** `main` с `key: 'mywork'`.
2. **Сид `sidebar.panellist` объявлен внутри `single`-записи `sidebar`**, поэтому регистрация обязана быть обёрнута в `ctx.slots.inject` — callback выполняется только когда владелец объявил слот (`docs/subsystems/slots.md:19`). Рабочий образец внешнего плагина: `native-panel.tsx:106–118` (`slots.inject('sidebar.panellist', …)`, затем `slots.inject('main', …)` с `key: TASK_BOARD_PANEL_ID`, `inject: (): PanelFace => ({controller})`); порядок — `PANEL_ORDER = 20` при «Plugins is 0, Schedule 10» (`:31–32`).
3. **`main` не имеет фиксированного набора ключей.** Ключи выводятся из живых записей: `packages/client/ui-layout/src/client/index.ts:159–162` (`retainMainPanels(ctx.slots.entries('main')…keys)`) и `:167–168` (проверка существования панели по `entries('main')`). То есть новый ключ `mywork` появляется автоматически; никакого allow-list в платформе нет.
4. **`dsh.client.inject` — не порядок применения.** `packages/client/ui-workspace/src/client/index.ts:88–93`: «dsh.client.inject edges are informational (loading/prefetch metadata, never apply sequencing)… apply therefore depends on each slot declaration through `slots.inject()` instead of assuming order». Это прямо противоречит привычке читать `inject` как порядок инициализации.
5. **Платформенный `data-dsh-*`-контракт отсутствует.** Grep `data-dsh-panel-entry|data-dsh-taskboard|semantic-attrs` по `packages/**/*.ts` — 0 совпадений; файла `semantic-attrs-v1.md` в репозитории нет. Ссылка внешнего плагина на «L2 contract (skins)» (`native-panel.tsx:39–42,49`, `:77`) — его собственная конвенция, полезная для сторонних тем/скинов, но не требование DSH. Для MyWork это значит: атрибут можно завести как свою стабильную точку расширения, но нельзя рассчитывать, что платформа его читает.

### §23. «Slot discipline» — ПОДТВЕРЖДЕНО полностью

- «React component не получает `ctx`»: тип `ComposedProps` (`packages/client/ui-slots/src/index.ts:601–610`) собран из `PropsRuntime` (owner props + key props + slot inject face + scope standard props, `:242–258`), `PropsRenderSlots`, `PropsStore`, `InjectFace`, `MatchedShare`, `PropsLocale` — `Context` в цепочке отсутствует; документально — `docs/subsystems/slots.md:77`.
- «business/transport state в Cordis service/client model»: тот же абзац `slots.md:77` + `slots.md:196` («Keep business and transport state in their owning Cordis services or Client models»).
- «registration inject factory передаёт только нужные callbacks/view data»: `InjectParams` (`ui-slots/src/index.ts:620–627`) даёт ровно `sessionId`/`actions` по объявлению, а не `ctx`.
- «contribution живёт lifetime plugin effect»: `registry.ts:242` (`ctx.effect(callback, 'slots.inject(...)')`).
- «feature package не импортирует runtime component другой feature package»: `slots.md:194`; в коде — `import type {} from '…/client'` в `native-panel.tsx:20–22`.
- «shared view state в declared slot store»: `PropsStore<H>` (`ui-slots/src/index.ts:601–610`) и опция `store` в регистрации (`slots.md:70`).

### §24. «Packaging: один bundle, несколько packages» — ПОДТВЕРЖДЕНО, но найдены два разных образца и один подводный камень

**Образец A (agent-team-profile, «профильный bundle»).** `packages/experimental/agent-team-profile/package.json:35–44`: `dsh.bundle.patch = './cordis.patch.yml'`, runtime-содержимого нет (`src/index.ts:8` — `export {}`), а `dependencies` тянут три пакета: `dsh-experimental-agent-team`, `dsh-experimental-tool-agent-team`, `dsh-experimental-client-ui-agent-team`. Патч (`cordis.patch.yml:4–33`) выключает четыре строки subagent-тулов и вставляет три: `agent-team` (с конфигом bounds), `tool-agent-team`, `ui-agent-team`. UI-пакет отдельный и объявляет `dsh.client` (`packages/experimental/client-ui-agent-team/package.json:29–40`: `platform: 'web'`, `inject` из 5 имён, `exports['./client']`). Host-половина UI-пакета — инертная: `packages/client/ui-workspace/src/index.ts:1–9` (`export function apply(): void {}`), и это ровно та форма, которую сканирует `client-modules`.

**Образец B (агрегат @linxin666/dsh-web-all 0.4.3, «один пакет — один клиентский бандл»).** `package.json`: `dsh.bundle.patch`, `dsh.client = { platform: 'web', inject: [] }`, `peerDependencies = { '@deepseek-ai/dsh': '>=0.1.7-rc.2' }`, ~19 `dependencies` на семейные пакеты; `cordis.patch.yml` (AUTO-GENERATED) вставляет по одной строке на семейство с именем-субпутём (`@linxin666/dsh-web-all/task-board`) и `config.plugin: '@linxin666/dsh-client-ui-task-board'`, а семейные строки `web-ui-ssh|liangshen|skill-explorer` — `disabled: true` для opt-in. Факт из файловой системы: `lib/client.js` = 2 417 481 байт (`Get-Item … .Length`), содержит `sidebar.panellist` (6 вхождений), `data-dsh-panel-entry` (6) и имя `dsh-client-ui-task-board` (3) — то есть **вся UI семейства вшита в один клиентский бандл агрегата**, а собственные `dsh.client` семейных пакетов работают только при их standalone-установке.

**Подводный камень, критичный для выбора модели.** Клиентская строка распознаётся только по **корневому** имени пакета: `packages/client/modules/src/index.ts:874–875` — `exactPackageSpecifier(loaderName)` даёт `undefined` для субпути (`…/task-board`), и метод немедленно возвращает «не client-строка». Следствие: строка вида `name: '@dsh-mywork/profile'` даёт клиентский бандл только если `dsh.client` объявлен у самого `@dsh-mywork/profile`; строки-субпути, отдающие UI, физически не могут быть client-строками. Отсюда две законные формы MyWork: (a) profile-пакет без `dsh.client` + отдельная bare-строка на UI-пакет (образец A), (b) один пакет с `dsh.client`, в чей `client.js` вшит UI (образец B, ценой размера).

**Формат клиентского бандла — ручной контракт.** `packages/client/tsdown.client.ts:473–499`: `format: 'cjs'`, `platform: 'browser'`, `outDir: 'lib'`, entry `{client: <path>}` → `lib/client.js`, `sourcemap: true`, `dts: false`, `clean: false`; внешние — только `PLATFORM_MODULES` + `dsh.client.external`, всё остальное инлайнится (`alwaysBundle: specifier => !isRequested(specifier)`). Обёртка (`:618–623`): `window.__ModuleLoader__.load({ id: "<package>", factory: (require) => { … return module.exports; } });`. Роут выдачи — `/plugins/<id>/client.js?rev=<rev>` (`packages/client/modules/src/index.ts:225,248–250`), батч-загрузка — комбо-скрипт (`:229,401`). DSH не предоставляет CLI «собери клиентский бандл для внешнего пакета»: MyWork обязан воспроизвести эту обёртку сам (tsdown/rolldown с `format: 'cjs'` в `lib/client.js`).

### §30. «DSH Schedule: функции и граница» — ПОДТВЕРЖДЕНО (включая отключение в shipped-композиции)

Способности проверены по коду: `after_seconds`/`at`/`every_seconds`/`daily`/`weekly`/`cron` — единая точка валидации `index.ts:250–266` («Supply exactly one timing parameter…» — `tools.ts:171`), декодеры и виды — `domain.ts:720–722,1130–1133`, минимумы `domain.ts:1269,1367–1372`, горизонт поиска cron — `domain.ts:43–51` (`CRON_SEARCH_HORIZON_YEARS = 400`), IANA-нормализация — `domain.ts:370–376` (`Intl.DateTimeFormat(...).resolvedOptions().timeZone`). Durable Host storage — `index.ts:101` (`storageDomain` в inject) и `index.ts:126` (`ctx.storageDomain.open(scheduleDomain)`); восстановление после рестарта — тесты `tests/domain-restart.spec.ts:36,56`; CAS-правка — `index.ts:369–386` (`resolveScheduleUpdate(current.record, request.expected, …)`); история доставок — `index.ts:321–331` (`@Remote('history')`), `delivery-history.ts:27–43`; delivery receipt подтверждается flush’ем Session — `runtime.ts:125` («Session persistence did not acknowledge the reminder»); Remote-каталог — `@Remote('catalog')` (`index.ts:303–312`); model tools — `tools.ts:171–243`; changed-уведомление — `index.ts:394–399` (`ctx.emit('schedule/changed')`).

Отключение в shipped Web-композиции подтверждено коммитом: `git show cad6fef2fd` добавляет `disabled: true` строкам `time-context`, `schedule` и `ui-schedule` в `packages/bundle/web-app/cordis.patch.yml`. Сам сервис при этом остаётся полным — отключена только строка профиля.

Что это меняет для MyWork: граница §30 корректна; дополнительно нужно понимать, что «включить Schedule обратно» пользователь может своей строкой в `cordis.patch.yml` (тогда `dsh.profile.bundles`-независимая строка `schedule` станет активной), поэтому MyWork не должен закладываться на отсутствие сервиса `schedule` в контексте.

### §31. «DSH Schedule ≠ MyWork Scheduler» — ПОДТВЕРЖДЕНО (утверждение о границе, не о коде)

В коде Schedule нет ни одного обращения к TaskGraph/Attempt/lease — сервис зависит ровно от `['agents','sessions','tools','storageDomain','sessionController','sessionPersistence']` (`index.ts:101`) и доставляет follow-up в исходную Session. Четыре полезных паттерна §31 подтверждаются конкретными местами: CAS-правка (`index.ts:379–381`), changed-уведомление → refetch (`index.ts:394–399`), durable record отдельно от receipt (`storage.ts:56` + `types.ts:197–207`), typed conflict на устаревший снапшот (`types.ts:411–435`, результат `ScheduleUpdateMiss`). «Delivery receipt ≠ execution success» — прямо в коде: receipt фиксируется после flush’а inbox (`runtime.ts:125`), а не после ответа модели.

### §33. «Plugin compatibility gate — обязательный release contract» — ПОДТВЕРЖДЕНО, с точным правилом и подтверждением из внешнего плагина

`packages/boot/app-boot/src/plugin-compatibility.ts:61–88`:

- проверяются **только** имена, равные `@deepseek-ai/dsh` или начинающиеся с `@deepseek-ai/dsh-` (`:75`);
- отсутствие `peerDependencies` вообще → `undefined`, то есть **никакого ограничения** (`:68`);
- `workspace:^`, `workspace:~`, `workspace:*` подставляются как точная версия runtime (`:76`);
- сравнение через `semver.satisfies(runtime, range, { includePrerelease: true })` (`:77`), поэтому `>=0.1.7-rc.2` на runtime `0.1.7-rc.2` проходит;
- runtime-версия — `version` из `package.json` самого `dsh-app-boot` (`:44–49`);
- exemption — ключ `${name}@${version}` и **точная** версия runtime, без интерпретации значения как диапазона (`:84–86`; тесты `tests/plugin-compatibility.spec.ts:132–149`), выдаётся только с `--accept-risk` (`profile-compatibility.ts:118`), файл пишется с режимом `0o600` (`:139`).

Применение в двух местах: bundle-слой — `packages/boot/app-boot/src/profile.ts:665–682` (несовместимый bundle уходит в `skippedBundles`), каждая строка плагина — до импорта модуля, `compatibility-preflight.ts:97–105`. В plugin-manager отказ даёт `code: 'incompatible-version'` с массивом `incompatible` (`src/index.ts:282–302,510,547,717–723`; тип — `src/types.ts:22–25`), плюс предупреждение для уже установленных несовместимых пакетов (`operations.ts:480–495`).

**Факт из внешнего плагина (живой профиль):** `@linxin666/dsh-client-ui-task-board` 0.4.3 объявляет `peerDependencies: { "@deepseek-ai/dsh": ">=0.1.7-rc.2", "react": "^18.2.0" }` — то есть сторонний издатель уже пользуется гейтом по назначению, а `react` в peer’ах гейт игнорирует (не `dsh*`-имя). Тот же пакет объявляет `dsh.engines.dsh = ">=0.1.7-rc.2"`, и это поле **никем не читается** (см. §1) — версия-контракт живёт только в `peerDependencies`.

**Проверка источника версии в живом профиле:** гейт берёт runtime-версию из `package.json` пакета `dsh-app-boot` (`plugin-compatibility.ts:44–49`); в профиле установлены `@deepseek-ai/dsh-app-boot` 0.1.7-rc.2 и `@deepseek-ai/dsh` 0.1.7-rc.2 (`C:\Users\Dmitry\.dsh\profiles\node_modules\@deepseek-ai\{dsh,dsh-app-boot}\package.json`).

**Что менять в MyWork:** сегодня `packages/controller/package.json` объявляет `peerDependencies: { "@deepseek-ai/cordis": "^4.0.2" }` — то есть формально заявляет «ограничений на DSH нет», и гейт пропускает пакет молча. Нужно добавить peer’ы на те `@deepseek-ai/dsh-*`-, от которых контроллер структурно зависит: минимум `@deepseek-ai/dsh-session` (сервис `sessionController`), `@deepseek-ai/dsh-llm` (сервис `llm`), `@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-agent` (реестр `agents`), а также `@deepseek-ai/dsh` как общий признак версии runtime. Ключевое: peer’ы должны быть и в `devDependencies` (publish.md требует «under both peerDependencies and devDependencies»), иначе типы не разрешатся при сборке.

### §34. «Version policy MyWork» — ЧАСТИЧНО (в плане нет самого артефакта матрицы)

Проверяемых артефактов «packed compatibility matrix» в MyWork нет ни в `package.json`, ни в `scripts/*.mjs`. Механика, которой эту матрицу можно построить, в DSH есть: (1) отказ на несовместимом runtime — `plugin-compatibility.ts:77–80`; (2) изоляция профиля для проверки — `scripts/verify-profile.mjs` уже создаёт `DSH_HOME` под `.tmp` и хеширует реальные манифесты (`:127–134,228–231`); (3) понятный diagnostic — `pluginCompatibilityWarning` (`plugin-compatibility.ts:96–103`) и структурированный `incompatible` в UI plugin-manager (`src/types.ts:22–25`). Рекомендация §34 «baseline 0.1.7-rc.2 → следующий rc/patch → заведомо несовместимый» технически исполнима тем же `verify-profile.mjs` с `--dsh-bin` на разные сборки.

### §35. «Node / TypeScript / pnpm» — ПОДТВЕРЖДЕНО; найдены три дополнительные асимметрии

| Параметр | DSH rc.2 (факт) | MyWork (факт) |
|---|---|---|
| Node engines | `^22.19.0 \|\| >=24.0.0` (`package.json`) | `>=22.18.0` (корневой `package.json`) |
| TypeScript | `^6.0.3` (`devDependencies`) | `~5.7.2` (`devDependencies`) |
| pnpm | `packageManager: pnpm@11.7.0` | `packageManager: pnpm@12.4.2` |
| tsdown | (внутренний конвейер) | `0.22.2` |
| Cordis | `vendor/cordis` = **4.0.4** | devDep `@deepseek-ai/cordis` = **4.0.2** (peer `^4.0.2`) |

Асимметрии, которых в §35 нет:

1. **Cordis не покрыт гейтом.** `evaluatePluginCompatibility` фильтрует имена (`plugin-compatibility.ts:75`), поэтому расхождение Cordis 4.0.2 vs 4.0.4 не диагностируется ничем. При этом Cordis — единственный runtime-import собранного контроллера (`packages/controller/lib/index.js`: `import { Service } from "@deepseek-ai/cordis";`) и ровно тот пакет, который DSH требует держать единственным экземпляром. MyWork держит точный devDep `4.0.2` и peer `^4.0.2`; в профиле резолвится 4.0.4 — совместимо, но проверять это нужно тестом, а не гейтом.
2. **TS 5.7 против TS 6-эпохи.** `packages/typert/generator/package.json` тянет `typescript: ^6.0.3` — если MyWork пойдёт по пути Remote, генератор принесёт в сборку собственный TS 6, а `tsconfig.base.json` MyWork (`typescript ~5.7.2`, `verbatimModuleSyntax: true`, `isolatedModules`, `noEmit`) останется на 5.7. Два TS в одном репозитории — технически допустимо (генератор вызывается как плагин сборки), но `tsconfig` DSH (`target es2024`, `module esnext`, `moduleResolution bundler`, `rewriteRelativeImportExtensions`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) читается типами `.d.ts` из tarball-ов 0.1.7-rc.2 — совпадение настроек с MyWork почти полное, что снижает риск, но не отменяет нужду в compile spike.
3. **`lib` в MyWork уже, чем в DSH.** `tsconfig.base.json` MyWork: `"lib": ["es2024"]`, DSH: `"types": ["node"]` без сужения `lib` (значит `dom`/`webworker`-типы подтягиваются по умолчанию при `target es2024`? — фактически `lib` не задан, поэтому берётся дефолт для target, то есть es2024 + dom). Для MyWork-контроллера это плюс (уже), но при компиляции против DSH-типов клиентских пакетов (React/DOM) `lib` придётся расширять.

Компиляция MyWork-контроллера против типов DSH **не проверялась** (см. §5): для честного ответа нужен отдельный worktree с установленными tarball-ами `@deepseek-ai/dsh-*@0.1.7-rc.2`.

### §36. «Последние Plugin Manager изменения» — ПОДТВЕРЖДЕНО, с уточнением владельца механизмов

- typed incompatible-version refusal: `packages/boot/plugin-manager/src/index.ts:282–302,510,547,717–723`, `failure.ts:9–27`.
- optional bundles switched off: там же `:717–739` (профиль хранит `dsh.profile.bundles` + состояние строк), плюс `bundle.base`/агрегаты используют `disabled: true` как «opt-in» (см. `@linxin666/dsh-web-all/cordis.patch.yml` — три семейные строки `disabled: true`).
- bounded pnpm runs: `index.ts:48–60,182–186` (`inspectTimeoutMs` 20 c, `githubConnectionTimeoutMs` 5 c, `idleTimeoutMs` 600 c), `operations.ts:377–383,453` (сообщение «pnpm printed nothing for …ms and was terminated»), `outputBytes`.
- safe lock takeover после exited writer + PID-reuse protection: **не в plugin-manager**, а в `packages/util/atomic-write/src/index.ts:139–177` (`takeOverExitedLock`, claim-файл `…lock.takeover-<sha256(record)[0:16]>`, повторная проверка записи и PID под claim’ом) и `:110–126` (`holderExited`: строгий формат `<pid>\n`, только `ESRCH` считается смертью, EPERM — «процесс жив под другим пользователем», `pid === process.pid` не отбирается). Это защита от переиспользования PID: комментарий на `:139–146` прямо объясняет, что удаление невозможно «включая случае, когда holder переиспользовал PID».
- wait for leftover pnpm child: `operations.ts:203–240` (`recordRun` → `.plugin-manager/run.json`, `activeRecordedRun` → `awaitTreeGone(tree)`, при живом дереве — понятный отказ с текстом «process N, started by an earlier package operation whose own process ended, is still running in this profile»).
- skipped bundle report once per start: `profile.ts:113–122` («loading never prints, so launchers call this once per start»); единственный вызов — `apps/cli/src/profile-boot.ts:170` (плюс desktop-host).
- GitHub/registry fallback: `github-connection.ts:20–56` (bounded проверка GitHub до pnpm, `killDescendants`), `index.ts:321–329,385–394` (порядок реестров: configured → fallbacks → pnpm config), дефолтный fallback — `NPMMIRROR_REGISTRY` (`index.ts:186`).

Следствие для MyWork (§36 вывод подтверждаю): собственный package/profile-mutation flow писать нельзя; persistent state MyWork должен лежать **вне** каталога профиля, иначе он попадает под writer-lock пакетных операций и под pnpm-мутации (`verify-profile.mjs` уже соблюдает это, работая в `.tmp`).

### §41. «DSH request-extension size limit» — ПОДТВЕРЖДЕНО, но УЖЕ, чем в документе

Коммит `193f9ce413` меняет три места в `packages/llm/llm-deepseek/src/request-extensions.ts`:

- `JSON.stringify({...body, ...extensions.fields})` обёрнут в try/catch; при ошибке сериализации payload = `JSON.stringify(body)` (базовый запрос **без всех** extension-полей), а `accept` становится no-op (`accept: () => Promise.resolve()`), чтобы contributors «resend their unaccepted state on a later request»;
- добавлен колбэк `onOmitted(fields, error)`; в `adapter.ts:107–112` он подключён к `dependencies.onExtensionsOmitted`, в `host.ts:26–33` — логируется как `llm-deepseek: sending route "…" without request extension fields … because they failed to serialize`;
- ограничение 8 MiB — это **конфиг одной contribution**, а не транспортный лимит: `packages/session/session-log-deepseek/src/index.ts` (`Config.maxBytes = z.number().step(1).min(1).default(8 * 1024 * 1024)`) и логика выбора самого длинного префикса событий, который влезает.

Проверка охвата: `prepareRequestExtensions` вызывается ровно из одного места — `packages/llm/llm-deepseek/src/adapter.ts:106` (grep по `packages/**`). То есть:
1. §41 верен как урок «не пихать board/memory/evidence в extension», но формулировка «DSH ограничивает размер optional request extension» описывает **deepseek-адаптер и одну его contribution**, а не общий механизм для всех провайдеров;
2. при срабатывании fallback отбрасываются **все** extension-поля запроса, а не только великое — значит любая MyWork-contribution может быть молча не доставлена (с логом в stderr);
3. требования §41 («references вместо payload», byte/serialization budgets на границах транспорта) остаются верными и обязательными: платформа даёт только «не сломать запрос», но не гарантирует доставку.

### §57. «Предлагаемый Host target (схемы)» — ЧАСТИЧНО (диаграмма верна, но путь Web в ней дороже, чем нарисовано)

Схема «Host Read/Command API → Typert Remote → MyWork Client Store → sidebar.panellist + main» реализуема (все узлы существуют, §20/§22), но диаграмма не отражает два обязательных узла конвейера: генератор артефактов (`lib/typert.remote-client.*`) между Host API и клиентом и монтаж contribution через `ctx.remote.$mount(contribution)` (`packages/api/gateway/src/client/index.ts:241–256`; `docs/api-gateway.md:78,91` — «Client applications assemble only `@deepseek-ai/dsh-api-remotes`»). То есть клиентская часть MyWork — это **свой assembly-плагин**, который импортирует `/remote`-субпуть своего пакета и монтирует его; без этого `ctx.remote.mywork` не появится, даже если Host-методы объявлены.

### §62. «Acceptance gate: Web package» — ПОДТВЕРЖДЕНО как чек-лист; три пункта требуют явных механизмов

- native `dsh.client` — `modules/src/client/manifest.ts:161–181`; `sidebar.panellist` + `main` — §22 выше.
- «no direct DOM mutation», «no independent TaskState store», «commands с expected revisions» — дисциплина, платформой не проверяется.
- «effect-clean unload/HMR»: HMR-канал клиентских плагинов существует — `packages/client/hmr/src/index.ts` (inject `['clientModules','webServer']`, `:27`), публикует SSE `/plugins/events` с графом и кадрами `rebuilt` (`:162,195–202`), смотрит baseline артефактов (`:130–131`) и умеет `ctx.clientModules.rebuilt(id)` (`:77`). Существенно: watcher DSH перестраивает **свои** клиентские бандлы; для внешнего пакета пересборку и вызов `rebuilt` обеспечивает сам издатель, иначе HMR не сработает.
- «reconnect → authoritative snapshot», «stream loss → degraded/recovering»: `ctx.remote.$host` даёт только `home` и `isLoopback` без подписки и без счётчика (cookbook `:111,142–146`); после реконнекта обновление — через `ctx.on('connection/reset')` или свой remote-event. Платформа не даёт «последней известной ревизии», это обязанность MyWork.
- «accessibility/keyboard» — на усмотрение UI; в слотах есть только `label`/`locale` метаданные (`ui-plugin-manager/src/client/index.ts:130–136`).

### §63. «Acceptance gate: DSH compatibility» — ЧАСТИЧНО: восемь пунктов проверяемы сегодня, три — нет

Проверяемы существующими средствами: Host boot и Web boot (`dsh --profile P`, `dsh --profile P --dump-config` — `apps/cli/src/args.ts:34,45,168,170`), Plugin Manager enable/disable (`packages/boot/plugin-manager/src/tools.ts:23`), model catalog (`ctx.get('llm')` — `packages/controller/src/model-catalog.ts:34,63–94,150`), Session start/resume/prompt/selectModel/cancel (`@Remote`-методы `sessionController`, `packages/api/session-controller/src/index.ts:251–519`), permission pin (`/permission` — вне потока C), restart (перезапуск профиля), incompatible runtime refusal (`plugin-compatibility.ts`), сохранность durable state при update/reinstall (следствие §36 — состояние вне профиля).

Не покрыто сегодня в MyWork: (1) HMR/recomposition для MyWork-клиента (нет `dsh.client` и нет watcher’а), (2) проверка на **другом** runtime (`verify-profile.mjs` умеет `--dsh-bin`, но матрицы сборок нет), (3) «durable MyWork state не повреждается plugin update/reinstall» — теста нет; `verify-profile.mjs` проверяет только неприкосновенность *чужого* профиля.

### §71. KEEP/CHANGE/ADD — ПОДТВЕРЖДЕНИЕ ТОЛЬКО ПО СТРОКАМ COMPAT/Web-ИНТЕГРАЦИИ

Строки, попадающие в мою зону, и их фактическая опора:

| Строка §71 | Статус по rc.2 |
|---|---|
| `missing DSH compatibility contract` → CHANGE | ПОДТВЕРЖДЕНО: MyWork не объявляет `@deepseek-ai/dsh*`-peer’ов, гейт молчит (`plugin-compatibility.ts:68,75`) |
| `native DSH global panel` → ADD | ПОДТВЕРЖДЕНО как исполнимая цель: `sidebar.panellist` + keyed `main` + `ctx.slots.inject/register` — штатный путь, отработанный внешним плагином |
| `Remote Board API/watch` → ADD | ЧАСТИЧНО: технически возможно, но требует воспроизведения Typert-конвейера; без него — HTTP-путь через `ctx.webServer` + Host `ctx.typertGateway.invoke/stream` |
| `iframe/DOM patch UI` → DO NOT ADOPT | ПОДТВЕРЖДЕНО: DOM-injection не нужен, но и `data-dsh-*`-контракта в DSH нет |
| `Host-only product composition` → CHANGE | ПОДТВЕРЖДЕНО: профиль — это `dsh.profile.bundles` + слои патчей (`packages/boot/app-boot/src/profile.ts:661–688`), а не «host-only» |
| `catalog listing = availability` → CHANGE | Вне потока C (см. поток по §37) |

---

## 3. Правки к плану MyWork (что конкретно менять)

### 3.1 Точный список полей манифеста

**`packages/controller/package.json`** (Host-часть; сегодня — `dsh.bundle.patch` + только cordis-peer):

```jsonc
{
  "name": "@dsh-mywork/controller",
  "version": "0.2.0",
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "icon.svg"],
  "icon": "./icon.svg",                     // package-manifest/types.ts:15–16: ≤256 KiB, внутри каталога
  "dsh": {
    "manifestVersion": 1,                    // types.ts:31–32
    "bundle": { "patch": "./cordis.patch.yml" },
    "engines": { "dsh": ">=0.1.7-rc.2" }     // декларативно (types.ts:23), НЕ заменяет peerDependencies
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.1.7-rc.2",      // <-- то, что читает compat-gate
    "@deepseek-ai/dsh-session": "^0.1.7-rc.2",
    "@deepseek-ai/dsh-llm": "^0.1.7-rc.2",
    "@deepseek-ai/dsh-commands": "^0.1.7-rc.2",
    "@deepseek-ai/dsh-agent": "^0.1.7-rc.2",
    "@deepseek-ai/cordis": "^4.0.4"
  },
  "devDependencies": {
    "@deepseek-ai/dsh": "0.1.7-rc.2",
    "@deepseek-ai/dsh-session": "0.1.7-rc.2",
    "@deepseek-ai/dsh-llm": "0.1.7-rc.2",
    "@deepseek-ai/dsh-commands": "0.1.7-rc.2",
    "@deepseek-ai/dsh-agent": "0.1.7-rc.2",
    "@deepseek-ai/cordis": "4.0.4"
  },
  "engines": { "node": "^22.19.0 || >=24.0.0" }
}
```

Обоснование: publish.md требует держать пакеты, инстансы которых должны совпадать с host, «under both peerDependencies and devDependencies»; peer-диапазон обязан удовлетворять текущий runtime при `includePrerelease` (`plugin-compatibility.ts:76–77`); `engines.node` следует синхронизировать с DSH (`^22.19.0 || >=24.0.0`), а не обещать `>=22.18.0`.

**Новый `packages/client-ui/package.json`** (браузерная панель):

```jsonc
{
  "name": "@dsh-mywork/client-ui",
  "version": "0.2.0",
  "type": "module",
  "main": "./lib/index.js",                  // инертная host-половина
  "types": "./lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "lib/client.js.map", "lib/types/**/*.d.ts"],
  "dsh": {
    "manifestVersion": 1,
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.1.7-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "^0.1.7-rc.2",
    "@deepseek-ai/dsh-client-ui-renderer": "^0.1.7-rc.2",
    "react": "^18.2.0",
    "@deepseek-ai/cordis": "^4.0.4"
  },
  "dependencies": { "@dsh-mywork/contracts": "workspace:*" }
}
```

Обязательные правила, доказанные кодом: `dsh.client.platform` присутствует и равен `web` (`manifest.ts:167–169`; `index.ts:841`); `exports['./client']` существует, иначе жёсткая ошибка (`index.ts:845–848`); всё, что не в `PLATFORM_MODULES` и не в `dsh.client.external`, **инлайнится** в бандл (`tsdown.client.ts:474,491–499,528–546`); `dsh.client.inject` — только информационный список (`package-manifest/src/types.ts:84`, `ui-workspace/src/client/index.ts:88–93`), порядок применения задаётся `ctx.slots.inject`.

**`packages/profile/package.json`** (установочный bundle) — выбрать одну из двух форм:

- Форма A (как `agent-team-profile`): без `dsh.client`, `dependencies` на `@dsh-mywork/controller` + `@dsh-mywork/client-ui`, `dsh.bundle.patch` указывает на патч, вставляющий **две** строки: `mywork-controller` (bare `@dsh-mywork/controller`) и `mywork-ui` (bare `@dsh-mywork/client-ui`). Это единственная форма, при которой UI-пакет вообще становится client-строкой (субпуть — не client-строка, `index.ts:874–875`).
- Форма B (как `@linxin666/dsh-web-all`): один пакет с `dsh.bundle.patch` + `dsh.client`, чей `lib/client.js` содержит UI (цена — размер: у эталона 2,4 МБ; вшивание даёт один бандл и одну строку, но пересборка UI тянет пересборку всего).

Для MyWork рекомендую **A**: контракты и UI разрабатываются независимо, HMR-цикл короче, а `inject`-гигиена слота соблюдается.

### 3.2 Точный `cordis.patch.yml` MyWork

`packages/controller/cordis.patch.yml` (замена текущего файла):

```yaml
# MyWork controller: одна строка, названная bare-именем пакета, чтобы модуль
# резолвился из установленной копии профиля (publish.md, «plugin rows reference
# the package by name»).
- insert:
    - id: mywork-controller
      name: '@dsh-mywork/controller'
      # config задаётся пользователем в его cordis.patch.yml — слой профиля
      # применяется после всех bundle-слоёв (publish.md, «The loading order»).
```

`packages/client-ui/cordis.patch.yml`:

```yaml
# UI-половина: строка обязана быть bare-именем пакета — субпуть не может быть
# client-строкой (packages/client/modules/src/index.ts:874-875).
- insert:
    - id: mywork-ui
      name: '@dsh-mywork/client-ui'
```

`packages/profile/cordis.patch.yml` (если выбран вариант с отдельным profile-пакетом):

```yaml
- insert:
    - id: mywork-controller
      name: '@dsh-mywork/controller'
    - id: mywork-ui
      name: '@dsh-mywork/client-ui'
```

Чего в патче делать **нельзя**: (1) называть строку субпутём, если она должна принести браузерный бандл; (2) рассчитывать на deep-merge `config` — «a patch replaces a row's entire `config` value rather than deep-merging keys» (publish.md, «The loading order»), поэтому MyWork-строка не должна размазывать конфиг по слоям; (3) задавать `disabled: true` на UI-строке «по умолчанию» и ждать, что plugin-manager сам её включит — включение пишется user-layer’ом (`disabled: false`), как это делает агрегат dsh-web-all.

### 3.3 Как проверять установку (точные команды и проверки)

Существующий `scripts/verify-profile.mjs` уже реализует почти весь нужный сценарий: pack → `dsh --profile <P> --from-default-profile sdk-minimal` (`:176`) → `dsh plugin --profile <P> add <tarball>` (`:182`) → сверка `dependencies[BUNDLE]` и `dsh.profile.bundles` (`:187–191`) → запись пользовательского `cordis.patch.yml` (`:195–205`) → `dsh --profile <P> --dump-config` с проверкой слоя/строки/конфига (`:208–213`) → boot с проверкой mount/stop-диагностик (`:217–222`) → fingerprint реального профиля до/после (`:127–134,228–231`).

Что добавить (новые проверки, по одной на риск):

1. `dsh --profile <P> --dump-config` должен содержать **обе** строки (`id: mywork-controller`, `id: mywork-ui`) и **оба** слоя (`# == @dsh-mywork/controller`, `# == @dsh-mywork/client-ui`).
2. Негативный тест версии: тот же профиль с `peerDependencies: { "@deepseek-ai/dsh": "999.0.0" }` в установленном манифесте → boot должен печатать ровно одну строку `skipping profile bundle …` (`profile.ts:118–122`) и **не** монтировать строки MyWork; затем `dsh plugin --profile <P> allow-version @dsh-mywork/controller@0.2.0 <runtime>` + `--accept-risk` → строка появляется (это проверка §33/§34 из §3.1).
3. Негативный тест клиента: удалить `exports['./client']` (или `dsh.client.platform`) из установленного `@dsh-mywork/client-ui` → boot должен упасть с `client-modules: … declares dsh.client but exports no "./client" bundle` (`index.ts:847`) — либо, если объявление убрано целиком, UI просто не появится; зафиксировать именно это различие.
4. Проверка выдачи бандла: `GET /plugins/@dsh-mywork/client-ui/client.js?rev=<rev>` отдаёт файл, начинающийся с `window.__ModuleLoader__.load({` (формат из `tsdown.client.ts:618–623`); и в графе (`--dump-config` → нет; вместо этого `/plugins/events` или инспектор) строка `@dsh-mywork/client-ui` присутствует.
5. Проверка панели: в браузере после boot — элемент `[data-dsh-panel-entry]` (своя конвенция) и открытие панели через `ctx.layout.selectPanel('mywork')` (проверяется e2e, не CLI).
6. Проверка изоляции состояния: после `dsh plugin --profile <P> remove @dsh-mywork/controller` и повторного `add` файлы MyWork-state (вне профиля) обязаны остаться байт-идентичными — hash до/после (расширение текущей fingerprint-идеи `:127–134`).
7. Проверка Cordis-инстанса: в собранном `lib/index.js` не должно быть ни одного runtime-import, кроме `@deepseek-ai/cordis` (сегодня так и есть: единственный `import`), и в профиле должен резолвиться один и тот же экземпляр Cordis — иначе сервисы MyWork не увидят сервисы DSH.

### 3.4 Точный список использованных API (файл:строка)

Host/платформа, уже используемая MyWork-контроллером:

| API | Объявление | Использование в MyWork |
|---|---|---|
| `Service`, `Context` из `@deepseek-ai/cordis` | `packages/controller/src/index.ts:12` | `MyWorkControllerService extends Service` (`:142`), `super(ctx, MYWORK_CONTROLLER_SERVICE)` (`:156`) |
| `ctx.effect(fn, label)` | Cordis | shutdown-эффекты (`packages/controller/src/index.ts:117,119`) |
| `ctx.get('llm')` | `packages/controller/src/model-catalog.ts:34,150` | каталог моделей (обёртка `listProviders/listModels/resolveModelInfo`) |
| `ctx.get('sessionController')` | `packages/controller/src/dsh-session.ts:57,665` | adapter Session API: `create/list/selectModel/prompt/cancel/follow/page` (`:175–220`) |
| `ctx.get('agents')` | `packages/controller/src/dsh-session.ts:60,678` | AgentRuntimePort |
| `ctx.get('commands')` | `packages/controller/src/dsh-session.ts:63,679` | `/permission` pin и команды |
| Host-ключи DSH, подтверждённые в исходниках | `packages/api/session-controller/src/index.ts:136` (`sessionController`, namespace `session`); `packages/api/gateway/src/index.ts:227` (`typertGateway`) | — |

Платформа для будущей Web-части (то, что нужно объявить/использовать):

| API | Объявление |
|---|---|
| `ctx.slots.inject(key, cb)` | `packages/client/ui-renderer/src/client/registry.ts:209` |
| `ctx.slots.register(options, component)` | `packages/client/ui-renderer/src/client/registry.ts:181` (→ `SlotCore.register`, `packages/client/ui-slots/src/index.ts:1157–1203`) |
| `ctx.slots.entries/entriesOfSlot/subscribe` | `packages/client/ui-slots/src/index.ts:1336,1352,1481` |
| `ctx.slots.provideRoot(contribution)` | `packages/client/ui-renderer/src/client/registry.ts:312` |
| слот `sidebar.panellist` (list, root) | `packages/client/ui-sidebar/src/client/contract/slots.ts:35` |
| слот `main` (keyed, root) | `packages/client/ui-layout/src/client/index.ts:73` |
| `ctx.layout.selectPanel(id)` / `panelInfo` | `packages/client/ui-layout/src/client/index.ts:163–169` (публикует layout-сервис) |
| `ctx.remote.$mount(contribution)` | `packages/api/gateway/src/client/index.ts:205,241–256` |
| `ctx.remote.$host` | `packages/api/gateway/src/client/index.ts:115` |
| `RemoteResult<T>` (ok/error) | `packages/typert/protocol/src/types.ts:76–78` |
| `@Remote`, `@Remote({mode:'stream'})`, `@RemoteScope` | `packages/typert/protocol/src/index.ts:198–257` |
| `TypertRemoteService` | `packages/typert/protocol/src/index.ts:166–180` |
| `RemoteError` + declaration merging | `packages/typert/protocol/src/remote-error.ts:12–29`; cookbook `:62–88` |
| `RemoteStreamHandle.send/end/dispose` | `packages/typert/protocol/src/types.ts:106–124` |
| PLATFORM_MODULES (что можно оставить external) | `packages/client/web/src/platform.ts:8–14` |
| формат клиентского бандла | `packages/client/tsdown.client.ts:473–499,618–623` |
| `dsh.client`-схема | `packages/client/modules/src/client/manifest.ts:161–181`; `packages/util/package-manifest/src/types.ts:80–94` |

Альтернативный (HTTP) путь, если Remote-конвейер не будет принят:

| API | Объявление |
|---|---|
| `ctx.webServer.register(route)` | `packages/host/webserver/src/index.ts:166` (`WebRoute` — `:42`) |
| `ctx.typertGateway.invoke({namespace, method, args, signal})` | `packages/api/gateway/src/index.ts:345` |
| `ctx.typertGateway.stream(...)` | `packages/api/gateway/src/index.ts:374` |
| образец у третьей стороны | `@linxin666/dsh-client-ui-task-board/src/{index.ts:35,388, host-runner.ts:259–265}` |

### 3.5 Что в §20/§22/§24/§33/§35/§41 выглядит иначе, чем в rc.2

| § | Формулировка документа | Как в rc.2 | Доказательство |
|---|---|---|---|
| §20 | «Это позволяет не создавать собственный loopback HTTP service» — как следствие, что Remote «просто есть» | Remote есть, но клиентская половина требует сгенерированных артефактов, а клиент **отказывается** монтировать SRC-дескрипторы | `docs/api-gateway.md:139`; `generator/src/workspace.ts:90–147`; `generator/src/tsdown-plugin.ts:86` |
| §20 | «concrete `ctx.remote.<namespace>` client services» | Верно, но namespace монтируется только явным assembly через `ctx.remote.$mount(contribution)`; shipped-сборка — `@deepseek-ai/dsh-api-remotes` | `api/gateway/src/client/index.ts:205,241–256`; `docs/api-gateway.md:78,91` |
| §20 | «typed `RemoteError` codes» | Верно: universal-коды только три (`gateway/bad-request|cancelled|internal`), остальные 19 — инфраструктурные gateway, доменные объявляет владелец | `typert/protocol/src/types.ts:49–56`; `api/gateway/src/remote-error-codes.ts:15–36` |
| §20 (неявно) | «Host services через Typert Remote» как единственный современный путь | HTTP через `ctx.webServer` + Host `typertGateway` — рабочий, применённый внешним плагином путь | `@linxin666/dsh-client-ui-task-board/src/index.ts:388`, `host-routes.ts:188–250` |
| §22 | «root scoped keyed `main`» без уточнений | `main` ретентит ключи из живых записей; id панели в `sidebar.panellist` обязан совпадать с ключом `main` | `ui-layout/src/client/index.ts:159–162`; `ui-sidebar/src/client/contract/slots.ts:32–35` |
| §22 | «`dsh.client` package metadata» как достаточное условие | Недостаточно: строка Loader’а обязана быть **bare-именем** пакета, `exports['./client']` обязателен, платформа обязана быть `web` | `client/modules/src/index.ts:841–848,874–875` |
| §23 | «feature package не импортирует runtime component другой feature package» | Подтверждено; но и `dsh.client.inject` **не** задаёт порядок применения — только информационные рёбра | `ui-workspace/src/client/index.ts:88–93` |
| §24 | «Agent Teams поставляется single bundle: agent-team-profile { domain, tool, client-ui }» | Формально верно, но `agent-team-profile` не содержит ни `dsh.client`, ни UI-кода; UI приходит отдельным пакетом с собственным `dsh.client`, а сам профильный пакет — это только `dsh.bundle.patch` + `dependencies` | `experimental/agent-team-profile/package.json`; `src/index.ts:8`; `experimental/client-ui-agent-team/package.json:29–40` |
| §24 | «UI package имеет inert Host entry, browser loader загружает `./client`» | Подтверждено | `client/ui-workspace/src/index.ts:9`; `client/modules/src/index.ts:845–848` |
| §33 | «DSH перед import проверяет `peerDependencies` на `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`» | Подтверждено; уточнение: проверка идёт **дважды** — для bundle-слоя по манифесту бандла (`profile.ts:665–682`) и для каждой строки перед импортом (`compatibility-preflight.ts:97–105`) | там же |
| §33 | «Отсутствующий DSH peer означает no constraint» | Подтверждено дословно (`if (!Object.hasOwn(fields,'peerDependencies')) return undefined`) | `plugin-compatibility.ts:68` |
| §35 | «DSH rc.2 — Node `^22.19.0 \|\| >=24.0.0`, TS `^6.0.3`, pnpm `11.7.0`» | Подтверждено; добавлено: Cordis 4.0.4 в vendor против 4.0.2 у MyWork, и TS 6.0.3 приходит ещё и как зависимость Typert-генератора | `vendor/cordis/package.json`; `typert/generator/package.json` |
| §41 | «fix ограничивает optional request extension payload и умеет не блокировать model request» | Уже: лимит 8 MiB — конфиг **одной** contribution `dsh_session_log`; fallback (payload без **всех** extensions) реализован в deepseek-адаптере, `prepareRequestExtensions` вызывается только оттуда | `session-log-deepseek/src/index.ts` (`maxBytes` default 8 MiB); `llm-deepseek/src/request-extensions.ts`; grep: `adapter.ts:106` — единственный вызов |

---

## 4. Новое, чего не было в документе и в плане

Все пункты ниже — проверенные факты rc.2, которых нет ни в документе, ни в плане MyWork, с оценкой «усилие / влияние / риск» (S — часы, M — дни, L — недели).

**F1. Typert Remote для внешнего репозитория — это сборочная зависимость, а не библиотека. У (M/L, влияние высокое, риск высокий).**
`docs/api-gateway.md:99–101` описывает двухфазный конвейер с `DSH_BUILD_FACE`; `packages/typert/generator/src/tsdown-plugin.ts:86` инстанцирует `WorkspaceTypertGenerator(root)`, где `root` — «directory containing face aggregate tsconfigs»; `workspace.ts:90–147` требует конкретных `exports`/`files`. Публично экспортируется (`generator/src/index.ts:14`), но вне монорепозитория никем не проверялось: MyWork должен собрать face-агрегаты, подключить `@deepseek-ai/dsh-typert-generator/tsdown` в свой tsdown и проверить, что клиентский бандл получает `lib/typert.remote-client.*`. Митигация: до принятия решения сделать **compile spike** в отдельной worktree (не в живом дереве), иначе §24-план рискует встать на середине.

**F2. HTTP-путь через `ctx.webServer` + Host `ctx.typertGateway.invoke/stream` — равноправная альтернатива с проверенным прецедентом (S/M, влияние высокое, риск средний).**
Внешний плагин `@linxin666/dsh-client-ui-task-board` 0.4.3 (367 КБ исходников в живом профиле) не объявляет ни одного своего Remote-метода: он регистрирует маршруты `/api/task-board/{state,action,events,parse}` (`src/host-routes.ts:188–250`) и вызывает shipped-эндпоинты Host-стороной (`src/host-runner.ts:259–265`). MyWork получает: произвольные формы запроса/ответа, отсутствие зависимости от Typert-генератора, контроль над кэшем. Теряет: типизацию, `RemoteResult`, uplink, `AbortSignal`-отмену, единый trust-check и защиту от коллизий namespace. Риск: самостоятельно реализованная авторизация маршрута (у DSH trust-check для `/api` один — `docs/api-gateway.md:125`).

**F3. Клиентский бандл — ручной контракт формата (M, влияние высокое, риск средний).**
DSH не предоставляет CLI для сборки клиентского бандла внешнего пакета: формат описан только кодом монорепозитория (`tsdown.client.ts:473–499,618–623`) — `format: 'cjs'`, `platform: 'browser'`, ровно `lib/client.js`, обёртка `window.__ModuleLoader__.load({id, factory})` с футером `return module.exports; } });`. MyWork обязан воспроизвести это своим tsdown-конфигом; иначе файл физически не зарегистрируется в таблице модулей (ошибка появится как «модуль не найден» в браузере, а не как ошибка boot).

**F4. `dsh.client.immediately` — не «предзагрузка», а фазовый барьер регистрации (S, влияние среднее, риск низкий).**
`packages/util/package-manifest/src/types.ts:86–87`: «Boot phase-one registration barrier; absent means the shared application batch». Для панели MyWork, которая обязана успеть зарегистрировать слот до отрисовки shell’а, `immediately: true` — правильная настройка; в документе §22/§24 поле не упомянуто вовсе.

**F5. Клиентская строка — только bare-имя пакета (S, влияние высокое, риск низкий).**
`packages/client/modules/src/index.ts:874–875`: субпуть (`@scope/pkg/sub`) не может быть client-строкой, потому что `exactPackageSpecifier` возвращает `undefined` и метод выходит до всякой резолюции. Это прямо ограничивает структуру §24: либо profile-пакет без UI (и тогда в патче **две** bare-строки), либо один пакет с вшитым UI (и тогда `client.js` растёт: у эталонного агрегата 2,4 МБ).

**F6. `dsh.engines.dsh` — мёртвое поле (S, влияние среднее, риск средний).**
Два независимых сторонних издателя (`dsh-client-ui-task-board` 0.4.3, `dsh-web-all` 0.4.3) объявляют `dsh.engines.dsh = ">=0.1.7-rc.2"`. В DSH это поле только объявлено типом: `packages/util/package-manifest/src/types.ts:23` — «DSH compatibility is declarative until a reader enforces it»; grep `engines` по `packages/boot/**` — 0 совпадений. Значит, если MyWork ограничится `dsh.engines`, гейт §33 останется молчащим, а несовместимый runtime — не диагностированным. Единственное работающее место — `peerDependencies`.

**F7. Exemption-файл профиля — часть контракта установки (S, влияние среднее, риск средний).**
`profile-compatibility.ts:20–38,95–139`: ключ `${name}@${version}` + **точная** версия runtime, значение не интерпретируется как диапазон, запись только с `--accept-risk`, файл режима `0o600`, и повреждённый файл «grants nothing» — то есть несовместимые плагины остаются заблокированными. Для MyWork это означает: узкий peer-диапазон + выпуск новой версии = каждая установка на новом rc требует либо расширения диапазона, либо ручного exemption у пользователя. Рекомендация: диапазон `>=0.1.7-rc.2 <0.2.0` для стартовой линии плюс матрица проверок.

**F8. Коллизия HTTP-маршрута с Remote-namespace (S, влияние среднее, риск средний).**
`packages/api/gateway/src/index.ts:313–319` — Gateway claim’ит двухсегментные эндпоинты при наличии строгого дескриптора **или SRC-метки**; `collectSrcClaims()` (`:322–336`) собирает метки из живых `remoteMethods()`. Если MyWork назовёт namespace `mywork` и одновременно поднимет `/api/mywork/*`, часть маршрутов будет перехвачена Remote-диспетчером (особенно при запуске из исходников, как сейчас). Безопасное правило: HTTP-префикс MyWork не должен совпадать с именем Remote-namespace (например, `/api/mywork-board` при namespace `myworkBoard`, либо `ns: 'mywork'` + `/api/mywork-ui`).

**F9. HMR внешнего клиентского плагина требует своего watcher’а (M, влияние среднее, риск средний).**
`packages/client/hmr/src/index.ts` (inject `['clientModules','webServer']`, `:27`) следит за baseline артефактов (`:130–131`), слушает `ctx.clientModules.rebuilt(id)` (`:77`) и раздаёт SSE `/plugins/events` с графом и кадрами `rebuilt` (`:162,195–202`). `pnpm run dev:web` пересобирает **свои** клиентские бандлы; для `@dsh-mywork/client-ui` пересборку и вызов `rebuilt` обеспечивает сам MyWork, причём писать он должен в установленную копию в профиле (иначе граф и файл разойдутся по mtime/size-базлайну). Это дополнительный аргумент за отдельный каталог для dev-цикла и за «переустановка вместо hot-patch» как основной сценарий.

**F10. Slot store — легальное место для view-состояния доски (S, влияние среднее, риск низкий).**
`packages/client/ui-slots/src/index.ts:601–610` (`PropsStore<H>` в `ComposedProps`) и `slots.md:70,101,107`: объявленный `store` даёт компоненту `useStore` + bound actions и сохраняется между ремоунтами; бизнес-состояние туда класть нельзя (`slots.md:196`). Для MyWork это ровно то место, где живут «выбранная колонка», «фильтр», «режим отображения» — и это не описано в §52 (там сказано «MyWork client stores» без привязки к механизму слотов).

**F11. `icon` — обязательный элемент презентации bundle’а (S, влияние низкое, риск низкий).**
`packages/util/package-manifest/src/types.ts:15–16`: `icon` — SVG/PNG/JPEG/WebP, ≤256 КиБ, внутри каталога манифеста после realpath. Оба образца (`agent-team-profile`, `dsh-web-all`, `dsh-client-ui-task-board`) его имеют. Для MyWork это часть «одной строки в списке плагинов» и в плане не упомянута.

**F12. Риск TS-границы: 5.7 против 6.0.3 (M, влияние среднее, риск средний).**
Проверено: DSH `devDependencies.typescript = ^6.0.3`, `tsconfig.base.json` DSH использует `moduleResolution: bundler`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `exactOptionalPropertyTypes`; MyWork — `~5.7.2` с тем же набором, кроме `skipLibCheck: true` (есть в обоих) и `verbatimModuleSyntax` (у MyWork `true`, у DSH `false`). Компиляция против `.d.ts` из tarball-ов может пройти, но `verbatimModuleSyntax: true` в MyWork запрещает то, что DSH позволяет в своих типах (`export type`-редиректы, `import` без type). Это **не проверено** — нужен spike (см. §5).

**F13. Host-путь MyWork уже верен, а клиентского пути нет (S, влияние высокое, риск низкий).**
Проверено: собранный `packages/controller/lib/index.js` содержит единственный runtime-import `@deepseek-ai/cordis`, все `@dsh-mywork/*` вшиты (`packages/controller/tsdown.config.ts`: `alwaysBundle` для трёх workspace-пакетов, `neverBundle` для cordis). То есть Host-часть **уже** готова к нативной установке, а отсутствует ровно браузерная половина и peer-контракт. Это меняет приоритеты: MW-карточки Web-интеграции должны начинаться не с «сделать API», а с «сделать installable UI-пакет и peer-манифест».

**F14. Один экземпляр Cordis — единственная неочевидная точка отказа установки (S, влияние высокое, риск средний).**
`packages/controller/lib/index.js` импортирует `Service` из `@deepseek-ai/cordis`; DSH в профиле резолвит свой Cordis (vendor 4.0.4). Любая попытка MyWork «утащить» свой Cordis (например, оставить `@deepseek-ai/cordis` в `dependencies`, а не в `peer`+`dev`) даст два инстанса и невидимость сервисов DSH для MyWork без внятной ошибки. Публикационная документация DSH это фиксирует (publish.md), но в плане MyWork ограничение не закреплено тестом.

---

## 5. Открытые вопросы и что я НЕ проверял

1. **Компиляция MyWork против типов DSH не проверялась** (F12). Не создавал worktree и не устанавливал tarball-ы `@deepseek-ai/dsh-*@0.1.7-rc.2`, поэтому утверждение «TS 5.7 соберётся против DSH-типов» — гипотеза, а не факт.
2. **Генерация Typert вне монорепозитория не проверялась** (F1). Не запускал `@deepseek-ai/dsh-typert-generator/tsdown` на внешнем пакете: неизвестно, требуется ли face-агрегат именно формы DSH (`tsconfig.host.json`/`tsconfig.client.json`) или хватит произвольного `tsconfig` с путями.
3. **Поведение браузера не проверялось вовсе**: ни HMR-канал, ни выдача `/plugins/<id>/client.js`, ни фактический рендер слота в живом GUI — выводы идут из кода DSH, а не из наблюдения.
4. **Не проверял, что внешнее монтирование `ctx.remote.$mount` с самодельным contribution действительно проходит проверки per-provider реестра** (`packages/typert/registry/src/*`), — читал только клиентский gateway и протокол.
5. **Не проверял `dsh.client.external` на практике**: внешние модули кроме `PLATFORM_MODULES` должны существовать как строки модульной таблицы; как именно они появляются для внешнего пакета (строка с `dsh.client` в другом пакете?) — из кода не вывел однозначно, требуется эксперимент.
6. **Матрица версий DSH (§34) не строилась**: других сборок DSH на машине нет, `--dsh-bin` в `verify-profile.mjs` не запускал.
7. **Плагин-менеджер живьём не проверялся** (никаких install/remove/enable): все выводы §36 — из кода и тестов репозитория.
8. **Schedule живьём не проверялся** (в shipped web-профиле строки выключены, поэтому и не мог быть запущен без изменения профиля, которое мне запрещено).
9. **Секция §19/§21/§57 — это проект, а не факт**: я проверял только наличие/отсутствие платформенных механизмов, а не правильность архитектурных рекомендаций.
10. **Файлы в `C:\Users\Dmitry\.dsh` только читались**; ничего не изменялось (в том числе не менялись `cordis.patch.yml`, `package.json`, леджер доски). Мутирующие эксперименты не проводились — worktree не создавалась.

---

## 6. CLAIMS

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
| C-01 | `@Remote` и `@RemoteScope` объявлены в `@deepseek-ai/dsh-typert-protocol` и поддерживают формы «голый декоратор», `@Remote('export')` и `@Remote({mode:'stream'})`. | `packages/typert/protocol/src/index.ts:198–257` | verified |
| C-02 | `@Remote({mode:'stream'})` принимает объект только с единственным ключом `mode: 'stream'`, иначе бросает `TypeError`. | `packages/typert/protocol/src/index.ts:216–221` | verified |
| C-03 | Вызов Remote не reject-ит: результат — `RemoteResult<T>` = `{ok:true,value}` \| `{ok:false,error}`; reject’ят только ошибки сборки. | `packages/typert/protocol/src/types.ts:70–78` | verified |
| C-04 | Uplink объявляется вторым типовым аргументом `RemoteStream<Out, In>` и читается хостом через `RemoteInvocation.uplink()`. | `packages/typert/protocol/src/types.ts:93,355–358,409–420` | verified |
| C-05 | Отмена передаётся как последний параметр `signal: AbortSignal`, не попадает в wire-args и доступна как `RemoteInvocation.signal`. | `packages/typert/protocol/src/types.ts:359–363,407–408` | verified |
| C-06 | Клиентский namespace смонтирован как дочерний Cordis-сервис с ключом `remote.<namespace>`. | `packages/api/gateway/src/client/index.ts:154,752–754` | verified |
| C-07 | Клиентское приложение обязано само смонтировать contribution через `ctx.remote.$mount()`; shipped-сборка делает это в `@deepseek-ai/dsh-api-remotes`. | `packages/api/gateway/src/client/index.ts:205,241–256`; `docs/api-gateway.md:78,91` | verified |
| C-08 | Клиентский Remote отказывается монтировать SRC-дескрипторы без строгих кодеков; типы и кодеки всегда приходят из ранее сгенерированных `lib/typert.remote-client.*`. | `docs/api-gateway.md:139` | verified |
| C-09 | Генератор Typert требует от контрибьютора `exports['./typert']` с точными путями `./lib/typert.host.{d.ts,js}` и перечисления обоих файлов в `files`, иначе падает с `TypertAnalysisError`. | `packages/typert/generator/src/workspace.ts:90–114` | verified |
| C-10 | Пакет с Remote-методами обязан дополнительно экспортировать `./remote` → `./lib/typert.remote-client.{d.ts,js}` и включить оба файла в `files`. | `packages/typert/generator/src/workspace.ts:115–147` | verified |
| C-11 | Typert-генератор публикуется как `@deepseek-ai/dsh-typert-generator` с субпутём `./tsdown` и зависит от `typescript ^6.0.3`. | `packages/typert/generator/package.json` (exports, dependencies) | verified |
| C-12 | Пример манифеста в cookbook не содержит поля `files`, тогда как генератор требует наличия сгенерированных файлов в `files` — расхождение документации и кода. | `docs/cookbook/adding-a-remote-api.md:94–103` против `packages/typert/generator/src/workspace.ts:109–114,143–147` | verified |
| C-13 | Gateway claim’ит только двухсегментные `/api`-эндпоинты, для которых есть строгий дескриптор или активная SRC-метка. | `packages/api/gateway/src/index.ts:313–336` | verified |
| C-14 | Сервис `sessionController` отдаётся клиенту под namespace `session`, то есть ключ сервиса и namespace не совпадают. | `packages/api/session-controller/src/index.ts:98–99,136` | verified |
| C-15 | Host-сервис `typertGateway` предоставляет `invoke()` и `stream()` для вызова Remote-эндпоинтов со стороны Host. | `packages/api/gateway/src/index.ts:227,345,374` | verified |
| C-16 | `webServer.register(route: WebRoute): () => void` — публичный способ поднять собственный HTTP-маршрут из плагина. | `packages/host/webserver/src/index.ts:42,145,166` | verified |
| C-17 | Внешний плагин `@linxin666/dsh-client-ui-task-board` 0.4.3 не объявляет собственных Remote-методов: он отдаёт свой API по HTTP и вызывает shipped-эндпоинты через `ctx.typertGateway`. | `%DSH_HOME%\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\src\index.ts:35,321,388`; `src\host-runner.ts:259–265`; `src\host-routes.ts:188–250`; `src\protocol.ts:13` | verified |
| C-18 | Сервис `slots` предоставляется плагином ui-renderer (`super(ctx,'slots')`). | `packages/client/ui-renderer/src/client/registry.ts:160` | verified |
| C-19 | Публичный API слотов включает `register`, `inject(key, cb)`, `provideRoot`, `entriesOfSlot`, `subscribe`. | `packages/client/ui-renderer/src/client/registry.ts:181,209,312`; `packages/client/ui-slots/src/index.ts:1352,1481` | verified |
| C-20 | Тип пропсов компонента слота не может содержать `Context`: `ComposedProps` собран из owner/key/inject/store/locale/standard-пропсов. | `packages/client/ui-slots/src/index.ts:242–258,601–610` | verified |
| C-21 | `sidebar.panellist` — список, чей id записи адресует соответствующий ключ панели `main`. | `packages/client/ui-sidebar/src/client/contract/slots.ts:32–35,77–79` | verified |
| C-22 | Ключи `main` не фиксированы: layout ретентит их из живых записей `slots.entries('main')`. | `packages/client/ui-layout/src/client/index.ts:159–162,167–168` | verified |
| C-23 | Схема `dsh.client`: обязательный `platform`, опциональные `inject` (информационные зависимости), `external` (точные модульные запросы), `immediately` (фазовый барьер). | `packages/client/modules/src/client/manifest.ts:161–181`; `packages/util/package-manifest/src/types.ts:80–94` | verified |
| C-24 | Пакет с объявленным `dsh.client` и без `exports['./client']` валит активацию ошибкой `declares dsh.client but exports no "./client" bundle`. | `packages/client/modules/src/index.ts:845–848` | verified |
| C-25 | Строка Loader’а с субпутём (`@scope/pkg/sub`) никогда не становится клиентской строкой. | `packages/client/modules/src/index.ts:874–875` | verified |
| C-26 | `PLATFORM_MODULES` содержит ровно девять спецификаторов: react, react/jsx-runtime, react-dom, react-dom/client, cordis, client-store, ui-slots, ui-primitives, ui-dockkit. | `packages/client/web/src/platform.ts:8–14` | verified |
| C-27 | Клиентский бандл обязан быть CJS-чанком, обёрнутым в `window.__ModuleLoader__.load({id, factory: (require) => { … return module.exports; }});`, с именем файла `client.js`. | `packages/client/tsdown.client.ts:473–499,618–623` | verified |
| C-28 | Бандлы клиентских плагинов выдаются по маршруту `/plugins/<package>/client.js?rev=<rev>`. | `packages/client/modules/src/index.ts:225,248–250` | verified |
| C-29 | `dsh.client.inject` — информационные рёбра загрузки/предзагрузки и не задают порядок применения; порядок обеспечивается `slots.inject()`. | `packages/client/ui-workspace/src/client/index.ts:88–93`; `packages/util/package-manifest/src/types.ts:84` | verified |
| C-30 | `agent-team-profile` не объявляет `dsh.client` и не содержит UI-кода: это только `dsh.bundle.patch` + `dependencies` на три пакета, а браузерная половина приходит отдельным пакетом `dsh-experimental-client-ui-agent-team`. | `packages/experimental/agent-team-profile/package.json`; `src/index.ts:8`; `packages/experimental/client-ui-agent-team/package.json:29–40` | verified |
| C-31 | Агрегат `@linxin666/dsh-web-all` 0.4.3 держит один `dsh.client` и вшивает UI семейства в свой `lib/client.js` (2 417 481 байт, содержит `sidebar.panellist`, `data-dsh-panel-entry`). | `%DSH_HOME%\profiles\web\node_modules\@linxin666\dsh-web-all\{package.json,cordis.patch.yml,lib\client.js}` | verified |
| C-32 | Compat-gate проверяет только peer-имена `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`; отсутствие `peerDependencies` означает отсутствие ограничений. | `packages/boot/app-boot/src/plugin-compatibility.ts:68,75` | verified |
| C-33 | Несовместимый bundle не ломает boot: он попадает в `skippedBundles` и печатается одной строкой stderr за старт. | `packages/boot/app-boot/src/profile.ts:665–682,113–122`; `apps/cli/src/profile-boot.ts:170` | verified |
| C-34 | Exemption выдаётся только на точную пару `name@version` + точную версию runtime, требует `--accept-risk` и хранится в файле режима `0o600`; повреждённый файл не даёт ни одного исключения. | `packages/boot/app-boot/src/profile-compatibility.ts:20–38,95–139` | verified |
| C-35 | Проверка совместимости строки выполняется до импорта её модуля. | `packages/boot/app-boot/src/compatibility-preflight.ts:97–105` | verified |
| C-36 | MyWork-контроллер объявляет только `@deepseek-ai/cordis` в `peerDependencies`, поэтому compat-gate для него молчит. | `H:\Repo\DSH-MyWork\packages\controller\package.json` (peerDependencies) + C-32 | verified |
| C-37 | Внешний плагин task-board публикуется с `peerDependencies: {"@deepseek-ai/dsh": ">=0.1.7-rc.2", "react": "^18.2.0"}` — реальная практика внешнего издателя. | `…\@linxin666\dsh-client-ui-task-board\package.json` (peerDependencies) | verified |
| C-38 | Поле `package.json.engines` (включая `engines.dsh`) типизировано, но не исполняется ни одним читателем DSH. | `packages/util/package-manifest/src/types.ts:23,56–66`; grep `engines` по `packages/boot/**/*.ts` → 0 совпадений | verified |
| C-39 | Коммит `cad6fef2fd` отключает строки `time-context`, `schedule` и `ui-schedule` в shipped web-композиции (`disabled: true`). | `git show cad6fef2fd -- packages/bundle/web-app` (exit 0) | verified |
| C-40 | Schedule поддерживает `after_seconds`/`at`/`every_seconds`/`daily`/`weekly`/`cron`, IANA-нормализацию, durable-хранилище через `storageDomain.open(scheduleDomain)`, CAS-правку по `request.expected` и событие `schedule/changed`. | `packages/schedule/schedule/src/index.ts:101,126,250–266,369–399`; `domain.ts:43–51,370–376`; `tools.ts:171` | verified |
| C-41 | Лимит 8 MiB относится к contribution `dsh_session_log`, а fallback «отправить базовый запрос без extension-полей» реализован в deepseek-адаптере — единственном вызывающем `prepareRequestExtensions`. | `git show 193f9ce413 -- '*src*'` (exit 0): `packages/llm/llm-deepseek/src/request-extensions.ts`, `packages/session/session-log-deepseek/src/index.ts`; grep `prepareRequestExtensions(` → `llm-deepseek/src/adapter.ts:106` | verified |
| C-42 | При срабатывании fallback отбрасываются все extension-поля запроса, а `accept` становится no-op, то есть contributor’ы обязаны переслать непринятое состояние позже. | `packages/llm/llm-deepseek/src/request-extensions.ts` (diff коммита 193f9ce413) | verified |
| C-43 | Захват writer-lock после смерти владельца реализован claim-файлом `…lock.takeover-<sha256(record)[0:16]>` с повторной проверкой записи и PID под claim’ом, что защищает от переиспользования PID. | `packages/util/atomic-write/src/index.ts:110–177` | verified |
| C-44 | Plugin Manager ждёт оставшийся pnpm-процесс предыдущей операции через записанное дерево `.plugin-manager/run.json` и отказывает с диагностикой, если оно ещё живо. | `packages/boot/plugin-manager/src/operations.ts:203–240` | verified |
| C-45 | DSH rc.2: `engines.node` = `^22.19.0 \|\| >=24.0.0`, `typescript` = `^6.0.3`, `packageManager` = `pnpm@11.7.0`; MyWork: `>=22.18.0`, `~5.7.2`, `pnpm@12.4.2`. | корневые `package.json` DSH и MyWork | verified |
| C-46 | Cordis в vendor DSH — 4.0.4, а MyWork объявляет devDep `4.0.2` и peer `^4.0.2`; compat-gate Cordis не проверяет, так как фильтрует имена по `@deepseek-ai/dsh*`. | `vendor/cordis/package.json`; MyWork `package.json` и `packages/controller/package.json`; C-32 | verified |
| C-47 | Собранный контроллер MyWork не имеет runtime-import’ов, кроме `@deepseek-ai/cordis` (workspace-пакеты вшиты). | `packages/controller/tsdown.config.ts` (`alwaysBundle`/`neverBundle`); первая строка `packages/controller/lib/index.js` | verified |
| C-48 | Существующая проверка установки MyWork (`scripts/verify-profile.mjs`) уже проходит путь pack → `--from-default-profile sdk-minimal` → `dsh plugin add` → `--dump-config` → boot в изолированном `DSH_HOME` и сверяет неизменность реального профиля хешами. | `H:\Repo\DSH-MyWork\scripts\verify-profile.mjs:127–134,170–232`; флаги CLI: `apps/cli/src/args.ts:34,45,168,170` | verified |
| C-49 | Контракт `data-dsh-panel-entry` / `contracts/semantic-attrs-v1.md` в DSH отсутствует: ни одной строки `data-dsh-*` в исходниках пакетов и ни одного файла `semantic-attrs*` в репозитории. | grep `data-dsh-panel-entry\|data-dsh-taskboard\|semantic-attrs` по `packages/**/*.ts` → 0 совпадений; поиск файла `semantic-attrs*` → нет | verified |
| C-50 | Канал HMR клиентских плагинов существует: SSE `/plugins/events` публикует граф и кадры `rebuilt`, а watcher читает baseline артефакта и уведомляется через `ctx.clientModules.rebuilt(id)`. | `packages/client/hmr/src/index.ts:27,77,130–131,162,195–202` | verified |

