# foundation-12 — гейт этапа 0 (F-12) + F-04/F-05

- **Задача:** `task-4` (команда v0.3), исполнитель — Lead
- **Шаги плана:** F-04, F-05, F-12 (`20-STEPS-foundation.md:128-152`, `:304-318`)
- **HEAD:** `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`
- **Дата:** 2026-09-27
- **Статус:** **PASS WITH ONE DOCUMENTED DEVIATION** (worktree count, §5.1). F-06/F-62 закрыты **измерением**: рантайм-значение обновилось без перезапуска Host (живой API отдаёт `workspace-write`, revision 325) — см. §5.2.

---

## 1. Что сделано (F-04 + F-05 одним изменением)

Файл: `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` (живой профиль, строка `web-ui-task-board`).
Копия до правки: `cordis.patch.yml.bak-planv03-F04` (SHA256 до правки — `D3AAACF053C854CB6577DA4CDE7FBF881AFF4A6A27999F5CAFD4390029E07595`, после правки — `D457249482716C97E07C52E95D569FB00AB8604B443191D984CAD7967AF1503E`).

Diff (`Compare-Object` с бэкапом → **11 изменённых записей**: 9 удалённых строк, 2 добавленных; ниже — сжатая запись, где `announceToAgent: true` показан один раз как неизменившийся по смыслу):

```text
-        config: { sessionDefaultPermission: workspace-write },   ← ключ лежал в config.config
-        autoRunTodo: true                                          ← 7 мёртвых ключей
-        autoRunPaused: true
-        autoRunMaxConcurrent: 1
-        autoRunMaxRetries: 1
-        autoRunStallMinutes: 30
-        autoRunMaxPerHour: 3
-        autoRunMaxPerDay: 0
+        sessionDefaultPermission: workspace-write,                  ← уровень строки (сосед plugin:)
         announceToAgent: true                                       (запятая снята — ключ стал последним)
```

**Дефект подтверждён по исходникам (не по отчёту):**

| Утверждение | Доказательство |
|---|---|
| Плагин читает **верхний уровень** своего config | `…\@linxin666\dsh-client-ui-task-board\lib\index.js:5568` — `sessionDefaultPermission: config?.sessionDefaultPermission ?? "read-only"` |
| Дефолт схемы — `read-only` | там же `:5397` — `z.union(TASK_PERMISSIONS).default(DEFAULT_SESSION_PERMISSION)`; `:816` — `const DEFAULT_SESSION_PERMISSION = "read-only"` |
| Агрегат срезает только `plugin`, остальные ключи строки отдаёт плагину | `…\@linxin666\dsh-web-all\lib\shell-DWqLngib.js:1089-1092` — `function familyConfigOf(row) { const { plugin: _spec, ...family } = row; … }` |
| Гейт подтверждения = «право выше дефолта **и** нет `permissionConfirmedAt`» | `…\dsh-client-ui-task-board\lib\index.js:877-879` — `requiresPermissionConfirmation(task, sessionDefault = DEFAULT_SESSION_PERMISSION) { return exceedsSessionDefault(effectivePermission(task), sessionDefault) && task.permissionConfirmedAt === void 0 }` |
| Мёртвые ключи `autoRun*` не читает **никто** в живом профиле | `Select-String` по `autoRunTodo|autoRunPaused|autoRunMaxConcurrent|autoRunStallMinutes|autoRunMaxPerHour|autoRunMaxPerDay|autoRunMaxRetries` в `…\profiles\web\node_modules\@linxin666\**\*.js` → **0 файлов** |

**Уточнение к факту 2 шага F-05 (вторая редакция — после независимого ревью `verify-stage0-review.md`, MAJOR).** Точный поиск по семи именам ключей (`autoRunTodo|autoRunPaused|autoRunMaxConcurrent|autoRunStallMinutes|autoRunMaxPerHour|autoRunMaxPerDay|autoRunMaxRetries`) по всем `@linxin666\**\*.js` живого профиля → **0 файлов**: эти ключи не читает никто, и именно на этом держится вывод F-05.

