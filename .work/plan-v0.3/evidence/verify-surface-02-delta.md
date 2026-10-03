# evidence:verify-surface-02 — сырые замеры к разделу «Дельта 0.2.0-rc.2 (2026-10-03)» файла `93-VERIFICATION-SURFACE.md`

**Роль:** verifier-surface (falsify). **Дата:** 2026-10-03 (Asia/Yekaterinburg).
**Снимки:**
- DSH-чекаут `C:\Reposit\deepseek-harness\deepseek-harness`, `git rev-parse HEAD` = `639ed015397290b3745d163aafe02ffee4aa3f84`, `git describe --tags --exact-match` = `dsh-v0.2.0-rc.2`.
- MyWork `H:\Repo\DSH-MyWork`, `git rev-parse HEAD` = `4421c1305dab039d8260ca56b4cbb0487d0e9b19`.
- Документы плана (mtime / строк / sha256-16): `22-STEPS-surface.md` 03.10 11:38:22 / 1570 / `60EFADAB5B6EEF1F`; `10-DECISIONS.md` 11:29:09 / 1921 / `E6446557D61C91FE`; `01-MASTER-PLAN.md` 12:07:54 / 593 / `7FD142880576D299`; `README.md` 11:54:48 / 71 / `2CF39EC9D7C14644`; `adr/ADR-029-transport-web.md` 11:27:17 / 106 / `4FB397C1C97003C3`; `30-CARD-EDITS.md` 11:40:33 / 1427 / `DF15F4CAB5CED159`; `20-STEPS-foundation.md` 12:25:00 / 1980 / `A2115A7B0AB52AC7`.
- Соседние верификаторы писали в те же минуты (`90-` 13:01:47, `92-` 13:02:38, `91-` 13:07:37) — мои замеры привязаны к хешам выше, платформенные — к коммиту.

**Дрейф рабочего дерева чекаута (учтён).** `git status --porcelain` = 22 строки: 4 изменённых `SKILL.md` под `packages/preset|sandbox` и 11 untracked `packages/experimental/*/locale/ru.json` (+ мусор вне `packages`). `git diff --stat HEAD -- packages apps` = ровно эти 4 файла; ни один замер ниже их не касается. Все платформенные чтения — `git show 639ed0153:<path>` (или `git grep <rev>`), то есть из коммита, а не из рабочего дерева.

**Живой GUI (только чтение + HTTP-пробы, профиль не менялся).** Слушатель `0.0.0.0:3080` — PID 44684 `node --import tsx/esm apps/cli/src/bin.ts "web"`, родитель 21560 `cmd.exe /d /s /c …`, дед 14892 `pnpm.exe --dir C:\Reposit\deepseek-harness\deepseek-harness dsh web`. Профиль `C:\Users\Dmitry\.dsh\profiles\web` читался как файл (package.json, cordis.patch.yml, node_modules плагинов).

---

## 1. D2 — пересчёт Remote-контрибьюций (23 → 25)

**Команда (механический пересчёт, обе ревизии):**

```powershell
$ck='C:\Reposit\deepseek-harness\deepseek-harness'; $f='packages/api/remotes/src/client/index.ts'
function Count-List($rev) {
  $lines = git -C $ck show "${rev}:$f"
  $start = ($lines | Select-String -Pattern 'for \(const contribution of \[' | Select-Object -First 1).LineNumber
  $end = $start; while ($lines[$end-1] -notmatch '^\s*\]\) \{') { $end++ }
  $body = ($lines[($start)..($end-2)] -join ' ')
  return ($body -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}
$b = Count-List 'c7c4c725'; $h = Count-List '639ed0153'
Compare-Object $b $h
foreach ($rev in 'c7c4c725','639ed0153') {
  $imp = (git -C $ck show "${rev}:$f") | Select-String -Pattern '^import \w+Remote from '
  "rev=$rev remoteImports=$($imp.Count) first=$($imp[0].LineNumber) last=$($imp[-1].LineNumber)"
}
```

