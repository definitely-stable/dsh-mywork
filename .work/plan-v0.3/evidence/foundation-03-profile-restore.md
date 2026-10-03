# F-03 · Процедура восстановления профиля и её проверка на копии

**Статус: READY_FOR_REVIEW** (гейт F-03 выполнен; процедура уточнена по результатам drill)

## Что сделано

1. Записан снимок профиля в изолированный drill-каталог и сверен побайтово по критичному файлу.
2. Прогнан **гейт F-03**: `node scripts/verify-profile.mjs` с изолированным `DSH_HOME` → `verify:profile: PASS`, exit 0; SHA256 живого `cordis.patch.yml` до и после совпадают.
3. Прогнан **drill восстановления**: `DSH_HOME=<drill>` + `dsh --profile web --dump-config` — проверка, поднимается ли восстановленный профиль как есть.
4. По результату drill описана процедура восстановления: `docs/ops/profile-restore.md` (создан).

## Изменённые пути (созданные)

- `docs/ops/profile-restore.md` — процедура восстановления (новый каталог `docs/ops/`).
- `.work/plan-v0.3/evidence/foundation-03-profile-restore.md` — этот файл.
- `C:\Users\Dmitry\AppData\Local\Temp\dsh-restore-drill\` — одноразовый drill-каталог (1230 файлов). **Каталог удалён Lead'ом после этого отчёта** (`cmd /c rmdir /s /q`; по проверке Lead'а — 0 reparse-точек). Сам я рекурсивных удалений не делал: они были запрещены условиями задачи.

Живой профиль `C:\Users\Dmitry\.dsh` **не изменялся** — это подтверждено и инструментом (fingerprint), и независимым хэшем.

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `robocopy '<BACKUP_ROOT>\dsh-profile-2026-09-27' "$env:TEMP\dsh-restore-drill" /E` | 1 | `Files: 1230/1230`, `FAILED: 0`; резервная копия восстанавливается без потерь |
| `(Get-ChildItem $drill -Recurse -File).Count` | 0 | `1230` (совпадает с копией и с источником) |
| `Get-FileHash "$drill\profiles\web\cordis.patch.yml"` | 0 | `D3AAACF0…E07595` — **совпадает** с живым профилем |
| `node scripts/verify-profile.mjs --dsh-bin dsh` (буквальная форма шага 3 плана) | **1** | Падает **до** drill: `Error: pack: pnpm pack exited with code 1` — `scripts/lib/process.mjs:52-58` берёт `pnpm` из `PATH` (сломанный шим H:-store). Дополнительно: `--dsh-bin dsh` не годится — `resolveDsh` даёт `shell:false`, а на `PATH` только `dsh.cmd` (проверка: `spawnSync('dsh',{shell:false})` → `status=null error=ENOENT`) |
| `$env:npm_execpath='…\node\corepack\v1\pnpm\12.4.2\bin\pnpm.mjs'; node scripts/verify-profile.mjs` | **0** | `ok packed …dsh-mywork-controller-0.1.0.tgz` → `ok created isolated profile mywork-verify` → `ok dsh plugin add installed the packed bundle` → `ok profile bundles reconciled: ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller"]` → `ok composed profile contains the controller layer, row, and overlay config` → `ok profile boot mounted and unloaded the controller` (`dsh-mywork: controller mounted service=myworkController version=0.1.0 contexts=control` / `controller stopped … uptimeMs=29`) → `ok user profile untouched (3 fingerprint(s) unchanged)` → **`verify:profile: PASS`** |
| `node '…\bin\pnpm.mjs' --version` (проверка shell-free entry) | 0 | `12.4.2` — сам JS-entry годится как launcher без shell |
| `(Get-FileHash 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml').Hash` после drill | 0 | `D3AAACF053C854CB6577DA4CDE7FBF881AFF4A6A27999F5CAFD4390029E07595` — **равен** значению из F-02 (гейт F-03: SHA до = SHA после) |
| `$env:DSH_HOME="$env:TEMP\dsh-restore-drill"; dsh --profile web --dump-config` | 0 | `dsh-guard: build up to date (c7c4c72, 0.1.7-rc.2)`; затем **11 предупреждений** `skipping profile bundle "<name>": … cannot resolve profile bundle … run 'dsh plugin --profile web install' if its dependency is not installed` и **10** `patch: entry "<id>" not found`; собранный конфиг 52304 символа, `contains_mywork_controller=False` |
| `(Get-ChildItem $drill -Recurse -File).Count` после drill | 0 | `1230` — CLI не создал в drill-каталоге ничего лишнего |

## Ключевой вывод drill (влияет на процедуру)