Подстрока `autoRun` при этом встречается и в **активных** бандлах — но у других плагинов, и это F-05 не опровергает:
- `…\@linxin666\dsh-session-archive\lib\index.js:2721,2777` — `makeAutoRunRoute` (собственный маршрут авто-архивации **сессий**, не ключи доски), `…\dsh-session-archive\lib\client.js:160,558`;
- `…\@linxin666\dsh-web-all\lib\client.js:41295,41680` — **третья редакция (после верификации дельты).** Эти строки байт-в-байт совпадают с клиентом `dsh-session-archive` (`…\dsh-session-archive\lib\client.js:160,558`): регион `//#region ../dsh-session-archive/src/client/api.ts` (L41245), `const prefix = "api/dsh-session-archive"` (L41284), а серверная половина этого плагина **регистрирует** маршрут (`…\dsh-session-archive\lib\index.js:2724`, список маршрутов `:2777`; ряд `web-ui-session-archive` смонтирован через `…\dsh-web-all\cordis.patch.yml:92-95`). То есть это **живой** маршрут `auto/run` плагина архива сессий, а не мёртвый остаток; к ключам доски он отношения не имеет. Формулировку «мёртвый клиентский остаток» из второй редакции **снял независимый верификатор дельты** (`verify-stage0-review.md`, раздел «Верификация дельты», MAJOR); проверка «`/auto/` в бандлах доски → 0» при этом верна и относится к доске;
- `…\dsh-web-all\lib\client.js.orig-ru-patch:41283,41668` — резервная копия, не загружается.

Первая редакция этого файла утверждала, что совпадения есть «только в резервной копии, а не в активных бандлах» — это **ложное обобщение** (нашёл ревьюер): я искал подстроку только в `dsh-web-all`. Вывод шага от этого не меняется, но доказательство было сужено.

## 2. Проверка YAML без запуска `dsh`

```text
node -e "js-yaml.load(cordis.patch.yml)"  →  exit 0
YAML_OK rows=16
ROW={"id":"web-ui-task-board","config":{"plugin":"@linxin666/dsh-client-ui-task-board","sessionDefaultPermission":"workspace-write","announceToAgent":true}}
```

Результат: файл разбирается, строка `web-ui-task-board` содержит `sessionDefaultPermission` **на уровне соседей `plugin`/`announceToAgent`** (а не внутри `config`). Разбор выполнен `js-yaml` из чек-аута DSH (`C:\Reposit\deepseek-harness\deepseek-harness\node_modules\js-yaml`), а не запуском `dsh` — чтобы не трогать профиль (`dsh --dump-config` перезаписывает `profiles\web\cordis.yml`, см. запрет в шаге F-61).

## 3. Пять команд гейта F-12

| # | Команда | Ожидание плана | Факт | Exit |
|---|---|---|---|---|
| 1 | `corepack pnpm --version` | `12.4.2` | `12.4.2` | 0 |
| 2 | `corepack pnpm -r run typecheck` | EXIT=0 (12 пакетов) | `Scope: 12 of 13 workspace projects`, все `Done`, **ошибок нет** | **0** |
| 3 | `Select-String -Pattern 'sessionDefaultPermission'` | 1 совпадение, отступ как у `plugin:` | **1** совпадение: строка 25 `sessionDefaultPermission: workspace-write,`; `plugin:` — строка 24, тот же отступ (8 пробелов) | 0 |
| 4 | `Select-String -Pattern 'autoRun'` | 0 совпадений | **0** | 0 |
| 5 | `git worktree list` | 1 запись | **4 записи** — отклонение, см. §5.1 | 0 |

Контроль выбора runner'а (F-01): `corepack pnpm run typecheck` **без** `-r` → EXIT=1 (вложенный bare `pnpm` 11.7.0 из `.bin` DSH-чек-аута) — воспроизведено потоком env-ops, записано в `foundation-01-pnpm.md`.

Побочная проверка: после прогона гейта №2 рабочее дерево осталось чистым по `pnpm-lock.yaml` (`git status --porcelain` → только ` M README.md` и `?? docs/` из потока env-ops), то есть `corepack pnpm -r run` лоcк не пачкает.

## 4. Состояние остальных шагов этапа 0

