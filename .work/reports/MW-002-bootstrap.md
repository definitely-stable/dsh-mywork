# MW-002 — Создать минимальный каркас Cordis-плагина

- Предмет: карточка доски `cc19da5a-ff24-45ed-8b19-236e02b2556d` (MW-002), этап `00-foundation`
- Исполнитель: сессия `session-67f6c16a-eeb6-4e8d-afb1-42e92783dee8` (DeepSeek V4.1 Flash, DSH Web)
- Дата: `2026-09-17 22:45 +05:00`
- Репозиторий: `H:\Repo\DSH-MyWork`, base SHA `209a92d486ce71e8207349cf7ffe68ed0e2d6315` (HEAD не двигался, коммитов нет)
- Окружение: Node `v24.19.0`, pnpm `12.4.2`, DSH `0.1.5-rc.2`, `@deepseek-ai/cordis` `4.0.2`
- Статус: **DONE** — работа завершена и закоммичена (коммиты `869cfe1`…`e8b3cc2`, принадлежность карточкам указана в телах сообщений и в MW-003 §10); ревью-статус снят решением владельца, отдельное независимое ревью каркаса не выполнялось (см. §8)

---

## 1. Проверка зависимости MW-001

| Что проверено | Результат |
|---|---|
| Отчёт MW-001 (`reports/MW-001-target-capabilities.md`, ревизия 2) | Существует, 346 строк |
| Независимое ревью (`reports/MW-001-review.md`, 17.09 22:01) | **ПРИНЯТО С ЗАМЕЧАНИЯМИ (PASS WITH FINDINGS)**; «Блокировок для MW-002…MW-009 нет: их предпосылки (каркас Cordis, доменные контракты, SQLite, adapter SDK, конфигурация) от F2/F3 не зависят» |
| Замечание F2 (локальный патч pi-ai для `opencode-go/deepseek-v4.1-flash`) | MW-002 не вызывает моделей и не зависит от каталога моделей → не влияет |
| Замечание F3 (внешний memory adapter) | К MW-002 не относится |
| Открытый вопрос MW-001 №3 (пин pnpm `11.7.0` против установленного `12.4.x`) | Помечен как «решение нужно до MW-002»; принято рабочее решение и вынесено владельцу (§7.1) |
| Дрейф версий F4 (Task Board 0.3.23, pnpm 12.4.2, dsh-context 0.53.x) | Учтён: проверки выполнялись на актуальных версиях текущей сессии |

Вывод: зависимость MW-001 принята (с замечаниями), MW-002 не блокируется. Остановки с BLOCKED не требуется.

---

## 2. Сделано

Создан минимальный, но рабочий каркас плагина `dsh-mywork` в корне репозитория (pnpm-workspace):

1. **Структура пакетов** с сохранением границ `contracts → core → adapter-sdk → controller` (§38, §45, §46). Пустых пакетов «на каждый пункт» §45 нет: созданы только четыре пакета, и в каждом есть реальное содержимое.
2. **Сборка TypeScript** на подтверждённом инструментарии DSH: `tsdown` (rolldown) как сборщик + `tsc --noEmit` как typecheck; строгость `tsconfig` повторяет `tsconfig.base.json` DSH (es2024, `moduleResolution: bundler`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `.ts`-импорты с `allowImportingTsExtensions`).
3. **Активация/выгрузка плагина**: контроллер публикует Cordis-сервис `myworkController` (класс `Service`) и снимает его через `ctx.effect(() => () => service.stop(), 'mywork controller shutdown')`.
4. **Публикационная форма** по `docs/user/develop/basic/publish.md`: `dsh.bundle.patch` → `cordis.patch.yml` с `insert`-строкой `id: mywork-controller`, `main/exports/files`, peer-dependency на `@deepseek-ai/cordis`, самодостаточный `lib/index.js` (workspace-пакеты инлайнятся, cordis остаётся внешним — единый инстанс Host).
5. **Команды проверок**: `typecheck`, `build`, `smoke` (воспроизводимый smoke без LLM), `check` (все три), `pack:local`, `verify:profile` (изолированный профиль).
6. **Основа FakeClock/FakeRuntime без LLM** (§58): `FakeClock` и `FakeAgentRuntime` в `@dsh-mywork/adapter-sdk/testing`, оба реализуют порты из `contracts` и проверяются в smoke.

### Физическая структура

