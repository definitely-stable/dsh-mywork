# verify-stage1 — независимое ревью этапа 1 (F-13…F-27, F-63)

- **Ревьюер:** независимый (не автор шагов), отдельная сессия.
- **База → вершина:** `0c657ae` → `07e6850`, тег `v0.1.0-m1` (аннотированный, на `07e6850`), рабочее дерево чистое до и после ревью (`git status --porcelain` пусто).
- **Режим:** read-only по живому дереву/профилю/доске. Разрешённые исключения выполнены и откатаны: один mutation-check (F-19) с побайтовым восстановлением; `node scripts/pack.mjs` ×2 (пишет в gitignored `.tmp/**`, `*.tgz` удаляются самим скриптом).
- **Дата:** 2026-09-27.

---

## 1. Вердикт

**PASS WITH FINDINGS.** Все восемь проверяемых утверждений подтверждены собственными командами, включая невакуумность гейта F-19 (mutation-check: 2 падения при сломанной проверке, 29/29 зелёных после восстановления); ни одного BLOCKER/MAJOR не найдено, 6 MINOR и 4 NIT — все косметические/документационные, кроме дублирования DDL и «зелёного по умолчанию» `ledger-sync`.

---

## 2. Проверенные команды

| Команда | exit | Наблюдение |
|---|---|---|
| `git log --oneline 0c657ae..HEAD` | 0 | 10 коммитов, `07e6850` вершина |
| `git status --porcelain` (до и после ревью) | 0 | пусто; `git describe --tags HEAD` → `v0.1.0-m1`; `git cat-file -t v0.1.0-m1` → `tag` |
| `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` | 0 | `tests 2 / pass 2 / fail 0` — гейт F-19 |
| `node -e "openStore({path})"` + `existsSync` (прямая проверка) | 0 | `refused: code=migrations-required name=StorageError`; `file exists: false`; `dir entries: []` — отказ **до** создания файла |
| `node --test … migrations-registry migrations-required migration-journal migration-allocator` | 0 | `tests 12 / pass 12 / fail 0 / skipped 0` — гейт F-27 (п.2) |
| `node --test … tests/storage.test.mjs tests/storage-crash.test.mjs` (+4 storage-файла) | 0 | `tests 29 / pass 29 / fail 0` |
| `Select-String tests\storage\*.mjs -Pattern '\[1,\s*2,\s*3'` | 0 | **1 совпадение**, и оно в комментарии-запрете (`migrations-registry.test.mjs:8`), не в ассерте |
| `Select-String packages\controller\src\migration-allocator.ts -Pattern 'version: \d'` | 1 | **0 совпадений** — номер не литерал (гейт F-63) |
| `node --test … tests/beads-adapter.test.mjs` (bd есть, мягкий режим) | 0 | `tests 72 / pass 72 / fail 0 / skipped 0`; EPERM в выводе — **0** |
| `MYWORK_REQUIRE_BEADS=1 node --test … tests/beads-adapter.test.mjs` (bd есть) | 0 | `tests 72 / pass 72 / fail 0 / skipped 0` — гейт F-27 (п.1), 285 с |
| то же с вычищенным окружением (PATH/APPDATA/npm_config_prefix → несуществующие) | 0 | `pass 49 / fail 0 / skipped 23` + `bd is unavailable: binary-not-found … install Beads 1.3.0` — воспроизведены «23 skip» |
| то же + `MYWORK_REQUIRE_BEADS=1` | **1** | `tests 1 / pass 0 / fail 1 / skipped 0`, `Error: … the real-bd contract checks are SKIPPED … These are not passes.` — строгая ветка F-17 работает |
| `node --test … beads-launch beads-runner-launch beads-probe scripts-launch scripts-pack-idempotent ledger-index ledger-sync` | 0 | `tests 17 / pass 17 / fail 0 / skipped 0` |
| `node --test … evidence.test.mjs lease.test.mjs plan-mutation.test.mjs claim-saga.test.mjs` | 0 | `tests 148 / pass 148 / fail 0` — смена сигнатуры F-19 не сломала чужие вызовы |
| `node scripts/pack.mjs` ×2 | 0 / 0 | оба раза `.tmp\pack\dsh-mywork-controller-0.1.0.tgz`; `.tmp\pack-logs\pnpm-pack.launch.log` → `branch: corepack`, `shell: false` |
| `Get-ChildItem packages\controller -Filter *.tgz` | — | **0** файлов — гейт F-24 |
| `Select-String scripts\lib\process.mjs -Pattern 'shell: process\.platform'` | 1 | **0 совпадений** — гейт F-23 |
| `node scripts/ledger-index.mjs --check` | 0 | `--check OK (55 cards)`; mtime `INDEX.md` не изменился (read-only) |
| `node scripts/ledger-sync.mjs` | 0 | `board revision: 325`, `cards 55`, `31 = 20 succeeded + 11 failed`, `doneViolations: 7`, `failedOnDone 7`, `outside 4` |
| независимый пересчёт ценза по `ledger-v2.json` (PowerShell) | — | `revision 325; tasks 55; executions 31; succeeded 20; failed 11; doneCards 19; failedOnDone 7; failedOutsideDone 4` — совпало до цифры |
| тот же пересчёт по `.work\tasks\board-export.json` | — | `revision 82; tasks 41; executions 0` — снимок не содержит исполнений вообще |
| `node_modules\.bin\tsdown.cmd` в `packages\storage` (мутация → восстановление) | 0 / 0 | `Build complete in 12231ms` / `13117ms` |
| `node --test … migrations-required.test.mjs` **на мутированном** коде | **1** | `pass 0 / fail 2` — гейт F-19 не вакуумный |
| `tsc --noEmit -p tsconfig.json` в `packages\controller` | 0 | типовой импорт `@dsh-mywork/storage` разрешается через `paths` в `tsconfig.base.json` |