**Вывод:**

```
rev=c7c4c725 listStart=177 listEnd=182 count=23
rev=639ed0153 listStart=181 listEnd=187 count=25
--- added in head vs base ---
productAnalyticsRemote
userQuestionsRemote
--- removed ---
rev=c7c4c725 remoteImports=23 first=4 last=26
rev=639ed0153 remoteImports=25 first=4 last=29
```

(`listEnd` — строка закрытия `]) {`; элементы списка — строки `listStart+1 … listEnd-1`.)

**Точные якоря на `639ed0153`** (`git show 639ed0153:…`, нумерация 1-based):
- `:4` `import productAnalyticsRemote from '@deepseek-ai/dsh-client-product-analytics/remote'`, `:5` `export type {} from …product-analytics/remote`, `:6` agentPresets, `:7` userQuestions, `:8-29` остальные 23 → **импортов Remote ровно 25**, последний на `:29` (`workspaceFilesRemote`); `:30` — `import type { ClientRemote }` (не контрибьюция).
- Список: `:181` `for (const contribution of [`, элементы `:182-187`, `:188` `]) {`.
  `:182` 5 (productAnalytics, agentPresets, commands, settingsController, account), `:183` 4, `:184` 5, `:185` 2, `:186` 7, `:187` 2 (officeToPdf, userQuestions) = **25**.
- `:189` `disposers.push(await ctx.remote.$mount(contribution))` — `$mount` действительно `:184 → :189`.
- Файл 195 → **200** строк (`(git show …).Count`).

**Проверка якорей устаревшего класса** (`Get-ChildItem .work\plan-v0.3 -Recurse -Include *.md | Select-String '23 контрибьюц|23 клиентских|список 23'`):

```
10-DECISIONS.md:131   «жёстко зашитый список **23 контрибьюций** … :4-26,177-185»
10-DECISIONS.md:180   «жёстко зашитый список **23 контрибьюций** … (lead-01:13)»
10-DECISIONS.md:187   «заведомо статическом списке 23 контрибьюций (lead-01:13,14)»
01-MASTER-PLAN.md:308 «…(жёсткий список 23 контрибьюций)…»   (§7.1, строка D01)
01-MASTER-PLAN.md:548 R-45 «их 25 …» + статус «исправлено»
plan-v0.3/README.md:33 «…жёсткий список 23 клиентских контрибьюций…»
evidence/lead-01-typert.md:13 «…ЖЁСТКО ЗАШИТЫЙ список 23 контрибьюций — …:4-26 и :177-185»
90-VERIFICATION-A.md:296,319,427,434,462,467,491 / 92-RED-TEAM.md:367-391,479,496 — исторические проходы (не переписываются)
```

Уже исправлено: `adr/ADR-029-transport-web.md:16,49,56` (25, якоря `:4-29,181-188`, `$mount :189`), `22-STEPS-surface.md:867` (25 + оба добавленных имени), `01-MASTER-PLAN.md:102`.
`git status`/mtime подтверждают, что `ADR-029` правился 11:27, `22-STEPS` — 11:38, мастер — 12:07, а `10-DECISIONS` (11:29) и `README.md` (11:54) — нет.

## 2. `data-dsh-*` — перемер (32/13/3 против 28/9/3)

**Команда A (мой счёт, независим от ripgrep):**

```powershell
$ck='C:\Reposit\deepseek-harness\deepseek-harness'
function Measure-Scope($rev, $pathspec) {
  $raw = git -C $ck grep -o -n 'data-dsh-[A-Za-z0-9_-]*' $rev -- $pathspec
  $parsed = $raw | ForEach-Object { $p = $_ -split ':',4; [pscustomobject]@{Path=$p[1];Line=$p[2];Match=$p[3]} }
  "occ=$($parsed.Count) uniqLines=$(($parsed|%{"$($_.Path):$($_.Line)"}|Sort-Object -Unique).Count) files=$(($parsed|%{$_.Path}|Sort-Object -Unique).Count) names=$(($parsed|%{$_.Match}|Sort-Object -Unique).Count)"
}
Measure-Scope 'c7c4c725' @('packages','apps'); Measure-Scope '639ed0153' @('packages','apps')
Measure-Scope '639ed0153' @('packages');          Measure-Scope '639ed0153' @('apps')
Measure-Scope '639ed0153' @(':(glob)packages/**/src/**')
```

