# Восстановление профиля DSH из внешней копии

Процедура восстановления живого профиля `C:\Users\Dmitry\.dsh` из копии, снятой
шагом F-02 в `<BACKUP_ROOT>\dsh-profile-<YYYY-MM-DD>` (в этой кампании —
`C:\DSH-Backups\dsh-profile-2026-09-27`).

Проверено drill'ом F-03: копия снимается и восстанавливается без потерь по числу
файлов (1230/1230) и по SHA256 критичного файла; **одной копии недостаточно для
загрузки** — после восстановления нужно переустановить зависимости профиля.

## Что в копии есть и чего нет

| Есть | Нет (исключено при копировании) |
| --- | --- |
| `profiles/<name>/package.json`, `cordis.yml`, `cordis.patch.yml`, `patches/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | `logs/`, `**/node_modules/`, `*.log` |
| `settings.yaml.imported`, `.credentials.yaml`, `sessions/`, `storages/`, `task-board/`, `skills/`, `dsh-usage/`, `attachments/` | — |

`node_modules` не копируется сознательно: он воспроизводится установкой плагинов.
Следствие: **восстановленный профиль не запустится, пока плагины не установлены
заново** — DSH сообщит `cannot resolve profile bundle "<name>" … run 'dsh plugin
--profile <name> install' if its dependency is not installed`.

## Процедура

1. **Остановить DSH** (все сессии и CLI), чтобы никто не писал в профиль.
2. **Сохранить текущий профиль** (страховка): переименовать
   `C:\Users\Dmitry\.dsh` в `C:\Users\Dmitry\.dsh.before-restore-<date>`
   (не удалять: откат = вернуть каталог на место).
3. **Развернуть копию**:
   ```powershell
   robocopy 'C:\DSH-Backups\dsh-profile-2026-09-27' 'C:\Users\Dmitry\.dsh' /E /R:1 /W:1
   ```
   Для robocopy код возврата `0..7` — успех, `>=8` — ошибка.
4. **Сверить критичный файл**:
   ```powershell
   (Get-FileHash 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Algorithm SHA256).Hash
   # ожидаем D3AAACF053C854CB6577DA4CDE7FBF881AFF4A6A27999F5CAFD4390029E07595 (копия 2026-09-27)
   ```
5. **Переустановить зависимости профиля** (обязательный шаг, иначе bundle-записи
   скипаются):
   ```powershell
   dsh plugin --profile web install
   ```
6. **Проверить композицию до запуска UI**:
   ```powershell
   dsh --profile web --dump-config | Select-String -Pattern 'id: |name: '
   ```
   Ожидаем строки плагинов без предупреждений `skipping profile bundle` и без
   `patch: entry "<id>" not found`.
7. **Запустить DSH** и проверить, что Web UI поднялся, а строки плагинов
   смонтированы. Проверка «строка `mywork-controller` смонтирована» применима
   только к профилю, куда установлен `@dsh-mywork/controller`; в живом профиле
   `web` этого бандла нет — эквивалентная проверка выполняется на изолированном
   профиле: `node scripts/verify-profile.mjs` (см. ниже).

## Проверка процедуры без касания живого профиля

```powershell
# 1. Копия снимка в одноразовый каталог + изолированный дом
robocopy 'C:\DSH-Backups\dsh-profile-2026-09-27' "$env:TEMP\dsh-restore-drill" /E /R:1 /W:1
$env:DSH_HOME = "$env:TEMP\dsh-restore-drill"
dsh --profile web --dump-config

# 2. Полный boot-тест на изолированном профиле (создаёт свой дом в .tmp)
$env:npm_execpath = "$env:LOCALAPPDATA\node\corepack\v1\pnpm\12.4.2\bin\pnpm.mjs"
node scripts/verify-profile.mjs      # ожидаем: verify:profile: PASS
```

`scripts/verify-profile.mjs` сам хэширует `profiles/web/package.json`,
`profiles/web/cordis.patch.yml` и `settings.yaml` живого профиля до и после
прогона и печатает `ok user profile untouched`.

## Ограничения и грабли этой машины

- **Обычный `pnpm` сломан** (см. `.work/plan-v0.3/evidence/foundation-01-pnpm.md`):
  запускать `corepack pnpm -r run <script>`. Скрипт, который сам вызывает `pnpm`
  (`scripts/verify-profile.mjs` через `scripts/lib/process.mjs:52-58`), берёт
  `pnpm` из `PATH` и упадёт на сломанном шиме — ему нужен shell-free entry:
  `$env:npm_execpath = "$env:LOCALAPPDATA\node\corepack\v1\pnpm\12.4.2\bin\pnpm.mjs"`.
- Шаг 3 (`robocopy` на живой профиль) **перезаписывает** файлы профиля; строки и
  значения, добавленные после снятия копии, будут потеряны. Поэтому шаг 2 —
  обязательная страховка.
- Копия снята во время работы DSH, то есть **не атомарна**; перед восстановлением
  полезно сверить число файлов и SHA256 критичных файлов (шаг 4).
- `.credentials.yaml` лежит в копии в открытом виде: каталог копий должен быть
  защищён так же, как профиль (в этой кампании — локальный `C:\DSH-Backups`).