---

## 3. Findings

### MINOR-1. Сообщение об отказе называет несуществующий символ
`packages/storage/src/store.ts:98` (и то же в `packages/storage/src/index.ts:8`).
Текст отказа: «pass `MYWORK_DATABASE_MIGRATIONS`». Такого экспорта в репозитории **нет**: `Select-String -Pattern 'MYWORK_DATABASE_MIGRATIONS'` по `packages/**/src`, `tests/**`, `scripts/**` даёт ровно 2 совпадения — сам текст сообщения и doc-комментарий рядом с ним. Реализованный интерфейс — `canonicalMigrations(sources)` / `assertCanonicalMigrations(list)`.
**Почему важно:** действительная половина типизированного отказа — «что делать» — ведёт оператора к имени, которого нет; это ровно тот класс дефекта, который F-19 закрывает (сообщение вместо молчания), но в исполнимой части.
**Причина:** текст взят дословно из плана (F-19, шаг 2), а сам план в F-18 шаге 4 санкционировал замену константы на функцию склейки. План и реализация расходятся.
**Минимальная правка:** либо экспортировать константу (её владелец — F-29, composition root), либо переписать строку на `canonicalMigrations([MYWORK_MIGRATIONS, …])`.

### MINOR-2. «Единый реестр» — это функция склейки плюс три рукописных перечня
`tests/storage/migrations-registry.test.mjs:21-29`, `tests/storage/migration-journal.test.mjs:35-43`, `tests/storage/migration-allocator.test.mjs:44-52` — каждый файл сам перечисляет пять пакетов-слоёв.
**Почему важно:** шестой слой с миграциями невидим всем трём тестам (registry-тест останется зелёным), а `canonicalMigrations` не знает о нём ничего — «один список, описывающий базу целиком» пока не существует нигде, кроме этих трёх перечней. План это допускает (F-18 шаг 4: сборка — в composition root, F-29), но тогда гейт F-18 проверяет только то, что сложили в тесте.
**Минимальная правка:** один общий помощник сборки (например, в `tests/lib/fixtures.mjs`) и/или явная запись в F-29, что канонический список появляется там; в тестах — сверка с ним, а не повторное перечисление.

### MINOR-3. Гейт F-27 «зелёный по умолчанию»
`scripts/ledger-sync.mjs:248`: `process.exit(0)`, если не передан `--strict`; при этом отчёт печатает **55 расхождений** и **7 нарушений** правила `done`.
**Почему важно:** как *гейт* команда не может упасть — регрессия, добавляющая восьмое нарушение, останется зелёной. В коде это осознанное решение (словари леджеров разные), и отчёт `foundation-27` его называет; но формулировка гейта этапа 1 («`node scripts/ledger-sync.mjs` → отчёт с объяснённым числом») не отличает «проверено» от «напечатано».
**Минимальная правка:** либо подключить `--strict` в CI после согласования словарей, либо в гейте зафиксировать ожидаемое число (`doneViolations == 7`), чтобы изменение стало видимым.

