# F-48 · Peer-контракт: `peerDependencies` в `controller` (и только он держит гейт)

- **Шаг плана:** `20-STEPS-foundation.md` F-48 (@1305). **Карточки:** MW-041, MW-060, P23. **Источник:** `evidence/lead-03-peer-gate.md`.
- **Ревизии:** база карточки `d0c97bf`; `HEAD` во время работы — `e28ff0b` (поверх базы два чужих коммита: `718a703`, `e28ff0b`); дерево грязное (чужие правки в `packages/controller/src/{app,budget-meter,telemetry,index,migration-allocator}.ts`, `packages/web/`, `packages/core/src/*`). Мои отслеживаемые изменения: `M packages/controller/package.json`, `?? tests/peer-gate.test.mjs`.
- **Изменённые файлы:** `packages/controller/package.json` (правка), `tests/peer-gate.test.mjs` (новый). `tests/boundaries.test.mjs` **не менялся** (см. §7.1).
- **Коммит шага:** `51d6fa4` — `feat(controller): declare the dsh peer that turns the compatibility gate on` (файлы: `packages/controller/package.json`, `tests/peer-gate.test.mjs`; 2 files changed, 142 insertions, 1 deletion). Evidence-файл в коммит не входит: `.work/` игнорируется git (`.gitignore:1`), `git add -- .work/…` → exit 1.

## 1. Diff манифеста (что именно сделано)

Команда: `git diff -- packages/controller/package.json` → exit 0:

```diff
@@ -27,8 +27,12 @@
     "build": "node --max-old-space-size=8192 ../../node_modules/tsdown/dist/run.mjs",
     "typecheck": "tsc --noEmit -p tsconfig.json"
   },
+  "engines": {
+    "node": "^22.19.0 || >=24.0.0"
+  },
   "peerDependencies": {
-    "@deepseek-ai/cordis": "^4.0.2"
+    "@deepseek-ai/cordis": "^4.0.2",
+    "@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.2.0"
   },
   "devDependencies": {
     "@deepseek-ai/cordis": "4.0.2",
```

Это дословный блок из `lead-03-peer-gate.md` §В (шаг 1 F-48). `devDependencies` не тронуты (шаг 1: peer в devDeps заставил бы `auto-install-peers` вытянуть CLI).

## 2. Гейт совместимости: что читает и что не читает

Файл `packages/boot/app-boot/src/plugin-compatibility.ts` прочитан целиком (103 строки). Импорты — только `node:fs`, `node:url`, `semver` (`:3-5`); слов `engines` и `peerDependenciesMeta` в файле нет. Ключевые строки: `:68` (нет ключа `peerDependencies` → `undefined`), `:71-75` (перебираются только `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`), `:76` (подстановка `workspace:*|^|~` на версию рантайма), `:77` (`semver.satisfies(runtime, range, { includePrerelease: true })`), `:81` (пустой набор несовместимых → `undefined`). Подробно — `foundation-47-ctx-services.md` §5.

## 3. Real-gate проба: гейт запущен на нашем манифесте

Команда: `node .tmp/f48-gate-probe.mjs` → **exit 0**. Проба импортирует **собранный** гейт платформы (`…/packages/boot/app-boot/lib/index.js`) и **её же** `semver` (7.8.5 из `packages/boot/app-boot/node_modules/semver`), читая манифест с диска:

```
manifest: packages/controller/package.json sha256=d2f9810a6ce54dd0
semver:   …/packages/boot/app-boot/node_modules/semver/index.js -> 7.8.5
declared: {"@deepseek-ai/cordis":"^4.0.2","@deepseek-ai/dsh":">=0.1.7-rc.2 <0.2.0"}
engines:  {"node":"^22.19.0 || >=24.0.0"}
peersMeta:null

gate @0.1.7-rc.2   -> undefined
gate @0.1.7        -> undefined
gate @0.1.8        -> undefined
gate @0.1.8-rc.1   -> undefined
gate @0.2.0-rc.1   -> undefined
gate @0.2.0        -> {"name":"@dsh-mywork/controller","version":"0.1.0","runtimeVersion":"0.2.0","peers":{"@deepseek-ai/dsh":">=0.1.7-rc.2 <0.2.0"},"exempted":false}
gate @default runtime -> undefined                                       ← версия рантайма из самого app-boot

control no-peerDependencies @0.2.0     -> undefined                      ← слепота: ключа нет
control no-peerDependencies @0.1.7-rc.2 -> undefined
control bad-range 999.0.0 @0.1.7-rc.2 -> {…,"peers":{"@deepseek-ai/dsh":"999.0.0"},"exempted":false}
control exemption @0.2.0 -> {…,"peers":{"@deepseek-ai/dsh":">=0.1.7-rc.2 <0.2.0"},"exempted":true}
```

