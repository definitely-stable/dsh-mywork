# lead-03 · peer-gate DSH 0.1.7-rc.2 и блокеры распространения MyWork

Ревизии: DSH `c7c4c725c7` (= `0.1.7-rc.2`), MyWork `0c657ae` (tree clean). Метод: только чтение; `pnpm`/`install`/`build`/`scripts/pack.mjs` не запускались.

## Факты

### А. Гейт совместимости

1. **Поле.** Единственный вход — `peerDependencies` (`packages/boot/app-boot/src/plugin-compatibility.ts:68`): нет ключа — вердикт `undefined`. `engines` объявлен в типе (`packages/util/package-manifest/src/types.ts:23-24,56-66`), но **не читается нигде**: rg `engines` по `packages/**/*.ts` даёт только `types.ts` + реэкспорт `index.ts:9`; `dsh?.engines|engines?.dsh` — 0 совпадений. Документация подтверждает: «These checks use peer declarations, not `engines.dsh`» (`packages/boot/app-boot/README.md:52`).
2. **Субъект.** `plugin-compatibility.ts:71-75` — проверяются только `@deepseek-ai/dsh` и `@deepseek-ai/dsh-*`; `@deepseek-ai/cordis`, `react` и прочее пропускаются (`continue`).
3. **Версия рантайма.** `:44-49` `getDshRuntimeVersion()` читает `../package.json` пакета **app-boot** (`@deepseek-ai/dsh-app-boot@0.1.7-rc.2`), не CLI. CLI сейчас тоже `0.1.7-rc.2` (`apps/cli/package.json`).
4. **Сравнение.** `:76-77`: `semver.satisfies(runtime, range, { includePrerelease: true })`; `workspace:^|~|*` подменяются текущей версией; пустая строка и невалидный диапазон = несовместимость. Корректен диапазон, для которого `satisfies` истинно.
5. **Диапазоны** (проверено `semver@7.7.4` из `.pnpm`, node -e, read-only): `^0.1.7` (десугар `>=0.1.7-0 <0.2.0-0`) ⇒ **true**; `^0.1.7-rc.2` ⇒ **true**; `>=0.1.7-rc.2 <0.2.0` ⇒ **true**; `*` ⇒ true. **ЛОВУШКА:** руками написанный `>=0.1.7 <0.2.0` ⇒ **false**; `~0.1.7` (десугар `>=0.1.7 <0.2.0-0`) ⇒ **false**. Для `>=0.1.7-rc.2 <0.2.0`: `0.1.7` true, `0.1.8` true, `0.2.0-rc.1` true, `0.2.0` false.
6. **Точный отказ** (`plugin-compatibility.ts:96-102`, дословно): `Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies {...}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for <name>@<version> on dsh <runtime> with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: active|not active.`
7. **Где отказ срабатывает.** Типизированный код `incompatible-version` (`packages/boot/plugin-manager/src/types.ts:22`, запись `incompatible: IncompatiblePlugin[]` — `failure.ts:8-18`); операции: `index.ts:302` (listBundles), `:723` (выбор бандла), `operations.ts:510,547`; строка стдин `dsh: installation rejected: …` + `exitCode 1` (`operations.ts:324-331`); подсказка CLI `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <exact> --accept-risk` (`apps/cli/src/plugin.ts:100`; переанкорено 2026-10-03: было `:78`); старт профиля — `dsh: disabling profile plugin <row>: <reason>` (`compatibility-preflight.ts:79-83`), бандл молча уходит в `skippedBundles` (`profile.ts:674-680`). Невалидируемые peer-поля отказывают: «its declared peer dependencies cannot be validated: …» (`compatibility-preflight.ts:107-112`).
8. **Exemption.** Только профильный файл `<profileDir>/compatibility.json` (`profile-compatibility.ts:10`), формат `{"@scope/name@1.2.3": ["0.1.7-rc.2"]}` — точный `package-name@version` → список точных версий DSH (`:24-27,80-91`), запись атомарная, mode `0600`, под файловой блокировкой (`:113-140`). Грант требует `acceptRisk: true` (`:117-119`) и версию, равную текущей (`:121-123`). Выдаёт **человек**: CLI `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <exact> --accept-risk` (также `revoke-version`, `version-exemptions` — `apps/cli/src/plugin.ts:19` и `:36` (переанкорено 2026-10-03: было `:13`, `:30`)), либо сервис/UI `setVersionExemption(packageVersion, runtimeVersion, enabled, acceptRisk)` (`docs/subsystems/boot.md:96-105`). Агентский `plugin_manager` тоже умеет `set_version_exemption`, но требует `acceptRisk` и явного согласия пользователя.
9. **Область применения — не только реестр.** Пре-флайт до `pnpm`: локальный **путь** читается с диска, реестровая спецификация — через `pnpm view … peerDependencies` (`operations.ts:167-188,338-351`); tarball/git пре-флайта не имеют и судятся **после** установки, с откатом `package.json`/lockfile и переустановкой (`operations.ts:172-176,465-520`). Плюс независимый стартовый гейт на каждую строку композиции (`compatibility-preflight.ts:105`) и на каждый бандл (`profile.ts:674`) — то есть распакованный tarball тоже блокируется. Не покрыты: контекст без `profileContext` (`compatibility-preflight.ts:94`) и монтирование чужим embedder'ом.