### MINOR-4. Строка evidence про EPERM не воспроизводится
`.work/plan-v0.3/evidence/foundation-stage1-gate.md:28` утверждает: `Select-String tests/beads-adapter.test.mjs -Pattern 'EPERM'` → «0 совпадений».
**Факт:** совпадений **3** — комментарии `:98`, `:129` и негативный ассерт `assert.doesNotMatch(text, /EPERM/)` на `:140`. Настоящий гейт F-16 — это 0 совпадений в **выводе прогона**, и он выполняется (проверено: `EPERM in output: 0` и в мягком, и в строгом прогоне).
**Почему важно:** evidence подменяет цель grep'а; следующий ревьюер, повторив команду буквально, получит 3 и будет вынужден разбираться, кто прав.
**Минимальная правка:** заменить команду на `node --test … tests/beads-adapter.test.mjs 2>&1 | Select-String 'EPERM'` (как в `foundation-16-beads-test-honest.md:21`) либо указать «3 совпадения: 2 комментария + негативный ассерт».

### MINOR-5. Гейт F-27 невоспроизводим вне этой машины
`scripts/ledger-sync.mjs:38-41` берёт леджер из `%USERPROFILE%\.dsh\task-board\ledger-v2.json`; при его отсутствии — `exit 2`. Кроме того `.work/**` в `.gitignore` (`git check-ignore -v` → `.gitignore:1`), то есть `INDEX.md` и `tasks.json` в замороженный коммит **не входят**: гейты F-26/F-27 проверяют локальное, незакоммиченное состояние плюс живой профиль.
**Почему важно:** «повторить гейт» на чистом клоне нельзя; в отчёте `foundation-stage1-gate.md` §5 (ограничения) этого ограничения нет, хотя есть более слабые.
**Минимальная правка:** записать в evidence путь, ревизию (325) и хэш леджера, использованного для гейта; либо запускать с `--board <путь>` и приложить снимок.

### NIT-1. Идемпотентность пака привязана к имени текущей версии
`scripts/pack.mjs:53-54` удаляет только `<name>-<version>.tgz`. `.tgz` от **другой** версии в `packages/controller` переживёт пак, и гейт «0 `.tgz`» пройдёт (сейчас там действительно 0 файлов).
**Минимальная правка:** удалять `<name>-*.tgz` или утверждать, что в каталоге не осталось посторонних `.tgz`.

### NIT-2. Аллокатор: необъявленная зависимость и вторая копия DDL
`packages/controller/src/migration-allocator.ts:19` типово импортирует `@dsh-mywork/storage`, которого нет в `packages/controller/package.json` (`devDependencies`: `@deepseek-ai/cordis`, `adapter-sdk`, `contracts`, `core`); разрешение держится только на `paths` в `tsconfig.base.json`. Плюс `:107-113` повторяет `MIGRATION_ALLOCATIONS_DDL` из `packages/storage/src/migrations.ts:111-117` — две копии одного DDL.
Сейчас безвредно: `migration-allocator.ts` не реэкспортируется из `packages/controller/src/index.ts` (0 совпадений), в `lib/index.js` и `lib/index.d.ts` ссылок на storage — 0/0, `tsc` для пакета → 0. Оба решения документированы в коде.
**Минимальная правка:** добавить `@dsh-mywork/storage` в `devDependencies` контроллера (или комментарий-указатель на копию в storage как источник истины) до того, как F-29 сделает модуль публичным.

### NIT-3. Отчёты F-25/F-27 остались в красном состоянии без пометки
`foundation-25-ci.md:37,52` и `foundation-27-ledger-sync.md:68` утверждают `MYWORK_REQUIRE_BEADS=1 … → fail 1` (`bd heartbeat`). Это состояние снято правкой F-22 и перекрыто `foundation-stage1-gate.md:26` (`72/0/0`, воспроизведено мной дважды).
**Минимальная правка:** строка «superseded by foundation-stage1-gate.md §2» в обоих файлах.

### NIT-4. CI пинует плавающий минор Node
`.github/workflows/ci.yml:29,53,76` — `node-version: '22.x'`, тогда как `package.json engines.node = '>=22.18.0'`, а тесты импортируют `.ts`-исходник (`tests/storage/migration-allocator.test.mjs:25-27`), что требует type stripping (по умолчанию с 22.18.0).
**Почему важно:** `22.x` сегодня разрешается выше порога, поэтому дефекта нет; раннер, разрешивший 22.17, упадёт на импорте `.ts` — и это будет выглядеть как поломка кода, а не окружения.
**Минимальная правка:** `node-version: '22.18'` либо шаг `node --version` с проверкой порога.

---