Читается так: `undefined` на 0.1.7-rc.2 — это «диапазон удовлетворён», а не «поля нет»; контроль `no-peerDependencies` даёт `undefined` при 0.2.0 (гейт слеп), а контроль `999.0.0` — объект при текущем рантайме (гейт умеет отказывать на нашем манифесте). Это и есть шаг 5 F-48: объявив peer, MyWork **включил себе гейт** и падает громко.

## 4. Четыре исхода semver (шаг 4) — посчитаны, не «на глаз»

```
semver ">=0.1.7-rc.2 <0.2.0"  @0.1.7-rc.2 -> true    (выбранный диапазон)
semver ">=0.1.7-rc.2 <0.2.0"  @0.1.7      -> true
semver ">=0.1.7-rc.2 <0.2.0"  @0.1.8      -> true
semver ">=0.1.7-rc.2 <0.2.0"  @0.2.0      -> false
semver ">=0.1.7 <0.2.0"       @0.1.7-rc.2 -> false   (ловушка «руками написанный»)
semver "~0.1.7"               @0.1.7-rc.2 -> false
semver "^0.1.7"               @0.1.7-rc.2 -> false   ← ОПРОВЕРЖЕНИЕ lead-03/плана
semver "^0.1.7-rc.2"          @0.1.7-rc.2 -> true
semver ">=0.1.7-rc.2"         @0.1.7-rc.2 -> true
semver "*"                    @0.1.7-rc.2 -> true
```

Десугаринг (тот же semver, `validRange`):

```
">=0.1.7-rc.2 <0.2.0" -> >=0.1.7-rc.2 <0.2.0
"~0.1.7"              -> >=0.1.7 <0.2.0-0     ← 0.1.7-rc.2 НЕ подходит
"^0.1.7"              -> >=0.1.7 <0.2.0-0     ← 0.1.7-rc.2 НЕ подходит
"^0.1.7-rc.2"         -> >=0.1.7-rc.2 <0.2.0-0
```

**Опровергнуто утверждение `lead-03-peer-gate.md` п. 6 / «Опровержения» п. 1 и F-48 «Проверенные факты» п. 6:** «`^0.1.7` (десугар `>=0.1.7-0 <0.2.0-0`) ⇒ true». Настоящий десугар — `>=0.1.7 <0.2.0-0` (нижняя граница **без** `-0`), и `0.1.7-rc.2` его не удовлетворяет: `false`. То есть `^0.1.7` — не «проходит», а **отключает плагин на текущем рантайме**; в списке ловушек он стоит рядом с `~0.1.7`. Выбранный `>=0.1.7-rc.2 <0.2.0` остаётся правильным.

## 5. Решение по `peerDependenciesMeta`: **не добавлять** — и почему (измерено)

Hazard из карточки требовал решить и записать. Измерено тремя прогонами `pnpm install --lockfile-only --offline` через `scripts/lib/process.mjs` (ветка `corepack`, без сети, `--lockfile-only` не трогает `node_modules`), каждый раз с копией локфайла в `.tmp/`:

| Состояние манифеста | Команда | Exit | Наблюдение |
|---|---|---|---|
| peer без meta | `install --lockfile-only --offline` | 1 | `Failed to resolve @deepseek-ai/dsh@>=0.1.7-rc.2 <0.2.0 in package mirror …` |
| peer **с** `peerDependenciesMeta.optional: true` | то же | 1 | **тот же отказ**, побайтово тот же лог |
| peer + meta | `install --frozen-lockfile --offline` | 1 | `ERR_PNPM_OUTDATED_LOCKFILE`: `in importers["packages/controller"]: 1 dependency was added: @deepseek-ai/dsh@>=0.1.7-rc.2 <0.2.0` |
| peer + meta | `install --lockfile-only --offline --config.auto-install-peers=false` | 1 | тот же `Failed to resolve` |
| peer + meta | `npm_config_auto_install_peers=false` + те же две команды | 1 / 1 | без изменений |