### Б. Блокеры распространения MyWork

10. `private: true` — **12/12** `packages/*/package.json`; `"files"` — 12/12; `"engines"` в пакетах — **0/12**. Корень: `package.json:4` `private`, `:9-11` `engines.node = ">=22.18.0"` — шире, чем у DSH (`^22.19.0 || >=24.0.0`, допускает 22.18 и 23.x).
11. `packages/controller/package.json`: `:4` private, `:17-20` files=`lib`+`cordis.patch.yml`, `:21-25` `dsh.bundle.patch`, `:30-32` **единственный** peer — `@deepseek-ai/cordis: ^4.0.2` (вне неймспейса гейта ⇒ гейт молчит), `:33-38` devDeps `@dsh-mywork/{adapter-sdk,contracts,core}: workspace:*`.
12. Реальные импорты из `@deepseek-ai/*` во всём MyWork — **5 совпадений, все `@deepseek-ai/cordis`**: `controller/src/{index.ts:12 (Service, Context), model-catalog.ts:23, dsh-session.ts:31}` (только типы), `beads-adapter/src/{memory-plugin.ts:22, plugin.ts:15}` (только типы). Ни одного `@deepseek-ai/dsh-*`; ни один пакет не объявляет `inject`-сервисов.
13. `scripts/pack.mjs:30-32` (guard на `lib/index.js` — **проходит**, файл есть, 88 905 б, 22.09) → `:34-39` `runPnpm(['pack'])` → `:41-43` `throw pack: pnpm pack exited with code N`. Причина EXIT=1 подтверждена логом `.tmp/pack-logs/pnpm-pack.err.log:1-2` (227 б, mtime 26.09.2026 23:01:17): `'"H:\.pnpm-store\v11\links\@\pnpm\12.4.2\…\bin\..\node_modules\pnpm\pnpm"' is not recognized as an internal or external command`. Механика: `scripts/lib/process.mjs:52-58` — `npm_execpath` не оканчивается на `.js/.cjs/.mjs` (там путь без расширения) ⇒ regex `:54` не срабатывает ⇒ ветка `{ command: 'pnpm', shell: true }` ⇒ cmd.exe находит 52-байтный битый шим. Не дефект `pack.mjs`.
14. Идемпотентность `packController`: `:33` снимает множество **имён** `*.tgz` до запуска, `:44-47` требует ровно один **новый** `.tgz`. `pnpm pack` всегда пишет `dsh-mywork-controller-<version>.tgz`: если такой файл уже лежит в `packages/controller` (краш, ручной `pnpm pack`), он перезаписывается под тем же именем ⇒ `produced = []` ⇒ `Error: pack: expected exactly one new tarball … found []`. Имя версионно-детерминировано, поэтому дефект системный, а не «посторонний мусор». Воспроизведение безопасно: `New-Item packages\controller\dsh-mywork-controller-0.1.0.tgz -Force` (сейчас 0 `.tgz` в каталоге).
15. Артефакт (последний удачный прогон 17.09): `.tmp/pack/dsh-mywork-controller-0.1.0.tgz`, 9 030 б; `tar -xOf … package/package.json` показывает, что в tarball **сохраняются** `"private": true` и devDeps `@dsh-mywork/*` с переписанным `workspace:*` → `0.1.0`. Внутри только `cordis.patch.yml`, `lib/*`, `package.json`, `LICENSE`; workspace-пакеты инлайнятся (`packages/controller/tsdown.config.ts:17-20`). `private: true` установке **не мешает** (прецедент: `verify:profile: PASS`, `.work/analysis/2026-09-26/F-gaps.md:245`), devDeps зависимости не устанавливаются — это блокер публикации/линта, не установки.
16. CI и тегов нет: `.github` отсутствует (`Test-Path` → False), `git tag` → пусто (exit 0), при этом `origin = https://github.com/definitely-stable/dsh-mywork.git`.
17. Бенчмарк экосистемы — живой `@linxin666/dsh-client-ui-task-board@0.4.3` (`%USERPROFILE%\.dsh\profiles\web\node_modules\@linxin666\…\package.json`): `peerDependencies: {"@deepseek-ai/dsh": ">=0.1.7-rc.2", "react": "^18.2.0"}`, `devDependencies` со всеми `@deepseek-ai/dsh-*@^0.1.7-rc.2`, плюс **нестандартный** `dsh.engines.dsh = ">=0.1.7-rc.2"` (тип `DshManifest` такого поля не объявляет — читает его только человек). `@deepseek-ai/dsh` опубликован: registry 200, `dist-tags.next = 0.1.7-rc.2`.

