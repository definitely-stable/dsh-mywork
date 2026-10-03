# MW-019 — Подключить один внешний Memory adapter

- Статус: **DONE** — выставлен по прямому указанию владельца («после проведённого ревью и исправлений меняй карточку на готово и коммить»), а не по результату ревью. Основание приёмки: независимое ревью **PASS WITH FINDINGS** (1 MAJOR / 1 MINOR / 1 NIT, §10.1–10.2), все находки исправлены, и дельта-проход тем же ревьюером — **FIXES VERIFIED** (2 MINOR + 1 NIT в отчёте, тоже исправлены, §10.3). Приёмка как таковая остаётся за владельцем; evidence приёмки — эти два отчёта и прогоны ниже.
- Коммиты: base `23432bba0d13d6af244e9ae97d65823812bff2bb` → head `067bb5878c61d121b47c787e7a521046eee310b6` (4 коммита, §6.1); push/merge/publish/release не выполнялись.
- Карточка на доске: перемещение в `done` **выполнить из этой сессии невозможно** — доска отвечает `running task cannot be moved` (§6.3). Колонку выставляет Host по завершении сессии; ручной идемпотентный путь готов.
- Зависимость **MW-018** — `DONE` (независимое ревью **PASS WITH FINDINGS**, проверка исправлений **FIXES VERIFIED**, 5 коммитов); проверена по исходникам, отчёту и `git log`, а не по строке статуса (§1).
- Base SHA: `23432bba0d13d6af244e9ae97d65823812bff2bb` (ветка `main`, дерево на старте чистое). Коммита нет: отдельного поручения на него в карточке не было, поэтому отчёт несёт diff и base SHA.
- Реализовано: внешний `MemoryProviderPort`-бэкенд — **Beads** (`bd kv set/get/list`), `packages/beads-adapter/src/memory.ts`; §44-строка Cordis `memory-plugin.ts`; §39-conformance-набор для `memory` в `packages/adapter-sdk/src/conformance.ts`; 17 новых тестов, из них реальная проба против `bd` 1.3.0 не пропущена, а выполнена.
- Числа: `tsc` 12 пакетов — exit 0; `tsdown` 12 пакетов — exit 0; `smoke: all steps passed`; полный `node --test` — **659 tests / 636 pass / 0 fail / 23 skipped** (до карточки 642/619/0/23; новая сюита даёт 17 тестов, 0 skipped); 9 мутаций — все убиты.

---

## 1. Проверка зависимости MW-018

| Что проверено | Чем | Вердикт |
|---|---|---|
| Отчёт | `.work/reports/MW-018-native-memory.md` — статус **DONE**, независимое ревью **PASS WITH FINDINGS** (2 MAJOR / 7 MINOR / 3 NIT), проверка исправлений **FIXES VERIFIED**, дельта-находки исправлены | пройдено |
| Исходники на месте | `packages/contracts/src/memory.ts` (1403 строки), `packages/core/src/memory.ts` (1676), `packages/memory-native/src/{index,native,disabled}.ts`, `tests/memory.test.mjs` | пройдено |
| Контракт порта | `MemoryProviderPort` (`capabilities`/`retain`/`recall`/`reflect?`/`resolve?`/`health`) — `contracts/src/memory.ts:1061`; `MemoryCapabilities {reflect, resolve, scopeTypes, kinds}` — `:892`; `MemoryWriteMode` — `:937`; `MemoryRecord` — `:479` | пройдено |
| §44-реестр | `MYWORK_ADAPTERS_SERVICE` публикуется контроллером; `commonAdapterChecks` уже в SDK; `REQUIRED_CONFORMANCE_CHECKS.memory` — 9 имён (`adapter-sdk/src/conformance.ts:58`) | пройдено |
| Git | `git log --oneline -6`: `23432bb chore(workspace)`, `1c1f091 test(memory)`, `43e84e9`, `133b59d`, `56c5265`, `9163bb5`; `git status --short --untracked-files=all` на старте пуст; `HEAD` совпадает с head из отчёта MW-018 | пройдено |

**Наследованное обязательство, названное MW-018 явно** (§8.3 отчёта): «идентификаторы записей минтит фабрика со счётчиком на экземпляр, поэтому провайдер, переживающий процесс, нуждается в собственном источнике id — это работа карточки, которая его связывает». Это ровно MW-019, и оно выполнено (§3.3).

---

## 2. Живая проба Beads: контракт, а не предположение

Всё ниже — наблюдения на **`bd version 1.3.0 (f45b249ce)`**, в изолированном workspace, созданном **вне дерева репозитория** (`$env:TEMP\mw019-beads-probe`). Внутри репозитория изолировать нельзя: `bd init` в `.tmp/mw019-probe` ответил `Found existing Dolt database: H:\Repo\DSH-MyWork\.beads\embeddeddolt\mw` и вышел с кодом 1 — `bd` резолвит workspace родителя.

| Проба | Наблюдение |
|---|---|
| `bd --help` | есть `remember`, `recall`, `memories`, `forget`, `kv` (`set/get/list/clear`) |
| `bd memories --json` (пусто) | exit 0, `{"schema_version": 1}` — **без массива** |
| `bd remember "<c>" --key K --json` | exit 0, `{"action":"remembered","key":K,"schema_version":1,"value":…}` |
| повтор `bd remember` тем же ключом | exit 0, `{"action":"updated",…}` — перезапись на месте |
| `bd recall <missing> --json` | **exit 1**, `{"found":false,"key":…,"schema_version":1,"value":""}` |
| `bd forget <missing>` | **exit 1**, `No memory with key "<k>"` в stderr |
| `bd kv set K V --json` (новый и существующий ключ) | exit 0, `{"key":K,"schema_version":1,"value":V}` — **сигнала created/updated нет** |
| `bd kv get <missing> --json` | **exit 1**, `{"found":false,…}` |
| `bd kv list --json` | exit 0, **плоская карта**: kv-ключи + записи `remember` под префиксом `memory.` + `schema_version` |
| `bd kv list --json` (пусто) | exit 0, `{"schema_version": 1}` |
| `bd kv set memory.sneaky v` | **exit 1**, `{"error":"invalid key: key cannot start with \"memory.\" (reserved for persistent memories; …)"}` |
| `bd kv set` при `--readonly` | **exit 1**, `operation 'kv set' is not allowed in read-only mode` |
| `bd history <memory-key>` | exit 0, `No history found` — истории у памяти нет |
| `bd sql "show tables"` | exit 1, `'bd sql' is not yet supported in embedded mode` |
| `bd batch --help` | транзакция только над issue-операциями (`close`/`update`/`create`/`dep`) — ни `kv`, ни `remember` |
| `bd prime` | печатает `## Persistent Memories (N)` и **перечисляет значения всех `remember`-записей**; kv-значения туда не попадают |
| 4 параллельных `bd kv set` | все exit 0, ошибок блокировки нет |
| `bd ping` | exit 0, внутренние 22 мс, но 812 мс wall-clock (процесс + embedded Dolt) |
| без workspace, `bd memories --json` из каталога без `.beads` | exit 1, `no beads database found`; `.beads` при этом **не создаётся** |
| без workspace, `bd where` | exit 1, `No active beads workspace found.` — **другое сообщение**, и это не придирка: первое принадлежит случаю «`.beads` есть, базы в нём нет», второе — «workspace не найден вообще» (нашёл ревьюер в дельта-проходе) |
| `C:\Users\Dmitry\.beads` | существует, содержит только `machine-id` и `eventsData`; `metadata.json` нет — это состояние машины, а не workspace |

