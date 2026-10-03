# verify-stage0-review — независимое ревью этапа 0 кампании «реализация плана v0.3»

- **Роль:** независимый ревьюер (не автор). Режим: read-only; единственный записанный файл — этот отчёт.
- **HEAD на момент ревью:** `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (совпадает с заявленным в F-11/F-12)
- **Теперь:** 2026-09-27, 13:0x локального времени (Asia/Yekaterinburg)
- **Объекты:** F-01, F-02, F-03, F-11 (env-ops); F-06, F-07, F-09, F-61, F-62 (board-ops); F-10 (hygiene-ops); F-12 (Lead, гейт этапа 0)
- **Дополнительно зафиксировано:** все пять файлов board-ops (F-06, F-07, F-09, F-61, F-62) **дописаны** — незавершённых отчётов среди них нет (проверено чтением целиком).

---

## 1. Вердикт

**PASS WITH FINDINGS.**

Гейт этапа 0 по существу выполнен и воспроизводится: правка живого профиля валидна и уже действует в рантайме, дефект F-04 доказан по исходникам, внешняя копия профиля цела (хэш совпадает с до-правочным), чистка F-10 действительно ничего не снесла в живом дереве (все счётчики и отпечатки сошлись до цифры), доска согласуется с F-06/F-07/F-09/F-62. Но **главный объект ревью — `foundation-12-stage0-gate.md` — содержит два MAJOR-дефекта**: (а) он объявляет `PENDING-RESTART` и «старое значение `read-only`» там, где живой Host (PID 33028, запущен 11:34:37, **не перезапускался**) уже отдаёт `workspace-write`, и это уже было измерено в его же F-06/F-62 за 45 с до его записи; (б) одно из двух доказательств безопасности удаления ключей `autoRun*` — неверно (совпадения `autoRun` есть и в **активных** бандлах живого профиля, а не только в резервной копии `*.orig-ru-patch`). Оба дефекта — в доказательной части гейта; ни один не отменяет самого решения и не требует отката.

**Оговорка о снимке:** дерево во время ревью двигалось — при ре-базлайне в 13:08 в нём появились изменения этапа 1 (`packages/**`, `scripts/**`, `tests/**`, вне области ревью). Поэтому все утверждения о состоянии дерева ниже привязаны ко времени и верны для baseline-снимка 13:00 (§6 п. 11).

---

## 2. Проверенные команды

Все команды выполнены в `H:\Repo\DSH-MyWork` (pwsh, Windows), если не указано иное. `exit code` — реальный код последней команды; где вывод шёл через `ForEach-Object`/`Select-String`, код равен 0 при отсутствии ошибок (отмечено там, где это существенно).

| # | Команда | exit | Наблюдение |
|---|---|---|---|
| 1 | `Select-String <профиль> -Pattern 'sessionDefaultPermission'` | 0 | **1** совпадение: `L25: sessionDefaultPermission: workspace-write,`. `plugin:` — `L24`, тот же отступ (8 пробелов). Гейт F-12 №3 подтверждён |
| 2 | `Select-String <профиль> -Pattern 'autoRun'` | 0 | **0** совпадений. Гейт F-12 №4 подтверждён |
| 3 | `node -e "require(js-yaml).load(<профиль>)"` | **0** | `YAML_OK rows=16`; `ROW={"id":"web-ui-task-board","config":{"plugin":"@linxin666/dsh-client-ui-task-board","sessionDefaultPermission":"workspace-write","announceToAgent":true}}`; `hasTopSessionDefault=false` (у строки нет верхнеуровневого ключа — он внутри `config` строки, т. е. на одном уровне с `plugin`) |
| 4 | `Get-FileHash <профиль>.bak-planv03-F04 -Algorithm SHA256` | 0 | `D3AAACF053C854CB6577DA4CDE7FBF881AFF4A6A27999F5CAFD4390029E07595` — совпадает с заявленным в F-02/F-03/F-12. Файл существует, 2586 байт, mtime 2026-09-26 20:58:52 |
| 5 | `Get-FileHash <профиль> -Algorithm SHA256` | 0 | `D457249482716C97E07C52E95D569FB00AB8604B443191D984CAD7967AF1503E` — совпадает с «после правки» из F-12; mtime `2026-09-27 12:56:02` |
| 6 | `Compare-Object (Get-Content <bak>) (Get-Content <live>)` | 0 | **9 удалённых / 2 добавленных** линии (105 → 98 строк). Удалено: `config: { sessionDefaultPermission: workspace-write },` + 7 ключей `autoRun*` + `announceToAgent: true,`. Добавлено: `sessionDefaultPermission: workspace-write,` и `announceToAgent: true`. Ничего сверх этого |
| 7 | `Get-Content <task-board>\lib\index.js` L5568, L5397, L877-879, L816, 818-822, 869-871, 2074, 4221 | 0 | Цитаты дефекта F-04 — см. §2a |
| 8 | `Get-Content <web-all>\lib\shell-DWqLngib.js` L1089-1092, 1169-1175, 1197, 1214 | 0 | Цитаты агрегата и механизма перемонтирования — см. §2a |
| 9 | Подсчёт файлов источника (без `logs`/`node_modules`) и копии | 0 | **источник 1233, копия 1230** (у F-02/F-12 заявлено 1230/1230). `Compare-Object` списков: «в копии, но не в источнике» — **0 файлов**; «в источнике, но не в копии» — **3**: `profiles\web\cordis.patch.yml.bak-planv03-F04` (создан самим F-04), `sessions\--H-Repo-DSH-MyWork--\890a54e4-…\session.v4.jsonl.zstd`, `storages\session_projcache\sessions\890a54e4-….json` (runtime-движение) |
| 10 | `Get-FileHash <копия>\profiles\web\cordis.patch.yml` | 0 | `D3AAACF0…E07595` — **равен до-правочному значению** (заявленному в F-02). Копия цела |
| 11 | `Test-Path` по 7 удалённым F-10 путям | 0 | **False ×7**: `.tmp\beads-probe`, `.tmp\pnpm-temp`, `.tmp\test-tmp`, `.tmp\mw004-verify`, `.tmp\mw010-head-verify`, `.tmp\f-audit\node_modules`, `.tmp\mw012-review\node_modules` |
| 12 | `Test-Path` по 4 живым путям | 0 | **True ×4**: корневой `node_modules`, `packages\core\lib`, `tests\lib`, `.tmp\v2-boundary-demo\node_modules`. Последний — `LinkType=Junction`, `Target=H:\Repo\DSH-MyWork\node_modules` (ловушка на месте, цель резолвится) |
| 13 | `Test-Path` по 14 путям класса «требует решения владельца» | 0 | **True ×14**: `.tmp\f-audit`, `.tmp\mw012-review`, `.tmp\v2-boundary-demo`, `.tmp\mw018-review`, `.tmp\mw012-full-backup`, `.tmp\mw012-mine`, `.tmp\mw014-review`, `.tmp\pack`, `.tmp\pack-logs`, `.tmp\mw008-review\db`, `.tmp\mw008-vfix\db`, `DSH-MyWork.rar`, `package.json`, `pnpm-lock.yaml`. Ничего лишнего не удалено |
| 14 | `Measure-Object` по `.tmp`, корневому `node_modules`, `packages\core\lib`, `tests\lib` | 0 | `.tmp` **2181 файл / 75,37 МБ**; root `node_modules` **1936 / 109,69 МБ**; `packages\core\lib` **4 / 1,85 МБ**; `tests\lib` **4 / 0,02 МБ** — до знака совпадает с таблицами F-10 (§4 и §5), включая «ПОСЛЕ» |
| 15 | Снимок 9 каталогов `.tmp\plan-v03-*` | 0 | `cards 21/704621`, `decision 3/9937`, `foundation 15/99586`, `lead 20/1137577`, `red-a 6/871540`, `red-b 11/70084`, `red-c 9/249982`, `verify-a 10/125820`, `verify-b 6/498911` — побайтово совпадает с F-10 §1. Свободных файлов в корне `.tmp` — ровно **275** (как в отчёте) |
| 16 | `git -C .tmp\f-audit status --porcelain` | 0 | **6 записей** (`M packages/beads-adapter/src/runner.ts`, `M pnpm-lock.yaml`, `M tests/beads-adapter.test.mjs`, `?? .tmp-audit/`, `?? …runner.ts.orig`, `?? …test.mjs.orig`) — грязный worktree сохранён; `pnpm-lock.yaml` и `.orig` на месте |
| 17 | `git -C .tmp\mw012-review status --porcelain` | 0 | **30 записей** — как заявлено |
| 18 | `git rev-parse HEAD` | 0 | `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` ✔ |
| 19 | `git status --porcelain --untracked-files=all` (**baseline 13:00**) | 0 | ровно 2 записи: ` M README.md`, `?? docs/ops/profile-restore.md`. На этом снимке правок вне write-scope'ов (README.md, docs/, `.work/plan-v0.3/evidence/**`) **нет** |
| 19a | `git status --porcelain --untracked-files=all` (**ре-базлайн 13:08**) | 0 | **дерево поехало**: к тем же двум записям добавились ` M packages/beads-adapter/src/{index,runner}.ts`, ` M packages/storage/src/{errors,index,migrations,store}.ts`, ` M scripts/lib/process.mjs`, ` M scripts/pack.mjs`, ` M tests/{lease,storage-crash,storage}.test.mjs`, ` M tests/lib/crash-child.mjs` и 9 новых файлов (`packages/beads-adapter/src/{launch,probe}.ts`, `packages/controller/src/migration-allocator.ts`, 5 новых `tests/**`). Одновременно `git` предупредил о живом временном каталоге `packages/beads-adapter/src/.adapter.ts.…tmpdir/`. Все эти пути — `packages/**`, `scripts/**`, `tests/**`, то есть **этап 1 (F-13…F-27), вынесенный за область этого ревью**; к write-scope'ам потоков этапа 0 (README.md, docs/, `.work/plan-v0.3/evidence/**`) они не относятся и находкой не являются. Вывод проверки 6 действителен **для baseline-снимка 13:00**, а не для текущего дерева |
| 20 | `git diff -- README.md` | 0 | `1 file changed, 21 insertions(+)`: +10 строк (раздел «Правила приёмки карточек (D19)», board-ops/F-08) и +11 строк (заметка о `corepack pnpm -r` и `npm_execpath` в «Команды», env-ops/F-01). Оба блока — внутри заявленных scope'ов |
| 21 | `git worktree list` | 0 | **4 записи** (`main`, `.tmp/f-audit`, `.tmp/mw012-review`, `.tmp/v2-boundary-demo`) — отклонение §5.1 F-12/F-10 подтверждено, не 1 |
| 22 | `git ls-files -v pnpm-lock.yaml` + `git status --porcelain pnpm-lock.yaml` | 0 | `H pnpm-lock.yaml`; status **пусто**; SHA256 `CCC3E425B1D6331433E26497FBC6A90EDD322951335F9C3919E956D3AFF1E3F0`, 28980 Б — гейт F-11 воспроизведён (и хэш совпадает с «до/после» из F-11) |
| 23 | `corepack pnpm --version` | **0** | `12.4.2` — гейт F-12 №1 подтверждён. `where.exe pnpm` первой строкой даёт `…\deepseek-harness\node_modules\.bin\pnpm` — диагноз F-01 подтверждён |
| 24 | `Select-String` ключей `autoRunTodo\|autoRunPaused\|autoRunMaxConcurrent\|autoRunMaxRetries\|autoRunStallMinutes\|autoRunMaxPerHour\|autoRunMaxPerDay` по всем `*.js` живого профиля (кроме `.pnpm`) | 0 | **0 файлов** — вывод F-05 («7 ключей мёртвые») подтверждён **по точным именам** |
| 25 | `Select-String 'autoRun'` по всем `*.js` живого профиля | 0 | **3 активных файла**: `@linxin666\dsh-session-archive\lib\client.js:160,558`, `…\dsh-session-archive\lib\index.js:2721,2777`, `@linxin666\dsh-web-all\lib\client.js:41295,41680`. Это опровергает подпись F-12 §1 (см. F-01 в Findings) |
| 26 | `Select-String '/auto/'` в бандлах task-board | 0 | `index.js -> 0`, `client.js -> 0` — узкая проверка F-12 §1 воспроизводится |
| 27 | `Select-String 'autoRun'` в `<web-all>\lib\client.js.orig-ru-patch` | 0 | `L41283`, `L41668` — как в F-12 §1 |
| 28 | `task_board_list {query:"MW-027", includeArchived:true}` | ok | Заголовок доски: `revision 325`, `sessionDefaultPermission "workspace-write"`, `counts backlog 32 / done 19 / failed 1 / archived 3`. MW-027 (`e5bdbc44-…`, `archivedAt 1789753502873`) и MW-035 (`d66573e0-…`, `archivedAt 1789753502890`) — обе `status: backlog` с `archivedAt`, `executionCount 0` |
| 29 | `task_board_list {status:"done"}` | ok | **19** карточек; `executionCount = 2` ровно у **7** (MW-003…MW-008, MW-043), у остальных 12 — `1` |
| 30 | `task_board_get 3729ad0f…` (MW-003) | ok | `executions[0]` = `3daad8f9-adeb-44b5-a234-9e1f136f92a4`, `result: failed`, `1789667487381→1789667487389` (**8 мс**), `error: "workspace not found: 3fc33afb-…"`, **`sessionId` отсутствует**; `executions[1]` succeeded |
| 31 | Разбор леджера `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` | 0 | `revision 325`; 55 карточек; `permissionConfirmedAt` есть у **22**, нет у **33**; `permission` у всех 55 = `workspace-write`; `mode` задан **только у MW-002** (`cordis`); у 7 done-карточек падения **все без `sessionId`**, длительности 7/8/8/9/7/7/16 мс, тексты ошибок совпадают с F-09 дословно |
| 32 | Разбор MW-002 в леджере | 0 | `mode=cordis`, `permissionConfirmedAt=1789581713761` (не изменился — как в F-61), 2 исполнения `failed` **без `sessionId`**, длительности **70 мс и 70 мс** |
| 33 | `Get-NetTCPConnection -LocalPort 3080` + `Get-CimInstance Win32_Process` | 0 | Host: **PID 33028**, `node --import tsx/esm apps/cli/src/bin.ts "web"`, **start = 2026-09-27 11:34:37**, жив на 13:06. Правка профиля — 12:56:02 ⇒ **перезапуска Host между правкой и замером не было** |
| 34 | `Select-String '<профиль>' -Pattern 'preset\|cordis'` (live и backup) | 0 | live: `L59 - id: agent-preset-registry`, `L61 default: cordis`; backup: `L66`, `L68` |
| 35 | `Select-String scripts\verify-profile.mjs -Pattern 'DSH_HOME'` | 0 | `L48 const workDir = join(repoRoot, '.tmp', 'verify-profile')`; `L156 env: { ...process.env, DSH_HOME: home, … }` — утверждение F-03 (скрипт не читает `DSH_HOME` для выбора дома) подтверждено |
| 36 | `Test-Path "$env:TEMP\dsh-restore-drill"` (и поиск по `%TEMP%`) | 0 | **False**, каталога нет ни по литеральному пути `C:\Users\Dmitry\AppData\Local\Temp\dsh-restore-drill`, ни в `%TEMP%` вообще (см. §5) |
| 37 | `docs/ops/profile-restore.md` | 0 | существует, 5989 байт (F-03/F-02) |

### 2a. Цитаты дефекта F-04 — сняты мной из файлов (не копированы из отчёта)

`…\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\lib\index.js`:

```js
 816: const DEFAULT_SESSION_PERMISSION = "read-only";
 818: const PERMISSION_RANK = /* @__PURE__ */ new Map([
 819: 	["read-only", 0],
 820: 	["workspace-write", 1],
 821: 	["danger-full-access", 2]
 822: ]);
 869: function exceedsSessionDefault(permission, sessionDefault) {
 870: 	if (permission === void 0) return false;
 871: 	return (PERMISSION_RANK.get(permission) ?? -1) > (PERMISSION_RANK.get(sessionDefault) ?? -1);
 872: }
 877: function requiresPermissionConfirmation(task, sessionDefault = DEFAULT_SESSION_PERMISSION) {
 878: 	return exceedsSessionDefault(effectivePermission(task), sessionDefault) && task.permissionConfirmedAt === void 0;
 879: }