Вывод: `peerDependenciesMeta.optional` в pnpm 12.4.2 **ничего не меняет** — ни резолв, ни frozen-проверку, ни локфайл (во всех прогонах `pnpm-lock.yaml` остался побайтово неизменным: `29544` байта до и после, `git diff --stat -- pnpm-lock.yaml` пуст). Поле, которое никто не читает (гейт — `plugin-compatibility.ts:68,75`; pnpm — измерено), в контракт не добавляется: это тот же класс, что `dsh.engines.dsh`, который план понизил до документации. Если владелец решит иначе — это одна строка, механического эффекта она не имеет.

## 6. Последствие для `pnpm-lock.yaml` — измерено, решение вне моего write-scope

Hazard карточки предполагал, что «`pnpm-lock.yaml` importers не записывают workspace-peerDependencies, поэтому локфайл остаётся валидным». **Это неверно для pnpm 12.4.2:** неудовлетворённый peer становится зависимостью импортёра, и frozen-установка падает:

```
$ pnpm install --frozen-lockfile --offline
Error: ERR_PNPM_OUTDATED_LOCKFILE
  × installing dependencies
  ╰─▶ Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with package.json.
        Failure reason:
        specifiers in the lockfile don't match specifiers in package.json:
      * in importers["packages/controller"]:
      * 1 dependency was added: @deepseek-ai/dsh@>=0.1.7-rc.2 <0.2.0
```

Офлайн локфайл не регенерируется (см. §5: метаданных `@deepseek-ai/dsh` нет в `C:\Users\Dmitry\AppData\Local\pnpm-cache\v11\metadata\…`). Изолированный эксперимент (`.tmp/f48-ws/`, две копии дерева манифестов, реальный репозиторий не тронут) показал единственный найденный выход:

| Дерево | `install --frozen-lockfile --offline` | `install --lockfile-only --offline` |
|---|---|---|
| как в репозитории (`autoInstallPeers` по умолчанию = true) | exit 1, `ERR_PNPM_OUTDATED_LOCKFILE` | exit 1, `Failed to resolve @deepseek-ai/dsh…` |
| + `autoInstallPeers: false` в `pnpm-workspace.yaml` | exit 1, `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` (в локфайле записано `settings.autoInstallPeers: true`) | **exit 0** — локфайл перегенерирован офлайн, peer не резолвится |
| то же, повторный frozen после регенерации | **exit 0** | — |

Дельта регенерированного локфайла к текущему — ровно **3 строки**: `settings.autoInstallPeers: true` → `false` и новый пустой импортёр `packages/web: {}` (пакет чужой сессии, F-58).

Почему это не блокирует F-48: доставка идёт не через `pnpm install` этого монорепо, а через tarball + профиль DSH, а **DSH сам пишет `autoInstallPeers: false`** в профиль: `packages/boot/app-boot/src/profile.ts:233`, `apps/desktop/src/project-manager.ts:33` (`WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'`), `apps/cli/tests/plugin-compatibility.expected.e2e.ts:22`. Прецедент подтверждён прогоном `verify:profile` (§8) — установка tarball'а в изолированный профиль прошла.

**Предлагаемая правка (вне моего write-scope: `pnpm-workspace.yaml` не входит в scopes карточки):** добавить `autoInstallPeers: false` в `pnpm-workspace.yaml` и перегенерировать `pnpm-lock.yaml` (`pnpm install --lockfile-only`, офлайн достаточно). Я **не** трогал ни `pnpm-workspace.yaml`, ни `pnpm-lock.yaml`; решение за Lead/владельцем. Импортёр `packages/web: {}` — зона F-58.

## 7. Тесты шага (шаг 4 падающего теста + шаг 5)

