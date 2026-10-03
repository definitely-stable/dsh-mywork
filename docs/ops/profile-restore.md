# Восстановление профиля DSH из внешней копии

Процедура восстановления живого профиля `C:\Users\Dmitry\.dsh` из копии, снятой шагом F-02
в `<BACKUP_ROOT>\dsh-profile-<YYYY-MM-DD>`. Действующий снимок —
**`C:\DSH-Backups\dsh-profile-2026-10-03`** (1668 файлов, 368,03 МБ); прежний
`C:\DSH-Backups\dsh-profile-2026-09-27` снимался с профиля из 14 бандлов и для текущего рантайма устарел.

Проверено drill'ом F-03 (2026-10-03, рантайм `dsh-v0.2.0-rc.2`): копия снимается и восстанавливается без потерь
(1668/1668 файлов, SHA256 критичных файлов совпадают), но **одной копии недостаточно для загрузки** — после
восстановления нужно переустановить зависимости профиля. Прогон `node scripts/verify-profile.mjs` на изолированном
профиле даёт `verify:profile: PASS`, а живой профиль за все прогоны не изменился (SHA256 `cordis.patch.yml`
`D54CBE2C…A832A4B2` до и после). Отчёт: `.work/plan-v0.3/evidence/foundation-47-stage0-restore.md` §A–§B.

## Что в копии есть и чего нет

| Есть | Нет (исключено при копировании) |
| --- | --- |
| `profiles/<name>/package.json`, `cordis.yml`, `cordis.patch.yml`, `patches/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | `logs/`, `**/node_modules/`, `*.log` |
| `settings.yaml.imported`, `.credentials.yaml`, `sessions/`, `storages/`, `task-board/`, `skills/`, `dsh-usage/`, `attachments/` | — |

`node_modules` не копируется сознательно: он воспроизводится установкой плагинов. Следствие: **восстановленный
профиль не запустится, пока плагины не установлены заново** — DSH сообщит `cannot resolve profile bundle "<name>" …
run 'dsh plugin --profile <name> install' if its dependency is not installed`. На снимке 2026-10-03 так скипаются
**13** бандлов из 18 (замер drill'а; на снимке 2026-09-27 скипались 11 из 14 — число растёт вместе с профилем).

`node_modules` профиля — единственный каталог, который нельзя копировать «как есть»: установленный бандл не
копируется значением (встречаются junction'ы, обход которых по циклу ломает копию). На снимке 2026-10-03
reparse-точек в копируемом множестве **0**, поэтому `robocopy /E` безопасен; если в следующий раз инвентарь покажет
ссылки, копировать их значением нельзя — только `dsh plugin --profile <name> install`.

## Процедура

1. **Остановить DSH** (все сессии и CLI), чтобы никто не писал в профиль.
2. **Сохранить текущий профиль** (страховка): переименовать
   `C:\Users\Dmitry\.dsh` в `C:\Users\Dmitry\.dsh.before-restore-<date>`
   (не удалять: откат = вернуть каталог на место).
3. **Развернуть копию**:
   ```powershell
   robocopy 'C:\DSH-Backups\dsh-profile-2026-10-03' 'C:\Users\Dmitry\.dsh' /E /R:1 /W:1
   ```
   Для robocopy код возврата `0..7` — успех, `>=8` — ошибка.
4. **Сверить критичные файлы** (не только один — профиль меняется и после снятия копии):
   ```powershell
   (Get-FileHash 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Algorithm SHA256).Hash
   # ожидаем D54CBE2C8ABB4D68AC479C006A9D1F8570F7C2AB37CE18E57F745FA5A832A4B2 (снимок 2026-10-03)
   ```
   `task-board\ledger-v2.json` сверять **не по хэшу, а по `revision`**: плагин доски переписывает
   `scheduler.lastTickAt` на тиках, и тот же `revision` даёт другой SHA256 через минуты.
5. **Переустановить зависимости профиля** (обязательный шаг, иначе bundle-записи скипаются):
   ```powershell
   dsh plugin --profile web install
   ```
6. **Проверить композицию до запуска UI**:
   ```powershell
   dsh --profile web --dump-config | Select-String -Pattern 'id: |name: '
   ```
   Ожидаем строки плагинов без предупреждений `skipping profile bundle` и без `patch: entry "<id>" not found`.
7. **Запустить DSH** и проверить, что Web UI поднялся, а строки плагинов смонтированы. Право доски должно быть
   `workspace-write`: правка `sessionDefaultPermission` в `profiles\web\cordis.patch.yml` применяется
   **живьём** — ряд `hmr` базового бандла наблюдает за файлом патча
   (`packages/boot/hmr/src/index.ts:215,235`), перезапуск не нужен. Проверка «строка `mywork-controller`
   смонтирована» применима только к профилю, куда установлен `@dsh-mywork/controller`; в живом профиле `web`
   этого бандла нет — эквивалентная проверка выполняется на изолированном профиле: `node scripts/verify-profile.mjs`.

## Проверка процедуры без касания живого профиля

```powershell
# 1. Копия снимка в одноразовый каталог + изолированный дом
robocopy 'C:\DSH-Backups\dsh-profile-2026-10-03' 'H:\Repo\DSH-MyWork\.tmp\stage0-restore-drill' /E /R:1 /W:1
$env:DSH_HOME = 'H:\Repo\DSH-MyWork\.tmp\stage0-restore-drill'
node 'C:\Reposit\deepseek-harness\deepseek-harness\apps\cli\lib\bin.js' --profile web --dump-config
# ожидаем exit 0 и 13 предупреждений `skipping profile bundle` — это и есть доказательство неполноты снимка

