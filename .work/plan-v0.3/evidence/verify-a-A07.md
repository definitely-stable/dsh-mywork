# verify-a-A07 — DSH checkout (read-only) — платформенные утверждения

Проверяющий: независимый верификатор (группа A07). Дата проверки — текущая сессия.
Метод: только чтение первоисточников (`read`/`grep` по `C:\Reposit\deepseek-harness\deepseek-harness` и `.work/plan-v0.3`).
Мутаций в checkout не было: ни install, ни build, ни тестов, ни правок. Единственная запись — этот файл.
Все ссылки вида `packages/...` — от корня checkout `C:\Reposit\deepseek-harness\deepseek-harness`.

## Якорь A07-1: 01-MASTER-PLAN.md:302 (D-2 refutation #5) → `packages/host/webserver/src/index.ts:319-360` (якорь, цитируемый планом; признан неверным — фактические `:166-173` и `:222-238`, см. вердикт ниже)

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** прочитан `packages/host/webserver/src/index.ts` целиком (365 строк) + `grep` по `auth|token|401|403|origin|middleware` в пакете `packages/host/webserver`, прочитан `packages/host/webserver/README.md:39,113`. Плюс проверено положение самого ref: `01-MASTER-PLAN.md:310-322` — опровержение №5 стоит на строке **314**, а строка 302 — это строка таблицы `D16` (телеметрия).
- **Фактическое значение:** строки 319-360 содержат совсем другие члены класса:
  `319: private match(pathname: string): WebRoute | undefined {`
  `336: applyIndexTaps(html: string): string {`
  `360: renderIndex(html: string): string {`
  Ни одного из них к auth/middleware отношения нет.
- **Оценка severity:** minor
- **Комментарий:** утверждение **по сути верно**, но доказано не теми строками. Публичный API класса (строки 125-218) — ровно `register`, `registerUpgrade`, `registerFallback`, `tapIndex`, `[Service.init]`, `get port`, `get host`; ни auth-хука, ни точки расширения middleware там нет, событий объявлено одно — `webserver/index-inject` (`:34`). Сильнейшее прямое свидетельство — README пакета: `README.md:113` «**No server-wide TLS, authentication, or origin policy** — route owners such as `dsh-client-connection` enforce their own request policy» (то же в `:39`). Оговорка к букве «ни middleware»: middleware в файле **есть**, но ровно один, встроенный и нерасширяемый — gzip-обёртка (`NodeMiddleware` `:82-86`, `createGzipMiddleware` `:88-116`, поле `private readonly gzip` `:142`, вызов `:255-256`). Речь, следовательно, об отсутствии **точки расширения** middleware, а не об отсутствии middleware как такового. Для последствий D-2 (свой забор аутентификации обязателен) это ничего не меняет.

## Якорь A07-2: 10-DECISIONS.md:175 → `packages/typert/loader/src/index.ts:356`

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** `10-DECISIONS.md:168,175` (в строке 175 объединены два разных факта: (а) «заведомо статический список 23 контрибьюций» со ссылкой `lead-01:13` и `@deepseek-ai/dsh-api-remotes/client`; (б) проверка лоадера `packages/typert/loader/src/index.ts:356`); прочитан `packages/typert/loader/src/index.ts:335-368`; найден и прочитан настоящий источник — `packages/api/remotes/src/client/index.ts:174-195`.
- **Фактическое значение:** на указанной строке лоадера — `356: artifactPath.set(pkgName, null)` (комментарий `:354-355`: «loader builtins (cordis:include) и subpath-записи попадают сюда — перманентно не контрибьютор»). Настоящий жёсткий список — `packages/api/remotes/src/client/index.ts`:
  `177: for (const contribution of [`
  `178:   agentPresetsRemote, commandsRemote, settingsControllerRemote, accountRemote, goalsRemote, llmRemote, dynamicRemote, scheduleRemote,`
  `183: ]) {` (далее `184: disposers.push(await ctx.remote.$mount(contribution))`)
- **Оценка severity:** major
- **Комментарий:** **само число 23 подтверждено** — пересчёт литерала: 8 (строка 178) + 5 (`:179`) + 2 (`:180`) + 7 (`:181`) + 1 (`officeToPdfRemote`, `:182`) = **23**; список статический, обнаружения нет, монтирование только через `$mount`. Но привязка к `typert/loader/src/index.ts:356` ложная: это совсем другой пункт того же абзаца (проверка (2) спайка — молчаливый не-контрибьютор). Для шага спайка (3) из D01 это существенно: смотреть надо `packages/api/remotes/src/client/index.ts:177-183`, а не лоадер. Файл лоадера к клиентской доставке Remote-контрибьюций отношения не имеет.