**Вывод A:**

```
rev=c7c4c725 pathspec='packages,apps' occurrences=32 uniqueLines=31 files=13 names=3
rev=639ed0153 pathspec='packages,apps' occurrences=32 uniqueLines=31 files=13 names=3
  names: data-dsh-automatic-focus, data-dsh-boot, data-dsh-boot-spinner
rev=639ed0153 pathspec='packages'      occurrences=23 uniqueLines=22 files=11 names=3
rev=639ed0153 pathspec='apps'          occurrences=9  uniqueLines=9  files=2  names=1
rev=639ed0153 pathspec=':(glob)packages/**/src/**' occurrences=7 uniqueLines=7 files=3 names=2
```

**Разбивка по файлам (639ed0153, `packages`+`apps`):**

```
  5  apps/web/tests/shortcuts-desktop.e2e.ts
  4  apps/web/tests/shortcuts.e2e.ts
  3  packages/client/ui-primitives/src/focus.ts            (:7,15,24 automatic-focus)
  2  packages/client/ui-primitives/tests/atoms.client.spec.tsx
  1  packages/client/ui-renderer/README.md
  1  packages/client/ui-renderer/README.zh.md
  2  packages/client/ui-renderer/src/client/index.ts       (:66,73 boot)
  2  packages/client/ui-renderer/tests/ui-renderer.client.spec.tsx
  1  packages/client/ui-theme/README.md
  1  packages/client/ui-theme/README.zh.md
  2  packages/client/ui-theme/src/styles/base.css          (:29,30 automatic-focus)
  3  packages/client/web/tests/boot-page.client.spec.ts
  5  packages/client/web/tests/boot.client.spec.ts
README occurrences=4 files=4 → nonREADME: 28 вхождений / 27 уникальных строк / 9 файлов / 3 имени
Имена в фильтре 28: automatic-focus ×16, boot ×6, boot-spinner ×6
```

**Команда B (дословная команда шага `B-27`, ripgrep 15.2.0, из корня чекаута):**

```
rg -o --no-filename -g "*.ts" -g "*.tsx" -g "*.css" -g "!**/lib/**" -g "!**/dist/**" "data-dsh-[a-zA-Z-]+" packages apps
→ occurrences=28 distinctNames=3
та же команда + -g "**/src/**", корень packages → occurrences=19 distinctNames=3
rg -l (первая команда) → 9 файлов
rg -o --no-filename "data-dsh-[a-zA-Z-]+" -g "packages/**/src/**" packages
→ occurrences=7 distinctNames=2 ; файлы: ui-renderer/src/client/index.ts | ui-theme/src/styles/base.css | ui-primitives/src/focus.ts
```

**Сверка чисел:** 32 − 4 (README) = **28**; 13 − 4 = **9**; уникальных строк 31 → 27; имён 3 и там, и там.
Третий литерал `data-dsh-boot-spinner` в `src` не встречается вовсе — продюсер пишет `dataset.dshBootSpinner` (`git show 639ed0153:packages/client/web/src/boot-page.ts` `:35` `this.root.dataset.dshBoot = ''`, `:39` `this.spinner.dataset.dshBootSpinner = ''`); в `src`-скане имён **2**.

**Что говорит шаг** (`22-STEPS-surface.md:988`, B-27, mtime 11:38:22): «28 вхождений / 9 файлов / 3 различных имени; та же команда с `-g "**/src/**"` только по `packages` → 19 вхождений / 7 файлов; прежние числа плана — 32/13/3 и 7/3».
**Семантика `-g` в ripgrep — объединение (OR), а не сужение:** добавление `-g "**/src/**"` к трём расширениям даёт все `*.ts|*.tsx|*.css` под `packages` (19/7), а не только `src`. Настоящий src-only — **7 вхождений / 3 файла / 2 имени** (команда A, `:(glob)packages/**/src/**`).

