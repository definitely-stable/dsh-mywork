# F-58 — installable UI-пакет `@dsh-mywork/web`: структура и `dsh.client`-манифест

Пакет: `packages/web` · Коммиты: `63d7c809b71663e76b9b866bbcf94d7fbac7d3e6` (F-58, base `d0c97bf`) + delta-фикс F-1 ревью A (task-9, «ряд объявляет пакет, который им владеет») · Автор: `ui-package` (task-4/task-9)

## ПОДТВЕРЖДЕНО

### 0. Предусловие (F-49/D04/D18): 12/12 `private` + 12/12 `files`
Команда (exit 0), перебор `packages/*/package.json` через `ConvertFrom-Json`:
`adapter-sdk, beads-adapter, contracts, controller, core, evidence, execution, lease, memory-native, planner, scheduler, storage` →
`count=12 privateTrue=12 hasFiles=12`.
- До правки: все 12 `private=true` и у всех 12 есть `files`.
- После правки (тест `tests/ui-package.test.mjs`, тест 1) тот же набор: 12 `private=true` + `files`, и ровно один publishable-манифест — `@dsh-mywork/web`.
- **ОПРОВЕРГНУТО план-уровневое:** `22-STEPS-surface.md` шаг `B-01a` (строки 302–321) в скелете **того же** пакета предписывает `"private": true`, а его собственный риск 2 говорит «снятие `private` — решение D04, не этого шага». Это противоречит D18/F-58 (снятие только здесь). Я следовал D18/F-58: в `packages/web/package.json` ключа `private` нет вовсе. Правка `B-01a` — вне моей зоны записи, отдаю Lead'у.

### 1. Манифест (`packages/web/package.json`)
- `name: "@dsh-mywork/web"` (имя D18), `version: "0.1.0"`, `type: "module"`, `private` — **отсутствует** (снят только здесь, D04).
- `icon: "./icon.svg"` — **верхнего уровня**, не внутри `dsh.client` (`packages/util/package-manifest/src/types.ts:16`; `packages/boot/app-boot/src/package-meta.ts:163`).
- `exports["./client"] = { types: "./lib/types/client/index.d.ts", default: "./lib/client.js" }` — форма, которую принимает `clientExportOf` (`packages/client/modules/src/index.ts:195-205`: строка или объект со строкой `default`).
- `dsh.client = { "platform": "web" }` — `parseDshClient` требует только `platform` и принимает ровно `platform/inject/external/immediately` (`packages/client/modules/src/client/manifest.ts:161-181`). `inject`/`external`/`immediately` не объявлены намеренно: `react` и `@deepseek-ai/dsh-client-store` — это `PLATFORM_MODULES` (ровно 9 имён, `packages/client/web/src/platform.ts:8-14`), т.е. база, а не `external`.
- `dsh.bundle.patch = "./cordis.patch.yml"` — **добавлено delta-фиксом** (см. §4): пакет сам объявляет свой ряд, как референс 0.4.3.
- `dsh.engines.dsh = ">=0.1.7-rc.2 <0.2.0"`, `peerDependencies = { "@deepseek-ai/dsh": ">=0.1.7-rc.2 <0.2.0", "react": "^18.2.0" }` (D04 — гейт читает имя пакета; react — `^18.2.0` как у платформы и у референса 0.4.3).
- `files = ["lib", "cordis.patch.yml", "icon.svg"]` — покрывает `lib` (включая `lib/client.js`), иконку и **патч** (иначе ряд не доехал бы до потребителя).
- **Уточнено:** `dsh.engines` не объявлен в типе `DshManifest` (`packages/util/package-manifest/src/types.ts:30-39` — там только `manifestVersion/bundle/profile/client`), но именно так пишет референсный установленный плагин 0.4.3 и так предписывает `B-01a`. Следовал конвенции кампании, а не типу.

