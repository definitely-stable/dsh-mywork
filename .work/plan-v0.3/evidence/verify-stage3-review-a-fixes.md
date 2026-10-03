# verify-stage3-review-a-fixes — проверка исправлений по находкам ревью A

- **Режим:** verify-fixes (не второе ревью). Потреблён собственный список находок, бюджет потрачен на дельту `db7f14e..3e67584`.
- **Проверенный tip:** `3e67584ca8e300e03ccbee9bfa63625b120d8a30` (совпадает с мандатом). `git status --short` пусто на старте и в конце; дерево под мною не менялось.
- **Живой профиль:** не изменялся; единственное чтение — штатный шаг отпечатков самого гейта `scripts/verify-profile.mjs:129-131`, который Lead явно поручил запустить (см. «Процессные замечания»).
- Сборка на момент проверки свежая: `packages/controller` src 19:27 → lib 19:44; `core` 19:29 → 19:42; `web` 18:45 → 19:41. Лок сборки не требовался: пакеты пакуются без сборки, а сюиты читают уже собранный `lib`.

---

## Вердикт

**FIXES VERIFIED** — F-1 (MAJOR, молча неразрешимая строка панели) и F-2 (MINOR, множество носителей peer'а) исправлены и подтверждены командами, включая **невакуумность обеих новых защит**: пред-фиксный сценарий действительно роняет гейт, а три мутации множества носителей действительно краснеют. F-3 остался решением владельца, и остаточный риск **записан**, а не проглочен. Записи F-4…F-8 в `foundation-stage3-gate.md` сверены с реальностью и, кроме одного места, ей соответствуют.

**Новых BLOCKER/MAJOR исправления не внесли.** Найдено: **MINOR 1** (список маркеров не покрывает второй, «бандловый» класс отказа, который породила новая архитектура) и **NIT 2** (`packUi` без своего теста идемпотентности; строка плана F-60 п.5 по-прежнему говорит «12»).

| Находка | Вердикт | Доказательство |
|---|---|---|
| **F-1** (MAJOR) строка `mywork-web` не разрешалась, молча | **VERIFIED** | (a) `node scripts/verify-profile.mjs --dsh-bin …\apps\cli\lib\bin.js` → **exit 0**, `verify:profile: PASS`: упакованы **оба** tarball'а, установлены **оба** (`dsh plugin add installed the packed host bundle` / `… UI bundle`), `bundles = ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller","@dsh-mywork/web"]`, композиция содержит **оба** слоя и **обе** строки, boot — `mounted and unloaded the controller, and every row activated`; маркеров в логе 0. (b) свой негативный контроль (см. ниже) → маркеры срабатывают, предикат гейта **падает**. (c) `node --test --test-isolation=none tests/scripts-pack-idempotent.test.mjs` → **exit 0, pass 2 / fail 0** — `packController` сохранил имя и поведение |
| **F-2** (MINOR) множество носителей не зафиксировано | **VERIFIED** | `tests/peer-gate.test.mjs` → **exit 0, pass 7 / fail 0**; своя scratch-копия дерева (`.tmp/rev-a-scratch`, 13 манифестов): базовая линия `pass 7 / fail 0`, **мутация A** (третий декоративный носитель `@dsh-mywork/core`) → **exit 1** `platform peer carriers: ["@dsh-mywork/controller","@dsh-mywork/core","@dsh-mywork/web"]`; **мутация B** (web теряет peer) → **exit 1** `carriers: ["@dsh-mywork/controller"]`; **мутация C** (у контроллера второй peer платформенного неймспейса `@deepseek-ai/dsh-extra`) → **exit 1** `the gate checks exactly the platform peer and nothing else`; восстановление → `pass 7 / fail 0` |
| **F-2**, арифметика диапазона | **VERIFIED** | реальный semver платформы `7.8.5`: все 6 строк `MEASURED_BY_PROBE` воспроизводятся (`0.1.7-rc.2/0.1.7/0.1.8/0.1.8-rc.1/0.2.0-rc.1` → true, `0.2.0` → false) |
| **F-3** (MINOR) `0.2.0-rc.1` проходит гейт | **VERIFIED как «записано, не менялось»** | текст диапазона не изменён: манифест контроллера в дельте не менялся вовсе, у web строка 42 та же `>=0.1.7-rc.2 <0.2.0`. Остаток записан **в четырёх местах**: шапка `tests/peer-gate.test.mjs` («Known, deliberate gap (owner decision D04, review A's F-3)»), `foundation-48-peer-contract.md:198`, `foundation-50-compat-matrix.md:24,71,91` (столбец матрицы + явный пункт), `foundation-stage3-gate.md:59,115`. Строгая альтернатива **упражняется, но не применена**: `satisfiesRange('>=0.1.7-rc.2 <0.2.0-0','0.2.0-rc.1') === false`; я сверил её с реальным semver: `<0.2.0-0` отвергает `0.2.0-rc.1`, но принимает `0.1.7-rc.2` и `0.1.8` — предложенный в F-3 фикс владельцу безопасен |
| **F-4/F-5** (MINOR, «записано») | **VERIFIED как запись** | `foundation-stage3-gate.md:60-61,84,100` пересказывают ровно то, что я измерил: «2 000 000 на попытку» против `maxTokensPerTask` (scope `task`), строже канона; `stepBudget`/`DEFAULT_BUDGET_LIMITS`/`budgetLimitsFrom`/`budgetOutcome` без вызовов, проводка — этап 4, `apply()` не передаёт `ctx.tokenMeter` |
| **F-6** (MINOR, дефект плана) | **VERIFIED как запись, строка плана НЕ исправлена** | `foundation-stage3-gate.md:62,95` пересказывает верно: было «12», фактически **2** файла, критерий переформулирован; критерий теперь реально исполняется тестом (`tests/peer-gate.test.mjs:195` — `mentions` == `CARRIERS`). Но сам `.work/plan-v0.3/20-STEPS-foundation.md:1650` по-прежнему гласит «→ **12** совпадений», то есть ловушка для следующего исполнителя осталась |
| **F-7** (NIT, записано) | **VERIFIED как запись** | `foundation-stage3-gate.md:63`; мой пересчёт на новом tarball'е: настоящих импортов `@dsh-mywork/*` в `lib/index.js` — 0, подстрочных совпадений — 10 (JSDoc), карты кода по-прежнему несут `sourcesContent` |
| **F-8** (NIT, дефект плана) | **VERIFIED как запись; сверено с первоисточником** | `foundation-stage3-gate.md:64,97` верно: `22-STEPS-surface.md:307` действительно содержит `"private": true`, что противоречит D18/F-58. Дополню: там же `:318` объявляет `files: […, "src", …]`, то есть шаг B-01a вдобавок нарушил бы правило «не публиковать исходники» из `tests/publish-manifest.test.mjs:40-55` — конфликт шире, чем записано |
| **§6.2 (исправление факта «`^0.1.7` → true»)** | **VERIFIED** | реальный semver `7.8.5`: `validRange('^0.1.7') = '>=0.1.7 <0.2.0-0'` и `validRange('~0.1.7')` — то же; `satisfies('0.1.7-rc.2','^0.1.7',{includePrerelease:true}) = false` и для `~0.1.7` тоже **false**. Формулировка плана (`^0.1.7` десугарит в `>=0.1.7-0 …` ⇒ true) была ложной — Lead прав |
| **§6.4 (правка `tests/boundaries.test.mjs:186-199` не нужна)** | **VERIFIED** | строки 186-199 — это «contracts imports nothing outside its own modules» и «core imports only its own modules and the contracts package»; peer/`engines`/`private` этот файл не проверяет |
| **§6.7 / F-1 в гейте P** | **VERIFIED** | `foundation-stage3-gate.md:101`: до `4a269e9` гейт печатал PASS при неразрешимой строке — это ровно мой F-1; исправление в том же коммите, что и упаковка |

---

## Как проверялся F-1(b): свой негативный контроль

Мандат разрешил «воспроизвести или предложить свой эквивалент». **Скрипт Lead'а `.tmp/t12-web-row-mutation.mjs` я не воспроизводил** (он мутирует дерево; мне это запрещено) — вместо этого сделал репозиторно-безопасный эквивалент: `.tmp/rev-a-8-negctl.ps1` распаковывает **выпущенный** tarball контроллера, возвращает в его `cordis.patch.yml` строку `mywork-web` (пред-фиксная форма), пакует заново **вне дерева** и ставит в изолированный `DSH_HOME` **только** контроллер:

```
composed:  - id: mywork-web   name: '@dsh-mywork/web'     # строка есть, пакета нет
boot exit=0
  dsh: warning: 1 entry did not activate
  mywork-web (@dsh-mywork/web): failed to import
marker 'did not activate' present = True
marker 'failed to import' present = True
verify-profile predicate would FAIL the gate = True
```

Патч репозитория после пробы не тронут: sha256 выпущенного `packages/controller/cordis.patch.yml` = `8AAD5783…` до и после, мутированный — только в `.tmp`. Значит, список маркеров **достижим и невакуумен**: если строка снова окажется в патче без установленного пакета, гейт P упадёт.

Позитивный путь подтверждён независимо от самоотчёта гейта (`pack.mjs` → оба tarball'а; UI-tarball 6116 б содержит `cordis.patch.yml`, `icon.svg`, `lib/client.js` (первая строка — `window.__ModuleLoader__.load({`), `lib/types/client/index.d.ts`; установлены `controller,web`; композиция содержит обе строки; boot без маркеров). Шапка нового `packages/web/cordis.patch.yml` ссылается на форму эталона 0.4.3 — **проверил в реестре**: `pnpm view '@linxin666/dsh-client-ui-task-board@0.4.3' dsh` отдаёт `{"bundle":{"patch":"./cordis.patch.yml"},"client":{…}}`, то есть патч бандла и клиентская половина действительно живут в одном манифесте.

---

## Новые дефекты, внесённые исправлениями

**N1 · MINOR · список маркеров не покрывает «бандловый» класс отказа — `scripts/verify-profile.mjs:40`**
Новая архитектура перенесла строку в патч самого `@dsh-mywork/web`, и теперь пакет обязан быть в `dsh.profile.bundles`. Если он там есть, а из `node_modules` профиля исчез, DSH ведёт себя **иначе**, чем в пред-фиксном сценарии:

```
dsh: skipping profile bundle "@dsh-mywork/web": Error: dsh: cannot resolve profile bundle
"@dsh-mywork/web" from the dsh installation or …\profiles\fixcheck; run 'dsh plugin --profile fixcheck install' …
boot exit=0        marker 'did not activate' present = False        marker 'failed to import' present = False
```

То есть `INACTIVE_MARKERS` (`['did not activate','failed to import']`) этот отказ не ловит, и гейт напечатал бы PASS. В собственном прогоне гейта состояние недостижимо (он сам ставит оба пакета и затем проверяет `dependencies`/`bundles`), поэтому это **не сломанный фикс, а пробел покрытия** у новой защиты — но пробел ровно в том классе, который породила новая архитектура.
*Минимальный фикс:* добавить в массив `'cannot resolve profile bundle'` (и/или `'skipping profile bundle'`) — одна строка, поведение гейта не меняется ни на зелёном пути, ни на пред-фиксной мутации.

**N2 · NIT · у `packUi` нет своего теста идемпотентности (`scripts/pack.mjs:117`)**
`tests/scripts-pack-idempotent.test.mjs` упражняет только `packController` (импорт на строке 18). Код общий (`packPackage`), но новый экспорт не защищён собственным тестом; вторая точка вызова (`verify-profile.mjs:186`) уже покрыта сквозняком.
*Минимальный фикс:* параметризовать существующий тест на пару `[[packController, controller], [packUi, web]]`.

**N3 · NIT · строка плана F-60 п.5 осталась с «12» (`20-STEPS-foundation.md:1650`)**
Запись в гейте верна (§6.1), критерий переформулирован и исполняется тестом, но сам файл плана не поправлен. Это осознанный выбор («дефект плана», правка — владельца файла), поэтому NIT, а не дефект кода: следующая сессия снова прочтёт «12» и увидит 2.

Ничего другого исправления не сломали: `tests/ui-package.test.mjs` 5/5, `tests/publish-manifest.test.mjs` 4/4, `tests/scripts-pack-idempotent.test.mjs` 2/2, `tests/peer-gate.test.mjs` 7/7 — все `exit 0`. Инварианты манифестов не сдвинулись: 12 пакетов `private: true`, `web` — единственный без `private` (D18), peer'ы ровно у `controller` и `web`, у web в `files` добавлен только `cordis.patch.yml`.

---

## Что не проверено и почему

1. **Видимость панели в GUI** — по-прежнему приёмка этапа 5: требуется живой профиль и браузер. Гейт доказывает контракт регистрации (ряд активируется), а не рендер.
2. **Полная сюита и `smoke`, `typecheck`, сборка** — я не перепрогонял их на этом tip'е (это гейт F-60 и мандат запрещает перепроизводство фактов); числа Lead'а (13/13, 833/833, smoke 0) я не подтверждаю и не оспариваю. Свежесть `lib` относительно `src` проверена по mtime — сборка актуальна.
3. **Правки `3e67584`** (`worker-surface`, `telemetry`) — зона review-b (B2/B6). Убедился лишь, что они не задевают мои артефакты: диф `packages/controller/src/index.ts` — это блок экспортов телеметрии и комментарий.
4. **Отсутствующий, но объявленный бандл** — измерен только как негативный контроль (N1); продуктовое решение, надо ли менять поведение DSH, вне границ.
5. **`npm` vs `pnpm`, `peerDependenciesMeta`** — не измерялись (наследие прошлого прохода).

---

## Процессные замечания (честно)

1. **Неточность в мандате:** пункт «the delta added `packages/beads-adapter/package.json` heap flag (61e04e0), `pnpm-workspace.yaml` + lockfile (cfa41fa)» неверен — `git merge-base --is-ancestor` показывает, что оба коммита **предки `db7f14e`**, то есть входят в мой первый диапазон, а `git diff db7f14e..HEAD` по этим трём путям **пуст**. Повторно я их не проверял: и флаг кучи, и воспроизводимость `--frozen-lockfile` уже подтверждены в прошлом проходе, в дельте они не менялись.
2. **Чтение живого профиля.** Гейт `verify-profile.mjs` хеширует три файла живого профиля (`:129-131`) как доказательство «не тронут»; Lead поручил команду явно, поэтому я её выполнил, а не отказался. Запись не производилась, скрипт сам печатает `user profile untouched (3 fingerprint(s) unchanged)`. Если это чтение нежелательно в принципе — гейт стоит научить брать отпечатки из изолированного дома (сейчас он этого не умеет).
3. Дерево после всех проб чистое (`git status --short` пуст), `HEAD` = `3e67584…`, лок `.tmp/build.lock` не создавался и не занимался.

---

### Артефакты проб (`.tmp/`, в git не попадают)

`.tmp/rev-a-6-fixes-tests.ps1` (сюиты + scratch-мутации F-2), `.tmp/rev-a-7-fix-path.ps1` (позитивный путь + первый контроль), `.tmp/rev-a-8-negctl.ps1` (негативный контроль F-1b), `.tmp/rev-a-semver.mjs` (сверка §6.2 и F-3 с semver платформы), `.tmp/rev-a-scratch/` (копия 13 манифестов + теста), логи `rev-a-fixes-*.log`, `rev-a-fix-*.log`, `rev-a-negctl/`.

---

# Дополнение: N1 исправлен (`f054630`) — проверка на опровержимость

- **Tip:** `f0546303ee32c11b0297d18d8a2b8142b1472e2d` (единственный коммит после `3e67584`); `git status --short` пуст до и после.
- **Проверяемый скрипт:** `scripts/verify-profile.mjs`, **sha256 `75450319A228715B3E720A367868DF4FA0B1D0881297371FB13BCAB9F32990A0`** — тот же до и после прогонов.
- **Что именно изменилось** (сверено по диффу `f054630`): `const INACTIVE_MARKERS = ['did not activate', 'failed to import', 'cannot resolve profile bundle']` (было два элемента) плюс комментарий; сам цикл утверждения не менялся (`for (const marker of INACTIVE_MARKERS)`).
- Список маркеров в пробах **парсится из выпущенного файла** (регексп по строке объявления), а не копируется в скрипт проверки.

### Вердикт дополнения: **FIXES VERIFIED**

| Состояние (изолированный `DSH_HOME`, репозиторий не тронут) | boot | Строка DSH (дословно) | Старый список (2 маркера) | Выпущенный список (3) |
|---|---|---|---|---|
| **A**: оба бандла установлены, затем `node_modules/@dsh-mywork/web` удалён, в `dsh.profile.bundles` остался | exit 0 | `dsh: skipping profile bundle "@dsh-mywork/web": Error: dsh: cannot resolve profile bundle "@dsh-mywork/web" from the dsh installation or H:\Repo\DSH-MyWork\.tmp\rev-a-n1-a\home\profiles\n1check; run 'dsh plugin --profile n1check install' if its dependency is not installed` | NONE → **PASS** (это и был пробел N1) | сработал `cannot resolve profile bundle` → **FAIL** |
| **B**: контроллер установлен, `@dsh-mywork/web` объявлен в `dependencies` и в `dsh.profile.bundles`, но пакета нет (полу-успешная установка) | exit 0 | та же строка с путём `…\rev-a-n1-b\home\profiles\n1half` и `dsh plugin --profile n1half install` | NONE → **PASS** | сработал `cannot resolve profile bundle` → **FAIL** |
| **C** (хороший путь): оба бандла установлены | exit 0 | маркеров нет | NONE → PASS | NONE → **PASS** (ложных срабатываний нет) |

Строка состояния A дословно (из `RAW`-вывода пробы, путь профиля в ней — изолированный дом):

```
dsh: skipping profile bundle "@dsh-mywork/web": Error: dsh: cannot resolve profile bundle "@dsh-mywork/web" from the dsh installation or H:\Repo\DSH-MyWork\.tmp\rev-a-n1-a\home\profiles\n1check; run 'dsh plugin --profile n1check install' if its dependency is not installed
```

**Сам гейт на хорошем пути** (пункт 3 мандата): `node scripts/verify-profile.mjs --dsh-bin <checkout>\apps\cli\lib\bin.js` → **exit 0**, `verify:profile: PASS`, оба tarball'а упакованы и установлены, `bundles = ["@deepseek-ai/dsh-sdk-minimal","@dsh-mywork/controller","@dsh-mywork/web"]`, обе строки в композиции, boot — `mounted and unloaded the controller, and every row activated`; **вхождений любого из трёх маркеров в логе гейта — 0**. Живой профиль не изменялся (штатный шаг отпечатков: `user profile untouched (3 fingerprint(s) unchanged)`).

**Вывод.** Пробел N1 закрыт: предикат срабатывает на обоих описанных состояниях (моя конструкция — ровно «бандл в списке, пакета нет в `node_modules`»), до `f054630` те же состояния давали PASS, а на хорошем пути ложных срабатываний нет. Остаточное свойство, а не дефект: защита фразовая — если DSH когда-нибудь законно напечатает `cannot resolve profile bundle` в успешном прогоне, гейт упадёт; в этом профиле оба бандла устанавливаются скриптом, поэтому такой прогон означал бы реальную поломку.

### Записано, не исправляется (по решению Lead'а)

- **N2** — у `packUi` (`scripts/pack.mjs:117`) нет собственного теста идемпотентности: `tests/scripts-pack-idempotent.test.mjs` упражняет только `packController`; сквозное покрытие даёт гейт (пакует оба бандла). Остаётся записанным.
- **N3** — `.work/plan-v0.3/20-STEPS-foundation.md:1650` по-прежнему предписывает «→ **12** совпадений»; файл плана принадлежит владельцу (`plan-foundation`), ни Lead, ни я его не правим. Критерий переформулирован в `foundation-stage3-gate.md` §6.1 и исполняется `tests/peer-gate.test.mjs:195` (`mentions` == `CARRIERS`). Остаётся записанным дефектом плана для следующего исполнителя.
- Уточнение к прошлому разделу: замечание о мандате («delta added 61e04e0 / cfa41fa») Lead признал своей ошибкой — оба коммита предки `db7f14e` и в дельте не менялись.

### Артефакты дополнения

`.tmp/rev-a-9-n1.ps1` (все три состояния + разбор выпущенного списка маркеров), `rev-a-n1-pack.log`, `rev-a-n1-a/*`, `rev-a-n1-b/*`, `rev-a-n1-c/*` (логи create/add/boot каждого дома), `rev-a-n1-verifyprofile.log`.

> Ошибка в первой редакции пробы (PowerShell возвращал из функции и лог-строку, и путь) была исправлена, и проба прогнана заново; числа выше — из чистого прогона. Репозиторий при обеих редакциях не изменялся.