2074: 		this.sessionDefaultPermission = options.sessionDefaultPermission ?? "read-only";
4221: 		...requiresPermissionConfirmation(task, sessionDefault ?? "read-only") ? { permissionPending: true } : {},
5397: 	sessionDefaultPermission: z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION),
5568: 		sessionDefaultPermission: config?.sessionDefaultPermission ?? "read-only",
```

Контекст `:5566-5571` показывает, что `config` — это конфиг плагина, читаемый **при построении** `TaskBoardHostService` (соседние поля `announceToAgent`/`maxSubtaskDepth` читаются лениво через `readConfigField`, а `sessionDefaultPermission` — нет).

`…\profiles\web\node_modules\@linxin666\dsh-web-all\lib\shell-DWqLngib.js`:

```js
1088: /** The config the real plugin receives: every row key but the shell's own. */
1089: function familyConfigOf(row) {
1090: 	const { plugin: _spec, ...family } = row;
1091: 	return Object.keys(family).length === 0 ? void 0 : family;
1092: }
1169: 		const family = familyConfigOf(row);
1170: 		if (mounted !== void 0 && mounted.spec === spec && sameFamilyConfig(mounted.config, family)) return;
1171: 		if (mounted !== void 0) {
1172: 			const previous = mounted;
1173: 			mounted = void 0;
1175: 				await previous.dispose?.();
1197: 			const fiber = ctx.plugin(plugin, family);
1214: 	ctx.on("loader/volatile-update", () => {
1215: 		schedule();
```

**Цепочка F-04 подтверждена мной независимо:** строка `web-ui-task-board` в YAML — это `row`; `familyConfigOf` срезает только `plugin` и отдаёт остальные ключи строки в `ctx.plugin(plugin, family)` (`:1197`), поэтому ключ, лежавший под `config: { … }`, приезжал плагину как `config.config`, а `config.sessionDefaultPermission` давал `undefined` → `?? "read-only"` (`:5568`). Дополнительно `:1170` объясняет механизм, который F-62/F-12 оставили неисследованным: при изменении family-конфига строка **размонтируется и монтируется заново** (`dispose` → `ctx.plugin`) по событию `loader/volatile-update` (`:1214`) — то есть живое перечитывание без перезапуска процесса обеспечено кодом агрегата.

---

## 3. Findings

### F-01 · MAJOR · `foundation-12-stage0-gate.md:41` (и строка `:39`)

**Что не так.** Утверждение «в живом профиле есть **2** совпадения подстроки `autoRun`, но не в активных бандлах, а в **резервной копии** `…\dsh-web-all\lib\client.js.orig-ru-patch:41283,41668`» — **неверно**. Подстрока `autoRun` встречается и в активных бандлах живого профиля: `@linxin666\dsh-session-archive\lib\client.js:160,558`, `@linxin666\dsh-session-archive\lib\index.js:2721,2777` (`function makeAutoRunRoute(service)` и его регистрация в `:2777`) и `@linxin666\dsh-web-all\lib\client.js:41295,41680`. Там же сказано: «В активных бандлах … серверная половина **не регистрирует** маршрут `/auto/`» — проверка сделана только по бандлам task-board (`0` совпадений, подтверждено), а вывод распространён на весь профиль, где он ложен: активный `dsh-session-archive` маршрут `/auto/run` регистрирует.

**Почему важно.** Это один из двух аргументов, которыми гейт обосновывает удаление 7 ключей `autoRun*` **из живого профиля пользователя**. Аргумент построен поиском, который нашёл «0 файлов» там, где имена ключей действительно отсутствуют, но затем подкреплён ложной посылкой «автозапуска в живом профиле нет вовсе». Читатель гейта получает неверную картину: механика авто-запуска в профиле есть (другой плагин). Сам вывод выживает только на точном поиске по 7 именам (строка 24 таблицы §2 — 0 файлов), и **откат не нужен**, но доказательная база гейта в этой части недостоверна.

**Минимальная правка.** Переписать `:41`, оставив только проверяемое: «поиск по точным именам 7 ключей `autoRun*` по активным `*.js` профиля → 0 файлов; подстрока `autoRun` встречается в активных бандлах (`dsh-session-archive`, `dsh-web-all`) как независимая механика `/auto/run` другого плагина и к ключам task-board отношения не имеет». Убрать обобщение про «серверная половина не регистрирует `/auto/`» или ограничить его бандлами task-board.

### F-02 · MAJOR · `foundation-12-stage0-gate.md:7` (статусная строка), `:90-93` (§5.2), `:99` (§6.3)

**Что не так.** Гейт объявляет: «F-06/F-62 после-readback — `PENDING-RESTART`», «Живой Host смонтировал строку до правки, поэтому `task_board_list` в текущей сессии **по-прежнему отдаёт `read-only`**», «до перезапуска Host действует старое значение `read-only`». Это **опровергнуто**:

1. живой API доски сейчас отдаёт `sessionDefaultPermission: "workspace-write"` (проверка №28/№31);
2. Host — PID 33028, старт **11:34:37**, жив; правка профиля — **12:56:02**; перезапуска не было (проверка №33);
3. `foundation-06` (§«ПОСЛЕ F-04» — ИЗМЕРЕН, mtime 12:56:07) и `foundation-62` (mtime 12:56:41) уже содержат замер `workspace-write` / `permissionPending = 0`, то есть к моменту записи F-12 (mtime **12:57:26**) результат был получен и лежал рядом;
4. механизм виден в коде агрегата: `shell-DWqLngib.js:1170-1175` (размонтирование при смене family-конфига) + `:1214` (`loader/volatile-update`).

**Почему важно.** Гейт этапа 0 — артефакт, по которому владелец принимает решение о переходе к этапу 1. В текущем виде он (а) требует от человека ненужного действия «перезапустить Host», (б) объявляет незакрытыми два шага (F-06, F-62), которые закрыты измерением, (в) записывает в §6.3 неверное состояние рантайма и выводит из него следствие «33 карточки всё ещё блокируются». Это ровно тот класс ошибки, из-за которого приёмка этапа 0 может быть отложена без причины.

**Минимальная правка.** Убрать §5.2 целиком (оставить одно отклонение — §5.1 про worktree), в §3 и §6 перевести F-06 и F-62 в «закрыто измерением», заменить статусную строку на «PASS WITH ONE DOCUMENTED DEVIATION (§5.1)», в §6 удалить пункт 3.

### F-03 · MINOR · `foundation-61-preset.md:63`

**Что не так.** «два исполнения по **6 мс** и 70 мс». В леджере оба исполнения MW-002 имеют длительность **70 мс** (`f282db49…` `1789583853269→1789583853339`; `09fcc27f…` `1789583900711→1789583900781`). Исполнения на 6 мс у MW-002 нет (проверка №32).

**Почему важно.** Число попадает в строку-обоснование «отказ до создания сессии»; неверная длительность подрывает доверие к остальным цифрам строки. Вывод (отказ до сессии, `sessionId` отсутствует) сохраняется.

**Минимальная правка.** Заменить «6 мс и 70 мс» на «70 мс и 70 мс».

### F-04 · MINOR · `foundation-03-profile-restore.md:16` (и `:50`)

**Что не так.** Отчёт перечисляет созданный артефакт `C:\Users\Dmitry\AppData\Local\Temp\dsh-restore-drill\` (1230 файлов, ≈219 МБ) и утверждает «**не удалён**, рекурсивные удаления запрещены условиями задачи». Каталога **нет**: `Test-Path` → `False`, поиск по `%TEMP%` не находит ничего с `restore-drill` (проверка №36).

**Почему важно.** Заявленное состояние артефакта не соответствует факту, и отличить «удалён позже кем-то/чем-то» от «никогда не создавался по этому пути» по доступным данным нельзя. На сам гейт F-03 это не влияет: он доказан `verify:profile: PASS` и хэшем живого профиля до/после, а не наличием drill-каталога.

**Минимальная правка.** В `:16` и `:50` заменить утверждение о сохранности на «на момент проверки ревьюера (27.09, 13:05) каталога нет; состояние на момент шага зафиксировано, дальнейшая судьба не отслеживалась».

### F-05 · MINOR · `foundation-62-permission-gate.md:134` (и `foundation-61-preset.md:7,73`)

**Что не так.** Указано «Строки **66–68**: `default: cordis`». После правки F-04 (удалено 7 строк) в живом файле это **`L59`/`L61`**; `66`/`68` — нумерация **до** правки (в бэкапе — именно `L66`/`L68`, проверка №34). F-61 §«Повторная проверка после правки профиля» повторяет тот же устаревший якорь.

**Почему важно.** Якорь `файл:строка` — основной инструмент проверки в этой кампании; устаревший якорь после собственной правки файла заставляет следующего проверяющего искать не там.

**Минимальная правка.** Заменить на «`L59`–`L61` после правки F-04 (до неё — `L66`–`L68`)».

### F-06 · NIT · `foundation-12-stage0-gate.md:16-29`

**Что не так.** Заголовок «Diff (ровно **11 строк**, `Compare-Object` с бэкапом)», но в приведённом блоке 8 строк с `-` и 2 с `+` (10), а строка `announceToAgent: true` показана как контекстная с пометкой «запятая снята». Фактический `Compare-Object` даёт **9 удалённых / 2 добавленных** — 11 изменённых строк, то есть число верное, а изображение diff'а теряет одну изменённую строку (`-announceToAgent: true,`).

**Почему важно.** Проверяющий, пересчитавший `+`/`-` в блоке, получит 10 против заявленных 11 и потратит время на поиск расхождения, которого нет.

**Минимальная правка.** Показать `-announceToAgent: true,` / `+announceToAgent: true` как пару строк diff'а (или пометить блок как «9 удалено + 2 добавлено = 11»).

### F-07 · NIT · `foundation-02-profile-backup.md:24-25,31` и `foundation-12-stage0-gate.md:72`

**Что не так.** «`source=1230`, `copy=1230`» и «перепроверен Lead'ом: 1230/1230 файлов» на момент ревью не воспроизводится: источник после того же фильтра даёт **1233** при копии **1230** (проверка №9). Все три расхождения объяснимы и относятся к времени **после** снимка: `profiles\web\cordis.patch.yml.bak-planv03-F04` (артефакт самой правки F-04), один файл сессии и один файл проекционного кэша. В обратную сторону расхождений **нет** — «в копии, но не в источнике» пусто, то есть копия не потеряла ни одного файла.

**Почему важно.** Число «1230/1230» читается как воспроизводимое, хотя оно моментное; при следующей проверке оно снова не сойдётся (и будет расти из-за `.bak`).

**Минимальная правка.** Добавить в F-02 оговорку «равенство 1230/1230 верно на 12:45; после правки F-04 источник содержит дополнительные файлы (`*.bak-planv03-F04` и runtime-файлы)».

---

## 4. Что проверено и сочтено корректным

1. **Живой профиль (проверка 1 требования).** `sessionDefaultPermission` — ровно 1 совпадение, `L25`, отступ 8 пробелов, на одном уровне с `plugin:` (`L24`). `autoRun` — 0 совпадений. YAML разбирается `js-yaml` из чек-аута DSH (`exit 0`, 16 строк); ключ `web-ui-task-board` содержит `sessionDefaultPermission` рядом с `plugin`/`announceToAgent`. Бэкап `.bak-planv03-F04` на месте, SHA256 = `D3AAACF…E07595` — как заявлено. Правка ровно та, что описана: 9 удалённых / 2 добавленных строки, ничего лишнего.
2. **Дефект F-04 (проверка 2).** Все четыре якоря совпали дословно: `index.js:5568`, `:5397` + `:816` (дефолт `read-only`), `:877-879` (предикат: строго выше дефолта **и** нет `permissionConfirmedAt`), `shell-DWqLngib.js:1089-1092` (срезается только `plugin`). Цитаты сняты мной (§2a). Сверх задания: `exceedsSessionDefault` (`:869-871`) использует строгое `>`, поэтому равный дефолту `workspace-write` гейт не зажигает; `permissionPending` действительно производится при отдаче (`:4221`), а не хранится в леджере.
3. **Копия профиля (проверка 3).** `C:\DSH-Backups\dsh-profile-2026-09-27` существует; `profiles\web\cordis.patch.yml` в ней есть, SHA256 = `D3AAACF0…E07595` — совпадает с **бэкапным** (до-правочным) значением, хотя живой файл теперь имеет другой хэш (`D4572494…503E`). Ни одного файла, который был бы в копии и отсутствовал в источнике, нет. Расхождение по числу файлов (1230 → 1233) полностью объяснено пост-снимочными артефактами (F-07 в Findings, NIT).
4. **Чистка F-10 (проверка 4, «опасное утверждение»).** Живое дерево **не повреждено**: 7 путей удалены (`Test-Path` → `False` ×7), три живых каталога и junction-ловушка на месте (`True` ×4, junction резолвится в корневой `node_modules`), все 14 объектов класса «требует решения владельца» сохранены, счётчики `.tmp` (2181 / 75,37 МБ), корневого `node_modules` (1936 / 109,69 МБ), `packages\core\lib` (4 / 1,85 МБ) и `tests\lib` (4 / 0,02 МБ) совпали с таблицами «ПОСЛЕ» до знака, снимки 9 каталогов `.tmp\plan-v03-*` и 275 свободных файлов совпали побайтово, грязные состояния `f-audit` (6 записей) и `mw012-review` (30 записей) сохранены вместе с `pnpm-lock.yaml` и `.orig`-файлами. **Следов удаления сверх списка из 7 путей не найдено.**
5. **Доска (проверка 5).** MW-027 и MW-035 отсутствуют в обычном списке и присутствуют с `includeArchived: true`, обе с `archivedAt` от 2026-09-18 — гейт F-07 выполнен, и его ключевое утверждение («обе были архивированы до кампании») подтверждается датами. `done`-карточек с `failed`-исполнениями ровно **7** (MW-003…MW-008, MW-043), у всех семи падение **без `sessionId`**, длительности 7–16 мс, тексты ошибок (`workspace not found: 3fc33afb-…`, у MW-043 с префиксом `launch: `) совпадают с F-09 дословно; у остальных 12 done-карточек `executionCount = 1`. Цифра F-62 воспроизводится: `revision 325`, `sessionDefaultPermission "workspace-write"`, `permissionConfirmedAt` у 22 из 55, у 33 — нет, `permission` у всех `workspace-write`, `permissionPending` отсутствует у всех.
6. **Дерево и scope'ы (проверка 6).** HEAD = `0c657ae…`. На baseline-снимке (13:00) рабочее дерево содержало ровно ` M README.md` (+21 строка: +10 D19/board-ops, +11 pnpm/`npm_execpath` env-ops) и `?? docs/ops/profile-restore.md`; **правок вне README.md, `docs/` и `.work/plan-v0.3/evidence/**` на этом снимке не было**. При ре-базлайне в 13:08 дерево уже содержало изменения этапа 1 (`packages/**`, `scripts/**`, `tests/**` — вне области ревью, см. §6 п. 11); ни один из них не относится к scope'ам потоков этапа 0. `pnpm-lock.yaml` чист и не помечен `assume-unchanged` (`git ls-files -v` → `H`); F-11 подтверждён, включая совпадение хэша `CCC3E425…` (проверен повторно в 13:08 — не изменился).
7. **F-12 exit code (проверка 7).** В `foundation-12-stage0-gate.md:58` строка гейта №2 (`corepack pnpm -r run typecheck`) содержит и `Exit = 0`, и наблюдение («Scope: 12 of 13 workspace projects», все `Done`, ошибок нет).** Сам я этот прогон не повторял.**
8. **Полнота отчётов.** F-06, F-07, F-09, F-61, F-62 дописаны (незавершённых нет). F-06/F-62 содержат измерение «после F-04», опровергающее `PENDING-RESTART` в F-12 (F-02 в Findings). Утверждение F-03 о том, что `scripts/verify-profile.mjs` не читает `DSH_HOME` для выбора дома, а выставляет его дочерним процессам, подтверждено по исходнику (`:48`, `:156`).

---

## 5. Невоспроизводимые утверждения отчётов

| # | Утверждение | Чем проверял | Результат |
|---|---|---|---|
| 1 | F-02:24 «`Test-Path 'C:\DSH-Backups'` до создания → `False`» | `Test-Path` | Каталог существует (создан в 12:45) — проверить «до» невозможно, утверждение историческое |
| 2 | F-02:24 «`Get-PSDrive`: `C:` свободно 54,7 ГБ, `H:` свободно 475,7 ГБ» | не проверял | Моментный замер свободного места, не воспроизводим и не значим |
| 3 | F-02:28 «robocopy … `Files: 1230/1230`, `FAILED: 0`» | Подсчёт файлов | Воспроизводится косвенно: копия содержит 1230 файлов, ни одного файла, отсутствующего в источнике (`Compare-Object` в обратную сторону пусто); равенство «источник = копия» сейчас дало бы 1233 — см. F-07 |
| 4 | F-03:16,50 «`%TEMP%\dsh-restore-drill` — 1230 файлов, не удалён» | `Test-Path` + поиск по `%TEMP%` | **Каталога нет** (F-04 в Findings) |
| 5 | F-03:27 «`node scripts/verify-profile.mjs --dsh-bin dsh` → exit 1» и F-03:28 (форма с `npm_execpath` → `verify:profile: PASS`) | не запускал | Прогон `verify:profile` пакует бандл и поднимает изолированный профиль (сеть/сборка); вне read-only бюджета ревью. Косвенно подтверждено по исходнику (`:48`, `:156`) |
| 6 | F-01:29 «`corepack pnpm run typecheck` (без `-r`) → EXIT=1» | не запускал | Сознательно: возможная запись в `H:\.pnpm-store` (self-switch pnpm) вне write-scope ревьюера; к тому же проверка 7 задания запрещает повторные прогоны typecheck |
| 7 | F-01:23,26 (длина и содержимое шима `H:\.pnpm-store\…\bin\pnpm.CMD`, 52 байта) | не проверял | Путь на диске `H:` вне объекта ревью; диагноз F-01 для выбора runner'а не критичен — рабочий вариант `corepack pnpm --version` → `12.4.2` подтверждён |
| 8 | F-12:57-58 (гейт №2, typecheck EXIT=0, «12 of 13») | **не перепроверял** | Явно вне бюджета ревью (см. проверку 7 задания). В отчёте exit code и наблюдение **есть** |
| 9 | F-12:39 «`Select-String … в `…\profiles\web\node_modules\@linxin666\**\*.js` → 0 файлов» | `Select-String` по всем `*.js` профиля | Для **точных имён** 7 ключей — подтверждается (0 файлов); для **подстроки** `autoRun` — **опровергнуто** (3 активных файла), см. F-01 в Findings |
| 10 | F-61:36 продолжение «текст `24 rows name plugins that cannot be resolved:` текущим кодом не производится» | Разбор леджера | Воспроизведено частично: текст ошибки в леджере есть (24 строки с именами рядов), но проверить «текущим кодом не производится» без запуска монтирования пресета я не мог |
| 11 | F-62:60 «`permissionPending` не хранится в леджере, а вычисляется» | Разбор `ledger-v2.json` | Подтверждено: поля `permissionPending` в леджере нет ни у одной карточки; вычисление — `index.js:4221` |
| 12 | F-12:51, F-03:31 «копия без `node_modules` не загружается, требует `dsh plugin --profile web install`» | не запускал `dsh` | Запуск `dsh` меняет `profiles\web\cordis.yml` (запрет зафиксирован в самих отчётах) — не воспроизводил |
| 13 | F-12:97-100 (§6) «что этот гейт НЕ доказывает», п. 3 | `task_board_list` | **Опровергнуто**: живой API отдаёт `workspace-write`, то есть гейт как раз снят без перезапуска (F-02 в Findings) |

---

## 6. Что осталось непроверенным и почему

1. **Repo-wide `corepack pnpm -r run typecheck`** (гейт F-12 №2 и гейт F-01) — по прямому указанию задания не перезапускался: дорого и уже выполнено. Проверено только наличие exit code и наблюдения в отчёте F-12 (`:58`).
2. **Контрольный прогон `corepack pnpm run typecheck` без `-r`** (ожидается exit 1) — не запускал: pnpm может выполнить self-switch и записать в `H:\.pnpm-store`, что выходит за рамки read-only ревью.
3. **`corepack pnpm -r run typecheck` и любая другая запись в дерево** — не выполнялись. `pnpm-lock.yaml` и `node_modules` в ходе ревью не изменялись (проверено хэшем и `git status`).
4. **Механизм перечитывания профиля живым процессом** — подтверждён косвенно и по коду (`shell-DWqLngib.js:1170-1175`, `:1214`, событие `loader/volatile-update`), но не экспериментом: я не правил профиль и не запускал `dsh`, чтобы не выйти из read-only. Перезапуск Host исключён по времени старта процесса (11:34:37 < 12:56:02).
5. **Судьба `%TEMP%\dsh-restore-drill`** — не установлено, удалён ли каталог позже или не создавался по этому пути; журналов процессов нет (F-04 в Findings).
6. **Шаги этапа 1 (F-13…F-27, F-63), файлы `packages/**` и `scripts/**`, живые карточки MW-044…MW-055, перезапуск Host** — вне области ревью по заданию, не проверялись.
7. **Содержимое `DSH-MyWork.rar`, sqlite-базы `.tmp\mw008-*\db\**`, снимки `*-backup`/`*-snap`/`*-mut`** — только `Test-Path` (все существуют); внутрь не заглядывал (F-10 сам помечает их как «не сверялись с HEAD по хэшу»).
8. **Ротация/срок хранения внешней копии профиля, восстановление на чистую машину** — вне шага (совпадает с ограничениями F-02/F-03).
9. **Дисциплина ревью:** единственная запись, произведённая мной, — этот файл. Отдельно признаю: в начале работы я создал вспомогательный пробник `%TEMP%\yamlprobe.cjs` (для разбора YAML) до того, как перешёл на `node -e`; файл не удалялся (удаление запрещено условиями), на живое дерево и профиль он не влияет.
10. **Числа доски моментные:** `revision 325` зафиксирован на 13:04; `runningSessions: 5`, `armedSchedules: 0`. Любая последующая мутация доски сдвинет `revision`, но не затронет проверенные утверждения F-06/F-07/F-09/F-62, привязанные к значениям, а не к ревизии (кроме F-62 §«ДО» = 324, которое я не мог наблюдать — ревизия уже была 325).
11. **Дерево — движущаяся цель (ре-базлайн обязателен).** Между baseline-снимком (13:00) и повторной проверкой (13:08) в общем дереве появились изменения этапа 1: ` M packages/beads-adapter/src/{index,runner}.ts`, ` M packages/storage/src/{errors,index,migrations,store}.ts`, ` M scripts/lib/process.mjs`, ` M scripts/pack.mjs`, ` M tests/{lease,storage-crash,storage}.test.mjs`, ` M tests/lib/crash-child.mjs`, `?? packages/beads-adapter/src/{launch,probe}.ts`, `?? packages/controller/src/migration-allocator.ts`, `?? tests/beads-launch.test.mjs`, `?? tests/scripts-launch.test.mjs`, `?? tests/storage/*.test.mjs` (4 файла); `git` при этом предупредил о живом временном каталоге `packages/beads-adapter/src/.adapter.ts.…tmpdir/`. Это **не** нарушение write-scope'ов этапа 0: пути лежат в `packages/**`, `scripts/**`, `tests/**` — области этапа 1, прямо вынесенной за рамки этого ревью. Но это значит, что проверка 6 («правок вне README.md/docs/evidence нет») верна **только для снимка 13:00**, а любое её повторное цитирование требует новой привязки ко времени. Мои собственные проверки этапа 0 от этого не пострадали: профиль (`D4572494…503E`) и `pnpm-lock.yaml` (`CCC3E425…`) в 13:08 имели те же хэши, что и в baseline.

---

**Итог ревьюера.** Этап 0 по существу состоятелен: живое дерево и профиль целы, внешняя копия профиля верна, дефект F-04 доказан по исходникам и уже действует в рантайме без перезапуска Host, чистка F-10 не вышла за авторизованный список. Два MAJOR-дефекта лежат в доказательной части гейта `foundation-12-stage0-gate.md` (ложное обобщение про `autoRun` в активных бандлах; устаревший и уже неверный статус `PENDING-RESTART` вместе с §6.3), три MINOR и два NIT — в цифрах и якорях отчётов. Ни один дефект не требует отката правки или изменения состояния доски. Verdict: **PASS WITH FINDINGS**.

---

## Верификация дельты

- **Режим:** verify-fixes (read-only по живому дереву и профилю); единственная запись — этот раздел. Объект: правки в `foundation-12-stage0-gate.md` на снимке 129 строк, mtime **13:12:11** (в двух независимых листингах один и тот же — файл между ними не менялся). HEAD `0c657ae` (`git worktree list`).
- **Инструменты:** pwsh, `Select-String`, `Compare-Object`, `Get-FileHash`, `Get-Content`+`ConvertFrom-Json` по `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`, `git status`/`git worktree list` (только чтение), `task_board_list` (read-only). Профиль читался напрямую, без `dsh`.
- **Дерево двигалось:** пока шла проверка, другие потоки переписывали `foundation-06/61/62` и добавляли шаги этапа 1 (13:19–13:20). Все утверждения ниже относятся к снимку delta-файла 13:12:11.

**Вердикт: FIXES PARTIALLY VERIFIED.** MAJOR-1 (в отчёте-ревью — F-02, `PENDING-RESTART`) закрыт полностью; MAJOR-2 (F-01, ложное обобщение про `autoRun`) закрыт по всем трём предъявленным элементам, но заменяющая формулировка внесла **новую ложную посылку** (§1, строка 45: «мёртвый клиентский остаток» про `dsh-web-all\lib\client.js:41295,41680`). Вывод F-05 (0 файлов по семи именам ключей) верен, откат не требуется.

| # | находка | статус | доказательство (команда → наблюдение) |
|---|---|---|---|
| 1 | **MAJOR-1 / ревью F-02** — `PENDING-RESTART` и «до перезапуска Host действует `read-only`» | **VERIFIED** | `Select-String -LiteralPath foundation-12-stage0-gate.md -Pattern 'PENDING-RESTART\|перезапуск'` → 6 совпадений: L7 («обновилось **без** перезапуска Host»), L50, L97, L98, L102, L125. В статусе (L7), §4 (L83 F-06, L90 F-62), §6.1 (L106) и §6.3 (L108) утверждений о необходимости перезапуска нет; L97/L98/L102 — §5.2 (снятая гипотеза), L125 — §8 (описание находки). Живой `task_board_list {query:"MW-027", includeArchived:true}` → `revision 325`, `sessionDefaultPermission "workspace-write"`, counts 32/0/0/19/1/3 — совпадает с §5.2:100 и §4 F-62:90. Остаток — заголовок §2 (L50), дефект №2 ниже |
| 2 | **MAJOR-2 / ревью F-01** — «совпадения `autoRun` только в резервной копии» | **PARTIAL** | (a) точный поиск по семи именам (`autoRunTodo\|autoRunPaused\|autoRunMaxConcurrent\|autoRunStallMinutes\|autoRunMaxPerHour\|autoRunMaxPerDay\|autoRunMaxRetries`) по `…\profiles\web\node_modules\@linxin666\**\*.js` → `matches=0 files=0` — как в L39/L41; (b) `Select-String 'autoRun'` там же → ровно 6 совпадений в 3 файлах: `dsh-session-archive\lib\index.js:2721,2777`, `dsh-session-archive\lib\client.js:160,558`, `dsh-web-all\lib\client.js:41295,41680` — перечень L44–L45 точен до строки; (c) `Select-String '/auto/'` в `dsh-client-ui-task-board\lib\index.js` и `lib\client.js` → `0` и `0`. **Не подтверждён** вывод L45 «то есть это мёртвый клиентский остаток» — дефект №1 ниже |
| 3 | §1 L16 «11 изменённых записей: 9 удалённых, 2 добавленных» | **VERIFIED** | `Compare-Object (Get-Content bak) (Get-Content live)` → `total diff records=11`, только-в-бэкапе (`<=`) **9**, только-в-live (`=>`) **2**; 105 → 98 строк. Состав совпал с блоком L18–L29: `config: { sessionDefaultPermission: workspace-write },` + 7×`autoRun*` + `announceToAgent: true,` → `sessionDefaultPermission: workspace-write,` + `announceToAgent: true`. Хэши: live `D4572494…503E`, bak `D3AAACF0…E07595` — как в L14. Живой профиль: `plugin:` L24, `sessionDefaultPermission` L25, отступ 8 пробелов — как в §3 гейта |
| 4 | §4 L90 «`permissionConfirmedAt` 22→22» | **VERIFIED** (сторона «после») | разбор `ledger-v2.json`: `revision=325`, `tasks=55`, с `permissionConfirmedAt` — **22**, без — 33, `permission` = `workspace-write` у всех 55, `mode` только у `cc19da5a…` (`cordis`), `permissionPending` не хранится (0). «ДО»=22 (rev 324) — цифра F-62, после факта не перепроверяема (то же ограничение, что в §6 п. 10 ревью); «после»=22 воспроизведено дважды — ревьюером в 13:04 и здесь |
| 5 | §4 L90 «0 нарушений» при `workspace-write` | **VERIFIED** | в леджере **0 из 55** карточек с правом выше `workspace-write`; предикат строгий — `exceedsSessionDefault` = `PERMISSION_RANK.get(permission) > PERMISSION_RANK.get(sessionDefault)` (`index.js:869-871`, цитата в §2a ревью), поэтому равный дефолту `workspace-write` гейт не зажигает |
| 6 | §5.2 L100 «в профиле активен `@deepseek-ai/dsh-hmr`, правка подхватывается на лету» | **VERIFIED** | `packages/bundle/base/cordis.patch.yml:27-32`: `# Profile configuration reloads by default…` / `- id: hmr` / `name: '@deepseek-ai/dsh-hmr'` / `disabled: !!js "!ctx.get('profileContext')"`; `@deepseek-ai/dsh-base` — первый bundle в `dsh.profile.bundles`, там же `"patchReload": "live"` (`profiles\web\package.json`); `packages/boot/hmr/package.json` — «Coordinated module and profile configuration hot reload». Отсутствие пакета в `profiles\web\node_modules\@deepseek-ai` (там только `cosmokit`, `schemastery`) не опровергает: ряд приходит слоем базового бандла, а не установкой в профиль. `cordis.yml` (223 Б, mtime 11:34:38) — служебный файл, а не композиция, отсутствие `hmr` в нём ничего не значит |
| 7 | §5.2 L98 «снимок — `:3653`, `:3709`» | **VERIFIED** | board `index.js:3653` — `sessionDefaultPermission: options.sessionDefaultPermission,` (ctor `HostTaskLedger`); `:3709` — `sessionDefaultPermission: this.ledger.sessionDefaultPermission,` (снимок состояния); оба якоря существуют и по смыслу поддерживают «читается при монтировании, отдаётся снимком» |
| 8 | §5.1 L95 «4 worktree; f-audit 6 / mw012-review 30 / v2-boundary-demo 2» | **VERIFIED** | `git worktree list` → 4 записи (`main 0c657ae`, `f-audit 0c657ae`, `mw012-review f22dbc3`, `v2-boundary-demo 0c657ae`); `git -C .tmp\<w> status --porcelain \| Measure-Object` → 6 / 30 / 2 |
| 9 | §8 L124 «2 MAJOR, 3 MINOR, 2 NIT» | **VERIFIED** | §3 отчёта-ревью: F-01 MAJOR, F-02 MAJOR, F-03/F-04/F-05 MINOR, F-06/F-07 NIT |
| 10 | §8 L127 «каталог `%TEMP%\dsh-restore-drill` удалён Lead'ом после отчёта» | **NOT VERIFIED** | `Test-Path $env:TEMP\dsh-restore-drill` → `False`; в `$env:TEMP` нет ни одного каталога с `drill`; поиск `restore-drill` по `.work\**\*.md` не находит записи об удалении (ни в `foundation-10-cleanup.md`, ни где-либо ещё); `foundation-03-profile-restore.md:16` (mtime 12:50:58, не правился) по-прежнему утверждает «**не удалён**». Ревью прямо писало, что «удалён позже» и «не создавался по этому пути» неразличимы (§6 п. 5) — правка заменила неразличимость на недоказуемое утверждение |
| 11 | **D** — «§8 описывает ровно сделанные правки» | **PARTIAL** | Цитаты ревью из первой редакции в файле отсутствуют: `:7` «F-06/F-62 после-readback — `PENDING-RESTART`» → L7 «PASS WITH ONE DOCUMENTED DEVIATION… закрыты измерением»; `:41` «только в резервной копии… `client.js.orig-ru-patch:41283,41668`» → вторая редакция L41–L48; §5.2 `:90-93` «по-прежнему отдаёт `read-only`» → «СНЯТО» L97–L102; §6.3 `:99` «33 карточки всё ещё блокируются» → L108; diff-блок `:16-29` → заголовок «11 изменённых записей: 9 удалённых, 2 добавленных… сжатая запись». Новый §8 (L121–L129) приписывает себе ровно эти правки и прямо отдаёт MINOR/NIT владельцам чужих файлов. Расхождения: (а) L127 — недоказуемый факт про drill (строка 10); (б) L125/L126 маркируют находки «MAJOR-1/MAJOR-2», тогда как в отчёте-ревью первый MAJOR — F-01 (`autoRun`), второй — F-02 (`PENDING-RESTART`), т. е. нумерация инвертирована относительно исходных ID (дефект №4) |

### Новые дефекты, внесённые правками

1. **MAJOR · `foundation-12-stage0-gate.md:45`** — «серверная половина **доски** такого маршрута не регистрирует …, **то есть это мёртвый клиентский остаток**». Ложно: клиентский `autoRun` в агрегате — это клиентская половина **`dsh-session-archive`**, чей серверный маршрут зарегистрирован.

   ```text
   wa_c:41245: //#region ../dsh-session-archive/src/client/api.ts
   wa_c:41284: const prefix = "api/dsh-session-archive";
   wa_c:41295: autoRun: (kind, currentSessionId) => request(`${prefix}/auto/run`, {
   wa_c:41295 == sa_c:160  (побайтовое равенство строк: True)
   wa_c:41680 == sa_c:558  (True)
   sa_i:2724: path: `${ARCHIVE_API_PREFIX}/auto/run`,
   sa_i:2777: makeAutoRunRoute(service)
   web-all\cordis.patch.yml:92-95: - id: web-ui-session-archive / name: '@linxin666/dsh-web-all/session-archive' / plugin: '@linxin666/dsh-session-archive'
   ```

   `@linxin666/dsh-web-all` входит в `dsh.profile.bundles` профиля `web`, то есть ряд `web-ui-session-archive` смонтирован и маршрут `/auto/run` живой. Проверка «`/auto/` в бандлах доски → 0» верна, но она про другой плагин; вывод «мёртвый остаток» из неё не следует. **Вывод F-05 не затронут** — он держится на точном поиске по семи именам (0 файлов), подтверждённом мной. Минимальная правка: заменить «то есть это мёртвый клиентский остаток» на «это клиентская половина `dsh-session-archive` (регион `../dsh-session-archive/src/client/api.ts`, `prefix = "api/dsh-session-archive"`), её маршрут регистрирует серверная половина того же плагина; к ключам `autoRun*` и маршрутам доски отношения не имеет».
2. **NIT · `:50`** — заголовок «## 2. Проверка YAML **до перезапуска**» — остаток снятой гипотезы в месте, не покрытом исключением задания (заголовок §2, а не §5.2/§8). Ожидалось «после правки».
3. **NIT · `:108`** — §6 п. 3 почти дословно повторяет п. 1 (`:106`): «гейт снят и **измерен**… ни одна боевая карточка не прогонялась… бюджет §17». Ревью просило пункт 3 удалить; правка сохранила его пересказом, и список «что гейт НЕ доказывает» теперь содержит один тезис дважды.
4. **NIT · `:125-126`** — «MAJOR-1»/«MAJOR-2» не связаны с ID отчёта-ревью (там F-01 = `autoRun`, F-02 = `PENDING-RESTART`): читатель, сверяющий «MAJOR-1» с первым MAJOR'ом ревью, попадает на другой дефект. Достаточно было «F-02 (MAJOR)» / «F-01 (MAJOR)».
5. **NIT · `:127`** — утверждение об удалении drill-каталога без доказательства (строка 10 таблицы); вдобавок внутренне противоречиво: исправление адресовано «потоку env», а удаление приписано Lead'у, то есть автору этого файла.

**Что искал и не нашёл:** новых неверных файл:строка-якорей (`:5568`, `:5397`, `:816`, `:877-879`, `:2074`, `:3653`, `:3709`, `shell-DWqLngib.js:1089-1092` — все существуют и совпадают по смыслу); новых числовых утверждений, не сводящихся к проверенным (кроме п. 1 и строки 10 таблицы); повторного появления снятых формулировок про `read-only`/`33 карточки`; расхождений между §4/§5.2/§8 и живым API доски. Ложных утверждений, кроме перечисленных, **не найдено**.

### Что не проверял и почему

1. **Гейт №2 F-12** (`corepack pnpm -r run typecheck`, заявлен exit 0) и контроль формы без `-r` — не перезапускал: дорого и вне бюджета (тот же отказ, что в §6 п. 1–2 ревью).
2. **Прогоны `dsh` / `verify:profile` / монтирование пресета `cordis`** — запрещены условиями (живой профиль; `dsh` перезаписывает `cordis.yml`).
3. **«ДО»-значения** (rev 324, `read-only`, 33 карточки, `permissionConfirmedAt`=22 до правки) — после факта не воспроизводимы; проверял только состояние на rev 325.
4. **F-10 (105,55 МБ / 1865 файлов), архивация MW-027/MW-035, 7 done-карточек с `failed`** — вне дельты; подтверждены ревью, повторно не пересчитывал.
5. **Правки MINOR/NIT в чужих файлах** (`foundation-61`, `foundation-03`, `foundation-62`) — не проверял; зафиксировал лишь, что `foundation-03:16` не обновлён, а `foundation-06/61/62` в момент проверки переписывались другими потоками (mtime 13:20:34–13:20:45, выросли между двумя моими листингами).
6. **Момент «получения вердикта» автором** (§8 L125) — по mtime не определяется: последняя запись delta-файла 13:12:11 позже mtime отчёта-ревью 13:09:33, но это может быть запись §8. Отдельно: цифры ревью «mtime `foundation-06` = 12:56:07, `foundation-62` = 12:56:41» не совпали ни с одним наблюдённым состоянием (в 13:1x — 12:58:08 / 12:58:48; в 13:20 — уже 13:20:45 / 13:20:34). Это дефект **отчёта-ревью**, а не правок, и на выводы дельты он не влияет; фиксирую потому, что на этих mtime держится реконструкция «`PENDING-RESTART` был опровергнут за 45 с до записи F-12».
