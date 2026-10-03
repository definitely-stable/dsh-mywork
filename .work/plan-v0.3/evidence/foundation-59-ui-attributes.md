# F-59 — `@dsh-mywork/web`: префикс `data-mw-*` и `store` слота

Пакет: `packages/web` · Коммит: `e94ab1845774e33067513ae2c9114ce43633cbc9` (родитель — `4b51094`, F-58 — `63d7c80`) · Автор: `ui-package` (task-4)

## ПОДТВЕРЖДЕНО

### 1. Перечень атрибутов «до/после»
- **До:** в `packages/web/src/**` не было ни одного `data-*`-атрибута — пакет в F-58 создавал только конверт бандла и пустой `apply`; панели не существовало. Шаг F-59.2 плана («Реализация: заменить префикс») предполагает уже существующую реализацию с `data-dsh-*`; здесь префикс правильный с первого якоря, поэтому RED-фаза доказана не «до/после», а **мутациями** (§4) — это отклонение от буквы шага, а не от его цели.
- **После** (`Select-String packages\web\src\client\index.js -Pattern "data-mw-[a-z-]+" -AllMatches`, exit 0, 7 уникальных значений):
  `data-mw-panel` · `data-mw-board` · `data-mw-column-filter` · `data-mw-column-option` · `data-mw-column-active` · `data-mw-card` · `data-mw-card-expanded`.
- Тот же список читается из **собранного** `packages/web/lib/client.js` (тест сканирует и `src/**`, и бандл — митигация риска из плана: «grep по всему бандлу, не только по src»). Тест держит **точный** набор (`deepEqual`), поэтому новый якорь — осознанная правка теста, а не молчаливый проход.

### 2. Гейт плана: `data-dsh-` в исходниках = 0
```
Select-String -Path packages\web\src\**\* -Pattern 'data-dsh-'   →  matches=0   (exit 0)
```
Дополнительно тест сам утверждает `source.includes('data-dsh-') === false` для каждого файла `src/**` и для `lib/client.js` — то есть гейт-команда плана закреплена тестом, а не только запуском руками. Комментарии в исходнике переформулированы так, чтобы даже в прозе не встречался запрещённый литерал (иначе raw-grep плана был бы красным).

### 3. Тесты
| Команда | Exit | Наблюдение |
|---|---|---|
| `node --test --test-isolation=none tests/ui-attributes.test.mjs` (до реализации) | 1 | `# tests 2`, `# pass 0`, `# fail 2` — RED |
| то же после реализации | **0** | `# tests 2`, `# pass 2`, `# fail 0` — гейт плана F-59 выполнен |
| `node --test --test-isolation=none tests/ui-package.test.mjs tests/ui-attributes.test.mjs` (критерий 1 карточки) | **0** | `# tests 7`, `# pass 7`, `# fail 0` |
| `node --test --test-isolation=none tests/boundaries.test.mjs tests/reachability.test.mjs tests/adapters.test.mjs` | **0** | `# tests 47`, `# pass 47`, `# fail 0` — 13-й пакет не красит тесты Lead'а |

**Промежуточный отказ, записанный честно:** первый прогон после реализации упал на моём же guard'е «ожидалось ≥4 исходника» — файлов в `packages/web/src` три (`index.ts`, `client/index.js`, `client/index.d.ts`); guard исправлен на `>= 3`. Это и есть проверка невакуумности: guard сработал раньше, чем сравнение набора.

### 4. Мутационная проверка (skill §7: тест, который не падает от поломки, — дефект)
Обе мутации внесены в **источник** `src/client/index.js`, пакет пересобран (`corepack pnpm -r --filter @dsh-mywork/web run build`, exit 0), затем прогонялся тест:
1. `'data-mw-board'` → `'data-dsh-board'` (занятие платформенного префикса):
   `not ok 1 …` → `error: 'the platform prefix must not appear in the package sources'`, `# pass 1`, `# fail 1`.
2. `'data-mw-board'` → `'data-xw-board'` (чужой префикс, не платформенный):
   `not ok 1 …` → diff `+ 'data-xw-board'` против ожидаемого списка, `# pass 1`, `# fail 1`.
После каждой мутации источник восстановлен и пересобран; SHA256 `src/client/index.js` вернулся к `42198CBCBACF62190B3367A9AC7419A52D71F7C1C16F38A9CA8790672099F5BB` (совпадает до и после), тест снова `# pass 2 / # fail 0`.