```text
package.json                     корневые скрипты, пин pnpm@12.4.2, devDeps (cordis/tsdown/typescript/@types/node)
pnpm-workspace.yaml              packages/*
tsconfig.base.json               общая строгость + paths на исходники @dsh-mywork/*
packages/contracts/              @dsh-mywork/contracts  — имена сервисов, ControllerInfo, ClockPort, AgentRuntimePort
packages/core/                   @dsh-mywork/core       — конфигурация, состояние жизненного цикла, systemClock, диагностика
packages/adapter-sdk/            @dsh-mywork/adapter-sdk — манифесты возможностей (§37), AdapterError, ./testing (fakes)
packages/controller/             @dsh-mywork/controller  — Cordis-плагин + cordis.patch.yml (bundle)
scripts/smoke.mjs                воспроизводимый smoke (mount/dispose, fakes)
scripts/pack.mjs                 локальная упаковка через pnpm pack
scripts/verify-profile.mjs       изолированный DSH-профиль: установка, compose, boot, выгрузка
scripts/lib/process.mjs          spawn с файловым stdio (совместимо с confined-шеллом)
```

---

## 3. Изменённые и новые файлы

Коммита нет (карточка запрещает без отдельного поручения). `git status` относительно base SHA `209a92d`:

```text
 M README.md                         (был «# dsh-mywork», стал описанием проекта и команд)
?? .gitignore                        (/.work/, /.tmp/, /.pnpm-store/, node_modules/, lib/, *.tgz)
?? package.json
?? pnpm-workspace.yaml
?? pnpm-lock.yaml
?? tsconfig.base.json
?? packages/…                        (4 пакета: манифесты, tsconfig, tsdown.config.ts, src/, cordis.patch.yml)
?? scripts/…                         (smoke.mjs, pack.mjs, verify-profile.mjs, lib/process.mjs)
```

Новые файлы (строк): `packages/contracts/src/index.ts` 95, `packages/core/src/index.ts` 156, `packages/adapter-sdk/src/{index,capabilities,errors,testing}.ts` 14/84/41/139, `packages/controller/src/index.ts` 108, `packages/controller/cordis.patch.yml` 14, `scripts/smoke.mjs` 197, `scripts/verify-profile.mjs` 212, `scripts/pack.mjs` 56, `scripts/lib/process.mjs` 81, `README.md` 52.

`LICENSE` (MIT, «Definitely Stable») не менялся — манифесты объявляют `"license": "MIT"`.

---

## 4. Команды и exit codes

| Команда | Exit | Что доказывает |
|---|---|---|
| `pnpm install` | 0 | workspace из 5 проектов, 49 пакетов из реестра, локальный store |
| `pnpm run typecheck` | 0 | `tsc --noEmit` в каждом из 4 пакетов (без вывода ошибок) |
| `pnpm run build` | 0 | `tsdown` → `lib/index.js` + `lib/*.d.ts` в каждом пакете, без предупреждений |
| `pnpm run smoke` (`node scripts/smoke.mjs`) | 0 | 9 шагов `ok`, включая mount/unload и fakes |
| `pnpm run check` | 0 | typecheck + build + smoke за один прогон |
| `node scripts/pack.mjs` / `pnpm run pack:local` | 0 | tarball `dsh-mywork-controller-0.1.0.tgz` |
| `node scripts/verify-profile.mjs --dsh-bin <prebuilt cli>` | 0 | упаковка → `dsh plugin add` → `--dump-config` → boot → выгрузка в изолированном `DSH_HOME` |
| `pnpm run verify:profile` (штатный launcher `~/.dsh/bin/dsh.cmd`) | 1 | **ограничение sandbox-сессии**, не дефект плагина: см. §6.1 |

---

## 5. Evidence

### 5.1 Smoke (без LLM, без subprocess, без wall-clock)

```text
ok   plugin module exposes the bundle entry shape
ok   mount publishes myworkController and freezes its snapshot
ok   unload removes the service and settles the controller
ok   diagnostics config writes one line per lifecycle transition
ok   configuration resolution accepts defaults and rejects malformed rows
ok   a malformed row config fails the plugin load loudly
ok   FakeClock advances, resolves, and cancels deterministically
ok   FakeAgentRuntime records runs and fails like the port contract
ok   adapter manifests validate before registration
smoke: all steps passed
```

Проверяется, среди прочего: `ctx.get('myworkController')` существует после mount и `undefined` после `fiber.dispose()`; `info().mountedAt` берётся из подставленного `FakeClock` (1000); `Object.isFrozen(info)`; эффект `mywork controller shutdown` виден в `fiber.getEffects()`; снятый сервис переходит в `status: 'stopped'` со `stoppedAt`; `CONTROLLER_VERSION` совпадает с версией `package.json`.

### 5.2 Упаковка