---

## 3. Решение: какое хранилище Beads несёт внешнюю память

### 3.1 Требование

`MemoryProviderPort` (§23.8) обязан вернуть **целую** `MemoryRecord` (§23.5): `statement`, `scope`, `kind`, `sources`, `createdBy`, `trust`, `confidence?`, `validity`, `supersedes`, `status`, §35-`revision`, `contentHash`, `fingerprint`, `retainedAt`, `statusChangedAt`, `reinforcedCount`. Beads хранит одну непрозрачную строку на ключ: ни скоупа, ни вида, ни статуса, ни ревизии. Значит, запись едет в значении, а идентичность — в ключе, **в любом** из двух хранилищ.

### 3.2 Разбор

| Свойство | `bd remember/recall/memories/forget` | `bd kv set/get/list/clear` |
|---|---|---|
| круговой рейс непрозрачного значения | да | да |
| произвольный набор символов в ключе | да (проверено: верхний регистр, пробел, `/`, `:`, `.`, юникод) | да (та же БД) |
| форма листинга | `{"<key>": "<value>", "schema_version": 1}` | то же; `remember`-записи видны как `memory.<key>` |
| форма пустого листинга | `{"schema_version": 1}` | `{"schema_version": 1}` |
| форма `get` | `{found, key, value, schema_version}`, exit 1 при отсутствии | идентично |
| **сигнал записи** | **`action: "remembered" \| "updated"` в том же вызове** | **нет** — одинаковый ответ на создание и на перезапись |
| удаление | `forget` (exit 1 при отсутствии) | `clear` (**exit 0 даже для несуществующего ключа** — сообщает `Cleared <key>`, которого не было) |
| транзакция на несколько записей | нет (`bd batch` только по issue) | нет |
| серверный фильтр | `memories <s>` — подстрока без учёта регистра по **ключу ИЛИ значению** | нет |
| **попадает в `bd prime`** | **ДА** — раздел `## Persistent Memories (N)` | **нет** |

**Решающий довод.** `bd prime` — это канал, которым в инструкции агент-сессии попадают «project memories and session rules»; проба показывает, что он перечисляет значения дословно. Если писать `MemoryRecord` туда, каждая запись MyWork окажется в инструкциях **каждой** сессии этого workspace, и это:

- обходит гейт жизненного цикла §23.4 — `candidate` (извлечён, но **ещё не валидирован**) и `invalidated`/`superseded`/`archived` инжектятся наравне с `active`;
- обходит гейт доверия §23.6 — §21.4 отдаёт `medium`/`low`-память как данные, а `prime` отдаёт её как инструкцию;
- обходит изоляцию скоупа §23.2/§52 — запись, привязанная к роли, агенту, задаче или другому workspace, попадает в любую сессию;
- несёт машинный JSON, а не утверждение, потому что круговой рейс требует самой записи.

Это не вкусовщина: это адаптер, ломающий инварианты фабрики в канале, которым фабрика не владеет. Та же мысль выражена требованием карточки «Не имитировать unsupported reflect» — не выдавать состояние, которого порт честно не производит.

**Цена выбора `kv`, названная прямо:**

1. `bd kv set` не сообщает, существовал ли ключ, поэтому `created` в `MemoryProviderRetainOutcome` выводится из предшествующего `bd kv get` — **две** инвокации на запись. Остаточная гонка: два параллельных `retain` одной новой записи могут оба сообщить `created: true`. Замечание: `write()` фабрики (`core/src/memory.ts:408-413`) читает только `outcome.value.record` и `created` не использует, так что сегодня это верность контракту, а не зависимость поведения — но conformance-набор `created` проверяет, и адаптер, который бы его выдумал, лгал бы.
2. Отступление от буквы MW-001. Но MW-001 сам помечал пробу Beads как **BLOCKED (live probe only)**, а его собственный вывод (§335) читается «подтвердить память Beads … **или назвать другой backend**». Бэкенд не изменился: тот же `bd`, тот же `.beads`, тот же embedded Dolt, та же версия 1.3.0. Изменился канал внутри бэкенда — по результату подтверждения API, которое и было условием выбора («beads — предпочтительный кандидат **при подтверждении API**»).

**Отклонённый вариант «оба хранилища»:** две записи на `retain`, транзакции нет (`bd batch` покрывает только issue), поэтому человекочитаемое зеркало и машинная запись расходятся, а сверка — это новое scaffolding, которого не просит ни одна карточка; плюс зеркало сохраняет обход §23.4/§23.6. Хуже по обеим осям.

### 3.3 Итог

**`bd kv`**, адаптер `@dsh-mywork/beads-adapter` (id `beads`, provider `beads`), ключ `mywork.memory.<id>`, значение — конверт `{schema: 1, record}`. `bd remember` для записей MyWork **не используется**, и причина записана в docstring модуля. `memory.` — зарезервированный префикс Beads, поэтому пространства имён не пересекаются **на уровне бэкенда** (проба выше).

---

## 4. Сделано

### 4.1 `packages/beads-adapter/src/memory.ts` (новый, 815 строк)

