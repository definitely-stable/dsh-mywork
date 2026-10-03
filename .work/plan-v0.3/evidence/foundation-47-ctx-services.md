# F-47 · Инвентаризация реально используемых сервисов `ctx.*` (MyWork)

- **Шаг плана:** `20-STEPS-foundation.md` F-47 (@1279). **Карточка:** MW-041 (правка: `peerDependencies`, `engines`), P23 · **ADR-действие:** D04.
- **Ревизии:** база карточки — MyWork `d0c97bf`; фактический `HEAD` на момент финального скана — **`e28ff0b`** (две чужие коммита поверх базы: `718a703`, `e28ff0b`), рабочее дерево **грязное** (`packages/controller/src/app.ts` изменён, `budget-meter.ts` не отслеживается — правки параллельных сессий, не мои). DSH-checkout `c7c4c725c78` (= `0.1.7-rc.2`), `@deepseek-ai/dsh-app-boot@0.1.7-rc.2`, `@deepseek-ai/cordis@4.0.2`.
- **Время финального скана:** 2026-09-27 18:28:06 (локальное). Дерево живое — таблица §2 валидна для хешей из §9, а не «вообще».
- **`.work/` игнорируется git** (`.gitignore:1` → `/.work/`), поэтому у F-47 нет коммитируемого артефакта: `git add -- .work/plan-v0.3/evidence/foundation-47-ctx-services.md` → **exit 1**, `The following paths are ignored by one of your .gitignore files: .work`. Отсюда: «один коммит на шаг» для F-47 невыполним by construction (под .work — 0 отслеживаемых файлов, `git ls-files .work | Measure-Object` → 0).

## 1. Команды и охват

| # | Команда | Exit | Наблюдение |
|---|---|---|---|
| A | `Select-String -Path packages\*\src\*.ts -Pattern 'ctx\.[A-Za-z_][A-Za-z0-9_]*' -AllMatches` | 0 | **28** совпадений: controller **15**, beads-adapter **12**, storage **1** (комментарий). |
| B | `Get-ChildItem 'packages\*\src' -Recurse -Directory` → 0; `(Get-ChildItem 'packages\*\src\*.ts').Count` → 121 | 0 | вложенных каталогов нет, значит glob из (A) покрывает **все** исходники `packages/*/src`, а не подмножество. |
| C | `Select-String -Path packages\controller\src\*.ts -Pattern 'ctx\.[A-Za-z_][A-Za-z0-9_]*' -AllMatches` | 0 | **15** совпадений — полный список для гейта F-47 («покрывает все `ctx.*` из `packages/controller/src`»). |
| D | `Select-String -Path packages\*\src\*.ts -Pattern '\binject\b'` | 0 | **2** совпадения, оба — английское слово в комментариях (`contracts/src/context.ts:946`, `evidence/src/store.ts:47`). Ни один пакет MyWork **не объявляет Cordis `inject`**. |
| E | `Select-String -Path packages\*\src\*.ts -Pattern "@deepseek-ai/"` | 0 | **8** совпадений = **5** реальных импортов + **3** упоминания в комментариях; все 5 импортов — `@deepseek-ai/cordis`, ни одного `@deepseek-ai/dsh-*`. |
| F | `Select-String -Path packages\*\src\*.ts -Pattern 'typertGateway\|workspaceRegistry'` | 0 | **0** совпадений — `ctx.typertGateway` / `ctx.workspaceRegistry` в MyWork нет (см. §7.1). |
| G | `Select-String -Path packages\*\package.json -Pattern '"engines"'` | 0 | **0** из 12 манифестов объявляют `engines`. |
| H | `Select-String -Path packages\*\package.json -Pattern '"peerDependencies"'` | 0 | **1** из 12 — `packages/controller/package.json:30`. |

Импорты из (E) дословно:

```
beads-adapter/src/memory-plugin.ts:22  import type { Context } from '@deepseek-ai/cordis'
beads-adapter/src/plugin.ts:15         import type { Context } from '@deepseek-ai/cordis'
controller/src/dsh-session.ts:39       import type { Context } from '@deepseek-ai/cordis'
controller/src/index.ts:12             import { Service, type Context } from '@deepseek-ai/cordis'
controller/src/model-catalog.ts:23     import type { Context } from '@deepseek-ai/cordis'
```

## 2. Полная таблица `ctx.*` из `packages/controller/src` (команда C, 15 совпадений)