## Якорь A07-3: 10-DECISIONS.md:1545 → `packages/util/package-manifest/src/types.ts:80-94`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `10-DECISIONS.md:1545`; прочитан `packages/util/package-manifest/src/types.ts` (файл целиком, 94 строки); для перекрёстной проверки формы — `grep` по `immediately|external|platform|icon` в `packages/client/modules/src` (`client/manifest.ts:160-180`, `src/index.ts:836-853`).
- **Фактическое значение:**
  `81: export interface DshClientManifest {`
  `83:   platform: string`
  `93:   external?: string[]`
  (строки 85 `inject?: string[]`, 87 `immediately?: boolean`; интерфейс заканчивается на `:94`, поля `icon` нет)
- **Оценка severity:** info
- **Комментарий:** схема ровно из четырёх полей, `platform` обязателен, `icon` отсутствует — подтверждено и валидатором клиентской половины: `packages/client/modules/src/client/manifest.ts:167` требует строку `platform`, `:171` — `external`, `:173` — булев `immediately`, `:176-179` собирает объект из этих же полей; `icon` не читается нигде (иконка берётся из верхнеуровневого манифеста). Две неточности формулировки, не влияющие на вывод: порядок полей в утверждении (`platform/inject/external/immediately`) отличается от фактического (`platform/inject/immediately/external`), и указанный в самой строке 1545 файл `manifest.ts:166-180` в `packages/util/package-manifest/src/` **отсутствует** (там только `index.ts` и `types.ts`) — фактический валидатор живёт в `packages/client/modules/src/client/manifest.ts:167-179`.

