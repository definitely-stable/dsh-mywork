# verify-stage3-review-a — независимое ревью половины контрактов этапа 3 (F-47…F-53, F-58, F-59)

- **Ревизор:** `review-a` (task-7), read-only режим скилла `evidence-gated-delivery`.
- **Зафиксированный диапазон:** `d0c97bf..db7f14e`. Проверенный tip: **`db7f14e33bd1a2de37433864e6969b198c6876c8`** — совпадает с заявленным в мандате.
- **`git status --short`:** пусто на старте, пусто после каждой проверки (включая мутационные пробы: исходники восстановлены, хеши совпадают — см. F-8/команды).
- Дерево под ревизией не двигалось. Живой профиль `C:\Users\Dmitry\.dsh` не читался и не изменялся; изолированный `DSH_HOME` — только под `.tmp/`.

---

## Вердикт

**PASS WITH FINDINGS** — все шесть заявленных в мандате утверждений подтверждаются командами (peer включает гейт ровно у двух манифестов; `--frozen-lockfile` воспроизводим и ничего нужного не теряет; словарь §30 не ослаблен и канон 60/2 000 000 на месте; R-08 закрыт невакуумно; tarball самодостаточен; флаг кучи — причина, а не плацебо), но в поставке UI-половины есть один **MAJOR**: строка `mywork-web` из патча контроллера не может разрешиться в канале доставки, который кампания объявила единственным, — и это происходит молча, при `exit 0`, мимо гейта F-49.

Счётчики: **MAJOR 1, MINOR 4, NIT 3**. BLOCKER нет — контрактная половина (F-47…F-53) корректна, артефакты не повреждены, локальные гейты F-52/F-53/F-58/F-59 выполняются; поэтому не FAIL.

---

## Проверенные команды