### В. Предлагаемый дословный блок для `packages/controller/package.json`

18. (замена `:30-32` и добавление рядом; `devDependencies` не менять — `@deepseek-ai/dsh` в devDeps тянуть не нужно, иначе `auto-install-peers` вытащит весь CLI)

```json
"engines": {
  "node": "^22.19.0 || >=24.0.0"
},
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.0.2",
  "@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.2.0"
},
```

`engines` здесь — только для pnpm/читателя (DSH его игнорирует); `@deepseek-ai/cordis` гейт не смотрит, но он нужен резолверу (`neverBundle`, `tsdown.config.ts:19`). `>=0.1.7-rc.2 <0.2.0` — версионно-независимый эквивалент `^0.1.7`; `*` и `workspace:*` тоже пройдут, но обесценивают гейт.

## Опровержения/неожиданное

1. **Ожидание «`^0.1.7` не покроет `0.1.7-rc.2`» ложно:** semver 7 десугарит caret в `>=0.1.7-0 <0.2.0-0`, и с `includePrerelease` RC подходит. Настоящая ловушка — `~0.1.7` и руками написанный `>=0.1.7 <0.2.0` (оба **false**). Любая карточка, требующая «диапазон с `-0`/явным RC», права по результату, но не по причине.
2. **Гейт смотрит не на CLI, а на `@deepseek-ai/dsh-app-boot`.** Peer `@deepseek-ai/dsh: …` проверяется против версии app-boot; сейчас числа совпадают, но это неявная связка.
3. **`engines` (в т.ч. `dsh.engines.dsh`) не читает никто** — популярный в экосистеме `dsh.engines.dsh` (есть у task-board) чисто декоративен.
4. **`@deepseek-ai/cordis` — не «свой» неймспейс гейта.** Единственный объявленный peer MyWork сегодня гейт не проверяет вообще; «гейт молчит» ≠ «MyWork совместим».
5. **`private: true` не мешает `dsh plugin add <tarball>`** и сохраняется внутри tarball'а; `devDependencies` зависимости не ставятся — значит пункт «devDeps на непубликуемые `@dsh-mywork/*`» не блокирует доставку tarball'ом (в отличие от `pnpm publish`).
6. **Падение `pack.mjs` — не дефект `pack.mjs`**: guard сборки проходил, падал `pnpm` через битый store-шим. Правка `pack.mjs` в F-23 обязана чинить `scripts/lib/process.mjs:52-58`, иначе EXIT=1 останется.

## Не проверено

1. `node scripts/pack.mjs` и `pnpm` не запускались (запрет) — причина EXIT=1 выведена из кода + сохранённого лога `.tmp/pack-logs/pnpm-pack.err.log`; живое воспроизведение не делалось.
2. Гейт на «распакованном» tarball проверен по коду (`operations.ts:465-520`, `compatibility-preflight.ts:105`), но не экспериментом: tarball с несовместимым peer не собирался.
3. Порядок/поведение `pnpm` при `auto-install-peers` для нового peer `@deepseek-ai/dsh` в этом монорепо не измерялись.
4. `dist-tags` и наличие `@deepseek-ai/dsh@0.1.7-rc.2` смотрелись в реестре npm (200), но фактическая установка/резолв из сети не выполнялись.

## Что это значит для плана

1. D04/MW-060: диапазон `>=0.1.7-rc.2 <0.2.0` верен и подтверждён; `~0.1.7` и `>=0.1.7 <0.2.0` запрещены как молча ломающие гейт.
2. `engines.dsh` вычёркивается из «контракта совместимости» — оставить как документацию, гейт держит только `peerDependencies`.
3. Объявляя `@deepseek-ai/dsh`, MyWork **включает** для себя гейт: при DSH 0.2.x бандл уйдёт в `skippedBundles` без строки в композиции — это и есть желаемое «падать громко», но нужен тест на этот путь.
4. F-23 обязана адресовать `scripts/lib/process.mjs:52-58` (ветка `shell:true`), F-24 — удалять/игнорировать одноимённый `.tgz` до `pnpm pack`, а не сравнивать множества имён.
5. `private`/`devDependencies` на `@dsh-mywork/*` — блокеры **реестра**, не tarball-доставки: снятие `private` даёт необратимость без выгоды (подтверждает ADR-032).
