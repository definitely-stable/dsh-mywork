# 20 — Шаги фундамента: этапы 0–3 (`F-01`…`F-60` + `F-61`, `F-62`, `F-63`, `F-64`)

**Владелец файла:** `plan-foundation`. **Кампания:** v0.3, 2026-09-26.
**Источники:** `00-RECON.md` §1.2 (шаблон шага), §2 (канон этапов), §2.2 (резерв ID карточек), §5 (доказательность); `.work/analysis/2026-09-26/FINAL-REPORT.md` §8.2 (P1–P25), §9.1 (правки карточек), §9.2, §9.3, §10 (этапы 0–4).

Этот файл — **исполняемая** часть плана: по любому шагу можно работать, не открывая отчёт. Каждый шаг — 2–5 минут, с точными путями, командой и ожидаемым выводом.

---

## 0. Как читать этот файл

1. **Канонический runner (R-06).** Все команды `pnpm` ниже выполняются **только** как `corepack pnpm -r run <script>` — **обязательно с `-r`**. `corepack pnpm run <script>` падает за ~1 с из-за вложенного bare `pnpm` 11.7.0 из `.bin` DSH-чек-аута (проверено: `-r` → EXIT=0, 12 пакетов). Точечные проверки — `node --test --test-isolation=none <файл>`, `node_modules\.bin\tsc.cmd --noEmit -p <tsconfig>`, `node <tsdown-entry>`. Канон — `01-MASTER-PLAN.md` §15.1.
2. **`~` перед номером строки** означает «строка не проверена лично»; такой факт вынесен в §7.
3. **Шаг 0 внутри шага** («подтвердить, что …») появляется там, где утверждение опирается на непроверенный API. Это требование §5.2 брифа: план не выдаётся за факт.
4. **Порядок.** Этапы 0→3 обязательны. Внутри этапа шаги, не связанные общим файлом, распараллеливаются. Явные зависимости указаны в поле «Зависит».
5. **Карточки.** `MW-056`…`MW-059` — платформенный фундамент (`bd`-seam, тест/адаптер Beads, composition root, реестр миграций + journal + атомарность). `MW-060`…`MW-064` — публикуемость/peer/CI, бюджет и шаги, retention, UI-пакет, резолвер. Резерв по `00-RECON.md` §2.2.
6. **Мутирующие шаги.** F-02, F-04, F-05, F-07, F-10, F-11, F-26 требуют записи за пределами репозитория либо git-мутации. В этой кампании они **не выполнялись** — только описаны (границы кампании, §5.3 брифа).

### 0.1. Сводная карта шагов

| Этап | Шаги | Тема | Гейт этапа |
|---|---|---|---|
| **0** — разблокировка и гигиена | F-01…F-12 + **F-61, F-62** | профиль, права, `superseded`, правило `done`, копия профиля, безопасная чистка, runner, пресет `cordis`, масштаб гейта прав | F-12, затем F-61, F-62 |
| **1** — проверяемость существующего | F-13…F-27 + **F-63** | `bd`-seam, backend без skip, реестр миграций, journal, CI+тег, производный INDEX, сверка леджеров | F-27 |
| **2** — соединение подсистем | F-28…F-46 | composition root, атомарность, WAL, durable jobs, retention/VACUUM/сканеры-механика, boundary, model availability, session conformance | F-46 |
| **3** — контракты и решения | F-47…F-60 + **F-64** | peer-контракт, публикуемость, бюджет/шаги поверх `token-meter`, наблюдаемость через `productTelemetry` (**OTel не строим** — D16), запреты worker-поверхности, UI-пакет, гейт цитат плана | F-60, затем F-64 |

### 0.2. Граф зависимостей (только существенные рёбра)

```text
F-01 ─┬─> все команды pnpm (F-12, F-18…F-27, F-46, F-60)
      └─> F-23, F-24, F-25 (pack / CI)
F-04 ──> F-61, F-62              (гейт прав → пресет и масштаб блокировки)
F-12 ──> F-61, F-62              (этап 0 закрывается только вместе с ними)
F-04 ──> F-05 ──> F-06           (гейт прав профиля)
F-08 ──> F-09 ──> F-27           (правило done → сверка леджеров)
F-13 ──> F-14 ──> F-15 ──> F-16 ──> F-17   (bd-seam → тесты backend)
F-18 ──> F-19 ──> F-20           (реестр миграций → запрет открытия → journal verify)
F-20 ──> F-63                     (journal verify → аллокатор версий; разблокирует E-04/E-19/E-28/E-34/E-37, B-12)
F-63 ──> F-37, F-40               (аллокатор → номера для background_job и retention-триггеров)
F-18 ──> F-29 ──> F-30 ──> F-31 ──> F-32   (миграции → composition root)
F-29 ──> F-35 ──> F-33, F-34     (открытие store → SQLite-настройки/атомарность)
F-35 ──> F-36 ──> F-37           (store → durable jobs)
F-35 ──> F-38 ──> F-39 ──> F-40  (store → retention → VACUUM → BLOB)
F-31 ──> F-45, F-51              (composition root → conformance, бюджет)
F-47 ──> F-48 ──> F-49 ──> F-50  (peer-контракт → приватность → матрица)
F-48, F-50 ──> F-64              (гейт цитат и запись дельты)
F-51 ──> F-52 ──> F-53           (мост token-meter → значения → шаги)
```

---

## 1. Этап 0 — разблокировка и гигиена (часы, без кода продукта)

Гейт этапа: **F-12**. Пока F-04 не исполнен, 12 карточек `MW-044`…`MW-055` формально запускаемы, но фактически падают на подтверждении прав.

---

#### F-01 · Рабочий bootstrap `pnpm`: диагноз и канонический runner

- **Карточка:** MW-041 (правка: «записать рабочий bootstrap `pnpm`»), зависит от —.
- **Зависит:** — · **Разблокирует:** все команды `pnpm` в этом файле.
- **Усилие:** S · **Риск:** низкий · **Откат:** не требуется (только запись в `README`/`docs`).
- **Цель:** зафиксировать одну команду запуска пакетного менеджера, которая работает сегодня, и записать причину поломки обычного `pnpm`.
- **Файлы:** Modify `README.md` (раздел «Как запускать», точные строки не проверены — `~`); Create `.work/plan-v0.3/evidence/foundation-01-pnpm.md` (запись диагноза).
- **Проверенные факты (эта кампания, Windows, PowerShell):**
  1. `pnpm --version` → **EXIT=1**, без вывода версии; stderr дословно:
     `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\f6c04c51569ad17329595648978a95bb61c85b87174d5701d9eef91259f69e26\bin\\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command, operable program or batch file.`
  2. `where.exe pnpm` → первым идёт `C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm`, то есть **`.bin` DSH-checkout'а перекрывает** глобальные установки. Его `pnpm.CMD` запускает `node "%~dp0\..\pnpm\bin\pnpm.mjs"` (pnpm 11.7.0).
  3. Явный запуск этого же файла (`& 'C:\Reposit\...\.bin\pnpm.CMD' --version`) воспроизводит ту же ошибку, **EXIT=1**; прямой запуск JS-entry (`node 'C:\Reposit\...\node_modules\pnpm\bin\pnpm.mjs' --version`) — тоже **EXIT=1** с тем же текстом.
  4. Диагноз: pnpm 11.7.0 читает `packageManager: "pnpm@12.4.2"` (`package.json:8`) и переключается на копию в H:-store. У этой копии Windows-шим сломан: `H:\.pnpm-store\v11\links\@\pnpm\12.4.2\<hash>\bin\pnpm.CMD` — **52 байта**, содержимое ровно:
     ```
     @SETLOCAL
     @"%~dp0\..\node_modules\pnpm\pnpm"   %*
     ```
     Цель `node_modules\pnpm\pnpm` — POSIX shell-скрипт (2051 байт, `#!/bin/sh`), а не `pnpm.exe`; `cmd.exe` такой файл исполнить не может. Заголовок `pnpm.exe` в этой копии отсутствует (в каталоге лежат `pn`, `pnpm`, `pnpx`, `pnx` — все shell-скрипты).
  5. **Работающая альтернатива, проверена:** `corepack pnpm --version` → печатает `12.4.2`, **EXIT=0** (corepack 0.35.0 докачивает `win32-x64` бинарь при первом вызове).
- **Шаги:**
  1. Подтвердить первый элемент PATH: `where.exe pnpm` → ожидаем первой строкой `C:\Reposit\deepseek-harness\deepseek-harness\node_modules\.bin\pnpm`.
  2. Подтвердить поломку: `pnpm --version` → `EXIT=1` и текст про `H:\.pnpm-store\...\node_modules\pnpm\pnpm`.
  3. Подтвердить обход: `corepack pnpm --version` → `12.4.2`, `EXIT=0`.
  4. Проверить, что обход годится для реальной задачи: **`corepack pnpm -r run typecheck`** → ожидаем `EXIT=0` (12 пакетов). **Обязательно с `-r`:** `corepack pnpm run typecheck` (без `-r`) падает за ~1 с из-за вложенного bare `pnpm` 11.7.0 из `.bin` DSH-чек-аута — это дефект R-06. Если `EXIT≠0` — остановиться и зафиксировать в evidence, не «дожимать».
  5. Записать в `README.md` строку: «Пакетный менеджер: `corepack pnpm -r run <script>` (обычный `pnpm` сломан, см. `.work/plan-v0.3/evidence/foundation-01-pnpm.md`)».
- **Гейт (готово когда):** `corepack pnpm -r run typecheck; $LASTEXITCODE` → `0` (именно с `-r`; без `-r` ожидаем `EXIT=1` — это и есть проверка, что выбран верный runner)
- **Evidence в отчёт:** вывод `where.exe pnpm`; вывод `pnpm --version` (stderr); вывод `corepack pnpm --version`; `Get-Content ...\bin\pnpm.CMD`; diff `README.md`.
- **Риски:** `corepack` тянет бинарь из сети → на изолированной машине шаг не сработает. Резерв (описать, не исполнять): `npm i -g pnpm@12.4.2` даёт `%APPDATA%\npm\node_modules\pnpm\pnpm.exe`; либо `manage-package-manager-versions=false` в `.npmrc` (потребует сверки `pnpm-lock.yaml`, **не рекомендуется** — смена major).
- **Открытая проверка:** какой именно процесс печатает ошибку (pnpm 11.7.0 self-switch vs `@pnpm/exe` из PATH `%LOCALAPPDATA%\pnpm\...\node-gyp-bin`) — цепочка доказана до «JS-entry 11.7.0 → H:-store 12.4.2», но не до строки исходника pnpm. Для плана это несущественно: фикс не в pnpm, а в выборе runner'а.

---

#### F-02 · Внешняя копия живого профиля `C:\Users\Dmitry\.dsh`

- **Карточка:** MW-038 (правка: Doctor/восстановление), новая `MW-07x` не нужна.
- **Зависит:** — · **Усилие:** S · **Риск:** низкий (только чтение профиля) · **Откат:** удалить копию.
- **Цель:** у единственного невосстановимого ресурса контура (RT-9) появляется копия вне `$DSH_HOME`.
- **Файлы:** Create `<BACKUP_ROOT>\dsh-profile-<YYYY-MM-DD>\` (вне репозитория, вне профиля); Create `.work/plan-v0.3/evidence/foundation-02-profile-backup.md`.
- **Проверенные факты:** профиль не под git; MyWork знает путь (`packages/storage/src/layout.ts:76-93`, `scripts/verify-profile.mjs:5-10` — «The user's own profile is never addressed»). Размер профиля не измерен (`~`) — измерить шагом 1.
- **Шаги:**
  1. Измерить объём: `Get-ChildItem 'C:\Users\Dmitry\.dsh' -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum` → ожидаем число файлов и МБ (записать).
  2. Проверить, что цель копии вне профиля и вне репозитория: `Test-Path $env:BACKUP_ROOT` → `True`; `$env:BACKUP_ROOT -notlike 'C:\Users\Dmitry\.dsh*'` → `True`.
  3. Снять копию **без** `logs/` и `node_modules/` (они воспроизводимы): `robocopy 'C:\Users\Dmitry\.dsh' "$env:BACKUP_ROOT\dsh-profile-<date>" /E /XD logs node_modules /XF *.log /R:1 /W:1` → ожидаем `Exit Code: 0..7` (robocopy: ≥8 — ошибка).
  4. Записать хэши критичных файлов профиля: `Get-FileHash 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml'` → ожидаем SHA256 (записать в evidence).
  5. Проверить полноту копии по числу файлов: сравнить `(Get-ChildItem ... -Recurse -File).Count` источника и копии → ожидаем равенство без `logs`/`node_modules`.
- **Гейт (готово когда):** `Test-Path "$env:BACKUP_ROOT\dsh-profile-<date>\profiles\web\cordis.patch.yml"` → `True`
- **Evidence:** вывод `Measure-Object`; команда robocopy + exit code; SHA256 `cordis.patch.yml`; число файлов до/после.
- **Риски:** копирование профиля **на живой системе** во время работы DSH даёт несогласованный снимок. Митигация: копия делается при остановленном DSH либо помечается «best effort, не атомарная»; для v0.3 достаточно (профиль почти статичен).
- **Не делать:** не копировать `node_modules` (109 МБ в репозитории; в профиле воспроизводится `dsh plugin`), не трогать сам профиль.

---

#### F-03 · Процедура восстановления профиля и её проверка на копии

- **Карточка:** MW-038.
- **Зависит:** F-02 · **Усилие:** S · **Риск:** низкий · **Откат:** удалить тестовый профиль.
- **Цель:** восстановление не «на словах»: процедура прогнана на изолированной копии и подтверждена загрузкой.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-03-profile-restore.md`; Create `docs/ops/profile-restore.md` (`~`, если каталога `docs/` нет — создать; в этой кампании файл не создавался).
- **Проверенные факты:** `scripts/verify-profile.mjs` уже изолирует дом через `DSH_HOME` и хэширует реальный профиль до/после (`scripts/verify-profile.mjs:1-10`); это готовый инструмент проверки, второй строить не нужно.
- **Шаги:**
  1. Записать процедуру списком: остановить DSH → `robocopy <backup>\dsh-profile-<date> 'C:\Users\Dmitry\.dsh' /E` → сверить SHA256 `profiles\web\cordis.patch.yml` → запустить `dsh` → проверить, что строка `mywork-controller` смонтирована.
  2. Проверить процедуру **без** касания живого профиля: скопировать снимок в `$env:TEMP\dsh-restore-drill`, выставить `$env:DSH_HOME` на него.
  3. Прогнать `node scripts/verify-profile.mjs --dsh-bin dsh` → ожидаем `verify:profile: PASS` (отчёт фиксирует этот результат как достигнутый: `FINAL-REPORT` §8.1, `10,5 с, изолированный DSH_HOME`).
  4. Проверить, что живой профиль не изменился: повторный `Get-FileHash 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml'` → SHA256 равен записанному в F-02.
- **Гейт (готово когда):** sha256 живого `cordis.patch.yml` до и после drill совпадают **и** `verify:profile` → `PASS`
- **Evidence:** два значения SHA256; вывод `verify:profile`; путь drill-каталога.
- **Риски:** drill может случайно адресовать живой дом, если `DSH_HOME` не установлен в дочернем процессе. Митигация: шаг 4 — обязательная проверка хэша живого профиля.

---

#### F-04 · Гейт прав: поднять `sessionDefaultPermission` на уровень строки

- **Карточка:** MW-054 (правка), `FINAL-REPORT` §10 (0.1), §4.4.
- **Зависит:** F-02 · **Разблокирует:** F-05, F-06; 12 карточек `MW-044`…`MW-055`.
- **Усилие:** S (одна строка) · **Риск:** низкий · **Откат:** revert одной строки в yml.
- **Цель:** плагин доски получает `workspace-write` вместо фактического `read-only`.
- **Файлы:** Modify `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35` — перенести ключ с строки **25** на уровень строки **22** (`config:` строки `web-ui-task-board`).
- **Проверенные факты (кто читает и почему сейчас не работает):**
  1. Сейчас: строка 22 `config:` → строка 24 `plugin:` → строка 25 `config: { sessionDefaultPermission: workspace-write }`. То есть значение лежит в **`config.config`**.
  2. Оболочка агрегата срезает `plugin` и передаёт плагину **все остальные ключи строки**: `web-all/lib/shell-CKmkldkq.js:1094` на установленной **0.4.4** (на 0.4.3 — `shell-DWqLngib.js:1088`) — `function familyConfigOf(row) { const { plugin: _spec, ...family } = row; … }`.
  3. Плагин читает **верхний уровень** своего config: `dsh-client-ui-task-board/lib/index.js:6089` на **0.4.4** (на 0.4.3 — `:5568`) — `sessionDefaultPermission: config?.sessionDefaultPermission ?? "read-only"`. Схема с дефолтом — там же `:5918` (было `:5397`).
  4. Следствие: `config.sessionDefaultPermission` = `undefined` → фактический режим `read-only` (дефолт платформы тоже `read-only`: `sandbox-policy/src/index.ts:113`).
  5. Версия плагина в живом профиле — **0.4.4** (`package.json` пакета `@linxin666/dsh-client-ui-task-board`; в кампании v0.3 было 0.4.3 — актуализация 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8). **R-47: на 0.4.4 дефект вернулся** (`cordis.patch.yml:25` — ключ снова вложен), поэтому шаг **переисполняется**, а факты 1–3 выше перемерены на 0.4.4.
- **Шаги:**
  1. Снять копию файла: `Copy-Item ...\cordis.patch.yml ...\cordis.patch.yml.bak-<date>` → ожидаем `True` на `Test-Path`.
  2. Подтвердить текущую вложенность: `Get-Content ...\cordis.patch.yml | Select-Object -Skip 19 -First 16` → ожидаем строку 25 вида `config: { sessionDefaultPermission: workspace-write },`.
  3. Правка: удалить строку 25; в блок `config:` строки 22 (рядом с `plugin:` строки 24 и `announceToAgent:` строки 26) добавить `sessionDefaultPermission: workspace-write,`.
  4. Проверить синтаксис YAML до перезапуска: `dsh --version` (или любой запуск, читающий профиль) → `EXIT=0` без ошибок загрузчика; при ошибке — вернуть `.bak`.
- **Гейт (готово когда):** в файле `sessionDefaultPermission` находится на **одном** уровне с `plugin`, и `Select-String -Path ...\cordis.patch.yml -Pattern 'sessionDefaultPermission'` возвращает ровно **1** совпадение на строке `~25`.
- **Evidence:** diff yml; вывод `Select-String`; вывод перезапуска DSH.
- **РИСК КАМПАНИИ:** это правка живого профиля. По §5.3 брифа шаг **описан, но не выполнялся**. Исполнитель обязан сначала запросить у владельца подтверждение и только потом править.
- **Риски:** ошибка YAML ломает загрузку всего профиля → все строки не монтируются. Митигация: `.bak` рядом с файлом + шаг 4 до перезапуска.
- **Зависимость от D-решений:** нет. Это дефект, а не выбор.

---

#### F-05 · Удалить мёртвые ключи `autoRun*` из строки `web-ui-task-board`

- **Карточка:** MW-054 (правка: «три фактические ошибки… "autoRunTodo выключен" → нет ключей `autoRun*` и нет per-task расписаний»).
- **Зависит:** F-04 (правится тот же блок) · **Усилие:** S · **Риск:** низкий · **Откат:** revert yml.
- **Цель:** из строки исчезают ключи, которые **0.4.4** не читает (и 0.4.3 не читала), но которые создают ложную картину защиты от runaway-запусков. **R-47: на установленной 0.4.4 семь ключей `autoRun*` вернулись в живой профиль (`cordis.patch.yml:27-33`) — шаг переисполняется, а не подтверждается.**
- **Файлы:** Modify `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:27-33`.
- **Проверенные факты:**
  1. Вложенная строка 25 `config` — единственное место, где **0.4.4** ищет `sessionDefaultPermission`; `enabled`, `announceToAgent`, `preventIdleSleep`, `maxSubtaskDepth`, `teamProvider` — читаются на верхнем уровне (`dsh-client-ui-task-board/lib/index.js:6082-6092` на 0.4.4; на 0.4.3 те же чтения были `:5559-5571`).
  2. Ключей `autoRun*` в коде **0.4.4** не читает никто: точных имён (`autoRunTodo`, `autoRunPaused`, `autoRunMaxConcurrent`, `autoRunMaxRetries`, `autoRunStallMinutes`, `autoRunMaxPerHour`, `autoRunMaxPerDay`) нет ни в одном пакете профиля, кроме локализационного моста `dsh-locale-ru-plugins` (**14** вхождений — подписи, не чтение конфига); в `dsh-client-ui-task-board/lib/index.js` и `lib/client.js` строка `autoRun` — **0 совпадений**; в `dsh-web-all/lib/*.js` — **2** совпадения, и оба не конфиг-ключи, а клиентский метод к маршруту `/auto/run` (`lib/client.js:42389,42774`; сам маршрут — `dsh-session-archive/lib/index.js:2724`). Проверено `Select-String` по `C:\Users\Dmitry\.dsh\profiles\web\node_modules` (2026-10-03) — то есть команда шага 1 остаётся верной на 0.4.4.
  3. Значит, `autoRunTodo`, `autoRunPaused`, `autoRunMaxConcurrent`, `autoRunMaxRetries`, `autoRunStallMinutes`, `autoRunMaxPerHour`, `autoRunMaxPerDay` (строки 27–33) — мёртвый груз.
- **Шаги:**
  1. Подтвердить 0 совпадений: `Select-String -Path '...\dsh-client-ui-task-board\lib\*.js' -Pattern 'autoRun'` → пусто (0 строк).
  2. Удалить строки 27–33 из блока `web-ui-task-board`.
  3. Проверить, что строка всё ещё YAML-валидна и содержит ожидаемые ключи: `config:` с `plugin`, `sessionDefaultPermission`, `announceToAgent` → ровно 3 ключа.
- **Гейт (готово когда):** `Select-String -Path ...\cordis.patch.yml -Pattern 'autoRun'` → **0 совпадений**; загрузка профиля без ошибок.
- **Evidence:** diff; вывод `Select-String` до (7 строк) и после (0).
- **РИСК КАМПАНИИ:** живой профиль — шаг описан, не выполнялся.
- **Риски:** удаление ключей, которые владелец считает защитой, меняет ожидания. Митигация: записать в `30-CARD-EDITS.md` (владелец — `card-ledger`), что защиты не было.
- **Не делать:** не заменять `autoRun*` на новые ключи «на всякий случай» — per-task расписаний в 0.4.3 не было, но **на 0.4.4 они есть** (`dsh-client-ui-task-board/lib/index.js` — регион `src/core/schedule.ts`, поле `schedule` у записи задачи `:1675,2228`; живой леджер `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json` несёт ключ `scheduler`, карточек с расписанием — **0** из 55) — если расписания нужны, это отдельное решение (D06/роадмап), а не правка гигиены.

---

#### F-06 · Доказать, что гейт прав снят: карточка без ручного подтверждения запускается

- **Карточка:** `FINAL-REPORT` §10 (0.1, «12 карточек MW-044…MW-055 не запускаются»).
- **Зависит:** F-04, F-05 · **Усилие:** S · **Риск:** средний (реальный запуск тратит квоту).
- **Цель:** вместо «yml поправлен» — наблюдаемое доказательство, что привязка `workspace-write` из дефолта сессии больше не требует подтверждения.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-06-permission-gate.md`.
- **Проверенные факты:** логика подтверждения живёт в `dsh-client-ui-task-board/lib/index.js:1018` (`requiresPermissionConfirmation(task, sessionDefault = DEFAULT_SESSION_PERMISSION)`; сама константа — `:957`, `DEFAULT_SESSION_PERMISSION = "read-only"`), вызовы в рантайме — `:2680` (ветка `lead`), `:2687` и `:2694` (участники), `:4715` (`permissionPending` в сводке задачи); в client-половине — `lib/client.js:4701` (`requiresPermissionConfirmation(current, snapshot.host?.sessionDefaultPermission)`). Дефолт при отсутствии — `"read-only"` (`lib/index.js:6089`, `lib/client.js:4775`). Якоря перемерены на установленной **0.4.4** (2026-10-03); прежние (0.4.3) — `:2444-2485`, `:2471`, `:4112`, `:5568`, `:4281` — сохраняются как исторический замер.
- **Шаги:**
  0. **Шаг 0 (обязателен, R-05):** `task_board_*` принимает **UUID**, а не `MW-0NN` (`task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт только в `title`). Получить id: `task_board_list { query: "MW-0NN" }` → взять `id` из единственного совпадения; **дальше использовать только полученный UUID**.
  1. **Не запускать боевую задачу.** Взять карточку с `permission: workspace-write` в песочнице (например, карточку `F-12` этого плана) — или, если такой нет, создать её с `readOnly`-промптом, не тратящим квоту (`Шаг 0: подтвердить, что выбранная карточка не исполняет реальную работу`).
  2. Спросить у доски состояние привязки: `task_board_get <id>` → ожидаем `permission: workspace-write` и **отсутствие** `confirmation-required` в списке блокировок.
  3. Проверить, что до правки было иначе: в evidence зафиксировать, что при `sessionDefaultPermission = read-only` та же карточка даёт «confirmation required» (по коду `lib/index.js:2680`, `:2694`; на 0.4.3 — `:2471`, `:2485`).
  4. Записать вывод: доска при `workspace-write`-привязке запускается без человеческого подтверждения.
- **Гейт (готово когда):** `task_board_get <id>` → строка привязки содержит `workspace-write` и **не** содержит `confirmation-required`.
- **Evidence:** вывод `task_board_get` (или скрин текста); ссылка на строки `lib/index.js:2680-2694`, `:6089` (0.4.4; на 0.4.3 — `:2444-2485`, `:5568`).
- **Риски:** доказательство требует запуска → расход квоты. Митигация: проверять на карточке-пустышке либо ограничиться чтением состояния привязки (шаг 2) без `run`.
- **Не делать:** не запускать `MW-044`…`MW-055` ради доказательства — они делают реальную работу.

---

#### F-07 · Архивировать `superseded` MW-027 и MW-035

- **Карточка:** `FINAL-REPORT` §10 (0.3); правки — в `30-CARD-EDITS.md` (владелец `card-ledger`).
- **Зависит:** — · **Усилие:** S · **Риск:** низкий · **Откат:** `restore`.
- **Цель:** карточки, снятые с исполнения, перестают быть формально запускаемыми.
- **Файлы:** Modify доска (через `task_board_manage action=archive`); Modify `.work/tasks/INDEX.md`.
- **Проверенные факты:** `MW-027.md:1` и `MW-035.md:1` содержат дословно «> **НЕ ЗАПУСКАТЬ.** Карточка снята с исполнения как superseded.»; в `INDEX.md` (вводный абзац) уже написано «Карточки со статусом `superseded` не запускаются» и «Сняты MW-027 и MW-035».
- **Шаги:**
  0. **Шаг 0 (обязателен, R-05):** `task_board_*` принимает **UUID**, а не `MW-0NN` (`task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт только в `title`). Получить id: `task_board_list { query: "MW-0NN" }` → взять `id` из единственного совпадения; **дальше использовать только полученный UUID**.
  1. Проверить, что обе карточки действительно `superseded`: `Select-String -Path .work\tasks\MW-027.md,.work\tasks\MW-035.md -Pattern 'superseded'` → 2 файла, ≥4 совпадения (заголовок + строка «Этап: … (superseded)»).
  2. Проверить, что ни одна не имеет незавершённого исполнения: `task_board_get MW-027` / `task_board_get MW-035` → нет `running` в `executions`.
  3. Архивировать: `task_board_manage { taskId: 'MW-027', action: 'archive' }`, затем то же для `MW-035` → ожидаем `ok`.
  4. Проверить, что они ушли из рабочего списка: `task_board_list { status: 'backlog' }` → `MW-027`/`MW-035` отсутствуют; `task_board_list { includeArchived: true }` → присутствуют.
- **Гейт (готово когда):** `task_board_list { status: 'backlog' }` → среди `backlog` нет `MW-027` и `MW-035`.
- **Evidence:** вывод `task_board_list` до/после; `task_board_get` обоих.
- **Риски:** архивация родителя утаскивает подзадачи. Митигация: сначала `task_board_list { parentId: 'MW-027' }` — ожидаем пусто.
- **Открытая проверка:** `task_board_manage` в этой кампании не вызывался (границы), поэтому фактическая доступность действия не подтверждена лично.

---

#### F-08 · Правило «карточка не становится `done` при `failed`-исполнении»

- **Карточка:** правка `MW-010`/`MW-011` (`FINAL-REPORT` §9.1: «ни один тест реального backend не может быть skipped в CI-профиле»); новое правило — D19.
- **Зависит:** — · **Усилие:** S · **Риск:** низкий · **Откат:** снять правило.
- **Цель:** появляется письменное правило и автоматическая проверка, которых сегодня нет.
- **Файлы:** Modify `README.md` (`~`); Modify `.work/tasks/INDEX.md` (раздел правил); Create `scripts/ledger-sync.mjs` — **нет**, скрипт создаётся в F-27 (`scripts/` в write-scope `card-ledger`/`quality`; здесь описан контракт).
- **Проверенные факты:** в `.work/tasks/tasks.json` и доске сосуществуют три источника статуса; `FINAL-REPORT` §8.1: `executions[].result` → **20 succeeded / 11 failed**; 9 падений приходятся на карточки со статусом `done`.
- **Шаги:**
  1. Сформулировать правило дословно: «Карточка переводится в `done` **только если** все её исполнения имеют `result = succeeded`. При наличии `failed` карточка остаётся `todo` либо переводится в `failed`, а в отчёте появляется строка-обоснование с `sessionId` упавшего прогона.»
  2. Записать правило в `INDEX.md` (раздел «Правила приёмки») — правка принадлежит `card-ledger`, поэтому **заявка**, а не прямая правка.
  3. Определить машинную проверку как контракт для F-27: для каждой карточки `status=done` → `executions.every(e => e.result !== 'failed')`.
- **Гейт (готово когда):** текст правила присутствует в `INDEX.md`, и F-27 воспроизводит по нему список нарушителей.
- **Evidence:** diff `INDEX.md`; список нарушителей из F-27 (ожидаемо **9**).
- **Риски:** правило задним числом делает 9 карточек «не-done» → меняется картина прогресса. Это и есть цель (`RT-8`: тихое расхождение двух authority).
- **Зависимость от D-решений:** **D19** — принято (решает владелец): «Правило «`done` требует отсутствия `failed` без строки-обоснования»; **19 done-карточек не переоткрывать**». Второе предложение — прямое ограничение объёма: правило применяется **вперёд**, ретроспективный пересмотр 19 карточек **не делается**.

---

#### F-09 · Инвентаризация `done`-карточек с `failed`-исполнениями

- **Карточка:** `FINAL-REPORT` §8.2 P9.
- **Зависит:** F-08 · **Усилие:** S · **Риск:** низкий · **Откат:** нет.
- **Цель:** известен точный список нарушителей правила `done` и по каждому — **строка-обоснование** (переоткрывать нельзя: D19).
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-09-done-failed.md`.
- **Проверенные факты:** числа `done`-падений (9) взяты из отчёта; команда получения в этой кампании **не воспроизводилась**.
- **Шаги:**
  0. **Шаг 0 (обязателен, R-05):** `task_board_*` принимает **UUID**, а не `MW-0NN` (`task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт только в `title`). Получить id: `task_board_list { query: "MW-0NN" }` → взять `id` из единственного совпадения; **дальше использовать только полученный UUID**.
  1. Прочитать леджер: `Get-Content .work\tasks\tasks.json -Raw | ConvertFrom-Json` → взять карточки со `status -eq 'done'`.
  2. Для каждой: `task_board_get <id>` → собрать `executions[]` с `result`.
  3. Оставить те, где есть `result -eq 'failed'` → ожидаем **9** (если число иное — записать фактическое и поправить `FINAL-REPORT`-цифру в evidence, не в отчёте).
  4. По каждой записать: `id`, `failedCount`, `sessionId` последнего падения, решение (`reopen` / `failed` / обоснование).
- **Гейт (готово когда):** в evidence есть таблица из N строк с `id` + `sessionId` + строкой-обоснованием, и N объяснено (совпадает с 7 либо расхождение объяснено).
- **Evidence:** таблица; команды `ConvertFrom-Json`/`task_board_get`.
- **Риски:** `tasks.json` и доска расходятся; при расхождении источником истины считать **доску** (Host — authority), расхождение — в F-27.
- **Зависимость от D-решений:** D19.

---

#### F-10 · Чистка рабочего каталога: только по явному пути, с префильтром

- **Карточка:** `FINAL-REPORT` §8.2 P13 · **Источник правок:** `evidence/lead-18-cleanup.md`.
- **Зависит:** — · **Усилие:** S · **Риск:** **высокий** (рекурсивное удаление) · **Откат:** нет для безопасного класса; для остального — нет, поэтому и «требует решения».
- **Цель:** освободить воспроизводимое и мёртвое, **не снеся живое дерево**; всё неоднозначное — вынесено на решение владельца, а не удалено «за компанию».
- **Файлы:** Delete — только перечисленные ниже точные пути. Правки кода/плана не требуется.
- **Проверенные факты (`evidence/lead-18-cleanup.md`):**
  1. **Главная опасность — junction-ловушка:** в `.tmp` **543 reparse-точки**, из них **21 ведёт за пределы `.tmp`, в живое дерево**: `v2-boundary-demo/node_modules → <repo>\node_modules`; **12×** `v2-boundary-demo/packages/*/lib → <repo>\packages\*\lib`; `mw014-review/live/{packages/{contracts,core,scheduler},tests/lib} → <repo>\...`; `mw012-mine/execution/node_modules/@dsh-mywork/* → <repo>\packages\*`.
  2. **`Remove-Item -Recurse -Force` по `.tmp\v2-boundary-demo`, `.tmp\mw014-review`, `.tmp\mw012-mine` может снести реальные `node_modules`, `packages/*/lib` и `tests/lib`** (на `powershell.exe` 5.1 рекурсия уходит в цель). Это класс инцидента «снесли HOME».
  3. **Рекурсивно безопасны только:** `.tmp/f-audit/node_modules` + `.tmp/mw012-review/node_modules` (**105,6 МБ**, 1865 файлов; откат — `pnpm install --frozen-lockfile` по `pnpm-lock.yaml` рядом); `.tmp/{mw004-verify,mw010-head-verify}` (0 реальных файлов, все junction битые — `cmd /c rmdir /s /q` сносит ссылку, не цель); нулевой мусор `.tmp/{beads-probe,pnpm-temp,test-tmp}`; `.tmp/pack`, `.tmp/pack-logs` (регенерируются).
  4. **Все три worktree грязные:** `f-audit` — 6 записей (`M packages/beads-adapter/src/runner.ts`, `M pnpm-lock.yaml`, `M tests/beads-adapter.test.mjs`, `?? .tmp-audit/`, `?? *.orig`); `mw012-review` — 30; `v2-boundary-demo` — 2. `f22dbc3` уже в истории (`merge-base --is-ancestor` exit 0). **`git worktree remove` без `--force` откажет на грязном дереве — отказ и есть префильтр.**
  5. **`.rar` (41,4 МБ, 212,8 МБ / 4592 файла внутри) — единственный экземпляр** для `.tmp/mw008-verify/**` (4608 записей) и `.tmp/msg-{1..4}-*.txt`. Вне git и **не в `.rar`**: `.dsh/skills` (4 скилла), `.beads/embeddeddolt/**` + `.beads/backup/*.darc`.
  6. **Объёмы:** каталог 472,2 МБ / 8028 файлов; `.tmp` 178,2 МБ / 3968; `node_modules` 109,7 / 1935; `.pnpm-store` 72,3 / 911; `.git` 42,0; `.rar` 41,4; `packages` 17,7; `.work` 5,3; `.beads` 2,8; `tests` 0,8.
  7. **Чистка запрещена, пока идёт запись в `.tmp`:** за время инвентаризации `.tmp/plan-v03-verify-a` 0→4 файла, `.tmp/plan-v03-lead` 4→18.
  8. Секретов не найдено (17 совпадений `sk-|ghp_|AKIA|PRIVATE KEY` — все тест-фикстуры), `.env`-файлов нет.
- **Шаги (строго в этом порядке):**
  1. **П0 — координаты и стоп-условие (read-only):** `$root=(Resolve-Path 'H:\Repo\DSH-MyWork').Path; if(-not(Test-Path "$root\.git")){throw 'not repo root'}`; `git -C $root worktree list`; `git -C $root status --porcelain`. **Если кампания v0.3 пишет в `.tmp` — остановиться и не удалять ничего** (факт 7).
  2. **П1 — пустые каталоги** (`beads-probe`, `pnpm-temp`, `test-tmp`): сначала проверить пустоту, потом `Remove-Item -LiteralPath` (НЕ по маске, НЕ по переменной-шаблону). Если не пусто — `throw`, не удалять.
  3. **П2 — мёртвые скаффолды** (`mw004-verify`, `mw010-head-verify`): убедиться, что реальных файлов 0 (только `ReparsePoint`), затем **`cmd /c rmdir /s /q "<точный путь>"`**.
  4. **П3 — node_modules двух worktree** (только если сами worktree решено сохранить): `Test-Path "$root\.tmp\f-audit\pnpm-lock.yaml"` → затем `cmd /c rmdir /s /q` по каждому из двух **точных** путей.
  5. **П4 — worktree только через git, без `--force`:** сначала снять диффы в файл (`git -C "$root\.tmp\mw012-review" diff > .tmp\plan-v03-lead\mw012-review-dirty.patch`), затем `git worktree remove ".tmp\mw012-review"`. **Отказ на грязном дереве — ожидаемый результат, а не ошибка.** `--force` и `prune` — только по явному решению владельца.
  6. **П5 — перед `.rar` вынуть уникальное, распаковка ВНЕ репозитория:** `7z x DSH-MyWork.rar -o"$env:TEMP\dsh-mw-rar" ".tmp/msg-*.txt" ".tmp/mw008-verify/packages/*/src/*"` → проверить, что распаковалось; только после этого обсуждать удаление `.rar` (решение владельца).
  7. **П6 — отчёт:** таблица «путь → класс (безопасно / требует решения / не трогать) → что сделано», включая всё, что **не** удалено.
- **Гейт (готово когда):** `git worktree list` → ровно **1** запись (основная), **И** `Test-Path "$root\.tmp\v2-boundary-demo\node_modules"` → `False`, **И** `Test-Path "$root\node_modules"` → `True`, **И** `Test-Path "$root\packages\core\lib"` → `True`, **И** `Test-Path "$root\tests\lib"` → `True`. Последние три — **обязательная проверка, что живое дерево цело**.
- **Evidence:** вывод `git worktree list` и `git status` до/после; три проверки целостности живого дерева; таблица П6; `Measure-Object` по `.tmp` до/после.
- **Риски:** см. факты 1–2 — это **главный риск этапа 0**. Митигация: (а) только точные пути, (б) `cmd /c rmdir /s /q` вместо `Remove-Item -Recurse`, (в) `git worktree remove` без `--force`, (г) три проверки целостности в гейте, (д) не удалять ничего класса «требует решения».
- **Чего делать НЕЛЬЗЯ (дословно из `lead-18`):** `Remove-Item -Recurse -Force` по `.tmp\v2-boundary-demo`, `.tmp\mw014-review`, `.tmp\mw012-mine`; по `$root\.tmp`, по маске, по переменной, из вычисленного пути; `git clean -xdf`/`-xdfd` где угодно (снесёт `.work`, `.analysis`, `.dsh`, `.beads`, `.tmp`); `git worktree remove --force` / `prune` до решения владельца; любая запись или удаление в `.beads` (+ `.beads.gate.lock`, `embeddeddolt`), `.dsh/skills`, `.analysis/retired`, `.tmp/plan-v03-*`; удаление `.rar` до П5.
- **Класс «требует решения владельца» (не удалять в этом шаге):** `.tmp/f-audit` без `node_modules` (14,2 МБ, несохранённый фикс `beads-adapter`), `.tmp/mw012-review` без `node_modules` (10,5 МБ, состояние ревью-мутаций), `.tmp/v2-boundary-demo` (2,4 МБ, только `git worktree remove`), `.tmp/mw018-review`, `.tmp/mw012-full-backup`, снимки `*-backup`/`*-snap`/`*-mut`, `*.bak`/`*.backup*`, `*.log/*.txt/*.mjs/*.ps1` (~300 файлов, часть ссылок из `.work` уже висит — 41 из 116 имён), `.tmp/mw008-review/db/**` и `.tmp/mw008-vfix/db/**` (22 sqlite), `DSH-MyWork.rar`, корневые `node_modules` + `.pnpm-store` (182 МБ — воспроизводимы, но **не в `.rar`** ⇒ удаление = полная переустановка).
- **Не трогать:** `.tmp/plan-v03-*` (активная кампания), `.work`, `.analysis`, `.dsh`, `.beads`, `.git`, `packages/`, `tests/`, `scripts/`, корневые конфиги.
- **Опровержение базы:** утверждение отчёта «`git worktree list` → 3 записи» **уточнено**: 1 основная + **3 вложенные** (все грязные), и «просто удалить `.tmp`» **недопустимо** из-за 21 junction в живое дерево.
---

#### F-11 · Грязный `pnpm-lock.yaml`: зафиксировать или откатить

- **Карточка:** — (гигиена; `FINAL-REPORT` §3.1 фиксирует `M pnpm-lock.yaml`).
- **Зависит:** F-01 · **Усилие:** S · **Риск:** низкий · **Откат:** `git checkout -- pnpm-lock.yaml`.
- **Цель:** рабочее дерево чистое до начала работ этапа 1, и известно, что именно изменилось в локе.
- **Файлы:** Modify/restore `pnpm-lock.yaml`.
- **Проверенные факты:** `git status --porcelain` → ` M pnpm-lock.yaml`; HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (2026-09-22).
- **Шаги:**
  1. Посмотреть объём: `git diff --stat pnpm-lock.yaml` → ожидаем число изменённых строк.
  2. Посмотреть содержание: `git diff pnpm-lock.yaml | Select-Object -First 60` → понять, это смена версии/резолва или мусор.
  3. Решение: если изменение — следствие установки под другую версию pnpm (F-01) или посторонней правки → откатить `git checkout -- pnpm-lock.yaml`; если это осознанная правка — закоммитить отдельным коммитом с сообщением.
  4. Проверить: `git status --porcelain` → пусто (или только ожидаемые файлы).
- **Гейт (готово когда):** `git status --porcelain pnpm-lock.yaml` → пустая строка.
- **Evidence:** `git diff --stat`; итоговый `git status`.
- **Риски:** откат лока при установленном `node_modules` даёт рассинхрон. Митигация: `node_modules` в этой кампании не трогается, а CI (F-25) ставит с `--frozen-lockfile` — рассинхрон выявится там.

---

#### F-12 · Гейт этапа 0

- **Карточка:** — (контрольная точка).
- **Зависит:** F-01…F-11, а также **F-61 и F-62** (дополнения этапа 0) · **Усилие:** S · **Риск:** низкий.
- **Цель:** этап 0 закрыт машинно-проверяемо; этап 1 больше не блокируется.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-12-stage0-gate.md`.
- **Шаги — прогнать пять команд и записать выводы:**
  1. `corepack pnpm --version` → `12.4.2`
  2. `corepack pnpm -r run typecheck` → `EXIT=0` (**с `-r`**; без `-r` → `EXIT=1`)
  3. `Select-String -Path 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Pattern 'sessionDefaultPermission'` → **1** совпадение, отступ — как у `plugin:`
  4. `Select-String -Path 'C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml' -Pattern 'autoRun'` → **0** совпадений
  5. `git worktree list` → **1** запись
- **Гейт (готово когда):** все пять команд дают ожидаемое выше **И** F-61 закрыт (0 unresolved от базы бандла; id пресета `cordis` зафиксирован; Settings → Agent presets проверены) **И** F-62 закрыт (число карточек без `permissionConfirmedAt` зафиксировано с `revision`). Любое расхождение — этап 0 не закрыт.
- **Evidence:** вывод всех пяти команд с exit code.
- **Что этап 0 НЕ доказывает:** что карточки `MW-044`…`MW-055` действительно исполняются (это F-06 и далее), и что `pnpm` «починен» глобально (F-01 даёт рабочий runner, а не ремонт системы).

---

## 1bis. Этап 0 — дополнения по свежим доказательствам (`F-61`, `F-62`)

Два шага добавлены после сдачи первой редакции файла. Нумерация `F-01`…`F-60` **не менялась**; новые шаги идут последними по номеру, но **по порядку исполнения относятся к этапу 0** и выполняются сразу после F-12.

---

#### F-61 · Пресет `mode: cordis` для карточек MyWork + запрет устаревшей «фермы» имён

- **Карточка:** MW-002 (правка приёмки: «провал пресета виден только в `error` исполнения»), этап 0 · **Источник:** `evidence/lead-17-profile-composition.md`.
- **Зависит:** F-04, F-12 · **Усилие:** S · **Риск:** низкий · **Откат:** снять привязку `mode`.
- **Цель:** карточки не падают на монтировании пресета, и отказ пресета перестаёт быть невидимым.
- **Файлы:** Modify привязки карточек на доске (`mode: cordis`); Create `.work/plan-v0.3/evidence/foundation-61-preset.md`.
- **Проверенные факты (`evidence/lead-17-profile-composition.md`):**
  1. Дефолт деплоя — **`cordis`**: `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:66-68` — `agent-preset-registry.config.default = cordis`.
  2. **`cordis` — единственный пресет с живым доказательством монтирования:** эта сессия исполняется именно на нём (иначе не было бы инструментов `cordis_inspect_*` и навыка `cordis-composition-reference`; `@deepseek-ai/dsh-tool-cordis` объявлен **только** в `packages\bundle\web-app\presets\cordis.patch.yml`). 24 включённых ряда, **0 unresolved от базы бандла**.
  3. `standard` — по резолву тоже работает (**0 unresolved от базы бандла**), но **живого подтверждения нет**; отличается лишь отсутствием `tool-cordis`. **Не пинить.**
  4. Провал монтирования пресета — это отказ **до первого хода агента**: `1789583853269 → 1789583853339` мс, то есть **~70 мс**, `result: "failed"` (`packages\preset\agent-preset-registry\src\mount.ts:258-267` — `mountPreset` бросает, если `audit.failed.length > 0`). **Виден только в поле `error` исполнения карточки.**
  5. Массовый отказ 2026-09-16 (24 ряда) **сегодня не воспроизводится**: падавшая ревизия пресета была старой (ряд `workflow-worker-thread` вместо нынешнего `workflow-ptc`), а текст `N rows name plugins that cannot be resolved:` в текущем чек-ауте **не производится** (0 вхождений в коде; текущий код печатает построчно `id (name): never started`, `mount.ts:196`).
  6. **Ловушка «фермы имён»:** две базы резолва. Свежая — `packages\bundle\web-app\node_modules\@deepseek-ai` (137 записей). **Устаревшая** — `C:\Users\Dmitry\.dsh\profiles\node_modules\@deepseek-ai` (240 записей, создана 2026-09-17; нет `dsh-workflow-ptc`, `dsh-plugin-manager`, `dsh-agent-preset`, `dsh-agent-preset-registry`; **9 битых junction**). Наивный `require.resolve` от каталога профиля даёт **неверный** ответ: `standard` 1 unresolved, `cordis` 1 unresolved — это **2 ложных FAIL**, хотя живьём всё резолвится (от базы бандла — 0 unresolved у всех четырёх пресетов).
  7. База резолва имён — **каталог своего бандла**, не профиль: `logs\startup-2026-09-26T05-46-53.033Z-….log:22` — резолв `@deepseek-ai/dsh-agent-preset-registry` в `packages\bundle\web-app\node_modules\@deepseek-ai\…`; `:16` — `dsh-permission-presets` в `packages\bundle\base\node_modules\…`.
- **Шаги:**
  0. **Шаг 0 (обязателен, R-05):** `task_board_*` принимает **UUID**, а не `MW-0NN` (`task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт только в `title`). Получить id: `task_board_list { query: "MW-0NN" }` → взять `id` из единственного совпадения; **дальше использовать только полученный UUID**.
  1. Пинить карточкам MyWork `mode: cordis` (значение — из `cordis.patch.yml:66-68`); **`standard` не пинить** нигде.
  2. `mode` задавать **явно на каждой карточке**: провал монтирования — отказ за ~70 мс, и без явной привязки он маскируется под «неизвестную ошибку исполнения».
  3. Бесплатная проверка без запуска сессии: **Settings → Agent presets** — панель показывает `broken` по каждому пресету. Зафиксировать в evidence **id пресета**, на котором реально исполнялась проверочная карточка.
  4. Инвариант для плагина: **не полагаться на `C:\Users\Dmitry\.dsh\profiles\node_modules`** (устаревшая ферма) при резолве имён; база — каталог бандла. Проверка: `node -e "…createRequire('packages/bundle/web-app/package.json').resolve(name)"` по каждому включённому ряду → ожидаем **0 unresolved**.
  5. Записать в evidence: 4 пресета × (unresolved от базы бандла / unresolved от каталога профиля), чтобы «ложные FAIL» были видны числом.
- **Гейт (готово когда):** `node -e "…createRequire(…'packages/bundle/web-app/package.json').resolve(name)"` по включённым рядам → **0 unresolved** для `standard`, `cordis`, `ptc`, `minimal`; и в evidence зафиксирован id пресета из Settings → Agent presets.
- **Evidence:** таблица 4×2 unresolved; id пресета; `cordis.patch.yml:66-68`; цитата `mount.ts:258-267`.
- **Риски:** пининг `cordis` привяжет карточки к пресету, который может измениться. Митигация: это **дефолт деплоя**, а не наш выбор; при смене дефолта меняется одна строка привязки.
- **Не делать:** не пинить `standard` (нет живого подтверждения); не диагностировать пресеты через `require.resolve` от каталога профиля; **не запускать `dsh --dump-config`** — он идемпотентно перезаписывает `profiles\web\cordis.yml` (меняет mtime), и `dsh.cmd` без `--skip-build` гоняет `pnpm install`/`build` через `dsh-guard.mjs`.
- **Опровержение базы:** `decision-00-limitation-and-refutations.md:46` («в профиле нет соответствующих пакетов») **опровергнуто**: из профиля не хватает ровно **двух** пакетов, из базы бандла — **ни одного**; 24-рядный отказ сегодня не воспроизводится.

---

#### F-62 · Гейт прав: 33 из 55 карточек формально требуют подтверждения

- **Карточка:** MW-054 (правка), этап 0 · **Источник:** `evidence/lead-15-legacy-board.md`.
- **Зависит:** F-04, F-06, F-12 · **Усилие:** S · **Риск:** средний (массовое подтверждение прав — действие человека) · **Откат:** нет.
- **Цель:** известно, сколько карточек реально блокирует гейт прав, и после починки ключа `sessionDefaultPermission` (F-04) это число перепроверено, а не предположено.
- **Файлы:** Modify привязки/подтверждения на доске; Create `.work/plan-v0.3/evidence/foundation-62-permission-gate.md`.
- **Проверенные факты (`evidence/lead-15-legacy-board.md`):**
  1. **Живой API доски отдаёт `sessionDefaultPermission: read-only`** (`task_board_list`, `ok:true`) — то есть **на момент снятия доказательств починка F-04 ещё не действовала**.
  2. Следствие: **33 из 55 карточек** закреплены на `workspace-write` **без** `permissionConfirmedAt` (все backlog: `MW-021`…`MW-041`, `MW-044`…`MW-055`); у **22** подтверждение есть. Все 55 — `permission: workspace-write`, `model: opencode-go/deepseek-v4.1-flash`, тег `DSH-MyWork`.
  3. Правило гейта читать так: `permission` выше session default **И** `permissionConfirmedAt == undefined` ⇒ требуется подтверждение. При фактическом default `read-only` это **33 карточки, а не 0**.
  4. `sessionDefaultPermission = read-only` совпадает с `DEFAULT_SESSION_PERMISSION` (`src/core/handover.ts:44`), хотя в профиле задано `workspace-write`: вложенный `config:`-объект до `Config` плагина не доходит, а плоские соседи (`announceToAgent`) доходят — доска анонсируется агентам. **Это и есть дефект F-04.**
  5. Объём доски: 55 карточек, `revision` **341** (в кампании v0.3 было 324 — актуализировано 2026-10-03 чтением `C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`); статусы backlog 34, done 19, failed 2; `todo`/`running` — 0; архивных **3** (прежняя редакция называла 2); `permissionConfirmedAt` — у 22 из 55; эффективный `sessionDefaultPermission` — `read-only` (поле леджера пустое, срабатывает дефолт плагина `dsh-client-ui-task-board/lib/index.js:6089` — дефект F-04); расписаний 0.
- **Шаги:**
  0. **Шаг 0 (обязателен, R-05):** `task_board_*` принимает **UUID**, а не `MW-0NN` (`task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт только в `title`). Получить id: `task_board_list { query: "MW-0NN" }` → взять `id` из единственного совпадения; **дальше использовать только полученный UUID**.
  1. **После** исполнения F-04 перечитать живой API: `task_board_list` → поле `sessionDefaultPermission` → ожидаем **`workspace-write`**. Если осталось `read-only` — F-04 не сработал, вернуться к нему, **не** подтверждать права «на глаз».
  2. Если `workspace-write` действует: пересчитать множество карточек, требующих подтверждения, по правилу п. 3 → ожидаем **0** (при `workspace-write` как session default привязка `workspace-write` перестаёт быть «выше дефолта»).
  3. Если `workspace-write` **не** действует (или владелец выбрал иной default): зафиксировать фактическое число (**33**) и вынести на решение владельца — подтверждать 33 карточки вручную либо поднять session default. **Массовое подтверждение — действие человека, не агента.**
  4. Записать в evidence: значение `sessionDefaultPermission` до и после, число карточек без `permissionConfirmedAt` до и после, `revision` леджера на оба момента.
- **Гейт (готово когда):** `task_board_list` → `sessionDefaultPermission` равно ожидаемому, и число карточек с `permission` выше default **без** `permissionConfirmedAt` зафиксировано в evidence с `revision` (0 либо 33 с решением владельца).
- **Evidence:** два вывода `task_board_list` с `revision`; список id карточек без подтверждения; ссылка на `src/core/handover.ts:44`.
- **Риски:** подтверждение 33 карточек открывает реальные запуски и расход квоты. Митигация: подтверждать **только** те, что действительно нужны к запуску; остальные оставить `todo` без подтверждения.
- **Связь с F-06:** F-06 доказывает снятие гейта на **одной** карточке-пустышке; F-62 считает **весь** корпус. Оба нужны: F-06 — механизм, F-62 — масштаб.
- **Опровержение базы:** утверждение «12 карточек MW-044…MW-055 не запускаются» **уточнено**: гейт формально блокирует **33 из 55** (все backlog-карточки без `permissionConfirmedAt`), а не 12.
## 2. Этап 1 — сделать проверяемым то, что уже есть (1–3 дня)

Гейт этапа: **F-27**. Тема: единственный внешний backend (`bd`) не проверяется на целевой платформе, схема БД склеивается вызывающим, публикация и вход сломаны, леджеры расходятся.

---

#### F-13 · `bd`-seam: резолвер JS-entry через `process.execPath`

- **Карточка:** **MW-056** (новая, диапазон MW-056…MW-059) · **ADR:** ADR023 (CLI-транспорт).
- **Зависит:** F-01 (рабочий runner) · **Разблокирует:** F-14, F-15, F-16, F-17.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert коммита.
- **Цель:** появляется чистый модуль, который знает, **чем** запускать `bd` на Windows: `node <JS-entry>` вместо `bd`-шима.
- **Файлы:** Create `packages/beads-adapter/src/launch.ts`; Create `tests/beads-launch.test.mjs`.
- **Проверенные факты:**
  1. `packages/beads-adapter/src/runner.ts:96` — `const binary = options.binary ?? 'bd'`; `:102-108` — `spawn(binary, [...command.args], { cwd, shell: false, windowsHide: true, env })`. Комментарий `:104-105` прямо фиксирует «No shell: arguments are passed as an argument vector verbatim».
  2. `tests/beads-adapter.test.mjs:58` — `spawnSync('bd', ['version'], { encoding: 'utf8', shell: false })`; `:77` — `spawnSync('bd', args, { cwd, encoding: 'utf8', shell: false, input: stdin })`.
  3. `packages/beads-adapter/src/adapter.ts:182` документирует `env` как «extra environment entries, e.g. `BEADS_ACTOR`»; `:500` — `{ BEADS_ACTOR: command.claimant }`.
  4. `FINAL-REPORT` §8.2 P1: `spawnSync('bd', {shell:false})` → ENOENT (errno **-4058**) на Windows.
  5. `scripts/lib/process.mjs:52-58` — **уже готовый образец** этого приёма: `pnpmLaunch()` предпочитает JS-entry (`npm_execpath`) и только иначе падает на `PATH`; `:57` — `shell: process.platform === 'win32'`.
- **Шаги:**
  1. Тест (падающий): `resolveBeadsLaunch({ platform: 'win32', findEntry: () => 'C:\\x\\bd.js' })` → ожидаем `{ command: process.execPath, args: ['C:\\x\\bd.js'], shell: false }`.
     Команда: `node --test --test-isolation=none tests/beads-launch.test.mjs` → FAIL «Cannot find module … launch.ts».
  2. Тест (падающий, негативный): `resolveBeadsLaunch({ platform: 'win32', findEntry: () => undefined })` → ожидаем типизированный отказ `BEADS_BINARY_NOT_FOUND` с подсказкой команды установки, а **не** молчаливый откат на `'bd'`.
  3. Тест (падающий, POSIX): `platform: 'linux'` → `{ command: 'bd', args: [], shell: false }` (поведение не меняется).
  4. Реализация `launch.ts`: `resolveBeadsLaunch(options)` — при `win32` искать JS-entry (`node_modules/.bin/bd`-шим не годится, нужен именно `.js`/`.mjs`/`.cjs`), при находке вернуть `process.execPath` + путь; иначе — `'bd'` с `shell: false` на POSIX и типизированный отказ на win32.
  5. Команда: `node --test --test-isolation=none tests/beads-launch.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/beads-launch.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод теста; `packages/beads-adapter/src/launch.ts` (новый файл); ссылки `runner.ts:96,102-108`, `process.mjs:52-58`.
- **Риски:** резолвер, ищущий entry по эвристике, может найти **чужой** `bd`. Митигация: искать только внутри `node_modules` проекта и требовать явного `options.entry` при сомнении; при отсутствии — отказ с командой установки, а не догадка.
- **Шаг 0:** подтвердить, что пакет `bd` вообще установлен и как он называется (`npm ls -g --depth=0`, `Get-ChildItem "$env:APPDATA\npm" -Filter 'bd*'`). В этой кампании **не подтверждено** — в §7.

---

#### F-14 · `bd`-seam: применить резолвер в `createProcessRunner`

- **Карточка:** MW-056 · **Зависит:** F-13 · **Разблокирует:** F-15, F-17.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert коммита.
- **Цель:** единственное место, «которое трогает операционную систему» (`runner.ts:57-60`), перестаёт зависеть от `PATH`-шима.
- **Файлы:** Modify `packages/beads-adapter/src/runner.ts:72-82` (опции), `:95-108` (создание процесса); Modify `tests/beads-adapter.test.mjs` — **нет** (тесты адаптера — в F-16); Create `tests/beads-runner-launch.test.mjs`.
- **Проверенные факты:** `runner.ts:71-82` — `ProcessRunnerOptions { binary?: string; timeoutMs?: number }`; комментарий `:73` «Defaults to `bd` from `PATH`». `:61-69` — интерфейс `BeadsRunner` (единственный seam ОС). `:130-135` — `child.on('error', …)` пробрасывает ошибку порождения наружу (`reject(error)`).
- **Шаги:**
  1. Тест (падающий): подменить `resolveBeadsLaunch` (через инъекцию `options.launch`) и проверить, что при `launch = { command: process.execPath, args: ['/x/bd.js'], shell: false }` процесс порождается **с** `execPath` и **без** шелла.
     Команда: `node --test --test-isolation=none tests/beads-runner-launch.test.mjs` → FAIL.
  2. Реализация: `ProcessRunnerOptions` получает `launch?: BeadsLaunch`; `createProcessRunner` при отсутствии `launch` вызывает `resolveBeadsLaunch()`; в `spawn` используется `launch.command` и `[...launch.args, ...command.args]`.
  3. Сохранить инвариант «no shell»: добавить в тест проверку, что `shell === false` и что `args` не склеиваются в строку.
  4. Команда: `node --test --test-isolation=none tests/beads-runner-launch.test.mjs` → `pass 2 / fail 0`.
  5. Регрессия (узкая): `node --test --test-isolation=none tests/beads-adapter.test.mjs` → не хуже, чем было (было: `pass … / fail 0 / skipped 23`).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/beads-runner-launch.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** вывод тестов; diff `runner.ts`; инвариант «no shell» строкой в тесте.
- **Риски:** изменение сигнатуры `createProcessRunner` ломает вызовы. Митигация: новое поле **опционально**; существующее `binary` сохраняется как высший приоритет.

---

#### F-15 · `bd`-seam в пробе и в диагностике (Doctor)

- **Карточка:** MW-056, правка MW-038 («диагностика `bd`-seam»).
- **Зависит:** F-13, F-14 · **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** одна функция «доступен ли `bd`» используется и тестом, и Doctor'ом — расхождение «тест видит, Doctor не видит» исчезает.
- **Файлы:** Modify `tests/beads-adapter.test.mjs:56-62` (проба); Create `packages/beads-adapter/src/probe.ts`; Create `tests/beads-probe.test.mjs`.
- **Проверенные факты:** проба сегодня — `tests/beads-adapter.test.mjs:56-62`, локальная для файла теста; в `packages/**/src` отдельной пробы нет (grep по `packages/beads-adapter/src` даёт `probe` только в комментарии `adapter.ts:77`). `beads-adapter/src` содержит 10 файлов: `adapter.ts` (45299), `index.ts`, `mapping.ts`, `memory-plugin.ts`, `memory.ts`, `plan.ts`, `plugin.ts`, `reconcile.ts`, `runner.ts`, `workspace.ts`.
- **Шаги:**
  1. Тест (падающий): `probeBeads({ runner })` с подставным раннером → `{ available: true, version: '1.3.0' }`; при `code !== 0` → `{ available: false, reason: 'nonzero-exit', stderr }`.
     Команда: `node --test --test-isolation=none tests/beads-probe.test.mjs` → FAIL «probe.ts not found».
  2. Реализация `probe.ts`: `probeBeads({ launch?, timeoutMs? })` запускает `bd version` через тот же резолвер и **никогда не бросает** — возвращает дискриминированный результат.
  3. Команда: `node --test --test-isolation=none tests/beads-probe.test.mjs` → `pass 2 / fail 0`.
  4. Подключить пробу в Doctor-путь (точка подключения — `packages/controller/src/index.ts`, диагностика; `~` — конкретный файл Doctor в этом репозитории не проверен).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/beads-probe.test.mjs` → `# pass 2`, `# fail 0`, и `Select-String -Path packages\beads-adapter\src\*.ts -Pattern 'export function probeBeads'` → **1** совпадение.
- **Evidence:** вывод теста; новый файл; указание точки Doctor-подключения.
- **Риски:** проба в Doctor может тормозить Cold-start Dolt. Митигация: `timeoutMs` по умолчанию меньше, чем `DEFAULT_COMMAND_TIMEOUT_MS = 30_000` (`runner.ts:85`), и проба кэшируется на процесс.

---

#### F-16 · Тест `beads-adapter`: честная проба и удаление ложного EPERM-текста

- **Карточка:** MW-056; `FINAL-REPORT` §8.2 P2 («текст причины про EPERM неверен»), §9.1 (MW-010/011).
- **Зависит:** F-15 · **Разблокирует:** F-17.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** пропуск перестаёт объясняться причиной, которой нет; сообщение называет **настоящую** причину и способ починки.
- **Файлы:** Modify `tests/beads-adapter.test.mjs:56-73`.
- **Проверенные факты:**
  1. `:64-73` — при `!HAS_BD` пишется в `stderr`: «…under the DSH file sandbox this is EPERM on piped stdio…». `:67-68` дословно: «the documented cause here is the DSH file sandbox, which blocks piped-stdio subprocess spawn with EPERM, so the probe cannot start `bd` even though an operator's shell can».
  2. `:57-60` — проба вызывает `spawnSync('bd', …)`, то есть при `shell: false` на Windows получает **ENOENT/-4058**, а не EPERM (P1).
  3. `:19-20` — комментарий файла уже формулирует правильную политику: «a skipped check must never look like a pass».
- **Шаги:**
  1. Тест (падающий): новый тест «сообщение о пропуске называет `errno`/`code` фактической ошибки» — подать фейковый результат пробы `{ error: { code: 'ENOENT' } }` → ожидаем, что текст содержит `ENOENT` и **не** содержит `EPERM`.
     Команда: `node --test --test-isolation=none tests/beads-adapter.test.mjs` → FAIL.
  2. Реализация: проба использует `probeBeads` (F-15) и печатает `reason` + `code` + команду исправления.
  3. Убрать из `:67-71` утверждение про EPERM; заменить на нейтральное «`bd` не найден или не запускается: <code>; установите Beads 1.3.0 и проверьте `bd version`».
  4. Команда: `node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`; число `skipped` пока то же (23).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/beads-adapter.test.mjs 2>&1 | Select-String -Pattern 'EPERM'` → **0** совпадений.
- **Evidence:** вывод теста; diff `:56-73`.
- **Риски:** удаление объяснения снижает понятность для будущего читателя. Митигация: вместо удаления — точная формулировка с `errno`.
- **Не делать:** не подменять пропуск на падение здесь — это F-17 (нужен профиль CI, иначе локальная разработка без `bd` станет красной).

---

#### F-17 · Skip реального backend → падение в CI-профиле

- **Карточка:** MW-010/MW-011 (правка приёмки: «ни один тест реального backend не может быть skipped в CI-профиле»), MW-056.
- **Зависит:** F-16, F-25 (CI) · **Усилие:** S · **Риск:** низкий · **Откат:** убрать переменную среды.
- **Цель:** 23 молчаливых `skipped` становятся **падением** там, где backend обязан быть.
- **Файлы:** Modify `tests/beads-adapter.test.mjs:64-73`; Modify `.github/workflows/ci.yml` (создаётся в F-25).
- **Проверенные факты:** `:62` — `const HAS_BD = bdAvailable()`; `:64` — `if (!HAS_BD) {`; пропуски дают `# SKIP` ×23 в зелёном прогоне (`FINAL-REPORT` §8.1: «710 тестов: 687 pass / 0 fail / 23 skip»). Переменной, включающей строгий режим, сегодня нет.
- **Шаги:**
  1. Тест (падающий): при `MYWORK_REQUIRE_BEADS='1'` и отсутствующем `bd` файл тестов должен **бросать** на этапе загрузки, а не писать в `stderr`.
     Команда: `$env:MYWORK_REQUIRE_BEADS='1'; node --test --test-isolation=none tests/beads-adapter.test.mjs; $LASTEXITCODE` → сейчас `0` (FAIL ожидания).
  2. Реализация в `:64`: `if (!HAS_BD) { if (process.env.MYWORK_REQUIRE_BEADS === '1') throw new Error(…) ; <текущее предупреждение> }`.
  3. Команда (без переменной): `node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`, `# skipped 23` (локальная разработка сохранена).
  4. Команда (с переменной, `bd` отсутствует): `$env:MYWORK_REQUIRE_BEADS='1'; node --test --test-isolation=none tests/beads-adapter.test.mjs; $LASTEXITCODE` → `1` и текст ошибки с командой установки.
  5. Прописать `MYWORK_REQUIRE_BEADS: '1'` в CI-профиле шага F-25 и в job, где `bd` устанавливается.
- **Гейт (готово когда):** в CI: `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# skipped 0`, `# pass 70`, `# fail 0` (число 70 — из `FINAL-REPORT` §10, этап 1, п.1; **проверить фактически**).
- **Evidence:** два прогона (локальный мягкий / строгий) с exit code; diff CI-файла.
- **Риски:** строгий режим в CI упадёт, если `bd` не устанавливается в раннере. Митигация: отдельный job `beads-backend` с явной установкой и падением при неудаче установки — «не удалось поставить backend» и «backend сломан» должны быть различимы.
- **Открытая проверка:** число `70` из отчёта не воспроизводилось в этой кампании (полный прогон — только Lead). Исполнителю: сначала записать фактическое `pass`.

---

#### F-18 · Единый реестр миграций `MYWORK_DATABASE_MIGRATIONS`

- **Карточка:** **MW-059** (новая), правка MW-004/MW-039/MW-040 · **ADR:** RT-1/RT-10, P5.
- **Зависит:** F-01 · **Разблокирует:** F-19, F-20, F-29.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert коммита.
- **Цель:** существует **один** экспортируемый список, описывающий базу целиком; версия схемы перестаёт быть числом-сиротой.
- **Файлы:** Modify `packages/storage/src/migrations.ts` (новый экспорт; место выбрано решением D08); Modify `packages/storage/src/index.ts:45-46,65` (реэкспорт); Create `tests/storage/migrations-registry.test.mjs`.
- **Проверенные факты:**
  1. `packages/storage/src/migrations.ts:91` — `export const MYWORK_MIGRATIONS: readonly Migration[] = Object.freeze([OUTBOX_INBOX])`; `:94` — `MYWORK_SCHEMA_VERSION = MYWORK_MIGRATIONS[last]?.version ?? 0` → сегодня **1**, а таблиц две (`outbox`, `inbox_dedup`, `migrations.ts:54,72`).
  2. **Пять** независимых списков, склеиваемых вызывающим:
     - `MYWORK_MIGRATIONS` — v1 (`storage/src/migrations.ts:91`)
     - `EVIDENCE_MIGRATIONS` — **v2 и v3** (`evidence/src/schema.ts:138`; `EVIDENCE_SCHEMA_VERSION = 3`, `:26`). **Уточнение:** D08 («Доказательства») прямо говорит «`EVIDENCE_MIGRATIONS` … версии 2 и 3», то есть недостающей версии **нет** и «мостик» не нужен.
     - `LEASE_MIGRATIONS` — v4 (`lease/src/schema.ts:22,66,68`)
     - `PLAN_MUTATION_MIGRATIONS` — v5 (`planner/src/schema.ts:36,148,150`)
     - `CLAIM_SAGA_MIGRATIONS` — v6 (`execution/src/schema.ts:48,153,155`)
  3. Склейку документируют **комментарии** и JSDoc: `execution/src/schema.ts:28-34`, `execution/src/index.ts:18-24`, `planner/src/index.ts:17-23`, `planner/src/schema.ts:16-22`, `evidence/src/store.ts:8`, `lease/src/index.ts:13`, `lease/src/schema.ts:14`.
  4. Отказы при неполном наборе — уже есть, но поздно: `lease/src/lease.ts:315-321` (`the database has no controller-lease schema; open it with migrations [...MYWORK_MIGRATIONS, ...LEASE_MIGRATIONS]`), `evidence/src/store.ts:85-91`, `planner/src/store.ts:126`, `execution/src/service.ts:251`.
- **Шаги:**
  1. Тест (падающий): `MYWORK_DATABASE_MIGRATIONS.map(m => m.version)` **равен набору, который выдаёт аллокатор версий**, и этот набор строго возрастает без пропусков. **Литерал `[1,2,3,4,5,6]` в тесте запрещён** (дефект R-04, канон — `01-MASTER-PLAN.md` §15.3): при добавлении миграции такой тест пришлось бы править вручную, и он «подтверждал» бы любой дубль.
     Команда: `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs` → FAIL «database.ts not found».
  2. Тест (падающий): `MYWORK_DATABASE_SCHEMA_VERSION` → `6`; и он равен `MYWORK_DATABASE_MIGRATIONS.at(-1).version`.
  3. Тест (падающий): `validateMigrations(MYWORK_DATABASE_MIGRATIONS)` **не бросает** (`migrations.ts:111-129` требует строгую возрастающую уникальность).
  4. Реализация: `MYWORK_DATABASE_MIGRATIONS` объявляется в `packages/storage/src/migrations.ts` (**место выбрано D08**, последствия: «новый экспорт `MYWORK_DATABASE_MIGRATIONS`»). Чтобы не нарушить `tests/boundaries.test.mjs:201-230` (storage не импортирует доменные слои: разрешены только `./`, `node:`, `@dsh-mywork/contracts`), storage экспортирует **порядок и проверку**, а конкретные списки передаёт вызывающий: `canonicalMigrations(sources)` + `assertCanonicalMigrations(list)`. Сборка — в composition root (F-29).
  5. Команда: `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод теста; diff `storage/src/index.ts`; набор версий, выданный аллокатором (не литерал); цитата D08 о месте экспорта.
- **Риски:** **напряжение между D08 и boundary-тестом.** D08 помещает экспорт в `storage`, а `tests/boundaries.test.mjs:221-226` запрещает storage зависеть от доменных слоёв. Разрешение: в storage — **порядок и проверка**, в composition root (F-29) — **сборка списка**. Это вынесено в открытые проверки (§7.2, F-18) для сверки `verifier-a`; при ином прочтении D08 правится F-29, а не решение.
- **Правило версий (R-04, канон `01-MASTER-PLAN.md` §15.3):** версия выделяется **только единым аллокатором** в composition-слое, **никогда литералом в шаге**. Заявки, которым аллокатор обязан выдать уникальные номера при реализации: `background_job` (**F-37**), триггеры retention (**F-40**), `attempt_worktree` (`21-…` E-04) и последующие (E-19/E-28/E-34/E-37), схема проекции/placement (`22-…` B-12 — сейчас заявлена как v2, что **конфликтует** с `EVIDENCE_MIGRATIONS[0]`). Без аллокатора `validateMigrations` (`migrations.ts:111-129`) бросит на дубле, и **store не откроется вовсе** — то есть падает F-29/F-30, а не отдельный шаг.
- **Зависимость от D-решений:** **D08** — принято (вариант B). Расхождение возможно только в месте *сборки* списка, не в самом решении.

---

#### F-19 · Запретить открытие store без канонического набора миграций

- **Карточка:** MW-059 · **Зависит:** F-18 · **Разблокирует:** F-20, F-29.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** «забыл передать миграции» перестаёт компилироваться/проходить; типизированный отказ вместо молчаливой пустой базы.
- **Файлы:** Modify `packages/storage/src/store.ts:64-74` (опции), `:83-93` (открытие); Create `tests/storage/migrations-required.test.mjs`.
- **Проверенные факты:** `store.ts:68-69` — `/** Migrations to apply; defaults to {@link MYWORK_MIGRATIONS}. */ readonly migrations?: readonly Migration[]`; `:84` — `validateMigrations(options.migrations ?? MYWORK_MIGRATIONS)`. То есть **дефолт существует и он неверен**: открывает v1-базу и объявляет её полной. Решение: D08, вариант B — «запрет открытия store без него»; альтернатива D08 («или берёт канонический, но тогда `MYWORK_SCHEMA_VERSION` = 6») **отклонена** в пользу явного списка, потому что неявный дефолт — это и есть сегодняшний дефект.
- **Шаги:**
  1. Тест (падающий): `await openStore({ path })` (без `migrations`) → ожидаем `StorageError` с кодом `MIGRATIONS_REQUIRED`.
     Команда: `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` → FAIL «открытие прошло без списка миграций».
  2. Реализация: `migrations` становится обязательным полем; при `undefined` — `throw new StorageError('MIGRATIONS_REQUIRED', 'dsh-mywork: openStore requires an explicit migration list; pass MYWORK_DATABASE_MIGRATIONS')`.
  3. Тест (падающий, негативный): `openStore({ path, migrations: [] })` → тот же отказ (пустой список — не «полный набор»).
  4. Обновить все вызовы в `tests/**` (отчёт: **15 совпадений** в тестах, **0** исполняемых в пакетах — перепроверить командой `Select-String -Path tests\*.mjs -Pattern 'openStore\(' | Measure-Object`).
  5. Команда: `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` → `pass 2 / fail 0`; затем `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` → `# pass 2`, `# fail 0`; и `Select-String -Path packages\**\src\*.ts -Pattern 'openStore\('` → **0** вызовов без явного `migrations`.
- **Evidence:** вывод двух прогонов; diff `store.ts`; число обновлённых вызовов.
- **Риски:** ломающая смена сигнатуры в 15+ местах. Митигация: правки строго механические; проверка — `corepack pnpm -r run typecheck` → `EXIT=0`.
- **Зависимость от D-решений:** D08.

---

#### F-20 · Migration journal: проверка целостности при открытии

- **Карточка:** MW-040 (правка: migration journal), MW-004 · **Зависит:** F-18, F-19.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** журнал применения — не побочный артефакт, а проверяемый контракт: база, которой журнал не соответствует, отказывается открываться.
- **Файлы:** Modify `packages/storage/src/migrations.ts:142-184`; Create `tests/storage/migration-journal.test.mjs`.
- **Проверенные факты:** journal **уже существует**: `migrations.ts:96-103` — `JOURNAL_DDL` создаёт `schema_migrations (version, name, applied_at) STRICT`; `:147` — `connection.exec(JOURNAL_DDL)`; `:165-170` — запись строки в транзакции миграции; `:190-198` — `listAppliedMigrations`. `store.ts:47-48` отдаёт `readonly migrations: readonly AppliedMigration[]`, а `:45-46` — `schemaVersion` из `PRAGMA user_version`.
- **Шаги:**
  1. Тест (падающий): открыть базу, вручную удалить строку `schema_migrations` для v3, открыть снова → ожидаем отказ `MIGRATION_JOURNAL_INCONSISTENT` (а не «всё хорошо, версия 6»).
     Команда: `node --test --test-isolation=none tests/storage/migration-journal.test.mjs` → FAIL.
  2. Тест (падающий): журнал содержит версию **больше** version из `PRAGMA user_version` → тот же типизированный отказ.
  3. Реализация в `runMigrations`: после цикла прочитать `listAppliedMigrations` и сверить множество версий с `{ m.version | m.version <= userVersion }`; расхождение → `StorageError('MIGRATION_JOURNAL_INCONSISTENT', …)` с деталями `{ userVersion, journal: [...] }`.
  4. Команда: `node --test --test-isolation=none tests/storage/migration-journal.test.mjs` → `pass 2 / fail 0`.
  5. Проверить, что `schema-version-unsupported` (`:150-156`) не сломан: тест «база новее билда» → отказ остаётся.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/migration-journal.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** вывод теста; diff `migrations.ts`; `schema_migrations` DDL `:97-103`.
- **Риски:** слишком строгая проверка отвергнет базы, созданные старым кодом. Митигация: строгость включается только для баз, созданных этим билдом (`userVersion >= 1`), и отказ называет точную команду починки (MW-040).
- **Не делать:** не переизобретать журнал — он есть; шаг добавляет **верификацию**, а не таблицу.
- **Зависимость от D-решений:** D08.

---

#### F-21 · MW-057а: тест `batch`-рёбер читает `id` / `dependency_type`

- **Карточка:** **MW-057** (новая; `FINAL-REPORT` §10, этап 1, п.2а; §8.2 P3 с поправкой верификации).
- **Зависит:** F-17 (backend реально запускается) · **Усилие:** S · **Риск:** низкий · **Откат:** revert теста.
- **Цель:** capability `batch-dep-remove` **подтверждена** (не опровергнута): тест больше не читает несуществующее поле.
- **Файлы:** Modify `tests/beads-adapter.test.mjs` — блок проверки batch-рёбер (`~`, конкретная строка не проверена: файл 1382 строки, искать `depends_on_id`).
- **Проверенные факты:**
  1. `packages/beads-adapter/src/adapter.ts:87-98` — `BEADS_CLI_CAPABILITIES`, среди прочего `batch: true`, `'batch-dep-remove': true`, `'guarded-batch': false`.
  2. `FINAL-REPORT` §8.2 P3: тест падает из-за чтения `edge.depends_on_id`, тогда как `bd dep list --json` отдаёт `id`/`dependency_type`; независимый эксперимент с `bd 1.3.0` дал `bd batch` → «2 operations committed» (exit 0) и корректный состав рёбер.
  3. `FINAL-REPORT` §10, этап 1, п.2: «capability `batch-dep-remove` **подтверждена** живым `bd 1.3.0` (не независимый эксперимент: «2 operations committed», exit 0)».
- **Шаги:**
  1. Найти место: `Select-String -Path tests\beads-adapter.test.mjs -Pattern 'depends_on_id|dependency_type'` → записать точные строки.
  2. Тест (падающий): ассерт читает `id` и `dependency_type` из ответа `bd dep list --json` → сейчас FAIL, потому что код читает `depends_on_id`.
  3. Правка чтения полей в тесте (не в адаптере): `edge.id`, `edge.dependency_type`.
  4. Команда: `$env:MYWORK_REQUIRE_BEADS='1'; node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`.
  5. Зафиксировать в evidence фактический вывод `bd batch` (exit code + «N operations committed»).
- **Гейт (готово когда):** `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`, `# skipped 0`
- **Evidence:** diff теста; вывод `bd batch`; строка `adapter.ts:87-98` с `'batch-dep-remove': true`.
- **Риски:** правка теста «под результат» маскирует реальный дефект. Митигация: изменение только **чтения полей ответа**; ни один ассерт о составе рёбер не ослабляется, и в evidence приложен сырой JSON `bd dep list`.
- **Не делать:** не менять `BEADS_CLI_CAPABILITIES['batch-dep-remove']` на `false` — capability подтверждена живым `bd`.

---

#### F-22 · MW-057б: `heartbeat` передаёт актора, как `claim`

- **Карточка:** MW-057 · **Зависит:** F-17 · **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** `bd heartbeat` вызывается от того же актора, что и `bd claim`; дефект адаптера (не capability) закрыт.
- **Файлы:** Modify `packages/beads-adapter/src/adapter.ts:583-588`; Modify `tests/beads-adapter.test.mjs` (ассерт на `env`).
- **Проверенные факты:**
  1. `adapter.ts:583-588`: `async heartbeat(id: TaskId): Promise<void> { this.requireCapability('heartbeat', 'heartbeat'); const result = await this.run(['heartbeat', id]) … }` — **env не передаётся**.
  2. `adapter.ts:495-500`: claim передаёт `{ BEADS_ACTOR: command.claimant }`.
  3. `adapter.ts:96`: `heartbeat: true` — capability объявлена.
  4. `runner.ts:54` документирует `env` как «Used to pass `BEADS_ACTOR`, which is how `bd` records the acting identity for a claim and for the audit trail».
  5. `FINAL-REPORT` §8.2 P3: `bd heartbeat <id>` в чистом workspace даёт exit 0, но без актора; «heartbeat — реальный дефект, но не capability».
- **Шаги:**
  1. Тест (падающий): `ScriptedRunner` (уже есть, `runner.ts:171-199`) + вызов `heartbeat(id)` → ожидаем, что записанный `command.env` содержит `BEADS_ACTOR`.
     Команда: `node --test --test-isolation=none tests/beads-adapter.test.mjs` → FAIL.
  2. Реализация: `heartbeat(id: TaskId, claimant?: string)` либо чтение актора из состояния claim; передать `{ BEADS_ACTOR: … }` в `this.run(...)` третьим аргументом (сигнатура `run` — `adapter.ts:180`, env поддержан).
  3. Сохранить обратную совместимость: при отсутствии актора — прежнее поведение **либо** типизированный отказ; решение зафиксировать в evidence (`FINAL-REPORT` §10 не требует отказа).
  4. Команда: `node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`; и `Select-String -Path packages\beads-adapter\src\adapter.ts -Pattern 'BEADS_ACTOR'` → **≥2** совпадения (claim + heartbeat).
- **Evidence:** diff `adapter.ts`; вывод теста с записанным `env`.
- **Риски:** изменение сигнатуры `heartbeat` — публичный метод порта. Митигация: необязательный параметр; `TaskGraphPort` в `contracts` менять не обязательно.

---

#### F-23 · `scripts/lib/process.mjs`: ветка `shell: true` ведёт в битый `pnpm`-шим

- **Карточка:** MW-041 (правка: «починить `pack.mjs`» — **с поправкой**: корень не в `pack.mjs`), задача 4 этапа 1 · **Зависит:** F-01.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** `node scripts/pack.mjs` работает без рабочего `pnpm` в `PATH`; ветка запуска через `cmd.exe` перестаёт быть путём по умолчанию.
- **Файлы:** Modify `scripts/lib/process.mjs:52-58` (`pnpmLaunch`); Modify `scripts/pack.mjs:34-43` (диагностика).
- **Проверенные факты (`evidence/lead-03-peer-gate.md`, п. 13):**
  1. **Guard сборки в `pack.mjs:30-32` ПРОХОДИТ:** `packages/controller/lib/index.js` существует (88 905 б, 22.09) ⇒ до `runPnpm` дело доходит. **Падение `pack.mjs` — не дефект `pack.mjs`.**
  2. **Корень — `scripts/lib/process.mjs:52-58`:** `npm_execpath` в этом окружении **не оканчивается** на `.js/.cjs/.mjs` (там путь без расширения) ⇒ regex на `:54` не срабатывает ⇒ управление уходит в ветку `:57` — `{ command: 'pnpm', args: [], shell: process.platform === 'win32' }` ⇒ `cmd.exe` находит **52-байтный битый store-шим** и падает.
  3. **Доказательство:** `.tmp/pack-logs/pnpm-pack.err.log:1-2` (227 б, mtime 26.09.2026 23:01:17) — дословно `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\…\bin\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command`. Это ровно тот текст, что даёт `bin\pnpm.CMD` из F-01.
  4. Правка **обязана** адресовать `process.mjs:52-58`; правка одного `pack.mjs` оставит `EXIT=1`.
  5. `scripts/lib/process.mjs:1-8` уже формулирует принцип: «The pnpm launcher prefers the package manager's own JS entry (`npm_execpath`), which needs no shell and no argument re-quoting».
- **Шаги:**
  1. Тест (падающий): `pnpmLaunch({ env: { npm_execpath: 'H:\\.pnpm-store\\...\\bin\\..\\node_modules\\pnpm\\pnpm' } })` (путь **без** расширения) → ожидаем **не** `{ command: 'pnpm', shell: true }`, а рабочий запуск (см. шаг 2).
     Команда: `node --test --test-isolation=none tests/scripts-launch.test.mjs` → FAIL (файла теста нет).
  2. Реализация: в `pnpmLaunch()` расширить распознавание `npm_execpath` — (а) принимать путь без расширения, если он существует и рядом лежит `node_modules/pnpm/bin/pnpm.cjs`; (б) добавить ветку `corepack pnpm` (`corepack` есть: 0.35.0, `corepack pnpm --version` → 12.4.2, exit 0 — проверено в F-01); (в) только затем — `PATH`-фолбэк.
  3. **Явно логировать выбранную ветку** в `pack-logs` (`logName: 'pnpm-pack'` уже есть в `pack.mjs:37-38`) — чтобы диагностика не требовала чтения кода.
  4. Тест (падающий): при `npm_execpath`, указывающем на несуществующий файл, `pnpmLaunch()` **не** уходит молча в `shell: true`, а возвращает `{ kind: 'unavailable', reason }` — и `pack.mjs` печатает причину, а не «is not recognized».
  5. Команда: `node --test --test-isolation=none tests/scripts-launch.test.mjs` → `pass 3 / fail 0`; затем `node scripts/pack.mjs; $LASTEXITCODE` → `0` (в паре с F-24).
- **Гейт (готово когда):** `node scripts/pack.mjs; $LASTEXITCODE` → `0`; и `Select-String -Path scripts\lib\process.mjs -Pattern "shell: process.platform"` → **0** совпадений на пути по умолчанию.
- **Evidence:** вывод команды; diff `process.mjs`; содержимое `pack-logs/pnpm-pack.out.log` (выбранная ветка); цитата `.tmp/pack-logs/pnpm-pack.err.log:1-2`.
- **Риски:** `corepack` не установлен на чужой машине. Митигация: ветка проверяет наличие команды заранее (`where.exe corepack`), иначе — ветка (а) или внятное сообщение об ошибке.
- **Не делать:** не «чинить» сам `pnpm` (глобальная установка/`.npmrc`) — это вне репозитория и вне границ кампании. Не менять guard `pack.mjs:30-32` — он исправен.
---

#### F-24 · `packController` идемпотентность: удалять одноимённый `.tgz` до пака

- **Карточка:** MW-041 (`FINAL-REPORT` §8.2 P12: «`packController` не идемпотентен») · **Зависит:** F-23.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** повторный `node scripts/pack.mjs` не падает и не оставляет мусор в `packages/controller`.
- **Файлы:** Modify `scripts/pack.mjs:33,44-47`; Create `tests/scripts-pack-idempotent.test.mjs`.
- **Проверенные факты (`evidence/lead-03-peer-gate.md`, п. 14):**
  1. `pack.mjs:33` — `const before = new Set(readdirSync(controllerDir).filter(name => name.endsWith('.tgz')))` — снимается множество **имён**.
  2. `pack.mjs:44-47` — `const produced = readdirSync(controllerDir).filter(name => name.endsWith('.tgz') && !before.has(name)); if (produced.length !== 1) throw new Error('pack: expected exactly one new tarball …')`.
  3. **Имя версионно-детерминировано:** `pnpm pack` всегда пишет `dsh-mywork-controller-<version>.tgz`. Если такой файл уже лежит в `packages/controller` (краш, ручной `pnpm pack`), он **перезаписывается под тем же именем** ⇒ `produced = []` ⇒ `Error: pack: expected exactly one new tarball … found []`.
  4. Значит дефект **системный**, а не «посторонний мусор»: сравнение множеств **имён** при детерминированном имени не может работать в принципе.
  5. Воспроизведение безопасно: `New-Item packages\controller\dsh-mywork-controller-0.1.0.tgz -Force` (сейчас в каталоге **0** файлов `.tgz` — проверено).
  6. Артефакт прошлого удачного прогона (17.09): `.tmp/pack/dsh-mywork-controller-0.1.0.tgz`, 9 030 б.
- **Шаги:**
  1. Воспроизвести: `New-Item packages\controller\dsh-mywork-controller-0.1.0.tgz -Force` → `node scripts/pack.mjs; $LASTEXITCODE` → ожидаем **1** с текстом `expected exactly one new tarball`.
  2. Тест (падающий): вызвать `packController()` дважды подряд → оба вызова возвращают существующий непустой путь.
     Команда: `node --test --test-isolation=none tests/scripts-pack-idempotent.test.mjs` → FAIL.
  3. Реализация: **удалить одноимённый `.tgz` из `controllerDir` до вызова `pnpm pack`** (а не диффить имена). Предпочтительно вовсе не зависеть от `before`: `pnpm pack --pack-destination <outDir>` и брать целевой путь из него; если флаг недоступен — удалить `<name>-<version>.tgz`, вызвать пак, взять ровно этот путь, перенести в `.tmp/pack`.
  4. Команда: `node scripts/pack.mjs; node scripts/pack.mjs; $LASTEXITCODE` → `0` дважды.
  5. Убрать пустышку: `Remove-Item packages\controller\*.tgz -LiteralPath ...` → `Get-ChildItem packages\controller -Filter *.tgz` → пусто.
- **Гейт (готово когда):** `node scripts/pack.mjs; node scripts/pack.mjs; $LASTEXITCODE` → `0`, и в `packages\controller` **0** файлов `.tgz`.
- **Evidence:** воспроизведение падения + два успешных прогона; diff `pack.mjs`; проверка отсутствия `.tgz` в каталоге пакета.
- **Риски:** `--pack-destination` может отсутствовать в старых pnpm. Митигация: `Шаг 0` — проверить `corepack pnpm pack --help | Select-String 'pack-destination'`; фолбэк — удаление одноимённого файла.
- **Не делать:** не заменять проверку на «искать любой `.tgz`» — это скроет настоящую ошибку пака.
---

#### F-25 · Минимальный CI: три джобы, два разных гейта, тег `v0.1.0-m1`

- **Карточка:** MW-040/041 (правки: CI, тег), **P11**, дефект **R-21**.
- **Зависит:** F-01, F-11 (**обязательно:** `--frozen-lockfile` несовместим с грязным `pnpm-lock.yaml`), F-17, F-23, F-24 · **Усилие:** M · **Риск:** средний (первый прогон покажет красное) · **Откат:** удалить workflow/тег.
- **Цель:** воспроизводимый вход появляется, но **без иллюзии**: гейт, которому нужен `dsh` CLI, отделён от гейта, которому он не нужен.
- **Файлы:** Create `.github/workflows/ci.yml`; Create `.github/workflows/profile.yml` (или второй job в том же файле); git — tag `v0.1.0-m1`.
- **Проверенные факты:**
  1. **Исторический замер кампании v0.3 (2026-09-27):** `.github` не существовал (`Test-Path .github` → `False`), тегов было **0**. **Факт на 2026-10-03 (проверено заново):** `.github/workflows/ci.yml` **существует** (144 строки) и тег **`v0.1.0-m1`** существует (`git tag --list` → `v0.1.0-m1`) — то есть и workflow, и тег уже поставлены (шаги 2 и 7 ниже выполнены; см. дельту `02-PLATFORM-DELTA-0.2.0-rc.2.md` §7 «Исполнение плана в репозитории ушло вперёд»); `origin = https://github.com/definitely-stable/dsh-mywork.git` (`lead-03`, п. 16).
  2. Скрипты корня (`package.json:12-20`): `build` = `pnpm -r run build`; `typecheck` = `pnpm -r run typecheck`; `smoke` = `node scripts/smoke.mjs`; `test` = `node --test --test-isolation=none "tests/**/*.test.mjs"`; `check` = typecheck → build → smoke → test.
  3. **R-06:** канонический runner — **только** `corepack pnpm -r run <script>` (проверено: `-r` → EXIT=0; в кампании v0.3 это давало 12 пакетов, на 2026-10-03 — **15**, дельта `02-PLATFORM-DELTA-0.2.0-rc.2.md` §7.1 п.1). Файл `21-STEPS-execution.md` §1.5 **запрещает** предписывать `pnpm run build|check` как гейт — поэтому CI вызывает шаги **по отдельности**, а не `run check`.
  4. **R-21 — почему «CI зелёный на чистом клоне» неисполним как было:** `scripts/verify-profile.mjs` требует CLI `dsh` (`:22` вызывает `packController`, дальше — реальный `dsh`), **хэширует манифесты РЕАЛЬНОГО профиля** до и после (`verify-profile.mjs:5-10`), а шага установки DSH и создания дефолтного профиля в плане не было; `runs-on` не задан; `--frozen-lockfile` не связан с грязным `pnpm-lock.yaml` (F-11).
  5. `verify-profile.mjs:26-27` — `PROFILE = 'mywork-verify'`, `BUNDLE = '@dsh-mywork/controller'`; `:30-32` — `MOUNT_LINE`/`STOP_LINE`; `:5-10` — «every child process runs with `DSH_HOME` pointing at a fresh directory under `.tmp/`».
  6. Наблюдаемые длительности (отчёт): `tsdown` ≈ 204,7 с, тесты ≈ 87,6 с, smoke 13/13, `verify:profile` ≈ 10,5 с.
  7. `@deepseek-ai/dsh` опубликован: registry 200, `dist-tags.next = 0.1.7-rc.2` (`lead-03`, п. 17 — замер кампании v0.3) — значит CLI ставится из реестра, DSH-чек-аут в CI не нужен. **Актуализация 2026-10-03 (дельта платформы `0.2.0-rc.2`, §2.3 `02-PLATFORM-DELTA-0.2.0-rc.2.md`):** версия CLI для установки — **`@deepseek-ai/dsh@0.2.0-rc.2`** (`apps/cli/package.json` на `639ed0153`: `@deepseek-ai/dsh@0.2.0-rc.2`). Единственный точный пин — `.github/workflows/ci.yml:131`; **выполнено кампанией 2026-10-03** (коммит `d0b1f07` «pin CI to 0.2.0-rc.2»): строка 131 = `npm install -g @deepseek-ai/dsh@0.2.0-rc.2` — замены в шаге больше нет, гейт читает пин как есть (правка кода — владелец Lead, вне write-scope плана).
- **Шаги:**
  1. **Разделить гейт этапа 1 на два** (это и есть исправление R-21):
     - **Гейт L (локальный, без `dsh`):** `corepack pnpm -r run typecheck` → `0`; `corepack pnpm -r run build` → `0`; `node scripts/smoke.mjs` → `0`; `node --test --test-isolation=none "tests/**/*.test.mjs"` → `# fail 0`.
     - **Гейт P (профиль, требует `dsh`):** `where.exe dsh` → путь; `node scripts/verify-profile.mjs --dsh-bin <путь>` → `verify:profile: PASS`.
  2. Create `.github/workflows/ci.yml` — job `build-test`, **`runs-on: windows-latest`** (обязательно: скрипты и тесты Windows-специфичны — `cmd /c`, `where.exe`, пути `\`). Шаги: `actions/checkout` → `corepack enable` → `corepack pnpm -r run typecheck` → `corepack pnpm -r run build` → `node scripts/smoke.mjs` → `node --test --test-isolation=none "tests/**/*.test.mjs"`. **Гейт L.**
  3. Отдельный job `beads-backend`: установить Beads 1.3.0, прогнать `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# skipped 0`. Падение установки backend'а — **отдельная** ошибка, отличимая от «backend сломан» (F-17).
  4. Отдельный job `profile` (**гейт P**), `runs-on: windows-latest`, `needs: build-test`: `corepack enable` → `npm i -g @deepseek-ai/dsh@0.2.0-rc.2` → `dsh --version` → ожидаем `0.2.0-rc.2` → `node scripts/pack.mjs` (нужны F-23/F-24) → `node scripts/verify-profile.mjs --dsh-bin dsh` → `PASS`.
     **Что именно хэшируется (обязательно записать в workflow-комментарий):** `verify-profile.mjs:5-10` хэширует манифесты **реального** профиля (`$env:USERPROFILE\.dsh`) до и после. **В CI реального профиля нет** — на чистом раннере каталог пуст, поэтому проверка «хэши не изменились» **вакуумна**. Это не дефект, но и не доказательство: доказательством является только строка `verify:profile: PASS` (то есть tarball **поставился** и плагин **смонтировался** в изолированном `DSH_HOME`).
  5. **Связать с F-11:** до закрытия F-11 (`pnpm-lock.yaml` чистый) шаг с `--frozen-lockfile` в CI **не добавлять** — иначе первый же прогон упадёт на рассинхроне, и это будет ложная диагностика. После F-11: `corepack pnpm install --frozen-lockfile` первым шагом `build-test`.
  6. Прогнать гейт L локально (это делает Lead, не исполнитель шага — §5.4 брифа) → `EXIT=0`; гейт P — локально при наличии `dsh` в `PATH`, иначе только в CI.
  7. Поставить тег: `git tag -a v0.1.0-m1 -m "MyWork v0.1.0-m1: foundation baseline"` → `git tag --list 'v0.1.0-m1'`.
- **ГЕЙТ ЭТАПА 1 — два разных ожидаемых результата (готово когда):**
  - **Локально:** гейт L → все четыре команды успешны; `git tag --list 'v0.1.0-m1'` → `v0.1.0-m1`.
  - **В CI:** job `build-test` зелёный; job `beads-backend` → `# skipped 0`; job `profile` → `verify:profile: PASS`.
  - **Если `dsh` недоступен локально:** гейт P считается **не пройденным локально** и переносится в CI — это фиксируется в evidence, а не замалчивается.
- **Evidence:** файл workflow (оба job'а); вывод гейта L; вывод `dsh --version`; вывод `verify:profile`; `git tag --list`; явная запись «гейт P в CI вакуумен по хэшам профиля, доказательство — `PASS`».
- **Риски:** (а) первый прогон CI выявит красное — возможны падения 8 файлов, пишущих во временные SQLite при `--test-isolation=none` (P14); первый прогон **диагностический**, находки — отдельные шаги, а не «починка в этом шаге». (б) `npm i -g` в CI может тянуть сеть/кэш — версия пинится точной (`0.2.0-rc.2`), а не диапазоном.
- **РИСК КАМПАНИИ:** тег — git-мутация. В этой кампании **не выполнялся**.
- **Зависимость от D-решений:** D04 — влияет на имя тега (`v0.1.0-m1`), при расхождении шаг правится.
---

#### F-26 · Производный `INDEX.md` с `lastSyncedRevision`

- **Карточка:** `P8`, правка MW-054/055 · **Зависит:** F-01.
- **Усилие:** S · **Риск:** низкий · **Откат:** вернуть прежний `INDEX.md`.
- **Цель:** рукописный индекс становится **производным** артефактом: его можно пересобрать и проверить, а не сверять глазами.
- **Файлы:** Modify `.work/tasks/INDEX.md`; Create `scripts/ledger-index.mjs` (**вне моего write-scope** — заявка `card-ledger`); Create `tests/ledger-index.test.mjs`.
- **Проверенные факты:**
  1. `.work/tasks/` содержит **три** леджера: `INDEX.md` (10533 б), `tasks.json` (97884 б), плюс легаси-JSON доски: `board-actions.json` (214448 б), `board-export.json` (193386 б), `board-before.json` (438 б).
  2. `INDEX.md` сегодня **рукописный**: вводный абзац «Версия плана: v0.2, planRevision 2»; таблицы по этапам (`## 00-foundation`, `## 01-runtime`, `## 01b-board`) с колонками `ID | Задача | Зависимости | Статус`.
  3. Карточек в файлах — **55** (`MW-001.md`…`MW-055.md`), все присутствуют.
- **Шаги:**
  1. Тест (падающий): `buildIndex(tasks)` возвращает markdown, содержащий строку `lastSyncedRevision: <N>` и ровно по одной строке на карточку.
     Команда: `node --test --test-isolation=none tests/ledger-index.test.mjs` → FAIL.
  2. Реализация: генератор читает `tasks.json` (источник истины — id, title, stage, dependsOn, status) и пишет `INDEX.md`.
  3. `lastSyncedRevision` = ревизия леджера на момент сборки; при расхождении с фактической ревизией — индекс помечается устаревшим.
  4. Пересобрать: `node scripts/ledger-index.mjs` → `INDEX.md` диффится **только** в служебной части (если ручные разделы сохранены — они выносятся за маркеры `<!-- generated:begin -->`/`<!-- generated:end -->`).
  5. Команда: `node scripts/ledger-index.mjs --check; $LASTEXITCODE` → `0` (идемпотентность: повторный запуск не меняет файл).
- **Гейт (готово когда):** `node scripts/ledger-index.mjs --check; $LASTEXITCODE` → `0`
- **Evidence:** diff `INDEX.md`; вывод `--check`; строка `lastSyncedRevision`.
- **Риски:** генератор затрёт ручные пояснения владельца. Митигация: маркеры `generated:begin/end`; всё вне маркеров не трогается.

---

#### F-27 · Сверка `done`-множеств трёх леджеров + гейт этапа 1

- **Карточка:** `P8`/`P9`, F-08/F-09 · **Зависит:** F-09, F-26.
- **Усилие:** S · **Риск:** низкий · **Откат:** нет.
- **Цель:** расхождение «доска vs `tasks.json` vs `INDEX.md`» обнаруживается командой, а не глазами; правило `done` (F-08) становится проверяемым.
- **Файлы:** Create `scripts/ledger-sync.mjs` (заявка `card-ledger`); Create `tests/ledger-sync.test.mjs`.
- **Проверенные факты:** `FINAL-REPORT` §8.1: «55 карточек в трёх леджерах, статусы согласованы только по количеству»; §8.2 P8 — три леджера; P9 — «done» не означает успешный прогон (9 падений, `executions[].result` → 20 succeeded / 11 failed).
- **Шаги:**
  1. Тест (падающий): `compareLedgers({ board, tasksJson, index })` на фикстуре с расхождением → возвращает `{ mismatches: [...] }`, не бросает.
     Команда: `node --test --test-isolation=none tests/ledger-sync.test.mjs` → FAIL.
  2. Реализация: три источника (доска — authority, `tasks.json`, `INDEX.md`) → отчёт по `id`: `status`, `doneSet`, нарушители правила `done` (F-08).
  3. Тест (падающий): карточка `status=done` + `executions` с `failed` → попадает в `doneViolations`.
  4. Команда: `node --test --test-isolation=none tests/ledger-sync.test.mjs` → `pass 2 / fail 0`.
  5. Прогон на реальных данных: `node scripts/ledger-sync.mjs` → отчёт; ожидаем **7** `doneViolations` (ценз D19; в `FINAL-REPORT` §8.2 P9 стояло 9 — расхождение объяснить, не «подгонять»).
- **ГЕЙТ ЭТАПА 1 — готово когда одновременно:**
  - `MYWORK_REQUIRE_BEADS=1 node --test --test-isolation=none tests/beads-adapter.test.mjs` → `# fail 0`, `# skipped 0`
  - `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs tests/storage/migrations-required.test.mjs tests/storage/migration-journal.test.mjs` → `# fail 0`
  - `node scripts/pack.mjs; node scripts/pack.mjs; $LASTEXITCODE` → `0`
  - `node scripts/ledger-sync.mjs` → отчёт с объяснённым числом `doneViolations`
  - `git tag --list 'v0.1.0-m1'` → `v0.1.0-m1`
- **Evidence:** вывод пяти команд; отчёт `ledger-sync`; diff всех новых файлов.
- **Риски:** сверка выявит, что «источник истины» неочевиден. Правило: **доска — authority** (Host-леджер), `tasks.json` — экспорт, `INDEX.md` — производный (F-26). Расхождение — дефект, а не выбор.
- **Зависимость от D-решений:** D19 (правило приёмки).

---

## 2bis. Этап 1 — дополнение: аллокатор версий миграций (`F-63`)

Дефект **R-36**: правило «версия выделяется единым аллокатором» (§15.3) в файле было, а **шага, который этот аллокатор создаёт, — не было**. Из-за этого `21-STEPS-execution.md` (`E-04`, `E-19`, `E-28`, `E-34`, `E-37`) и `22-STEPS-surface.md` (`B-12`) стоят со статусом «блокировано до появления аллокатора». Нумерация `F-01`…`F-62` не менялась.

---

#### F-63 · Аллокатор версий миграций в composition-слое

- **Карточка:** **MW-059** (расширение: реестр миграций + аллокатор), правка MW-004/MW-040 · **ADR-действие:** D08 · **Дефект:** R-36, §15.3.
- **Зависит:** **F-18** (канонический реестр), **F-19** (запрет открытия без него), **F-20** (journal verify) · **Разблокирует:** `21-…` **E-04, E-19, E-28, E-34, E-37**; `22-…` **B-12**; а также F-37 и F-40 этого файла (их заявки перестают быть литералами).
- **Усилие:** M · **Риск:** средний (неверный номер ломает открытие store) · **Откат:** revert коммита; таблица заявок остаётся, но перестаёт использоваться.
- **Цель:** существует **единственное** место, выдающее номера версий миграций; номер нельзя ни задублировать, ни переиспользовать после перезапуска.
- **Файлы:** Modify `packages/storage/src/migrations.ts:96-103` (`JOURNAL_DDL` — добавить таблицу заявок рядом с `schema_migrations`); Create `packages/controller/src/migration-allocator.ts` (**composition-слой по D07 — `packages/controller`**, пакет существует, ждать F-28 не нужно); Create `tests/storage/migration-allocator.test.mjs`.
- **Проверенные факты:**
  1. **Почему аллокатор не нуждается в собственном номере версии (разрыв цикличности):** `migrations.ts:96-103` — `JOURNAL_DDL` создаёт `schema_migrations` **до** запуска любой миграции (`:147` — `connection.exec(JOURNAL_DDL)` вызывается первым в `runMigrations`). Таблица заявок создаётся **в том же блоке** и по той же причине — она существует раньше, чем появляется первая версия, поэтому сама версии не требует.
  2. `migrations.ts:97-103` — DDL уже `CREATE TABLE IF NOT EXISTS` ⇒ существующие базы получают таблицу без отдельной миграции.
  3. `migrations.ts:111-129` — `validateMigrations` требует **строго возрастающих уникальных** версий; дубль = `StorageError` ⇒ **store не откроется вовсе** (падает F-29/F-30, а не отдельный шаг). Это и есть цена ошибки.
  4. `migrations.ts:142-184` — `runMigrations` уже перечитывает версию под write-lock (`:160-163`), поэтому аллокатор обязан быть **идемпотентным по заявке**, а не «выдавать номер при каждом вызове».
  5. `migrations.ts:190-198` — `listAppliedMigrations` даёт занятые версии из `schema_migrations`; `store.ts:45-46` — `schemaVersion` из `PRAGMA user_version`.
  6. **Занято сегодня (не константа, а наблюдаемое состояние):** v1 kernel (storage), v2–v3 evidence, v4 lease, v5 planner, v6 execution.
  7. **Одновременные заявки, которые обязаны получить разные номера:** `background_job` (F-37), триггеры retention (F-40), `attempt_worktree` (`E-04`), `placement-projection` (`B-12`), плюс последующие (`E-19`, `E-28`, `E-34`, `E-37`).
- **Интерфейс (контракт шага):**
  - `interface MigrationRequest { readonly key: string }` — `key` — **стабильный** идентификатор заявки (`'background_job'`, `'retention-triggers'`, `'attempt_worktree'`, `'placement-projection'`), а не имя файла и не номер.
  - `interface MigrationAllocator { allocate(request: MigrationRequest): number; allocated(): readonly Allocation[] }`.
  - `interface Allocation { readonly key: string; readonly version: number; readonly requestedAt: number }`.
  - Таблица: `migration_allocations (key TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, requested_at INTEGER NOT NULL)` — `UNIQUE(version)` и есть машинная защита от дубля.
- **Шаги:**
  1. Тест (падающий): **идемпотентность по заявке** — два вызова `allocate({ key: 'background_job' })` дают **один и тот же** номер.
     Команда: `node --test --test-isolation=none tests/storage/migration-allocator.test.mjs` → FAIL (модуля нет).
  2. Тест (падающий): **разные заявки — разные номера** — `allocate({key:'a'})` ≠ `allocate({key:'b'})`, и оба строго больше **наибольшей занятой** версии (сегодня 6; значение берётся из реестра/`schema_migrations`, **не литералом**).
  3. Тест (падающий): **перезапуск не выдаёт занятый номер** — после закрытия и повторного открытия store `allocate({key:'a'})` возвращает тот же номер, а `allocate({key:'c'})` — новый, не равный ни одному ранее выданному.
  4. Тест (падающий): **номер не переиспользуется после исчезновения заявки** — удаление строки заявки из `migration_allocations` **не** делает её номер свободным: следующий `allocate` берёт `max(занятые, выданные) + 1` (номер «сгорает»).
  5. Тест (падающий): **собранный список проходит валидацию** — канонический реестр, в который добавлены миграции с выданными номерами, не бросает в `validateMigrations` (`migrations.ts:111-129`), то есть дублей нет.
  6. Реализация: `migration-allocator.ts` в `packages/controller` — `allocate` в **одной транзакции**: `INSERT INTO migration_allocations … ON CONFLICT(key) DO NOTHING` → `SELECT version WHERE key = ?`; при отсутствии строки — `max(...) + 1`, где `max` берётся как максимум из (а) `schema_migrations`, (б) `PRAGMA user_version`, (в) `migration_allocations.version`. **Ни один номер не пишется литералом в коде.**
  7. Команда: `node --test --test-isolation=none tests/storage/migration-allocator.test.mjs` → `pass 5 / fail 0`; регрессия `node --test --test-isolation=none tests/storage/migrations-registry.test.mjs tests/storage/migrations-required.test.mjs tests/storage/migration-journal.test.mjs` → `# fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/migration-allocator.test.mjs` → `# pass 5`, `# fail 0`; и `Select-String -Path packages\controller\src\migration-allocator.ts -Pattern 'version: \d'` → **0** совпадений (номер не литерал).
- **Evidence:** вывод теста; DDL таблицы заявок; вывод «занято до / выдано после»; список заявок с выданными номерами; подтверждение, что `validateMigrations` не бросил.
- **Риски:** (а) **неверный номер ломает открытие store** — митигация: `UNIQUE(version)` + тест 5 на валидацию; (б) аллокатор вызывается **вне** транзакции и два процесса получают один номер — митигация: `allocate` целиком в одной транзакции, `UNIQUE(key)` и `UNIQUE(version)` делают гонку невозможной; (в) соблазн «выдать номер при каждом вызове» — митигация: тест 1 (идемпотентность по заявке).
- **Откат:** revert коммита. Таблица `migration_allocations` остаётся в базе (безвредна, `IF NOT EXISTS`), но перестаёт читаться; занятые номера при этом **не** освобождаются — это осознанно.
- **Не делать:** не выдавать номер по имени файла или по порядку объявления в коде; не писать `version: 7` (или любой другой номер) литералом ни в шаге, ни в миграции; не заводить аллокатору собственную версию миграции — цикличность разорвана bootstrap-DDL (факт 1).
- **Зависимость от D-решений:** **D08** — принято (вариант B: единый реестр + запрет открытия без него); аллокатор — недостающая половина этого решения. **D07** — место (composition-слой, `packages/controller`).
- **Стык с другими файлами:** после закрытия F-63 снимается блокировка `21-…` (`E-04`, `E-19`, `E-28`, `E-34`, `E-37`) и `22-…` (`B-12`); их владельцы ссылаются на **F-63** как на поставщика номера.
## 3. Этап 2 — соединить подсистемы (3–7 дней)

Гейт этапа: **F-46**. Тема: 31,7 % строк `src` недостижимы из runtime, ни одной живой `*.sqlite`, нет ограничителей роста БД, boundary-тест дырявый.

**Точка входа для всего этапа:** `packages/controller/src/index.ts:115-128` — `apply(ctx, config)` сегодня публикует только `myworkController` и `myworkAdapters` и монтирует `mountModelCatalog` / `mountDshRuntime`. **Ни один store не открывается.** Это и есть дыра P4.

---

#### F-28 · Composition root: application service `myworkApplication`

- **Карточка:** **MW-058** (новая) · **ADR-действие:** D07 · **Зависит:** F-01.
- **Разблокирует:** F-29…F-32, F-45, F-51; **является единственным composition root** — второй не создаётся.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert коммита.
- **Цель:** появляется один объект, который владеет жизненным циклом подсистем и умеет корректно останавливаться.
- **Файлы:** Create `packages/controller/src/app.ts`; Modify `packages/controller/src/index.ts:115-128`; Create `tests/app-lifecycle.test.mjs`.
- **Проверенные факты:**
  1. `controller/src/index.ts:115-128` — `apply` создаёт `MyWorkControllerService` и `MyWorkAdaptersService`, регистрирует два `ctx.effect(...)` (`:117` — `service.stop()`, `:119` — `adapters.close()`), затем `mountModelCatalog(ctx, adapters)` `:123` и `mountDshRuntime(ctx, adapters)` `:127`.
  2. `controller/src/index.ts:104-107` — `interface Config { diagnostics?: boolean }`; `:136-139` — `resolveClock(ctx)` берёт `MYWORK_CLOCK_SERVICE`, иначе `systemClock`. Часы уже инъектируемы — это готовый шов для D11 (scheduler).
  3. `controller/src/index.ts:92-101` — `name`, `CONTROLLER_VERSION = '0.1.0'`, `BOUNDED_CONTEXTS = ['control']`.
- **Шаги:**
  1. Тест (падающий): `createMyWorkApplication({ clock, layout, diagnostics: false })` → объект с `start()`/`stop()`, идемпотентный `stop()` дважды не бросает.
     Команда: `node --test --test-isolation=none tests/app-lifecycle.test.mjs` → FAIL.
  2. Реализация `app.ts`: класс/фабрика `createMyWorkApplication(options)`, поля `readonly store?: MyWorkStore` (появится в F-29), `readonly services: readonly Disposable[]`, методы `start()`/`stop()`.
  3. `apply` в `index.ts` вызывает `createMyWorkApplication(...)` и регистрирует **один** `ctx.effect(() => () => app.stop())` вместо двух раздельных.
  4. Команда: `node --test --test-isolation=none tests/app-lifecycle.test.mjs` → `pass 2 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/app-lifecycle.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** новый файл; diff `index.ts`; вывод теста.
- **Риски:** «второй composition root» — главный риск этапа. Митигация: `app.ts` — **единственное** место, где открывается store; любой новый код обязан получать store из `app`, а не открывать сам.
- **Зависимость от D-решений:** **D07** — принято (вариант B): «application service **`myworkApplication`** внутри `packages/controller`, **расширяющий существующий `apply`**». Имя сервиса и место — из решения, не гипотеза.

---

#### F-29 · Composition root: открыть `controller.sqlite` полным списком миграций

- **Карточка:** MW-058 · **Зависит:** F-18, F-19, F-28.
- **Усилие:** S · **Риск:** средний (первое реальное создание БД) · **Откат:** revert; удалить созданный файл.
- **Цель:** приложение создаёт **живую** `controller.sqlite` на версии 6 в `$DSH_HOME\dsh-mywork\state\`.
- **Файлы:** Modify `packages/controller/src/app.ts`; Create `tests/app-store.test.mjs`.
- **Проверенные факты:**
  1. Путь: `packages/storage/src/layout.ts:91-93` — `stateDatabasePath(layout, 'controller')` = `join(layout.stateDir, 'controller.sqlite')`; `:33-36` — `MYWORK_STATE_DATABASES = ['registry','controller']`; `:76-84` — `resolveMyWorkLayout()` c приоритетом `options.dshHome` → `$DSH_HOME` → `~/.dsh`; `:24-27` — `dsh-mywork`/`state`.
  2. `packages/storage/src/index.ts:6` в JSDoc уже показывает `openStore({ path: stateDatabasePath(layout, 'registry') })` — то есть намерение зафиксировано, кода нет.
  3. Отчёт (§8.1): «ни одной живой `*.sqlite`».
- **Шаги:**
  1. Тест (падающий): `app.start()` с `dshHome = <temp>` → `fs.existsSync(join(temp,'dsh-mywork','state','controller.sqlite'))` → `true`.
     Команда: `node --test --test-isolation=none tests/app-store.test.mjs` → FAIL.
  2. Тест (падающий): `PRAGMA user_version` открытой базы → `6` (F-18); `schema_migrations` содержит 6 строк.
  3. Реализация: `createMyWorkApplication` резолвит layout, создаёт `stateDir` (`mkdirSync(..., { recursive: true })`), вызывает `openStore({ path, migrations: MYWORK_DATABASE_MIGRATIONS })`, сохраняет `store`.
  4. Команда: `node --test --test-isolation=none tests/app-store.test.mjs` → `pass 2 / fail 0`.
  5. Проверить отсутствие утечки: `app.stop()` закрывает store → повторный `store.transaction(...)` бросает `store-closed` (`store.ts:56-57`).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/app-store.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** вывод теста; листинг созданного каталога с `controller.sqlite`; `PRAGMA user_version` → 6.
- **Риски:** неверный `$DSH_HOME` создаст базу в **живом** доме пользователя. Митигация: тесты обязаны передавать `dshHome` явно; гейт F-32 проверяет дом **изолированно**.
- **Зависимость от D-решений:** D07, D08.

---

#### F-30 · Composition root: поднять lease / planner / execution / scheduler / evidence

- **Карточка:** MW-058 · **Зависит:** F-29.
- **Усилие:** M · **Риск:** средний · **Откат:** revert; подсистемы остаются недостижимыми, как сейчас.
- **Цель:** четыре из двенадцати пакетов становятся достижимыми из runtime (P4: было 4 из 12).
- **Файлы:** Modify `packages/controller/src/app.ts`.
- **Проверенные факты:**
  1. Подсистемы вызываются вызывающим: `lease/src/lifecycle.ts:105` — `readonly openStores: () => Promise<ControllerStores<TStore>> | ControllerStores<TStore>`; `:236` — `this.stores = await this.options.openStores()`; `lease/src/index.ts:18` — `openStores: async () => ({ registry, controller: store })`.
  2. `planner/src/service.ts:102` — «Store opened with `MYWORK_MIGRATIONS`, `EVIDENCE_MIGRATIONS`, and the plan migration».
  3. `execution/src/service.ts:251` — проверяет `{ version: CLAIM_SAGA_SCHEMA_VERSION, name: CLAIM_SAGA_SCHEMA_NAME }` (v6).
  4. `evidence/src/store.ts:85-91` — проверяет v3.
  5. `storage/src/index.ts:6` — пример адресует **две** базы: `registry` и `controller`.
- **Шаги:**
  1. Поднять lease: `createControllerLifecycle({ openStores: async () => ({ registry: registryStore, controller: store }) })` — **два** store, оба на `MYWORK_DATABASE_MIGRATIONS`.
     `Шаг 0`: подтвердить сигнатуру `ControllerStores` в `packages/lease/src/lifecycle.ts` (точные поля не проверены — `~`).
  2. Поднять planner и evidence на `controller.sqlite` (тот же файл, тот же полный список миграций).
  3. Поднять execution (claim saga) и scheduler — с инъектированными часами из `resolveClock` (`controller/src/index.ts:136-139`), а не с системными напрямую (D11).
  4. Тест (падающий): `app.start()` → `app.services` содержит записи для пяти подсистем; `node --test --test-isolation=none tests/app-subsystems.test.mjs` → FAIL.
  5. Команда: `node --test --test-isolation=none tests/app-subsystems.test.mjs` → `pass 1 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/app-subsystems.test.mjs` → `# pass 1`, `# fail 0`; и `Select-String -Path packages\controller\src\app.ts -Pattern 'openStore\('` → ровно **2** (registry + controller), не больше.
- **Evidence:** diff `app.ts`; вывод теста; число достижимых пакетов до/после (граф — `FINAL-REPORT` §8.1: было 4 из 12).
- **Риски:** неверный порядок старта даст «store не открыт» в момент первого вызова. Митигация: старт строго последовательный, `await` на каждом шаге; `stop()` — в обратном порядке.
- **Зависимость от D-решений:** D07; **D11** — принято (вариант B): «расширить `ClockPort` до `now`/`sleep`/таймеров и передавать его во все сервисы через application service (D07)». Значит шаг 3 обязан передать **расширенный** `ClockPort`, а не только `now`.

---

#### F-31 · Composition root: регистрация в `myworkAdapters` (+ точки подключения Context/Memory/Skill)

- **Карточка:** MW-058 · **Зависит:** F-30 · **Разблокирует:** F-45, F-51, а также шаги `23-STEPS-quality.md` (Context/Skill/Memory).
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** реестр адаптеров перестаёт быть пустым: подсистемы видны через `ctx.myworkAdapters`, а не только через прямые ссылки.
- **Файлы:** Modify `packages/controller/src/app.ts`; Modify `packages/controller/src/index.ts:118-127`.
- **Проверенные факты:**
  1. `controller/src/index.ts:26-33` — импортируются `MYWORK_ADAPTERS_SERVICE`, `MYWORK_CLOCK_SERVICE`, `MYWORK_CONTROLLER_SERVICE` из `@dsh-mywork/contracts`.
  2. `controller/src/index.ts:118-119` — `const adapters = new MyWorkAdaptersService(ctx)`, `ctx.effect(() => () => adapters.close(), 'mywork adapters shutdown')`.
  3. `controller/src/index.ts:123,127` — сегодня регистрируются ровно **два** адаптера: `mountModelCatalog` (`:57`) и `mountDshRuntime` (`:75`).
  4. `adapter-sdk` — источник `createAdapterRegistry`, `AdapterRegistration`, `AdapterRegistrationHandle` (`controller/src/index.ts:14-25`).
- **Шаги:**
  1. `app.start()` получает `adapters` и регистрирует: taskgraph (Beads), planner, execution, evidence, scheduler.
  2. Каждая регистрация возвращает `AdapterRegistrationHandle`; `app.stop()` снимает их (`handle.dispose()`), чтобы повторный mount не дублировал записи.
  3. Тест (падающий): `app.start(); app.stop(); app.start()` → реестр снова содержит ровно N записей (идемпотентность mount/unmount).
     Команда: `node --test --test-isolation=none tests/app-adapters.test.mjs` → FAIL.
  4. Команда: `node --test --test-isolation=none tests/app-adapters.test.mjs` → `pass 2 / fail 0`.
  5. **Точки подключения для `23-…`:** Context/Memory/Skill монтируются **здесь же**, через `adapters.register(...)`, а не отдельной фабрикой. Это единственная точка входа — второй composition root не создаётся.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/app-adapters.test.mjs` → `# pass 2`, `# fail 0`; и `app.start(); app.stop(); app.start()` не даёт дублей в реестре.
- **Evidence:** diff; вывод теста; список зарегистрированных id адаптеров.
- **Риски:** `.close()` адаптеров вызывается дважды (один раз в `app.stop()`, второй — в существующем `ctx.effect` `index.ts:119`). Митигация: единственный владелец жизненного цикла — `app`; `index.ts` регистрирует только `app.stop()`.
- **Зависимость от D-решений:** **D10** — принято (вариант C, «мост в одну сторону»): «Навыки: MyWork-реестр — истина, публикация в `ctx.skills`. Память: **остаётся своя** (шва нет). Текст: `ctx.systemPrompt.section`». Точки подключения: (а) публикация навыков в `ctx.skills`; (б) `ctx.systemPrompt.section` для текста; (в) **память через `myworkAdapters`** — своего шва к платформе у неё нет.

---

#### F-32 · Composition root: smoke в изолированном `DSH_HOME`

- **Карточка:** MW-058 · **Зависит:** F-29, F-31.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** внешняя проверка «плагин реально монтируется и реально открывает store» — без чтения внутренностей.
- **Файлы:** Modify `scripts/smoke.mjs` (добавить проверку store); Create `.work/plan-v0.3/evidence/foundation-32-smoke.md`.
- **Проверенные факты:**
  1. `scripts/smoke.mjs:1-11` — «Mounts the built controller plugin on a real Cordis context, asserts the published service and its lifecycle, unloads it… Keyless by construction: no model, no provider, no subprocess, and no wall-clock dependency».
  2. `scripts/smoke.mjs:17-23` — список проверяемых entry-точек (`contracts`, `core`, `adapterSdk`, `testing`, `controller`).
  3. `scripts/verify-profile.mjs:5-10` — «every child process runs with `DSH_HOME` pointing at a fresh directory under `.tmp/`, and the script hashes the real profile manifests before and after to prove they did not change».
  4. Отчёт: smoke 13/13, `verify:profile: PASS` (10,5 с).
- **Шаги:**
  1. В `smoke.mjs` выставить `process.env.DSH_HOME` на свежий каталог под `.tmp/` **до** монтирования плагина.
  2. После монтирования проверить существование файла: `existsSync(join(dshHome,'dsh-mywork','state','controller.sqlite'))`.
  3. Проверить, что файл непустой и версия схемы — 6.
  4. Команда: `node scripts/smoke.mjs; $LASTEXITCODE` → `0`, и число проверок стало **≥14** (было 13).
- **ГЕЙТ ЭТАПА 2, часть A (готово когда):** `node scripts/smoke.mjs` → `EXIT=0` и `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite` → `True` (формулировка из `FINAL-REPORT` §10, этап 2, п.6).
- **Evidence:** вывод smoke; `Get-Item` созданного `.sqlite`.
- **Риски:** smoke начнёт писать в живой дом. Митигация: `DSH_HOME` выставляется **внутри** процесса до первого `resolveMyWorkLayout()`; гейт проверяет только изолированный путь.

---

#### F-33 · Атомарная запись состояния: `writeFileAtomic`

- **Карточка:** MW-004/039/040 (правка: «атомарная запись (`writeFileAtomic`/`withFileLock`)»), RT-1, RT-10.
- **Зависит:** F-29 · **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** появляется единственный примитив «записать файл состояния так, чтобы обрыв не оставил половину».
- **Файлы:** Create `packages/storage/src/atomic.ts`; Create `tests/storage/atomic-write.test.mjs`.
- **Проверенные факты:**
  1. `Select-String -Path packages\storage\src\*.ts -Pattern 'writeFileAtomic|withFileLock|fsync|\.tmp'` → **0 совпадений** (в storage нет ни одного из примитивов).
  2. `storage/src/sql.ts` — единственный низкоуровневый модуль; экспортирует `openSqlite`, `withTransaction`, `SqlExecutor`, `SqliteConnection` (импорт в `store.ts:25`).
  3. `tests/storage-crash.test.mjs` (4445 б) и `tests/lib/crash-child.mjs` (1726 б) — **уже есть** инфраструктура краш-тестов, её нужно переиспользовать, а не строить заново.
- **Шаги:**
  1. Тест (падающий): `await writeFileAtomic(path, 'payload')` → `readFileSync(path)` → `'payload'`, и в каталоге **нет** остаточных `*.tmp`.
     Команда: `node --test --test-isolation=none tests/storage/atomic-write.test.mjs` → FAIL.
  2. Тест (падающий, обрыв): подменить `rename` на бросающую функцию → `writeFileAtomic` оставляет **прежнее** содержимое целевого файла и убирает временный.
  3. Реализация: писать в `<target>.<pid>.<rand>.tmp` в **том же каталоге**, `fsync` дескриптора, затем `rename` (атомарен в пределах тома), `fsync` каталога.
  4. Команда: `node --test --test-isolation=none tests/storage/atomic-write.test.mjs` → `pass 2 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/atomic-write.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** новый файл; вывод теста; доказательство «до» — 0 совпадений grep.
- **Риски:** `rename` через границу тома не атомарен. Митигация: временный файл создаётся **в том же каталоге**, что и цель (не в `os.tmpdir()`).
- **Зависимость от D-решений:** D08.

---

#### F-34 · Атомарная запись: `withFileLock` и single-writer дисциплина

- **Карточка:** MW-004/039/040 · **Зависит:** F-33.
- **Усилие:** S · **Риск:** средний · **Откат:** revert.
- **Цель:** два процесса не пишут один и тот же файл состояния одновременно.
- **Файлы:** Modify `packages/storage/src/atomic.ts`; Create `tests/storage/file-lock.test.mjs`.
- **Проверенные факты:**
  1. В `storage` **нет** `withFileLock` (0 совпадений, см. F-33).
  2. `store.ts:27-28` — `DEFAULT_BUSY_TIMEOUT_MS = 5_000`; `:72-73` — `busyTimeoutMs` в опциях; `:93` — передаётся в `openSqlite`. То есть **на уровне SQLite** конкуренция уже обработана.
  3. `migrations.ts:157-174` — повторное чтение версии под write-lock (комментарий `:162-163`: «another process may have applied this migration while we waited for it»).
- **Шаги:**
  1. `Шаг 0`: определить, какие файлы состояния пишутся **вне** SQLite. Сегодня таких, судя по grep, нет — значит `withFileLock` нужен для будущих (экспорт/импорт MW-040, backup). Если список пуст — шаг **обоснованно откладывается** и это фиксируется в evidence.
  2. Тест (падающий): `withFileLock(path, fn)` — второй параллельный вызов с тем же путём не входит в `fn`, пока первый не вышел (таймаут → типизированный отказ `LOCK_TIMEOUT`).
     Команда: `node --test --test-isolation=none tests/storage/file-lock.test.mjs` → FAIL.
  3. Реализация: лок-файл `<target>.lock` с `O_EXCL`, PID и временем; stale-lock детектится по возрасту.
  4. Команда: `node --test --test-isolation=none tests/storage/file-lock.test.mjs` → `pass 2 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/file-lock.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** вывод теста; **список** файлов состояния, к которым применён лок (если пуст — обоснование отсрочки).
- **Риски:** лишний слой лока поверх SQLite даёт взаимоблокировки. Митигация: `withFileLock` **не** применяется к `.sqlite` — только к одиночным файлам (backup/journal/export).
- **Зависимость от D-решений:** D08.

---

#### F-35 · SQLite-настройки открытия: `synchronous` и `auto_vacuum`

- **Карточка:** MW-004/039/040 · **Зависит:** F-29.
- **Усилие:** S · **Риск:** средний (режим синхронизации влияет на долговечность) · **Откат:** revert.
- **Цель:** зафиксированы недостающие настройки долговечности и роста файла; WAL и `foreign_keys` **уже есть** и проверяются тестом, а не переоткрываются.
- **Файлы:** Modify `packages/storage/src/sql.ts` (`:94`, `:118`, `:129-138`); Create `tests/storage/sqlite-pragmas.test.mjs`.
- **Проверенные факты (независимая проверка, `evidence/foundation-12-sqlite.md`):**
  1. **`journal_mode` уже WAL:** `packages/storage/src/sql.ts:130` — `journal_mode = WAL`, с fail-closed перечитыванием результата `sql.ts:131-138`. Режим `delete` — только дефолт «голого» `DatabaseSync` (проверено пробой в `%TEMP%`: `JOURNAL_MODE_DEFAULT={"journal_mode":"delete"}`, exit 0), который перекрывается вызовом `configure()`.
  2. `foreign_keys = ON` — `sql.ts:129`.
  3. `busy_timeout` — **опция драйвера**, а не PRAGMA: `sql.ts:94` (`{ timeout }`), значение по умолчанию `DEFAULT_BUSY_TIMEOUT_MS = 5_000` (`store.ts:27-28`).
  4. `user_version` — `sql.ts:118` (чтение), `:142-145` (запись).
  5. **НЕ выставляются: `synchronous` и `auto_vacuum`** — `Select-String -Path packages\storage\src\*.ts -Pattern 'journal_mode|synchronous|foreign_keys|auto_vacuum|VACUUM|busy_timeout|PRAGMA'` → совпадений по `synchronous` и `auto_vacuum` нет. Фактически `synchronous = 2 (FULL)` даже в WAL, `auto_vacuum = 0`.
  6. **`VACUUM` в исполняемом коде отсутствует** — встречается только в `.work/**`.
- **Шаги:**
  1. Тест (падающий, регрессия — не переоткрывать): после `openStore` → `PRAGMA journal_mode` возвращает `wal`, `PRAGMA foreign_keys` → `1`. Если это уже зелено — шаг 1 закрыт сразу, и это фиксируется в evidence как «не дефект».
     Команда: `node --test --test-isolation=none tests/storage/sqlite-pragmas.test.mjs` → FAIL (файла теста нет).
  2. Тест (падающий, реальный пробел): `PRAGMA synchronous` → `1 (NORMAL)`; сейчас — `2 (FULL)`.
  3. Тест (падающий, реальный пробел): `PRAGMA auto_vacuum` → `2 (incremental)`; сейчас — `0`.
  4. Реализация: в `configure()` (`sql.ts:~125-140`) добавить `synchronous = NORMAL` и `auto_vacuum = INCREMENTAL`; **`auto_vacuum` применяется только до создания схемы** — значит либо выставляется при первом создании файла, либо требует `VACUUM` (стык с F-39).
  5. Команда: `node --test --test-isolation=none tests/storage/sqlite-pragmas.test.mjs` → `pass 3 / fail 0`; регрессия `node --test --test-isolation=none tests/storage.test.mjs tests/storage-crash.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/sqlite-pragmas.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод grep «до»; вывод тестов; три значения PRAGMA до/после; цитаты `sql.ts:129,130,94,118,142-145`.
- **Риски:** `synchronous = NORMAL` в WAL теряет последние коммиты при крахе ОС (не при крахе процесса). Митигация: значение — параметр конфигурации; по умолчанию `NORMAL` (стандартная рекомендация для WAL), `FULL` доступен явно. `auto_vacuum` меняется только через `VACUUM` → согласовать с F-39, не делать двух `VACUUM` подряд.
- **Опровержение базы:** рабочая гипотеза «WAL не выставлен» **опровергнута** (см. §5, строка 11). Шаг переписан с WAL-задачи на реальные пробелы.
- **Зависимость от D-решений:** D08 — принято (вариант B: атомарность, WAL, migration journal); WAL уже реализован, шаг закрывает остаток.

---

#### F-36 · Durable jobs: выбор носителя

- **Карточка:** **MW-068** (диапазон MW-065…MW-069, durable jobs) · **ADR-действие:** D09.
- **Зависит:** F-35 · **Разблокирует:** F-37.
- **Усилие:** S (решение + тест) · **Риск:** низкий · **Откат:** решение пересматривается.
- **Цель:** зафиксирован носитель durable-джобов, обоснованный тем, что платформенный `LocalJobRegistry` **не** durable.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-36-jobs-carrier.md`; Create `tests/storage/jobs-schema.test.mjs`.
- **Проверенные факты (D09, вариант B — «`controller.sqlite` — истина, `jobs-local` — не используется вовсе, чтобы не было двух реестров»):**
  1. `C:\Reposit\deepseek-harness\deepseek-harness\packages\jobs\jobs-local\src\index.ts:1-11` — заголовок модуля (цитата из D09): «Process-local provider for the background-job capability seam (`ctx.jobs`). It keeps every job — lifecycle state, the bounded output ring, and the model cursor — **in memory** and hands out fresh projections and chunk copies, never live state».
  2. Там же `:19` — `import { JobRegistry, JobId } from '@deepseek-ai/dsh-jobs'`; `:35-39` — `DEFAULT_RETAIN_BYTES = 256 * 1024`, `DEFAULT_SETTLED_RETAIN_BYTES = 16 * 1024`.
  3. Там же `:123-128` — `/** The in-memory `jobs` registry. … */ export class LocalJobRegistry extends JobRegistry`; `:160` — `private store = new Map<JobId, TrackedJob>()`.
  4. `lib/index.js:370-371,388` — `store = new Map()`, `counters = new Map()`, `ownerCleanups = new Map()`; `lib/types/index.d.ts:19` — «Configuration for the **process-local** job registry» (ссылки из D09).
  5. `FINAL-REPORT` §9.2(5) — «`LocalJobRegistry` — **не durable** … durable-часть придётся строить на MyWork DB»; D09 подтверждает и уточняет: строим **свою таблицу**, `jobs-local` **не используем вовсе**.
  6. Транзакция уже несёт мутацию вместе с событиями: `packages/storage/src/store.ts:30-39` — `MyWorkTransaction { outbox, inbox }`; значит регистрация работы и её событие уедут одним коммитом.
  7. Место для durable-вывода уже есть: `packages/evidence/src/schema.ts:47-75` — таблицы `artifacts`/`audit_events`; большой вывод идёт **артефактом**, а не строкой.
- **Шаги:**
  1. Тест (падающий): канонический список миграций содержит миграцию с таблицей **`background_job`** (колонки: `job_id`, `kind`, `status`, `owner`, `payload`, `attempts`, `created_at`, `updated_at`, `lease_until`), **и её номер выдан аллокатором версий (R-04), а не записан литералом**. Тест проверяет **уникальность** номера относительно уже занятых (`background_job` — одна из четырёх одновременных заявок: F-37, F-40, `E-04`, `B-12`).
     Команда: `node --test --test-isolation=none tests/storage/jobs-schema.test.mjs` → FAIL.
  2. Тест (падающий, негативный): `background_job` **не** наследует триггеры запрета `DELETE` (F-40) — работы обязаны завершаться и чиститься.
  3. Тест (падающий): в `packages/contracts` появились `BackgroundJobKind` и состояния; `JobView` платформы **не** импортируется в контракты (иначе покраснеет `tests/boundaries.test.mjs`).
  4. Записать в evidence: носитель — таблица `background_job` в `controller.sqlite`; `jobs-local` не используется **вовсе**; у платформы заимствованы только размеры буфера вывода (256 KiB живого / 16 KiB завершённого, `jobs-local/src/index.ts:35-39`).
  5. Команда: `node --test --test-isolation=none tests/storage/jobs-schema.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/jobs-schema.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод теста; цитаты `jobs-local/src/index.ts:1-11,35-39,123-128,160`; строка решения D09.
- **Риски:** таблица в `controller.sqlite` конкурирует за write-lock с доменом. Митигация: D09 предусматривает пересмотр — при конкуренции выносится **отдельный файл**, но **не** второй реестр в памяти.
- **Зависимость от D-решений:** **D09** — принято (вариант B; `jobs-local` не используется вовсе).

---

#### F-37 · Durable jobs: реализация реестра поверх таблицы `background_job`

- **Карточка:** MW-068, правка MW-033/040 («Durable jobs для optimizer/миграции/импорта» — **с поправкой D09**: носитель — таблица `background_job` в `controller.sqlite`, `jobs-local` не используется вовсе).
- **Зависит:** F-36.
- **Усилие:** M · **Риск:** средний · **Откат:** revert.
- **Цель:** джоб переживает рестарт процесса: после `app.stop(); app.start()` незавершённый джоб снова виден и продолжается.
- **Файлы:** Create `packages/storage/src/background-jobs.ts`; Create `tests/storage/jobs-durable.test.mjs`.
- **Проверенные факты:** `tests/lib/mw019-restart-child.mjs` (3306 б) — инфраструктура «рестарт в дочернем процессе» **уже есть**; переиспользовать, а не строить.
- **Шаги:**
  1. Тест (падающий): `enqueue(kind, payload)` → `list()` содержит джоб со `status='pending'`; после закрытия и повторного открытия store — тот же джоб.
     Команда: `node --test --test-isolation=none tests/storage/jobs-durable.test.mjs` → FAIL.
  2. Тест (падающий): `claimDue()` берёт джоб и ставит `lease_until = now + leaseMs`; второй `claimDue()` до истечения лизы его не берёт.
  3. Тест (падающий): джоб с истёкшей лизой снова доступен (recovery после падения процесса).
  4. Реализация: чистые функции над `Executor` + запись в одной транзакции с изменением состояния (как `outbox`, `store.ts:34-39`). Сервис-исполнитель живёт в `packages/controller` и потребляет application service из D07/F-28.
  5. Команда: `node --test --test-isolation=none tests/storage/jobs-durable.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/jobs-durable.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод теста; diff; доказательство переживания рестарта (дочерний процесс).
- **Риски:** конкуренция двух контроллеров. Митигация: `claimDue` внутри транзакции с `UPDATE ... WHERE status='pending' OR lease_until < ?` и проверкой `changes === 1`.
- **Зависимость от D-решений:** D09.

---

#### F-38 · Retention: `DELETE` и окна хранения для `outbox` / `inbox_dedup` / `audit_events`

- **Карточка:** MW-040 (retention), `P6`/`P22` · **ADR-действие:** D17.
- **Зависит:** F-35 · **Разблокирует:** F-39, F-40.
- **Усилие:** M · **Риск:** средний · **Откат:** revert (данные уже удалены — необратимо, поэтому окна консервативны).
- **Цель:** появляется первый ограничитель роста базы: три таблицы перестают расти монотонно.
- **Файлы:** Create `packages/storage/src/retention.ts`; Create `tests/storage/retention.test.mjs`.
- **Проверенные факты (схема, которую чистим):**
  1. `migrations.ts:54-69` — `CREATE TABLE outbox (event_id TEXT PRIMARY KEY, workspace_id, sequence, type, correlation_id, causation_id, occurred_at, payload, status CHECK IN ('pending','delivered'), attempts, last_error, created_at, delivered_at, UNIQUE(workspace_id, sequence)) STRICT`.
  2. `migrations.ts:72-77` — `CREATE TABLE inbox_dedup (consumer, event_id, processed_at, PRIMARY KEY(consumer, event_id)) STRICT`.
  3. `migrations.ts:80` — `CREATE INDEX outbox_pending ON outbox (status, workspace_id, sequence)`.
  4. `FINAL-REPORT` §8.2 P6: «в `packages/**/src` нет `DELETE FROM outbox`/`VACUUM`»; P22: «`outbox`/`inbox_dedup` не чистятся; сканер секретов только по метаданным, не по телам».
  5. `audit_events` создаётся `EVIDENCE_MIGRATIONS` (v3, `evidence/src/schema.ts:138-147`) — **точные колонки не проверены** (`~`).
- **Шаги:**
  1. `Шаг 0`: прочитать `evidence/src/schema.ts` и записать точную DDL `audit_events` (колонка времени, наличие индексов).
  2. Тест (падающий): вставить 3 `delivered`-события с `occurred_at` старше окна → `pruneOutbox({ olderThan })` удаляет их, `pending` не трогает.
     Команда: `node --test --test-isolation=none tests/storage/retention.test.mjs` → FAIL.
  3. Тест (падающий): `pruneInboxDedup({ olderThan })` удаляет строки старше окна; свежие остаются (иначе вернётся дубль-доставка).
  4. Реализация `retention.ts`: три функции, каждая принимает **явное** окно; **никогда** не удаляет `pending`-события; каждая возвращает число удалённых строк.
  5. Команда: `node --test --test-isolation=none tests/storage/retention.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/retention.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** вывод теста; DDL `audit_events`; выбранные окна (значения — D17).
- **Риски:** удаление `inbox_dedup` слишком рано вернёт дубли доставки. Митигация: окно `inbox_dedup` ≥ максимального времени повторной доставки; значение — параметр, не константа в коде.
- **Не делать:** это **механика** (окна + `DELETE` + снятие триггеров). Предикат сканирования **тел** артефактов, памяти и context item + политика PII — `23-STEPS-quality.md` (`plan-quality`). Стык: F-40 отдаёт «как удалять», `23-…` даёт «что считать секретом».
- **Зависимость от D-решений:** **D17** (retention и секреты: окна хранения, VACUUM, сканирование тел).

---

#### F-39 · Retention: `VACUUM` и возврат места файловой системе

- **Карточка:** MW-040, P6 · **Зависит:** F-38.
- **Усилие:** S · **Риск:** средний (VACUUM блокирует базу) · **Откат:** нет (безопасно, но долго).
- **Цель:** `DELETE` действительно уменьшает файл, а не только освобождает страницы внутри.
- **Файлы:** Modify `packages/storage/src/retention.ts`; Create `tests/storage/vacuum.test.mjs`.
- **Проверенные факты:** `FINAL-REPORT` §8.2 P6 — «нет … `VACUUM`» в `packages/**/src`. `migrations.ts:49-82` создаёт таблицы без `auto_vacuum`; `PRAGMA auto_vacuum` при этом не выставляется вообще (проверяется шагом 1).
- **Шаги:**
  1. `Шаг 0`: `Select-String -Path packages\storage\src\*.ts -Pattern 'auto_vacuum|incremental_vacuum|VACUUM'` → ожидаем **0** совпадений; записать.
  2. Тест (падающий): после `pruneOutbox` с большим объёмом данных `statSync(path).size` уменьшается после `compact()`.
     Команда: `node --test --test-isolation=none tests/storage/vacuum.test.mjs` → FAIL.
  3. Реализация: `compact(store)` выполняет `PRAGMA wal_checkpoint(TRUNCATE)` (WAL уже включён — `sql.ts:130`) затем `VACUUM`; в WAL-режиме `VACUUM` не обязателен для возврата места после checkpoint — **шаг 3 подтвердить экспериментом** и выбрать минимально достаточное действие.
  4. Команда: `node --test --test-isolation=none tests/storage/vacuum.test.mjs` → `pass 2 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/storage/vacuum.test.mjs` → `# pass 2`, `# fail 0`
- **Evidence:** вывод grep «до»; размер файла до/после; вывод `PRAGMA auto_vacuum`.
- **Риски:** `VACUUM` берёт эксклюзивную блокировку и на большой базе останавливает контроллер. Митигация: `compact()` вызывается только по расписанию/в простое (durable job из F-37), никогда — на пути обработки запроса.
- **Зависимость от D-решений:** D17.

---

#### F-40 · Retention: BLOB-артефакты под триггерами — механика удаления

- **Карточка:** MW-008/040, P22 · **Зависит:** F-38, F-39.
- **Усилие:** M · **Риск:** высокий (необратимое удаление артефактов) · **Откат:** нет.
- **Цель:** известен и реализован **явный** путь удаления артефактов, несмотря на append-only триггеры; политика «что можно удалять» остаётся у владельца решения D17.
- **Файлы:** Modify `packages/evidence/src/artifacts.ts` (`~`) + новая миграция; Create `tests/evidence/artifact-retention.test.mjs`.
- **Проверенные факты (схема и триггеры — независимая проверка, `evidence/foundation-13-triggers.md`):**
  1. `packages/evidence/src/schema.ts:47-61` — `CREATE TABLE artifacts (…) STRICT`: `:48` `artifact_id TEXT PRIMARY KEY`, `:49` `hash`, `:50` `kind`, `:51` `workspace_id`, `:52` `correlation_id`, `:53` `content_type`, `:54` `size`, `:55` `created_at`, `:56` `task_id`, `:57` `attempt_id`, `:58` `review_id`, `:59` `causation_id`, **`:60` `bytes BLOB NOT NULL`**.
  2. `packages/evidence/src/schema.ts:75-88` — `CREATE TABLE audit_events (…) STRICT`: `:76` `position INTEGER PRIMARY KEY AUTOINCREMENT`, `:77` `audit_id TEXT NOT NULL UNIQUE`, `:78` `type`, `:79` `workspace_id`, `:80` `correlation_id`, `:81` `occurred_at`, `:82` `task_id`, `:83` `attempt_id`, `:84` `review_id`, `:85` `agent_i…`.
  3. **Шесть триггеров** (`Select-String` дал 12 совпадений = 6 пар CREATE + RAISE):
     - `:65`+`:67` — `CREATE TRIGGER artifacts_no_update BEFORE UPDATE ON artifacts` → `RAISE(ABORT, '${ARTIFACT_IMMUTABLE_MARKER}')`
     - `:70`+`:72` — `CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts` → тот же маркер
     - `:92`+`:94` — `CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events` → `RAISE(ABORT, '${AUDIT_APPEND_ONLY_MARKER}')`
     - `:97`+`:99` — `CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events` → тот же маркер
     - `:115`+`:118` — `CREATE TRIGGER IF NOT EXISTS artifacts_no_replace BEFORE INSERT ON artifacts` (WHEN EXISTS … `artifact_id = NEW.artifact_id`) → `ARTIFACT_IMMUTABLE_MARKER`
     - `:121`+`:124` — `CREATE TRIGGER IF NOT EXISTS audit_events_no_replace BEFORE INSERT ON audit_events` (WHEN EXISTS … `audit_id = NEW.audit_id`) → `AUDIT_APPEND_ONLY_MARKER`
  4. **Ни одного `DELETE FROM artifacts` / `DELETE FROM audit_events` в коде нет** — `Select-String -Pattern 'DELETE FROM'` по `packages/**/src/*.ts` и `tests/*.mjs` не находит таких строк.
  5. `FINAL-REPORT` §8.2 P22: «артефакты в BLOB с запретом DELETE/UPDATE триггерами» — **подтверждено и уточнено**: запрет не двух-, а **трёх** видов (плюс `no_replace` на `INSERT`).
- **Шаги:**
  1. `Шаг 0` (выполнен субагентом): триггеры найдены и процитированы выше — `файл:строка` для каждого из шести.
  2. Тест (падающий): `DELETE FROM artifacts WHERE …` под триггером → отказ `ARTIFACT_IMMUTABLE_MARKER`; после `dropArtifactGuard()` — успех (проверяет, что триггер существует и что путь снятия работает).
     Команда: `node --test --test-isolation=none tests/evidence/artifact-retention.test.mjs` → FAIL.
  3. Реализация: **новая миграция, номер которой выдаёт единый аллокатор версий** (R-04; `version: 7` литералом **не писать** — этот номер одновременно заявлен F-37, `E-04` и `B-12`). Миграция заменяет безусловный запрет на условный: `DELETE` разрешён только по пути «tombstone → retention-джоб». Учесть, что **`no_replace` на `INSERT` остаётся** (иначе append-only теряется уже на вставке).
  4. Тест (падающий): удаление артефакта **без** tombstone по-прежнему отвергается; вставка с существующим `artifact_id` по-прежнему отвергается.
  5. Команда: `node --test --test-isolation=none tests/evidence/artifact-retention.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/evidence/artifact-retention.test.mjs` → `# pass 3`, `# fail 0`
- **Evidence:** текст шести триггеров (`schema.ts:65,67,70,72,92,94,97,99,115,118,121,124`); DDL миграции, номер которой выдаёт аллокатор (R-04); вывод теста.
- **Риски:** необратимая потеря артефактов, на которые ссылается аудит. Митигация: (а) удаление только при отсутствии ссылок из `audit_events`; (б) `dry-run`-режим, возвращающий число кандидатов без удаления; (в) прогон dry-run перед первым боевым запуском.
- **Не делать:** не снимать триггеры целиком — это отменит append-only гарантию §47/§48. Не трогать `no_replace`.
- **Стык с D17/`23-…`:** D17 — «секрет в теле артефакта — **`refuse`, не `redact`**». Это политика **сканирования тел**, и ею владеет `plan-quality`; здесь — только механика удаления. Порядок обязателен: сначала F-40 (механика), затем предикат из `23-…`.
- **Зависимость от D-решений:** D17 (окна по таблицам + VACUUM; refuse, не redact).

---

#### F-41 · Boundary-тест: расширить `FORBIDDEN` до `@deepseek-ai/dsh*`

- **Карточка:** MW-005 (правка приёмки), P25 · **Зависит:** F-01.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert теста.
- **Цель:** запрет перестаёт быть списком из одного имени и ловит любое семейство платформы.
- **Файлы:** Modify `tests/boundaries.test.mjs:17-25` (`FORBIDDEN`), `:127-133` (`FORBIDDEN_FOR_STORAGE`), `:518-527` (`FORBIDDEN_IN_BOARD`).
- **Проверенные факты:**
  1. `boundaries.test.mjs:17-25` — `FORBIDDEN = ['@deepseek-ai/cordis','beads','hindsight','openviking','sqlite','better-sqlite3','node:sqlite']`. **Только `@deepseek-ai/cordis`**, никаких `@deepseek-ai/dsh*`.
  2. `:127-133` — `FORBIDDEN_FOR_STORAGE` — тот же дефект.
  3. `:518-527` — `FORBIDDEN_IN_BOARD` — тот же дефект.
  4. `:165-175` — проверка через `lowered.includes(forbidden)`, то есть регистронезависимая подстрока; добавление `'@deepseek-ai/'` одним элементом покрывает всё семейство.
- **Шаги:**
  1. Тест (падающий): добавить в тест фикстуру — строку `import type { Context } from '@deepseek-ai/dsh-sandbox-policy'` — и проверить, что текущий `FORBIDDEN` её **не** ловит.
     Команда: `node --test --test-isolation=none tests/boundaries.test.mjs` → FAIL (фикстура проходит).
  2. Реализация: заменить `'@deepseek-ai/cordis'` на `'@deepseek-ai/'` в трёх списках **и одновременно ввести allowlist** (R-08, канон `01-MASTER-PLAN.md` §15.4). Без allowlist гейт **недостижим**: `packages/controller/src/index.ts:12` легитимно импортирует `@deepseek-ai/cordis` (`Service`, `Context`), и ассерт `tests/boundaries.test.mjs:186-199` ожидает ровно `['@deepseek-ai/cordis']` для собранного `packages/controller/lib/index.js`.
  3. Команда: `node --test --test-isolation=none tests/boundaries.test.mjs` → `# fail 0`.
  4. **Явный тест на allowlist (обязателен):** фикстура `import type { Context } from '@deepseek-ai/cordis'` **проходит** (легитимно), а фикстура `import type { X } from '@deepseek-ai/dsh-sandbox-policy'` — **падает**. Без второго ассерта allowlist неотличим от «гейт ничего не ловит».
     `Шаг 0`: проверить, что `tests/boundaries.test.mjs:186-199` (собранные бандлы) и `:97-104` (`specifiersOf`) не конфликтуют с новым allowlist — это два разных механизма, и allowlist вводится только для **запрещающих** списков.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/boundaries.test.mjs` → `# fail 0`
- **Evidence:** вывод теста; diff трёх списков; строка фикстуры, которая раньше проходила.
- **Риски:** `'@deepseek-ai/'` заденет легитимный `@deepseek-ai/cordis`. Митигация: **allowlist обязателен** (R-08) — правка трёх запрещающих списков сопровождается allowlist'ом и явным тестом (шаг 4). `controller/src` этими списками не сканируется, но `:186-199` проверяет **собранный** бандл и обновляется осознанно вместе с F-48.

---

#### F-42 · Boundary-тест: сканировать `scheduler` / `planner` / `adapter-sdk` / `controller` / `memory-native`

- **Карточка:** MW-005, P25; `FINAL-REPORT` §10, этап 2, п.8 («V2 подтвердил дыру экспериментом») · **Зависит:** F-41.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** дыра закрыта: пакеты, которых тест не видел, теперь сканируются.
- **Файлы:** Modify `tests/boundaries.test.mjs:111-124` (набор сканируемых) и добавить блоки проверок по образцу `:342-418`.
- **Проверенные факты (измерено в этой кампании):**
  1. Сканируются **шесть** наборов: `contracts/src` (`:112`), `core/src` (`:113`), `storage/src` (`:117`), `evidence/src` (`:124`), `lease/src` (`:340`), `execution/src` (`:427`). Больше — ничего.
  2. **Не сканируются вовсе:** `packages/scheduler/src`, `packages/planner/src`, `packages/adapter-sdk/src`, `packages/controller/src`, `packages/memory-native/src`, `packages/beads-adapter/src`.
  3. Фактическая проверка импортов платформы по всем `packages/**/src` (команда `Select-String -Path … -Pattern '@deepseek-ai'`): совпадения есть **только** в `beads-adapter/src/memory-plugin.ts:22`, `beads-adapter/src/plugin.ts:15`, `controller/src/dsh-session.ts:31`, `controller/src/index.ts:12`, `controller/src/model-catalog.ts:23,59`, `storage/src/layout.ts:13` (в комментарии — «mirrored here instead of imported»). В `scheduler/src` и `planner/src` — **0** совпадений: сегодня это латентная дыра, а не действующее нарушение.
  4. Формулировка отчёта «DSH-импорт в `scheduler/src` не ловится» **уточняется**: `scheduler/src` не входит в сканируемый набор ни одним тестом, поэтому не ловится **ничто** — ни DSH, ни Beads, ни `node:sqlite`.
- **Шаги:**
  1. Тест (падающий): добавить `collect(join(repoRoot,'packages','scheduler','src'), ['.ts'])` и ассерт `assert.ok(schedulerSources.length >= 5, …)` → изначально FAIL, если число файлов меньше (защита от «сканируем пустоту», как `:136-137`).
     Команда: `node --test --test-isolation=none tests/boundaries.test.mjs` → FAIL.
  2. Добавить `FORBIDDEN_FOR_INFRA` (=F-41-список **вместе с его allowlist**'ом; R-08) и проверки для каждого нового набора: разрешённые спецификаторы перечислить **явно** (образец — `:429-456` для execution). **Проверить перед включением:** ни один новый пакет не импортирует `@deepseek-ai/cordis` — если импортирует, он идёт в allowlist, а не в исключение из сканирования.
  3. Для каждого нового пакета добавить ассерт «не пусто» — иначе новый блок будет вакуумным (`:213-214`, `:292-295`, `:363-366` — образцы таких guard'ов).
  4. Команда: `node --test --test-isolation=none tests/boundaries.test.mjs` → `# fail 0`.
  5. Записать фактические разрешённые наборы импортов для `scheduler`/`planner` (они используют `@dsh-mywork/*` — это **легитимно**, запрещено только `@deepseek-ai/*` и продукты).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/boundaries.test.mjs` → `# fail 0`, и `Select-String -Path tests\boundaries.test.mjs -Pattern "collect\(join\(repoRoot, 'packages'"` → **≥10** совпадений (было 6).
- **Evidence:** вывод теста; число сканируемых наборов до/после; результат фактического grep по `scheduler`/`planner` (0 совпадений `@deepseek-ai`).
- **Риски:** новые проверки покраснеют на существующем коде. Митигация: сначала прогнать только ассерты «не пусто», затем включать запреты; обнаруженные нарушения чинить отдельными шагами, а не ослаблять тест.

---

#### F-43 · Model availability: порт и `RouteRefusalReason: model-not-routable`

- **Карточка:** **MW-070** (диапазон MW-070…MW-075) · **ADR-действие:** **D20** · **Зависит:** F-31.
- **Усилие:** M · **Риск:** средний · **Откат:** revert.
- **Цель:** «модель недоступна» становится **типизированным** отказом с уже существующей таксономией причин; пустой `listModels` перестаёт быть «нет моделей, но и не ошибка».
- **Файлы:** Modify `packages/controller/src/model-catalog.ts:119-128`; Modify `packages/core/src/routing.ts:103-115,226-245`; Modify `packages/contracts/src/model-catalog.ts` (таксономия причин); Create `tests/model-availability.test.mjs`.
- **Проверенные факты (независимая проверка, `evidence/foundation-14-model-catalog.md`):**
  1. **Опровержение P20:** литералов `1000000` / `1_000_000` / `maxTokens` в `packages/**/src/*.ts` — **0 совпадений**. Синтеза окна «1 000 000» в коде **нет**; `contextWindow` только транзитен: `model-catalog.ts:121` (`resolved.context?.contextWindow`) и `:126` (проброс), поле остаётся optional — `contracts/src/model-catalog.ts:57`.
  2. `model-catalog.ts` — 175 строк. `DSH_LLM_SERVICE = 'llm'` (`:34`); читается `ctx.get(DSH_LLM_SERVICE)` (`:150`); сервис-интерфейс `DshLlmRegistry` объявлен **структурно** (`:63-80`), без импорта DSH.
  3. Методы порта: `listProviders()` (`:65,94-96`); `listModels(provider)` (`:67-72,103-111`); `resolveModelInfo(provider, model)` (`:74-79,119-128`).
  4. **`resolveModelInfo` (`:119-128`) ветки «модель не найдена» НЕ имеет:** `:120` просто `await`-ит реестр, исключение уходит наружу (комментарий `:117` — «unknown route … is an outage»). Порт обещает `UNKNOWN_MODEL` на отсутствующий маршрут — `contracts/src/model-catalog.ts:126`; код `CATALOG_UNKNOWN_MODEL = 'UNKNOWN_MODEL'` — `contracts/src/model-catalog.ts:69`.
  5. Решение о причине принимается **выше**, в `packages/core/src/routing.ts:226-245`: `UNKNOWN_MODEL` → `reason: 'route-absent'` (`:231-238`); любое другое исключение → `'provider-outage'` (`:239-244`).
  6. **Пустой `listModels`:** `routing.ts:103-115` — пустой массив не даёт ни моделей, ни outage (outage только на `throw`, `:113-115`); отказ `route-absent` срабатывает **только по отсутствию провайдера** (`routing.ts:212-219`). **Список моделей в выборе маршрута вообще не читается** — решение идёт через `resolveModelInfo` (`routing.ts:224-245`).
  7. **Таксономия причин уже существует** (не «нужен новый тип»): `route-absent`, `provider-outage`, `context-window-too-small` (`routing.ts:273-280`), `context-window-undisclosed` (`routing.ts:265-272`).
- **Шаги:**
  1. `Шаг 0` (обязателен): выписать **полный** текущий union причин отказа из `packages/contracts/src/model-catalog.ts` и `packages/core/src/routing.ts` — `Шаг 0` нужен, потому что D20 предлагает значение `model-not-routable`, а в коде уже есть `route-absent`/`provider-outage`. **Решение о соответствии имён — часть шага, а не догадка.**
  2. Тест (падающий): пустой `listModels` + существующий провайдер → типизированный отказ с причиной из **существующего** union (вероятно `route-absent`), а **не** «маршрут без ограничения окна»; сегодня отказ не возникает вовсе (`routing.ts:212-219`).
     Команда: `node --test --test-isolation=none tests/model-availability.test.mjs` → FAIL.
  3. Тест (падающий): `resolveModelInfo` на отсутствующую модель даёт **управляемый** результат (или явно документированное исключение с кодом `UNKNOWN_MODEL`), а не «пробрасывание наружу как outage» (`model-catalog.ts:117-120`).
  4. Реализация: `ModelAvailabilityPort` (интерфейс с `listModels`/`resolveModelInfo`) в `contracts`; `model-catalog.ts` реализует его; `routing.ts` получает ветку «провайдер есть, моделей нет» → отказ. **Если D20 настаивает на имени `model-not-routable`** — добавить его значение в union и замапить на него ветку; **новых типов не плодить** без нужды.
  5. Команда: `node --test --test-isolation=none tests/model-availability.test.mjs` → `pass 3 / fail 0`; регрессия `node --test --test-isolation=none tests/routing.test.mjs` (19458 б) → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/model-availability.test.mjs tests/routing.test.mjs` → `# fail 0`
- **Evidence:** вывод теста; diff; **доказательство опровержения**: `Select-String -Pattern '1000000|1_000_000|maxTokens'` → 0; текущий union причин до правки.
- **Риски:** изменение union причин ломает `tests/routing.test.mjs`. Митигация: сначала выписать текущий union (`Шаг 0`), затем добавлять значение **аддитивно**; имя `model-not-routable` вводить только если существующие не покрывают случай.
- **Опровержение базы:** рабочая гипотеза «`resolveModelInfo` синтезирует окно 1 000 000» **опровергнута** — см. §5, строка 12. Шаг переписан на реальные пробелы: пустой `listModels` и отсутствие ветки «не найдено».
- **Зависимость от D-решений:** **D20** — принято («Порт availability + `RouteRefusalReason: 'model-not-routable'`; пустой `listModels` — отказ, не дефолт»). **Требуется сверка:** значение `model-not-routable` против существующих `route-absent`/`provider-outage` — см. §7.2.

---

#### F-44 · Session conformance: 8 тестов на политики прав и ветку «нет живого агента»

- **Карточка:** MW-015 (правка приёмки), `P21`, D N-4 · **Зависит:** F-31, F-43.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** три непокрытых ветки (`read-only`, `danger-full-access`, «нет живого агента») и схлопнутые четыре отказа получают тесты.
- **Файлы:** Create `tests/session-conformance.test.mjs`; при необходимости Modify `packages/controller/src/dsh-session.ts` (`~`).
- **Проверенные факты:**
  1. `FINAL-REPORT` §8.2 P21: «не покрыты `read-only`, `danger-full-access`, "нет живого агента"; 4 отказа схлопнуты в `unavailable`».
  2. `controller/src/index.ts:124-127` — комментарий: «§22/§39: the DSH session controller becomes the session and agent-runtime ports, so one attempt runs in one real, scoped DSH session. Same rule as above: an absent platform surface is reported, not repaired».
  3. `dsh-session.ts` экспортирует `DshAgentRuntime`, `DshSessionAdapter`, `mountDshRuntime` и типы `DshSessionApi`, `DshCommandRuntime`, `DshWireEvent` (`controller/src/index.ts:61-89`).
  4. Режимы прав — закрытый union платформы: `sandbox-policy/src/index.ts:90-94` — `zod.union([literal('read-only'), literal('workspace-write'), literal('danger-full-access')]).nullable()`; дефолт — `'read-only'` (`:113`), а `renderPolicyContext` (`:42-56`) уже формулирует человекочитаемый текст для каждого режима.
- **Шаги:**
  1. Тест: сессия в `read-only` → попытка изменить файл даёт отказ, а не «попробуй ещё».
  2. Тест: сессия в `danger-full-access` → ограничение снимается (в терминах контракта порта, без реальной записи на диск).
  3. Тест: `ctx.agents.get(sessionId)` → `undefined` → отказ с **различимым** кодом (не `unavailable`).
  4. Тесты 4–8: развести четыре схлопнутых отказа: `session-missing`, `session-not-live`, `session-scope-mismatch`, `runtime-unavailable`.
  5. Команда: `node --test --test-isolation=none tests/session-conformance.test.mjs` → `pass 8 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/session-conformance.test.mjs` → `# pass 8`, `# fail 0`
- **Evidence:** вывод теста; таблица «было `unavailable` → стало `<код>`».
- **Риски:** тесты на реальную запись файла зависят от файловой системы. Митигация: проверять **контракт порта** (какой режим передан), а не фактическую запись; реальная запись — вне рамок шага.
- **Зависимость от D-решений:** D20 (пересечение по отказам маршрутизации).
- **Стык с `23-…`:** `plan-quality` владеет шагами «Права роли → платформенный runtime-enforcement (`sandbox-policy` + `fs-observation-policy`)» — §9.1 (MW-007/015). Здесь проверяется **контракт MyWork**, там — включение enforcement платформы. Не дублировать.

---

#### F-45 · Boundary + достижимость: зафиксировать рост достижимых пакетов

- **Карточка:** MW-058 (приёмка), `P4` · **Зависит:** F-30, F-31, F-42.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** «31,7 % строк недостижимы» становится измеряемой величиной с тестом, а не цифрой из отчёта.
- **Файлы:** Create `tests/reachability.test.mjs`; Create `.work/plan-v0.3/evidence/foundation-45-reachability.md`.
- **Проверенные факты:**
  1. `FINAL-REPORT` §8.1: «**4 из 12 пакетов**; 11 619 / 36 674 строк `src` (31,7 %) недостижимы; ни одной живой `*.sqlite`».
  2. `P16`: корректное измерение — «111 файлов / 36 674 строки `src`» (метрика «125 383 строки» включала build output).
  3. `packages/controller/src/index.ts:115-128` — публикуются ровно **два** сервиса: `myworkController`, `myworkAdapters`.
- **Шаги:**
  1. `Шаг 0`: воспроизвести число достижимых пакетов. Сегодня: `controller`, `adapter-sdk`, `core`, `contracts` (импортируются из `controller/src/index.ts:12-48`) = **4**. Записать команду и результат.
  2. Тест (падающий): после F-30 достижимых должно стать **≥9** (те же 4 + `storage`, `evidence`, `lease`, `planner`, `execution`).
     Команда: `node --test --test-isolation=none tests/reachability.test.mjs` → FAIL до F-30, PASS после.
  3. Реализация теста: статический обход от `packages/controller/lib/index.js` (или `src/index.ts`) по спецификаторам `@dsh-mywork/*` — по образцу `specifiersOf` из `boundaries.test.mjs:97-104`.
  4. Команда: `node --test --test-isolation=none tests/reachability.test.mjs` → `pass 1 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/reachability.test.mjs` → `# pass 1`, `# fail 0`, и в evidence записано число достижимых пакетов до (4) и после (≥9).
- **Evidence:** вывод теста; две цифры; команда получения.
- **Риски:** статический обход ошибётся на реэкспортах (`export … from './dsh-session.ts'`, `index.ts:61-89`). Митигация: считать по **транзитивному замыканию** `from '…'` и `import('…')`, как `specifiersOf`, и держать guard «найдено ≥ N спецификаторов».
- **Не делать:** не считать строки — метрика строк (P16) хрупкая; считаем **пакеты**.

---

#### F-46 · Гейт этапа 2

- **Карточка:** — (контрольная точка) · **Зависит:** F-28…F-45.
- **Усилие:** S · **Риск:** низкий.
- **Цель:** этап 2 закрыт машинно-проверяемо; этап 3 больше не блокируется.
- **Шаги — прогнать и записать:**
  1. `node scripts/smoke.mjs; $LASTEXITCODE` → `0`, и `Test-Path $DSH_HOME\dsh-mywork\state\controller.sqlite` → `True` (F-32).
  2. `node --test --test-isolation=none tests/storage/atomic-write.test.mjs tests/storage/file-lock.test.mjs tests/storage/sqlite-pragmas.test.mjs tests/storage/retention.test.mjs tests/storage/vacuum.test.mjs tests/storage/jobs-durable.test.mjs tests/storage/jobs-schema.test.mjs` → `# fail 0` (F-33…F-38).
  3. `node --test --test-isolation=none tests/boundaries.test.mjs tests/reachability.test.mjs tests/model-availability.test.mjs tests/session-conformance.test.mjs tests/evidence/artifact-retention.test.mjs` → `# fail 0` (F-40…F-45).
  4. `corepack pnpm -r run typecheck` → `EXIT=0` (12 пакетов).
  5. `Select-String -Path packages\controller\src\app.ts -Pattern 'openStore\('` → ровно **2** (F-30).
- **Гейт (готово когда):** все пять команд дают ожидаемое.
- **Evidence:** вывод пяти команд с exit code; число достижимых пакетов (F-45).
- **Замечание о стоимости:** шаги 2–3 — новые файлы тестов; полный прогон (`test`) всё равно остаётся за Lead'ом (§5.4 брифа).

---

## 4. Этап 3 — решения и контракты (1–2 недели)

Гейт этапа: **F-60**. Тема: публикация невозможна by construction, нет ограничителя стоимости и шагов, ноль наблюдаемости при 90 вхождениях `correlationId`, worker-поверхность позволяет самомодификацию.

---

#### F-47 · Peer-контракт: инвентаризация реально используемых сервисов `ctx.*`

- **Карточка:** MW-041 (правка: `peerDependencies`, `engines`), **P23** · **ADR-действие:** D04.
- **Зависит:** F-30, F-31 · **Разблокирует:** F-48, F-49, F-50.
- **Усилие:** S · **Риск:** низкий · **Откат:** нет (только документ).
- **Цель:** известен **точный** список платформенных сервисов, которые читает MyWork, — основание для `peerDependencies`.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-47-ctx-services.md`.
- **Проверенные факты (механика гейта DSH — измерено в этой кампании):**
  1. Гейт: `C:\Reposit\deepseek-harness\deepseek-harness\packages\boot\app-boot\src\plugin-compatibility.ts`. Ключевые строки: `:68` — `if (!Object.hasOwn(fields, 'peerDependencies')) return undefined;` (нет `peerDependencies` → **гейта нет вовсе**); `:75` — `if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue;` (**проверяются только `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`**); `:76` — `workspace:^|~|*` подставляются как версия рантайма; `:77` — `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })` (**пререлизы участвуют в диапазонах**).
  2. Версия рантайма берётся из `package.json` самого app-boot: `:44-49` (`getDshRuntimeVersion()`), и она равна **`0.2.0-rc.2`** (`packages/boot/app-boot/package.json` на `639ed0153`, совпадает с корневым `package.json` DSH-checkout). *(В кампании v0.3 здесь стояло `0.1.7-rc.2` — исторический замер; актуализация 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §1.)*
  3. Диагностика и исключения: `:96-103` — `pluginCompatibilityWarning()`; механизм обхода — «exact-version exemption» через `dsh plugin allow-version` (`:101`).
  4. **Следствие для MyWork:** сегодня все 12 манифестов объявляют `private: true`, а **единственный** `peerDependencies` — у `controller`: `{"@deepseek-ai/cordis": "^4.0.2"}` (`packages/controller/package.json:30-32`). Имя `@deepseek-ai/cordis` **не** матчит фильтр `:75`, поэтому гейт **не проверяет ничего**. То есть публикация «проходит» гейт, ничего не гарантируя.
  5. `engines` **не читается** DSH: `Select-String` по `packages/**/*.ts` (без `node_modules`/`tests`) на `manifest.engines|.engines` → **0 совпадений**.
  6. Платформенные пакеты, релевантные MyWork (все версии `0.2.0-rc.2` на `639ed0153`; в кампании v0.3 — `0.1.7-rc.2`): `@deepseek-ai/dsh-token-meter` (`packages/llm/token-meter`), `@deepseek-ai/dsh-sandbox-policy` (`packages/sandbox/sandbox-policy`), `@deepseek-ai/dsh-fs-observation-policy` (`packages/fs/fs-observation-policy`), `@deepseek-ai/dsh-jobs-local` (`packages/jobs/jobs-local`), `@deepseek-ai/dsh-experimental-auto-review` (`packages/experimental/auto-review`).
- **Шаги:**
  1. Собрать фактические обращения к `ctx.*`: `Select-String -Path packages\**\src\*.ts -Pattern 'ctx\.(\w+)' -AllMatches` → свести в таблицу «сервис → где используется → пакет-владелец».
  2. Соединить с уже известными: `MYWORK_ADAPTERS_SERVICE`, `MYWORK_CLOCK_SERVICE`, `MYWORK_CONTROLLER_SERVICE` — **наши** имена (`controller/src/index.ts:26-33`); платформенные — `ctx.agents`, `ctx.commands`, `ctx.typertGateway`, `ctx.workspaceRegistry` (`controller/src/index.ts:61-89`, `dsh-client-ui-task-board/lib/index.js:5566-5576`).
  3. Для каждого платформенного сервиса записать пакет-владелец и объявленный интерфейс (по `declare module '@deepseek-ai/cordis'`, как в `token-meter/src/index.ts:94-96` и `sandbox-policy/src/index.ts:58-62`).
  4. Записать **вывод**: `peerDependencies` должен содержать `@deepseek-ai/dsh` (для активации гейта) + по одному `@deepseek-ai/dsh-<service>` на каждый реально читаемый сервис.
- **Гейт (готово когда):** в evidence есть таблица «сервис → `файл:строка` → пакет-владелец», и она покрывает все `ctx.*` из `packages/controller/src`.
- **Evidence:** таблица; цитаты `plugin-compatibility.ts:68,75,76,77`; вывод grep по `engines` (0 совпадений).
- **Риски:** список сервисов неполон → F-48 объявит не всё. Митигация: шаг 4 делает **`@deepseek-ai/dsh`** обязательным — он ловит несовместимость рантайма целиком, даже если сервисный список неполон.
- **Зависимость от D-решений:** **D04** (peer/version policy и распространение).

---

#### F-48 · Peer-контракт: `peerDependencies` в `controller` (и только он держит гейт)

- **Карточка:** MW-041, MW-060, P23 · **Зависит:** F-47 · **Источник:** `evidence/lead-03-peer-gate.md`.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert манифеста.
- **Цель:** гейт совместимости DSH **реально включается** для MyWork; диапазон фиксирует минимальную поддерживаемую платформу и запрещает молча ломающие варианты.
- **Файлы:** Modify `packages/controller/package.json:30-32` (+ добавить `engines` рядом); Modify `tests/boundaries.test.mjs:186-199` (ожидание для `controller/lib/index.js`); Create `tests/peer-gate.test.mjs`.
- **Проверенные факты (`evidence/lead-03-peer-gate.md`, §А):**
  1. **Единственный вход — `peerDependencies`:** `packages/boot/app-boot/src/plugin-compatibility.ts:68` — нет ключа ⇒ вердикт `undefined`.
  2. **Субъект — только `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`:** `:71-75` — `@deepseek-ai/cordis`, `react` и прочее пропускаются через `continue`. Сегодня единственный peer MyWork (`@deepseek-ai/cordis: ^4.0.2`) **вне неймспейса гейта ⇒ гейт молчит** («гейт молчит» ≠ «MyWork совместим»).
  3. **Версия рантайма берётся у app-boot, а не у CLI:** `:44-49` `getDshRuntimeVersion()` читает `../package.json` пакета `@deepseek-ai/dsh-app-boot` (= **`0.2.0-rc.2`** на `639ed0153`). CLI сейчас тоже `0.2.0-rc.2` (`apps/cli/package.json`), но связка неявная. *(Замер кампании v0.3 — `0.1.7-rc.2`; актуализация 2026-10-03 по `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D13: `getDshRuntimeVersion` — функция стабильна, меняется только значение.)*
  4. **Сравнение:** `:76-77` — `semver.satisfies(runtime, range, { includePrerelease: true })`; `workspace:^|~|*` подменяются текущей версией; пустая строка и невалидный диапазон = несовместимость.
  5. **`engines` не читает никто** (в т.ч. `dsh.engines.dsh`): тип объявлен (`packages/util/package-manifest/src/types.ts:23-24,56-66`), но `rg engines` по `packages/**/*.ts` даёт только `types.ts` + реэкспорт `index.ts:9`; `dsh?.engines|engines?.dsh` — **0 совпадений**. Документация: «These checks use peer declarations, not `engines.dsh`» (`packages/boot/app-boot/README.md:52`). Популярное в экосистеме `dsh.engines.dsh` (есть у `task-board@0.4.3`, а на установленной **0.4.4** — `dsh.engines.dsh = >=0.2.0-rc.1` и `peerDependencies: {"@deepseek-ai/dsh": ">=0.2.0-rc.1"}` в её `package.json`; проверено 2026-10-03) **чисто декоративно**.
  6. **Диапазоны — актуализировано 2026-10-03 (дельта `0.2.0-rc.2`), замер `semver@7.8.5` — тем же, что импортирует гейт: `packages/boot/app-boot/node_modules/semver`; исполнимая команда (без многоточия) `node -e "const s=require('C:/Reposit/deepseek-harness/deepseek-harness/packages/boot/app-boot/node_modules/semver');const r='>=0.1.7-rc.2 <0.3.0-0';console.log(s.satisfies('0.2.0-rc.2',r,{includePrerelease:true}))"` → `true`, exit 0.** Вердикты в семантике гейта (`includePrerelease: true`, `plugin-compatibility.ts:77`) для **объявленного** диапазона `>=0.1.7-rc.2 <0.3.0-0` (решение владельца, `ADR-032` «Дополнение 2026-10-03»): `0.1.7-rc.2` **true**; `0.2.0-rc.2` (текущий рантайм) **true**; `0.2.0` (финал линии) **true**; `0.2.1-alpha.1` **true** (пререлиз следующего патча проходит — остаточный факт, не дефект выбора); `0.3.0-rc.1` **false**; `0.3.0` **false**. Прежний диапазон `>=0.1.7-rc.2 <0.2.0`: `0.2.0-rc.2` **true только из-за `includePrerelease`** (без опции — `false`), `0.2.0` **false** → на финале линии гейт отключил бы строку плагина.
     **Ловушки (измерено там же):** `^0.1.7` десугарит в `>=0.1.7 <0.2.0-0` и **отвергает** `0.1.7-rc.2` → **false** (это исправление прежней редакции этого пункта); `~0.1.7` (тот же десугар) → **false**; «руками написанный» `>=0.1.7 <0.2.0` → **false**; верхняя граница **без** `-0` (`>=0.1.7-rc.2 <0.3.0`) **пропускает** `0.3.0-rc.1` → **true**, поэтому выбран именно `<0.3.0-0`.
     **Почему прежняя редакция была ложной:** она утверждала «`^0.1.7` (десугар `>=0.1.7-0 <0.2.0-0`) ⇒ true» (замер `semver@7.7.4`); это опровергнуто ещё в кампании v0.3 — `evidence/foundation-48-peer-contract.md` §4, `evidence/foundation-50-compat-matrix.md` §2, `01-MASTER-PLAN.md` §16 R-38 — но в шаге исправлено не было (реестр R-38 помечен «исправлено» ошибочно). Историческая формулировка сохраняется здесь как отменённая, а не удаляется.
  7. **Где срабатывает:** типизированный код `incompatible-version` (`packages/boot/plugin-manager/src/types.ts:22`); операции `index.ts:302` (listBundles), `:723`; stderr `dsh: installation rejected: …` + `exitCode 1` (`operations.ts:324-331`). **Старт профиля** — `dsh: disabling profile plugin <row>: <reason>` (`compatibility-preflight.ts:79-83`), бандл **молча уходит в `skippedBundles`** (`profile.ts:674-680`).
  8. **Область применения — не только реестр:** пре-флайт до `pnpm` читает **локальный путь** с диска и реестровую спецификацию через `pnpm view … peerDependencies` (`operations.ts:167-188,338-351`); **tarball/git пре-флайта не имеют** и судятся **после** установки, с откатом `package.json`/lockfile (`operations.ts:172-176,465-520`). Плюс независимый стартовый гейт на каждую строку композиции (`compatibility-preflight.ts:105`) и на каждый бандл (`profile.ts:674`) — **распакованный tarball тоже блокируется**.
  9. **Exemption — только файл профиля:** `<profileDir>/compatibility.json` (`profile-compatibility.ts:10`), формат `{"@scope/name@1.2.3": ["0.1.7-rc.2"]}` — точный `package-name@version` → список **точных** версий DSH (`:24-27,80-91`); запись атомарная, mode **`0600`**, под файловой блокировкой (`:113-140`). Грант требует `acceptRisk: true` (`:117-119`) и версию, равную текущей (`:121-123`). **Выдаёт человек:** `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <exact> --accept-risk` (`apps/cli/src/plugin.ts:100` — подсказка «to accept the risk, run: …»; на базе кампании было `:78`); есть `revoke-version`, `version-exemptions` (диспетчер DSH-команд `:19`, usage-строка `:36`; было `:13,30`). Агентский `plugin_manager` умеет `set_version_exemption`, но требует `acceptRisk` и явного согласия пользователя.
  10. **Реальные импорты `@deepseek-ai/*` во всём MyWork — 5 совпадений, все `@deepseek-ai/cordis`, все типовые:** `controller/src/index.ts:12`, `model-catalog.ts:23`, `dsh-session.ts:31`, `beads-adapter/src/memory-plugin.ts:22`, `plugin.ts:15`. **Ни одного `@deepseek-ai/dsh-*`**; ни один пакет не объявляет `inject`-сервисов.
- **Шаги:**
  1. В `packages/controller/package.json` заменить `:30-32` на дословный блок (`evidence/lead-03-peer-gate.md` §В): `peerDependencies` = `@deepseek-ai/cordis: ^4.0.2` **+** `@deepseek-ai/dsh: >=0.1.7-rc.2 <0.3.0-0`; рядом `engines.node = "^22.19.0 || >=24.0.0"` (шире корневого `>=22.18.0`, который допускает 22.18 и 23.x). `devDependencies` **не менять** — `@deepseek-ai/dsh` в devDeps заставит `auto-install-peers` вытянуть весь CLI.
  2. **`dsh.engines.dsh` в контракт НЕ входит.** Если он уже добавлен — оставить **только как документацию для человека** и явно пометить комментарием/README, что гейт его не читает. **Контракт совместимости держит исключительно `peerDependencies`.**
  3. Проверить, что остальные **13** манифестов **не** получают `@deepseek-ai/dsh`: у них нет ни одного импорта из `@deepseek-ai/dsh-*` (факт 10), поэтому объявление peer'а там включило бы гейт без предмета проверки. Счёт по дереву (замер 2026-10-03): манифестов `packages/*/package.json` — **15**, а peer `@deepseek-ai/dsh` объявлен ровно у **двух** — `packages/controller/package.json:33` и `packages/web/package.json:42`; второй принадлежит шагу F-58 и учитывается гейтом F-60 («ровно 2 файла»), поэтому гейт этого шага тоже считает **2**, а не 1. (Историческая пометка: первая редакция шага требовала peer в каждом из тогдашних 12 манифестов — **отменено**.)
  4. Тест (падающий): диапазон проверяется **через semver**, а не глазами: `semver.satisfies('0.2.0-rc.2', '>=0.1.7-rc.2 <0.3.0-0', { includePrerelease: true })` → `true` (текущий рантайм проходит); `semver.satisfies('0.2.0', '>=0.1.7-rc.2 <0.3.0-0', { includePrerelease: true })` → `true` (финал линии `0.2.0` больше не отсекается); `semver.satisfies('0.1.7-rc.2', '>=0.1.7 <0.2.0', { includePrerelease: true })` → `false`; `^0.1.7` против `0.1.7-rc.2` → `false`; `~0.1.7` → `false`; `0.3.0` против выбранного диапазона → `false`; `>=0.1.7-rc.2 <0.3.0` (верх без `-0`) против `0.3.0-rc.1` → `true` — **ловушка, из-за которой верх пишется с `-0`**.
     Команда: `node --test --test-isolation=none tests/peer-gate.test.mjs` → FAIL (файла нет).
  5. Тест (падающий, **новый путь отказа**): при несовместимой версии рантайма бандл уходит в `skippedBundles`. Проверять на подставном манифесте через `evaluatePluginCompatibility(manifest, {}, '0.3.0')` → возвращает `{ peers: { '@deepseek-ai/dsh': '>=0.1.7-rc.2 <0.3.0-0' }, exempted: false }`, **не** `undefined`. Именно это и есть «падать громко»: объявив `@deepseek-ai/dsh`, MyWork **включает себе гейт**. (`0.3.0` вместо прежнего `0.2.0`: после расширения диапазона до `<0.3.0-0` финал линии `0.2.0` **совместим**, отказ даёт следующая мажорная линия.)
  6. Проверка перед доставкой: `evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.2')` → `undefined`; и `node scripts/verify-profile.mjs` → `verify:profile: PASS` (гейт применяется и к локальному пути, и к tarball — факт 8).
- **Гейт (готово когда):** `node --test --test-isolation=none tests/peer-gate.test.mjs` → `# fail 0`; `Select-String -Path 'packages\controller\package.json' -Pattern '"@deepseek-ai/dsh"'` → **≥1**; `Select-String -Path 'packages\*\package.json' -Pattern '"@deepseek-ai/dsh"'` → **ровно 2** файла (`controller`, `web` — то же число, что требует гейт F-60); `node scripts/verify-profile.mjs` → `PASS`.
- **Evidence:** diff манифеста; вывод `semver.satisfies` по диапазонам (включая `^0.1.7`/`~0.1.7` → `false` и `<0.3.0` без `-0` → пропуск `0.3.0-rc.1`); результат `evaluatePluginCompatibility` при `0.2.0-rc.2` (`undefined`) и при `0.3.0` (несовместим); вывод `verify:profile`.
- **Риски:** объявление peer'а включает гейт, и при будущем DSH `0.3.x` бандл **молча** уйдёт в `skippedBundles` без строки в композиции (линия `0.2.x`, включая финал `0.2.0`, диапазоном `>=0.1.7-rc.2 <0.3.0-0` **принимается**; пререлизы вида `0.2.1-alpha.1` тоже проходят — остаточный факт, зафиксирован в факте 6). Это желаемое поведение, но оно требует теста (шаг 5) и записи в Doctor.
- **Открытая проверка:** порядок/поведение `pnpm` при `auto-install-peers` для нового peer `@deepseek-ai/dsh` в этом монорепо не измерялись (`lead-03`, «Не проверено» п. 3).
- **Расхождение с D04 — зафиксировать:** D04 предписывал «`dsh.engines.dsh` … чтобы издатели и Plugin Manager видели требование». `lead-03` доказывает, что **`dsh.engines.dsh` не читает никто** (`README.md:52`; 0 совпадений в коде). Поэтому поле понижено до документации, а контракт держит `peerDependencies`. **Это уточнение D04, а не отмена:** диапазон, tarball-доставка и сохранение `private` — из D04 без изменений. Требует подтверждения `decision-desk`/`verifier-a`.
- **Зависимость от D-решений:** **D04** — принято (вариант B), с уточнением по `engines`; **D01** — Typert не выбран, `@deepseek-ai/dsh-typert-protocol` не добавлять.
---

#### F-49 · Публикуемость: `private: true` → `publishConfig` и `files`

- **Карточка:** MW-040/041 (правки: «`private: true` → решение о распространении»), P10.
- **Зависит:** F-48 · **Усилие:** S · **Риск:** средний (можно случайно опубликовать внутренний пакет) · **Откат:** вернуть `private: true`.
- **Цель:** известно, что публикуется, что нет и почему; «публикация невозможна by construction» перестаёт быть верным **для канала tarball**.
- **Файлы:** Modify `packages/*/package.json` (`files`; `private` **не** снимается).
- **Проверенные факты:**
  1. **Замер 2026-10-03: манифестов `packages/*/package.json` — 15, `private: true` — у 14.** Единственное исключение — `web` (`@dsh-mywork/web`, он и снимает `private` по D18). Историческая редакция (кампания v0.3) знала 12 пакетов: `adapter-sdk`, `beads-adapter`, `contracts`, `controller`, `core`, `evidence`, `execution`, `lease`, `memory-native`, `planner`, `scheduler`, `storage`; с тех пор добавились `gate-runner`, `web`, `worktree-adapter`.
  2. **`files` уже есть у всех 15** (независимая проверка `evidence/foundation-18-manifests.md` + перемер 2026-10-03): у 13 — `files: ["lib"]` (например `contracts/package.json:17-19`), у `controller` — `files: ["lib","cordis.patch.yml"]` (`:17-20`), у `web` — `files: ["lib","cordis.patch.yml","icon.svg"]`. Дополнительно: `dsh`-поле и `peerDependencies` есть у **двух** — `controller` и `web` (`peer=True` у 2 из 15), и ровно эти два файла считают гейты F-48/F-60.
  3. `devDependencies` на `workspace:*` есть у `controller` (`:33-38`); при `pnpm pack` workspace-диапазоны переписываются (`scripts/pack.mjs:3-8`).
  4. **Решение D04 (вариант B):** «объявить peers по реально используемым сервисам и `dsh.engines.dsh`; распространять **tarball'ом**; **`private` сохранить у всех**, кроме будущего `@dsh-mywork/web` (решение по нему — в D18)».
  5. **Решение D18:** форма UI-пакета — отдельный **`@dsh-mywork/web`**; именно он (и только он) снимает `private`.
  5a. **`private: true` установке НЕ мешает** (`evidence/lead-03-peer-gate.md`, п. 15): прецедент `verify:profile: PASS`; внутри tarball `private` сохраняется, `devDependencies` зависимости не ставятся. Блокеры `private`/`devDeps` — это блокеры **реестра и линта**, а не tarball-доставки.
  6. Способ доставки: `scripts/pack.mjs` (`scripts/pack.mjs:3-8`) + проверка установки `scripts/verify-profile.mjs:1-10` (изолированный `DSH_HOME`).
- **Шаги:**
  1. Проверить фактические `files`/`private` во всех **15** манифестах: `Get-ChildItem packages -Directory | ForEach-Object { (Get-Content "packages\$($_.Name)\package.json" | ConvertFrom-Json) | Select-Object name, private, files }` → записать таблицу.
  2. `private: true` **оставить** во всех пакетах, где он есть (**14**; у `web` его нет — D18). Никакой группы «публикуемых» пакетов не создаётся.
  3. `files` **уже настроен у всех 15** — правка не требуется; шаг 3 сводится к **проверке** (шаг 1) и к добавлению `files` только если появится новый пакет.
  4. Будущий `@dsh-mywork/web` (F-58) — единственный кандидат на снятие `private`; это **отдельный** шаг в рамках D18, не часть F-49.
  5. Проверка канала: `node scripts/pack.mjs` → tarball; распаковать и убедиться, что внутри нет `@dsh-mywork/*`-импортов (`tsdown` инлайнит workspace-пакеты; образец ассерта — `tests/boundaries.test.mjs:480-494`).
  6. Тест (падающий): каждый манифест объявляет `files` → `node --test --test-isolation=none tests/publish-manifest.test.mjs` → FAIL до правки.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/publish-manifest.test.mjs` → `# fail 0`; `node scripts/pack.mjs` → `EXIT=0` с непустым tarball; `Select-String -Path packages\*\package.json -Pattern '"private": true'` → **14** совпадений (нет только у `web`); `Select-String -Path packages\*\package.json -Pattern '"files"'` → **15** совпадений.
- **Evidence:** таблица «пакет → `private` → `files`»; содержимое tarball (список файлов + grep на `@dsh-mywork/`); вывод теста; цитата D04.
- **Риски:** случайная публикация внутреннего пакета. Митигация: `files` у всех 15 + `private: true` у 14 (единственное снятие — `web` по D18); канал — только tarball.
- **Зависимость от D-решений:** **D04** — принято (вариант B: tarball, `private` сохранить). **D18** — определяет единственное исключение (`@dsh-mywork/web`).

---

#### F-50 · Матрица совместимости и ADR-пакет

- **Карточка:** MW-040/041; ADR-действие по D01/D03/D04 · **Зависит:** F-48, F-49.
- **Усилие:** S · **Риск:** низкий · **Откат:** нет (документ).
- **Цель:** зафиксировано, с какой версией DSH работает MyWork и что происходит при расхождении.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-50-compat-matrix.md`; ADR — зона `decision-desk`.
- **Проверенные факты:**
  1. DSH-checkout: версия **0.2.0-rc.2** (`639ed0153`, тег `dsh-v0.2.0-rc.2`; в кампании v0.3 здесь стояло `0.1.7-rc.2`), TypeScript **`^6.0.3`** (перемерено на `639ed0153` — не изменился) — расхождение с MyWork TS `~5.7.2` (`package.json:25`), `FINAL-REPORT` §12.4.
  2. Корневой `package.json:8` — `packageManager: pnpm@12.4.2`; `:9-11` — `engines.node >= 22.18.0`; фактически `node v24.19.0`, `npm 11.17.0`, `corepack 0.35.0`.
  3. Живой профиль использует `@linxin666/dsh-client-ui-task-board` **0.4.4** и `@linxin666/dsh-web-all` **0.4.4** (`C:\Users\Dmitry\.dsh\profiles\web\package.json`; в кампании v0.3 было `0.4.3` — актуализация 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8); peer-манифест локального референса (по отчёту §3.3(4), на базе): `peerDependencies: {"@deepseek-ai/dsh": ">=0.1.7-rc.2"}`.
- **Шаги:**
  1. Построить матрицу «DSH-рантайм × MyWork-версия × вердикт гейта»: строки — `0.1.7-rc.2` (база кампании v0.3), **`0.2.0-rc.2` (текущий рантайм)**, `0.2.0` (финал линии), `0.2.1-alpha.1`, `0.3.0-rc.1`, `0.3.0`; столбцы — вердикт `evaluatePluginCompatibility` для **объявленного** диапазона `>=0.1.7-rc.2 <0.3.0-0` (решение владельца 2026-10-03).
  2. Проверить верхнюю границу: `0.3.0` → **несовместим** (`semver.satisfies('0.3.0', '>=0.1.7-rc.2 <0.3.0-0', { includePrerelease: true })` → `false`) и `0.3.0-rc.1` → **несовместим** (`false`). Ловушка, из-за которой верх пишется с `-0`: `semver.satisfies('0.3.0-rc.1', '>=0.1.7-rc.2 <0.3.0', { includePrerelease: true })` → **`true`** (пререлиз следующей линии проходит «мимо» защиты).
  3. Проверить пререлизы и финал `0.2.0`: `semver.satisfies('0.2.0-rc.2', '…<0.3.0-0', { includePrerelease: true })` → `true` (гейт передаёт `includePrerelease: true`, `plugin-compatibility.ts:77`); `0.2.0` → `true`; `0.2.1-alpha.1` → `true` (**остаточный факт:** пререлиз следующего патча проходит — это свойство `includePrerelease`, а не дефект выбранного диапазона).
  4. Записать политику (актуализировано 2026-10-03): развилка (б) из §4.2 evidence **наступила** — диапазон расширен до `<0.3.0-0`, поэтому финал линии `0.2.0` принимается, а не отсекается; закрытие верхней границы до `<0.2.0-0` (прежняя митигация §4 п.5) **вредно** — оно отвергает текущий рантайм `0.2.0-rc.2`. Следующее условие пересмотра — выход линии `0.3.0`.
- **Гейт (готово когда):** матрица из **6** строк (шаг 1) посчитана **командой**, а не рукой, и приложена в evidence. Исполнимая форма (без многоточия; из корня MyWork, `semver` в воркспейсе не резолвится — берётся модуль гейта из чекаута): `node -e "const s=require('C:/Reposit/deepseek-harness/deepseek-harness/packages/boot/app-boot/node_modules/semver');const r='>=0.1.7-rc.2 <0.3.0-0';for(const v of ['0.1.7-rc.2','0.2.0-rc.2','0.2.0','0.2.1-alpha.1','0.3.0-rc.1','0.3.0'])console.log(v,s.satisfies(v,r,{includePrerelease:true}))"` → exit 0 и шесть строк вердиктов `true / true / true / true / false / false` (замер 2026-10-03).
- **Evidence:** вывод исполнимой команды из гейта (шесть строк вердиктов) плюс отдельные прогоны ловушек (шаги 2–3: верх без `-0`, пререлизы); текст политики; `plugin-compatibility.ts:68,75,76,77`.
- **Риски:** политика устареет молча. Митигация: **F-64** — гейт цитат плана (`node scripts/check-plan-citations.mjs --dsh-checkout <DSH-чекаут>`), который краснеет на возвращённой цитате `0.1.7-rc.2`; плюс шаг 5 F-48 (тест гейта на выбранном диапазоне).
- **Зависимость от D-решений:** D01 (транспорт), D03 (имя workflow-движка), D04.

---

#### F-51 · Бюджет: мост `ctx.tokenMeter.measure(...)` → `BudgetCharge`

- **Карточка:** MW-013/034 (правка: «Budget/step circuit-breaker поверх `dsh-token-meter`») · **ADR-действие:** D05.
- **Зависит:** F-31, F-43 · **Разблокирует:** F-52, F-53.
- **Усилие:** M · **Риск:** средний · **Откат:** revert.
- **Цель:** существующий учёт MyWork получает **измерение** из платформы; второй учёт не строится.
- **Файлы:** Create `packages/controller/src/budget-meter.ts`; Create `tests/budget-meter.test.mjs`.
- **Проверенные факты:**
  1. Платформенный сервис: `token-meter/src/index.ts:94-96` — `declare module '@deepseek-ai/cordis' { interface Context { tokenMeter: TokenMeter } }`; `:101` — `export class TokenMeter extends Service`; `:111` — `super(ctx, 'tokenMeter')`.
  2. Единственный публичный метод измерения: `:146` — `measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement`.
  3. Форма результата: `token-meter/src/types.ts:22-35` — `TokenMeasurement { logRevision, baseline, surfaceDeltaTokens, totalTokens, surfaceTokens, nodes }`; `:16-19` — `TokenMeasurementBaseline = {kind:'none',tokens:0} | {kind:'estimated',tokens} | {kind:'usage',tokens,usage}`.
  4. **Учёт в MyWork уже есть и он полный:** `packages/core/src/budget.ts:63-68` `knownAmount`; `:71-76` `unknownAmount`; `:86-88` `amountValue`; `:96-100` `addAmounts`; `:122-140` `chargeConsumption(consumption, charge) → { consumption, charged }`; `:151-169` `readCallTokens(usage) → ModelCallTokens`; `:181-188` `modelCallCost(route, rate, tokens) → BudgetAmount`; `:195-200` `modelRateOf(table, route)`; **`:217-239` `decideBudgetAdmission(input) → BudgetDecision`**.
  5. Ограничители §30: `contracts/src/budget.ts:78` — `BUDGET_LIMIT_NAMES`; `chargeOf` (`core/src/budget.ts:260-279`) знает `maxAttempts`, `maxReviewLoops`, `maxPlannerCalls`, `maxOptimizerCostPerDay`, `maxTokensPerTask`, `maxCostPerTask`, `workspaceDailyBudget`, `providerDailyBudget`.
  6. **Точка enforcement уже существует:** `packages/core/src/scheduler.ts:568` — `const decision: BudgetDecision = decideBudgetAdmission({ limits: workspace.budget, ledgers, request })`; импорт на `:70`. Это **единственное** место вызова (grep по `packages` даёт `:568`).
  7. `contracts/src/scheduler.ts:212` документирует: «(`@dsh-mywork/core` `decideBudgetAdmission`)»; `:304` — `readonly consumption: BudgetConsumption`.
  8. **Чего нет:** ни одного вхождения `tokenMeter`/`dsh-token-meter` в `packages/**/src` MyWork; ни одного вызова `readCallTokens` в `packages/**/src` (grep даёт только определение и реэкспорт `core/src/index.ts:333-334`).
- **Шаги:**
  1. Тест (падающий, **правило D5 — некумулятивность**): `totalTokens` — **текущее давление запроса, а не накопленный расход** (`token-meter/src/types.ts:29-30` — «Non-negative current request-and-response pressure»; `token-meter/src/index.ts:187` — `totalTokens: Math.max(0, baseline.tokens + surfaceDeltaTokens)`), поэтому снимок **нельзя** выдавать за расход, и значение **может уменьшаться** (сжатие поверхности, смена baseline). Точка входа одна — `ctx.tokenMeter.measure(session, header?)` (`:146`). `bridgeMeasurement({ measurement, route, rate })` начисляет `BudgetCharge.tokens` **накоплением положительных дельт давления**: мост держит на попытку `seen` (последнее увиденное давление) и `charged` (начисленное), на каждом `measure` считает `delta = Math.max(0, measurement.totalTokens − seen)`, затем `charged += delta` и `seen = measurement.totalTokens`; в `BudgetCharge` идёт `tokens: knownAmount(charged)`, `cost` — от `modelCallCost`.
      **Что делать с отрицательными/нулевыми дельтами (сжатие поверхности или смена baseline):** дельта `≤ 0` даёт `0` — **возврата и вычитания нет** (иначе лимит 2M недосчитывается, ровно сценарий D5); отдельный кламп снизу не нужен — платформа уже вернула `totalTokens ≥ 0` (`:187`). `surfaceDeltaTokens` (`types.ts:28`) — знаковая дельта **относительно baseline**, и она не заменяет накопитель: расход попытки считают по дельтам **давления**. Отсюда прямое требование к реализации: `knownAmount(totalTokens)` — снимок — **запрещён** как накопленный расход, это и был дефект NB-1.
      Команда: `node --test --test-isolation=none tests/budget-meter.test.mjs` → FAIL.
  2. Тест (падающий, **некумулятивность явно**): три снимка давления одной попытки — `1000` → `1600` → `900` (последний — сжатие) дают `charged = 1600`, а **не** `900` (снимок) и **не** `2500` (сумма модулей); сто снимков с постоянным давлением `500` дают `charged = 500`, а не `50 000`.
     Команда: `node --test --test-isolation=none tests/budget-meter.test.mjs` → FAIL.
  3. Тест (падающий): `baseline.kind === 'estimated'` → `tokens` **всё равно известны** (это измерение, пусть и эвристическое), но в `BudgetCharge` добавляется пометка источника; `baseline.kind === 'none'` при `totalTokens === 0` → `knownAmount(0)`, **не** `unknownAmount` (ноль — это измерение; правило из `core/src/budget.ts:107-113`).
     **Внимание:** это отличие от текущего поведения `chargeConsumption` (`:128-129` — «omitting it leaves … unknown») и оно требует явного решения D05.
  4. Тест (падающий, **лимит действительно срабатывает**): накопленные положительные дельты `2 000 001` против `maxTokensPerTask = 2_000_000` (F-52) → `decideBudgetAdmission(...)` даёт `{ kind: 'refused', reason: 'limit-exceeded' }`; при `2 000 000` — допуск. Это и есть защита от недосчёта: потолок считается от **накопления** F-51, а не от снимка давления.
  5. Реализация `budget-meter.ts`: `readonly tokenMeter?: { measure(session, header?) }` в опциях composition root; мост строит `BudgetCharge`; **никакого** собственного счётчика токенов не заводится — накопитель хранит только последнее давление и сумму положительных дельт, то есть **производную от `measure`**, а не второй учёт (`BudgetConsumption` остаётся единственным хранилищем расхода, `contracts/src/budget.ts:36`).
  6. Команда: `node --test --test-isolation=none tests/budget-meter.test.mjs` → `pass 5 / fail 0`.
  7. Проверить, что `decideBudgetAdmission` вызывается с новым `request` — правка **только** в `core/src/scheduler.ts:568` либо в вызывающем его коде, без второй точки enforcement.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/budget-meter.test.mjs` → `# pass 5`, `# fail 0`, и в выводе присутствуют оба именованных кейса: «некумулятивность: давление 1000→1600→900 ⇒ charged 1600 (не 900 и не 2500)» и «лимит: 2 000 001 накопленных ⇒ limit-exceeded, 2 000 000 ⇒ допуск». Дополнительно (и **само по себе это не приёмка** — совпадение даёт и комментарий, поэтому прежняя формулировка гейта была пустой): `Select-String -Path packages\**\src\*.ts -Pattern 'tokenMeter'` → **≥1** совпадение (было 0).
- **Evidence:** вывод теста (оба именованных кейса — некумулятивность и лимит); цитаты `token-meter/src/index.ts:146,187`, `types.ts:16-19,22-35`; цитата `core/src/budget.ts:122,217`; новое вхождение `tokenMeter`.
- **Риски:** «второй учёт» — главный риск. Правило: **любое** число токенов приходит из `ctx.tokenMeter.measure(...)`; MyWork хранит только `BudgetConsumption` и не считает токены сам. Накопитель F-51 (`seen` + `charged`) правилу не противоречит: он ничего не измеряет, а только суммирует положительные дельты того, что вернул `measure`, и снимок давления в `BudgetCharge` не попадает.
- **Не делать:** не строить второй счётчик; не дублировать `BudgetConsumption` (он уже в `contracts/src/budget.ts:36`).
- **Зависимость от D-решений:** **D05** (бюджет и лимит шагов: механизм, точки enforcement, значения, поведение при превышении).

---

#### F-52 · Бюджет: значения по умолчанию и поведение при превышении

- **Карточка:** MW-013/034, D05 · **Зависит:** F-51.
- **Усилие:** S · **Риск:** средний (значения влияют на то, что останавливается) · **Откат:** вернуть «без лимита» (лимит не объявлен).
- **Цель:** у каждого лимита §30 есть значение по умолчанию и определённое поведение при превышении — сейчас значений нет вообще.
- **Файлы:** Create `packages/core/src/budget-defaults.ts`; Create `tests/budget-defaults.test.mjs`.
- **Проверенные факты:**
  1. `decideBudgetAdmission` (`core/src/budget.ts:217-239`) **не имеет значений по умолчанию**: лимит, который не объявлен, «не проверяется вовсе» (`:210-212`: «A limit the request does not charge is not checked at all»). То есть сегодня по умолчанию **нет ни одного ограничителя**.
  2. Три исхода отказа: `:228` `scope-not-measured`, `:231` `limit-unverifiable`, `:234` `limit-exceeded`; `:242-254` `refuse(...)` строит `BudgetRefusal`.
  3. `core/src/budget.ts:10-12` (JSDoc модуля) прямо говорит: «The gate refuses, it does not repair: §30's three outcomes (pause, escalate, human decision) are workflow policy, and choosing one of them here would invent a fallback the architecture leaves to the caller».
  4. Существующие узкие бюджеты платформы (для контекста, `FINAL-REPORT` §9.3 RT-2): `maxRounds` 256, `error_max_budget_usd`, `sessionBudgetExceeded`, `max_turn_requests`, `delegationDepth`.
- **Шаги:**
  1. Тест (падающий): `DEFAULT_BUDGET_LIMITS` содержит значения для `maxAttempts`, `maxReviewLoops`, `maxPlannerCalls`, `maxTokensPerTask`, `maxCostPerTask` → сегодня отсутствует.
     Команда: `node --test --test-isolation=none tests/budget-defaults.test.mjs` → FAIL.
  2. Тест (падающий): каждый лимит из `DEFAULT_BUDGET_LIMITS` **явно объявлен** (не `undefined`), и `decideBudgetAdmission` при исчерпании даёт `limit-exceeded`, а не «лимит не проверялся». Исчерпание подаётся **накопленным** `BudgetConsumption.tokens` из F-51 (положительные дельты давления), а не снимком `totalTokens`: `maxTokensPerTask` — потолок **расхода попытки**.
  3. Тест (падающий): поведение при превышении определено: `refused` → попытка переводится в `needs-attention` с `BudgetRefusal` в качестве причины, **не** молчаливый retry.
  4. Реализация: константы + функция `budgetLimitsFrom(config)`; **канон значений (R-16, D05): 60 шагов и 2M токенов на попытку** — `maxSteps = 60`, `maxTokensPerTask = 2_000_000`; остальные лимиты — за владельцем (D05). **Расхождение с каноном — дефект, а не настройка.** Семантика `maxTokensPerTask` (D5/NB-1): лимит сравнивается с **накопленными положительными дельтами** давления, которые начисляет мост F-51, — значение может быть достигнуто только накоплением, снимок `totalTokens` его не «съедает» и не «обнуляет».
  5. Команда: `node --test --test-isolation=none tests/budget-defaults.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/budget-defaults.test.mjs` → `# pass 3`, `# fail 0`, и в выводе — кейс «накопленный расход `2 000 000` → допуск, `2 000 001` → `limit-exceeded`» (то есть лимит считается от накопления F-51, а не от снимка давления); и `Select-String -Path packages\core\src\budget-defaults.ts -Pattern 'maxAttempts|maxTokensPerTask'` → ≥2.
- **Evidence:** вывод теста; таблица «лимит → значение → поведение при превышении»; цитата `core/src/budget.ts:210-212` (доказательство «сегодня лимитов нет»).
- **Риски:** выбранные значения остановят реальную работу. Митигация: значения конфигурируемы и по умолчанию консервативны; первый прогон — в режиме «предупреждать, не останавливать» (`Шаг 0`: подтвердить с владельцем).
- **Зависимость от D-решений:** **D05** — значения выбирает владелец.

---

#### F-53 · Шаговый circuit-breaker

- **Карточка:** MW-013/034, RT-2 · **Зависит:** F-52.
- **Усилие:** S · **Риск:** средний · **Откат:** revert.
- **Цель:** у агентского цикла появляется предел числа шагов; runaway-стоимость ограничена вторым, независимым от токенов, счётчиком.
- **Файлы:** Create `packages/core/src/step-breaker.ts`; Create `tests/step-breaker.test.mjs`.
- **Проверенные факты:**
  1. `FINAL-REPORT` §9.3 RT-2: «**подтверждён в ядре, дважды уточнён**: глобального cap'а и лимита шагов агентского цикла нет, но есть узкие бюджеты (`maxRounds` 256, `error_max_budget_usd`, `sessionBudgetExceeded`, `max_turn_requests`, `delegationDepth`, бюджеты времени/раундов/поиска), а в MyWork **уже есть** учёт (`tokenCount`/цена вызова, `BudgetConsumption {tokens, cost}`)».
  2. `chargeConsumption` (`core/src/budget.ts:122-140`) **уже умеет** считать `attempts`, `reviewLoops`, `plannerCalls` — счётчик шагов не нужно изобретать, нужно назвать его лимитом.
  3. `decideBudgetAdmission` проверяет `maxAttempts` через `chargeOf` (`:262-263` — `request.kind === 'attempt' ? knownAmount(1) : undefined`) — то есть «один шаг = один attempt» уже выразимо.
- **Шаги:**
  1. `Шаг 0`: определить, что такое «шаг агентского цикла» в терминах MyWork: один `Attempt`? один round внутри попытки? Записать определение — без него лимит бессмысленен.
  2. Тест (падающий): `stepBudget({ limits: { maxSteps: 3 }, steps })` → 4-й шаг даёт `{ kind: 'refused', reason: 'limit-exceeded' }`.
     Команда: `node --test --test-isolation=none tests/step-breaker.test.mjs` → FAIL.
  3. Тест (падающий): лимит шагов **сбрасывается** на новую попытку только по явному правилу (иначе длинная задача никогда не завершится).
  4. Реализация: **переиспользовать** `BudgetLimits`/`BudgetConsumption`, добавив новое имя лимита `maxSteps` в `BUDGET_LIMIT_NAMES` (`contracts/src/budget.ts:78`) и ветку в `usedOf`/`chargeOf` — **второй механизм не строится**.
  5. Команда: `node --test --test-isolation=none tests/step-breaker.test.mjs` → `pass 2 / fail 0`; регрессия `node --test --test-isolation=none tests/budget.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/step-breaker.test.mjs tests/budget.test.mjs` → `# fail 0`
- **Evidence:** вывод обоих тестов; diff `contracts/src/budget.ts` (`BUDGET_LIMIT_NAMES`) и `core/src/budget.ts` (`chargeOf`/`usedOf`); определение «шага».
- **Риски:** расширение `BUDGET_LIMIT_NAMES` — закрытый union; `requireAdmissionInput` (`:327-336`) отвергает неизвестные имена, значит добавление обязано быть согласованным. Митигация: правка — одна ветка в двух `switch`; регрессия `tests/budget.test.mjs` (20696 б) ловит расхождение.
- **Зависимость от D-решений:** D05.

---

#### F-54 · Наблюдаемость: экспорт `correlationId` через `ctx.productTelemetry`

- **Карточка:** MW-013/034 (правка: «экспорт `correlationId`»; **формулировка «OTel-экспорт» из `FINAL-REPORT` §9.1 отменена решением D16**), **P7** · **ADR-действие:** D16.
- **Зависит:** F-31 · **Усилие:** M · **Риск:** низкий · **Откат:** revert.
- **Цель:** 90 вхождений `correlationId` перестают быть внутренним полем и становятся атрибутом **продуктового** события. **Внимание (D16):** «Свой audit/outbox с `correlationId` — истина; `productTelemetry` — наружу; **OTel-экспортёр не строим**». Поэтому шаг реализует экспорт через платформенный `product-telemetry`, а **не** через OpenTelemetry.
- **Файлы:** Create `packages/controller/src/telemetry.ts`; Create `tests/telemetry.test.mjs`.
- **Проверенные факты (API `productTelemetry` — независимая проверка, `evidence/foundation-17-telemetry.md`):**
  1. `FINAL-REPORT` §8.1: «0 метрик/спанов при 90 вхождениях `correlationId`»; §8.2 P7: «0 вхождений otel/telemetry; `correlationId` 90 / `correlation_id` 24».
  2. **Собственная проверка (эта кампания):** `Select-String -Path packages\**\src\*.ts -Pattern 'opentelemetry|otel|traceId|spanId|tracer|productTelemetry'` → **0 совпадений**. Экспорта нет вообще.
  3. Корреляция присутствует на всех сквозных путях: `storage/src/outbox.ts:54,117,129,153,245`; `evidence/src/audit.ts:78,105,145`; `evidence/src/artifacts.ts:79,110,143,171`; `execution/src/service.ts` — 22 вхождения; `planner/src/service.ts` — 16 вхождений; `contracts/src/events.ts:111`; `contracts/src/operation.ts:21`.
  4. `core/src/guards.ts:28,46,51` — `correlationId` проходит через `requireIdentifier`, то есть **валидирован** и непуст.
  5. Источник идентификатора на периферии — DSH: `controller/src/index.ts:68` — `DSH_REQUEST_ID_PREFIX`.
  6. **Решение D16:** истина корреляции — свой `audit`/`outbox`; наружу — `productTelemetry`; OTel-экспортёр **не строим**.
  7. **Найденный пакет:** `packages/host/product-telemetry-otel/package.json:2` = `@deepseek-ai/dsh-host-product-telemetry-otel`, `:4` version `0.2.0-rc.2` (на `639ed0153`; в кампании v0.3 — `0.1.7-rc.2`).
  8. Имя сервиса: `src/index.ts:9` — `interface Context { productTelemetry: ProductTelemetry }`; `:84` — `super(ctx, 'productTelemetry')` (файл 121 строка на `639ed0153`; прежние якоря `:15`/`:102` сдвинуты — актуализировано 2026-10-03).
  9. **Единственный публичный метод:** `src/index.ts:118` — `emit(record: ProductTelemetryRecord): void` (синхронная постановка в очередь, без ожидания сети). Подтверждено каталогом: `packages/extensions/tool-cordis/src/api-catalog.ts:1756` — та же сигнатура (было `:1706`).
  10. **Форма записи — уехала из плагина в общий OTel-слой** `packages/telemetry/otel/src/event-log.ts` (`interface OTelEventRecord` — `:16`; `ProductTelemetryRecord` — его алиас, `src/index.ts:13`): **обязательные** — `:18` `eventName: string`, `:20` `body: string`, `:22` `timestamp: number` (Unix ms); **опциональные** — `:24` `severityNumber?: SeverityNumber` (по умолчанию INFO — `:73`, `record.severityNumber ?? SeverityNumber.INFO`), `:26` `attributes?: Record<string, OTelEventScalar | Record<string, OTelEventScalar>>`.
  11. На `emit` добавляются `observedTimestamp: Date.now()`, `severityNumber` и `severityText: SeverityNumber[severityNumber]` — одной строкой `packages/telemetry/otel/src/event-log.ts:74` (в `EventLogReporter.emit`, `:72`); прежняя редакция указывала `:166-168` внутри плагина — в 0.2.0-rc.2 этих строк в `src/index.ts` нет.
  12. **Политики PII в пакете НЕТ:** runtime-редакций, allow/deny-списка полей и валидации содержимого в `src` нет. Есть только doc-инварианты: `packages/telemetry/otel/src/event-log.ts:19` — «never a prompt, response, credential, or file contents»; `README.md:57,104` — «Caller-selected strings are **not redacted automatically**. This package does not decide product disclosure or consent policy.» (`:104` — актуализировано 2026-10-03: на базе фраза была на `:103`; абзац «Callers must exclude prompts…» — `:57`, на базе `:56`).
- **Шаги:**
  1. `Шаг 0` (выполнен субагентом): API выше подтверждён; **`body` — свободный текст и обязательное поле**, значит он и есть главный канал утечки — белый список F-55 обязан покрывать **`body`**, а не только `attributes`.
  2. Тест (падающий): `toProductEvent({ correlationId, workspaceId, operationId, outcome, durationMs })` → `{ eventName, body, timestamp, attributes: { 'mywork.correlation_id': … } }`, где `eventName` — из закрытого набора, `body` — **фиксированная** строка без подстановки пользовательских данных.
     Команда: `node --test --test-isolation=none tests/telemetry.test.mjs` → FAIL.
  3. Реализация `telemetry.ts`: чистая функция преобразования + `emit(...)` через `ctx.get('productTelemetry')`; если сервиса нет — **ничего не делать** и вернуть `{ emitted: false }` (fail-open, с явным флагом «telemetry disabled»).
  4. Тест (падающий): без `productTelemetry` в контексте `emit` не бросает и возвращает `{ emitted: false }`.
  5. Команда: `node --test --test-isolation=none tests/telemetry.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/telemetry.test.mjs` → `# pass 3`, `# fail 0`; и `Select-String -Path packages\**\src\*.ts -Pattern 'productTelemetry'` → **≥1** (было 0).
- **Evidence:** вывод grep «до» (0); вывод теста; `файл:строка` источника `correlationId`; API из `evidence/foundation-17-telemetry.md`; цитата D16.
- **Риски:** `README.md:104` прямо говорит, что пакет **не** редактирует строки вызывающего → утечка возможна только через наши данные. Митигация: F-55 (белый список, включая `body`) исполняется **до** включения экспорта в профиле.
- **Не делать:** **не строить OTel-экспортёр** — D16 это прямо запрещает. (Замечание: в DSH есть пакеты `packages/session/session-telemetry-otel` и `packages/session/session-telemetry`; их существование не отменяет D16 — мы их не используем.)
- **Зависимость от D-решений:** **D16** — принято: свой `correlationId` — истина, `productTelemetry` — наружу, OTel не строим.

---

#### F-55 · Наблюдаемость: состав событий и политика PII

- **Карточка:** MW-013/034, RT-5 · **Зависит:** F-54.
- **Усилие:** S · **Риск:** средний (утечка) · **Откат:** выключить экспорт.
- **Цель:** экспортируются только разрешённые поля; тела артефактов, промпты и содержимое файлов в телеметрию не попадают.
- **Файлы:** Create `.work/plan-v0.3/evidence/foundation-55-telemetry-pii.md`; Modify `packages/controller/src/telemetry.ts`.
- **Проверенные факты:** `FINAL-REPORT` §8.1: «0 реальных утечек, 5 синтетических фикстур в тестах, 0 в `.work`» — «чисто, но без автоматического гейта»; RT-5: «подтверждён частично (heartbeat 0.4.3 жив, выключателя нет; сканер секретов не покрывает тела)» — *(цитата RT-5 — замер кампании v0.3 на доске 0.4.3; на установленной 0.4.4 heartbeats не перемерялись)*.
- **Шаги:**
  1. Составить список разрешённых атрибутов: идентификаторы (`correlationId`, `workspaceId`, `taskId`, `attemptId`, `operationId`), тип операции, исход (`succeeded`/`failed`/`refused`), длительность, число попыток. **Никаких** тел.
  2. Тест (падающий): `emit` **бросает** `TypeError`, если в атрибутах встречается ключ из запрещённого набора (`prompt`, `content`, `body`, `bytes`, `payload`, `stderr`, `stdout`).
     Команда: `node --test --test-isolation=none tests/telemetry.test.mjs` → FAIL (новый кейс).
  3. Реализация: белый список, а не чёрный — неизвестный ключ отвергается.
  4. Команда: `node --test --test-isolation=none tests/telemetry.test.mjs` → `pass 4 / fail 0`.
  5. Согласовать с `23-STEPS-quality.md`: `plan-quality` владеет сканером **тел** (F-38…F-40 отдают механику удаления). Здесь — только граница того, что **выносится наружу**.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/telemetry.test.mjs` → `# pass 4`, `# fail 0`; и в evidence есть таблица «атрибут → разрешён/запрещён → почему».
- **Evidence:** таблица; вывод теста; цитата RT-5.
- **Риски:** белый список заблокирует полезную диагностику. Митигация: добавление атрибута — правка списка в одном месте с обязательным тестом.
- **Зависимость от D-решений:** D16, D17.

---

#### F-56 · Allowlist инструментов worker-поверхности

- **Карточка:** MW-022/MW-024 (правка: «запретить `cordis_*`/dynamic в поверхности worker'а»), RT-3/RT-4, G-S4/S5 · **ADR-действие:** D15 (без нового ADR).
- **Зависит:** F-31 · **Усилие:** S · **Риск:** средний (можно отрезать нужный инструмент) · **Откат:** revert.
- **Цель:** worker-сессия видит **только разрешённые** инструменты; инструменты, меняющие композицию плагинов, недоступны по построению.
- **Файлы:** Create `packages/core/src/worker-surface.ts` (или константа в `packages/contracts` — см. D15 ниже); Create `tests/worker-surface.test.mjs`.
- **Проверенные факты:**
  1. `FINAL-REPORT` §9.2(3): «Negative requirements: `cordis_*`/dynamic вне поверхности worker'а; `auto-review` только deny» — усилие S+S, примитивы `tools`, `auto-review`.
  2. §9.3 RT-3: «**опровергнут в сильной форме**: approval привязан к `packageId`, будущие версии — только явный opt-in (`requiresApproval`, `approveFutureVersions` по умолчанию false). **всё равно запретить `cordis_*` в worker-поверхности**».
  3. §9.3 RT-4: обход review через LLM-аппрувер — «подтверждён как риск».
  4. Инструменты платформы доступны через `ctx.commands.execute(agent, line, [], signal)` — образец вызова есть в `dsh-client-ui-task-board/lib/index.js:5572-5576`.
  5. **Решение D15 (вариант B): «allowlist инструментов worker-поверхности плюс правило «`auto-review` только deny».** Последствия D15: «регистрация worker-сессий с `ctx.tools.restrict`-фильтром; список запрещённых имён — **константа в `packages/contracts`**; `auto-review`-путь получает только `review.request-changes`»; контракты: «`IMPLEMENTATION_WRITE_PERMISSIONS`/`REVIEWER_DEFAULT_PERMISSIONS` (`packages/contracts/src/security.ts:201,212`) используются как источник, **новых типов не вводится**».
  6. **Механизм найден и подтверждён (независимая проверка, `evidence/foundation-16-tools-restrict.md`):**
     - `packages/core/tools/src/index.ts:807` — `export class ToolRuntime extends Service`; `:849` — `super(ctx, 'tools')` → сервис в `ctx` называется `tools`.
     - `:1097` — `restrict(filter: ToolRestriction): () => void`; тип `:700` — `interface ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }`; `:974` — `presentAs(mode: ToolPresentationMode): () => void`.
     - **`deny` нельзя объявить заранее:** `:1114-1117` — неизвестное имя инструмента в фильтре является **ошибкой**; `:1105` — пустой фильтр тоже ошибка; `:1111` — `run_code` ограничить нельзя. **Это ключевой довод в пользу allowlist (D15), а не denylist.**
     - `:1100` — `restrict` требует **scoped**-контекст (`agent.ctx`).
     - Фильтр применяется **при выборке**, а не при регистрации: `:1178` — `private view(scope?: ScopeKey): ToolView`; `:1200` — `if (layers.every(layer => layer.admits(name))) visible.set(name, definition)`; предикат `:758` — `admits(name: string): boolean`; чтение `:1230-1231` — `get()` → `this.view(scope).visible.get(name)`. `register()` (`:1063`) фильтр **не** проверяет.
     - Из фильтра исключены собственные регистрации scope (`:1204-1208`; комментарий `:1163-1168`) и транспорт `run_code` (`:1215-1217`).
     - **Динамическая регистрация после старта сессии покрыта фильтром:** `:1083-1087` пишет в слои через `layers.effect`; изменение эмитит `:835` `this.ctx.emit('tools/change')` (событие объявлено `:208`); схемы пересобираются провайдером (`:854`, `packages/core/system-prompt/src/index.ts:365,521`). Поскольку фильтр живёт в `view()`, глобально зарегистрированный инструмент под фильтр **попадает**.
     - **Открытый вопрос из D15 закрыт частично:** `tools.restrict` действует и на динамически регистрируемые инструменты **при условии scope-контекста**; распространение на субагентов, порождённых worker'ом, — по-прежнему не проверено.
  7. **Константы в MyWork уже есть** (`evidence/foundation-18-manifests.md`): `packages/contracts/src/security.ts:201-206` — `REVIEWER_DEFAULT_PERMISSIONS = ['workspace.read','git.read','tests','review.approve']`; `:212-216` — `IMPLEMENTATION_WRITE_PERMISSIONS = ['workspace.write','git.write','shell']`; `:193` — `DOMAIN_IMPLIED_GATES`; `:219-227` — `AUTHORIZATION_CONTEXT_FIELDS`, последнее поле `workerAgentId`. В MyWork **нет** ни одного упоминания `allowlist`/`restrict` (команда: `allowlist` → 0 совпадений).
- **Шаги:**
  1. `Шаг 0` (выполнен субагентом): механизм найден — `ctx.tools.restrict({ allow })` в scoped-контексте агента-исполнителя. Осталось получить **фактический** список имён инструментов worker-сессии (`ctx.tools` → `view().visible`) на живой сессии; в этой кампании он не снят (`~`, §7.2).
  2. Тест (падающий): `workerTools(all)` возвращает **только** имена из allowlist; инструмент вне allowlist (например `plugin_manager`, `cordis_*`) в результате отсутствует.
     Команда: `node --test --test-isolation=none tests/worker-surface.test.mjs` → FAIL.
  3. Тест (падающий): allowlist строится **поверх** `IMPLEMENTATION_WRITE_PERMISSIONS` / `REVIEWER_DEFAULT_PERMISSIONS` (`packages/contracts/src/security.ts:201,212`), а не как новый независимый список — проверяется тем, что источник импортируется и не дублируется.
  4. Реализация: фильтр через `ctx.tools.restrict` (механизм D15) + отчёт «что отфильтровано» для аудита, привязанный к `correlationId` попытки (F-54).
  5. Команда: `node --test --test-isolation=none tests/worker-surface.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/worker-surface.test.mjs` → `# pass 3`, `# fail 0`; в evidence приложен фактический список инструментов **до** и **после** фильтра.
- **Evidence:** вывод теста; список «до/после»; цитата D15; `файл:строка` `security.ts:201,212`.
- **Риски:** отрезание инструмента, нужного для легитимной работы. Митигация: allowlist — данные, а не код; расширение = правка константы + тест. Триггер пересмотра из D15: «появится инструмент, нужный worker'у и одновременно опасный — тогда он входит в allowlist с дополнительным `guard`».
- **Открытая проверка (из D15, уточнено проверкой):** «действует ли `tools.restrict` на динамически регистрируемые инструменты» — **да, действует** (фильтр в `view()`, `:1200`), **но** только для **scoped**-контекста (`:1100`) и с исключением собственных регистраций scope (`:1204-1208`). Остаётся непроверенным: распространяется ли фильтр на **субагентов**, порождённых worker'ом. Если нет — шаг обязан зафиксировать это и предложить обходной путь, а не считать задачу решённой.
- **Не делать:** не заводить новый тип прав — D15 требует опираться на существующие константы `packages/contracts/src/security.ts:201,212`. Не пытаться выразить запрет через `deny`: `tools/src/index.ts:1114-1117` отвергает неизвестные имена, поэтому denylist для ещё не зарегистрированных инструментов (`task_board_*`) неработоспособен by construction.
- **Зависимость от D-решений:** **D15** — принято (вариант B: allowlist + `auto-review` только deny).

---

#### F-57 · `auto-review` активен → ограничиваем правилом «только deny»

- **Карточка:** MW-022/MW-024, MW-069, RT-4, **R-22** · **Зависит:** F-56.
- **Усилие:** S · **Риск:** средний · **Откат:** revert правила.
- **Цель:** LLM-аппрувер **не может разрешить** действие; правило живёт **в MyWork** и не зависит от того, смонтирован ли плагин.
- **Файлы:** Modify точку, где MyWork получает решение review (`~` — см. `Шаг 0`); Create `tests/auto-review-deny-only.test.mjs`.
- **Проверенные факты (базовая линия исправлена — дефект **R-22**):**
  1. **`auto-review` СМОНТИРОВАН И АКТИВЕН:** `enabled: true`, `fiberPhase: active`. Формулировки «по умолчанию выключен» и «в профиле нет строки auto-review» **неверны** и в этом файле устранены.
  2. Пакет: `@deepseek-ai/dsh-experimental-auto-review` **0.2.0-rc.2** (на `639ed0153`; в кампании v0.3 — `0.1.7-rc.2`), `packages/experimental/auto-review/`, имеет `cordis.patch.yml` (88 б) и `src/`.
  3. `FINAL-REPORT` §9.2(3) и §9.3 RT-4: «`auto-review` только deny»; риск обхода review через LLM-аппрувер — **подтверждён**.
  4. **D15 (вариант B):** «allowlist инструментов worker-поверхности плюс правило «`auto-review` только deny»»; последствия D15: «`auto-review`-путь получает **только `review.request-changes`**».
  5. `@deepseek-ai/dsh-experimental-auto-review` смонтирован в живом профиле — значит **отсутствие плагина не является защитой**: правило обязано работать при активном аппрувере.
  6. В DSH есть закрытый union режимов прав (`sandbox-policy/src/index.ts:90-94`), поэтому «разрешающая» ветка review означала бы эскалацию режима **без человека**.
- **Шаги:**
  1. `Шаг 0`: найти точку, где MyWork получает решение review (`Select-String -Path packages\**\src\*.ts -Pattern 'review|approve|allow'`) → записать `файл:строка`. Отчёт (§9.1) указывает, что обзорный слой есть; `tests/review.test.mjs` (7784 б) — его тесты.
  2. Тест (падающий): решение `approve` от аппрувера **не** повышает режим: результат `{ kind: 'denied' }` **либо** эскалация к человеку (`HumanDecision`, D14) — но **никогда** `{ kind: 'allowed' }`.
     Команда: `node --test --test-isolation=none tests/auto-review-deny-only.test.mjs` → FAIL.
  3. Тест (падающий): аппруверу доступно **только** `review.request-changes`; попытка вернуть `approve` отвергается типизированно.
  4. Реализация: маппинг «reviewer says allow» → «human decision required» (`HumanDecision`); «reviewer says deny» → отказ. **Правило живёт в MyWork**, а не в конфигурации плагина.
  5. Тест (падающий, **инвариант базовой линии**): правило работает и при **активном** `auto-review` — проверяется тем, что решение `approve` отвергается **независимо** от наличия плагина в композиции.
  6. Команда: `node --test --test-isolation=none tests/auto-review-deny-only.test.mjs` → `pass 3 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/auto-review-deny-only.test.mjs` → `# pass 3`, `# fail 0`; и `Select-String -Path packages\**\src\*.ts -Pattern "kind: 'allowed'"` → **0** совпадений на пути review.
- **Evidence:** вывод теста; `файл:строка` точки review; список решений, которые аппрувер может вернуть; явная запись «`auto-review` активен (`enabled: true`, `fiberPhase: active`)».
- **Риски:** «deny-only» может заблокировать легитимные автоматические переходы. Митигация: deny-only касается **только** эскалации прав и самомодификации, не обычных команд.
- **Стык с `21-…` и `30-…`:** `plan-execution` (E-40) и `card-ledger` (MW-069) получают тот же дефект R-22 и правят свои формулировки; здесь фиксируется **инвариант MyWork** и тест, там — вызовы и приёмки. Приёмка «в профиле нет строки auto-review» **невыполнима** и подлежит замене владельцем карточки.
- **Не делать:** не полагаться на «плагин не смонтирован» — он активен; не выключать `auto-review` конфигурацией профиля как способ защиты (это действие человека над живым профилем и вне границ кампании).
- **Зависимость от D-решений:** D15 (allowlist + только deny), D14 (`HumanDecision` как носитель «reviewer says allow»).
---

#### F-58 · Installable UI-пакет `@dsh-mywork/web`: структура и `dsh.client`-манифест

- **Карточка:** MW-048 (пересмотр: «bare-имя пакета в client-строке, `dsh.client.immediately` для панели, `icon`, ручной CJS-формат бандла, `store` слота для view-состояния, свой префикс data-атрибутов») · **ADR-действие:** **D18**.
- **Зависит:** F-49 · **Усилие:** M-L · **Риск:** средний · **Откат:** revert пакета.
- **Цель:** Host-половина получает браузерную половину, и бандл физически регистрируется в клиенте.
- **Файлы:** Create `packages/web/package.json`, `packages/web/src/index.ts`, клиентский бандл (`packages/web/lib/client.js`); Modify `packages/controller/cordis.patch.yml` (строка клиента).
- **Проверенные факты (требования клиентского манифеста — независимая проверка, `evidence/foundation-15-client-manifest.md`):**
  1. **Bare-имя пакета в строке — обязательно.** `docs/cookbook/adding-a-settings-card.md:58`: «it attaches a package's half to the Loader row whose specifier is the **bare package name**. A row mounted from a subpath export never carries a half». Строка использует ключ `name:` — пример `packages/bundle/web-app/cordis.patch.yml:69-70` (`- id: ui-open-in-app` / `name: '@deepseek-ai/dsh-client-ui-open-in-app'`); ключа `client:` в патче **нет**.
  2. **Клиентская половина включается полем `dsh.client` в `package.json`.** Цитата из живой строки установленного плагина (`cordis.patch.yml:4-8`): «the node half (exports ".") runs in the host process … the `dsh.client` declaration in package.json makes the browser half (exports "./client") load».
  3. **Схема `dsh.client`:** `packages/client/modules/src/client/manifest.ts:161-181` — `parseDshClient` требует **только** `platform: string` и принимает ровно `platform` / `inject` / `external` / `immediately`. `packages/client/AGENTS.md:144`: «platform: 'web' always, and the declaration **requires a `./client` export** (the scan throws without one); `immediately: true` only for stage-one-prefetch infrastructure rows; `inject` … informational only». `docs/subsystems/client-modules.md:80` подтверждает; `packages/client/modules/README.md:34` добавляет `external`.
  4. **`bundle` — отдельный ключ, не часть `dsh.client`:** `docs/user/develop/basic/publish.md:42` — `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. У MyWork он уже есть: `packages/controller/package.json:21-25`.
  5. **Формат бандла — классический скрипт, не ESM.** `scripts/publint-all.ts:183`: «`lib/client.js` is evaluated by the page module system as a **classic script**». Содержимое: `window.__ModuleLoader__.load({ id: "@linxin666/dsh-client-ui-task-board", factory: (require) => { … } })` — то есть **ленивая CJS-фабрика** внутри `__ModuleLoader__`.
  6. **Exports-форма:** `docs/cookbook/adding-a-settings-card.md:66` — `"./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }`.
  7. Версия платформы и локальный референс: `@linxin666/dsh-client-ui-task-board` **0.4.4** (в кампании v0.3 — 0.4.3; актуализация 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8).
- **Шаги:**
  1. `Шаг 0` (выполнен субагентом): требования выше подтверждены. **Ключевой вывод:** нужен `exports["./client"]` → `./lib/client.js` (classic script) + `dsh.client = { platform: 'web' }`, а строка профиля должна называть **bare-имя** пакета. Открытым остаётся поле `icon` (п. 8 §7.2): в проверенных документах требование не найдено, но `icon.svg` присутствует у обоих эталонных пакетов.
  2. Create `packages/web` (имя пакета — `@dsh-mywork/web`) с манифестом: `name: "@dsh-mywork/web"` (**имя из D18**), `private` снимается только здесь (D04), `files: ["lib","icon.svg"]`, `exports` с `"."` и `"./client"`, `dsh.client = { platform: 'web' }`, `dsh.bundle.patch` — если у пакета есть строка.
  3. Собрать клиентский бандл в **формате `__ModuleLoader__.load({ id, factory(require) {…} })`** (ручной CJS-формат из §9.1 MW-048 → подтверждён п. 5). Положить как `lib/client.js`.
     **КРИТИЧНО (R-08, канон `01-MASTER-PLAN.md` §15.5):** **все 12 `tsdown.config.ts` имеют `clean: true`** — рукописный `lib/client.js` будет **стёрт любой сборкой пакета**. Обязательно одно из двух: (а) исключить `lib/client.js` из очистки (`clean: ['!lib/client.js']` или эквивалент), либо (б) пересобирать клиентскую половину **после** каждой сборки пакета — и зафиксировать это в скрипте сборки, а не в голове исполнителя.
  4. В client-строке профиля указать **bare-имя** пакета (`@dsh-mywork/web`), а не подпуть.
  5. Тест (падающий): манифест содержит `exports["./client"]`, `dsh.client.platform === 'web'`, `icon`, и `files` покрывает `lib` → `node --test --test-isolation=none tests/ui-package.test.mjs` → FAIL до правки.
- **Гейт (готово когда, ЛОКАЛЬНЫЙ — R-08):** `node --test --test-isolation=none tests/ui-package.test.mjs` → `# fail 0`; **`Test-Path packages\web\lib\client.js` → `True` ПОСЛЕ `corepack pnpm -r run build`** (это и есть проверка, что `clean: true` не стирает рукописный бандл); первые строки файла содержат `__ModuleLoader__.load`; `dsh.client` объявлен, и `exports['./client']` на него указывает. **Гейт не должен зависеть от живого профиля и ручной перезагрузки GUI** — проверка обязана быть локальной и воспроизводимой; видимость панели в GUI — **приёмочный** шаг (этап 5), а не гейт этого шага.
- **Evidence:** манифест; вывод теста; первые строки собранного `lib/client.js`; подтверждение отсутствия ошибок сканера в консоли DSH; цитаты п. 1–6 с `файл:строка`.
- **Риски:** (а) бандл не зарегистрируется молча — самый вероятный исход (§9.1); (б) **`clean: true` сотрёт бандл** при любой сборке (R-08) — митигация в шаге 3; (в) гейт, зависящий от живого профиля, ложно-зелёный/ложно-красный — митигация: локальный гейт выше. Превентивная проверка «`dsh.client` без `./client` → бросок» (`packages/client/modules/src/index.ts:847`) — обязательный шаг.
- **Не делать:** **не указывать подпуть** вместо bare-имени (половина не привяжется, `adding-a-settings-card.md:58`); не использовать ESM-формат для `lib/client.js`.
- **Зависимость от D-решений:** **D18** — принято: отдельный `@dsh-mywork/web`, `store` слота — источник view-состояния, префикс `data-mw-*`. **Согласовано с `decision-desk`.**

---

#### F-59 · `@dsh-mywork/web`: префикс `data-mw-*` и `store` слота

- **Карточка:** MW-048 · **Зависит:** F-58.
- **Усилие:** S · **Риск:** низкий · **Откат:** revert.
- **Цель:** якоря панели не сталкиваются с платформенными, а view-состояние живёт в `store` слота, а не в компоненте.
- **Файлы:** Modify `packages/web/src/**`; Create `tests/ui-attributes.test.mjs`.
- **Проверенные факты:** `FINAL-REPORT` §3.3(5): «Пространство `data-dsh-*` занято платформой — якоря панели MyWork заводить в своём префиксе»; §9.1 (MW-048): «**свой префикс для data-атрибутов панели** (`data-dsh-*` занят платформой)», «`store` слота для view-состояния».
- **Шаги:**
  1. Тест (падающий): ни один `data-*`-атрибут в `packages/web/src/**` не начинается с `data-dsh-`; все начинаются с `data-mw-` (D18).
     Команда: `node --test --test-isolation=none tests/ui-attributes.test.mjs` → FAIL.
  2. Реализация: заменить префикс.
  3. Тест (падающий): view-состояние (фильтр колонки, раскрытая карточка) читается из `store` слота, а не из локального `useState` — проверяется по тому, что состояние переживает размонтирование панели.
  4. Команда: `node --test --test-isolation=none tests/ui-attributes.test.mjs` → `pass 2 / fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/ui-attributes.test.mjs` → `# pass 2`, `# fail 0`; и `Select-String -Path packages\web\src\**\* -Pattern 'data-dsh-'` → **0** совпадений.
- **Evidence:** вывод теста; вывод grep; перечень атрибутов «до/после».
- **Риски:** столкновение с платформенными селекторами и «молча» сломанные стили. Митигация: grep по всему бандлу, не только по `src`.
- **Зависимость от D-решений:** D18.

---

#### F-60 · Гейт этапа 3

- **Карточка:** — (контрольная точка) · **Зависит:** F-47…F-59.
- **Усилие:** S · **Риск:** низкий.
- **Цель:** этап 3 закрыт; контракты и ограничители на месте; можно возвращаться к критическому пути (§10, этап 4).
- **Шаги — прогнать и записать:**
  1. `corepack pnpm -r run typecheck` → `EXIT=0`.
  2. `node --test --test-isolation=none tests/budget-meter.test.mjs tests/budget-defaults.test.mjs tests/step-breaker.test.mjs tests/budget.test.mjs` → `# fail 0` (F-51…F-53).
  3. `node --test --test-isolation=none tests/telemetry.test.mjs tests/worker-surface.test.mjs tests/auto-review-deny-only.test.mjs` → `# fail 0` (F-54…F-57).
  4. `node --test --test-isolation=none tests/publish-manifest.test.mjs tests/ui-package.test.mjs tests/ui-attributes.test.mjs` → `# fail 0` (F-49, F-58, F-59).
  5. `Select-String -Path packages\*\package.json -Pattern '"@deepseek-ai/dsh"'` → ** ровно 2 файла** — `packages/controller/package.json` и `packages/web/package.json` (F-48).
     **Исправлено при исполнении этапа 3 (2026-09-27, Lead, по указанию владельца).** Здесь стояло «**12** совпадений» — устаревшее требование снятой редакции F-48 («peer в каждом из 12 манифестов», отменено шагом 3 того же F-48 как «гейт без предмета проверки»). Фактический канон: гейт включён ровно у тех пакетов, чей runtime-контракт — платформа (контроллер читает `ctx.*`; браузерная половина `web` требует `react` и store платформы), а множество носителей зафиксировано **по именам** в `tests/peer-gate.test.mjs`. Свидетельство: `evidence/foundation-stage3-gate.md` §1 и §6.1.
  6. Проверка гейта на собранном манифесте: `evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.2')` → `undefined` (F-48/F-50; актуализация 2026-10-03 — прежде здесь стоял рантайм `0.1.7-rc.2`).
- **Гейт (готово когда):** все шесть команд дают ожидаемое.
- **Evidence:** вывод шести команд; матрица F-50; перечень новых пакетов/файлов этапа 3.
- **Что этап 3 НЕ закрывает:** установку UI-пакета в живой профиль (мутация — вне кампании) и публикацию в реестр (решение D04 + действие человека).

---

## 5. Опровержения базы (`00-RECON.md` §3) и уточнения

**Актуализация 2026-10-03 (дельта платформы `0.2.0-rc.2`).** Таблица ниже — протокол кампании v0.3 против базы `c7c4c725` = `0.1.7-rc.2`; вердикты прошлого прохода **не переписываются**. Номера версий и якоря платформы в ней исторические, кроме строки 20 (исправлена отдельно: ложное «`^0.1.7` ⇒ true»). Текущая ревизия — `639ed0153` = `dsh-v0.2.0-rc.2`; что именно изменилось — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.

Формат: «что утверждалось → что установлено → доказательство».

| # | Утверждение брифа/отчёта | Установлено | Доказательство |
|---|---|---|---|
| 1 | §3.4(10) «`pnpm run build\|typecheck\|check` и `node scripts/pack.mjs` → EXIT=1 (битый глобальный pnpm-линк)» | **Уточнено:** линк не «глобальный», а **store-копия pnpm 12.4.2**, на которую переключается pnpm 11.7.0 из `.bin` DSH-checkout, стоящий первым в `PATH`. Шим `bin\pnpm.CMD` (52 б) указывает на POSIX-скрипт вместо `.exe`. Рабочая альтернатива: `corepack pnpm` → `12.4.2`, exit 0 | F-01; `where.exe pnpm`; содержимое 52-байтного `pnpm.CMD`; `corepack pnpm --version` |
| 2 | §3.4(3)/P1 «`spawnSync('bd', {shell:false})` → ENOENT» | **Подтверждено косвенно, но не воспроизведено:** команда `bd` в этой кампании **не запускалась** (нет подтверждения установки). Механика дефекта видна из кода: `runner.ts:96,102-108`, проба `tests/beads-adapter.test.mjs:58,77` | §7 «Не проверено» |
| 3 | §8.2 P25 «DSH-импорт в `scheduler/src` не ловится, `planner/src` не сканируется вовсе» | **Уточнено и усилено:** в `tests/boundaries.test.mjs` сканируются **шесть** наборов (`contracts`, `core`, `storage`, `evidence`, `lease`, `execution`); `scheduler`, `planner`, `adapter-sdk`, `controller`, `memory-native`, `beads-adapter` не сканируются **вообще**. При этом `scheduler/src` и `planner/src` сегодня **не содержат** `@deepseek-ai` — дыра латентная | F-42; `boundaries.test.mjs:112,113,117,124,340,427`; фактический `Select-String` по всем `packages/**/src` |
| 4 | §8.2 P13 «`git worktree list` → 3 записи» | **Уточнено: 4 записи** — основная (`H:/Repo/DSH-MyWork`) + 3 вложенные (`.tmp/f-audit`, `.tmp/mw012-review`, `.tmp/v2-boundary-demo`) | F-10; вывод `git worktree list` |
| 5 | §3.3(3) «`jobs-local` — in-memory, process-local, то есть НЕ durable» | **Подтверждено:** `private store = new Map<JobId, TrackedJob>()` | `jobs-local/src/index.ts:160`; комментарий `:123-128` |
| 6 | §3.3(1) брифа — **актуализировано 2026-10-03:** `peerDependencies` объявляется **по имени пакета** `@deepseek-ai/dsh`, диапазон `>=0.1.7-rc.2 <0.3.0-0`; `dsh.engines.dsh` **не читает никто** (прежняя формулировка «peers по реально используемым сервисам» отменена `ADR-032` §Канон) | **Уточнено механикой гейта:** гейт проверяет **только** имена `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`; при отсутствии `peerDependencies` он **не выполняется вовсе**. Текущий `{"@deepseek-ai/cordis":"^4.0.2"}` гейтом **игнорируется** — публикация «проходит» ничего не проверяя | `plugin-compatibility.ts:68,75,76,77`; `packages/controller/package.json:30-32` |
| 7 | §9.1 «MW-054: … `autoRunTodo` выключен» | **Подтверждено и уточнено (кампания v0.3, на 0.4.3):** ключей `autoRun*` в коде **тогдашней** 0.4.3 не было вообще (0 совпадений в `lib/*.js` обоих пакетов) — они мертвы, а не «выключены». **Датированная правка 2026-10-03 (дельта §2.2 D8/D9; дефект R-47 в `01-MASTER-PLAN.md` §16):** на установленной **0.4.4** семь ключей `autoRun*` **вернулись** в живой профиль (`C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:27-33`), а `sessionDefaultPermission` снова вложен в `config.config` (`:25`) — правка этапа 0 откатилась. Поэтому **F-05 остаётся шагом на удаление мёртвых ключей**, но его проверка — не констатация, а **действие**: состояние приходится восстанавливать заново (R-47; та же переформулировка у `card-ledger` — `30-CARD-EDITS.md`, C-47/MW-054) | F-05; `Select-String` → 0 (**на 0.4.3**); `cordis.patch.yml:25,27-33` (**на 0.4.4, 2026-10-03**) |
| 8 | §3.4(1) «`sessionDefaultPermission` вложен в `config.config` → плагин читает верхний уровень → фактический `read-only`» | **Подтверждено полностью, с точной механикой:** оболочка агрегата срезает `plugin` и передаёт остальное; плагин читает `config?.sessionDefaultPermission ?? "read-only"` | `web-all/lib/shell-DWqLngib.js:1088-1092`; `dsh-client-ui-task-board/lib/index.js:5568` (и схема `:5397`) — **замер 0.4.3**; на установленной **0.4.4** (перемерено 2026-10-03) те же места: `web-all/lib/shell-CKmkldkq.js:1094`, `lib/index.js:6089` (и схема `:5918`) |
| 9 | §3.4(6) «`MYWORK_SCHEMA_VERSION = 1` не описывает базу: пять списков миграций склеивает вызывающий» | **Подтверждено:** `MYWORK_MIGRATIONS = [OUTBOX_INBOX]` (v1); пятый набор — `CLAIM_SAGA_MIGRATIONS` v6; склейка — только в JSDoc/комментариях | `storage/src/migrations.ts:91,94`; `evidence/src/schema.ts:26`; `lease/src/schema.ts:22`; `planner/src/schema.ts:36`; `execution/src/schema.ts:48` |
| 10 | §8.1 «710 тестов: 687 pass / 0 fail / 23 skip» и «smoke 13/13» | **Не воспроизводилось** (полный прогон — за Lead'ом, §5.4). Число `pass 70` из §10 (этап 1, п.1) — тоже не воспроизводилось | §7 |
| 11 | §8.2 P20: «`resolveModelInfo` не проба (**синтезирует окно 1 000 000**), `listModels` может быть пуст» | **Опровергнуто:** литералов `1000000` / `1_000_000` / `maxTokens` в `packages/**/src/*.ts` — **0 совпадений**. `contextWindow` только транзитен (`model-catalog.ts:121,126`), поле optional (`contracts/src/model-catalog.ts:57`). Реальные пробелы **другие**: `resolveModelInfo` (`:119-128`) не имеет ветки «не найдено», а пустой `listModels` не даёт отказа (`routing.ts:103-115,212-219`) | `evidence/foundation-14-model-catalog.md`; `model-catalog.ts:34,119-128,150`; `core/src/routing.ts:103-115,226-245` |
| 12 | (рабочая гипотеза **этого файла**, до проверки) «`journal_mode` не выставлен → режим `delete`, конкурентное чтение блокируется» | **Опровергнуто собственной проверкой:** `journal_mode = WAL` **уже стоит** (`sql.ts:130`) с fail-closed перечитыванием (`:131-138`); `foreign_keys = ON` (`:129`); `busy_timeout` — опция драйвера (`:94`, дефолт 5000 из `store.ts:28`). Режим `delete` — только дефолт «голого» `DatabaseSync` (проба в `%TEMP%`, exit 0). **Не выставляются:** `synchronous` и `auto_vacuum`; `VACUUM` в коде отсутствует | `evidence/foundation-12-sqlite.md`; `packages/storage/src/sql.ts:94,118,129,130,131-138,142-145` |
| 13 | §8.2 P10: «`private: true` ×12, devDeps на непубликуемые `@dsh-mywork/*`» — читалось как «`files` не настроен» | **Уточнено:** `files` есть у **всех 12** (`["lib"]` у 11, `["lib","cordis.patch.yml"]` у `controller`). Поля `dsh` и `peerDependencies` есть **только** у `controller` (1 из 12) | `evidence/foundation-18-manifests.md`; `contracts/package.json:17-19`; `controller/package.json:17-20,21-25,30-32` |
| 14 | §8.2 P9: «**9** падений на `done`-карточках»; §8.1: `20 succeeded / 11 failed` | **Расхождение:** ценз D19 даёт **19** `done`-карточек, **11** исполнений с `error`, из них **7** на `done`. Цифра 9 не воспроизвелась; в шагах F-09/F-27 используется ценз D19, отчёт не правится | `10-DECISIONS.md` D19; команда ценза `node .tmp/plan-v03-decision/count-done-failed.mjs` |
| 15 | D15 (открытый вопрос): «не проверено, действует ли `tools.restrict` на **динамически** регистрируемые инструменты» | **Закрыто:** действует — фильтр живёт в `view()` (`tools/src/index.ts:1178,1200`), а не в `register()` (`:1063`); динамическая регистрация эмитит `tools/change` (`:835`). **Ограничения:** нужен scoped-контекст (`:1100`), `deny` не может назвать незарегистрированный инструмент (`:1114-1117`), `run_code` не фильтруется (`:1111,1215-1217`), собственные регистрации scope исключены (`:1204-1208`) | `evidence/foundation-16-tools-restrict.md`; `packages/core/tools/src/index.ts` |
| 16 | §9.1 MW-048: «`dsh.client.immediately` для панели, bare-имя пакета в client-строке, ручной CJS-формат бандла» | **Подтверждено и уточнено:** bare-имя обязательно (`docs/cookbook/adding-a-settings-card.md:58`); `dsh.client` требует только `platform`, и объявление **требует экспорта `./client`** (`packages/client/modules/src/client/manifest.ts:161-181`; `packages/client/AGENTS.md:144`); `lib/client.js` — **classic script** (`scripts/publint-all.ts:183`), формат `window.__ModuleLoader__.load({ id, factory(require) })`. `immediately` — только для инфраструктурных строк stage-one-prefetch, **не** для панели | `evidence/foundation-15-client-manifest.md` |
| 17 | §8.2 P12 / MW-041: «`node scripts/pack.mjs` → EXIT=1 (битый глобальный pnpm-линк)» — читалось как дефект `pack.mjs` | **Опровергнуто:** guard `pack.mjs:30-32` **проходит** (`lib/index.js` есть, 88 905 б). Корень — `scripts/lib/process.mjs:52-58`: `npm_execpath` без расширения не проходит regex `:54` ⇒ ветка `{command:'pnpm', shell:true}` ⇒ 52-байтный битый store-шим. Правка `pack.mjs` без правки `process.mjs` оставит EXIT=1 | `evidence/lead-03-peer-gate.md` п. 13; `.tmp/pack-logs/pnpm-pack.err.log:1-2` |
| 18 | §8.2 P12: «`packController` не идемпотентен» | **Уточнено:** дефект **системный**, а не «посторонний мусор»: имя `.tgz` версионно-детерминировано (`dsh-mywork-controller-<version>.tgz`), а `pack.mjs:33,44-47` сравнивает множества **имён** ⇒ перезапись даёт `produced = []`. Лечение — удалять одноимённый файл до пака | `evidence/lead-03-peer-gate.md` п. 14 |
| 19 | D04: «нужны оба поля: `peerDependencies` — чтобы гейт работал, `dsh.engines` — чтобы издатели и Plugin Manager видели требование» | **Уточнено:** `engines` (в т.ч. `dsh.engines.dsh`) **не читает никто** — тип объявлен (`packages/util/package-manifest/src/types.ts:23-24,56-66`), но `rg engines` даёт только `types.ts` + реэкспорт; `dsh?.engines\|engines?.dsh` — **0 совпадений**; документация: «These checks use peer declarations, not `engines.dsh`» (`packages/boot/app-boot/README.md:52`). Поле понижено до документации; контракт держит **только** `peerDependencies` | `evidence/lead-03-peer-gate.md` п. 1, 50 |
| 20 | Диапазон `>=0.1.7-rc.2 <0.2.0` — «эквивалент `^0.1.7`» | **ОПРОВЕРГНУТО и ИСПРАВЛЕНО 2026-10-03** (в кампании v0.3 здесь стояло «Подтверждено, с ловушкой» по замеру `semver@7.7.4`): `^0.1.7` десугарит в `>=0.1.7 <0.2.0-0` (нижняя граница **без** `-0`) и **отвергает** текущий `0.1.7-rc.2` → **false**; `~0.1.7` — тот же десугар → **false**; руками написанный `>=0.1.7 <0.2.0` → **false**. Перемерено `semver@7.8.5` (`packages/boot/app-boot/node_modules/semver`, тот же, что импортирует гейт). Канон диапазона — `>=0.1.7-rc.2 <0.3.0-0` (решение владельца; F-48 «факт 6») | `evidence/foundation-48-peer-contract.md` §4; `evidence/foundation-50-compat-matrix.md` §2; `01-MASTER-PLAN.md` §16 R-38 |
| 21 | §3.4(1)/§10(0.1): «12 карточек MW-044…MW-055 не запускаются» | **Уточнено:** живой API доски отдаёт `sessionDefaultPermission: read-only` ⇒ гейт формально блокирует **33 из 55** карточек (все backlog без `permissionConfirmedAt`: MW-021…MW-041, MW-044…MW-055); у 22 подтверждение есть | `evidence/lead-15-legacy-board.md` п. 18, 32 |
| 22 | §8.2 P13: «`git worktree list` → 3 записи», подразумевалось «`.tmp` можно удалить» | **Опровергнуто как безопасное действие:** в `.tmp` **543 reparse-точки, 21 ведёт в живое дерево** (`.tmp/v2-boundary-demo/node_modules → <repo>\node_modules`, 12× `packages/*/lib → <repo>\packages\*\lib`, `mw014-review/live/{packages/{contracts,core,scheduler},tests/lib}`, `mw012-mine/execution/node_modules/@dsh-mywork/*`). `Remove-Item -Recurse -Force` по вычисленному `.tmp` может снести реальные `node_modules`/`packages/*/lib`/`tests/lib`. Рекурсивно безопасны только 105,6 МБ node_modules двух worktree + нулевой мусор | `evidence/lead-18-cleanup.md` п. 4, «Чего делать нельзя» |
| 23 | `decision-00-limitation-and-refutations.md:46`: «в профиле нет соответствующих пакетов» (о массовом отказе пресета 2026-09-16) | **Опровергнуто:** из профиля не хватает ровно **двух** пакетов, из базы бандла — **ни одного**; 24-рядный отказ **сегодня не воспроизводится** (падавшая ревизия была старой: ряд `workflow-worker-thread` вместо нынешнего `workflow-ptc`). Наивный `require.resolve` от каталога профиля даёт **2 ложных FAIL** из-за устаревшей фермы `.dsh/profiles/node_modules` (9 битых junction) | `evidence/lead-17-profile-composition.md` п. 15-19, «Опровержения» |
| 24 | F-18 (первая редакция): тест `MYWORK_DATABASE_MIGRATIONS.map(m => m.version)` → `[1,2,3,4,5,6]`; F-36/F-37 — «миграция версии 7»; F-40 — «новая миграция версии 7 (v7 свободна — проверено)» | **Опровергнуто как неисполнимое (дефект R-04):** `v7` заявлена **трижды** (F-37 `background_job`, F-40 триггеры retention, `21-…` E-04 `attempt_worktree`), плюс `22-…` B-12 заявляет `v2`, конфликтуя с `EVIDENCE_MIGRATIONS[0]`. `validateMigrations` (`packages/storage/src/migrations.ts:111-129`) бросает на дубле ⇒ **store не откроется**, и падает F-29/F-30, а не отдельный шаг. Каждый шаг по отдельности свой гейт проходил | `01-MASTER-PLAN.md` §15.3, §16 (R-04); `10-DECISIONS.md` D08 |
| 25 | F-06/F-07/F-09/F-61/F-62 (первая редакция): шаги передают `MW-0NN` в `task_board_*` | **Опровергнуто (дефект R-05):** `task_board_*` принимает **UUID**; `task_board_get MW-044` → `task-not-found`; `MW-0NN` живёт **только в `title`**. Во все пять шагов добавлен обязательный «Шаг 0: получить UUID через `task_board_list { query: "MW-0NN" }`» | `01-MASTER-PLAN.md` §15.2, §16 (R-05) |
| 26 | F-01/F-12/F-25 (первая редакция): `corepack pnpm run typecheck` / `corepack pnpm run check` как гейт | **Опровергнуто (дефект R-06):** `corepack pnpm run <script>` → **EXIT=1 за ~1 с** (вложенный bare `pnpm` 11.7.0 из `.bin` DSH-чек-аута). Работает **только** `corepack pnpm -r run <script>` (проверено: EXIT=0, 12 пакетов). Плюс `21-STEPS-execution.md` §1.5 **запрещает** предписывать `pnpm run build\|check` как гейт | `01-MASTER-PLAN.md` §15.1, §16 (R-06) |
| 27 | F-41/F-42 (первая редакция): «заменить `''@deepseek-ai/cordis''` на `''@deepseek-ai/''`» | **Опровергнуто как недостижимое (дефект R-08):** `packages/controller/src/index.ts:12` **легитимно** импортирует `@deepseek-ai/cordis` (`Service`, `Context`), а `tests/boundaries.test.mjs:186-199` ожидает ровно `[''@deepseek-ai/cordis'']` для собранного бандла ⇒ без **allowlist** гейт красный всегда. Добавлены allowlist и явный тест «`cordis` проходит / `dsh-sandbox-policy` падает» | `01-MASTER-PLAN.md` §15.4, §16 (R-08) |
| 28 | F-58 (первая редакция): «собрать `lib/client.js`» + гейт «панель видна в GUI после перезагрузки» | **Опровергнуто (дефект R-08):** **все 12 `tsdown.config.ts` имеют `clean: true`** ⇒ рукописный `lib/client.js` **стирается любой сборкой пакета**. Плюс гейт зависел от живого профиля и ручной перезагрузки. Добавлены: исключение из очистки либо пересборка после сборки; **локальный** гейт (`Test-Path packages\web\lib\client.js` после `corepack pnpm -r run build`) | `01-MASTER-PLAN.md` §15.5, §16 (R-08) |
| 29 | F-57 (первая редакция): «`auto-review` не смонтирован / можно выключить» | **Опровергнуто (дефект R-22):** `auto-review` **смонтирован и активен** (`enabled: true`, `fiberPhase: active`) ⇒ «отсутствие плагина» не является защитой, а приёмка «в профиле нет строки auto-review» **невыполнима**. Шаг переписан: правило deny живёт **в MyWork** и проверяется при **активном** аппрувере | `01-MASTER-PLAN.md` §16 (R-22, R-03) |
| 30 | F-54/F-55 (первая редакция): названы «OTel» | **Опровергнуто (дефект R-19):** D16 прямо запрещает OTel-экспортёр; наружный канал — `ctx.productTelemetry.emit`. Шаги переименованы, формулировка «OTel-экспорт» помечена как **отменённая** | `01-MASTER-PLAN.md` §16 (R-19); `10-DECISIONS.md` D16 |
| 31 | F-25 (первая редакция): «CI зелёный на чистом клоне» как единый гейт этапа 1 | **Опровергнуто как неисполнимое (дефект R-21):** `scripts/verify-profile.mjs` требует CLI `dsh` и **хэширует манифесты реального профиля** (`:5-10`); шага установки DSH и создания профиля не было; `runs-on` не задан; `--frozen-lockfile` не связан с грязным `pnpm-lock.yaml` (F-11). Гейт **разделён** на L (локальный, без `dsh`) и P (профильный, требует `dsh`); добавлены три джоба, `runs-on: windows-latest`, установка CLI из реестра и явная оговорка, что хэш-проверка профиля **в CI вакуумна** | `01-MASTER-PLAN.md` §16 (R-21) |
| 32 | §15.3 (первая редакция): правило «версия выделяется единым аллокатором» **есть**, а шага, создающего аллокатор, — **нет** | **Опровергнуто как неисполнимое (дефект R-36):** слово «аллокатор» встречалось только внутри правила и в таблицах соответствия; 21-… (E-04, E-19, E-28, E-34, E-37) и 22-… (B-12) стояли «блокировано до появления аллокатора». Добавлен **F-63** — модуль-аллокатор в composition-слое (packages/controller), таблица заявок в bootstrap-DDL рядом с schema_migrations (цикличность разорвана: bootstrap выполняется до первой миграции), 5 тестов идемпотентности/различимости/перезапуска/непереиспользования/валидации | `01-MASTER-PLAN.md` §15.3; 91-VERIFICATION-B.md (R-36) |

---

## 6. Сводка доказательств (`файл:строка`, ссылки для верификатора)

**Профиль и права**
- `C:\Users\Dmitry\.dsh\profiles\web\cordis.patch.yml:20-35` — строка `web-ui-task-board`; `:22` `config:`; `:24` `plugin:`; `:25` `config: { sessionDefaultPermission: workspace-write }`; `:26` `announceToAgent: true`; `:27-33` `autoRun*` (7 ключей).
- `...\@linxin666\dsh-web-all\lib\shell-DWqLngib.js:1088-1092` — `familyConfigOf(row)`; `:1106-1110` — `isOverrideShape(config)`. **Якоря — замер кампании v0.3 (0.4.3); на установленной 0.4.4 сборка переименована: `shell-CKmkldkq.js:1094` (`familyConfigOf`), `:1111` (`isOverrideShape`)** — перемерено 2026-10-03.
- `...\@linxin666\dsh-client-ui-task-board\lib\index.js:5557` — `applyImpl(ctx, config)`; `:5559-5566` — чтение флагов с верхнего уровня; `:5568` — `config?.sessionDefaultPermission ?? "read-only"`; `:5397` — схема с `.default(DEFAULT_SESSION_PERMISSION)`; `:2444-2485` — `requiresPermissionConfirmation`; `:4281` — `snapshot.sessionDefaultPermission ?? "read-only"`. **Это замер 0.4.3; на 0.4.4 те же места: `:6078` (`applyImpl`), `:6082-6092` (чтение флагов), `:6089` (`config?.sessionDefaultPermission ?? "read-only"`), `:5918` (схема), `:1018` (`requiresPermissionConfirmation`), `:4775` (`snapshot.sessionDefaultPermission ?? "read-only"`)** — перемерено 2026-10-03.
- `...\dsh-client-ui-task-board\lib\client.js:1413,1420,4112` — зеркало в браузерной половине (замер 0.4.3; на 0.4.4 проверены `:1563`, `:1859`, `:4701` — 2026-10-03).
- Версии: `dsh-client-ui-task-board` **0.4.4**, `dsh-web-all` **0.4.4** (актуализировано 2026-10-03; в кампании v0.3 — 0.4.3, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D8).

**`bd`-seam**
- `packages/beads-adapter/src/runner.ts:57-60` (единственный seam ОС), `:71-82` (`ProcessRunnerOptions`, «Defaults to `bd` from `PATH`»), `:85` (`DEFAULT_COMMAND_TIMEOUT_MS = 30_000`), `:95-108` (`createProcessRunner`; `shell: false`), `:130-135` (`child.on('error')`), `:171-199` (`ScriptedRunner` — переиспользовать в F-22).
- `tests/beads-adapter.test.mjs:19-20` (политика «skipped ≠ pass»), `:56-62` (проба), `:64-73` (текст про EPERM), `:75-79` (`bd()`).
- `packages/beads-adapter/src/adapter.ts:77-98` (`BEADS_CLI_CAPABILITIES`, `heartbeat: true` на `:96`), `:108-113` (`BEADS_ADAPTER_MANIFEST`), `:180` (`run` c `env`), `:228-232` (`requireCapability`), `:476-500` (claim передаёт `BEADS_ACTOR` на `:500`), `:580-588` (`heartbeat` **без** env).
- `scripts/lib/process.mjs:1-8` (принцип file-backed stdio), `:23-45` (`runCaptured`), `:52-58` (`pnpmLaunch`), `:66-68` (`quoteCommandArg`), `:79-86` (`runPnpm`).

**Storage и миграции**
- `packages/storage/src/migrations.ts:49-82` (DDL `outbox`, `inbox_dedup`, индекс), `:91` (`MYWORK_MIGRATIONS = [OUTBOX_INBOX]`), `:94` (`MYWORK_SCHEMA_VERSION`), `:97-103` (`JOURNAL_DDL`), `:111-129` (`validateMigrations`), `:142-184` (`runMigrations`; `:147` — создание журнала; `:150-156` — отказ при новой версии; `:160-173` — транзакция + запись; `:190-198` — `listAppliedMigrations`).
- `packages/storage/src/store.ts:27-28` (`DEFAULT_BUSY_TIMEOUT_MS`), `:34-39` (`MyWorkTransaction` с `outbox`/`inbox`), `:42-62` (`MyWorkStore`), `:64-74` (`OpenStoreOptions`; `:68-69` — дефолт миграций), `:83-101` (`openStore`), `:111-120` (прокси-безопасный класс).
- `packages/storage/src/layout.ts:24-27` (`dsh-mywork`/`state`), `:33-36` (`MYWORK_STATE_DATABASES`), `:76-84` (`resolveMyWorkLayout`), `:91-93` (`stateDatabasePath`).
- `packages/storage/src/index.ts:6` (пример адресации store), `:45-46,65` (реэкспорт).
- Пять списков: `evidence/src/schema.ts:26,138,147`; `lease/src/schema.ts:22,66,68`; `planner/src/schema.ts:36,148,150`; `execution/src/schema.ts:48,153,155`.
- Отказы при неполном наборе: `lease/src/lease.ts:315-321`; `evidence/src/store.ts:85-91`; `planner/src/store.ts:126`; `execution/src/service.ts:251`.
- Жизненный цикл lease: `lease/src/lifecycle.ts:105` (`openStores`), `:236` (вызов); `lease/src/index.ts:13,18`.

**Composition root**
- `packages/controller/src/index.ts:12` (импорт `Service`/`Context` из cordis), `:26-33` (наши service-имена), `:47-48` (монтаж model catalog и DSH runtime), `:51-59` (реэкспорт), `:61-89` (реэкспорт session-типов), `:92-101` (`name`, версия, контексты), `:104-107` (`Config`), `:115-128` (`apply`), `:136-139` (`resolveClock`).
- `packages/controller/package.json:4` (`private`), `:17-25` (`files`, `dsh.bundle`), `:30-32` (`peerDependencies`), `:33-38` (`devDependencies`).
- `packages/controller/cordis.patch.yml` — единственная строка-вставка `mywork-controller`.

**Boundary-тест**
- `tests/boundaries.test.mjs:17-25` (`FORBIDDEN`), `:97-104` (`specifiersOf`), `:111-124` (сканируемые наборы: только `contracts`, `core`, `storage`, `evidence`), `:127-133` (`FORBIDDEN_FOR_STORAGE`), `:136-137,213-214,292-295,363-366` (guard'ы «не пусто»), `:165-175,217-230,342-418,429-478` (образцы проверок), `:186-199` (ожидания для собранных бандлов), `:340,427` (доп. наборы `lease`, `execution`), `:480-494` (инлайн workspace-пакетов), `:515-527` (`BOARD_MODULES`, `FORBIDDEN_IN_BOARD`).

**Платформа DSH (0.2.0-rc.2)**
*(Раздел §6 — сводка доказательств кампании v0.3; номера версий в нём — на базу `c7c4c725`/`0.1.7-rc.2`, кроме строк, помеченных «актуализировано 2026-10-03». Текущая ревизия — `639ed0153` = `dsh-v0.2.0-rc.2`; см. `02-PLATFORM-DELTA-0.2.0-rc.2.md`.)*
- Peer-гейт: `packages/boot/app-boot/src/plugin-compatibility.ts:44-49` (`getDshRuntimeVersion`), `:61-88` (`evaluatePluginCompatibility`; `:68` — нет peer → нет гейта; `:75` — только `@deepseek-ai/dsh*`; `:76` — `workspace:`; `:77` — `includePrerelease`), `:96-103` (`pluginCompatibilityWarning`, `dsh plugin allow-version`).
- `engines` не читается: `Select-String` по `packages/**/*.ts` (без `node_modules`/`tests`) → 0 совпадений.
- Token meter: `packages/llm/token-meter/src/index.ts:94-96` (`ctx.tokenMeter`), `:101` (класс), `:111` (`super(ctx,'tokenMeter')`), `:146` (`measure`); `types.ts:13` (`TokenMeterConfig = Record<string, never>`), `:16-19` (`baseline`), `:22-35` (`TokenMeasurement`), `:38-53` (`TokenSurfaceNode`).
- Sandbox policy: `packages/sandbox/sandbox-policy/src/index.ts:42-56` (`renderPolicyContext`), `:58-62` (`ctx.sandboxPolicy`), `:71-79` (`Config`; дефолт `read-only`), `:82-87` (`SandboxPolicyRequest`), `:90-94` (union режимов), `:110` (класс), `:112-117` (`static Config`), `:119` (`inject`), `:164` (`resolve`).
- FS observation policy: `packages/fs/fs-observation-policy/src/index.ts:98` (`name`), `:106` (`apply(ctx)`); `types.ts:23` (`FsObservationActor`).
- Jobs: `packages/jobs/jobs-local/src/index.ts:95-116` (`TrackedJob`), `:123-128` (комментарий «in-memory»), `:160` (`Map`); родственные — `packages/jobs/jobs`, `packages/jobs/tool-jobs`.
- Прочее: `packages/experimental/auto-review/` (`cordis.patch.yml` 88 б).

**MyWork: бюджет и корреляция**
- `packages/core/src/budget.ts:10-12` (политика «gate refuses, does not repair»), `:38-49` (`BudgetCharge`), `:52-60` (`BudgetSettlement`), `:63-76` (`knownAmount`/`unknownAmount`), `:86-88` (`amountValue`), `:96-100` (`addAmounts`), `:107-113` (правило «пропуск = unknown»), `:122-140` (`chargeConsumption`), `:151-169` (`readCallTokens`), `:181-188` (`modelCallCost`), `:195-200` (`modelRateOf`), `:210-212` (непроверяемые лимиты), `:217-239` (`decideBudgetAdmission`), `:242-254` (`refuse`), `:260-279` (`chargeOf`), `:288-306` (`usedOf`), `:309-349` (`requireAdmissionInput`), `:327-336` (закрытый набор имён).
- `packages/core/src/scheduler.ts:70` (импорт), `:82` (`TICK_META`), `:568` (**единственная** точка enforcement).
- `packages/contracts/src/budget.ts:36` (`BudgetConsumption`), `:50` (`EMPTY_BUDGET_CONSUMPTION`), `:78` (`BUDGET_LIMIT_NAMES`), `:180` (`consumption`).
- `packages/contracts/src/scheduler.ts:29` (импорты бюджета), `:212` (ссылка на `decideBudgetAdmission`), `:304` (`consumption`).
- `packages/core/src/index.ts:333-334` — публикация `chargeConsumption`/`decideBudgetAdmission`.
- OTel: **0** совпадений `opentelemetry|otel|traceId|spanId|tracer|productTelemetry` во всех `packages/**/src/*.ts` (проверено).
- `correlationId` (81 совпадение в `packages/**/src`): `storage/src/outbox.ts:54,117,129,153,245`; `evidence/src/audit.ts:78,105,145`; `evidence/src/artifacts.ts:79,110,143,171`; `evidence/src/metadata.ts:251,261,285,299,324,337`; `execution/src/service.ts` (22 вхождения, в т.ч. `:261,281,292,301,447,478,590,655,678,759`); `execution/src/store.ts:90,160`; `planner/src/service.ts` (16 вхождений); `planner/src/store.ts:198,363,466,516,542,579`; `core/src/guards.ts:28,46,51`; `core/src/plan.ts:420`; `core/src/scheduler.ts:82`; `core/src/skill.ts:376,842`; `contracts/src/artifact.ts:87,109,148,168`; `contracts/src/audit.ts:93,114`; `contracts/src/claim.ts:160`; `contracts/src/events.ts:111,131`; `contracts/src/operation.ts:21`; `contracts/src/plan.ts:293,472`; `contracts/src/workflow.ts:96`.
- `packages/core/src/index.ts` — публичный фасад; `storage/src/index.ts:45-46` — реэкспорт миграций.

**Скрипты, CI, гигиена**
- `package.json`: `:8` `packageManager`; `:9-11` `engines`; `:12-20` скрипты (`:16` — `--test-isolation=none`); `:21-26` devDependencies (`typescript ~5.7.2`).
- `pnpm-workspace.yaml` — только `packages/*`.
- `scripts/pack.mjs:3-8` (назначение), `:28-54` (`packController`; `:30-32` — проверка build; `:33` `before`; `:34-39` `runPnpm`; `:44-47` — дефект идемпотентности; `:48-52` перенос), `:56-62` (`invokedDirectly`).
- `scripts/smoke.mjs:1-11` (назначение), `:17-23` (проверяемые entry).
- `scripts/verify-profile.mjs:1-10` (изоляция `DSH_HOME`, хэширование профиля), `:22` (`packController`), `:26-27` (`PROFILE`, `BUNDLE`), `:30-32` (`MOUNT_LINE`/`STOP_LINE`).
- `.github` — **нет**; `git tag` — **0**; HEAD `0c657ae1434202865bd330f0eeaf2b60eb78f6d4`; рабочее дерево — `M pnpm-lock.yaml`.
- Размеры: `.tmp` 3947 файлов / 177,3 МБ; `DSH-MyWork.rar` 41,40 МиБ; `node_modules` 109,7 МБ; `packages` 533 файла / 17,7 МБ; `tests` 32 файла / 0,8 МБ; `.work` 120 файлов / 3,6 МБ.
- `.tmp/pack-logs/pnpm-pack.err.log` — дословная ошибка сломанного шима; `.tmp/pack-logs/pnpm-pack.out.log` — 205 б; `.tmp/pack/dsh-mywork-controller-0.1.0.tgz` — 9030 б (артефакт прошлого прогона).
- `.work/tasks/`: 55 карточек `MW-001.md`…`MW-055.md`; три леджера — `INDEX.md` (10533 б), `tasks.json` (97884 б) + легаси `board-actions.json` (214448 б), `board-export.json` (193386 б), `board-before.json` (438 б).
- `MW-027.md:1`, `MW-035.md:1` — «НЕ ЗАПУСКАТЬ … superseded»; `:8` — «Этап: … (superseded)».
- `tests/` — 32 файла, включая `boundaries.test.mjs` (26094 б), `storage-crash.test.mjs` (4445 б), `budget.test.mjs` (20696 б), `review.test.mjs` (7784 б), `lib/crash-child.mjs` (1726 б), `lib/mw019-restart-child.mjs` (3306 б).

---


### 6.1. Независимая проверка (8 субагентов через `workflow`, 2026-09-27)

Evidence-файлы: `evidence/foundation-11-migrations.md`, `-12-sqlite.md`, `-13-triggers.md`, `-14-model-catalog.md`, `-15-client-manifest.md`, `-16-tools-restrict.md`, `-17-telemetry.md`, `-18-manifests.md`.

**MyWork, миграции** (`evidence/foundation-11-migrations.md`): `storage/src/migrations.ts:50` (`version: 1`), `:91`, `:94`; `evidence/src/schema.ts:138` (список), `:140` (**version 2**), `:147` (version 3, значение из `:26`), `:153` (конец списка); `lease/src/schema.ts:66,68` (+`:22` = 4); `planner/src/schema.ts:148,150` (+`:36` = 5); `execution/src/schema.ts:153,155` (+`:48` = 6). Итог: **1+2+1+1+1 = 6 миграций, версии 1…6 без пропусков**. `version: 7` — **0 совпадений** в `packages/*/src` и в `tests` → версия 7 свободна (нужна F-36 и F-40).

**MyWork, SQLite** (`evidence/foundation-12-sqlite.md`): `storage/src/sql.ts:94` (`{ timeout }`), `:118` (`user_version`), `:129` (`foreign_keys = ON`), `:130` (`journal_mode = WAL`), `:131-138` (fail-closed перечитывание), `:142-145` (запись версии); `store.ts:27-28` (`DEFAULT_BUSY_TIMEOUT_MS = 5_000`). `synchronous` / `auto_vacuum` — **0 совпадений**; `VACUUM` — только в `.work/**`.

**MyWork, триггеры** (`evidence/foundation-13-triggers.md`): `evidence/src/schema.ts:47-61` (`artifacts`, `:60` `bytes BLOB NOT NULL`), `:75-88` (`audit_events`), триггеры `:65,67` / `:70,72` / `:92,94` / `:97,99` / `:115,118` / `:121,124` (шесть: `no_update` ×2, `no_delete` ×2, `no_replace` ×2).

**MyWork, model catalog** (`evidence/foundation-14-model-catalog.md`): `controller/src/model-catalog.ts:34` (`DSH_LLM_SERVICE = 'llm'`), `:63-80` (структурный `DshLlmRegistry`), `:94-96`, `:103-111`, `:119-128` (`resolveModelInfo`), `:150` (`ctx.get`); `contracts/src/model-catalog.ts:57` (`contextWindow?`), `:69` (`CATALOG_UNKNOWN_MODEL`), `:126`; `core/src/routing.ts:103-115`, `:212-219`, `:224-245`, `:265-272`, `:273-280` (причины `route-absent`, `provider-outage`, `context-window-too-small`, `context-window-undisclosed`). Литералы `1000000`/`1_000_000`/`maxTokens` — **0**.

**MyWork, манифесты и security** (`evidence/foundation-18-manifests.md`; ниже — **исторический срез кампании v0.3 на 12 пакетов**, перемер 2026-10-03: манифестов **15**, `private: true` у **14**, `dsh`/`peerDependencies` у **двух** — `controller` и `web`): 12 строк — все `private: true`, `files` есть у всех, `dsh`/`peerDependencies` только у `controller`; `contracts/src/security.ts:193` (`DOMAIN_IMPLIED_GATES`), `:201-206` (`REVIEWER_DEFAULT_PERMISSIONS = ['workspace.read','git.read','tests','review.approve']`), `:212-216` (`IMPLEMENTATION_WRITE_PERMISSIONS = ['workspace.write','git.write','shell']`), `:219-227` (`AUTHORIZATION_CONTEXT_FIELDS`, последнее — `workerAgentId`). `packages/ui` **не существует**; `packages/web` с тех пор создан (F-58/B-01a) — историческая часть утверждения устарела; `allowlist` в MyWork — 0 совпадений.

**DSH, product telemetry** (`evidence/foundation-17-telemetry.md`; версия пакета актуализирована 2026-10-03): `packages/host/product-telemetry-otel/package.json:2,4` (`@deepseek-ai/dsh-host-product-telemetry-otel`, `0.2.0-rc.2`); `src/index.ts:9` (`interface Context { productTelemetry: ProductTelemetry }`), `:13` (`ProductTelemetryRecord = OTelEventRecord`), `:61` (класс), `:84` (`super(ctx,'productTelemetry')`), `:118` (`emit(record): void`); **поля записи — в общем слое** `packages/telemetry/otel/src/event-log.ts`: `:16` (`interface OTelEventRecord`), `:18,20,22` (`eventName`, `body`, `timestamp` — обязательные), `:24,26` (`severityNumber?`, `attributes?`), `:73` (дефолт INFO), `:74` (`observedTimestamp`/`severityText`); `README.md:57,104` (строки вызывающего **не** редактируются; на базе было `:56,103`). Прочие telemetry-пакеты: `packages/session/session-telemetry`, `packages/session/session-telemetry-otel`.

**DSH, tools.restrict** (`evidence/foundation-16-tools-restrict.md`): `packages/core/tools/src/index.ts:208` (`tools/change`), `:700` (`ToolRestriction { allow?, deny? }`), `:758` (`admits`), `:807`, `:835` (эмит), `:849` (`super(ctx,'tools')`), `:974` (`presentAs`), `:1063` (`register` — без фильтра), `:1083-1087`, `:1097` (`restrict`), `:1100` (scoped-контекст), `:1105`, `:1111`, `:1114-1117` (неизвестное имя — ошибка), `:1178` (`view`), `:1200`, `:1204-1208`, `:1215-1217`, `:1230-1231`.

**DSH, клиентская половина** (`evidence/foundation-15-client-manifest.md`): `docs/cookbook/adding-a-settings-card.md:58` (bare-имя), `:66` (`"./client"` экспорт); `packages/client/modules/src/client/manifest.ts:161-181` (`parseDshClient`: только `platform` обязателен; принимаются `platform`/`inject`/`external`/`immediately`); `packages/client/AGENTS.md:144`; `docs/subsystems/client-modules.md:80`; `packages/client/modules/README.md:34`; `scripts/publint-all.ts:183` (classic script); `docs/user/develop/basic/publish.md:42` (`dsh.bundle`); `packages/bundle/web-app/cordis.patch.yml:69-70` (пример строки с `name:`); `packages/client/modules/src/index.ts:847` (бросок при `dsh.client` без `./client`).
## 7. Не проверено / открытые проверки

**7.1. Субагенты: частично выполнено (ограничение рантайма).**
**Частично выполнено.** Прямой вызов `subagent` с уровня участника команды недоступен (ошибка `subagent depth 2 exceeds maxDepth 1`), поэтому первичный сбор доказательств сделан **лично** (grep/read/pwsh, read-only). Дополнительно **8 независимых агентов** запущены через инструмент `workflow` (см. §6.1 и `evidence/foundation-11…18-*.md`); они **опровергли две** несущие гипотезы этого файла (WAL, окно 1 000 000) — обе исправлены. Все `файл:строка` в §6, не помеченные `~`, подтверждены либо личным чтением, либо независимой проверкой.

**7.2. Проверки, которые обязан сделать исполнитель шага (`Шаг 0`).**

| Шаг | Что подтвердить |
|---|---|
| F-01 | Какой именно процесс печатает ошибку (pnpm 11.7.0 self-switch vs `@pnpm/exe`); работает ли `corepack pnpm -r run typecheck` (в кампании проверен только `--version`) |
| F-13 | Установлен ли `bd` и где лежит его JS-entry (`npm ls -g --depth=0`, `Get-ChildItem "$env:APPDATA\npm" -Filter 'bd*'`) |
| F-18 | **Напряжение D08 ↔ boundary-тест:** D08 помещает экспорт `MYWORK_DATABASE_MIGRATIONS` в `packages/storage`, а `tests/boundaries.test.mjs:201-230` запрещает storage импортировать доменные слои. Место *сборки* списка — за `verifier-a` |
| F-19 | Точное число вызовов `openStore(` в `tests/**` (отчёт: 15; независимая проверка дала иное — сверить) |
| F-21 | Точные строки чтения `depends_on_id` в `tests/beads-adapter.test.mjs` |
| F-22 | Сигнатура `run(...)` с `env` (`adapter.ts:180`) и наличие `claimant` в контексте heartbeat |
| F-24 | Поддерживает ли pnpm 12.4.2 флаг `pack --pack-destination` |
| F-25 | Не трогает ли `pnpm install --frozen-lockfile --lockfile-only` каталог `node_modules` |
| F-30 | Точные поля `ControllerStores` в `packages/lease/src/lifecycle.ts` — **открыто** |
| F-43 | Соответствие имени `model-not-routable` (D20) существующим причинам `route-absent` / `provider-outage` / `context-window-too-small` / `context-window-undisclosed` — **открыто**, решается на `Шаг 0` шага |
| F-48 | Реальное влияние новых `peerDependencies` на собранный `packages/controller/lib/index.js` (ассерт `tests/boundaries.test.mjs:186-199`) |
| F-56 | Фактический список **имён** инструментов worker-сессии (`ctx.tools` → `view().visible`) — **открыто**; распространение `restrict` на субагентов воркера — **открыто** |
| F-57 | Точка, где MyWork получает решение review (`tests/review.test.mjs` + соответствующий `src`) — **открыто** |
| F-58 | Поле `icon`: требование не найдено в документации, но `icon.svg` есть у обоих эталонных пакетов — уточнить у `verifier-a` |
| ~~F-35~~ | ~~`journal_mode`~~ — **закрыто проверкой:** WAL уже стоит (`sql.ts:130`); реальные пробелы — `synchronous` и `auto_vacuum` |
| ~~F-38~~ | ~~DDL `audit_events`~~ — **закрыто:** `evidence/src/schema.ts:75-88` |
| ~~F-40~~ | ~~Триггеры~~ — **закрыто:** шесть триггеров, `schema.ts:65,67,70,72,92,94,97,99,115,118,121,124` |
| ~~F-43~~ | ~~Окно `1 000 000`~~ — **закрыто опровержением:** таких литералов в коде **нет** (0 совпадений) |
| ~~F-49~~ | ~~`files` у 11 манифестов~~ — **закрыто:** `files` есть у всех 15 (перемер 2026-10-03; историческая редакция знала 12) |
| ~~F-54~~ | ~~OTel-слой~~ — **закрыто:** `productTelemetry.emit(record)` — `product-telemetry-otel/src/index.ts:9,84,118` (перемерено 2026-10-03; было `:15,102,162`) |
| ~~F-58~~ | ~~Требования клиентского манифеста~~ — **закрыто:** bare-имя + `dsh.client` + `./client` (classic script) |
| F-61 | Живой ростер пресетов (`agentPresets.list()/resolve()`, поле `broken`) не прочитан: у Inspect нет read-only метода для бизнес-сервиса. Бесплатная проверка — Settings → Agent presets — **открыто** |
| F-61 | Поведение `pnpm` при `auto-install-peers` для нового peer `@deepseek-ai/dsh` в этом монорепо не измерялось — **открыто** |
| F-62 | Фактическое значение `sessionDefaultPermission` **после** исполнения F-04 — **открыто** (на момент снятия доказательств было `read-only`) |
| F-48 | Порядок/поведение `pnpm` при новом peer и фактическое попадание бандла в `skippedBundles` при DSH `0.2.x` — **открыто**, закрывается тестом шага 5 |
| ~~F-23~~ | ~~корень падения `pack.mjs`~~ — **закрыто:** `scripts/lib/process.mjs:52-58`, лог `.tmp/pack-logs/pnpm-pack.err.log:1-2` |
| ~~F-24~~ | ~~идемпотентность~~ — **закрыто:** сравнение имён при детерминированном имени `.tgz` |
| ~~F-10~~ | ~~безопасность чистки~~ — **закрыто:** 543 reparse-точки, 21 в живое дерево |
| ~~F-18/F-36/F-37/F-40~~ | ~~версия миграции~~ — **закрыто (R-04):** версия выдаётся аллокатором, литерал запрещён; тест F-18 не содержит `[1,2,3,4,5,6]` |
| ~~F-06/F-07/F-09/F-61/F-62~~ | ~~адресация доски~~ — **закрыто (R-05):** добавлен обязательный «Шаг 0: получить UUID» |
| ~~F-01/F-12/F-25~~ | ~~runner~~ — **закрыто (R-06):** только `corepack pnpm -r run …` |
| ~~F-41/F-42~~ | ~~boundary~~ — **закрыто (R-08):** allowlist + явный тест |
| ~~F-58~~ | ~~клиентский бандл~~ — **закрыто (R-08):** `clean: true` учтён, гейт локальный |
| ~~F-54/F-55~~ | ~~«OTel»~~ — **закрыто (R-19):** переименованы, OTel не строим |
| ~~F-25~~ | ~~неисполнимый гейт этапа 1~~ — **закрыто (R-21):** гейт разделён на L и P |
| ~~F-57~~ | ~~базовая линия `auto-review`~~ — **закрыто (R-22):** активен, правило deny в MyWork |
| ~~F-63~~ | ~~аллокатор версий не создаётся ни одним шагом~~ — **закрыто (R-36):** добавлен F-63 с TDD-циклом и гейтом; блокировка `E-04`/`E-19`/`E-28`/`E-34`/`E-37`/`B-12` снимается |
| F-63 | Фактический синтаксис `ON CONFLICT(key) DO NOTHING` в `node:sqlite` (SQLite ≥ 3.24) — **открыто**, проверить на первом прогоне теста |
| F-25 | Фактический прогон CI (job `profile`) требует установки `@deepseek-ai/dsh@0.2.0-rc.2` из реестра (актуализировано 2026-10-03; точный пин — `.github/workflows/ci.yml:131`, в дереве уже `0.2.0-rc.2`) — **открыто**, пока нет раннера |
| F-25 | Поведение `--frozen-lockfile` до закрытия F-11 — **открыто** (сознательно не добавляется в CI) |
| F-58 | Точный синтаксис исключения из `tsdown` `clean: true` (`clean: ['!lib/client.js']` или эквивалент) — **открыто**, проверить на `tsdown 0.22.2` |

**7.3. Числа, взятые из `FINAL-REPORT.md` и не воспроизведённые лично.**
- `710 тестов: 687 pass / 0 fail / 23 skip`, 87,6 с; `tsdown` 204,7 с; smoke **13/13**; `verify:profile: PASS` 10,5 с (§8.1).
- `pass 70 / fail 0 / skipped 0` для `tests/beads-adapter.test.mjs` (§10, этап 1, п.1).
- `4 из 12` пакетов достижимы; `11 619 / 36 674` строк `src` (31,7 %); `111 файлов` (§8.1, P16).
- `executions[].result` → `20 succeeded / 11 failed`; **9** падений на `done` (§8.1, §8.2 P9). **Ценз D19 даёт другие числа: 19 `done`-карточек, 11 исполнений с `error`, из них 7 на `done`.** Расхождение — предмет сверки, не «подгонки».
- `correlationId` **90** / `correlation_id` **24** (§8.2 P7). Моя проверка дала **81** вхождение `correlationId` в `packages/**/src/*.ts`; расхождение объясняется другим набором файлов (отчёт, вероятно, включал `tests/**` и/или `scripts/**`) — **требует уточнения у `verifier-a`**.
- `15` вызовов `openStore(` в тестах (§8.2 P5) — независимая проверка дала **иное число** (`evidence/foundation-11-migrations.md`); сверить.
- `ENOENT (errno -4058)` для `spawnSync('bd', {shell:false})` (§8.2 P1) — не воспроизводилось.
- `bd 1.3.0` “2 operations committed” (§8.2 P3) — не воспроизводилось.
- «125 383 строки» (§8.2 P16, исходная метрика) — не воспроизводилось; корректное значение по отчёту — **111 файлов / 36 674 строки** `src`.
- **Уточнения по свежим доказательствам кампании:** `pack.mjs` — корень в `process.mjs:52-58` (лог `pnpm-pack.err.log:1-2`), а не в `pack.mjs`; пресет `standard` **сегодня монтируется** (0 unresolved от базы бандла), массовый отказ 2026-09-16 невоспроизводим; в `.tmp` **21 junction в живое дерево**; гейт прав блокирует **33 из 55** карточек; `dsh.engines.dsh` **не читает никто**.

**7.4. Проверки вне границ кампании (исполняются исполнителем шага).**
- Любая запись в `C:\Users\Dmitry\.dsh` (F-02, F-04, F-05).
- `task_board_manage` (F-06, F-07) — доступность действий не подтверждена.
- `git tag` (F-25), коммиты, `git worktree remove` (F-10).
- Реальный прогон CI (F-25) — требует удалённого раннера.

---

## 8. Зависимости от решений `10-DECISIONS.md`

**Статус на момент правки:** `10-DECISIONS.md` опубликован; решения **D01–D15** записаны с вариантами и выбором, **D16–D20** пока присутствуют только строкой сводной таблицы (§«Сводка»). Все шаги ниже **сверены** с опубликованным текстом; расхождения исправлены в шагах, а не в решениях.

**Что уже исправлено по решениям:** F-28 (D07 — `myworkApplication`, расширяющий `apply`), F-30 (D11 — расширенный `ClockPort`), F-31 (D10 — навыки→`ctx.skills`, текст→`ctx.systemPrompt.section`, память своя), F-36/F-37 (D09 — `background_job` v7, `jobs-local` не используется вовсе), F-40 (D17 — механика), F-48 (D04 — `dsh.engines.dsh` + tarball), F-49 (D04 — `private` у всех 12), F-52/F-53 (D05 — 60 шагов, ветка в §30-gate), F-54 (D16 — `productTelemetry`, OTel не строим), F-56/F-57 (D15 — allowlist + `review.request-changes`), F-58/F-59 (D18 — `@dsh-mywork/web`, `data-mw-*`), F-08/F-09/F-27 (D19 — 19 карточек не переоткрывать; 7 нарушителей по цензу).

| Решение | Кто решает | Выбор (из `10-DECISIONS.md`) | Затрагивает шаги | Что исправлено в этом файле |
|---|---|---|---|---|
| **D04** — peer/version policy | владелец | **B (актуализировано 2026-10-03):** peer **по имени пакета** `@deepseek-ai/dsh` с диапазоном **`>=0.1.7-rc.2 <0.3.0-0`** (решение владельца 2026-10-03); `dsh.engines.dsh` — **декларативен** (читателей нет); доставка — **tarball**; **`private` сохранить у всех 12**, кроме будущего `@dsh-mywork/web` | F-47…F-50 | **Уточнение (не отмена):** `lead-03` доказывает, что **`engines` не читает никто** (`README.md:52`; 0 совпадений) ⇒ `dsh.engines.dsh` понижен до документации, контракт держит **только `peerDependencies`**. Peer объявляется **только в `controller`** (у остальных 11 нет импортов `@deepseek-ai/dsh-*`). Диапазон — **`>=0.1.7-rc.2 <0.3.0-0`** (решение владельца 2026-10-03); `>=0.1.7 <0.2.0` и `~0.1.7` **запрещены** (semver: false), верхняя граница **без** `-0` запрещена (пропускает `0.3.0-rc.1`). F-49: `private` не снимается, `private` установке tarball **не мешает** |
| **D05** — бюджет и лимит шагов | владелец | **B:** circuit-breaker поверх `ctx.tokenMeter` (только `measure`) + собственный счётчик шагов, **встроенный в §30-gate**; по умолчанию **60** шагов | F-51…F-53 | F-52 (значение 60 из триггера D05); F-53 (ветка в `chargeOf`/`usedOf`, `BudgetConsumption` получает поле шагов) |
| **D07** — форма composition root | агент | **B:** application service **`myworkApplication`** внутри `packages/controller`, **расширяющий существующий `apply`** | F-28…F-32, F-45 | F-28 (имя и место) |
| **D08** — durable state | агент | **B:** один канонический `MYWORK_DATABASE_MIGRATIONS` (**версии 1…6**) + запрет открытия store без него | F-18…F-20, F-33…F-35 | F-18 (версии 1…6 подтверждены: `EVIDENCE_MIGRATIONS` = 2 и 3; «мостик» не нужен); F-35 (WAL уже есть → шаг переписан на `synchronous`/`auto_vacuum`) |
| **D09** — durable jobs | агент | **B по истине, C по выводу:** `controller.sqlite` — истина, **`jobs-local` не используется вовсе**; буферы 256 KiB / 16 KiB заимствованы | F-36, F-37 | F-36/F-37 (таблица **`background_job`**, миграция **v7**; v7 свободна — проверено) |
| **D10** — Context/Memory/Skill | агент | **C, мост в одну сторону:** навыки — MyWork-реестр истина, публикация в `ctx.skills`; **память своя (шва нет)**; текст — `ctx.systemPrompt.section` | F-31, стык с `23-…` | F-31 (три точки подключения) |
| **D11** — источник времени | агент | **B:** расширить `ClockPort` до `now`/`sleep`/таймеров и передавать через application service | F-30 | F-30 (передавать **расширенный** порт) |
| **D15** — worker-поверхность | агент | **B:** **allowlist** инструментов worker-поверхности + «`auto-review` только deny»; `deny` нельзя объявить заранее (`tools/src/index.ts:1114-1117`) | F-56, F-57 | F-56 (allowlist вместо denylist, `ctx.tools.restrict`, константы `security.ts:201,212`); F-57 (`review.request-changes`) |
| **D16** — наблюдаемость | агент | Свой `audit`/`outbox` с `correlationId` — истина; **`productTelemetry` — наружу**; **OTel-экспортёр не строим** | F-54, F-55 | F-54 переписан с OTel на `productTelemetry` (API подтверждён) |
| **D17** — retention и секреты | агент | Окна по таблицам + VACUUM; секрет в теле артефакта — **`refuse`, не `redact`** | F-38…F-40 + `23-…` | F-40 (граница: механика здесь, предикат тел — `plan-quality`) |
| **D18** — форма UI-пакета | агент | Отдельный **`@dsh-mywork/web`**; `store` слота — источник view-состояния; префикс **`data-mw-*`** | F-58, F-59 | F-58 (`packages/web`, имя пакета; требования манифеста подтверждены); F-59 (`data-mw-*`) |
| **D19** — правило приёмки | владелец | «`done` требует отсутствия `failed` **без строки-обоснования**»; **19 `done`-карточек не переоткрывать**; ценз: 11 исполнений с `error`, из них 7 на `done` | F-08, F-09, F-27 | F-08 (запрет ретроспективного пересмотра); F-09/F-27 (7 нарушителей вместо 9) |
| **D20** — model availability | агент | Порт availability + `RouteRefusalReason: model-not-routable`; пустой `listModels` — **отказ, не дефолт** | F-43, F-44 | F-43 переписан: синтеза окна 1 000 000 **нет** (опровергнуто); реальные пробелы — пустой `listModels` и отсутствие ветки «не найдено»; сверить имя причины с существующим union |
| **D01 / D02 / D03 / D06 / D12 / D13 / D14** | владелец / агент | D01 — HTTP/SSE через `ctx.webServer` (+ spike на Typert); D02 — гибрид (9 зон в контракте, lanes в UI); D03 — домен → `procedure`, в `ctx.workflowEngine` не регистрироваться; D06 — выключать строку только после верифицированного cutover (ADR021); D12 — порядок §10 FINAL-REPORT; D13 — три паттерна из Agent Teams, coordination subsystem не строить; D14 — durable `HumanDecision` с освобождением сессии | прямых шагов нет | D03 → `21-…`; D06 → `22-…`; D13/D14 → `21-…`; D14 используется в F-57 как носитель «reviewer says allow» |

---

## 9. Что этап 0–3 НЕ делает (защита от переусердствования)

Взято из §10 `FINAL-REPORT` («Что НЕ делать») и §9.3 (red-team):

1. **Не строить coordination subsystem/mailbox** — нет потребителя; `outbox` + `inbox_dedup` уже есть (`migrations.ts:54,72`).
2. **Не заменять `AgentRuntimePort`**, не переносить TeamTask как canonical Task, не отождествлять `TeamId` с `SessionId`.
3. **Не переписывать TaskGraph / MyWork DB в event sourcing.**
4. **Не регистрировать MyWork-движок в `ctx.workflowEngine`** — один движок на контекст (K4).
5. **Не удалять агрегат `@linxin666/dsh-web-all`** — выключать только строку `web-ui-task-board`; в агрегате 18 нужных строк.
6. **Не строить второй учёт стоимости** — `BudgetConsumption {tokens, cost}` уже есть (`contracts/src/budget.ts:36`); используется `dsh-token-meter`.
7. **Не строить второй composition root** — единственный в `packages/controller/src/app.ts` (F-28); подключение Context/Memory/Skill — в F-31.
8. **Не «чинить» pnpm глобально** — F-01 даёт рабочий runner; установка/`.npmrc` — вне границ.
9. **Не строить OTel-экспортёр** — D16 прямо запрещает; наружу идёт `productTelemetry` (F-54). Не заводить denylist инструментов worker-поверхности — `tools/src/index.ts:1114-1117` отвергает незарегистрированные имена, поэтому D15 выбрал allowlist (F-56).
10. **Не исполнять в этой кампании:** F-02, F-04, F-05, F-07, F-10 (частично), F-11, F-25 (тег), а также любые `pnpm install` / `pnpm run build` / полный прогон тестов (§5.3–5.4 брифа).
12. **Не пинить пресет standard** — нет живого подтверждения монтирования; пинится только cordis (дефолт деплоя). Не диагностировать пресеты через 
equire.resolve от каталога профиля — там устаревшая ферма с 9 битыми junction (F-61).
13. **Не удалять .tmp рекурсивно** (Remove-Item -Recurse -Force по вычисленному пути/маске/переменной) — 21 junction ведёт в живое дерево; только точные пути и cmd /c rmdir /s /q (F-10). Не запускать git clean -xdf где угодно.
14. **Не считать dsh.engines.dsh контрактом совместимости** — его не читает никто; гейт держит только peerDependencies (F-48). Не использовать >=0.1.7 <0.2.0 и ~0.1.7 — оба молча ломают гейт. **Не писать верхнюю границу без `-0`** (`>=0.1.7-rc.2 <0.3.0`) — измерено: `0.3.0-rc.1` проходит такую границу насквозь (`includePrerelease: true` → `true`); канон — `>=0.1.7-rc.2 <0.3.0-0` (решение владельца 2026-10-03, F-48 «факт 6», F-50).
15. **Не заводить аллокатору собственную версию миграции** — цикличность разорвана bootstrap-DDL (`migrations.ts:96-103` создаётся до первой миграции, F-63). **Не выдавать номер по имени файла или порядку объявления** — только по стабильному `key` заявки. **Не писать номер версии миграции литералом** — только через единый аллокатор (R-04, §15.3); иначе alidateMigrations бросит на дубле и store не откроется. **Не расширять FORBIDDEN до @deepseek-ai/* без allowlist** (R-08, §15.4) — гейт будет красным всегда. **Не предписывать pnpm run build|check** — только corepack pnpm -r run … (R-06, §15.1). **Не полагаться на «uto-review не смонтирован»** — он активен (R-22). **Не строить гейт шага на живом профиле или ручной перезагрузке GUI** (R-08, R-21).
16. **Не дублировать с другими файлами шагов:** retention-*предикат* тел — `23-…`; конвейер исполнения и provisioning saga — `21-…`; доска/UI-миграция — `22-…`; правки карточек — `30-…`.

---

## 10. Порядок исполнения (рекомендация)

```text
День 0  (часы):  F-01 → F-04 → F-05 → F-06 → F-07 → F-02 → F-03 → F-08 → F-09 → F-10 → F-11 → F-12 → F-61 → F-62
Дни 1–3        :  F-13 → F-14 → F-15 → F-16 → F-17
                  F-18 → F-19 → F-20
                  F-21, F-22  (параллельно с F-18…F-20, общий файл только tests/beads-adapter.test.mjs)
                  F-23 → F-24 → F-25 → F-26 → F-27 → F-63
Дни 4–10       :  F-28 → F-29 → F-30 → F-31 → F-32
                  F-33 → F-34 → F-35
                  F-36 → F-37
                  F-38 → F-39 → F-40
                  F-41 → F-42, F-43 → F-44, F-45 → F-46
Дни 11–24      :  F-47 → F-48 → F-49 → F-50
                  F-64 (гейт цитат и запись дельты; зависит от F-48 и F-50)
                  F-51 → F-52 → F-53
                  F-54 → F-55, F-56 → F-57
                  F-58 → F-59 → F-60
```

**Правило параллелизма (write-scope):** шаги в одном блоке не должны править один файл. Конфликтные пары, которые нельзя запускать одновременно: F-21 ‖ F-22 (оба правят `tests/beads-adapter.test.mjs`), F-41 ‖ F-42 (оба правят `tests/boundaries.test.mjs`), F-48 ‖ F-49 (оба правят `packages/*/package.json`), F-58 ‖ F-59 (оба правят `packages/web/**`), F-51 ‖ F-53 (оба правят `packages/core/src/budget.ts` и `packages/contracts/src/budget.ts`).

---

*Файл подготовлен `plan-foundation` 2026-09-27. Все `файл:строка` — из чтения этой сессии, кроме помеченных `~` и §7.3.*

## 11. Соответствие каноническим правилам `01-MASTER-PLAN.md` §15

Правила §15 мастер-плана обязательны для всех файлов шагов. Ниже — как именно этот файл им соответствует и где правило применено.

| Правило §15 | Что требует | Где в этом файле |
|---|---|---|
| **15.1 · Runner** | Только `corepack pnpm -r run <script>` (с `-r`); точечно — `node --test --test-isolation=none <файл>`, `node_modules\.bin\tsc.cmd --noEmit -p <tsconfig>`, `node <tsdown-entry>`; шаги, предписывающие `pnpm run build\|check` как гейт, переписать | §0 п. 1 (канон чтения); F-01 (шаг 4 и гейт); F-12 (команда 2); F-25 (все команды — по отдельности, без `run check`); F-18, F-46, F-60 (typecheck) |
| **15.2 · Адресация карточек** | `task_board_*` принимает UUID; каждый шаг обязан начинаться с «Шаг 0: получить UUID через `task_board_list { query: "MW-0NN" }`» | F-06, F-07, F-09, F-61, F-62 — добавлен обязательный «Шаг 0 (R-05)» |
| **15.3 · Версии миграций** | Версия выделяется **только единым аллокатором** в composition-слое; литерал в шаге запрещён; тест не должен содержать `[1,2,3,4,5,6]` | **F-63 — сам аллокатор** (создаёт модуль, таблицу заявок и тесты; снимает блокировку `E-04`/`E-19`/`E-28`/`E-34`/`E-37` и `B-12`); F-18 (тест читает набор из аллокатора; «занято сегодня» — состояние, а не константа); F-36/F-37 (`background_job` — заявка); F-40 (триггеры retention — заявка) |
| **15.4 · Boundary-тест** | Расширяя `FORBIDDEN` до `@deepseek-ai/*`, обязательно оставить allowlist | F-41 (allowlist + явный тест «`cordis` проходит / `dsh-sandbox-policy` падает»); F-42 (новые наборы — с тем же allowlist''ом; перед включением проверить импорты `cordis`) |
| **15.5 · Сборка и клиентский бандл** | Все 12 `tsdown.config.ts` имеют `clean: true`; рукописный `lib/client.js` обязан быть исключён из очистки либо пересобран после сборки | F-58 (шаг 3 — «КРИТИЧНО (R-08)»; гейт **локальный**: `Test-Path packages\web\lib\client.js` после `corepack pnpm -r run build`) |
| **15.6 · Ссылки внутри плана** | Ссылаться на **шаги и карточки** (`F-32`, `E-24`, `B-01a`, `MW-060`), а не на номера строк мастер-плана и решений | этот файл ссылается на `01-MASTER-PLAN.md` §15/§16 (разделы, не строки), на `F-*`/`MW-*` и на `файл:строка` **кода** (номера строк кода стабильнее плана); ссылок вида `10-DECISIONS.md:NNN` нет |
| **15.7 · Один writer на файл** | Исправления вносит владелец файла | все правки внесены владельцем (`plan-foundation`); чужие файлы не правились |

**Сквозные правила, влияющие на этот файл (вне §15):**
- **§16 R-14 (дубли тем `20-` ↔ `23-`):** известные пересечения — F-43↔Q-35, F-44↔Q-34. Разграничение: F-43/F-44 проверяют **контракт MyWork** (порт и отказы маршрутизации, политики прав сессии), `23-…` владеет платформенным enforcement (`sandbox-policy` + `fs-observation-policy`) и метриками. Спорные пункты — за `verifier-a`; **новых дублей этот файл не заводит** (F-40 явно отдаёт предикат тел в `23-…`, F-57 — вызовы в `21-…`).
- **§16 R-16 (бюджетные значения):** канон — **60 шагов и 2M токенов на попытку** (D05). В F-52 значение шагового лимита приведено к канону; лимит токенов — `maxTokensPerTask`, значение берётся из D05.
- **§16 R-03/R-22 (`auto-review`):** активен; F-57 переписан на «ограничиваем правилом deny», формулировки «не смонтирован» удалены.

---

## 12. Дополнение: гейт цитат плана и запись дельты (`F-64`)

#### F-64 · Гейт цитат плана и запись дельты платформы

- **Карточка:** `P1` (эта кампания актуализации; отдельной карточки доски нет) · **ADR-действие:** D04 · **Источник:** `02-PLATFORM-DELTA-0.2.0-rc.2.md` §6 (карта правок) и §4 (внутренние связи).
- **Зависит:** F-48, F-50 (гейт имеет смысл только на актуализированных диапазоне и матрице) · **Усилие:** **M** (не S: скрипт — **371 строка / 16 172 Б** с 8 проверками (4 правила находок + 4 положительных контроля), fail-closed в 5 ветках, разбор CLI, `--json`; 13 мутационных прогонов в независимом ревью и три прохода ревью кампании, из них 2 MAJOR в самом гейте и 3 дефекта, внесённых правками — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §7.2–§7.3; оценка «S» занижена, см. red-team A §5) · **Риск:** низкий · **Откат:** удалить скрипт и шаг.
- **Цель:** «план снова разошёлся с платформой» перестаёт быть незамеченным: цитата устаревшей версии платформы в любом файле плана делает прогон красным, а сама дельта записана в один адресуемый документ.
- **Файлы:** Create `scripts/check-plan-citations.mjs` (**вне write-scope `plan-foundation`** — владелец Lead, заявка этой кампании; **поставлен**, 371 строка); Modify `package.json` (npm-скрипт `check:plan` = `node scripts/check-plan-citations.mjs` — **поставлен**); Modify `02-PLATFORM-DELTA-0.2.0-rc.2.md` (только дополнение §3 MISSING владельцем).
- **Проверенные факты:**
  1. Цитируемость проверяема механически: инвентарь кампании R6 дал **222** вхождения `0.1.7-rc.2` в 39 документах и **0** вхождений `639ed0153` — то есть «текущая платформа» в плане везде устарела (метрика — `Select-String`/regex по `.work/plan-v0.3/**`, `.work/tasks/MW-*.md`, root `README.md`). **Это срез до правок кампании (инвентарь R6):** замер §4 дельты на текущем корпусе не воспроизводится (находка верификатора A — НО-3), поэтому «222/0» — исторический замер, а не текущее утверждение.
  2. Каноническая ревизия — `639ed0153` = тег `dsh-v0.2.0-rc.2` (`git tag --points-at 639ed0153` → `dsh-v0.2.0-rc.2`); версия рантайма гейта — из `packages/boot/app-boot/package.json` = `0.2.0-rc.2`.
  3. Прецедент «зелёный гейт молчит о расхождении» уже был: `10-DECISIONS.md` **D04 п. 2** («`dsh.engines.dsh` читается платформой») прожило до кампании 2026-10-03 и опровергнуто чтением кода (`packages/boot/app-boot/README.md:52`).
  4. Ссылки внутри плана обязаны идти **по ID**, а не по строкам (§15.6): линейных ссылок `01-MASTER-PLAN.md:NNN` — **223** на момент замера кампании v0.3 (перемер 2026-10-03: **219** — владельцы переводят их на ID), мастер вырос **443 → 593** строк, поэтому гейт проверяет **цитаты версии/шага**, а не номера строк чужих файлов.
  5. **Флаг `--dsh-checkout <чекаут>`** (есть также `--plan-dir`, `--json`, `--help`): версия берётся из `<чекаут>/package.json` (поле `version`), коммит — `git -C <чекаут> rev-parse HEAD`, **первые 9 знаков**; чекаут обязан быть **корнем** репозитория (`git rev-parse --show-toplevel` сверяется с путём — иначе `git -C` молча поднялся бы к внешнему репозиторию и гейт позеленел бы на чужом HEAD). Без флага берутся константы `0.2.0-rc.2`/`639ed0153`, поэтому прогон **без** флага не проверяет дерево.
  6. **Коды выхода:** `0` — чисто; `1` — находки **или** провал положительного контроля; `2` — ошибка окружения/использования (**fail-closed**): неизвестный аргумент, отсутствующий каталог плана, отсутствие корневого `README.md`, отсутствие/нечитаемость `package.json` чекаута или отсутствие в нём строки `version`, не-Git-корень, отсутствие `packages/controller/package.json` или `packages/web/package.json`. Проба 2026-10-03: `--dsh-checkout C:\Windows` → `exit 2` («has no package.json (fail-closed)»); неизвестный аргумент → `exit 2`.
  7. **Поверхность и положительные контроли.** Сканируются `.work/plan-v0.3/**/*.md`, корневой `README.md` и два манифеста (`packages/controller/package.json`, `packages/web/package.json`); `evidence/**` и `90-`…`93-` освобождены целиком как исторические артефакты, плюс построчные маркеры историчности и сравнительные таблицы. Контроли (чтобы «удалить все цитаты» не давало зелёный): `02-PLATFORM-DELTA-0.2.0-rc.2.md` обязан называть **текущие** коммит и версию, а `01-MASTER-PLAN.md` — содержать `§1.4`; провал любого — `exit 1`.
  8. **Класс advisory:** линейные ссылки на **другие** документы плана (`00-RECON`, `10-DECISIONS`, `2x-STEPS-*`, `30-CARD-EDITS`) печатаются как `advisory` и **не** влияют на код выхода (канон §15.6; известный остаток — 59 ссылок на момент §7.1 п.6 дельты, **57** на 2026-10-03 по замеру этого прохода: владельцы сняли две; число убывает по мере перевода владельцами — гейт печатает текущее); ссылки `01-MASTER-PLAN.md:NNN`, наоборот, дают находку `master-plan-line-reference`.
- **Шаги:**
  1. Create `scripts/check-plan-citations.mjs` (**поставлен** — 371 строка): обход `.work/plan-v0.3/**/*.md` + root `README.md`; ищет **устаревшие цитаты платформы** — зафиксированную верхнюю границу `>=0.1.7-rc.2 <0.2.0`, SHA базы `c7c4c725`, `0.1.7-rc.2` в роли **текущей** версии (без пометки историчности), — печатает `файл:строка` и завершается `exit 1` при находке. Флаги, коды выхода, контроли и класс advisory — факты 5–8.
     **Ловушка реализации (найдена при правке 2026-10-03):** сама каноническая строка содержит `0.1.7-rc.2` как **нижнюю** границу (`>=0.1.7-rc.2 <0.3.0-0`) — наивный grep по токену покрасит весь актуализированный план. Гейт обязан различать нижнюю границу (канон) и верхнюю/версию-в-роли-текущей (устаревшее).
  2. Исключение для исторических протоколов: строки, помеченные «кампания v0.3», «историческ», «актуализировано/актуализация», «прежде», «в кампании», из вердикта исключаются — иначе `90-…`/`91-…`/`92-…` и §5 этого файла краснеют вечно.
  3. Прогон на актуализированном плане **с чекаутом** (как в §7.1 п.6 дельты): `node scripts/check-plan-citations.mjs --dsh-checkout C:\Reposit\deepseek-harness\deepseek-harness` → `check-plan-citations: PASS`, `exit 0` (непроверенная до конца часть — `02-…` §3 MISSING, закрывается P0.5). Тот же скрипт доступен как npm-скрипт `corepack pnpm run check:plan`, но он идёт **без** флага (константы), поэтому приёмка опирается на прогон с `--dsh-checkout`.
  4. Проверка на мутации (обязательна — иначе гейт неотличим от «всегда зелёного»): вернуть в тестовую копию одну строку с `>=0.1.7-rc.2 <0.2.0` без пометки → `exit 1`, в выводе — `файл:строка`; и контрольная проверка «канон не красится»: строка `>=0.1.7-rc.2 <0.3.0-0` → `exit 0`.
  5. Проверка fail-closed (`exit 2`): прогон с `--dsh-checkout` на каталоге без `package.json` либо из каталога без `README.md` — гейт обязан **упасть**, а не позеленеть на константах.
- **Гейт (готово когда):** `node scripts/check-plan-citations.mjs --dsh-checkout <DSH-чекаут>` → `exit 0` (`check-plan-citations: PASS`, findings 0, controls 0) на актуализированном плане **и** `exit 1` на копии с искусственно возвращённой цитатой; отдельно — `exit 2` на испорченном окружении как доказательство fail-closed; в отчёте — выводы и коды возврата всех трёх прогонов плюс число advisory. Прогон **без** `--dsh-checkout` гейтом не считается: он сверяется с константами `0.2.0-rc.2`/`639ed0153`, а не с текущим деревом.
- **Evidence:** вывод прогонов (актуальный план / мутация / испорченное окружение), список найденных цитат, ссылка на `02-PLATFORM-DELTA-0.2.0-rc.2.md`.
- **Риски:** гейт превратится в «зелёный по построению» (слишком широкие исключения) — поэтому шаг 4 обязателен, а исключения ограничены явными маркерами. Второй риск — гейт начнёт требовать переписывания исторических вердиктов; политика кампании обратная: **историчность сохраняется**, помечается, а не удаляется.
- **Не делать:** не переписывать вердикты прошлых проходов (`90-…`–`93-…`) и не подменять ими актуализацию; не проверять номера строк чужих документов (`01-MASTER-PLAN.md:NNN`) — это класс R-13, лечится правилом §15.6, а не гейтом.
- **Зависимость от D-решений:** **D04** (peer/version policy) — диапазон `>=0.1.7-rc.2 <0.3.0-0`, `dsh.engines.dsh` декларативен.
