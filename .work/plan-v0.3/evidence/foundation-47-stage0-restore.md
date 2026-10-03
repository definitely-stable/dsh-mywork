# R-47 · Переисполнение этапа 0 в живом профиле (F-02 → F-03 → F-04/F-05/F-61 → F-06/F-62)

**Статус: READY_FOR_REVIEW.** Гейты F-02, F-03, F-04, F-05, F-06, F-62 выполнены командами с exit-кодами ниже;
F-61 закрыт решением владельца («не пинить вовсе»), а не пином карточек — обоснование и проверенный дефолт в §E.

Дата: **2026-10-03** (14:04–14:20 +05:00). База репозитория `4421c13`, дерево чистое до работы.
Рантайм: DSH `639ed0153` = `dsh-v0.2.0-rc.2`; живой профиль `C:\Users\Dmitry\.dsh` (18 бандлов, леджер rev. 341).
Согласие владельца на правку живого профиля получено **до** правки (отдельный вопрос, ответ «Да — правь всё: F-04 + F-05 + F-61»);
масштаб F-61 владелец выбрал отдельно («Не пинить вовсе»).

Порядок исполнения — буквально по плану: копия → проверенная процедура → правка → доказательство. **Ни одна задача доски не запускалась.**

---

## A. F-02 · Внешняя копия живого профиля

**Копия: `C:\DSH-Backups\dsh-profile-2026-10-03`** (`BACKUP_ROOT` = `C:\DSH-Backups`; переменная окружения в сессии не задана —
путь выбран явно и проверен: вне профиля, вне репозитория, на другом томе).

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `Get-ChildItem 'C:\Users\Dmitry\.dsh' -Recurse -File -Force \| Measure-Object Length -Sum` | 0 | **5584 файла, 520,58 МБ** (с `logs/`, `node_modules/`) |
| то же с исключением `\logs\`, `\node_modules\`, `*.log` | 0 | **1668 файлов, 368,01 МБ** — это и есть копируемое множество |
| отдельно `node_modules` / `logs`+`*.log` | 0 | 3894 файла / 150,60 МБ · 22 файла / 1,98 МБ |
| инвентарь reparse-точек в копируемом множестве | 0 | **0 файлов, 0 каталогов** (724 каталога проверены) → `robocopy /E` не может уйти по junction-циклу; `/XJ` не нужен |
| `Test-Path C:\DSH-Backups` / `dst` / вне профиля / вне репозитория | 0 | `True` / `False` (создан копированием) / `True` / `True` |
| `robocopy <src> <dst> /E /XD logs node_modules /XF *.log /R:1 /W:1` | **1** | `Dirs 725/722`, `Files 1669/1668`, `Bytes 368.02 m`, **`FAILED: 0`, `Mismatch: 0`**; для robocopy 1 = «скопировано», ошибка начинается с 8 |
| `Test-Path <dst>\profiles\web\cordis.patch.yml` (гейт F-02) | 0 | **True** |
| число файлов и объём копии | 0 | **1668 файлов, 368,03 МБ** — совпадает с копируемым множеством источника |
| SHA256 пяти критичных файлов, источник против копии | 0 | все пять `match=True`: `profiles\web\cordis.patch.yml` `D54CBE2C…A832A4B2`, `profiles\web\package.json` `482968BE…9920A874`, `task-board\ledger-v2.json` `DCB853EA…5C963E16`, `.credentials.yaml` `6F66FE1B…A5BAD5BB`, `profiles\web\cordis.yml` `C300DCF2…BA06076E` |

**Наблюдение, которого не было в прежней кампании:** `task-board\ledger-v2.json` **не побайтово стабилен** —
через несколько минут тот же файл при том же `revision: 341` имел SHA256 `AEFCE933…C407D81C` (плагин доски
переписывает `scheduler.lastTickAt` на тиках). Для копии это не дефект (снимок best-effort, как и допускает план),
но отпечаток критика **нельзя** перепроверять «равенством на потом»: сверять нужно **revision**, а не хэш файла.

Копия не атомарна (снята при работающем DSH) и **не самодостаточна для загрузки**: `node_modules` исключён по тексту шага,
поэтому восстановление требует переустановки зависимостей профиля — это проверено drill'ом (§B).

---

## B. F-03 · Проверенная процедура восстановления

Drill выполнен на **изолированной копии снимка**, живой профиль не адресовался:

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `robocopy <backup> .tmp\stage0-restore-drill /E /R:1 /W:1` (в каталоге — маркер владения `.stage0-owner-marker`) | **3** | `Files 1669/1668`, `FAILED: 0`; код 3 = «скопировано + в приёмнике есть лишнее» (лишнее = маркер); **1668 файлов, 368,03 МБ** |
| SHA256 живого `cordis.patch.yml` до и после копирования | 0 | `D54CBE2C…A832A4B2` **до = после** |
| `DSH_HOME=<drill> node <checkout>\apps\cli\lib\bin.js --profile web --dump-config` | **0** | 1,78 с, 54008 символов, 1336 строк; **13** `skipping profile bundle "<name>"` + **13** `patch: entry "<id>" not found`; строки `dsh-client-ui-task-board` в собранном дереве **нет** — ожидаемо: без `node_modules` бандлы не резолвятся |
| число файлов в drill после прогона CLI | 0 | **0 лишних** (отпечаток каталога сошёлся: 1668 + маркер) |
| SHA256 живого `cordis.patch.yml` после drill | 0 | `D54CBE2C…A832A4B2` — **не изменился** (гейт F-03: до = после) |
| `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` | **0** | 16,3 с: `ok packed …controller-0.1.0.tgz`, `ok packed …web-0.1.0.tgz`, `ok created isolated profile mywork-verify`, `ok dsh plugin add installed the packed host bundle`, `ok … (ui)`, `ok profile bundles reconciled: ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller","@dsh-mywork/web"]`, `ok composed profile contains both layers, both rows, and the overlay config`, `ok profile boot mounted and unloaded the controller, and every row activated`, **`ok user profile untouched (3 fingerprint(s) unchanged)`**, **`verify:profile: PASS`** |
| SHA256 живого `cordis.patch.yml` после `verify:profile` | 0 | `D54CBE2C…A832A4B2` — не изменился |