| Шаг | Статус | Evidence |
|---|---|---|
| F-01 runner | принят | `foundation-01-pnpm.md` |
| F-02 копия профиля | принят, перепроверен Lead'ом: `1230/1230` файлов, SHA256 `cordis.patch.yml` копии = живого | `foundation-02-profile-backup.md` |
| F-03 процедура восстановления | принят: drill в изолированном `DSH_HOME`, `verify:profile: PASS`, хэш живого профиля до/после совпал | `foundation-03-profile-restore.md` |
| F-04 гейт прав (файл) | выполнен, см. §1 | этот файл |
| F-05 мёртвые `autoRun*` | выполнен, 0 совпадений | этот файл |
| F-06 доказательство снятия гейта | принят: живой API отдаёт `workspace-write` (rev 325), привязка `workspace-write` не требует подтверждения | `foundation-06-permission-gate.md` |
| F-07 архивация MW-027/MW-035 | принят: обе **уже были** архивированы, `archive` → идемпотентный отказ `refused`; гейт (отсутствие в backlog, наличие с `includeArchived`) подтверждён | `foundation-07-archive-superseded.md` |
| F-08 правило D19 | принят: README (поток env) + `INDEX.md` (поток board) | `INDEX.md`, `README.md` |
| F-09 инвентаризация `done`+`failed` | принят с поправкой: **7**, а не 9; у всех 7 нет `sessionId` (падения запуска до сессии, `workspace not found`, ~8 мс) | `foundation-09-done-failed.md` |
| F-10 чистка | выполнен по решению владельца «только безопасный класс»: 7 путей, **105,55 МБ / 1865 файлов** освобождено; целостность живого дерева подтверждена независимо Lead'ом | `foundation-10-cleanup.md` |
| F-11 грязный лок | гейт пройден: `git status --porcelain pnpm-lock.yaml` пусто | `foundation-11-lockfile.md` |
| F-61 пресет `cordis` | принят: 4×2 таблица, от базы бандла **0 unresolved** у всех четырёх, от каталога профиля — 2 ложных FAIL; id пресета `cordis`; mode-pin permission-нейтрален | `foundation-61-preset.md` |
| F-62 масштаб гейта | «до»: revision 324, `read-only`, **33** карточки выше дефолта без `permissionConfirmedAt`; «после» (rev 325, `workspace-write`): **0** нарушений, `permissionConfirmedAt` 22→22 (человек ничего не подтверждал) | `foundation-62-permission-gate.md` |

## 5. Отклонение (решение владельца) и снятая гипотеза

### 5.1. `git worktree list` = 4, а не 1
Владелец выбрал чистку «только безопасный класс»: три грязных worktree (`.tmp/f-audit` 6 записей, `.tmp/mw012-review` 30, `.tmp/v2-boundary-demo` 2) сохранены как носители несохранённой работы. Буквальное `Test-Path "<root>\.tmp\v2-boundary-demo\node_modules"` → `False` недостижимо без удаления worktree. Пункт 5 гейта F-12 и соответствующий пункт гейта F-10 считаются **не пройденными по решению владельца**, а не пройденными.

### 5.2. Рантайм-значение `sessionDefaultPermission` — СНЯТО (обновилось без перезапуска Host)
Исходная гипотеза: плагин читает конфиг только при монтировании (`index.js:5568`, `:2074`; снимок — `:3653`, `:3709`), поэтому нужен перезапуск Host, и F-06/F-62 записывались как `PENDING-RESTART`.

Измерение эту гипотезу **опровергло**: в профиле активен `@deepseek-ai/dsh-hmr`, и правка `cordis.patch.yml` подхватывается на лету. Наблюдение потока board-ops: на одной и той же `revision 325` живой API сначала отдавал `read-only`, секундой позже — `workspace-write`. Независимая проверка Lead'ом через `task_board_list`: `revision 325`, `sessionDefaultPermission = "workspace-write"`.

Следствие: **F-06 и «после»-замер F-62 закрыты измерением** (детали — `foundation-06-permission-gate.md`, `foundation-62-permission-gate.md`), перезапуск Host не требуется. Формулировку «требует перезапуска» из первой редакции этого файла считать снятой.

## 6. Что этот гейт НЕ доказывает