- `createBeadsMemoryProvider(options)` — `MemoryProviderPort` поверх `bd kv`:
  - **`retain`** (`create`/`reinforce`/`replace`): читает ключ, затем пишет. Отсутствует и `replace` → отказ `TASK_CONFLICT` (замена того, чего нет, выдумала бы историю записи); содержимое под существующим id изменилось → `TASK_CONFLICT` (§23.4 «Supersede» — это новая запись, называющая старую); тот же контент при `create` → `created:false` без записи (идемпотентный повтор, у которого потерялся ответ).
  - **`recall`**: один `bd kv list --json`, декодирование конвертов, фильтр по `memoryScopeWithin` — **правилом самого контракта** (§23.2, включая видимость вложенного скоупа родителю), затем по видам, затем `limit`.
  - **`resolve`**: `bd kv get` по ключу, выведенному из id; отсутствие → `TASK_CONFLICT` (то есть `invalid-ref`), **не** `ADAPTER_UNAVAILABLE` — чтобы опечатка не стала вечным retry (правило N2/R-1 из MW-018).
  - **`capabilities`**: `reflect: false` (у Beads нет операции рефлексии; дайджест здесь был бы дайджестом адаптера, а не бэкенда), `resolve: true`, `scopeTypes` = все семь §23.2, `kinds` = девять §23.3.
  - **`reflect` не реализован** — метода нет; фабрика отказывает `reflect-unsupported`/`CAPABILITY_UNSUPPORTED`.
  - **`health`**: проверка предусловия **без спавна процесса** (фабрика спрашивает доступность перед каждым вызовом, а `bd ping` стоит 812 мс — дороже вызова, который он охраняет). Отсутствие workspace → `available:false, reason:'no-workspace'`.
  - **`diagnostics()`** (§57): `bd --version` и `bd ping` по требованию, с версией, связностью, §37-возможностями и дедлайном; не бросает, а сообщает.
  - **`records()`**: read-only вид вне порта, как у native-провайдера.
  - Дедлайн — **собственный** таймер провайдера поверх раннера: раннер, который никогда не отвечает, не может подвесить вызов фабрики.
  - Отказы: `CONTRACT_MISMATCH` для чужой `schema_version` бэкенда, для значения под нашим префиксом, которое не читается, и для конверта, называющего чужую запись; `ADAPTER_UNAVAILABLE` для спавна, ненулевого кода и дедлайна; `TASK_CONFLICT` для конфликтов идентичности и отсутствующей ссылки.
- `createBeadsMemoryIdSource(options)` — источник id для хранилища, переживающего процесс: читает последовательность `mem-beads-<n>`, которую workspace уже держит, и продолжает её (см. §1, обязательство MW-018 §8.3).
- `findBeadsDir`, `parseBdVersion`, `highestSequenceOf`, `BEADS_MEMORY_MANIFEST` (§37: `retain/recall/resolve: true`, `reflect: false`, `structuredScopes: false`, `versioning: false`).

### 4.2 `packages/beads-adapter/src/memory-plugin.ts` (новый, 147 строк)

Отдельная §44-строка Cordis (`@dsh-mywork/beads-adapter/memory`), по образцу принятой строки taskgraph: резолвит конфигурацию, строит раннер и провайдера, регистрирует объявление в `myworkAdapters`, снимает регистрацию эффектом фибры. Отдельная — чтобы профиль мог смонтировать память без task graph, и чтобы правка здесь не могла изменить то, что регистрирует принятая строка. Workspace не создаёт и не чинит: отсутствие workspace — не отказ монтирования, а `health().reason='no-workspace'` и `ADAPTER_UNAVAILABLE` на операциях.

### 4.3 `packages/adapter-sdk/src/conformance.ts` — §39-набор для `memory`

`memoryChecks(options)` — девять проверок §39 **дословными именами**: `retain`, `recall`, `scope isolation`, `idempotency`, `timeouts`, `cancellation`, `invalid ref`, `backend unavailable`, `version mismatch`. Docstring модуля обновлён: набор для `memory` больше не «приедет с карточкой, связывающей порт».

Проверки, которым нужен бэкенд, которого набор не может построить, получают фабрику (`unresponsive`/`unavailable`/`mismatched`); без неё проверка объявляет себя `skipped` с причиной, а не проходит на неиспытанном свойстве. Три проверки требуют **отказа** и требуют именно тот код, который читает фабрика: неизвестная ссылка — `TASK_CONFLICT` (никогда `ADAPTER_UNAVAILABLE`), недоступный бэкенд — `ADAPTER_UNAVAILABLE`, чужая ревизия — `CONTRACT_MISMATCH`. Код читается **структурно** (`error.code` из словаря §42), потому что `isAdapterRefusal` называет класс самого SDK, которым провайдер не является.

`scope isolation` проверяет обе половины §23.2: чужой скоуп не виден, а запись во **вложенном** скоупе видна тому, кто назвал родителя. `timeouts` измеряет реальный wall-clock (дедлайн — таймер адаптера, инъецируемые часы его не наблюдают) и допускает запас на убийство процесса. `cancellation` формулирует то, что порт вообще может обещать: у него нет `AbortSignal`, поэтому проверяется связность после брошенного вызова — запись есть целиком или её нет, дублей нет, провайдер отвечает снова.

### 4.4 `packages/core/src/memory.ts` (+32 строки, аддитивно)

`MemoryFabricOptions.nextId?: () => string | Promise<string>` — источник идентификаторов для развёртывания с долговечным провайдером. Дефолт не изменился: `mem-<instance>-<n>`. Причина в docstring: этот id уникален внутри процесса и **повторяется после рестарта**, что незаметно для провайдера, теряющего store вместе с процессом, и фатально для того, кто его сохраняет. Это файл, принятый в MW-018; правка аддитивна, обоснована §8.3 его же отчёта и покрыта тестом на реальном `bd` (§7, строка «Долговечность»).

### 4.5 `tests/memory-beads.test.mjs` (новый, 1005 строк, 17 тестов) и `tests/lib/mw019-restart-child.mjs` (новый, 88 строк)

Три слоя: §39-набор против скриптового `bd`, воспроизводящего **проверенные** полезные нагрузки; политика (честность возможностей, пространство имён ключей, источник id, маршрутизация writer через настоящую фабрику, эквивалентность правила записи с native); и **реальный `bd`** в workspace вне репозитория — тот слой, который не даёт скриптовому разойтись с бинарём. Реальный `bd` достижим из `node --test` через `scripts/lib/process.mjs` `runCaptured` с file-backed stdio (piped spawn здесь даёт `spawn EPERM`), поэтому слой **выполняется**, а не пропускается: 0 skipped в сюите.

### 4.6 Прочие правки

`packages/beads-adapter/src/index.ts` (+20), `tsdown.config.ts` (третий entry `memory-plugin`), `package.json` (subpath `./memory-plugin`, описание), `packages/adapter-sdk/src/index.ts` (+2 экспорта).

---

## 5. Изменённые и новые файлы