```
$ node scripts/pack.mjs
pack: @dsh-mywork/controller@0.1.0
H:\Repo\DSH-MyWork\.tmp\pack\dsh-mywork-controller-0.1.0.tgz
```

Содержимое tarball (`tar -tzf`): `package/package.json`, `package/cordis.patch.yml`, `package/lib/index.js`, `package/lib/index.d.ts` (+ `.map`), `package/LICENSE`. В упакованном манифесте нет `dependencies`; единственный runtime-импорт собранного `lib/index.js` — `import { Service } from "@deepseek-ai/cordis"` (workspace-пакеты инлайнены).

### 5.3 Изолированный тестовый профиль

```
$ node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js
dsh: node.exe <checkout>\apps\cli\lib\bin.js
home: H:\Repo\DSH-MyWork\.tmp\verify-profile\home (isolated; the user profile is not used)
ok   packed …\dsh-mywork-controller-0.1.0.tgz
ok   created isolated profile mywork-verify from the sdk-minimal template
ok   dsh plugin add installed the packed bundle
ok   profile bundles reconciled: ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller"]
ok   composed profile contains the controller layer, row, and overlay config
ok   profile boot mounted and unloaded the controller
     dsh-mywork: controller mounted service=myworkController version=0.1.0 contexts=control
     dsh-mywork: controller stopped service=myworkController version=0.1.0 uptimeMs=33
ok   user profile untouched (3 fingerprint(s) unchanged)
ok   removed the isolated work directory
verify:profile: PASS
```

Манифест профиля после установки:

```json
{ "dependencies": { "@dsh-mywork/controller": "file:…/dsh-mywork-controller-0.1.0.tgz" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-sdk-minimal", "@dsh-mywork/controller"] } } }
```

Составленный конфиг (`dsh --profile mywork-verify --dump-config`):

```yaml
# == @dsh-mywork/controller, patched by …\mywork-verify\cordis.patch.yml
- id: mywork-controller
  name: '@dsh-mywork/controller'
  config:
    diagnostics: true
```

Потоки boot: **stdout пуст**, обе диагностические строки — в **stderr** (важно для приложений, где stdout принадлежит протоколу, например JSON-RPC у `sdk-minimal`); exit code 0.

Независимость от рабочего профиля: `verify-profile.mjs` подставляет `DSH_HOME` только для своих дочерних процессов и сравнивает SHA-256 трёх файлов реального профиля (`profiles/web/package.json`, `profiles/web/cordis.patch.yml`, `settings.yaml`) до и после — все три не изменились. Живой профиль `web` не перезапускался, доска не менялась.

### 5.4 Реальные API, по которым построен каркас

| Механизм | Источник (проверено в этой сессии) |
|---|---|
| Bundle = `dsh.bundle.patch` → `cordis.patch.yml`; установка tarball через `dsh plugin add`; проверка `--dump-config` | `docs/user/develop/basic/publish.md` |
| Реконсиляция `dsh.profile.bundles` по установленной зависимости | `apps/cli/src/plugin.ts` (`reconcilePlugins`, `exportsPatch`) |
| `dsh.bundle` обязателен у слоя, иначе fail loud | `packages/boot/app-boot/src/profile.ts:794` |
| Стартовая форма плагина: `name` + `apply(ctx, config)`, `Service(ctx, name)`, `ctx.effect`, `fiber.dispose()`, `ctx.get`/`provide` | `docs/cordis-tutorial/01-first-plugin.md`, `docs/cordis-api/{fiber,context,service}.md`, `vendor/cordis/src/service.ts` |
| Плагины декларируют cordis как peer, а не бандлят его (единый инстанс из installation fallback) | `package.json` установленных плагинов (`dsh-context`, `@nanmicoder/dsh-auto-mode`, `@linxin666/dsh-client-ui-task-board`), комментарий `profile.ts:150–160` |
| Сборка `tsdown` + `tsc` и стиль `tsconfig` | `tsdown.config.ts`, `tsconfig.base.json`, `packages/*/*/tsconfig.json` в checkout DSH |

---

## 6. Ограничения, риски и что осталось непроверенным

### 6.1 Штатный `pnpm run verify:profile` не работает в этой confined-сессии (environmental)

Launcher `~/.dsh/bin/dsh.cmd` запускает DSH из исходников через `pnpm --dir <checkout> dsh` → `node --import tsx/esm apps/cli/src/bin.ts`; esbuild пытается создать pipe для своего service worker и получает `spawn EPERM` — документированная граница sandbox-шелла (то же ограничение зафиксировано в MW-001 §8.1). Обход для проверки: собранный CLI checkout (`node <checkout>/apps/cli/lib/bin.js`) через `--dsh-bin`/`DSH_BIN`; он не требует esbuild, и вся цепочка проходит. Штатный путь остаётся корректным для владельца вне sandbox.