1. Что карточки `MW-044`…`MW-055` действительно запустятся: гейт прав снят и **измерен** (F-06), но ни одна боевая карточка не прогонялась — запуск тратит квоту и ограничен бюджетом кампании (§17).
2. Что `pnpm` «починен» глобально: F-01 даёт рабочий runner (`corepack pnpm -r`), а не ремонт шима `H:\.pnpm-store\…\bin\pnpm.CMD`.
3. Что прогон боевой карточки доходит до конца (агент стартует, работает и отчитывается): не проверялось вовсе — ни одного `task_board_run` в кампании не выполнялось (бюджет §17).
4. Восстановление профиля на **чистой машине**: drill показал, что копия без `node_modules` не загружается и требует `dsh plugin --profile web install` (записано в процедуру).

## 7. Команды для воспроизведения

```powershell
corepack pnpm --version
corepack pnpm -r run typecheck; $LASTEXITCODE
Select-String -LiteralPath 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Pattern 'sessionDefaultPermission'
Select-String -LiteralPath 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Pattern 'autoRun'
git -C H:\Repo\DSH-MyWork worktree list
```

## 8. Независимое ревью этапа 0

- Артефакт: `verify-stage0-review.md` — независимый read-only ревьюер (отдельная сессия, без прав на запись в живое дерево).
- Вердикт: **PASS WITH FINDINGS** — 2 MAJOR, 3 MINOR, 2 NIT, **BLOCKER нет**, откат ничего не требует.
- Нумерация ниже — по ID ревью: **MAJOR-1 = autoRun** (§1), **MAJOR-2 = PENDING-RESTART** (статус/§4/§5.2/§6). Первая редакция §8 путала их местами (NIT верификатора дельты, исправлено).
- **MAJOR-2 ревью (PENDING-RESTART)** — **исправлено**: статус (стр. 7), §4 (строки F-06/F-62), §5.2, §6.1 и §6.3 переписаны по измерению (rev 325, `workspace-write`). Верификация дельты: **VERIFIED**.
- **MAJOR-1 ревью (autoRun)** — **исправлено** в §1; верификация дельты дала **PARTIAL**: вторая редакция §1 добавила ложную посылку «мёртвый клиентский остаток» про `dsh-web-all\lib\client.js:41295,41680`. Третья редакция формулировку сняла (это живой маршрут `auto/run` плагина архива сессий, см. §1). Итог: обе находки MAJOR закрыты.
- Второй проход (верификация дельты, отдельная сессия) на входе дал **FIXES PARTIALLY VERIFIED** — именно он поймал ложную посылку во **второй** редакции §1; после третьей редакции §1 обе MAJOR закрыты, замечания NIT (заголовок §2, дубль §6.3, нумерация §8) исправлены в этом же файле.
- MINOR/NIT, переданные владельцам файлов (не моя зона): F-61 «6 мс и 70 мс» → в леджере оба исполнения по 70 мс (поток board); F-03 «`%TEMP%\dsh-restore-drill` не удалён» → исправлено потоком env; сам каталог (1230 файлов, 219,2 МБ, 0 reparse-точек) удалён Lead'ом командой `cmd /c rmdir /s /q` после проверки, что путь разрешается под `$env:TEMP` и не содержит ссылок за свои пределы (наблюдение: `rmdir exit=0`, `Test-Path → False`). Верификатор дельты помечает это как NOT VERIFIED — постфактум удаление недоказуемо (следов нет по определению), поэтому здесь оно приведено как собственное наблюдение Lead'а, а не как проверенный третьей стороной факт; F-62 устаревший якорь «строки 66–68» → после F-04 это L59/L61 (поток board). Сжатый diff-блок исправлен здесь.
- Что ревьюер **не** проверял и не выдаёт за проверенное: repo-wide `corepack pnpm -r run typecheck` (дорого; выполнено Lead'ом, exit 0), контроль формы без `-r`, прогоны `dsh`/`verify:profile`.
- Подтверждено ревьюером командами (не пересказом): профиль (1 совпадение `sessionDefaultPermission` L25 на уровне `plugin:`, `autoRun` по имени 0, `js-yaml` exit 0), бэкап `.bak-planv03-F04` = `D3AAACF0…E07595`, все четыре якоря дефекта F-04, копия профиля 1230 файлов с до-правочным хэшем, F-10 (7 путей, живые каталоги и junction целы, счётчики совпали), доска (архивные MW-027/MW-035, 7 done-карточек с `failed` без `sessionId`, rev 325 + `workspace-write`, 22/33), HEAD `0c657ae`, lockfile чист.