**Ключевой вывод drill сохранился и стал точнее:** снимка без `node_modules` **недостаточно для загрузки** — DSH сам
называет шаг (`dsh plugin --profile web install`). Число скипнутых бандлов выросло 11 → **13** вместе с ростом профиля
11 → 18 бандлов (R-43); в прежней редакции процедуры это число было неверным для текущего снимка.
Процедура в `docs/ops/profile-restore.md` обновлена: новый путь копии, 13 скипов, прямой JS-entry вместо `dsh.cmd`.

**Отклонение от буквального текста шага (с причиной):** `--dsh-bin dsh` больше не нужен. `C:\Users\Dmitry\.dsh\bin\dsh.cmd`
заканчивается `call pnpm --dir <checkout> dsh …`, то есть уходит в **сломанный PATH-шим** `pnpm` (F-01); вместо него
использован прямой вход CLI `<checkout>\apps\cli\lib\bin.js`. Отдельно: `scripts/lib/process.mjs` теперь сам
предпочитает `npm_execpath`, затем `pnpm.cjs` рядом с ним, затем **corepack**, поэтому ручной
`$env:npm_execpath=…corepack…pnpm.mjs` из прежней редакции F-03 **не потребовался** (обход F-01 в скрипте больше не нужен).

---

## C. F-04 + F-05 · Правка живого профиля `profiles\web\cordis.patch.yml`

Страховка снята **до** правки: `cordis.patch.yml.bak-20261003-F04` (2779 байт, рядом с файлом).

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `Copy-Item <f> <f>.bak-20261003-F04` | 0 | `Test-Path → True`, 2779 байт |
| **до правки:** SHA256 / mtime / размер | 0 | `D54CBE2C…A832A4B2` / `2026-10-03T00:20:49` / 2779 байт |
| **до правки:** `Select-String 'sessionDefaultPermission'` / `'autoRun'` | 0 | **1** совпадение (L25, внутри `config: { … }`) / **7** совпадений (L27–33) |
| правка (`edit` по точному блоку L20–35) | 0 | ключ поднят на уровень `plugin:`, 7 ключей `autoRun*` удалены |
| **после правки:** SHA256 / mtime / размер | 0 | `D4EDA8B2…45BCD875E` / `2026-10-03T14:11:18` / 2556 байт |
| **после правки:** `Select-String 'sessionDefaultPermission'` / `'autoRun'` (гейты F-04/F-05) | 0 | **1** совпадение — `L25: sessionDefaultPermission: workspace-write,` / **0** совпадений |
| разбор YAML (`yaml@2.9.0` из чекаута DSH) | 0 | 20 записей; у строки `web-ui-task-board`: `topLevelKeys = plugin\|sessionDefaultPermission\|announceToAgent`, `nestedConfigPresent=false`, `autoRunKeys=0` |
| загрузка профиля без ошибок (гейт F-04 п.4) | — | **живое монтирование подтверждено**: строка перечитана работающим DSH (§D), предупреждений загрузчика нет |