| # | Выражение | `файл:строка` | Имя сервиса | Тип | Пакет-владелец |
|---|---|---|---|---|---|
| 1 | `ctx.tokenMeter` | `controller/src/budget-meter.ts:7` | `tokenMeter` | платформенный, **НЕ чтение** (строка внутри JSDoc; F-51 ещё не подключил чтение — порт инжектится через `createBudgetMeter(tokenMeter)`, `budget-meter.ts:161`) | `@deepseek-ai/dsh-token-meter` (`packages/llm/token-meter`) |
| 2 | `ctx.get(DSH_SESSION_SERVICE)` | `controller/src/dsh-session.ts:730` | `sessionController` | платформенный, **чтение** | `@deepseek-ai/dsh-api-session-controller` (`packages/api/session-controller`) |
| 3 | `ctx.logger?.warn?.()` | `controller/src/dsh-session.ts:732` | `logger` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 4 | `ctx.logger?.warn?.()` | `controller/src/dsh-session.ts:738` | `logger` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 5 | `ctx.get(DSH_AGENTS_SERVICE)` | `controller/src/dsh-session.ts:743` | `agents` | платформенный, **чтение** | `@deepseek-ai/dsh-agent` (`packages/core/agent`) |
| 6 | `ctx.get(DSH_COMMANDS_SERVICE)` | `controller/src/dsh-session.ts:744` | `commands` | платформенный, **чтение** | `@deepseek-ai/dsh-commands` (`packages/interaction/commands`) |
| 7 | `ctx.effect(...)` | `controller/src/dsh-session.ts:768` | `effect` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 8 | `ctx.effect(...)` | `controller/src/index.ts:183` | `effect` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 9 | `ctx.get(MYWORK_CLOCK_SERVICE)` | `controller/src/index.ts:210` | `myworkClock` | **наш** | `@dsh-mywork/contracts` (`packages/contracts/src/index.ts:18`) |
| 10 | `ctx.get(DSH_LLM_SERVICE)` | `controller/src/model-catalog.ts:150` | `llm` | платформенный, **чтение** | `@deepseek-ai/dsh-llm` (`packages/llm/llm`) |
| 11 | `ctx.logger?.warn?.()` | `controller/src/model-catalog.ts:152` | `logger` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 12 | `ctx.logger?.warn?.()` | `controller/src/model-catalog.ts:158` | `logger` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 13 | `ctx.effect(...)` | `controller/src/model-catalog.ts:171` | `effect` | Cordis, встроенный | `@deepseek-ai/cordis` |
| 14 | `ctx.get('productTelemetry')` | `controller/src/telemetry.ts:7` | `productTelemetry` | платформенный, **НЕ чтение** (JSDoc: «read structurally through `ctx.get('productTelemetry')`») | `@deepseek-ai/dsh-host-product-telemetry-otel` (`packages/host/product-telemetry-otel`) |
| 15 | `ctx.get(PRODUCT_TELEMETRY_SERVICE)` | `controller/src/telemetry.ts:192` | `productTelemetry` | платформенный, **чтение** | `@deepseek-ai/dsh-host-product-telemetry-otel` |

Строки сервисных имён (собственные константы MyWork):

```
controller/src/model-catalog.ts:34  export const DSH_LLM_SERVICE = 'llm'
controller/src/dsh-session.ts:69    export const DSH_SESSION_SERVICE = 'sessionController'
controller/src/dsh-session.ts:72    export const DSH_AGENTS_SERVICE = 'agents'
controller/src/dsh-session.ts:75    export const DSH_COMMANDS_SERVICE = 'commands'
controller/src/telemetry.ts:28      export const PRODUCT_TELEMETRY_SERVICE = 'productTelemetry'
contracts/src/index.ts:12           export const MYWORK_CONTROLLER_SERVICE = 'myworkController'
contracts/src/index.ts:18           export const MYWORK_CLOCK_SERVICE = 'myworkClock'
contracts/src/index.ts:25           export const MYWORK_ADAPTERS_SERVICE = 'myworkAdapters'
```

Прочие обращения к контексту (не подпадают под regex `ctx.<имя>`, но это тот же контракт):

```
controller/src/index.ts:170  export async function apply(ctx: Context, config?: Config): Promise<void>
controller/src/index.ts:196  mountModelCatalog(ctx, adapters)
controller/src/index.ts:200  mountDshRuntime(ctx, adapters)
controller/src/index.ts:229  super(ctx, MYWORK_CONTROLLER_SERVICE)
controller/src/index.ts:281  super(ctx, MYWORK_ADAPTERS_SERVICE)
controller/src/dsh-session.ts:729 / model-catalog.ts:149  mount*(ctx: Context, adapters)
```

## 3. Платформенные сервисы: владелец и объявленный интерфейс

Владелец найден по `super(ctx, '<имя>')` в DSH-checkout:

| Сервис | Регистрация | Пакет-владелец | Объявленный интерфейс (`declare module '@deepseek-ai/cordis'`) |
|---|---|---|---|
| `llm` | `packages/llm/llm/src/index.ts:351` | `@deepseek-ai/dsh-llm` | `packages/llm/llm/src/index.ts:57` → `:59 llm: LlmRuntime` |
| `sessionController` | `packages/api/session-controller/src/index.ts:136` | `@deepseek-ai/dsh-api-session-controller` | `:71` → `:74 sessionController: SessionController` |
| `agents` | `packages/core/agent/src/index.ts:256` | `@deepseek-ai/dsh-agent` | `:27` → `:29 agents: AgentRegistry` |
| `commands` | `packages/interaction/commands/src/index.ts:277` | `@deepseek-ai/dsh-commands` | `:113` → `:115 commands: CommandRuntime` |
| `productTelemetry` | `packages/host/product-telemetry-otel/src/index.ts:102` | `@deepseek-ai/dsh-host-product-telemetry-otel` | `:15` → `productTelemetry: ProductTelemetry` |
| `tokenMeter` (F-51, пока не читается) | `packages/llm/token-meter/src/index.ts` (класс `TokenMeter`) | `@deepseek-ai/dsh-token-meter` | `token-meter/src/index.ts:94-96` (цитата из плана; в этой кампании не перепроверялась) |

Версии всех перечисленных платформенных пакетов — `0.1.7-rc.2` (проверено `ConvertFrom-Json` по каждому `package.json`; тот же номер у корня DSH-checkout).

Cordis-встроенные `logger` и `effect` — не платформенные сервисы DSH, а часть рантайма `@deepseek-ai/cordis@4.0.2`:

```
node_modules/.pnpm/@deepseek-ai+cordis@4.0.2/node_modules/@deepseek-ai/cordis/lib/types/context.d.ts:26-27  /** The logging service. Call `ctx.logger(name)`… */ logger: LoggerService;
node_modules/.pnpm/@deepseek-ai+cordis@4.0.2/node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts:8          interface Context extends Pick<Fiber, 'effect'> {
```

## 4. Остальные пакеты MyWork (команда A)