- До правки: `node --test --test-isolation=none tests/peer-gate.test.mjs` → **exit 1**, `Could not find 'tests/peer-gate.test.mjs'` (красное состояние, файла не было).
- После: `node --test --test-isolation=none tests/peer-gate.test.mjs tests/publish-manifest.test.mjs` → **exit 0**, `ℹ tests 9  ℹ pass 9  ℹ fail 0` (оба файла; F-49-тест в том же прогоне).

Что именно пинует `tests/peer-gate.test.mjs` (5 тестов): точный диапазон `>=0.1.7-rc.2 <0.2.0` и сохранённый peer `@deepseek-ai/cordis ^4.0.2`; `engines.node = ^22.19.0 || >=24.0.0`; диапазон не обнуляем (`*`, `workspace:*`, пустой); ни один манифест не тянет `@deepseek-ai/dsh` в `dependencies`/`devDependencies`/`optionalDependencies`; зеркало субъекта гейта (`:68`, `:75`, `:81`) показывает ровно один проверяемый peer — у controller. Семантика semver в тест не зашита (модуль `semver` не резолвится из этого воркспейса: `Test-Path node_modules\semver` → `False`, `await import('semver')` → `ERR_MODULE_NOT_FOUND`); она доказана пробой §3–§4 против гейта платформы. Это **отступление от буквы шага 4** («тест проверяет диапазон через semver») — санкционировано hazard'ом карточки и записано здесь.

Мутационная проверка (`.tmp/f48-mutations.ps1`, восстановление по SHA-256):

| Мутация манифеста | Exit | pass/fail | Что поймало |
|---|---|---|---|
| M1 `>=0.1.7-rc.2 <0.2.0` → `*` | 1 | 2 / 3 | пин диапазона; «нельзя обнулить»; носитель контракта |
| M2 удалить peer `@deepseek-ai/dsh` | 1 | 2 / 3 | те же три |
| M3 добавить `@deepseek-ai/dsh` в `devDependencies` | 1 | 4 / 1 | запрет на devDeps |
| M4 убрать `cordis.patch.yml` из `files` | 1 | 2 / 2 | патч внутри `files`; allowlist controller (F-49-тест) |
| M5 `private: true` → `false` | 1 | 2 / 2 | правило D18; приватность controller (F-49-тест) |
| восстановление | 0 | 9 / 0 | `sha256=D2F9810A6CE54DD0` = исходный до и после |

## 8. `verify:profile` (шаг 6 F-48)

Команда: `node scripts/verify-profile.mjs --dsh-bin 'C:\Reposit\deepseek-harness\deepseek-harness\apps\cli\lib\bin.js'` → **exit 0**:

```
ok   packed H:\Repo\DSH-MyWork\.tmp\verify-profile\pack\dsh-mywork-controller-0.1.0.tgz
ok   created isolated profile mywork-verify from the sdk-minimal template
ok   dsh plugin add installed the packed bundle
ok   profile bundles reconciled: ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller"]
ok   composed profile contains the controller layer, row, and overlay config
ok   profile boot mounted and unloaded the controller
     dsh-mywork: controller mounted service=myworkController version=0.1.0 contexts=control
     dsh-mywork: controller stopped service=myworkController version=0.1.0 uptimeMs=661
ok   user profile untouched (3 fingerprint(s) unchanged)
verify:profile: PASS
```

То есть tarball с новым peer'ом **ставится и монтируется** на рантайме `0.1.7-rc.2`, а живой профиль `C:\Users\Dmitry\.dsh` не тронут (3 fingerprint'а совпали).

## 9. Расхождения с планом (план-дефекты)