| Команда | Exit | Наблюдение |
|---|---|---|
| `git rev-parse HEAD` / `git status --short` | 0 / 0 | `db7f14e33bd1a2de37433864e6969b198c6876c8`; дерево чистое на старте и в конце |
| `node .tmp/rev-a-gate.mjs` (реальный гейт: импорт `packages/boot/app-boot/lib/index.js` чек-аута DSH) | 0 | runtime `0.1.7-rc.2`; контроллер и web: молчание гейта на `0.1.7-rc.2`, `0.1.7`, `0.1.8`, `0.1.8-rc.1`, **`0.2.0-rc.1`**; `MISMATCH` только на `0.2.0`. Контроль «peer удалён» → молчание и на `0.2.0`; контроль «диапазон `999.0.0`» → `MISMATCH`. Остальные 11 манифестов молчат на `0.2.0` |
| `corepack pnpm view '@linxin666/dsh-client-ui-task-board@0.4.3' peerDependencies --json` | 0 | `{"react":"^18.2.0","@deepseek-ai/dsh":">=0.1.7-rc.2"}` — эталон объявляет **оба** peer'а, как и утверждает мандат |
| `corepack pnpm install --frozen-lockfile --offline` | 0 | `Lockfile is up to date, resolution step is skipped`; sha256 `pnpm-lock.yaml` до и после совпадает; `git status` пуст |
| `git diff d0c97bf..HEAD -- pnpm-lock.yaml` | 0 | дельта ровно `3 insertions(+), 1 deletion(-)`: `autoInstallPeers: true→false` и `packages/web: {}` |
| `Test-Path node_modules/react` / `packages/web/node_modules/react` | — | `False` / `False`; `@deepseek-ai/cordis` при этом на месте и в корне, и у контроллера |
| `corepack pnpm -r run build` (под `.tmp/build.lock`) | 0 | 13 пакетов; в логе `packages/web build: web: wrote lib\client.js` и `…types\client\index.d.ts` |
| sha256 `src/client/index.js` vs `lib/client.js` | 0 | одинаковые (`42198CBC…99F5BB`), 6217 б; первая строка `window.__ModuleLoader__.load({`; строк, начинающихся с `import`/`export` — 0; `.d.ts`-фасад тоже идентичен источнику |
| **мутация 1:** `Remove-Item packages\web\lib\client.js` → `pnpm --filter @dsh-mywork/web run build` | 0 | файл восстановлен, sha256 совпадает с источником (`clean: true` его действительно стирает, цепочка `&&` его действительно возвращает) |
| **мутация 2:** замена в `src/client/index.js` `window.__ModuleLoader__.load(` → `globalThis.load(` и сборка пакета | **1** | `web: … is not a classic-script module-loader registration (expected "window.__ModuleLoader__.load(")`; источник восстановлен побайтово, повторная сборка 0 |
| `node --test --test-isolation=none tests/budget.test.mjs` | 0 | `tests 15 / pass 15 / fail 0` |
| `… tests/budget-defaults.test.mjs` | 0 | `tests 3 / pass 3 / fail 0` |
| `… tests/step-breaker.test.mjs` | 0 | `tests 2 / pass 2 / fail 0` |
| `… tests/budget-meter.test.mjs` | 0 | `tests 3 / pass 3 / fail 0` |
| `… tests/peer-gate.test.mjs` | 0 | `tests 5 / pass 5 / fail 0` |
| `… tests/publish-manifest.test.mjs` | 0 | `tests 4 / pass 4 / fail 0` |
| `… tests/ui-package.test.mjs` | 0 | `tests 5 / pass 5 / fail 0` |
| `… tests/ui-attributes.test.mjs` | 0 | `tests 2 / pass 2 / fail 0` |
| `corepack pnpm -r run typecheck` | 0 | 13 пакетов, включая `web`, **без установленного `react`** |
| `node scripts/pack.mjs` | 0 | tarball `dsh-mywork-controller-0.1.0.tgz`, 541 784 б |
| распаковка tarball + инспекция | 0 | внутри `package/{package.json,cordis.patch.yml,lib/index.js,lib/index.d.ts,lib/*.map}`; `private:true` сохранён; `devDependencies` переписаны `workspace:*`→`0.1.0`; `peerDependencies` сохранили `@deepseek-ai/dsh`; **настоящих `@dsh-mywork/*`-импортов — 0** (10 подстрочных совпадений — это JSDoc-проза) |
| изолированный профиль: `--from-default-profile sdk-minimal` → `plugin add <tgz>` → `--dump-config` → boot (с `DSH_HOME` под `.tmp`) | 0 / 0 / 0 / **0** | установлен 1 пакет (`@dsh-mywork/controller`); обе строки в композиции; **boot завершается 0, но печатает `dsh: warning: 1 entry did not activate` / `mywork-web (@dsh-mywork/web): failed to import`** |
| **beads-adapter без флага:** `node ../../node_modules/tsdown/dist/run.mjs` в `packages/beads-adapter` | **134** | 53.2 с, лог: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory` |
| **beads-adapter с флагом:** `node --max-old-space-size=8192 …` | 0 | 68.4 с, `lib/index.js` на месте |

**Замечание об окружении (не дефект).** Первый прогон четырёх из этих сюит дал `exit 1` с `Error: domain tests: missing build output: packages/evidence/lib/index.js, … ; run "pnpm run build" first` (`tests/lib/fixtures.mjs:33`). Это отсутствие артефактов сборки в дереве на момент старта ревью, а не отказ кода: после `corepack pnpm -r run build` те же файлы зелёные (таблица выше). Тогда же сборку держала другая сессия (`.tmp/build.lock` создан 19:00:46, записи в `lib/` шли во время чтения) — я не строил параллельно, а дождался освобождения лока.

---

## Findings

### F-1 · MAJOR · строка `mywork-web` не разрешается в канале доставки, и это молчит

`packages/controller/cordis.patch.yml:21-22` вставляет строку `mywork-web` с bare-именем `@dsh-mywork/web`. Но:

- `@dsh-mywork/web` **не** объявлен зависимостью контроллера (`packages/controller/package.json:41-51` — ни `dependencies`, ни `devDependencies`);
- в tarball его нет вовсе (0 файлов, 0 упоминаний в упакованном `package.json`);
- ни один скрипт его не пакует: `scripts/pack.mjs:19-20` знает только `packages/controller`; `Select-String` по `scripts/*.mjs` на `dsh-mywork/web` даёт **0** совпадений.

Проверка в изолированном профиле (`DSH_HOME` под `.tmp`, реальный CLI DSH, установка ровно того tarball, который отдаёт `scripts/pack.mjs`):

```
profile node_modules/@dsh-mywork = controller        # web отсутствует
- id: mywork-web  name: '@dsh-mywork/web'            # строка в композиции есть
dsh: warning: 1 entry did not activate
mywork-web (@dsh-mywork/web): failed to import
BOOT_EXIT=0
```

**Почему это важно.** (1) Цель F-58 — «бандл физически регистрируется в клиенте» — в единственном объявленном канале (tarball, D04) не достигается: строка, несущая клиентскую половину, не активируется. (2) Отказ **бесшумный**: `exit 0` и предупреждение вместо ошибки, а гейт F-49 `verify:profile` проверяет только строку контроллера (`scripts/verify-profile.mjs:210-222`) — то есть гейт зелёный при неработающей строке. (3) Посылка коммита `63d7c80` («it is the one workspace package a profile installs from a tarball») ничем не реализована: пакет, который «профиль устанавливает из tarball», не пакуется и не устанавливается.

**Минимальное исправление (любое из двух).** (а) Доставлять оба пакета: `scripts/pack.mjs` пакует и `packages/web`, шаг установки добавляет оба tarball'а — тогда строка резолвится из `node_modules` профиля. (б) Убрать вставку из патча контроллера и отдать её самому `@dsh-mywork/web` через собственный `dsh.bundle.patch`, чтобы ни один патч не называл пакет, которого у профиля нет. В обоих случаях нужен гейт, который это ловит: расширить `verify-profile.mjs` проверкой «в boot-выводе нет `did not activate`», а не только наличием строки контроллера.

### F-2 · MINOR · peer-контракт закреплён как текст, а не как множество и не как арифметика

`tests/peer-gate.test.mjs:103-127` проверяет `carriers.length >= 1` и `deepEqual` для найденного контроллера, но **не** фиксирует множество носителей peer'а. Третий (декоративный) манифест с `@deepseek-ai/dsh` пройдёт незамеченным — а именно этот инвариант («ровно два, и только там, где это оправдано») мандат и просит проверить. Кроме того, сами полувердикты диапазона сюита не считает: её собственный комментарий (`:12-20`) признаёт, что semver платформы не резолвится из воркспейса, и арифметика живёт только в пробе `.tmp/f48-gate-probe.mjs`, то есть вне любого гейта. Проверено мною (F-таблица, реальный гейт), но не репозиторием.

**Минимальное исправление:** в `tests/peer-gate.test.mjs` добавить `assert.deepEqual(carriers.map(c => c.name).sort(), ['@dsh-mywork/controller', '@dsh-mywork/web'])` и хотя бы один ассерт, прогоняющий объявленный диапазон через semver рантайма (например, импортом semver из чек-аута по пути, как в пробе, или переносом пробы в `scripts/`).

### F-3 · MINOR · диапазон пропускает пререлизы следующего мажора (`0.2.0-rc.1`)

Реальный гейт на обоих манифестах: `0.2.0-rc.1` → **молчание** (совместимо), отказ только на `0.2.0`. Коммит `51d6fa4` формулирует результат как «refuses 0.2.0 instead of mounting and crashing»; первый же `0.2.0-rc.1`, который владелец поставит, пройдёт гейт без проверки. План это знает (`20-STEPS-foundation.md:1317` перечисляет `0.2.0-rc.1 → true`), но ни тест, ни матрица F-50 не помечают это как остаточный риск.

**Минимальное исправление:** верхняя граница `>=0.1.7-rc.2 <0.2.0-0` (этот semver сам десугарит `~0.1.7` в `<0.2.0-0`, то есть инструмент в плане уже назван) — либо явная запись риска в матрице совместимости как решение владельца.

### F-4 · MINOR · канон «на попытку» приписан лимиту со скоупом «задача»

`packages/core/src/budget-defaults.ts:53-54` объявляет `maxTokensPerTask: 2_000_000` с комментарием «CANON (R-16): 2 000 000 tokens per attempt», и то же повторяет `tests/budget-defaults.test.mjs:47-50`. Но имя лимита — `maxTokensPerTask`, его скоуп — `task` (`packages/contracts/src/budget.ts:137`), а гейт вызывается с task-ledger'ом (`packages/core/src/scheduler.ts:564-568`). Канон формулирует «2M токенов **на попытку**» (`01-MASTER-PLAN.md:297`, `:533`). Направление расхождения — в сторону **строже** (на задачу ≥ на попытку), поэтому ни один потолок §30 не ослаблен; дефект в том, что код и тест описывают скоуп, которого у лимита нет.

**Минимальное исправление:** либо привести формулировку к фактическому скоупу («2 000 000 на задачу; канон R-16 называет ту же величину как потолок попытки»), либо, если владелец хочет буквальный канон, сбрасывать токенный счётчик на новую попытку так же явно, как это сделано для `steps`.

### F-5 · MINOR · новые механизмы §30 не вызываются ниоткуда

`Select-String` по `packages/*/src` и `scripts/` на `stepBudget|stepsOfNewAttempt|DEFAULT_BUDGET_LIMITS|budgetLimitsFrom|budgetOutcome` даёт только определения и реэкспорты (`packages/core/src/index.ts:462-466,481`). Живых вызовов нет: `stepBudget` не подключён к шагу цикла, дефолты не подаются в `workspace.budget`, `budgetOutcome` не применяется к решению. То есть в работающем профиле гейт §30 по-прежнему проверяет лишь то, что объявил вызывающий, а вызывающий не объявляет ничего, и ни один шаг не заряжается.

**Почему это важно:** заголовок этапа 3 («нет ограничителя стоимости и шагов») закрыт **на уровне механизма**, не на уровне продукта; читатель гейта F-60 может решить, что runaway-цикл уже ограничен. Формально это не дефект карточек (в списках файлов F-51…F-53 только модуль и тест, шага «подключить» в плане нет) — поэтому MINOR, а не MAJOR.

**Минимальное исправление:** подключить `budgetLimitsFrom()` там, где собирается `SchedulerWorkspaceState`, и `stepBudget` — в шаговый хук цикла; либо явно записать в F-60, что проводка — отдельный шаг.

### F-6 · NIT · гейт F-60 п.5 ожидает 12 совпадений там, где принятый дизайн даёт 2

`.work/plan-v0.3/20-STEPS-foundation.md:1650`: `Select-String -Path packages\*\package.json -Pattern '"@deepseek-ai/dsh"'` → **12 совпадений**. Фактически — **2 файла** (`controller:35`, `web:38`), и это ровно то, чего требует отменяющая правка F-48 п.3 (`:1325`) и F-58. Гейт этапа в этой строке невыполним by construction и может дать ложный FAIL.

**Минимальное исправление:** переписать ожидание на «ровно 2 файла: controller и web» (и закрепить это в сюите — см. F-2).

### F-7 · NIT · подстрочная проверка tarball'а даёт 10 ложных срабатываний; карты кода везут исходники

Заявленный гейт «`@dsh-mywork/` внутри `lib/index.js` — ноль» на подстроке **не** выполняется: 10 совпадений, все — JSDoc-проза (`@module @dsh-mywork/contracts` и т. п.). Настоящих импортов (`from '@dsh-mywork/…`, `require('@dsh-mywork/…`, `import('@dsh-mywork/…`) — **0**, то есть по смыслу гейт верен, а по буквальной формулировке — нет. Дополнительно: `lib/index.js.map` (1.4 МБ из 2.14 МБ tarball'а) содержит `sourcesContent` для **89** файлов, то есть tarball везёт исходники в карте, хотя тест `tests/publish-manifest.test.mjs:40` называется «without sources» и проверяет только записи `files` (риск нулевой: MIT, `private: true`).