## 3. D13 — стабильные контракты (поимённо)

**Команда:** `git -C $ck diff --numstat c7c4c725 639ed0153 -- <file>` (пусто = байт-в-байт) + чтение строк на `639ed0153`.

```
SAME     packages/client/web/src/platform.ts
SAME     packages/client/tsdown.client.ts
SAME     packages/util/package-manifest/src/types.ts
SAME     packages/client/ui-renderer/src/client/registry.ts
SAME     packages/host/webserver/src/index.ts
SAME     packages/client/modules/src/index.ts
SAME     packages/client/ui-layout/src/client/index.ts
CHANGED  packages/client/ui-sidebar/src/client/index.ts      5   1
CHANGED  packages/bundle/web-app/cordis.patch.yml           22  19
CHANGED  packages/extensions/tool-cordis/src/api-catalog.ts 122  6
CHANGED  packages/api/remotes/src/client/index.ts            7   2
```

Содержимое на `639ed0153`:

| Контракт | Якорь | Наблюдение |
|---|---|---|
| `PLATFORM_MODULES` | `client/web/src/platform.ts:8-14` | 9 имён: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `…dsh-client-store`, `…ui-slots`, `…ui-primitives`, `…ui-dockkit` |
| `PRELOADED_CLIENT_EXTERNALS` | `:16-18` | объявлен, массив пуст (`[` `] as const`) |
| точное сопоставление externals | `client/tsdown.client.ts:392-405` | `requestedExternals`: докблок «Matching is exact, never normalized» (`:393-395`) |
| сборка externals | `:408-425` | `clientExternals(id)` = `PLATFORM_MODULES` + `PRELOADED_CLIENT_EXTERNALS` + `requestedExternals(id, …dsh?.client ?? {})` |
| `dsh.client` — 4 поля | `util/package-manifest/src/types.ts:81-94` | `platform`, `inject?`, `immediately?`, `external?` |
| `slots.inject` | `client/ui-renderer/src/client/registry.ts:194-209` | докблок «Install an effect for each declaration lifetime of a slot…» + `inject(key, callback): () => void` (`:209`) |
| слот `main` | `client/ui-layout/src/client/index.ts:73` | `'main': { kind: 'keyed'; scope: 'root' }`; `:160` `retainMainPanels`, `:168` `entries('main').some(e => e.options.key === id)` |
| слот `sidebar.panellist` | `client/ui-plugin-manager/src/client/index.ts:139-140`, `client/ui-schedule/src/client/index.ts:178-179` | `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', …}))`; фикстуры — `{ kind: 'list', scope: 'root' }` |
| `ctx.webServer.register` | `host/webserver/src/index.ts:166-173` | дубликат `(kind,path)` бросает, возвращает disposer |
| `ctx.webServer.registerUpgrade` | `:181-187` | дубликат пути бросает, disposer |
| префикс-маршрут | `client/modules/src/index.ts:225` `PLUGIN_ROUTE='/plugins'`; `:649` `webServer.register({kind:'prefix', path: PLUGIN_ROUTE, handler: this.serveBundle})` | маршрут ставится через `ctx.inject(['webServer'], …)` (`:647-653`) |

## 4. §8 п.4 — семантика id маршрута (статика + живая проба)

**Статика.** `WebBootEntry.id` — «Entry name == package name» (`client/modules/src/client/manifest.ts:52-54`); запись создаётся как `graphRow(packageName, rev, source.meta)` (`client/modules/src/index.ts:1041`); сервис — `super(ctx, 'clientModules')` (`:620`), объявление в `Context` — `:47`; HMR-половина читает `ctx.clientModules.graph()` (`packages/client/hmr/src/index.ts:162,176`).
Формы URL (`client/modules/src/index.ts`): комбо-ссылка записи — `comboSearch` `:228-230` (`??<id>/client.js&rev=<rev>`), `comboUrl` `:234-235`, `comboReference` `:244-245`, `graphRow.url` `:483`; package-local чанк — `chunkUrl` `:249-250` (`/plugins/<id>/<file>?rev=<rev>`) при `CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` (`:192`) и точном сравнении `resourceUrl` (`:1094`); неизвестное под `/plugins` → `{status: 404}` (`:1146-1148`).