1. **F-48 «Файлы»: `Modify tests/boundaries.test.mjs:186-199` — правка не нужна.** В текущем дереве эти строки — тесты импортов `contracts`/`core`, к контроллеру отношения не имеют; проверка бандла `controller/lib/index.js` живёт в `tests/boundaries.test.mjs:251-279`, а `peer`/`engines`/`private` в этом файле не проверяются вообще (grep по `tests/**` на `peerDependencies|engines|"private"` → 0 совпадений). Дрейф номеров строк. **Предлагаемая правка Lead'у: никакой.** Прогон `node --test --test-isolation=none tests/boundaries.test.mjs` → **exit 1** ещё до загрузки тестов: `Error: domain tests: missing build output: packages/beads-adapter/lib/index.js; run "pnpm run build" first` (`tests/lib/fixtures.mjs:33`) — окружение сборки, не следствие F-48.
2. **Счёт «12» в F-60 шаг 5 и «остальные 11» в F-48 шаг 3 устарели:** в дереве появился 13-й пакет `packages/web` (`@dsh-mywork/web`, F-58) и он тоже объявляет peer `@deepseek-ai/dsh: >=0.1.7-rc.2 <0.2.0` (`packages/web/package.json:38`). **[Якорь исправлен 2026-10-03, P0.5: `packages/web/package.json:42` — `:38` это скрипт сборки, Δ=4.]** Сдвиг дал **сам MyWork** (`be02c6b` и правки F-48/F-58), **не** дельта платформы: на `63d7c80` peer действительно лежал на `:38`; `packages/web/package.json` — пакет MyWork, а не путь платформы, поэтому он и не мог попасть в перечень сдвигов дельты (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §3, «MISSING — найден»). Диапазон в этом манифесте на `639ed0153` — канонический `>=0.1.7-rc.2 <0.3.0-0` (решение владельца 2026-10-03; см. раздел «Дельта» ниже). Поэтому `Select-String -Path packages\*\package.json -Pattern '"@deepseek-ai/dsh"'` даёт **2 файла**, а не 1. Моя правка добавила ровно один манифест (`packages/controller/package.json:35`); второй — чужой пакет, и он не в моём write-scope. Состояние **закоммичено** соседней сессией (`63d7c80 feat(web): add the installable @dsh-mywork/web package with its client half`), то есть это не временный шум незакоммиченной работы: критерий 5 из F-60 в текущей формулировке («ровно ОДИН файл») на этом дереве не выполним без решения по `web`.
3. **F-48 «Проверенные факты» п. 6 неверен для `^0.1.7`** (см. §4).
4. **ADR-032 §2 (`dsh.engines.dsh`) в F-48 не реализуется** (шаг 2 этого и требует): поля нет ни в манифесте, ни в tarball. Расхождение ADR↔план требует подтверждения `decision-desk`/`verifier-a`. Отдельно: `packages/web/package.json` **содержит** `dsh.engines.dsh` — у F-58 своя трактовка, это не мой scope, но Lead'у стоит свести оба манифеста к одному правилу.
5. **Hazard карточки о локфайле опровергнут** (§6).
6. **Коммит F-48 не может содержать evidence-файл**: `.work/` игнорируется git (`.gitignore:1`), `git add .work/...` → exit 1. Коммит шага — только `packages/controller/package.json` + `tests/peer-gate.test.mjs`.

## 10. Delta после независимого ревью A (task-11, finding F-2)

Ревью A (`.work/plan-v0.3/evidence/verify-stage3-review-a.md`, F-2, MINOR) подтвердило F-48 и нашло два пробела в коммитируемом тесте: (а) **множество носителей** peer'а не зафиксировано — третий «декоративный» манифест или молчаливое исчезновение одного из двух носителей прошли бы зелёными; (б) арифметика диапазона жила только в пробе, то есть вне любого гейта.

Что добавлено в `tests/peer-gate.test.mjs` (по требованию карточки изменён **только** этот файл; `packages/controller/package.json` и `packages/web/package.json` не тронуты — UI-сессия правит web):

1. Тест **«exactly the two intended packages carry the platform peer, by name»**: `assert.deepEqual(carriers, ['@dsh-mywork/controller','@dsh-mywork/web'])` — имена читаются из 13 манифестов на диске; тот же набор проверяется для «упоминаний» сырым текстом (как grep F-60 п.5 и F-6), чтобы два понятия не разъехались. Нижняя граница (`>= 1`) и счёт без имён — отброшены.
2. Тест **«the declared range accepts the built-against version and refuses the next major»**: сравнение, которое тест реально исполняет (`compareVersions`/`satisfiesRange` — форма `>=X <Y` плюс прецедентность пререлизов по semver §11), сверенное с таблицей вердиктов, измеренной пробой против семвера платформы: `0.1.7-rc.2`, `0.1.7`, `0.1.8`, `0.1.8-rc.1`, `0.2.0-rc.1` → приняты, `0.2.0` → отказано. Что остаётся пробой и почему — в шапке файла: caret/tilde-десугар, подстановка `workspace:` и произвольные диапазоны возвращают `undefined` (semver из воркспейса не резолвится), их вердикты даёт только `.tmp/f48-gate-probe.mjs`.