| Путь | Состояние | Строк | SHA-256 |
|---|---|---|---|
| `packages/beads-adapter/src/memory.ts` | новый | 815 | `7CDECCC426625335D80BE44EEB2B9EC4370D4351FEF44DDCBE43C4FF0E827D4C` |
| `packages/beads-adapter/src/memory-plugin.ts` | новый | 147 | `3F3E2E21A45D450AE1205514C0A32DF60411898701B46385809017ED5231A8B7` |
| `packages/adapter-sdk/src/conformance.ts` | изменён (+449) | 1063 | `10DA0D897C5A7DB71EE968C8A9DC835A4AA27EAA13E9AF2F7BC2F908854B462B` |
| `packages/core/src/memory.ts` | изменён (+32) | 1698 | `F0725AB68C068B801C07A0B73244A802E0E8910C72DFD79C88D099EEB443B946` |
| `packages/beads-adapter/src/index.ts` | изменён (+20) | 113 | `814AEDCBB9F7E3B0EBB6F41224148B355CA7106DDD49F70040F00BFC700E0FDF` |
| `packages/adapter-sdk/src/index.ts` | изменён (+2) | 74 | `FE86E636A0E206FCBA573DD742AEBD6693FA3143601954A8306CF46EC6C0CF87` |
| `packages/beads-adapter/tsdown.config.ts` | изменён | 25 | `308F48C332419C24BA0AE355DB579E8844A50E99C279AD61EB18B96A99F6FE52` |
| `packages/beads-adapter/package.json` | изменён | 37 | `1682A2442B6008155623C9AC5BE0C39104ECFB94020FF49135CFAD8F25E92D0E` |
| `tests/memory-beads.test.mjs` | новый | 1005 (17 тестов) | `0941C8BA2694E9109C1176E7FF48618418612DB8E461875D2CD520865C790FE8` |
| `tests/lib/mw019-restart-child.mjs` | новый | 88 | `FC56E2559EA57269D3FF232B424BCD8C9FEF5AEB57EEA566231C8D4238AB195A` |

SHA-256 приведены для **финального** состояния — после исправлений по находкам обоих проходов ревью (§10). `git diff --stat` по отслеживаемым: 6 файлов, +503 / −13. `packages/*/lib/` — артефакты сборки, gitignored (`.gitignore:14`), в diff не входят. Пробы и логи — в `.tmp/` (gitignored), отчёт — в `.work/` (gitignored).

Чужие файлы не изменялись. Проверено командами, а не утверждением: `git diff --quiet HEAD -- packages/memory-native` → 0, `-- packages/contracts` → 0, `-- pnpm-lock.yaml` → 0, `-- tests/lib/fixtures.mjs` → 0; `git diff --name-only` — ровно 6 путей выше, `git ls-files --others --exclude-standard` — ровно 4 новых. Также не тронуты `packages/evidence/**`, `packages/storage/**`, `packages/lease/**`, `packages/execution/**`, `packages/scheduler/**`, `packages/planner/**`, `packages/controller/**`, `scripts/**` и остальные тесты. Живой профиль DSH, доска разработки, `.beads` репозитория и чужие проекты не трогались (все пробы — в `$env:TEMP`).

---

## 6. Команды и exit codes

### 6.1 Коммиты

| Коммит | Сообщение | Файлы |
|---|---|---|
| `ce91b1d` | `feat(core)` | `packages/core/src/memory.ts` |
| `2601e4a` | `feat(beads-adapter)` | `packages/beads-adapter/src/{memory,memory-plugin,index}.ts`, `tsdown.config.ts`, `package.json` |
| `e86c14f` | `feat(adapter-sdk)` | `packages/adapter-sdk/src/{conformance,index}.ts` |
| `067bb58` | `test(memory-beads)` | `tests/memory-beads.test.mjs`, `tests/lib/mw019-restart-child.mjs` |

`git log 23432bb..HEAD --format='%h %(trailers:key=Cards,valueonly)'` → трейлер `Cards: MW-019.` во всех четырёх. `git status --short --untracked-files=all` после коммитов пуст.

### 6.3 Карточка на доске: попытка и её результат

Владелец поручил «меняй карточку на готово». Сделано через штатный action API доски по loopback (`.tmp/mw019-board-done.mjs`, идемпотентный `requestId`, файл леджера не трогался), и **доска отказала**:

| Команда | Exit | Наблюдение |
|---|---|---|
| `node .tmp/mw019-board-done.mjs` (dry run) | 0 | `before: revision=317 card="MW-019 · Подключить один внешний Memory adapter" status=running`; план — `move MW-019 -> done` |
| `node .tmp/mw019-board-done.mjs --apply` | 1 (исключение скрипта) | **HTTP 400** `{"ok":false,"error":"running task cannot be moved"}` |
| проба словаря действий (`{"kind":"__probe__"}`) | 0 | HTTP 400 `{"ok":false,"error":"invalid-action"}` — словарь не перечисляется, угадывать действия по живой доске я не стал |

**Почему это не недосмотр автора, а устройство доски.** Карточка в состоянии `running`, потому что её исполняет **эта** сессия; доска запрещает перемещать исполняемую карточку — иначе сессия объявляла бы завершённой саму себя. Состояние снимка это подтверждает: у исполнения `26605cd2-…` (sessionId `session-7c698ace-…`) есть `startedAt` и `initiatedBy: session-b871c570-…` (сессия, запустившая прогон из UI), но нет `endedAt`/`result`; у карточек в `done` исполнения несут `endedAt` и `result: "succeeded"`, у `failed` — `result: "failed"`. То есть исполнение и колонку выставляет **Host, когда сессия заканчивается**, а не сама сессия.

**Что это значит:** карточка снимется с `running` и встанет в колонку по результату этой сессии; отдельного действия от автора здесь не требуется, а ручной путь остаётся готовым и идемпотентным — `node .tmp/mw019-board-done.mjs --apply` после завершения сессии (повторный прогон ничего не сломает: `requestId` выведен из id карточки, а карточка в `done` просто пропускается). **Утверждать, что она окажется именно в `done`, я не стану:** MW-016 при закрытом отчёте лежит в `failed` — доска ставит колонку по результату исполнения, а не по содержанию работы.

### 6.4 Прогоны