**Минимальное исправление:** проверять именно спецификаторы импортов (`specifiersOf`, как в `tests/boundaries.test.mjs:484-495`), а не подстроку; и либо исключить `*.map` из tarball'а, либо признать в тесте, что карты везут исходники.

### F-8 · NIT · бухгалтерия плана: этап 4 снова создаёт уже созданный пакет

`22-STEPS-surface.md:295` (`B-01a · Создать каркас пакета @dsh-mywork/web`) предполагает создание пакета, который F-58 уже создал в этом диапазоне. Это конфликт документов, а не кода, но он будет стоить шага исполнителю этапа 4.

---

## Что проверено и сочтено корректным

1. **Peer включает гейт — и ровно там, где оправдано (claim 1).** Реальный `evaluatePluginCompatibility` (не зеркало из теста) на реальных манифестах: контроллер и web дают `MISMATCH` на `0.2.0`, а контрольная копия без `@deepseek-ai/dsh` — молчание; оставшиеся 11 манифестов молчат. Оба объявления **субстантивны**: контроллер читает платформенные сервисы (`ctx.get('productTelemetry')`, `ctx.tokenMeter`, `ctx.logger`, `ctx.effect`), а клиентская половина web в рантайме требует `react` и `@deepseek-ai/dsh-client-store` (`packages/web/src/client/index.js:27-28`) — то есть контракт с версией платформы реальный, а не декоративный. Эталон `@linxin666/…@0.4.3` проверен мною в реестре и объявляет оба peer'а — совпадение с мандатом.
2. **`--frozen-lockfile` воспроизводим (claim 2).** Exit 0, лок-файл не изменён, дельта в диапазоне — 3 вставки/1 удаление (настройка + пустой importer `packages/web`). Атака «не потеряли ли зависимость»: `react` не установлен нигде и ничем не нужен — `typecheck`, `build` и все сюиты зелёные без него, а в рантайме половинка получает `react` из таблицы модулей страницы (обе UI-сюиты подкладывают фейковый `react` именно поэтому); `@deepseek-ai/cordis` при этом на месте. Комментарий в `pnpm-workspace.yaml` объясняет причину и не врёт о последствиях.
3. **Словарь §30 не ослаблен, канон на месте (claim 3).** В `chargeOf`/`usedOf` восемь исходных лимитов не тронуты — диф `packages/core/src/budget.ts` состоит только из добавлений; `maxSteps` — девятое имя с собственной веткой (`request.kind === 'step'` → `knownAmount(1)`) и собственным счётчиком `usedOf → consumption.steps`. `BudgetConsumption.steps` не путается с `attempts`: разные поля, разные request-kind'ы, и тест это фиксирует (`tests/budget.test.mjs`: шаг при исчерпанном `maxAttempts` допускается; `chargeConsumption(…, {steps: 3})` не трогает `attempts`). Счётчик валидируется с обеих сторон (`steps: -1`, `1.5` → `TypeError`). Канон в коде: `maxSteps: 60`, `maxTokensPerTask: 2_000_000`; 60/61-я граница проверена (`steps: 59` допущен, `steps: 60` отказ, `newAttempt: true` снова допущен). Пометки честные: два значения `CANON (R-16)`, четыре — `PROPOSAL (D05, owner confirmation required)`, три суточных потолка сознательно отсутствуют с объяснением (иначе `scope-not-measured` отказывал бы всё).
4. **R-08 закрыт невакуумно (claim 4).** После полной `corepack pnpm -r run build` файл `packages/web/lib/client.js` есть, побайтово равен `src/client/index.js`, начинается с `window.__ModuleLoader__.load({`, ESM-синтаксиса в нём 0. Мутации: удаление файла → сборка пакета возвращает его; удаление конверта из источника → сборка **падает** с внятным сообщением (значит, проверка конверта может провалиться, а не «всегда зелёная»). Исходники после мутаций восстановлены, хеши совпали.
5. **Гейт tarball'а означает то, что говорит (claim 5).** `node scripts/pack.mjs` → 0, tarball 541 784 б; внутри только `lib/`, `cordis.patch.yml`, `package.json`, `LICENSE`; `private: true` сохранён; `workspace:*` переписаны в `0.1.0`; peer платформы в упакованном манифесте сохранён; настоящих `@dsh-mywork/*`-импортов — 0 (см. F-7 про формулировку).
6. **Флаг кучи — причина, а не плацебо (claim 6).** Без флага — `exit 134` через 53 с с `FATAL ERROR: … JavaScript heap out of memory`; с флагом — `exit 0` и `lib/index.js` на месте. Заявленные в коммите числа воспроизводятся.