Проверка на scratch-копиях (`.tmp/t11-scratch-check.mjs`; реальные манифесты не тронуты — деревья под `.tmp/t11-scratch/`, в каждом 13 манифестов, корневой `package.json` и копия теста):

| Дерево | Что сделано в копии | Exit | pass/fail | Поймало |
|---|---|---|---|---|
| base | ничего | 0 | 7/0 | контроль: копия воспроизводит результат реального дерева |
| decorative | `core` получил peer `@deepseek-ai/dsh` | 1 | 6/1 | новый тест множества носителей |
| dropped | у `web` удалён peer | 1 | 6/1 | тот же тест (молчаливое исчезновение носителя) |
| retargeted | у `controller` диапазон заменён на `^0.1.7` | 1 | 4/3 | пин диапазона + «нельзя обнулить» + арифметика |
| (реальное дерево) | — | 0 | 7/0 | — |

`node --test --test-isolation=none tests/peer-gate.test.mjs` на реальном дереве → **exit 0**, `ℹ tests 7 / ℹ pass 7 / ℹ fail 0`.

**F-3 ревью A — записано, НЕ действуем** (требование карточки): диапазон не менялся, `0.2.0-rc.1` по-прежнему принимается, потому что пререлиз сортируется ниже своего релиза. Ужесточение верхней границы до `<0.2.0-0` — решение владельца (D04). В тесте это зафиксировано как известный разрыв: альтернативный верх `<0.2.0-0` **упражняется** (`satisfiesRange('>=0.1.7-rc.2 <0.2.0-0', '0.2.0-rc.1') === false`), но к манифесту не применяется; остаточный риск внесён в `foundation-50-compat-matrix.md` §4.5.

**Решение владельца (D04, 2026-09-27):** диапазон `>=0.1.7-rc.2 <0.2.0` **остаётся как объявлено**, остаток `0.2.0-rc.1` **принят**; `<0.2.0-0` не применяется и остаётся доступным только отдельным решением. Этим же решением закрыт пункт F-48 «требует подтверждения decision-desk/verifier-a» про `dsh.engines.dsh`: поле — документация, контракт держит `peerDependencies`; дополнение внесено в `adr/ADR-032-peer-version-policy.md` («Дополнение 2026-09-27»).

## НЕ ПРОВЕРЕНО

- Поведение гейта на рантайме `0.2.0` вживую (второй DSH не устанавливался): матрица посчитана **настоящей** функцией гейта, но с подставленным аргументом версии — это и есть предусмотренный API (`evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`, `:61-64`).
- Установка tarball'а в профиль с **несовместимым** рантаймом (нужен DSH 0.2.0) — путь отказа `skippedBundles` из F-48 п. 5 проверен только на уровне функции гейта.
- Поведение `pnpm add <tarball>` в профиле, когда peer **не удовлетворён** (в проверенном профиле `@deepseek-ai/dsh-sdk-minimal` тянет платформу, и диапазон удовлетворён).
- Проба гейта машинно-специфична: путь `C:\Reposit\deepseek-harness\deepseek-harness` и наличие собранного `packages/boot/app-boot/lib/index.js` + `packages/boot/app-boot/node_modules/semver` (7.8.5). `semver` из воркспейса не резолвится вовсе, поэтому коммитируемый тест исполняет только сравнение формы `>=X <Y` с прецедентностью пререлизов (§10), а полная алгебра диапазонов (caret/tilde, `workspace:`, произвольные формы) остаётся пробой.
- `peerDependenciesMeta` на стороне npm (не pnpm) не измерялся — решение §5 принято по измерениям pnpm 12.4.2.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-48-peer-contract.md

---