## 4. Соответствие шагам

| Шаг | Статус | Доказательство |
|---|---|---|
| F-13 | выполнен | `beads-launch.test.mjs` 3/3; `launch.ts:105` — `command: options.execPath ?? process.execPath`, `shell: false`; отказ `BEADS_BINARY_NOT_FOUND` вместо отката на шим (`launch.ts:116-119`) |
| F-14 | выполнен | `beads-runner-launch.test.mjs` 2/2; инвариант «no shell» проверен ассертом |
| F-15 | выполнен | `beads-probe.test.mjs` 2/2; `export function probeBeads` — 1 совпадение; проба подключена в **реальный** Doctor-путь: `adapter.ts:765` внутри `doctor()` (`:759`), с `describeBeadsProbe` в `:771` |
| F-16 | выполнен | EPERM в выводе прогона — 0 (оба режима); `describeBeadsProbe` печатает `reason`+`code`+команду установки; негативный ассерт `:140` |
| F-17 | выполнен | строгая ветка `:102-106` — при вычищенном окружении `exit 1`, `fail 1`, текст называет `binary-not-found` + `npm install -g @beads/bd@1.3.0`; без переменной тот же прогон — `skipped 23` |
| F-18 | выполнен (санкционированное отклонение интерфейса) | `canonicalMigrations`/`assertCanonicalMigrations` (`migrations.ts:163-195`) вместо константы `MYWORK_DATABASE_MIGRATIONS`; тест 3/3, набор версий читается из пакетов, не из литерала; `MYWORK_DATABASE_SCHEMA_VERSION` (=6) не создан — план сам разрешил это в F-18 шаге 4 |
| F-19 | выполнен | отказ `store.ts:95-100` **до** `openSqlite` (`:110`); прямая проверка: файла нет, каталог пуст; тест 2/2; все 57 вызовов `openStore(` в тестах передают `migrations`; 148 доменных тестов зелёные |
| F-20 | выполнен | `assertJournalConsistent` (`migrations.ts:267-288`) вызывается после цикла (`:252`); тест ловит и потерянную строку (`journal=[1..6]` vs `expected`), и строку впереди штампа; `schema-version-unsupported` не сломан (`storage.test.mjs:441-456` зелёный) |
| F-21 | выполнен | тест читает `id`/`dependency_type` (`:869-870`), `depends_on_id` остался только в комментариях `:862-863,1252`; `pass 72 / fail 0` |
| F-22 | выполнен | `adapter.ts:642` — `{ BEADS_ACTOR: actor }`; `BEADS_ACTOR` в `adapter.ts` — **5** совпадений (≥2 по гейту); сигнатура обратно совместима (`claimant?`) |
| F-23 | выполнен | `shell: process.platform` — 0; ветка `unavailable` вместо молчаливого `shell:true` (`process.mjs:184-188`); лог ветки пишется (`pack.mjs:65-69`); фактическая ветка — `corepack`, `shell: false` |
| F-24 | выполнен | `pack.mjs` ×2 → 0/0; в `packages/controller` 0 `.tgz`; тесты `scripts-pack-idempotent` 2/2 (включая «оставшийся одноимённый .tgz не ломает прогон») |
| F-25 | выполнен (CI не исполнялся) | 3 job'а: `build-test` (гейт L), `beads-backend` (`@beads/bd@1.3.0` + `MYWORK_REQUIRE_BEADS: '1'`), `profile` (гейт P, `needs: build-test`); все `windows-latest`; `--frozen-lockfile` в трёх job'ах; CLI пинован `@deepseek-ai/dsh@0.1.7-rc.2`; вакуумность хэшей профиля записана комментарием; `git tag --list` → `v0.1.0-m1` |
| F-26 | выполнен | `INDEX.md:12/124` — маркеры, `:13` — `lastSyncedRevision: 325`, 55 строк карточек; `--check` → 0 и файл не меняется; тесты 3/3 |
| F-27 | выполнен | `ledger-sync` → 0; леджер — живой (`C:\Users\Dmitry\.dsh\task-board\ledger-v2.json`), ревизия 325; `doneViolations 7`; ценз пересчитан независимо и совпал; `board-export.json` (rev 82) не используется (0 исполнений) |
| F-63 | выполнен | `migration-allocator.ts` — идемпотентность по ключу (`:170-171`), `highestOccupied` = max(`schema_migrations`, `PRAGMA user_version`, `migration_allocations`) + 1 (`:145-152`), `UNIQUE(version)` в DDL (`:110`), всё в одной транзакции (`:168`); `version: \d` — 0 совпадений; тесты 5/5, включая «удаление заявки не освобождает номер» и «собранный список проходит `validateMigrations`» |