Блок после правки (как его читает оболочка агрегата — `familyConfigOf` срезает `plugin` и передаёт остальное плагину):

```yaml
- {
    id: web-ui-task-board,
    config:
      {
        plugin: "@linxin666/dsh-client-ui-task-board",
        sessionDefaultPermission: workspace-write,
        announceToAgent: true
      }
  }
```

---

## D. F-06 + F-62 · Гейт прав снят: доказательство на живом API

| Команда | exit | Наблюдение |
| --- | --- | --- |
| **до правки** `task_board_list` (13:56) | 0 | `sessionDefaultPermission: "read-only"`, `revision: 341`, `backlog 32 / todo 0 / running 0 / done 19 / failed 1 / archived 3` |
| **после правки** `task_board_list` (14:12) | 0 | **`sessionDefaultPermission: "workspace-write"`**, тот же `revision: 341`, те же счётчики — **перезапуска DSH не было** |
| `task_board_get 26e42d6f-96e4-5ebf-adc5-bb6766e1f670` (MW-044 — карточка, которая была в гейте) | 0 | `permission: "workspace-write"`, `permissionConfirmedAt` **отсутствует**, `executionCount: 0`, полей `permissionPending` и `confirmation-required` в ответе **нет** (гейт F-06) |
| предикат гейта, **извлечённый из установленного артефакта 0.4.4** (`DEFAULT_SESSION_PERMISSION`, `PERMISSION_RANK`, `effectivePermission`, `exceedsSessionDefault`, `requiresPermissionConfirmation`) и исполненный на живом леджере rev. 341 | 0 | `DEFAULT_SESSION_PERMISSION=read-only`, `PERMISSION_RANK=[read-only:0, workspace-write:1, danger-full-access:2]`; **гейт@read-only = 33**, **гейт@workspace-write = 0**; `MW-044`: `true` при `read-only` → **`false`** при `workspace-write`; контроль `MW-002` (есть `permissionConfirmedAt`): `false` в обоих режимах — предикат не «всегда false» |
| множество 33 карточек при `read-only` | 0 | `MW-021…MW-041, MW-044…MW-055` — совпадает с перечнем R-47 и `foundation-62-permission-gate.md` |
| HTTP-проба живого API (`/api/task-board/state`, `/api/task-board`) | 0 | `403` и `401` — маршрут требует аутентификации браузерной сессии; доказательство снято через in-process API инструментов (`task_board_*`), а не по HTTP |

**Механизм, объясняющий отсутствие перезапуска (новое для плана):** базовый бандл монтирует ряд `hmr`
(`@deepseek-ai/dsh-hmr`, `packages/bundle/base/cordis.patch.yml:28-29`), а он **безусловно** вешает наблюдение за
`profile.patchPath` и пересобирает патчи на изменение файла — `packages/boot/hmr/src/index.ts:215,235`
(`watchConfig(profile.patchPath, () => refresh(false))` → `reconcileProfilePatches`). Поэтому правка
`cordis.patch.yml` применилась к работающему процессу: строка перезагрузилась, `apply()` прочитал config заново,
и `sessionDefaultPermission` (`lib/index.js:6089`) стал `workspace-write`. Повторное монтирование безопасно:
`mountOnce` (`lib/index.js:5850-5874`) снимает имя в `dispose` и выполняет отложенный `mount`.
Открытый вопрос прежней кампании («перечитывает ли живой процесс профиль без перезапуска» — `foundation-62`, «Что НЕ проверено»)
**закрыт положительно**.

**`patchReload: "live"`** в `profiles\web\package.json` — **инертная метка**: 0 совпадений в исходниках и собранных
`lib/` DSH 0.2.0-rc.2, а также в `dsh-plugin`, `dshmarket`, `@linxin666/dsh-web-all`, `@linxin666/dsh-client-ui-task-board`.
Живое перечитывание даёт ряд `hmr`, а не этот ключ; записано, чтобы его не приняли за переключатель.