## Дельта 0.2.0-rc.2 (2026-10-03)

**Статус раздела:** дополнение. Все замеры выше (2026-09-27) — **исторические**: они сделаны против базы `c7c4c725` = `0.1.7-rc.2` и не переписываются; их вердикты остаются верными для того рантайма, кроме прямо исправленного в §4 («`^0.1.7` ⇒ true» — ложное утверждение первоисточника `lead-03`, опровергнутое там же).

**Что изменилось в платформе.** Ревизия — `639ed0153` (тег `dsh-v0.2.0-rc.2`, `git tag --points-at 639ed0153` → `dsh-v0.2.0-rc.2`); версия рантайма гейта `getDshRuntimeVersion()` (`packages/boot/app-boot/src/plugin-compatibility.ts:44`) = `packages/boot/app-boot/package.json` = **`0.2.0-rc.2`**. Механика гейта не менялась (дельта §2.2 D13: peer-гейт стабилен, `:68,:75,:76,:77` — те же строки; файл 103 строки, перепроверено).

**Команда замера (та же семантика, что у гейта: `semver.satisfies(runtime, range, { includePrerelease: true })`, `plugin-compatibility.ts:77`):**

```text
node -e "…semver.satisfies…"   с semver из packages/boot/app-boot/node_modules/semver (7.8.5)   → exit 0
```

**Вывод (`plain` = без опции, `inc` = с `includePrerelease: true` = семантика гейта):**

| Рантайм | `>=0.1.7-rc.2 <0.2.0` (прежний) | `>=0.1.7-rc.2 <0.3.0-0` (решение владельца 2026-10-03) | `>=0.1.7-rc.2 <0.3.0` (без `-0`) |
|---|---|---|---|
| `0.1.7-rc.2` | true / true | true / true | true / true |
| `0.2.0-rc.2` (текущий) | false / **true** | false / **true** | false / true |
| `0.2.0` (финал линии) | false / **false** | true / **true** | true / true |
| `0.2.1-alpha.1` | false / false | false / **true** | false / true |
| `0.3.0-rc.1` | false / false | false / false | false / **true** ← ловушка верхней границы без `-0` |
| `0.3.0` | false / false | false / false | false / false |

**Следствия для F-48.**

1. Прежний диапазон `>=0.1.7-rc.2 <0.2.0` пропускал текущий рантайм **только** благодаря `includePrerelease: true` и **гарантированно отверг бы** финал линии `0.2.0` — гейт отключил бы строку плагина (`compatibility-preflight.ts` → `disabled`, `profile.ts:675` → `skippedBundles`).
2. Диапазон заменён на **`>=0.1.7-rc.2 <0.3.0-0`**: финал `0.2.0` принимается, линия `0.3.0` — нет. Верхняя граница **обязана** нести `-0`: без него `0.3.0-rc.1` проходит насквозь (последний столбец таблицы).
3. **Остаточный факт (не дефект выбора):** `0.2.1-alpha.1` при `includePrerelease: true` проходит и новый диапазон. Это свойство платформенного вызова, а не диапазона: любая граница `<X.Y.Z-0` не режет пререлизы **более низких** патчей той же линии.
4. `dsh.engines.dsh` остаётся **декларативным** (решение владельца 2026-10-03): читателей по-прежнему нет, контракт держит только `peerDependencies` (§2 выше не меняется).

**Расхождение с `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1 (для владельца дельты).** Две клетки таблицы дельты не воспроизводятся замером: (а) `0.3.0-rc.1` против `>=0.1.7-rc.2 <0.2.0` указана **true**, измерено **false** (в обоих режимах); (б) `0.2.1-alpha.1` против `>=0.1.7-rc.2 <0.3.0-0` указана **false**, измерено **true** при `includePrerelease: true` (гейт-семантика) и **false** без опции. Выводы §5.1 (нужность `<0.3.0-0`, отказ от `<0.2.0-0`) от этих клеток не зависят.

**Мультивариантный вывод §5 (решение по `peerDependenciesMeta`) остаётся в силе:** поле по-прежнему никто не читает (гейт — `:68,:75`; pnpm — измерено в §5). Переизмерять на `0.2.0-rc.2` не требуется.