**Проба регулярки:** `node -e 'const re=/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/; …'` →

```
client.js -> false      client.abc.js -> true      client.378e21a2.js -> true
client.js.map -> false  client.map.js -> true
```

**Живые пробы (`Invoke-WebRequest -SkipHttpErrorCheck` / `curl.exe` / сырой сокет; без куки и без токена):**

| Запрос | Код | Наблюдение |
|---|---|---|
| `GET /` | **401** | `content-type: text/plain`, тело 68 байт: `dsh web authentication required; reopen the URL printed by dsh web.` |
| `GET /plugins/events` | **200** (SSE, соединение держится) | `content-type: text/event-stream`; первая строка `: connected`, затем `data: {"type":"graph","graph":{…}}` — полный граф: `rev=d22ca66e793e`, **80 записей**, 3 батча |
| `GET /plugins/??misakanet/client.js&rev=e9c2ad88a0f8` | **200** | `text/javascript; charset=utf-8`, 50 552 байта, в теле `id: "misakanet"` |
| `GET /plugins/??@linxin666/dsh-web-all/client.js&rev=8b8eefce74df` | **200** | 2 470 176 байт, начало `__ModuleLoader__.load({\n\tid: "@linxin666/dsh-web-all",` |
| `GET /plugins/??@deepseek-ai/dsh-client-ui-chat/client.js&rev=2556b5597b34` | **200** | 565 249 байт, `id: "@deepseek-ai/dsh-client-ui-chat"` |
| `GET /plugins/<id>/client.js?rev=<точный rev>` (ui-chat, misakanet, web-all) | **404** | 0 байт, без `content-type` |
| `GET /plugins/<id>/client.js` (без `rev`) | **404** | контроль |
| `GET /plugins/<id>/client.js?rev=000000000000` | **404** | контроль «неверный rev» |
| `GET /plugins/@deepseek-ai/dsh-client-ui-nonexistent/client.js?rev=…` | **404** | контроль «неизвестный id» |
| `POST /plugins/events`, `POST /plugins/<id>/client.js?rev=…` | **405** | именованный маршрут стоит до method-gate carrier'а |
| `GET /zzz-nonsense-route` | **404** | заголовки те же, что у 404 под `/plugins` — по заголовкам «404 маршрута» и «404 фолбэка» неразличимы |

**Rev вычислим локально.** `artifactRevision(baseline) = framedHash('plugin-artifact', [String(mtimeMs), String(ctimeMs), String(size)])` (`:208-222`), baseline — `statSync` (`:939-947`). Локальный расчёт по `packages/client/ui-chat/lib/client.js` дал `2556b5597b34` — **совпал** с rev живой записи ui-chat; по `…\@linxin666\dsh-client-ui-task-board\lib\client.js` — `378e21a28487` (в живом графе этой записи нет, см. §5).

**401-гейт.** `packages/client/connection/src/browser-auth.ts`: `authorizeIndex` (`:238-275`) — единственное место, где выдаётся 401 (`writeUnauthorized` `:302-310`); токен запуска — `processLaunchToken` = `randomBytes(32)` в `WeakMap` процесса (`:20,52-58`), на диск не пишется; долговечен только секрет подписи cookie (`initializeSecret` `:161-178`, ключ `credentialKey('client-connection','browser-session')` `:12`), сам cookie — HMAC (`:129-159`) с именем `dsh-auth-<sha256(authority) b64url>` (`:106-108`). Ни один файл профиля токена запуска не содержит (поиск `token=` по `~\.dsh`, файлы, изменённые 03.10: только README/`lib` lanmode, `skills/**`).