| Команда | Exit | Наблюдение |
|---|---|---|
| `git status --short --untracked-files=all` / `git rev-parse HEAD` (старт) | 0 | дерево чистое, `23432bba0d13d6af244e9ae97d65823812bff2bb`, ветка `main` |
| `bd --version` | 0 | `bd version 1.3.0 (f45b249ce)` |
| пробы из §2 (серия инвокаций `bd` в `$env:TEMP\mw019-beads-probe`) | 0/1 | см. таблицу §2 |
| `bd init` в `.tmp/mw019-probe` | **1** | `Found existing Dolt database: H:\Repo\DSH-MyWork\.beads\embeddeddolt\mw` — изоляция внутри репозитория невозможна, пробы перенесены в `$env:TEMP` |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/<p>/tsconfig.json` (12 пакетов) | **0** ×12 | `tsc <p> = 0` для contracts, core, storage, evidence, lease, adapter-sdk, beads-adapter, planner, execution, scheduler, controller, memory-native (`.tmp/mw019-fullcheck.txt`) |
| `node ../../node_modules/tsdown/dist/run.mjs` в каждом пакете (12 пакетов) | **0** ×12 | `✔ Build complete` в каждом; `build <p> = 0` (тот же лог) |
| `node scripts/smoke.mjs` | **0** | `smoke: all steps passed` (12 шагов) |
| `node --test --test-isolation=none tests/memory-beads.test.mjs` | **0** | **17 tests / 17 pass / 0 fail / 0 skipped**, 89 с |
| `node --test --test-isolation=none "tests/**/*.test.mjs"` | **0** | **659 tests / 636 pass / 0 fail / 23 skipped**, 101 с (база 642/619/0/23 → +17 тестов, регрессий нет) |
| `pwsh -File .tmp\mw019-mutations.ps1` (9 мутаций, включая M9 по находке F2) | 0 (скрипт) | все 9 убиты адресным отказом, каждый бандл восстановлен и сверен по SHA-256 (§8) |
| повторный `node --test … tests/memory-beads.test.mjs` после мутаций | **0** | 17/17 — дерево после восстановления зелёное |
| `node .tmp\mw019-names-check.mjs` (имена §39 против испущенных набором) | **0** | `required(9)` и `emitted(9)` совпадают поэлементно, `missing: []`, `extra: []` — набор несёт ровно те имена, которые перечисляет §39, без парафразов |
| `.tmp\mw018-post-commit-test.log` (базовая точка до карточки) | — | **642 tests / 619 pass / 0 fail / 23 skipped**, mtime 2026-09-20 21:15:23 на том же `23432bb` — артефакт найден ревьюером в дельта-проходе; тем самым «до карточки было 642/619/0/23» перестало быть утверждением без источника |
| `node scripts/smoke.mjs` + полный `node --test` **на закоммиченном** `067bb58` | **0** | `smoke: all steps passed`, **659 / 636 / 0 / 23**; `git status --short --untracked-files=all` пуст (0 строк) — итоговое состояние дерева зелёное |
| `node .tmp\mw019-report-verify.mjs` (таблица SHA-256 отчёта против дерева) | **0** | `checked=10 mismatched=0` — все десять SHA-256 и все числа строк из §5 совпали с файлами |
| `git status --short --untracked-files=all` (финал) | 0 | только 10 путей карточки (§5) |

---

## 7. Приёмка карточки → чем доказано

| Требование карточки | Чем доказано (тесты `tests/memory-beads.test.mjs`) |
|---|---|
| **§39: scope isolation** | `each scope is written by its primary, and nowhere else` (через настоящую фабрику: запись workspace-скоупа лежит в Beads и её нет в native, и наоборот); `scope isolation` в наборе — чужой скоуп не виден **и** запись во вложенном скоупе видна родителю; `the provider round-trips a record through a real Beads workspace` (та же проверка на реальном `bd`); мутация M2 валит набор |
| **§39: idempotency** | `idempotency` в наборе (`created:true` → `created:false`, ровно одна запись, ответ второго вызова — та же удержанная запись); `a retention is two invocations, and a recall is one` — повторное предложение делает **ровно** `['kv get']`, то есть записи не было (единственное место, где это наблюдаемо: у порта нет счётчика записей); `the provider round-trips a record through a real Beads workspace` (повторный `retain` на реальном бэкенде); мутация M9 валит адресный тест |
| **§39: invalid ref** | `invalid ref` в наборе требует `TASK_CONFLICT`; `the provider round-trips…` — `resolve('mem-beads-absent')` на реальном `bd`; мутация M7 (замена кода на `ADAPTER_UNAVAILABLE`) валит набор |
| **§39: timeout/cancel** | `a backend that never answers is refused inside the deadline the adapter declares` (замер wall-clock: ≥200 мс и <2 с при дедлайне 250 мс; и отдельно — раннер, который не отвечает вовсе, тоже ограничен); `timeouts` в наборе; `cancellation` в наборе; `the provider round-trips…` — брошенная запись на реальном `bd` оставляет store связным |
| **§39: backend unavailable** | `an absent backend refuses, and never answers as an empty store` — `ADAPTER_UNAVAILABLE` и на порту, и через фабрику (`reason: 'provider-unavailable'`), **никогда** пустым успешным ответом; `health answers from the filesystem, without spawning the backend`; `backend unavailable` в наборе, в том числе на реальном `bd` из каталога без workspace |
| **§39: contract mismatch** | `a backend that answers in another schema is refused, never decoded by guesswork` (`schema_version: 2` → `CONTRACT_MISMATCH`; значение под нашим префиксом, которое не читается, → `CONTRACT_MISMATCH`; конверт, называющий чужую запись, → `CONTRACT_MISMATCH`); `version mismatch` в наборе, в том числе на реальном `bd` с посаженным чужим значением; мутация M1 валит тест |
| **Не имитировать unsupported reflect** | `the adapter declares reflect and versioning unsupported rather than emulating them` — `capabilities().reflect === false`, `provider.reflect === undefined`, манифест `reflect:false, versioning:false, structuredScopes:false`; фабрика отказывает `CAPABILITY_UNSUPPORTED` + `reflect-unsupported`; мутация M4 валит тест |
| **Не добавлять второй внешний backend ради списка** | Внешний бэкенд один — Beads (`bd`). Native-провайдер в тестах маршрутизации — уже принятый `@dsh-mywork/memory-native` (MW-018), не новый backend |
| **Маршрутизация writer (§23.9)** | `each scope is written by its primary, and nowhere else` — политика `workspace→beads`, `role→native`: записи легли ровно в свои хранилища, чтение идёт тем же маршрутом, скоуп без маршрута отказан `scope-unrouted`/`CONTRACT_MISMATCH` **без единой записи** |
| **Реальные retain/recall/versioning capabilities** | `versioning: false` в §37-манифесте (проба: `kv set` перезаписывает на месте, `bd history` — `No history found`); §57-отчёт `§57 diagnostics read the version and connectivity on demand` (версия 1.3.0, связность, возможности, дедлайн; недоступный бэкенд → `connectivity: 'failed'` без исключения) |
| **§44: подключение** | `the §44 row registers the memory adapter and removes it with its fiber` — `myworkAdapters.list('memory')` = `['beads']`, `resolve('memory', {capabilities:['retain','recall']})` успешен, `contractVersion: 'memory/v1'`, снятие фибры убирает регистрацию, кривая конфигурация валит монтирование `TypeError` |
| **Долговечность (обязательство MW-018 §8.3)** | `the default id source is why a durable provider needs its own` — три **отдельных процесса** на одном реальном workspace: первый пишет `mem-1-1`, второй (рестарт) минтит тот же id и **получает `TASK_CONFLICT`** вместо перезаписи, третий с источником пишет `mem-beads-1`; итог в store — `['mem-1-1','mem-beads-1']`. Плюс `the id source continues the sequence the workspace already holds` и мутация M6 |

---

## 8. Mutation-check (проверка, что тесты умеют падать)

`.tmp/mw019-mutations.ps1` — 9 мутаций в **собранном** бандле `packages/beads-adapter/lib/*.js`, каждая ломает одно утверждение, адресный тест обязан упасть; файл восстанавливается из бэкапа и сверяется по SHA-256.

| # | Мутация | Результат |
|---|---|---|
| M1 | снят гвард `schema_version` бэкенда | KILLED — `a backend that answers in another schema is refused…` |
| M2 | снят фильтр `memoryScopeWithin` в `recall` | KILLED — `the §39 memory suite covers every required check…` (падает `scope isolation`) |
| M3 | сравнение содержимого всегда истинно | KILLED — `the beads and native providers agree on which writes may replace a record` |
| M4 | `reflect: true` в возможностях и манифесте | KILLED — `the adapter declares reflect and versioning unsupported…` |
| M5 | маркер workspace ослаблен до «каталог `.beads` существует» | KILLED — `health answers from the filesystem, without spawning the backend` |
| M6 | источник id начинает последовательность заново | KILLED — `the id source continues the sequence the workspace already holds` |
| M7 | неизвестная ссылка сообщается как `ADAPTER_UNAVAILABLE` | KILLED — `the §39 memory suite covers every required check…` (падает `invalid ref`) |
| M8 | снят гвард зарезервированного префикса `memory.` | KILLED — `the key namespace stays out of the one Beads reserves` |
| M9 | идемпотентный путь `retain` переписывает запись заново | KILLED — `a retention is two invocations, and a recall is one` (находка F2 ревью; до исправления эта мутация **выживала**) |

Итог: `mutations: all 9 killed, every bundle restored`, exit 0. Первый прогон дал «все выжили» — это была ошибка **скрипта**: `--test-name-pattern` со пробелом разбивался на два аргумента, node не находил ни одного теста и выходил 0. Исправлено (шаблон одним quoted-аргументом) и добавлена проверка «шаблон не совпал ни с одним тестом → NO-OP, а не выживание». Это записано, потому что «зелёная мутация» здесь означала бы ровно то, против чего мутация и заведена.

---

## 9. Ограничения и что осталось непроверенным

1. **Независимое ревью проведено** (§10) — вердикт и находки там же. Приёмка карточки остаётся за владельцем: ни ревью, ни этот отчёт её не заменяют.
2. **Отступление от буквы MW-001** (`bd kv` вместо `bd remember/recall/memories/forget`) обосновано в §3.2 живой пробой. Это решение автора по прямому указанию владельца («нужен крупный и глубокий анализ, и на основе него примешь сам решение»), и оно подлежит оспариванию ревьюером.
3. **Запись доверяется коду возврата.** `retain` возвращает запись, которую записал, а не перечитанную: read-back стоил бы третьей инвокации `bd` (~1 с) на каждую запись. Круговой рейс проверяется отдельно (`recall`/`resolve`), но «запись легла ровно такой» после успешного `kv set` не перечитывается.
4. **Две инвокации на `retain`, одна на `recall`/`resolve`.** ~1 с на инвокацию в этом окружении. Провайдер не кэширует store: кэш пришлось бы согласовывать с каждым жизненным циклом, а единственный писатель — фабрика (§23.9).
5. **Изоляция скоупа обеспечивается адаптером, а не хранилищем.** У `bd kv` нет ACL на скоуп: запись несёт скоуп в значении, фильтр применяет адаптер правилом контракта. Тот, кто может писать в `.beads` (`bd kv set mywork.memory.…`), может положить запись в любой скоуп. Это ограничение общего хранилища, а не дефект адаптера, но оно названо.
6. **Пространство имён — соглашение, а не защита.** Значение под нашим префиксом, которое не читается, валит `recall` целиком (`CONTRACT_MISMATCH` с именем ключа) — выбран fail-closed, потому что молча пропущенная запись выглядела бы как никогда не ретайненная.
7. **`cancellation` в §39-наборе — то, что порт вообще может обещать.** У `MemoryProviderPort` нет `AbortSignal`; проверяется связность store после брошенного вызова, а не отмена как таковая. Это названо в коде набора.
8. **`timeouts` на реальном `bd` не проверяется** — реальный `bd` не «зависает», а фабрика «никогда не отвечающего» раннера — это уже тестовый двойник. В слое реального `bd` проверка честно сообщает себя `skipped`; её доказательство — скриптовый слой (§6).
9. **Источник id закрывает рестарт, но не гонку двух процессов.** Два процесса на одном workspace могут сминтить один id; провайдер откажет проигравшему (`TASK_CONFLICT`), а не даст перезаписать запись. Конкурентных писателей закрывает §23.9 (один primary writer на скоуп), а не этот источник — так и написано в его docstring.
10. **Правило сравнения содержимого продублировано** из `memory-native/src/native.ts` (провайдер не может зависеть от пакета другого провайдера — это была бы первая связь adapter→adapter в репозитории и новая запись в `tsconfig.base.json`). Дублирование удерживается тестом `the beads and native providers agree on which writes may replace a record` — общая матрица из **23** записей (по одному случаю на каждое из 19 полей, которые сравнивает правило), прогнанная через **оба** провайдера; ослабление правила в одном месте валит сюиту другого (мутация M3 и пять независимых мутаций ревьюера D2–D6). Остаточная слабость названа ревьюером: **одновременное** ослабление обеих копий дифференциальный тест не поймает.
11. **`health()` оптимистичен по построению.** Он отвечает по маркеру `.beads/metadata.json` и **не** проверяет, что база внутри работоспособна: нерабочая база даст `available: true`, а отказ всплывёт на первой же операции как `ADAPTER_UNAVAILABLE`. Это выбор, а не недосмотр — фабрика спрашивает доступность перед каждым вызовом, а `bd ping` стоит 812 мс, то есть дороже вызова, который он охраняет, — и он назван в коде (`memory.ts`, docstring `health`). Живая проверка связности вынесена в `diagnostics()` (§57).
12. **`recall` читает весь стор на каждый вызов** (`bd kv list` + фильтрация в памяти): у `bd kv` нет ни запроса по префиксу, ни серверного фильтра, пригодного для изоляции скоупа (подстрока ищется и по значению, поэтому как фильтр она небезопасна). На объёме памяти это станет узким местом; свойство названо, а не умолчано.
13. **Правка `packages/core/src/memory.ts`** — файл, принятый MW-018. Аддитивная опция `nextId` с неизменным дефолтом; обоснование — §8.3 отчёта MW-018. Ревьюер проверил именно аддитивность и подтвердил её (§10.3).
14. **`bd prime` не проверялся как канал.** Утверждение «записи `bd remember` попадают в инструкции сессии» подтверждено выводом `bd prime` в изолированном workspace (`## Persistent Memories (9)` со значениями), но не тем, что DSH действительно подмешивает этот вывод в промпт: конфигурация живого профиля не читалась и не менялась.
15. **`pnpm install`/`pnpm run check` в песочнице не выполняются** (то же ограничение, что зафиксировал MW-018 §4). Новый пакет не добавлялся, `pnpm-lock.yaml` не менялся; канонический `pnpm run check` владельцу стоит прогнать один раз на своей машине.
16. **README не обновлялся** — список пакетов в его разделе «Структура» уже отстаёт; дописывать в него одну строку значило бы закрепить расхождение (та же причина, что в MW-018 §8.17).
17. **Платных и живых LLM-проб не делалось** (запрещено карточкой); субагент запускался только как независимый ревьюер (§10), не как исполнитель.
18. **Доска разработки, живой профиль DSH, `.beads` репозитория и чужие проекты не изменялись.** Все пробы Beads — в `$env:TEMP`, временные workspace'ы удалены: те, что создавала сюита, — в `after()`; те, что создавали пробы, — вручную, с проверкой префикса и принадлежности `$env:TEMP` (§11).
19. **§57 покрыт не полностью, и это названо.** В `diagnostics()` есть `installed version`, `contract version`, `required capabilities`, `connectivity`, `workspace isolation` (через §23.2-правило адаптера) и `timeouts`; **`authentication` и `recovery` отсутствуют** — у локального `bd` нет аутентификации, а восстановление после сбоя делают §23.9-маршруты, а не адаптер. Находка ревьюера, принятая как прочтение, а не как дефект, и записанная здесь, чтобы владелец видел границу, а не обнаружил её сам.

---

## 10. Независимое ревью

Отдельный субагент со свежим контекстом, read-only, словарь `PASS` / `PASS WITH FINDINGS` / `FAIL`, scratch в `.tmp/mw019-review/`. Ему переданы: base SHA, перечень файлов под ревью, девять утверждений автора как **проверяемые**, разделы архитектуры с якорями, ожидаемые числа, ловушки окружения и явный список вне-scope. Не передавались: переписка, рассуждения автора, готовый текст этого отчёта. Отчёт ревьюера: `.tmp/mw019-review/MW-019-review.md` (23 833 байта, 145 строк).

### 10.1 Вердикт

**PASS WITH FINDINGS** — 1 MAJOR / 1 MINOR / 1 NIT. Все числа воспроизведены точно: `tsc` 12/12 exit 0, `tsdown` 12/12 exit 0 (в том числе новый `memory-plugin.js`), `smoke: all steps passed`, полный прогон **659 / 636 / 0 / 23**, сюита **17/17/0 skipped**, MW-018 `memory.test.mjs` **68/68** без регрессии. Ревьюер независимо подтвердил дельту +17 (`git diff --stat <base> -- tests/` пуст, в новом файле ровно 17 `test(`).

Ревьюер провёл **свои** живые пробы против реального `bd` 1.3.0 (в изолированных workspace'ах, вне репозитория) и **свои** 7 мутаций на бэкапе бандла; SHA-256 бандла до и после — совпал (`A5F78999540CCFB21EB68810D4FC38EB8703278097D3ADE5C64A7EE7AFBAE877`), дерево не менялось.

### 10.2 Находки и что сделано

| # | Severity | Находка | Что сделано |
|---|---|---|---|
| **F1** | **MAJOR** | `.work/reports/MW-019-external-memory.md` отсутствует, статус не объявлен — карточка требует отчёт как обязательный артефакт | **Закрыто артефактом, а не спором.** Отчёт создан `21:15:11`; первая проба ревьюера (`tsc.log`) — `21:13:58`, и каталог `.work/reports/` он в тот момент видел без файла, а позже не перечитывал. То есть находка была верна **на момент наблюдения** и перестала быть верной через 73 секунды. Процессный вывод на будущее: ревью запускалось до появления отчёта, поэтому отчёт в этом проходе **не ревьюировался** — его обязан покрыть дельта-проход (§10.3) |
| **F2** | MINOR | §39-чеки `idempotency` и `cancellation` не проверяют, что повторное предложение **не пишет**: мутация «идемпотентный путь переписывает запись» давала 17 pass / 0 fail. `expect(seen.records.length <= 1)` практически неопровержим | Исправлено в трёх местах: (1) `tests/memory-beads.test.mjs` — после первого `retain` счётчик вызовов очищается и та же запись удерживается второй раз, ожидается ровно `['kv get']` (лишний `kv set` = перезапись, которой никто не просил); (2) `conformance.ts` `idempotency` — ответ второго вызова сверяется с удержанной записью (`retainedAt`, `status`, `reinforcedCount`, `contentHash`, `fingerprint`), и в docstring прямо сказано, что «записи не было» **ненаблюдаемо через порт** (у него нет счётчика записей), поэтому доказывать это обязан набор самого адаптера; (3) `conformance.ts` `cancellation` — `<= 1` заменено на явное «0 или 1» с полным сравнением всех полей записи и добавленным `again.created === false`. **Доказательство:** мутация M9 (ровно мутация ревьюера) добавлена в `.tmp/mw019-mutations.ps1` и теперь **убита** — `✖ a retention is two invocations, and a recall is one` |
| **F3** | NIT | `sameContent` продублирован (тела побайтово идентичны); матрица не вакуумна, но поля вне неё (`confidence`, `createdBy.run`, `validity.*`, `supersedes`, `retainedAt`) держатся только дисциплиной | Матрица расширена с 8 до 23 случаев: добавлены `scope.id`, `scope.type`, `confidence`, `createdBy.run`, `createdBy.component`, `validity.from`, `validity.until`, `supersedes`, `retainedAt`, `sources[].uri`, `sources[].revision`, `sources[].type`, `kind`, `contentHash`, `fingerprint`. Каждое поле, которое сравнивает `sameContent`, теперь имеет случай, двигающий **только его**. Дублирование оставлено: вынос правила в `@dsh-mywork/contracts` потребовал бы правки двух файлов, принятых MW-018, ради выигрыша, который матрица уже даёт (M3 и M7 убиты) |

### 10.3 Дельта-проход (проверка исправлений и ревью отчёта)

Второй проход того же ревьюера, read-only, scratch `.tmp/mw019-review/`, файлы с суффиксом `delta`. Ему переданы: три находки с требованием **воспроизвести** исправление своей мутацией, а не поверить описанию, и отдельное требование прочитать отчёт как утверждение, подлежащее опровержению (в первом проходе отчёта ещё не было). Отчёт: `.tmp/mw019-review/MW-019-delta-verification.md` (147 строк).

**Вердикт: FIXES VERIFIED / REPORT WITH FINDINGS** — 2 MINOR (N1, N2) + 1 NIT (N3), ни одного BLOCKER/MAJOR.

| Находка | Статус | Доказательство ревьюера |
|---|---|---|
| F1 (MAJOR) | **VERIFIED** (артефакт) | `CreationTime` отчёта `21:15:11` против `21:13:58` у первого артефакта ревьюера — файл появился через 73 с после его взгляда на каталог |
| F2, «idempotency» | **VERIFIED** | Своя мутация **D1** (не скрипт автора): `await write(key, record)` перед идемпотентным `return` → exit 1, `expected ['kv get']`, `actual ['kv get','kv set']`; до правки та же мутация давала 17/0 |
| F2, конформансный чек | **VERIFIED** | **D7** (ответ перештампован, стор не тронут) → exit 1, `✖ …must answer with the record the provider holds, not a rewritten one` |
| F2, «cancellation» | **PARTIAL** | «0 или 1» логически эквивалентно `<= 1`, а добавленное сравнение полей недостижимо для этого адаптера (см. N1) |
| F3, матрица | **VERIFIED** | Обе копии `sameContent` побайтово идентичны, 19 сравниваемых листьев, 23 случая покрывают каждый; пять независимых мутаций D2 `confidence`, D3 `createdBy.run`, D4 `sources[].uri`, D5 `retainedAt`, D6 `sources[].revision` — каждая валит адресный тест; бандл восстановлен по хэшу |
| F3, обоснование дублирования | **VERIFIED** | Импорт из `memory-native` = первая связь adapter→adapter; вынос в `contracts` = правка принятого файла вне объёма карточки. Оговорка ревьюера: одновременного ослабления обеих копий дифференциальный тест не поймает |

Отчёт автора в этом проходе **проверен по существу**: все числа воспроизведены (`tsc` 12/12, `tsdown` 12/12, `smoke`, **659/636/0/23**, сюита **17/17/0 skipped**, 9 мутаций), **10/10 SHA-256 из §5 совпали**, совпали все числа строк, `git diff --stat` = 6 файлов +496/−13 и ровно 4 новых файла, `git diff --quiet` по `memory-native`/`contracts`/`pnpm-lock.yaml`/`fixtures` = 0. Живая проба §2 воспроизведена. Прежнее «невоспроизводимое» закрыто: у базовой точки 642/619/0/23 нашёлся артефакт (`.tmp/mw018-post-commit-test.log`, тот же `23432bb`, mtime 2026-09-20 21:15:23).

**Находки дельты и что сделано:**

- **N1 (MINOR)** — третий заявленный сайт правки F2 (`cancellation`) опровержимой силы не получил: сравнение полей недостижимо для этого адаптера, потому что `retain` читает перед записью, а `recall` его обгоняет. **Исправлено честной формулировкой, а не кодом:** в `conformance.ts` над ветвью сказано, что это **guard** для провайдера, чью запись можно наблюдать в полёте (бэкенд, собирающий запись из нескольких записей), и что для Beads-адаптера операционная проверка — «отсутствует или целиком»; в §10.2 и здесь формулировка приведена в соответствие. Замечание ревьюера принято и в обратную сторону: его прошлое предложение «`<= 1` → `=== 1`» было бы неверным, и автор правильно ему не последовал.
- **N2 (MINOR)** — три устаревших числа в отчёте («8 мутаций», «970 строк», «матрица из 8 записей»). **Исправлено**: 9, 1005, 23.
- **N3 (NIT)** — §9 не называл оптимистичность `health()` и чтение всего стора на `recall`. **Исправлено**: добавлены пункты 11 и 12 §9.

**Границы этого прохода, названные прямо:** N1–N3 закрыты автором и **третьим проходом не перепроверялись** — по правилу «останавливаться, когда проход не дал BLOCKER/MAJOR», а не потому, что они не требуют проверки. Изменение в `conformance.ts` (комментарий над ветвью) не меняет поведения: сюита после него перезапущена и зелёная (§6).

**Чего ни один проход не проверял:** `pnpm run check` целиком (pnpm в песочнице недоступен — четыре шага выполнены прямыми командами), `bd init` внутри дерева репозитория (не перезапускался, чтобы не трогать `.beads` репозитория), `bd` версий кроме 1.3.0, гонка двух процессов за один workspace, достижимость сравнения в `cancellation` для других адаптеров, `bd memories <подстрока>`.

---

## 11. Как воспроизвести

```powershell
# 1. типы и сборка (pnpm в песочнице недоступен — шаги вызываются напрямую)
foreach ($p in 'contracts','core','storage','evidence','lease','adapter-sdk','beads-adapter','planner','execution','scheduler','controller','memory-native') {
  node node_modules/typescript/bin/tsc --noEmit -p "packages/$p/tsconfig.json"
  Push-Location "packages/$p"; node ../../node_modules/tsdown/dist/run.mjs; Pop-Location
}
# 2. проверки
node scripts/smoke.mjs
node --test --test-isolation=none tests/memory-beads.test.mjs
node --test --test-isolation=none "tests/**/*.test.mjs"
# 3. доказательства карточки
pwsh -File .tmp\mw019-mutations.ps1
# 4. проба контракта Beads в изолированном workspace (вне репозитория!)
$p = Join-Path $env:TEMP 'mw019-probe'; New-Item -ItemType Directory -Force -Path $p | Out-Null
Set-Location $p; bd init --prefix=mw19 --skip-agents --skip-hooks
bd kv set k v --json; bd kv get k --json; bd kv list --json; bd kv set memory.x v --json
```

Временные каталоги, созданные пробами: `$env:TEMP\mw019-beads-probe`, `$env:TEMP\mw019-beads-probe2`, `$env:TEMP\mw019-beads-nows`, `.tmp\mw019-probe` — удалить после проверки; `.tmp\mw019-*` (логи, скрипты, бэкапы мутаций) — рабочий scratch, gitignored.