- `beads-adapter` (12): `ctx.get(MYWORK_ADAPTERS_SERVICE)` — `plugin.ts:94`, `memory-plugin.ts:105`; остальные 10 — `ctx.logger` (по 5 в каждом файле) и `ctx.effect` (`plugin.ts:113`, `memory-plugin.ts:124`). **Платформенных сервисов нет** — только наш `myworkAdapters`.
- `storage` (1): `background-jobs.ts:5` — `ctx.jobs` **внутри комментария** («The platform's `ctx.jobs` provider keeps every job in memory»), реального чтения нет. Это объясняет, почему durable-jobs сделаны таблицей, а не платформенным сервисом.

## 5. Механика гейта (DSH, файл прочитан целиком)

`C:\Reposit\deepseek-harness\deepseek-harness\packages\boot\app-boot\src\plugin-compatibility.ts` — 103 строки, прочитаны полностью. Импорты: только `node:fs`, `node:url`, `semver` (`:3-5`); слов `engines` и `peerDependenciesMeta` в файле нет.

- `:44-49` — `getDshRuntimeVersion()` читает `../package.json` **самого app-boot** (`@deepseek-ai/dsh-app-boot@0.1.7-rc.2`), не CLI.
- `:68` — `if (!Object.hasOwn(fields, 'peerDependencies')) return undefined` — нет ключа ⇒ гейта нет.
- `:75` — `if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue` — проверяются только `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`; `@deepseek-ai/cordis` пропускается.
- `:76` — `const requirement = ['workspace:^','workspace:~','workspace:*'].includes(range) ? runtimeVersion : range`.
- `:77` — `if (requirement.trim() === '' || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) { peers[name] = range }`.
- `:81` — `if (Object.keys(peers).length === 0) return undefined` — пустой набор несовместимых тоже даёт `undefined`.

Вывод: сегодня единственный peer MyWork (`@deepseek-ai/cordis: ^4.0.2`) под фильтр `:75` не подпадает ⇒ гейт **молчит от слепоты**, а не «по делу».

## 6. `engines` не читается

- Команда: grep-инструмент (ripgrep) по `C:\Reposit\deepseek-harness\deepseek-harness\packages`, шаблон `\.engines\b`, фильтр `*.ts` → **1 совпадение**, и это комментарий: `packages/util/package-manifest/src/types.ts:56  /** Runtime version requirements under package.json.engines. */`.
- Команда: тот же инструмент, шаблон `dsh\?\.engines|engines\?\.dsh`, тот же корень → **0 совпадений**.

Оговорка: ripgrep уважает `.gitignore`, то есть собранные `lib/` и `node_modules/` не сканировались — намеренно (источник истины — исходники). В MyWork `engines` не объявлен нигде (команда G: 0/12).

## 7. Расхождения с планом, ADR и дрейф дерева

1. **План ссылается на несуществующие чтения.** F-47 (@1295) называет `ctx.agents`, `ctx.commands`, `ctx.typertGateway`, `ctx.workspaceRegistry` в `controller/src/index.ts:61-89`. В дереве: `index.ts:61-89` — это `export { … } from './app.ts'`/`'./migration-allocator.ts'` (экспорты, не сервисы), а `ctx.typertGateway`/`ctx.workspaceRegistry` дают **0 совпадений** по всем `packages/*/src` (команда F). Реальные чтения идут через `ctx.get(<константа>)` — таблица §2. Причина — D01 (Typert не выбран) и дрейф номеров строк.
2. **`dsh.engines.dsh`** (`adr/ADR-032-peer-version-policy.md:27`) требует поля «чтобы издатели и Plugin Manager видели требование». F-48 шаг 2 (@1324) понижает его до документации, а `lead-03-peer-gate.md:9` и §6 здесь показывают, что его не читает никто. **ADR-032 §2 в F-48 не реализуется**; расхождение требуют подтвердить `decision-desk`/`verifier-a` (об этом же просит сам F-48 @1334).
3. **Список платформенных сервисов вырос во время работы.** На 18:20:56 в таблице было 13 совпадений и 4 платформенных чтения; на 18:28:06 — 15 совпадений и 5 чтений: соседняя сессия закоммитила `controller/src/telemetry.ts` (коммит `e28ff0b`, F-54/D16) с чтением `ctx.get('productTelemetry')`. Ранее `app.ts`/`index.ts`/`migration-allocator.ts` тех же сессий тоже менялись (`718a703`, `e28ff0b`).
4. **`ctx.tokenMeter`** — пока только комментарий в незакоммиченном `budget-meter.ts:7` (F-51). Если F-51 подключит чтение в composition root, список вырастет на `@deepseek-ai/dsh-token-meter`; гейт это покроет объявлением `@deepseek-ai/dsh`, но таблицу §2 придётся дополнить.

## 8. Вывод (основание для F-48)

1. **Читаемых платформенных сервисов пять:** `llm`, `sessionController`, `agents`, `commands`, `productTelemetry`; шестой ожидается в F-51 (`tokenMeter`).
2. Гейт проверяет **имена пакетов** (`:75`), а не имена сервисов: peer «по сервисам» не включил бы гейт вообще (имя сервиса не матчит ни `@deepseek-ai/dsh`, ни `@deepseek-ai/dsh-*`) — сервисный список годится только как обоснование, не как механизм.
3. **Активатор гейта один — `@deepseek-ai/dsh`** (`:68` требует наличия `peerDependencies`, `:75` — совпадения имени): он покрывает несовместимость рантайма целиком, независимо от полноты сервисного списка.
4. Следствие для `packages/controller/package.json`: `peerDependencies` = `{"@deepseek-ai/cordis":"^4.0.2", "@deepseek-ai/dsh":">=0.1.7-rc.2 <0.2.0"}` — это и выполняет F-48.
5. Собственные сервисы (`myworkController`, `myworkAdapters`, `myworkClock`) и Cordis-встроенные (`logger`, `effect`) в peer-контракт не вносятся: первые — наши, вторые приходят с рантаймом `@deepseek-ai/cordis`, который уже объявлен (и гейтом не проверяется).

## 9. Стабильность снимка (SHA-256, первые 16 hex)

Файлы `packages/controller/src` на 18:28:06:

```
app.ts                  FA3F9703BA193AEF   (изменён, не мой)
budget-meter.ts         4B849256C2F1B9E9   (не отслеживается, не мой)
dsh-session.ts          2F0BB5FE5CEF355E
index.ts                E72695480DD0F8CC   (изменён, не мой)
migration-allocator.ts  15C9F65B1ECF8865   (изменён, не мой)
model-catalog.ts        42151DD2E6FE0B1E
telemetry.ts            B03C737B6F4F4F3A   (коммит e28ff0b, не мой)
```

Проверка таблицы §2 на другом снимке — повторить команду C и сверить номера строк; дерево живое, соседние сессии продолжают править `controller/src`.

## НЕ ПРОВЕРЕНО

- `@deepseek-ai/dsh-token-meter` (F-51): `declare module` в `token-meter/src/index.ts:94-96` взят из плана/`lead-03`, файл я не открывал; версия пакета (`0.1.7-rc.2`) проверена по `package.json`.
- Поведение установки при новом peer (`auto-install-peers`) — измеряется в F-48 (`foundation-48-peer-contract.md`), не здесь.
- Сканировались только `packages/*/src`; `scripts/`, `tests/` и `tsdown.config.ts` не инвентаризировались (чтений `ctx.*` там нет; в конфигах — только `neverBundle: ['@deepseek-ai/cordis']`).
- Коммит F-47 невозможен: `.work/` игнорируется git (см. шапку). Артефакт шага — только этот файл в рабочем дереве.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-47-ctx-services.md
