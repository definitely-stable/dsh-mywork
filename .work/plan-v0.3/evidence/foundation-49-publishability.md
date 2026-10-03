# F-49 · Публикуемость: `private: true`, `files` и канал tarball

- **Шаг плана:** `20-STEPS-foundation.md` F-49 (@1338). **Карточки:** MW-040/041, P10.
- **Ревизии:** база `d0c97bf`; `HEAD` во время работы `e28ff0b`; дерево грязное (чужие правки, включая пакет `packages/web` — F-58, untracked). Мои отслеживаемые изменения: `?? tests/publish-manifest.test.mjs`.
- **Коммит шага:** `1a01476` — `test(controller): pin the publishability surface the tarball channel rests on` (файл: `tests/publish-manifest.test.mjs`; 1 file changed, 99 insertions). Evidence-файл не коммитится: `.work/` игнорируется git (`.gitignore:1`) — см. §5.4.
- **Вывод по существу:** правки манифестов **не требовалось** — `private: true` и `files` уже стоят у всех пакетов; шаг свёлся к проверке (шаг 3 плана: «`files` уже настроен у всех 12 — правка не требуется») и к исполняемому тесту.

## 1. Таблица «пакет → private → files» (шаг 1)

Команда: `Get-ChildItem packages -Directory | ForEach-Object { $j = Get-Content "packages\$($_.Name)\package.json" -Raw | ConvertFrom-Json; "{0,-30} private={1,-6} files={2}" -f $j.name, $j.private, ($j.files -join ',') }` → exit 0, **13** строк:

```
@dsh-mywork/adapter-sdk        private=True   files=lib
@dsh-mywork/beads-adapter      private=True   files=lib
@dsh-mywork/contracts          private=True   files=lib
@dsh-mywork/controller         private=True   files=lib,cordis.patch.yml
@dsh-mywork/core               private=True   files=lib
@dsh-mywork/evidence           private=True   files=lib
@dsh-mywork/execution          private=True   files=lib
@dsh-mywork/lease              private=True   files=lib
@dsh-mywork/memory-native      private=True   files=lib
@dsh-mywork/planner            private=True   files=lib
@dsh-mywork/scheduler          private=True   files=lib
@dsh-mywork/storage            private=True   files=lib
@dsh-mywork/web                private=       files=lib,icon.svg      ← F-58, untracked, единственное исключение D18
```

Гейт-команды плана (дословно) и фактические числа:

| Команда | Exit | Наблюдение |
|---|---|---|
| `Select-String -Path packages\*\package.json -Pattern '"private": true'` | 0 | **12** совпадений — ровно как в плане |
| `Select-String -Path packages\*\package.json -Pattern '"files"'` | 0 | **13** совпадений — на одно больше плана: `files` объявил 13-й пакет `@dsh-mywork/web` |
| `(Get-ChildItem 'packages\*\package.json').Count` | 0 | **13** манифестов |
| `Select-String -Path packages\*\package.json -Pattern 'publishConfig'` | 0 | **0** — ни один пакет не настроен на реестр |

То есть `private: true` по-прежнему **12/12 у «настоящих» пакетов**, а `files` — **13/13** (все, что есть в дереве). Расхождение с числом «12» в шаге 3 плана вызвано появлением `packages/web` (F-58), а не F-49. Контрольный прогон после того, как соседняя сессия **закоммитила** web (`63d7c80`), даёт те же числа: `private true: 12`, `files: 13` — то есть это устойчивое состояние дерева, а не незакоммиченный шум; у `@dsh-mywork/web` по-прежнему нет `private` и `files = ["lib","icon.svg"]`.

## 2. Решение D04/D18 — что осталось неизменным

- **D04 (вариант B):** peers по имени пакета платформы; распространение **tarball'ом**; `private: true` сохранить у всех, кроме будущего `@dsh-mywork/web` (решение по нему — D18). Ничего не снималось и не добавлялось.
- **D18:** `@dsh-mywork/web` — единственный кандидат на снятие `private`. В дереве у него `private` **отсутствует** (то есть пакет публикуем) — это состояние F-58, не F-49; мой тест разрешает ровно это и fails, если `private` снимет кто-то другой.
- **`private: true` не мешает tarball-установке** (`lead-03-peer-gate.md` п. 15 + мой прогон `verify:profile`, `foundation-48-peer-contract.md` §8): внутри tarball'а `private` сохраняется, но `dsh plugin add <tarball>` ставит бандл и монтирует его.

## 3. Падающий тест → зелёный (шаг 6)

- До правки: `node --test --test-isolation=none tests/publish-manifest.test.mjs` → **exit 1**, `Could not find 'tests/publish-manifest.test.mjs'`.
- После: `node --test --test-isolation=none tests/peer-gate.test.mjs tests/publish-manifest.test.mjs` → **exit 0**, `ℹ tests 9  ℹ pass 9  ℹ fail 0` (общий прогон двух шагов).