### 2. R-08 — `clean: true` не стирает рукописный бандл (механизм в build-скрипте)
- `packages/web/tsdown.config.ts` оставлен с **`clean: true`** — как все 12 существующих.
- `package.json.scripts.build = "node --max-old-space-size=8192 ../../node_modules/tsdown/dist/run.mjs && node scripts/build-client.mjs"` — пересборка клиентской половины **после** очистки (вариант «б» шага F-58.3), зафиксирована в скрипте, а не в голове исполнителя.
- `packages/web/scripts/build-client.mjs` копирует `src/client/index.js → lib/client.js` и `src/client/index.d.ts → lib/types/client/index.d.ts`; перед копированием бросает, если в источнике нет `window.__ModuleLoader__.load(`.
- **Команда-доказательство (шаг 1):** удалить артефакт и прогнать полную сборку.
  `Remove-Item packages\web\lib\client.js` → `after_remove_exists=False`;
  `corepack pnpm -r run build` → `BUILD_EXIT=0`, `after_build_exists=True`;
  SHA256 до удаления `8436E8C0…F68E` = SHA256 после сборки `8436E8C0…F68E` (побайтово тот же файл).
  `CreationTime` артефакта стал `18:28:19` (файл физически пересоздан), `LastWriteTime` `18:24:34` — это время **источника** (`copyFileSync` на Windows переносит mtime источника; проверено отдельным экспериментом `.tmp/mtime-*`: `src_mtime == dst_mtime`, `dst_creation` новее).
- **Команда-доказательство (шаг 2, что clean действительно стирает):** в логе финальной полной сборки
  `packages/web build: ℹ Cleaning 9 files` → затем `web: wrote lib\client.js` и `web: wrote lib\types\client\index.d.ts`. То есть 9 файлов (включая прошлые `lib/client.js` и `lib/types/client/index.d.ts`) были удалены tsdown и возвращены build-скриптом.
- `Test-Path packages\web\lib\client.js` → **True** после полной сборки (проверено в трёх разных прогонах).

### 3. Формат бандла — классический скрипт (не ESM)
`Get-Content packages\web\lib\client.js -TotalCount 4`:
```
1: window.__ModuleLoader__.load({
2:   id: '@dsh-mywork/web',
3:   factory: (require) => {
4:     /**
```
- Первая строка файла — сама регистрация (конверт не спрятан под заголовком).
- Тест `tests/ui-package.test.mjs` утверждает: первая строка ровно `window.__ModuleLoader__.load({`; в файле нет `^\s*export\s`/`^\s*import\s`/`export default`; `lib/client.js` **побайтово равен** `src/client/index.js` (копия, не переписывание).
- Форма подтверждена независимо: живой `lib/client.js` 0.4.3 (`head`, exit 0) — `window.__ModuleLoader__.load({ id: "@linxin666/dsh-client-ui-task-board", factory: (require) => {`; `scripts/publint-all.ts:183` — «evaluated by the page module system as a classic script».
- Тест грузит бандл так, как это делает страница: `new Function('window', source)({ __ModuleLoader__: { load } })` → ровно одна регистрация, `id === '@dsh-mywork/web'`, `typeof factory === 'function'`, `factory(require-заглушка)` отдаёт `apply` (функция) и `inject` (массив).

### 4. Строка клиента — bare-имя, и объявляет её сам пакет (delta после review A, F-1)
**Было (коммит `63d7c80`, ОПРОВЕРГНУТО ревью):** ряд `mywork-web` лежал в `packages/controller/cordis.patch.yml`. Ревью A (finding F-1, MAJOR, `.work/plan-v0.3/evidence/verify-stage3-review-a.md:53-73`) измерило в изолированном `DSH_HOME` на реальном CLI DSH, установив ровно тот tarball, который отдаёт `scripts/pack.mjs`:
```
profile node_modules/@dsh-mywork = controller        # web отсутствует
- id: mywork-web  name: '@dsh-mywork/web'            # строка в композиции есть
dsh: warning: 1 entry did not activate
mywork-web (@dsh-mywork/web): failed to import
BOOT_EXIT=0
```
То есть строка не разрешалась (пакет не был ни зависимостью контроллера, ни в его tarball, ни в чьём-либо `pack`), отказ был **бесшумным** (`exit 0` + warning), а гейт `verify:profile` оставался зелёным, потому что проверял только строку контроллера. Цель F-58 («бандл физически регистрируется в клиенте») в единственном объявленном канале доставки не достигалась.