### 5. View-состояние — в `store` слота, а не в компоненте
Тест 2 (`tests/ui-attributes.test.mjs`) исполняет **реальный** бандл так, как его исполняет страница (`new Function('window', …)` → перехват `window.__ModuleLoader__.load`), затем:
- `exports.apply(fake ctx)` → ровно одна регистрация, `injectedSeats = ['main']`, `options.name = 'main'`, `options.key = 'mywork'` (id панели == key записи `main`, инвариант `B-26`);
- сеат несёт **store-handle**: `options.store.create` — функция, `spec.persist = 'dsh-mywork.web.board-view'`, `spec.init() = { columnFilter: 'all', expandedCardId: null }`;
- `mount(instance)` — вызов компонента с шаром сеата (`useStore`, `actions`) и данными фикстуры; монтирование №1: `data-mw-column-filter = 'all'`, две карточки, ни одна не раскрыта;
- `instance.actions.selectColumn('active')`, `instance.actions.toggleCard('T-1')`;
- монтирование №2 (**новый элемент, новый объект props, тот же инстанс стора** — так framework кэширует один инстанс на handle × scope): `data-mw-column-filter = 'active'`, ровно одна карточка `T-1` с `data-mw-card-expanded = ''` → **состояние пережило размонтирование панели**;
- монтирование №3 с другим снапшотом (`columnFilter: 'review'`): рендер следует за сеатом (видна `T-2`) → путь чтения — именно `useStore` сеата;
- негативная половина: в собранном бандле нет ни `useState`, ни `useReducer`.
- **Оговорка честности:** `@deepseek-ai/dsh-client-store` в этом workspace не установлен, поэтому тест подставляет минимальную реализацию контракта `StoreDecl` (spec/init/persist/actions + `create(scopeKey)` с baked-actions). Проверяется **проводка сеата и путь чтения панели**; персист самого движка платформы (`packages/client/store/src/index.ts:217-249`) локально не исполнялся — он объявлен контрактом, а не прогнан.

### 6. Границы шага соблюдены
- Ряд сайдбара `sidebar.panellist`, инвариант `id === key` отдельным тестом, `order: 20`, полный dispose — это `B-26`; здесь только регистрация страницы в `main` с тем же id-константой `'mywork'`, чтобы `B-26` расширял, а не переписывал.
- Данные доски (`columns`/`cards`) — из inject-фейса; сейчас он отдаёт пустые массивы, потому что источник — хост-транспорт шагов `B-*`. Панель без данных рендерит пустую доску, а не падает.

## ОПРОВЕРГНУТО / УТОЧНЕНО
- Шаг F-59.2 «заменить префикс» неисполним буквально: заменять было нечего (пакет новый). Цель шага (якоря в своём префиксе) достигнута, доказательство — мутации §4.
- `data-mw`-упоминания в **комментариях** ломают наивный grep-скан (он ловит `data-mw-` из прозы). Тест снимает комментарии перед извлечением атрибутов и отдельно проверяет raw-отсутствие `data-dsh-`; в исходнике нет и прозаического `data-dsh-`.
- `corepack pnpm -r run typecheck` в момент финальной проверки — **EXIT 1**, но не из-за этого шага: падает `packages/core` (`src/review.ts(26,8) TS6133 'CardCommand' …`, `(29,8) 'HumanGate' …`), файл правит параллельная сессия (`git status`: `M packages/core/src/review.ts`; изолированный `tsc -p packages/core/tsconfig.json` → exit 2 без участия `packages/web`). В том же прогоне `packages/web typecheck: Done`; изолированный `tsc --noEmit -p packages/web/tsconfig.json` → exit 0. Ранее в этой сессии (18:23) `corepack pnpm -r run typecheck` был EXIT 0 со всеми 13 пакетами.
- Канонический `corepack pnpm -r run build` остаётся красным из-за OOM в `packages/beads-adapter` (см. `foundation-58-web-package.md` §5): сборка проходит с `NODE_OPTIONS=--max-old-space-size=8192`, при этом `packages/web/lib/client.js` на месте и первая строка — `window.__ModuleLoader__.load({`.

## НЕ ПРОВЕРЕНО
- Рендер панели в реальном DSH Web GUI, селекторы/стили в браузере, поведение `useStore` настоящего движка платформы — не проверялись (нет живого профиля; R-08 запрещает такой гейт для этого шага, GUI-проверка — приёмка этапа 5).
- Клик-пути (`onClick` → `actions`) не исполнялись: тест вызывает baked-actions напрямую, как это делает обработчик.
- `data-mw-*`-селекторы в CSS не проверялись: CSS-слой панели — шаги `B-*`; здесь только якоря.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-59-ui-attributes.md