**Гейт держит 0 карточек** — при `sessionDefaultPermission = workspace-write` привязка `workspace-write` перестаёт быть
«выше дефолта» (`exceedsSessionDefault` — строгое `>`), поэтому 33 карточки без `permissionConfirmedAt` больше не блокируются.
Массовое подтверждение прав **не выполнялось** (это действие человека и оно больше не требуется).

---

## E. F-61 · Пресет `mode: cordis` — решение владельца вместо пина

Владелец выбрал вариант **«не пинить вовсе»**. Что это значит по факту и что проверено:

1. **Дефолт деплоя остался `cordis`** — `profiles\web\cordis.patch.yml:66-68` (`agent-preset-registry.config.default: cordis`)
   в живом профиле на месте, правкой F-04/F-05 не задет (20 записей YAML, см. §C).
2. **Живое доказательство монтирования `cordis`** — эта сессия исполняется на нём (инструменты `cordis_inspect_*`
   объявлены только в `packages/bundle/web-app/presets/cordis.patch.yml`).
3. **Пин MW-002 из прежней кампании откатился вместе со всем этапом 0**: в леджере rev. 341 карточек с полем `mode` — **0**
   (`cardsWithModeField=0`), то есть восстанавливать нечего; по решению владельца пин не возвращается.
4. **Матрица 4×2 «unresolved от базы бандла / от каталога профиля» заново не перемерялась** — она измерена в
   `foundation-61-preset.md` **на этом же рантайме** (`dsh-v0.2.0-rc.2`, 2026-10-03) и остаётся действующей: с тех пор
   ни пресеты, ни бандлы не менялись. Пин, ради безопасности которого она снималась, при выбранной стратегии не выполняется,
   поэтому зависимости от неё нет. Это ограничение, а не проверка.

Следствие решения: карточки запускаются на дефолтном пресете деплоя; провал монтирования по-прежнему виден только в
поле `error` исполнения (это свойство платформы, не наше), а «ферма имён» `profiles\node_modules` при резолве не используется.

---

## Изменённые пути

- `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml` — **изменён** (F-04/F-05), страховка `cordis.patch.yml.bak-20261003-F04` рядом.
- `C:\DSH-Backups\dsh-profile-2026-10-03\` — создан (1668 файлов, 368,03 МБ; вне профиля и вне репозитория).
- `H:\Repo\DSH-MyWork\.tmp\stage0-restore-drill\` — создан для drill; **содержит копию `.credentials.yaml`**, поэтому удаляется
  в конце прохода по правилам изоляции (свой корень с маркером, проверка разрешённого пути и отсутствия reparse-точек).
- `docs/ops/profile-restore.md` — процедура обновлена под снимок 2026-10-03 и `0.2.0-rc.2`.
- `.work/plan-v0.3/evidence/foundation-47-stage0-restore.md` — этот файл; ссылки добавлены в `foundation-02`, `-03`, `-06`, `-61`, `-62`.

Живой профиль вне строки `web-ui-task-board` **не менялся**: три файла, которые хэширует `verify-profile.mjs`, и
SHA256 `cordis.patch.yml` сходились до и после каждого прогона (§B).

## Ограничения и что НЕ проверено

- **Ни одна задача доски не запускалась** (запрет расхода квоты). Поэтому «карточка действительно исполнится» не проверено —
  проверено, что привязка `workspace-write` **больше не требует подтверждения** (предикат + живой API). Это ровно тот объём,
  который допускает сам F-06 («ограничиться чтением состояния привязки без `run`»).
- **Фактический текст отказа** `bindingRefusalMessage(..., "run")` не наблюдался (как и в прежнем проходе).
- **HTTP-маршрут доски** (`/api/task-board/state`) отвечает `403`/`401` без браузерной сессии — число `permissionPending`
  по корпусу снято из живого леджера предикатом плагина, а не HTTP-запросом.
- **Перезапуск DSH не выполнялся** и не требовался; обратное (что значение переживёт перезапуск) не проверено отдельно —
  оно следует из того, что файл корректен и читается тем же загрузчиком.
- **Массовый пин `mode`** не выполняется по решению владельца; состояние доски по `mode` остаётся «0 карточек».
- Копия профиля не проверена на восстановление **на чистую машину** (без corepack-кэша и DSH-чекаута) — как и прежде.