### 6.2 Тот же барьер исключает test-runner с пулами процессов

`node --test` (и, по той же причине, vitest/`forks`) в confined-шелле падает на `spawn EPERM`, потому что раннеры поднимают дочерние процессы с pipe. Поэтому «один воспроизводимый smoke» реализован как обычный `node`-скрипт с `node:assert` (в процессе, без пулов). Полноценный test-runner нужен на MW-003+, когда появятся доменные тесты; тогда потребуется либо `pool: 'threads'`, либо запуск вне sandbox — это отдельное решение, оно не принималось.

### 6.3 Локальный патч pi-ai (замечание F2 MW-001) не затрагивался

MW-002 не вызывает моделей, не читает каталог и не трогал checkout. Предупреждение F2 остаётся в силе для MW-013/MW-015.

### 6.4 Прочее

1. Пакеты помечены `"private": true` — публикация в реестр (и снятие этого флага) требует отдельного решения владельца; распространение идёт tarball-ом через `dsh plugin add`.
2. `pnpm` создал content-addressable store внутри репозитория (`H:\Repo\DSH-MyWork\.pnpm-store`, ≈55 МБ); каталог добавлен в `.gitignore`, на Git не влияет. Кэш/логи упаковки лежат в `.tmp/` (тоже игнорируется).
3. Изолированный профиль собран из шаблона `sdk-minimal`: он монтирует полное дерево (agent loop, sessions, tools), но **не выполняет ни одной задачи** и не обращается к провайдеру — так соблюдено требование «без платных LLM-проб». Полноценный web/агентный прогон в MW-002 не проверялся.
4. Проверка «активируется/выгружается» выполнена на реальном CLI, но не через Task Board: доска при этом не читалась и не менялась.
5. Тесты домена, sqlite, adapters и UI в объём MW-002 не входят и не создавались (§45-осторожность: без speculative scaffolding).
6. Один реальный технический вывод, который стоит зафиксировать: сервисы Cordis отдаются вызывающему через **прокси**, поэтому ECMAScript-приватные поля (`#field`) в классе сервиса недоступны (`TypeError: Cannot read private member #state`) — используются TS-`private` поля. В исходниках DSH `#`-полей нет; теперь это знание есть в коде с комментарием.

---

## 7. Открытые вопросы к владельцу

1. **Пин pnpm**: принят `packageManager: "pnpm@12.4.2"` (фактически установленная и проверенная версия; пин `11.7.0` в checkout DSH — чужая настройка). Подтвердить или заменить.
2. **`private: true`** на всех пакетах до этапа распространения (MW-041) — подтвердить; либо сразу готовить публикацию в npm.
3. **Диагностика контроллера**: одна строка в stderr на mount/stop при `diagnostics: true` (по умолчанию выключено). Устраивает ли такой контракт, или предпочтительнее вывод только через harness-logger/Doctor в MW-038.
4. **Sandbox-обходы** (`--dsh-bin`, smoke вместо test-runner) — считать ли их штатным документированным путём для confined-запусков (сейчас так и описано в README) или требовать запуск проверок владельцем вне sandbox.

---

## 8. Как воспроизвести проверки

Карточка закрыта: файлы вошли в коммиты `869cfe1`…`e8b3cc2` (раскладка — MW-003 §10),
`pnpm run check` на закоммиченном дереве → exit 0. Ниже — что именно воспроизводится.

Фокус проверки:

1. Воспроизвести `pnpm install && pnpm run check` (ожидается 0 и 9 `ok` в smoke).
2. Воспроизвести `node scripts/verify-profile.mjs --dsh-bin <checkout>/apps/cli/lib/bin.js` (ожидается PASS; `.tmp/verify-profile` удаляется самим скриптом).
3. Проверить, что публикационная форма соответствует `docs/user/develop/basic/publish.md`: `dsh.bundle.patch`, `insert`-строка, самодостаточный `lib/`, внешний только cordis.
4. Проверить границы пакетов: нет импортов `controller →` вниз, нет зависимостей `contracts/core/adapter-sdk` на cordis, `contracts` не содержит рантайм-логики.
5. Проверить, что рабочий профиль `web` и доска не менялись (в отчёте — fingerprint-проверка; независимо: `git status` в репозитории, mtime файлов `~/.dsh/profiles/web`).
6. Оценить решения §7 (в первую очередь пин pnpm и `private`) и ограничения §6.