## Якорь A07-4: 10-DECISIONS.md:1549 (D18) → `packages/client/web/src/platform.ts:8-14` + `packages/client/tsdown.client.ts:392-405`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `10-DECISIONS.md:1549`, `01-MASTER-PLAN.md:304` (D18); прочитаны `packages/client/web/src/platform.ts` целиком (21 строка), `packages/client/tsdown.client.ts:380-425`; `grep` по `'react-dom/client'` по всему `packages/` (4 совпадения) — найден третий независимый список `packages/client/web/src/seed.ts:29-37`.
- **Фактическое значение:**
  `8: export const PLATFORM_MODULES = [`
  `9:   'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',`
  `14: ] as const`
  Пересчёт: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit` = **9**; `PRELOADED_CLIENT_EXTERNALS` (`:17-18`) действительно пуст.
- **Оценка severity:** info
- **Комментарий:** «ровно 9» верно и подтверждено тройным совпадением: `platform.ts:8-14`, `seed.ts:29-37` (те же 9 ключей таблицы модулей) и `tsdown.client.ts:419` (`...PLATFORM_MODULES`, импорт `:21`). Вторая ссылка утверждения — `tsdown.client.ts:392-405` — на счёт не работает: это JSDoc и тело `requestedExternals` (`401-406`), то есть требование «точное совпадение, без нормализации», соседнее в строке 1549, а не перечень имён. Никакого второго литерального списка имён в `tsdown.client.ts` нет.

## Якорь A07-5: 10-DECISIONS.md:1554 → `packages/client/ui-renderer/src/client/registry.ts:195-209`

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** `10-DECISIONS.md:1554` и `:1557`; прочитан `packages/client/ui-renderer/src/client/registry.ts:180-224`; найдены настоящие источники правила — `packages/client/ui-layout/src/client/service.ts:60-90`, `packages/client/ui-layout/src/client/index.ts:155-182`, `packages/client/ui-layout/src/client/stores.ts:93-101`.
- **Фактическое значение:** в указанных строках registry.ts — совсем другое требование (именно оно и есть содержание строки 1554 — «`ctx.slots.inject`»):
  `209: inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void {`
  Настоящее правило `id == key` живёт в ui-layout:
  `74: throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)` (`service.ts:72-75`)
  `168: ctx.slots.entries('main').some(entry => entry.options.key === id), panelInfo)` (`index.ts:167-168`; сбор ключей — `:159-162`, сброс `activePanelId` — `stores.ts:97-101`)
- **Оценка severity:** major
- **Комментарий:** утверждение **верно по сути** — `ctx.layout.selectPanel(id)` действительно бросает runtime-throw, если `id` не совпал ни с одним `options.key` записи слота `main`, а `retainMainPanels` собирает ровно `entry.options.key` и обнуляет `activePanelId`, когда ключ исчез. Но привязка к `registry.ts:195-209` ложная: это метод `slots.inject`, и он относится к строке 1554 плана, тогда как правило `id == key` — это строка **1557** (её собственные ссылки: `service.ts:72-77`; `index.ts:159-162,167-168`; `stores.ts:97-101`). Мелкое расхождение текста ошибки: в плане `main panel "<id>" is not registered`, фактически — с префиксом `layout.selectPanel: `. Для D18 вывод не меняется (id и key — одна константа), но исполнителю нельзя искать источник в `ui-renderer`.

## Якорь A07-6: 10-DECISIONS.md:1559 → `packages/client/store/src/contract.ts:58,93`

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** `10-DECISIONS.md:1559`, `01-MASTER-PLAN.md:304` (D18); прочитан `packages/client/store/src/contract.ts` целиком (143 строки, в т.ч. `:45-143`); для «слота» — `packages/client/ui-slots/src/index.ts:810-834` (`BaseOptions.store?`).
- **Фактическое значение:**
  `58:   persist?: string` (в `StoreSpec<T, A>`, `:56-60`)
  `93: export interface StoreHandle<T, A extends ActionsDecl<T>> {`
  Слот-место: `ui-slots/src/index.ts:823-824` — `/** Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope). */` `store?: H`
- **Оценка severity:** info
- **Комментарий:** обе указанные строки существуют и значат именно то, что заявлено: `:58` — механический ключ персиста в спеке, `:93` (с `:95-103`) — `StoreHandle` с `create(scopeKey?)` и суффиксным scope для персист-ключа. Вторая половина утверждения («…в store **слота**») подтверждается не этим файлом, а опцией `store?: H` в `BaseOptions` ui-slots (`:823-824`) — план её и цитирует рядом (`ui-slots/src/index.ts:823-824`). Дополнительно сходится и запрет записи: `PropsStore<H> = { useStore; actions }` (`:134-136`), в контракте нет ни `update`, ни `set` — единственная запись через `actions`. Итог: выбранный в D18 путь «view-состояние в слот-store» опирается на реальный контракт, а не на пересказ.

## Якорь A07-7: 01-MASTER-PLAN.md:340 (D04/D18) → `packages/host/webserver/src/index.ts` + peer-compat gate

- **Вердикт:** НЕВЕРНАЯ СТРОКА
- **Что проверено:** прочитан `packages/boot/app-boot/src/plugin-compatibility.ts:45-103`; `grep` по `engines|peerDependencies` в `packages/boot` (нашлись `app-boot/README.md:52`, `README.zh.md:52`, `src/profile.ts:358`, `src/profile-resolution/resolver.ts:210-222`); сверены ref-строки плана: `01-MASTER-PLAN.md:70`, `:290`, `:321`, `:356`, `10-DECISIONS.md:391,428`, `adr/ADR-032-peer-version-policy.md:16,40,100`.
- **Фактическое значение:** гейт — `packages/boot/app-boot/src/plugin-compatibility.ts`:
  `68: if (!Object.hasOwn(fields, 'peerDependencies')) return undefined`
  `75: if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue`
  (пустой набор → `81: if (Object.keys(peers).length === 0) return undefined`; README пакета `:52`: «These checks use peer declarations, **not `engines.dsh`**»)
- **Оценка severity:** minor
- **Комментарий:** утверждение **верно**: гейт читает только `peerDependencies` (`:68-69`), версии сверяет только для имён `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` (`:75`), поэтому объявленный MyWork `{"@deepseek-ai/cordis": "^4.0.2"}` молча пропускается (при отсутствии подходящих peers функция возвращает `undefined`, то есть отказа нет вовсе). Но указанный первоисточник неверен: `packages/host/webserver/src/index.ts` к гейту отношения не имеет (правдоподобно — занесён по инерции из якоря A07-1), а правильные координаты — `packages/boot/app-boot/src/plugin-compatibility.ts:68,75,81`. Также неверна ref-строка: `01-MASTER-PLAN.md:340` — это строка риска `R-11`; дословная формулировка «гейт читает только `peerDependencies` и пропускает `@deepseek-ai/cordis`» стоит в `01-MASTER-PLAN.md:290` (строка решения D04), а её опровержение — в `:321` (пункт 12) и `:70` (D-10). Единственное чтение манифеста помимо гейта — `resolver.ts:210-222` (`readPeerNames`), но оно про имена пакетов для графа резолюции, не про версии.

---

## Сводка

| ID | Вердикт | Severity |
|---|---|---|
| A07-1 | НЕВЕРНАЯ СТРОКА | minor |
| A07-2 | НЕВЕРНАЯ СТРОКА | major |
| A07-3 | ПОДТВЕРЖДЕНО | info |
| A07-4 | ПОДТВЕРЖДЕНО | info |
| A07-5 | НЕВЕРНАЯ СТРОКА | major |
| A07-6 | ПОДТВЕРЖДЕНО | info |
| A07-7 | НЕВЕРНАЯ СТРОКА | minor |

СУММА: подтверждено 3, неверная строка 4, ложно 0, не существует 0, устарело 0, не проверено 0.

Ни одно из утверждений не опровергнуто по существу: все семь проверенных тезисов верны фактически; четыре из них адресуют читателя не к тому файлу/строке (A07-1, A07-2, A07-5, A07-7), причём A07-2 и A07-5 указывают на другой пакет целиком.