---

## 5. Вакуумные проверки и слабые тесты

**Mutation-check (обязательный, ровно один — F-19).**
1. Копия: `packages\storage\src\store.ts` → `.tmp\stage1-review\store.ts.bak` (SHA-256 `67FFF4A4…4F2B9`).
2. Мутация: удалён блок `if (!Array.isArray(requested) || requested.length === 0) { throw … }` (`store.ts:95-100`).
3. Сборка точечно: `node_modules\.bin\tsdown.cmd` в `packages\storage` → `Build complete in 12231ms`, exit 0.
4. `node --test --test-isolation=none tests/storage/migrations-required.test.mjs` → **exit 1, `pass 0 / fail 2`** — оба теста падают (отсутствие списка даёт `TypeError` вместо `StorageError`; пустой список открывает store).
5. Восстановление из копии → SHA-256 совпал с исходным, `git diff -- packages/storage/src/store.ts` пусто, `git status --porcelain` пусто.
6. Пересборка → exit 0; `migrations-required` + registry + journal + allocator + `storage.test.mjs` + `storage-crash.test.mjs` → **`tests 29 / pass 29 / fail 0 / skipped 0`**.
**Вывод: гейт F-19 не вакуумный.** Отдельно проверено, что проверяемая половина «файл не создан» тоже не пустая: прямой вызов `openStore({path})` даёт `code=migrations-required`, `existsSync(path) === false`, каталог пуст.

**Что ещё проверено на невакуумность:**
- F-17: строгая ветка не может быть «случайно зелёной» — при вычищенном окружении она даёт `exit 1 / fail 1`, при `bd` в наличии — `72/0/0`. Оба прогона сделаны.
- F-20: оба теста построены на `assert.rejects` с кодом, который порождает **только** новая проверка (`MIGRATION_JOURNAL_INCONSISTENT`); без `assertJournalConsistent` `openStore` разрешился бы и тест упал. Мутацию не проводил (бюджет — 1 мутация).
- F-18/F-63: тесты читают ожидаемые версии из пакетов и из store (`highestOccupied` — запросом), а не из литералов; проверено grep'ом.
- F-24: тест «оставшийся одноимённый `.tgz` не ломает прогон» действительно воспроизводит исходный дефект (пак перезаписывает файл под тем же именем).

**Найденные слабости (не вакуумные, но неполные):**
- MINOR-3: `ledger-sync` без `--strict` не может упасть — как гейт не работает.
- MINOR-2: registry-тест перечисляет слои руками; новый слой пройдёт мимо.
- NIT-1: гейт «0 `.tgz`» проверяет только имя текущей версии.
- `--check` у `ledger-index` не валит прогон на устаревшем штампе ревизии — это осознанное решение и оно записано (сам автор провёл мутацию `INDEX.md` и получил `exit 1`, см. `foundation-stage1-gate.md` §4; я проверил только read-only-идемпотентность).

---

## 6. Невоспроизводимые утверждения отчётов

1. **`foundation-stage1-gate.md:28`** — «`Select-String tests/beads-adapter.test.mjs -Pattern 'EPERM'` → 0 совпадений». Факт: **3** совпадения (`:98`, `:129`, `:140`). Настоящий гейт (0 в выводе прогона) выполняется. См. MINOR-4.
2. **Утверждение брифа ревью, что `Select-String tests/storage/*.mjs -Pattern '\[1,\s*2,\s*3'` → 0** — фактически **1** совпадение, но в комментарии-запрете (`migrations-registry.test.mjs:8`); литерала в ассертах нет. Утверждение верно по смыслу и неверно буквально.
3. **`foundation-25-ci.md:37,52` и `foundation-27-ledger-sync.md:68`** — «`MYWORK_REQUIRE_BEADS=1 … → fail 1`». На `HEAD` та же команда даёт `72/0/0` (проверено дважды). Состояние снято правкой F-22 и перекрыто `foundation-stage1-gate.md:26`; в двух файлах нет пометки об этом. См. NIT-3.
4. **`foundation-19-migrations-required.md:17`** цитирует сообщение с `MYWORK_DATABASE_MIGRATIONS` как рабочий рецепт; такого символа нет. См. MINOR-1.
5. **Число «15 совпадений `openStore(` в тестах»** (план F-19 шаг 4) не сходится: фактически **57** в 9 файлах (37 в `tests/storage/*` + 20 в `tests/*`). Все 57 передают `migrations`; проверено сканом + 148 зелёными доменными тестами.
6. **«9 падений на `done` опровергнуто»** — цифра **7** подтверждена независимым пересчётом и совпадает с `01-MASTER-PLAN.md:316` (там ценз уже был исправлен: 7 на `done` + 2 в `failed` + 2 в backlog = 11). Но проверить историческую «9» **нечем**: `.work\tasks\board-export.json` — это ревизия 82 с **41 карточкой и нулём исполнений**, а живой леджер уже на ревизии 325. Слово «опровергнута» корректно только относительно `MASTER-PLAN`, а не относительно снимка; точная формулировка — «перекрыта более поздней ревизией леджера».