**Стало (delta-коммит):** ряд объявляет сам пакет, владеющий половиной:
- `packages/web/cordis.patch.yml` — `- insert: - id: mywork-web / name: '@dsh-mywork/web'` (bare-имя);
- `packages/web/package.json`: `dsh.bundle.patch = "./cordis.patch.yml"` (рядом с `dsh.client.platform = "web"` — форма установленного референса 0.4.3: `dsh.bundle.patch` + `dsh.client` в одном манифесте), `files = ["lib","cordis.patch.yml","icon.svg"]`;
- `packages/controller/cordis.patch.yml` — ряд `mywork-web` **удалён**: `Select-String -Path packages\controller\cordis.patch.yml -Pattern '@dsh-mywork/web'` → **0** совпадений, имена рядов ровно `['@dsh-mywork/controller']`.
- Тест `tests/ui-package.test.mjs` (тест 7) закрепляет: `dsh.bundle.patch` указывает на `./cordis.patch.yml`; патч едет в `files`; ряд в своём патче ровно один и по bare-имени (подпути нет); патч контроллера не содержит строки `@dsh-mywork/web` вообще и объявляет только свой ряд.
- **Доставляемость (проба, не правка чужого канала):** `.tmp/t9-pack-probe.mjs` пакует `packages/web` тем же shell-free запуском pnpm, что и `scripts/pack.mjs` (`runPnpm` из `scripts/lib/process.mjs`, `pnpm pack`) → `PACK_STATUS=0`, tarball `dsh-mywork-web-0.1.0.tgz`; `tar -tzf` внутри: `package/cordis.patch.yml`, `package/lib/client.js`, `package/lib/types/client/index.d.ts`, `package/icon.svg`, `package/package.json`; в упакованном манифесте `dsh.bundle.patch=./cordis.patch.yml`, `dsh.client.platform=web`, `exports["./client"].default=./lib/client.js`, `private` пуст.
- **Что этим НЕ закрыто (канал Lead'а, task-9 явно запрещает мне его трогать):** `scripts/pack.mjs` по-прежнему пакует только контроллер, и `scripts/verify-profile.mjs` не проверяет `did not activate`. Пока профиль не установит второй tarball и не перечислит `@dsh-mywork/web` в `dsh.profile.bundles`, ряд из моего патча не будет применён — но теперь ни один патч не называет пакет, которого у профиля нет.
- Обоснование bare-имени — `docs/cookbook/adding-a-settings-card.md:58` («a row mounted from a subpath export never carries a half»).

### 5. Гейты
| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/ui-package.test.mjs` (до реализации) | 1 | `# tests 5`, `# pass 0`, `# fail 5` — RED |
| `corepack pnpm -r run typecheck` (13 пакетов) | **0** | в выводе `packages/web typecheck: Done` наряду с 12 остальными |
| `node ..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` (в `packages\web`) | 0 | изолированная проверка нового пакета |
| `node --test --test-isolation=none tests/ui-package.test.mjs` (после сборки) | **0** | `# tests 5`, `# pass 5`, `# fail 0` — GREEN |
| `node --test --test-isolation=none tests/boundaries.test.mjs tests/reachability.test.mjs tests/adapters.test.mjs` | **0** | `# tests 47`, `# pass 47`, `# fail 0` — 13-й пакет **не** красит ни одного из трёх тестов Lead'а |
| `corepack pnpm -r run build` | **1** | падает `packages/beads-adapter` — `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory`, exit 134, `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` |
| `corepack pnpm -r --filter @dsh-mywork/beads-adapter run build` (пакет **отдельно**) | 1 | тот же OOM → это не конкурентность сборки |
| `Move-Item packages\web\package.json .tmp\…` → `corepack pnpm -r --filter @dsh-mywork/beads-adapter run build` → вернуть манифест | 1 | тот же OOM **без `packages/web` в workspace** → OOM не вызван 13-м пакетом (манифест возвращён, SHA256 совпал) |
| `$env:NODE_OPTIONS='--max-old-space-size=8192'; corepack pnpm -r run build` | **0** | все 13 пакетов собраны, `packages/web/lib/index.js` и `lib/client.js` на месте |
| `node --test --test-isolation=none tests/ui-package.test.mjs tests/ui-attributes.test.mjs` (после delta-фикса F-1) | **0** | `# tests 7`, `# pass 7`, `# fail 0` |
| `Select-String -Path packages\controller\cordis.patch.yml -Pattern '@dsh-mywork/web'` | 0 | **0 совпадений**; ряд называет `packages/web/cordis.patch.yml` |
| `.tmp/t9-pack-probe.mjs` (`pnpm pack` тем же shell-free запуском, что `scripts/pack.mjs`) | **0** | `dsh-mywork-web-0.1.0.tgz`: `package/cordis.patch.yml`, `package/lib/client.js`, `package/lib/types/client/index.d.ts`, `package/icon.svg`, `package/package.json`; в упакованном манифесте `dsh.bundle.patch=./cordis.patch.yml`, `dsh.client.platform=web`, `private` пуст |

**Итог по R-08-гейту:** критерий «`Test-Path packages\web\lib\client.js` → True после полной сборки» выполнен; полная сборка проходит при поднятом heap. Канонический `corepack pnpm -r run build` **сейчас красный по причине, к моему шагу не относящейся** — см. ниже.

### 6. Прочее, зафиксированное наблюдением
- Первый канонический прогон `corepack pnpm -r run build` в этой сессии напечатал `BUILD_EXIT=0` (лог не сохранялся); два последующих канонических прогона и прогон beads-adapter в одиночку — exit 1 с OOM. Причина расхождения не установлена; решающим считаю эксперимент с удалением `packages/web/package.json` (OOM воспроизводится без моего пакета).
- `beads-adapter` собирается скриптом `"build": "tsdown"` — **без** `--max-old-space-size` (в отличие от `controller`: `"build": "node --max-old-space-size=8192 ../../node_modules/tsdown/dist/run.mjs"`). Правка его `package.json` — вне моей зоны записи.
- В рабочем дереве параллельно шли правки другой сессии (task-1: `packages/core/src/budget.ts`, `packages/contracts/src/budget.ts`, `packages/core/src/index.ts`, `packages/controller/src/app.ts` и др.) — `beads-adapter` инлайнит `core`+`contracts`, т.е. его вход менялся в том же окне. Я эти файлы не трогал и не могу изолировать дальше, не изменяя чужую незакоммиченную работу.
- Общий лок сборки `.tmp\build.lock` был пересоздан другой сессией в 18:36:27 (мой лок, взятый ~18:22, исчез; PID 44240 — чужая сборка). Это наблюдение о координации, а не о коде.

## ОПРОВЕРГНУТО / УТОЧНЕНО (сводка)
1. `B-01a` требует `private: true` для `@dsh-mywork/web` — противоречит D18/F-58/D04 (см. §0).
2. `dsh.engines` не в типе `DshManifest`, но в конвенции референса и `B-01a` (см. §1).
3. Гейт F-58 в плане («`Test-Path` после `corepack pnpm -r run build`») сейчас недостижим **буквально** из-за OOM в `beads-adapter`; достижим с `NODE_OPTIONS=--max-old-space-size=8192`. Дефект окружения/чужого пакета, не моего шага (доказано §5).
4. «Первые строки содержат `__ModuleLoader__.load`» пришлось понимать буквально: заголовочный комментарий перед конвертом перенесён **внутрь** фабрики, чтобы строка 1 была регистрацией.
5. **ОПРОВЕРГНУТО ревью A (F-1, MAJOR):** «`@dsh-mywork/web` — тот пакет, который профиль устанавливает из tarball» и «ряд в патче контроллера монтирует панель» — в канале доставки это было неверно: пакет не был ни зависимостью контроллера, ни в его tarball, ни в чьём-либо `pack`; ряд не активировался (`failed to import`), отказ был бесшумным. Исправлено delta-фиксом: ряд переехал в собственный `packages/web/cordis.patch.yml`, объявленный через `dsh.bundle.patch` (см. §4). Формулировка коммита `63d7c80` про «профиль устанавливает из tarball» остаётся в истории как ошибочная.

## НЕ ПРОВЕРЕНО
- Ничего не устанавливалось и не включалось в живом профиле (`C:\Users\Dmitry\.dsh` не изменялся) — по R-08 и по границам этапа 3. Изолированный `DSH_HOME`-прогон с реальным CLI и tarball'ом делал **ревьюер** (F-1); я его не повторял.
- **Канал доставки закрыт не полностью и не мной:** `scripts/pack.mjs` пакует только контроллер, `scripts/verify-profile.mjs` не проверяет `did not activate`; пока профиль не установит tarball `@dsh-mywork/web` и не перечислит его в `dsh.profile.bundles`, ряд из моего патча не применится. Проверено мной ровно то, что патч **едет в tarball** и манифест объявляет bundle-роль (§4); end-to-end установку двух tarball'ов делает Lead (task-9 п.4 прямо запрещает мне трогать эти скрипты).
- Реальная загрузка бандла страницей DSH и видимость панели в GUI **не проверялись** — это приёмка этапа 5 (`F-60` прямо запрещает такой гейт здесь).
- Хост-половина (`src/index.ts`) — намеренно пустой `apply`; поведение хоста не проверялось, потому что его нет (маршруты/транспорт — шаги `B-*`).
- Рендер `icon` платформой (data-URL) не проверялся: только наличие поля/файла и соответствие правилам `package-meta.ts`.
- Я не запускал `pnpm install`/`corepack pnpm install` (запрещено брифом) — новый пакет в workspace подхватывается маской `packages/*` без правки `pnpm-workspace.yaml` (проверено: `packages/web typecheck: Done` в `-r` выводе).

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-58-web-package.md