`tests/publish-manifest.test.mjs` (4 теста) проверяет: у каждого найденного манифеста непустой `files`, включающий `lib` и не включающий исходники (`src`, `.`); каждый пакет `private: true` **кроме** одного допустимого исключения `@dsh-mywork/web` (D18) и отсутствие `publishConfig`; `dsh.bundle.patch` каждого бандла лежит внутри его же `files` **и существует на диске**; у controller пин `private`, `files = ["lib","cordis.patch.yml"]`, имя и версия (имя tarball'а выводится из версии). Непроверочная ветка исключена: guard'ы `all.length >= 12`, `withPatch.length >= 1` делают выборки непустыми.

Мутации (`.tmp/f48-mutations.ps1`, полная таблица — `foundation-48-peer-contract.md` §7): M4 «убрать `cordis.patch.yml` из `files`» → exit 1, `pass 2 / fail 2`; M5 «`private: true` → `false`» → exit 1, `pass 2 / fail 2`; после восстановления манифест побайтово исходный (`sha256=D2F9810A6CE54DD0`), прогон `pass 9 / fail 0`.

## 4. Канал tarball: что именно уезжает (шаг 5)

Команда: `node scripts/pack.mjs` → **exit 0**:

```
pack: @dsh-mywork/controller@0.1.0
H:\Repo\DSH-MyWork\.tmp\pack\dsh-mywork-controller-0.1.0.tgz
```

Размер **534 435 байт** (непустой). Содержимое (`node .tmp/f49-tarball-probe.mjs`, `tar -tzvf` + распаковка в `.tmp/f49-tarball/`):

```
package/cordis.patch.yml            984
package/lib/index.d.ts           163551
package/lib/index.d.ts.map        34575
package/lib/index.js             462230
package/lib/index.js.map        1457203
package/package.json               1267
package/LICENSE                    1095
```

- Внутри ровно allowlist (`lib`, `cordis.patch.yml`) плюс всегда добавляемые npm `package.json`/`LICENSE`; ни `src`, ни `tsconfig`, ни тестов.
- `package/lib/index.js` побайтово равен собранному `packages/controller/lib/index.js` (sha256-префикс **8be915ab28e489ed** у обоих, 462 230 байт).
- **Импортов `@dsh-mywork/` внутри нет: 0.** Единственный внешний не-`node:` спецификатор — `@deepseek-ai/cordis`; остальные — `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:sqlite`, `node:util`. (Оговорка: скрипт-извлекатель спецификаторов — грубая регулярка, поэтому в «шум» попали строковые литералы бандла; набор найденных реальных спецификаторов от этого не зависит.)
- Манифест внутри tarball'а: `private: true` сохранён, `files: ["lib","cordis.patch.yml"]`, `peerDependencies: {"@deepseek-ai/cordis":"^4.0.2","@deepseek-ai/dsh":">=0.1.7-rc.2 <0.2.0"}` (F-48), `engines.node`, `dsh.bundle.patch`, а `devDependencies` `workspace:*` переписаны в `0.1.0` — то есть гейт совместимости сработает и у потребителя tarball'а.
- Провенанс сборки: `packages/controller/lib/index.js` (mtime `2026-09-27 14:54:35`) — сборка **до** моих правок и до части чужих; мой шаг бандл не пересобирал (правка манифеста содержимого бандла не меняет), и `lib/` в git не входит (`.gitignore:14 packages/*/lib/`). Финальная сборка — за F-60.

## 5. Расхождения с планом

1. **F-49 «Проверенные факты» п. 1 и гейт «12 совпадений»** для `files` устарели: в дереве 13 манифестов (появился `packages/web`, F-58). `private: true` — по-прежнему 12.
2. **F-49 шаг 5 «убедиться, что внутри нет `@dsh-mywork/*`-импортов»** выполнен на 13-пакетном дереве и на бандле, собранном до правок чужих сессий; сам факт инлайна проверяется и `tests/boundaries.test.mjs:251-279` (файл Lead'а — я его не менял).
3. **Гибрид: `files` у `@dsh-mywork/web` = `["lib","icon.svg"]`** — тоже «не источники», под общее правило теста проходит; но пакет F-58 вне моего scope, и его публикуемость (D18) требует отдельного решения владельца.
4. **Evidence-файл не коммитится** (`.work/` в `.gitignore:1`); коммит F-49 — только `tests/publish-manifest.test.mjs`.

## НЕ ПРОВЕРЕНО

- `pnpm publish --dry-run` не запускался: ни один пакет не публикуется (кроме, возможно, будущего `web`), и запуск тянул бы реестр.
- Не проверялось, что `dsh plugin add <tarball>` отвергнет tarball с `private: true` (прецедент `verify:profile: PASS` показывает обратное).
- `packages/web` (F-58) не инспектировался сверх манифеста: его `files`, сборка и публикуемость — не мой scope.
- Полный набор тестов воркспейса не прогонялся: `tests/boundaries.test.mjs` в текущем дереве не загружается (`missing build output: packages/beads-adapter/lib/index.js`, exit 1) — состояние сборки, не F-49.
- Tarball собран из бандла mtime 14:54:35; после этого чужие сессии меняли `packages/controller/src` — в tarball'е этих правок нет (влияет на «свежесть», не на allowlist/инлайн).

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-49-publishability.md