---

## 7. Что осталось непроверенным и почему

1. **Полный прогон `tests/**` (заявлено 741/741/0/0).** Исключён брифом ревью как дорогой (≈331 с у авторов). Проверены точечно: 29 storage + 148 доменных + 72 beads + 17 новых = 266 тестов, все зелёные; остальные ~475 не запускались.
2. **CI на GitHub.** Ни разу не исполнялся (и это не выдаётся за прогон: `foundation-stage1-gate.md` §5.1, `foundation-25-ci.md:62`). Соответственно не проверены: реальный `corepack pnpm install --frozen-lockfile`, поведение `--test-isolation=none` при параллельной записи в SQLite (риск P14), установка `@beads/bd@1.3.0` на раннере, job `profile`. Структуру workflow я проверил чтением файла, синхронность `pnpm-lock.yaml` с `package.json` — косвенно (ни один из 10 коммитов не трогал `package.json`/`pnpm-lock.yaml`, а импортер `packages/controller` в локфайле совпадает с манифестом).
3. **Гейт P (`verify-profile.mjs`).** Локально не прогонялся: `dsh` на этой машине перехвачен `dsh-guard` (`foundation-stage1-gate.md` §5.2). Как доказательство этапа 1 не зачитывается и авторами.
4. **Двухпроцессная гонка аллокатора.** Тесты однопроцессные; `UNIQUE(key)`+`UNIQUE(version)`+одна транзакция — аргумент по коду, а не наблюдение. Авторы пометили это сами (`foundation-stage1-gate.md` §5.5).
5. **`bd` вне Windows и на других версиях Beads.** Форма ответа `dep list --json` зафиксирована только для 1.3.0 на этой машине.
6. **Мутации гейтов F-20 и F-26.** Бюджет — ровно одна мутация, израсходован на F-19. Невакуумность F-20 обоснована структурно (см. §5); мутацию F-26 провёл автор, я её не повторял (`.work/tasks/INDEX.md` — gitignored-артефакт, но правило «не мутировать дерево» я соблюдал буквально).
7. **Этап 0, шаги этапов 2–5, живой профиль, карточки MW-*.** Вне границ ревью по брифу.

---

## 8. Итог по восьми проверяемым утверждениям

| № | Утверждение | Результат |
|---|---|---|
| 1 | F-19: отказ без `migrations` и **до** создания файла БД | **подтверждено** (+ mutation-check) |
| 2 | F-18/F-63: единый реестр, версии не литералами, аллокатор идемпотентен и не переиспользует номер | **подтверждено** с оговорками MINOR-1/MINOR-2 (литерал `[1,2,3,4,5,6]` встречается 1 раз — в комментарии) |
| 3 | F-20: journal verify ловит расхождение | **подтверждено** |
| 4 | F-13…F-17, F-21, F-22: `fail 0`, строгий режим `skipped 0`, EPERM 0, `process.execPath`, `BEADS_ACTOR` ≥2 | **подтверждено**; оговорка: «EPERM → 0» верно для вывода прогона, а не для grep по файлу (3) |
| 5 | F-23/F-24: `pack.mjs` ×2 → 0, 0 `.tgz`, нет `shell: process.platform` | **подтверждено** |
| 6 | F-26/F-27: `--check` → 0, `doneViolations = 7` из живого леджера rev 325; ценз 31 = 20 + 11, 7 на `done`, 4 вне | **подтверждено** независимым пересчётом |
| 7 | F-25: раздельные job'ы, два гейта, пиннинг, `--frozen-lockfile`; CI не запускался и не заявлен прогоном | **подтверждено** |
| 8 | Mutation-check гейта F-19 | **выполнен**: `fail 2` на мутации, `pass 29 / fail 0` после восстановления, дерево чистое |