## 5. Якоря и доска 0.4.4 (локальный референс)

- `packages/client/ui-sidebar/src/client/index.ts:53` `return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }`, `:54` `.sort((a, b) => a.order - b.order)` — файл менялся (+5/−1), сдвиг `:52-53 → :53-54` реален; `22-STEPS-surface.md:971` уже цитирует `:53-54`.
- `packages/bundle/web-app/cordis.patch.yml:88-89` — `- id: ui-open-in-app` / `name: '@deepseek-ai/dsh-client-ui-open-in-app'` (файл менялся +22/−19).
- `packages/extensions/tool-cordis/src/api-catalog.ts:1756` — `signature: 'emit(record: ProductTelemetryRecord): void'` внутри записи `key: 'productTelemetry'` (`:1751`) (файл менялся +122/−6).
- Доска 0.4.4 (`C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\package.json`): `version 0.4.4`; `dsh.client = {inject: [8 имён пакетов], platform: 'web'}`; `dsh.engines.dsh = ">=0.2.0-rc.1"`; `peerDependencies = {@deepseek-ai/dsh: ">=0.2.0-rc.1", react: "^18.2.0"}`; `exports['./client'] = ./lib/client.js`; субпуть `./invariant` ещё есть.
- Клиентская поверхность доски (`src/client/native-panel.tsx`): `:32 PANEL_ORDER = 20`; `:106-113 slots.inject('sidebar.panellist', () => slots.register({name:'sidebar.panellist', id: TASK_BOARD_PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label')}, TaskBoardPanelIcon))`; `:115-119 slots.inject('main', () => slots.register({name:'main', key: TASK_BOARD_PANEL_ID, inject: () => ({controller})}, TaskBoardPanel as never))`; `:121-123` снятие через `disposers.splice(0)`; `:77 <div className={css.panel} data-dsh-taskboard-view="" data-dsh-plugin="task-board">`; `:39,:49 data-dsh-panel-entry`; `src/client/index.ts:127 export const inject = ['slots','sessions','workspaces','connection','configForms','locale','remote','remote.session','uiWorkspace','layout']` (10 имён, строка совпадает с цитатой 0.4.3).
- `teamRun` / `maxSubtaskDepth` — хост-половина доски: `src/core/host-ledger.ts:352,423,428-430,458,467,514,532,718,776,814,830`.
- Живой граф: записи `@linxin666/dsh-client-ui-task-board` **нет**; агрегат `@linxin666/dsh-web-all` (`package.json`: `0.4.4`, `dsh.client = {inject: [], platform: 'web'}`, субпуть `./task-board`) отдаётся одним чанком 2 470 176 байт, в котором есть `sidebar.panellist` ×6, `"main"` ×7, `task_board_` ×21, `data-dsh-taskboard-view` ×4.

## 6. Прогоны тестов MyWork (2026-10-03)

```
node --test --test-isolation=none tests/board.test.mjs      → tests 24 / pass 24 / fail 0   EXIT=0
node --test --test-isolation=none tests/boundaries.test.mjs → tests 31 / pass 31 / fail 0   EXIT=0
объявлений test( : boundaries 31 (было 26 на 0c657ae1), board 28 (28 на 0c657ae1; раннер считает 24)
```

`git log --oneline -- tests/boundaries.test.mjs` → `16dbee4`, `115ea71`, `5d7b80d`, `bf49cbd`, `3ad7aea`, `64d89fa` — рост числа тестов дал репозиторий MyWork (HEAD `4421c13`), не платформа.

## 7. Артефакты в `.tmp` (не входят в поставку)

`H:\Repo\DSH-MyWork\.tmp\surface-02\`: `plugins-events.txt` (сырой SSE-кадр, 33 119 байт), `graph.json` (разобранный граф, 37 833 байта), `body-misakanet.js`, `body-weball.js`, `body-uichat.js` (тела 200-ответов).