# 2. Полный boot-тест на изолированном профиле (создаёт свой дом в .tmp)
node scripts/verify-profile.mjs --dsh-bin 'C:\Reposit\deepseek-harness\deepseek-harness\apps\cli\lib\bin.js'
# ожидаем: verify:profile: PASS
```

`scripts/verify-profile.mjs` сам хэширует `profiles/web/package.json`, `profiles/web/cordis.patch.yml` и
`settings.yaml` живого профиля до и после прогона и печатает `ok user profile untouched`; он же сверяет право
строки доски в живом профиле (R-51).

`$env:npm_execpath` больше задавать не нужно: `scripts/lib/process.mjs` сам предпочитает shell-free
`npm_execpath`, затем `pnpm.cjs` рядом с ним, затем **corepack**. Обычный `pnpm` с PATH по-прежнему сломан
(см. `.work/plan-v0.3/evidence/foundation-01-pnpm.md`).

## Ограничения и грабли этой машины

- **`dsh.cmd` для этих прогонов не годится**: `C:\Users\Dmitry\.dsh\bin\dsh.cmd` заканчивается
  `call pnpm --dir <checkout> dsh …`, то есть уходит в сломанный PATH-шим `pnpm`. Использовать прямой вход CLI
  `node <checkout>\apps\cli\lib\bin.js` (он же передаётся в `--dsh-bin`).
- Шаг 3 (`robocopy` на живой профиль) **перезаписывает** файлы профиля; строки и значения, добавленные после
  снятия копии, будут потеряны. Поэтому шаг 2 — обязательная страховка.
- Копия снята во время работы DSH, то есть **не атомарна**; перед восстановлением полезно сверить число файлов
  и SHA256 критичных файлов (шаг 4).
- `.credentials.yaml` лежит в копии в открытом виде: каталог копий должен быть защищён так же, как профиль
  (в этой кампании — локальный `C:\DSH-Backups`). По этой же причине drill-каталог удаляется сразу после проверки,
  а не остаётся во `%TEMP%`.
- Проверка `--dump-config` на **живом** профиле не выполняется: она идемпотентно перезаписывает
  `profiles\web\cordis.yml` (меняет mtime). Все прогоны — только с `DSH_HOME`, указывающим на копию.