---

## Невоспроизводимые утверждения отчёта

- **Ожидание F-60 п.5 «12 совпадений»** не воспроизводится: фактически 2 (см. F-6). Расхождение — в документе плана, не в коде; объясняется отменённой первой редакцией F-48.
- **`scripts/verify-profile.mjs` → `verify:profile: PASS`** я не запускал (см. ниже), поэтому утверждение «гейт F-49/F-48 зелёный» не подтверждаю своими командами. Косвенно: изолированная установка и boot проходят (`exit 0`), но предупреждение о неактивированной строке мой прогон видит, а гейт — нет.
- **«Пакет `@dsh-mywork/web` — тот, который профиль устанавливает из tarball»** (`63d7c80`) — опровергнуто: его не пакует и не устанавливает ничто (F-1).

---

## Что осталось непроверенным и почему

1. **`node scripts/verify-profile.mjs` end-to-end.** Скрипт хеширует файлы живого профиля (`~/.dsh/profiles/web/package.json`, `cordis.patch.yml`, `settings.yaml`, `scripts/verify-profile.mjs:129-131`) ради доказательства «профиль не тронут». Мандат запрещает доступ к живому профилю, поэтому я не запускал его, а собрал эквивалентный прогон в изолированном `DSH_HOME` (create → `plugin add` → `--dump-config` → boot) без чтения живого профиля. Решение владельца/Lead'а: гейт F-49 стоит прогнать отдельно — по моим данным он **пройдёт**, даже если строка `mywork-web` не активируется.
2. **Видимость панели в GUI** (регистрация клиентской половины и рендер) — это приёмочный шаг этапа 5 по самому плану F-58; требует живого профиля и браузера.
3. **Полная сюита и `smoke`** — вне мандата (гейт F-60 за Lead'ом). Я прогнал только восемь сюит из своего списка плюс `typecheck`.
4. **Поверхность безопасности (F-54…F-57, F-63b)** — у второго ревьюера.
5. **Проводка `stepBudget`/дефолтов в живой цикл** — не проверялась «в бою», потому что её нет в коде (F-5); это не «не удалось проверить», а установленный факт.
6. **`publishConfig`/реестровая публикация** — вне диапазона; отмечу лишь, что около 1.9 МБ tarball'а — карты кода (F-7).

---

### Артефакты проб (scratch, `.tmp/`)

`.tmp/rev-a-gate.mjs`, `.tmp/rev-a-1-build-and-tests.ps1`, `.tmp/rev-a-2-mutations.ps1`, `.tmp/rev-a-3-install-pack.ps1`, `.tmp/rev-a-4-heap.ps1`, `.tmp/rev-a-5-profile.ps1` и логи `rev-a-*.log`. `.tmp/build.lock` взят и освобождён дважды (19:05:31→19:08:13, 19:10:39→19:12:41); на момент сдачи лок отсутствует.