**Копии профиля без `node_modules/` недостаточно для загрузки.** Все 11 bundle-записей живого профиля (`dsh-context`, `dsh-client-auto-continue`, `dshmarket`, `@linxin666/dsh-web-all`, `dsh-locale-ru`, `dsh-opencode-session`, `misakanet`, `@nonamelego/dsh-catppuccin`, `dsh-opencode-go-usage`, `dsh-locale-ru-plugins`, `web-ui-*`-строки) скипаются, потому что плагины не установлены; DSH сам называет нужный шаг: `dsh plugin --profile web install`. Поэтому восстановление = **скопировать снимок → переустановить зависимости профиля → сверить SHA256 → запустить DSH → проверить строки**. Это записано в `docs/ops/profile-restore.md`.

Второй вывод: проверка «строка `mywork-controller` смонтирована» (шаг 1 плана) **неприменима к живому профилю `web`** — в нём `@dsh-mywork/controller` не установлен, поэтому строки нет ни в живом, ни в восстановленном конфиге. Эта проверка осмысленна только для профиля, куда бандл установлен: именно её и выполняет `verify:profile` (изолированный профиль `mywork-verify`), и она прошла.

## Отклонения от буквального текста шага (с причиной)

1. Шаг 2 плана («выставить `$env:DSH_HOME` на drill-каталог»): `scripts/verify-profile.mjs` **не читает** `DSH_HOME` для выбора своего дома — он всегда использует `<repo>/.tmp/verify-profile/home` и сам выставляет `DSH_HOME` дочерним процессам (`scripts/verify-profile.mjs:48-51,156`). Поэтому изоляцию в гейте доказывает не мой `DSH_HOME`, а (а) fingerprint-проверка самого скрипта на 3 файла живого профиля и (б) независимый SHA256 `cordis.patch.yml`. Drill-каталог при этом реально использовался — в отдельном прогоне с явным `DSH_HOME` (строка выше).
2. Шаг 3 плана (`node scripts/verify-profile.mjs --dsh-bin dsh`) в буквальном виде не работает на этой машине — две независимые причины (см. таблицу). Использована форма с `npm_execpath` и дефолтным разрешением `dsh`; обе причины зафиксированы, а не обойдены молча.
3. Повторный `Get-FileHash` живого профиля (шаг 4) выполнен дважды — после обоих прогонов.

## Ограничения

- `dsh` на этой машине — исходниковый CLI 0.1.7-rc.2, запускаемый через `C:\Users\Dmitry\.dsh\bin\dsh.cmd` (внутри — `dsh-guard.mjs` + `pnpm --dir C:\Reposit\deepseek-harness\deepseek-harness dsh`). В README заявлено «DSH 0.1.5-rc.2» — расхождение зафиксировано, README в этой части не правился (вне шага).
- `dsh-guard` на каждом запуске может выполнять `pnpm install`/`pnpm run build` в **DSH-чекауте**; перед прогонами проверено `node dsh-guard.mjs --dry-run` → `build up to date (c7c4c72, 0.1.7-rc.2)`, поэтому прогоны были no-op по этому пути.
- Drill-каталог во `%TEMP%` остался на диске (≈219 МБ): рекурсивное удаление запрещено условиями задачи — это решение для владельца/Lead.
- Boot-проверка восстановленного **живого** профиля `web` не выполнялась (только `--dump-config`): после `plugin install` это отдельный, более долгий прогон.

## Что НЕ проверено

- Фактическое восстановление на «чистую» машину (без corepack-кэша, `%LOCALAPPDATA%\pnpm` и DSH-чекаута).
- Что `dsh plugin --profile web install` в восстановленном профиле действительно возвращает все 11 bundle-записей (команда **не запускалась**: она тянет пакеты из сети и меняет drill-каталог).
- Строка `mywork-controller` в живом профиле `web` — её там нет и не должно быть (см. выше).

---

## Переисполнение 2026-10-03 (R-47) — см. `foundation-47-stage0-restore.md` §B

Drill прогнан на снимке `dsh-profile-2026-10-03` в изолированном корне `.tmp\stage0-restore-drill` (1668 файлов,
368,03 МБ, `robocopy exit 3` из-за маркера владения, `FAILED: 0`). `DSH_HOME=<drill>` + `--dump-config` → exit 0,
**13** скипнутых бандлов и 13 `patch: entry "<id>" not found` (было 11 при 11 бандлах — число выросло вместе с профилем);
вывод «снимка без `node_modules` недостаточно» подтверждён. `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js`
→ **`verify:profile: PASS`** (16,3 с, `user profile untouched (3 fingerprint(s) unchanged)`); SHA256 живого
`cordis.patch.yml` `D54CBE2C…A832A4B2` до и после всех прогонов совпал. Ручной `$env:npm_execpath` больше не нужен:
`scripts/lib/process.mjs` сам находит corepack. `dsh.cmd` для этих прогонов не годится — внутри `call pnpm`
уходит в сломанный PATH-шим. Действующая процедура — `docs/ops/profile-restore.md`.