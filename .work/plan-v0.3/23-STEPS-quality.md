# 23 — Шаги качества и эксплуатации (этапы 2–5)

**Владелец файла:** `plan-quality` · **Префикс шагов:** `Q` · **Карточки:** MW-016…MW-020, MW-030, MW-032…MW-034, MW-038…MW-041, MW-045, MW-046, **MW-074** (новая: runtime-инварианты) (+ правки MW-013, MW-015)
**Write-scope:** `.work/plan-v0.3/23-STEPS-quality.md`, `.work/plan-v0.3/evidence/quality-*.md`. Скрипты — только `.tmp/plan-v03-quality/`.
**Язык:** русский; идентификаторы, пути и команды — как в коде.

> **Как читать.** Это файл шагов, а не обзор. Читать по блокам: сначала §0 (что уже реализовано и чего именно не хватает), затем нужную группу. Каждый шаг — атомарное действие с командой и ожидаемым выводом. Шаг без команды в файле отсутствует; там, где точный путь/строка не проверены, стоит `~` и запись в §10.
>
> **Что здесь НЕ повторяется.** Composition root (`F-28…F-32`), единый реестр миграций и journal (`F-18…F-20`), атомарность (`F-33…F-35`), durable jobs (`F-36`, `F-37`), механика retention (`F-38…F-40`), boundary-тест (`F-41`, `F-42`), session conformance как фундамент (`F-45`), peer-контракт — это `20-STEPS-foundation.md`. Конвейер исполнения, worker-поверхность (что именно не попадает в поверхность), provisioning saga, handoff — `21-STEPS-execution.md`. Доска, проекция, UI-пакет, `data-dsh-*` — `22-STEPS-surface.md`. Здесь только дельта: **что подключить, где, каким тестом доказать**.

---

## 0. Введение: что уже реализовано и чего именно не хватает

### 0.1. Одна таблица, которая объясняет весь файл

| Подсистема | Код есть | Тесты есть | Потребителя в рантайме нет | Чего именно не хватает |
|---|---|---|---|---|
| Context Fabric (MW-016) | `packages/contracts/src/context.ts` 955 стр., `packages/core/src/context.ts` 1408 стр. (`discoverContext` ~375, `materializeContextSnapshot` ~478, `verifyContextSnapshot` ~670, `assembleContextPrompt` ~775) — `quality-08:18` | 57 тестов, `tests/context.test.mjs` 1152 стр. | да: контроллер монтирует только каталог моделей и DSH-рантайм (`packages/controller/src/index.ts:123`, `:127`) — `quality-01` | вызова из пути попытки; снапшот нигде не сохраняется; `revision` не durable |
| Skill Registry (MW-017) | `packages/contracts/src/skill.ts` 540 стр., `packages/core/src/skill.ts` 1196 стр. (`createSkillRegistry` ~119, `createSkillContextProvider` ~639) — `quality-08:19` | 28 тестов, `tests/skill.test.mjs` 782 стр. | да | регистрации провайдера в контекст попытки |
| Memory Fabric (MW-018) | `packages/contracts/src/memory.ts` 1403 стр., `packages/core/src/memory.ts` 1698 стр. (`createMemoryFabric` ~170, `createMemoryContextProvider` ~1368) — `quality-08:20` | 68 + 17 тестов | да: `createMemoryFabric` не вызывается нигде, beads регистрирует только провайдера | обязательного звена fabric и актора `memory-provider` |
| Внешний memory-адаптер (MW-019) | `packages/beads-adapter/src/memory.ts` 815 стр. (бэкенд `bd kv`, не OpenViking — расхождение с карточкой) | `tests/memory-beads.test.mjs` 1005 стр., conformance `packages/adapter-sdk/src/conformance.ts` ~768 | да | durable-гарантий и полного conformance в CI-профиле |
| checkpoint/rollover/pressure (MW-020) | `packages/contracts/src/session.ts` 957 стр., `packages/core/src/session.ts` 1028 стр. (`checkpointSession` ~782, `rolloverSession` ~831, `decideContextPressure` ~351) | `tests/session.test.mjs` 746 стр. | да | durable-снапшота и `ordinal` окон |
| Doctor / conformance (MW-038) | модуля Doctor нет вовсе (`glob **/src/**/*doctor*` → 0 файлов) — `quality-08:23` | `runConformance` есть (`conformance.ts` ~236) | — | всего модуля; у платформы doctor-примитива тоже нет (`quality-05:9`) |
| invariants / crash / security (MW-039) | `InvariantRegistry` в MyWork — 0 совпадений (`quality-09:17`); `assertTaskInvariants` есть (`packages/core/src/task.ts` ~135) | `tests/security.test.mjs` 411, `tests/storage-crash.test.mjs` 112 | — | регистрации инвариантов, сканеров тел, recovery |
| upgrade/export/import/repair (MW-040) | не реализовано: `packages/storage/src/migrations.ts:10-11` прямо говорит «export/import, repair и rollback policy — это MW-040» | — | — | всего контура |
| упаковка v0.1 (MW-041) | `scripts/pack.mjs` 62 стр. (`packController` ~28), `packages/controller/package.json:17-25` | — | — | CI, тега, решения по `private` |

**Вывод одной строкой:** 11 619 строк (31,7 % `src`) — это библиотека с тестами и без точки входа; качество здесь не «написать заново», а **соединить** и **сделать проверяемым на живом пути**.

### 0.2. Точка подключения одна, и она не моя

Всё, что перечислено в §0.1, подключается в **одном** месте — там, где `plan-foundation` создаёт application service:

- `F-28` — скелет application service (`packages/controller/src/app.ts`, Create).
- `F-29` — открыть `controller.sqlite` полным списком миграций.
- `F-30` — поднять lease/planner/execution/scheduler/evidence.
- **`F-31` — регистрация в `myworkAdapters`; это и есть шов для Context/Memory/Skill.**
- `F-32` — smoke в изолированном `DSH_HOME`.

Сегодняшний `apply()` монтирует ровно две вещи и больше ничего (`packages/controller/src/index.ts:115-128`):

```ts
mountModelCatalog(ctx, adapters)   // :123
mountDshRuntime(ctx, adapters)     // :127
```

Ни `execution`, ни `evidence`, ни `planner`, ни `memory-native` не достижимы ни от одной смонтированной строки: спецификаторы `@dsh-mywork/planner`, `@dsh-mywork/memory-native` не встречаются **нигде** вне собственных манифестов и `index.ts` (`quality-01`), `@dsh-mywork/evidence` импортируется только из `planner`/`execution`, которые сами недостижимы. От `controller` достижим только `@dsh-mywork/core` (`packages/controller/src/index.ts:46`), а `core` тянет только `contracts` (`packages/core/src/index.ts:11`).

Отсюда правило файла: **шаги Q-01…Q-08 — это не «создать контур», а «добавить вызов в шов `F-31` и доказать тестом, что без этого вызова попытка не стартует».**

### 0.3. Опровержения и уточнения базы (`00-RECON.md` §3)

Факты ниже не переписывают бриф, а уточняют три его утверждения. Каждое проверено в этой кампании.

1. **§3.3 п.5 «4 из 12 пакетов достижимы» — подтверждено, и уточнено до одного пакета.** От `controller` достижим ровно `@dsh-mywork/core` (`packages/controller/src/index.ts:46`); `evidence`, `planner`, `memory-native` не имеют ни одного рантайм-импортёра: их спецификаторы встречаются только в их собственных `package.json`/`index.ts` и в тестовых фикстурах `tests/lib/fixtures.mjs:20,25,28` (импорт собранных `lib/*.js` по пути). Дополнительно: `tsconfig.base.json:30-38` не содержит path-алиасов для `planner` и `memory-native`, то есть они не выведены и в граф компиляции (`quality-01`).
2. **P20 «`resolveModelInfo` синтезирует окно 1 000 000» — верно для платформы, неверно для MyWork.** MyWork-порт прозрачно возвращает `resolved.context?.contextWindow` (`packages/controller/src/model-catalog.ts:119-128`) и ничего не синтезирует; синтетическое окно приходит как **дефолт деплоймента** DSH (`packages/llm/llm-deepseek/src/defaults.ts:6`), а в MyWork 1 000 000 встречается только в фикстурах (`tests/routing.test.mjs:65,156,274`) — `quality-06:24,28`. Это **не отменяет шаг** Q-35: «модель есть в `resolveModelInfo`» и «модель маршрутизируема по `listModels`» — разные источники. Но тест обязан подставлять порт, отвечающий успешно при пустом `listModels`, а не полагаться на синтез внутри MyWork.
3. **«done ≠ принято» подтверждено прямо в моей зоне.** Отчёты MW-016…MW-020 существуют и заявляют `DONE`, тогда как `tasks.json` держит `planned` для всех девяти карточек MW-016…MW-020, MW-038…MW-041 (`quality-08:14-15`). Приёмка этого файла поэтому формулируется не как «отчёт есть», а как **команда + ожидаемый вывод** (см. §12).
4. **`providerConcurrency` (FINAL-REPORT §9.1, B N-13) в платформе отсутствует.** `grep providerConcurrency` по всему DSH-checkout → 0 совпадений; ближайшие аналоги — `maxParallelToolCalls` (agent-loop), `maxParallelSubCalls` (tool runtime, default 10), `imageCompressionConcurrency` — `quality-04:16-17`. Значит Q-29 — **свой** счётчик параллелизма вызовов модели, а не подключение платформенного.
5. **«`auto-review` только deny» (D15) — правило MyWork, а не режим платформы.** У `experimental/auto-review` нет deny-only режима (`rg 'denyOnly|deny-only|deny_only'` по packages → нет совпадений); решения — только low+allow / medium+allow|deny / high+deny, а `allow` исполняется сразу с Full access (`quality-05:34-38`). Значит шаг Q-38 формулируется как инвариант в MyWork, а не как настройка пакета.
6. **У платформы нет doctor-примитива** (`rg -i '\bdoctor\b' packages apps docs scripts` → нет совпадений, exit 1; `quality-05:9`). Ближайшее — runtime-invariants и `verify-package-invariants`. Отсюда: MW-038 — полностью собственный модуль, а не обёртка (в отличие от MW-039, где обёртка как раз правильна).

### 0.4. Границы с другими файлами (чтобы не было двух планов на один код)

| Тема | Владелец | Мой шаг ссылается |
|---|---|---|
| composition root, реестр миграций, journal, атомарность, durable jobs, retention-механика | `plan-foundation` (`F-18…F-20`, `F-28…F-42`) | `depends on F-…` без повторного описания |
| worker-поверхность: **что не попадает** в поверхность | `plan-foundation` `F-56` (список и фильтр), `plan-execution` `E-…` (момент применения) | Q-37 добавляет **инвариант и тест**, а не фильтр |
| сессии: 8 тестов conformance | `plan-foundation` `F-44` | Q-34 — шаг-ссылка; список 8 тестов и 4 схлопнутых отказа переданы как вход |
| model availability (`ModelAvailabilityPort`, `model-not-routable`) | `plan-foundation` `F-43` | Q-35 — шаг-ссылка; уточнение P20 передано как вход |
| бюджет, breaker, шаги | `plan-foundation` `F-51`…`F-53` | Q-28 (только снимок метрик), Q-30 — шаг-ссылка |
| retention, `VACUUM`, сканеры | механика — `plan-foundation` `F-38`…`F-40`; сканер тел — `plan-quality` | Q-40 — шаг-ссылка; Q-39 — сканер тел; PII — `F-55` |
| `bd`-seam и диагностика | `plan-foundation` `F-13`…`F-15`, `F-17` | Q-32 — шаг-ссылка; Q-31/Q-33 используют результат |
| наблюдаемость: экспорт `correlationId`, состав событий, PII | `plan-foundation` `F-54`, `F-55` | Q-27 — шаг-ссылка; Q-39 — только сканер тел |
| публикуемость, peer-контракт, CI, тег | `plan-foundation` `F-25`, `F-47`…`F-50` | Q-45, Q-46 — шаги-ссылки; Q-47 — матрица приёмки |
| work types / finish criteria (MW-045) | `plan-quality` | Q-20…Q-23 |
| доска, проекция, `BoardPlacement`, UI | `plan-surface` | Q-10 добавляет поле `attention?` — согласовать с surface при правке проекции |
| решения D14/D15/D16/D17/D20 | `decision-desk` | шаги ссылаются на `10-DECISIONS.md`, формулировок не переписывают |

### 0.5. Порядок и зависимости

```
F-28…F-32 (composition root)
      │
      ├── Q-01…Q-08  подключение Context/Skill/Memory/checkpoint
      │
      ├── Q-42 (поверх F-18…F-20) ──► Q-43, Q-44 (export/import/repair)
      │
Q-09…Q-19 (HumanDecision) ──► Q-23 (человеческая приёмка по work type) ──► Q-20…Q-22 (worktype)
      │
Q-24…Q-26 (обучение) ──► Q-29 (счётчик параллелизма) ──► Q-28 (снимок метрик)
      │
Q-31, Q-33 (Doctor: профиль и conformance) ──► Q-36…Q-41 (invariants/security/recovery)
      │
Q-47 (матрица приёмки) — после всего, что попадает в tarball
```

Шаги-ссылки (Q-27, Q-28 частично, Q-30, Q-32, Q-34, Q-35, Q-40, Q-45, Q-46) не имеют собственного кода: их «зависимости» — это порядок выполнения соответствующих `F-…` в `20-STEPS-foundation.md`.

Порядок внутри групп — как в файле; шаги одной группы можно параллелить, если write-scope не пересекается (все шаги Q пишут только `tests/**`, `packages/**/src/**` — пересечение возможно, поэтому один шаг = один исполнитель).

### 0.6. Метод доказательств этого файла

Собрано 9 независимых вопросов-фактов, каждый — отдельный агент, каждый обязан давать `файл:строка` или команду с exit code; результаты в `.work/plan-v0.3/evidence/quality-01…09.md`:

| Файл | Вопрос | Ключевой результат |
|---|---|---|
| `quality-01.md` | экспорты и граф достижимости `memory-native`/`planner`/`evidence`/`core` | достижим только `core`; `planner`/`memory-native` не импортируются нигде |
| `quality-02.md` | где живёт `HumanGate` и что он делает | `packages/contracts/src/security.ts:171-181`, 5 значений, принуждается как **отказ** (`packages/core/src/security.ts:102-110`); имя занято, `export *` в `contracts/src/index.ts:82,87` |
| `quality-03.md` | `ask()`/approval: таймаут, что держит | блокирующий `ask()` своего таймаута не имеет (`user-questions/src/index.ts:322-330`); **дельта 0.2.0-rc.2:** у платформы есть `askTimed()` (`:234`) — окно ожидания закрывается результатом `{pending:true, callId}` (`:261`, тип `:43`), поздний ответ приходит steered-сообщением с источником `{kind:'user-question-reply', callId, outcome:'answered'}` (`:187`), `assertLiveRoot` требует живого root-агента (`:138-143`) — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D1; блокирует шаг (`tool-calls.ts:88-93,168,199-214`); `agent.steer` есть (`runtime-types.ts:224-231`) |
| `quality-04.md` | `dsh-token-meter`: точные типы | `TokenMeter` (`packages/llm/token-meter/src/index.ts:101,146,214,342`) — **оговорка: `:214` — это `estimateMessage(message)`, а не `measure`** (`measure(session, requestHeader?)` — `:146`, класс — `:101`, `export default` — `:342`; см. разъяснение в §4), сервис `tokenMeter` (`:94-98,111`), проекции tokenUsage/contextPressure/contextBreakdown, cost и лимитов НЕТ |
| `quality-05.md` | `@deepseek-ai/dsh-*`: invariants/doctor/upgrade | `ctx.invariants` + `./invariant` + CI-gate (шов жив на базе `0.1.7-rc.2`); doctor-примитива нет; `jobs-local` не durable. **Дельта 0.2.0-rc.2:** шов не смонтирован в живом профиле и снимается в следующем релизе (D4) — Q-36 переписан на свои проверки |
| `quality-06.md` | тесты `tests/**` про сессии и политики | 28 файлов, 710 статических тестов; 4 отказа схлопнуты в `unavailable` (`dsh-session.ts:599-628`) |
| `quality-07.md` | карточки MW-030/032/033/034/045/046 | все `planned`; приёмки MW-032/033/034 — свойства-интенты без имён и чисел |
| `quality-08.md` | карточки MW-016…020, 038…041 | размеры модулей, отсутствие Doctor, `migrations.ts:10-11` про MW-040 |
| `quality-09.md` | worktype/retention/security-состояние | `WorkType` 0 совпадений (exit 1); `DELETE FROM outbox`/`VACUUM` — exit 1; сканер только по метаданным |

Дополнительно я сам прочитал `packages/controller/src/index.ts:100-159` (шов `apply`) и платформенный `packages/core/tools/src/index.ts:1095-1140` (`restrict`/`guard` — единственный законный способ сузить поверхность агента).

---

## 1. Группа A. Подключение уже реализованного к рантайму (MW-016…MW-020)

#### Q-01 · Context Fabric становится обязательным звеном пути попытки
- **Карточка:** MW-016 (правка существующей; `tasks.json:410` — `planned`, отчёт заявляет `DONE`)
- **Усилие:** M (2–4 ч) · **Риск:** высокий (меняет то, что уходит в `prompt`) · **Откат:** revert коммита; фабрика не трогается
- **Зависит от:** `F-31` (регистрация в `myworkAdapters`)
- **Цель:** попытка без материализованного `ContextSnapshot` не может быть запущена; в `AgentStartRequest.prompt` уходит только `assembleContextPrompt(snapshot)`.
- **Файлы:** Modify `packages/execution/src/service.ts` (~ путь admission→attempt), Modify `packages/controller/src/dsh-session.ts:~633-649` (место, где сейчас собирается свободный текст — `quality-08:28`), Modify `packages/contracts/src/context.ts` (**новый член существующего union** `ContextRefusalReason`, `:602-631`); Create `tests/context-attempt.test.mjs`
- **Шаги:**
  1. Шаг 0 (обязательный): подтвердить точку вставки — `grep -n "prompt" packages/execution/src/service.ts packages/controller/src/dsh-session.ts`; записать номера строк в отчёт. Если вызов `discoverContext` там уже есть — шаг закрывается как «сделано», с доказательством.
  2. Тест (падающий): попытка без снапшота → типизированный отказ (не `TypeError`) — **новый член существующего union** `ContextRefusalReason` (`packages/contracts/src/context.ts:602-631`, реальный union; имя члена выбирается при реализации, например `snapshot-missing`). Тест дополнительно проверяет, что каталог причин содержит новый член и не содержит дублей.
     Команда: `node --test --test-isolation=none tests/context-attempt.test.mjs` → FAIL «ожидался отказ, попытка стартовала».
  3. Реализация: в пути admission→attempt вызвать `discoverContext` → `materializeContextSnapshot` → `assembleContextPrompt` (имена — `packages/core/src/context.ts:375,478,775`), результат положить в `AgentStartRequest.prompt`.
  4. Тест «item, которого нет в снапшоте, не попадает в prompt» — на уровне попытки, а не `assembleContextPrompt` (сейчас таких тестов нет: `tests/context.test.mjs` проверяет сборку, а не путь).
  5. Команда: `node --test --test-isolation=none tests/context-attempt.test.mjs` → `pass 3 / fail 0`.
  6. Регрессия: `node --test --test-isolation=none tests/context.test.mjs tests/runtime.test.mjs` → `fail 0`.
- **Гейт (готово когда):** `node --test --test-isolation=none tests/context-attempt.test.mjs` → `# pass 3`, `# fail 0`, exit 0.
- **Evidence в отчёт:** вывод прогона, sha коммита, точные строки вставки, diff `dsh-session.ts`.
- **Риски:** prompt перестаёт быть свободным текстом — все существующие тесты, которые передают текст напрямую, обязаны падать; это ожидаемо и перечисляется в отчёте (`tests/runtime.test.mjs` — 17 тестов).

#### Q-02 · Skill Registry подключается как источник контекста попытки
- **Карточка:** MW-017 (правка) · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Зависит от:** Q-01, `F-31`
- **Цель:** скиллы попадают в prompt **только** через контекст (с trust-классом и provenance), а не вторым каналом.
- **Файлы:** Modify `packages/execution/src/service.ts` (регистрация провайдера), Create `tests/skill-attempt.test.mjs`
- **Шаги:**
  1. Тест (падающий): попытка в задаче, где реестр объявляет один скилл → в снапшоте ровно один элемент с `kind`-скиллом и provenance-ссылкой (не телом).
     Команда: `node --test --test-isolation=none tests/skill-attempt.test.mjs` → FAIL «в снапшоте 0 элементов».
  2. Реализация: `createSkillRegistry` (`packages/core/src/skill.ts:~119`) + `createSkillContextProvider` (`:639`) зарегистрировать как провайдера контекста в том же месте, что Q-01.
  3. Тест «скилл не может подменить instruction»: untrusted-скилл остаётся data-секцией (переиспользовать механику fencing — она уже есть, `quality-D-context §39`).
  4. Команда: `node --test --test-isolation=none tests/skill-attempt.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** `node --test --test-isolation=none tests/skill-attempt.test.mjs` → `pass 2 / fail 0`.
- **Evidence:** вывод прогона, sha, список зарегистрированных провайдеров в снапшоте.
- **Риски:** второй канал (прямой впрыск в system prompt) — запрещён; если возникнет соблазн `systemPrompt.section`, это предмет D10, а не этого шага.

#### Q-03 · Memory Fabric становится обязательным звеном записи
- **Карточка:** MW-018 (правка; `tasks.json:460` — `planned`)
- **Усилие:** M · **Риск:** средний · **Откат:** revert (провайдер beads остаётся зарегистрированным, меняется только путь записи)
- **Зависит от:** Q-01, `F-31`
- **Цель:** ни одна запись памяти не проходит мимо `createMemoryFabric` (`packages/core/src/memory.ts:~170`); запись без актора `memory-provider` отвергается `SECURITY_DENIED`.
- **Файлы:** Modify `packages/beads-adapter/src/memory-plugin.ts:~113-122` (сейчас регистрирует **порт** напрямую — `quality-D-context §3`), Modify `packages/execution/src/service.ts`; Create `tests/memory-fabric-runtime.test.mjs`
- **Шаги:**
  1. Тест (падающий): попытка записать память через зарегистрированный провайдер при отсутствии fabric → ожидаем отказ, а не тихую запись.
     Команда: `node --test --test-isolation=none tests/memory-fabric-runtime.test.mjs` → FAIL «запись прошла мимо fabric».
  2. Тест (падающий): запись без актора `memory-provider` → `SECURITY_DENIED` (механика `assertWriteAuthority` уже есть; домен — из `packages/contracts/src/authority.ts`).
  3. Реализация: fabric создаётся в шве `F-31`, провайдер регистрируется **внутри** fabric; прямой `ctx.set` провайдера из плагина убирается.
  4. Команда: `node --test --test-isolation=none tests/memory-fabric-runtime.test.mjs` → `pass 2 / fail 0`.
  5. Регрессия: `node --test --test-isolation=none tests/memory.test.mjs tests/memory-beads.test.mjs` → `fail 0` (85 тестов уже зелёные, ломать нельзя).
- **Гейт:** `node --test --test-isolation=none tests/memory-fabric-runtime.test.mjs` → `pass 2 / fail 0` и регрессия без новых падений.
- **Evidence:** вывод, sha, до/после `memory-plugin.ts`.
- **Риски:** порядок инициализации (fabric должен существовать до регистрации провайдера) — если порядок не выражается, шаг останавливается и уходит в отчёт как блокер к `F-31`.

#### Q-04 · Durable-проверка памяти при монтировании (иначе — тихий дрейф)
- **Карточка:** MW-018/MW-020 (правка) · **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** деплоймент с включённой памятью и не-durable провайдером падает **при монтировании**, а не деградирует на следующем запуске.
- **Основание:** `memory-native` держит `Map` и прямо объявлен «not durable» (`packages/memory-native/src/native.ts:11-16,92`); ревизия памяти в снапшоте — обязательный элемент frozen-identity (`packages/contracts/src/context.ts:~664-665`), а реестр ревизий пересоздаётся с 1 (`packages/core/src/memory.ts:111-124`) — после рестарта зафиксированная ревизия указывает в никуда (`quality-D-context N7`).
- **Файлы:** Modify `packages/execution/src/service.ts` (проверка при монтировании), Create `tests/memory-durability.test.mjs`
- **Шаги:**
  1. Тест (падающий): включена память + провайдер без durable-признака → монтаж отвергнут типизированной ошибкой.
     Команда: `node --test --test-isolation=none tests/memory-durability.test.mjs` → FAIL «монтаж прошёл».
  2. Реализация: минимальный признак durable у порта (поле/метод — аддитивно в `packages/contracts/src/memory.ts`), проверка в шве `F-31`; `disabled`-провайдер (`packages/memory-native/src/disabled.ts:~62`) считается допустимым.
  3. Команда: `node --test --test-isolation=none tests/memory-durability.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — вывод `node --test --test-isolation=none tests/memory-durability.test.mjs` и имя признака durable.
- **Риски:** аддитивная правка чужого контракта `memory.ts` — согласовать с владельцем MW-018 (я), карточку не переписывать.

#### Q-05 · Внешний memory-адаптер: контракт долговечности и полный conformance
- **Карточка:** MW-019 (правка) · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** conformance-набор адаптера памяти в CI не может быть «пропущен»; фактический бэкенд (`bd kv`, а не OpenViking из карточки) описан в отчёте и в карточке.
- **Факты:** `packages/adapter-sdk/src/conformance.ts:~768` (`memoryChecks`), `runConformance` ~`:236`; `tests/adapters.test.mjs:288,304,307` уже проверяет «skip громко, а не молча»; `quality-08:21`.
- **Файлы:** Modify `packages/beads-adapter/src/memory.ts` (~ шапка «§62 item 26»), Modify `.work/tasks/MW-019.md` — **не** здесь (правка карточки — `30-CARD-EDITS.md`), поэтому в шаге только код и тест; Create `tests/memory-conformance.test.mjs`
- **Шаги:**
  1. Тест (падающий): conformance-набор `memory` применяется к внешнему адаптеру и **падает**, если адаптер не поддержан средой (не `skip`).
     Команда: `node --test --test-isolation=none tests/memory-conformance.test.mjs` → FAIL «набор пропущен».
  2. Реализация: в CI-профиле отсутствие `bd` — падение, не пропуск (то же правило, что уже заявлено для backend-тестов; см. `F-…` про `bd`-seam).
  3. Команда: `node --test --test-isolation=none tests/memory-conformance.test.mjs` → `pass N / fail 0`.
- **Гейт:** `node --test --test-isolation=none tests/memory-conformance.test.mjs` → `fail 0`, `skipped 0` в CI-профиле.
- **Риски:** если `bd` по-прежнему не резолвится на Windows, шаг блокируется на `F-…` (`bd`-seam) — это правильный блокер, не обходить.

#### Q-06 · checkpoints: снапшот и `ordinal` окон становятся durable
- **Карточка:** MW-020 (правка) · **Усилие:** M · **Риск:** средний · **Откат:** revert + откат аддитивной миграции
- **Зависит от:** `F-18…F-20` (реестр миграций), Q-01
- **Цель:** `ContextSnapshot` и список окон попытки переживают рестарт процесса.
- **Факты:** снапшот встречается только в `contracts/context.ts`, `core/context.ts`, реэкспорте и тестах — «critical audit artifact, живущий в памяти одного процесса» (`quality-D-context N8`); `SessionWindow` знает `ordinal`/`attemptId`, но ни одна из 15 таблиц не хранит список окон (`packages/contracts/src/session.ts:~145-178`); `carriesTranscript: false` уже обеспечен (`packages/core/src/session.ts:~981`).
- **Файлы:** Create миграция в `packages/storage/src/migrations.ts`-совместимом домене (аддитивная: `context_snapshot`, `session_window`; **порядок и реестр — за `F-18`**); Modify `packages/core/src/session.ts`, `packages/execution/src/service.ts`; Create `tests/snapshot-durability.test.mjs`
- **Шаги:**
  1. Тест (падающий): сохранить снапшот, пересоздать процесс-контекст, `verifyContextSnapshot` → **не** `{kind:'drifted'}` с `reason: 'missing'` (ожидаемо `{kind:'intact'}`; исхода `missing` у типа нет — `packages/core/src/context.ts:643-645,697`, разъяснение в Q-41).
     Команда: `node --test --test-isolation=none tests/snapshot-durability.test.mjs` → FAIL.
  2. Тест (падающий): две попытки → два окна с `ordinal` 1 и 2, читаемые после рестарта.
  3. Реализация: запись снапшота в свой домен (не в `artifacts`: тело снапшота — агрегат, а не evidence-артефакт), `ordinal` — в durable-структуру.
  4. Команда: `node --test --test-isolation=none tests/snapshot-durability.test.mjs` → `pass 3 / fail 0`.
  5. Отдельная проверка: в снапшоте нет полей `transcript`/`messages` (правило §22.3 уже проверяется для капсулы — `tests/session.test.mjs:714-722`; здесь проверяется сериализованный снапшот).
- **Гейт:** `node --test --test-isolation=none tests/snapshot-durability.test.mjs` → `fail 0`; в отчёте — имена новых таблиц и версия миграции.
- **Риски:** вторая durability-структура рядом с `attempt.revisions` — если владелец плана решит иначе, шаг переносится в карточку; см. §10.

#### Q-07 · Байтовые бюджеты контекста (иначе «дешёвый по токенам» item ломает транспорт)
- **Карточка:** MW-020 (правка приёмки), связано с §41(в) отчёта D-context
- **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** у контекста появляется байтовое измерение рядом с токенным; отказ — до отправки запроса.
- **Факты:** в `packages/contracts/src/budget.ts:59-87` все 8 лимитов — токены/стоимость/счётчики, байтового нет; `ContextBudget` (`packages/contracts/src/context.ts:~465-482`) чисто токенный; адаптер отправляет один текстовый блок (`packages/controller/src/dsh-session.ts:~636-644`); у платформы лимит 8 MiB на поле request-extension (`packages/session/session-log-deepseek/src/index.ts:53`).
- **Файлы:** Modify `packages/contracts/src/context.ts` (`ContextBudget.bytes`, `ContextCandidate.byteLength?`, `ContextRefusalReason` + `item-too-large`/`assembly-bytes-exceeded`), Modify `packages/core/src/context.ts` (учёт), Create `tests/context-bytes.test.mjs`
- **Шаги:**
  1. Тест (падающий): item на 9 MiB → `item-too-large` до сборки prompt.
     Команда: `node --test --test-isolation=none tests/context-bytes.test.mjs` → FAIL.
  2. Тест: сборка на 9 MiB из 100 малых item → `assembly-bytes-exceeded`.
  3. Реализация: считать `Buffer.byteLength` (UTF-8) на входе и на сборке; `absent ≠ 0` (то же правило, что у токенов).
  4. Команда: `node --test --test-isolation=none tests/context-bytes.test.mjs` → `pass 3 / fail 0`; регрессия `node --test --test-isolation=none tests/context.test.mjs` → `fail 0`.
- **Гейт:** тест зелёный; в отчёте — значения лимитов и почему они такие (источник — конфигурация деплоймента, не каталог моделей).
- **Риски:** аддитивные поля в чужом контракте — согласовать с поверхностью, если она читает `ContextBudget`.

#### Q-08 · `SessionLink` обретает производителя (или снимается)
- **Карточка:** MW-020 (правка) · **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** контракт `SessionLink` либо производится в проекции попытки, либо удалён из `board.ts` — мёртвый контракт опаснее отсутствующего.
- **Факты:** `packages/contracts/src/board.ts:336-347`, ровно одно совпадение в репозитории — само объявление (`quality-D-context §48(б)`); dead-поля `subState`, `PlacementChange.fromZone` — отдельная тема `card-ledger`.
- **Файлы:** Modify `packages/core/src/session.ts` (producer ссылки), Create `tests/session-link.test.mjs`; правка/снятие `board.ts` — **согласовать с `plan-surface`**, иначе шаг не начинать
- **Шаги:**
  1. Шаг 0: спросить/проверить, берёт ли `22-STEPS-surface.md` производство `SessionLink` на себя. Если да — шаг закрывается ссылкой (без дубля); если нет — выполняется здесь.
  2. Тест (падающий): у попытки с живой сессией есть `SessionLink` c `sessionId`, без тела сессии (нет `transcript`/`messages` в сериализации).
     Команда: `node --test --test-isolation=none tests/session-link.test.mjs` → FAIL.
  3. Реализация: producer в попытке/исполнении; `active` заполняется из живости (не хардкод).
  4. Команда: `node --test --test-isolation=none tests/session-link.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный **или** доказанное удаление поля с обновлённым тестом board.
- **Риски:** дублирование с surface-файлом; поэтому шаг 1 — обязательный.

---

## 2. Группа B. `HumanDecision`: durable-гейт человека (MW-030 + MW-046, D14)

**Что уже есть (и не переписывается).** `NeedsAttentionReason` — 7 значений (`packages/contracts/src/board.ts:356-370`, список `:373-381`), тест фиксирует ровно 7 (`tests/board.test.mjs:603-612`). Аудит: 16 значений в `AUDIT_EVENT_TYPES` (`packages/contracts/src/audit.ts:65-82`), среди них `human.override` (`:50`) и `gate.decided` (`:54`); `gate.decided` уже реально пишется (`packages/planner/src/service.ts:994-1018`) вместе с артефактом `gate-decision`. Authority-домен `approval.human` существует с владельцами `['mywork-db','mywork-audit']` (`packages/contracts/src/authority.ts:122`). CAS-механика есть: `expectedRevision`, `controllerEpoch`, `assertRevision` → `STALE_REVISION`, `assertControllerEpoch` → `LEASE_LOST` (`packages/core/src/guards.ts` ~; тесты `tests/guards.test.mjs:15-39,58-82`). `CardCommand 'task.resolve-attention'` объявлена (`packages/contracts/src/board.ts:266,278`), но не реализована.

**Имя `HumanGate` занято — и это не стилистика.** `packages/contracts/src/security.ts:171-181` — `type HumanGate` из 5 значений (`dependency-upgrade`, `schema-migration`, `security-change`, `release`, `production-access`), список `HUMAN_GATES` `:184-190`, `DOMAIN_IMPLIED_GATES` `:193-195`, поле `OperationRequest.gate` `:280`. Гейт **принуждается как отказ**, а не как одобрение: `packages/core/src/security.ts:102-110` (`denied('human-gate', …)`). `packages/contracts/src/index.ts` реэкспортирует модули **звёздочкой** (`:82` — `security.ts`, `:87` — `workflow.ts`; всего 29 звёздочных реэкспортов, `:68-96`) — второй `export` с тем же именем либо не скомпилируется, либо перезапишет первый. Поэтому сущность называется `HumanDecision` (так уже в `00-RECON.md` §4, решение D14, и в `01-MASTER-PLAN.md` §2 п.8 и §7.1, решение D14).

**Почему шаг обязан освобождать worker-сессию.** Блокирующий `ask_user_question` ждёт `ctx.userQuestions.ask(...)` внутри `execute` (`packages/interaction/tool-ask-user/src/index.ts:98-117`), а `ask()` ждёт waterfall **без таймаута** (`packages/interaction/user-questions/src/index.ts:322-330`). **Дельта 0.2.0-rc.2 (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D1): прежняя посылка «таймаута у платформы нет» больше не описывает платформу целиком** — рядом с блокирующим `ask()` появился `askTimed()` (`:234`), чьё окно ожидания закрывается результатом `{ pending: true, callId }` (`:261`, тип `:43`), а поздний ответ доставляется steered-сообщением с источником `{kind:'user-question-reply', callId, outcome:'answered'}` (`:187`); `assertLiveRoot` требует точного живого root-агента и отвечает `DELEGATED_CALLER` (`:138-143`, код `:142`). Блокирующий путь при этом не изменился, поэтому запрет ниже сохраняется и получает платформенную опору. Пока ждёт — держится шаг: `tool/call` пишется durable до dispatch, группа ждётся до опустошения `inFlight`, инструмент без `isConcurrencySafe` — exclusive (`packages/core/agent-loop/src/tool-calls.ts:88-93,168,199-214`). Durable-состояния «ждём ответа человека» в платформе нет (`packages/core/session/src/known-event-types.ts:22-82`), при рестарте незавершённый turn закрывается синтетикой (`packages/core/session/src/repair.ts:96`; файл 211 строк, класс `ToolCallRecovery` — `:105`). Из этого — весь дизайн ниже.

#### Q-09 · Контракт `HumanDecision` (новый файл, аддитивно)
- **Карточка:** MW-030 (правка невыполненной карточки; `tasks.json:785` — `planned`) · **Решение:** D14 (выбран durable `HumanDecision` + доставка без блокировки шага)
- **Усилие:** S (1–2 ч) · **Риск:** низкий · **Откат:** revert (новый файл + одна строка реэкспорта)
- **Цель:** `HumanDecision` с состояниями `pending/answered/expired/cancelled/superseded`, `trigger`, `originState`, `answeredBy`, `revision`, `operationId`, `deadlineAt`.
- **Файлы:** Create `packages/contracts/src/human-decision.ts`; Modify `packages/contracts/src/index.ts` (добавить `export * from './human-decision.ts'` в блок `:68-96`); Modify `packages/contracts/src/operation.ts` (**новые коды** в существующем реестре `MYWORK_ERROR_CODES`, ~`:79`); Create `tests/human-decision-contract.test.mjs`
- **Новые коды (создаются здесь, а не предполагаются):** `GATE_EXPIRED`, `GATE_CANCELLED`, `GATE_SUPERSEDED`, `GATE_ALREADY_ANSWERED`, `OPERATION_ID_REUSED` — добавляются в `MYWORK_ERROR_CODES`; тест «реестр содержит все пять и не содержит дублей» входит в Q-09. Существующие `STALE_REVISION`, `LEASE_LOST`, `SECURITY_DENIED` не переименовываются.
- **Шаги:**
  1. Тест (падающий): импорт `HumanDecision`, `HUMAN_DECISION_STATES` из `packages/contracts/lib/index.js` → сейчас `undefined`.
     Команда: `node --test --test-isolation=none tests/human-decision-contract.test.mjs` → FAIL «HUMAN_DECISION_STATES is not defined».
  2. Реализация (дословный состав — из `E-human-gates.md:290-323`): `HumanDecisionState` (`pending|answered|expired|cancelled|superseded`), `HUMAN_DECISION_STATES` (заморожен), `HumanDecisionTrigger` размеченным объединением (`gate` → `HumanGate`; `attention` → `NeedsAttentionReason`; `review-escalation` → `ReviewId`; `work-acceptance` → `WorkType`), `DecisionActor` (`human|role|agent-on-behalf`), `StructuredQuestion`/`StructuredAnswer` (семантически совместимы с DSH, объявлены в MyWork — импорт DSH нарушил бы boundary-тест), `HumanDecision`, `humanDecisionFields`.
  3. Тест: `HUMAN_DECISION_STATES` заморожен и содержит ровно 5 значений; два одноимённых экспорта `HumanGate`/`HumanDecision` сосуществуют (проверка коллизии имён из §0.3); реестр `MYWORK_ERROR_CODES` содержит пять новых кодов из списка выше и ни одного дубля.
  4. Команда: `node --test --test-isolation=none tests/human-decision-contract.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; `npx tsc --noEmit -p packages/contracts` (или штатная сборка пакета) → 0 ошибок.
- **Evidence:** вывод теста, список экспортов, diff `contracts/src/index.ts`.
- **Риски:** `packages/contracts/src/security.ts` **не менять** (иначе меняется смысл `OperationRequest.gate`).

#### Q-10 · Аддитивные правки каталогов: `human-decision-pending`, `gate.asked`, `attention?`
- **Карточка:** MW-030 · **Усилие:** S · **Риск:** низкий (одно ожидаемое падение теста) · **Откат:** revert
- **Цель:** «ждём человека» отличимо от «человек пропустил SLA», и открытие гейта аудируется симметрично закрытию.
- **Файлы:** Modify `packages/contracts/src/board.ts` (`NEEDS_ATTENTION_REASONS` + `'human-decision-pending'`; `BoardPlacement.attention?: { reason; originState; decisionId? }` — **согласовать с `plan-surface`**), Modify `packages/contracts/src/audit.ts` (`AUDIT_EVENT_TYPES` + `'gate.asked'`), Modify `tests/board.test.mjs:603-612` (ожидание 7 → 8, с пояснением), Create `tests/attention-catalogue.test.mjs`
- **Шаги:**
  1. Тест (падающий): `NEEDS_ATTENTION_REASONS` содержит 8 значений, включая `'human-decision-pending'` и по-прежнему `'human-gate-deadline-exceeded'`.
     Команда: `node --test --test-isolation=none tests/attention-catalogue.test.mjs` → FAIL.
  2. Тест (падающий): `AUDIT_EVENT_TYPES` содержит `'gate.asked'`; сохранённые 16 значений не переименованы.
  3. Реализация: три аддитивные правки; тест `tests/board.test.mjs:603-612` обновляется **в этом же коммите** (иначе «зелёный» прогон врёт).
  4. Команда: `node --test --test-isolation=none tests/attention-catalogue.test.mjs tests/board.test.mjs` → `fail 0`.
- **Гейт:** оба файла тестов зелёные; в отчёте — перечисление новых значений.
- **Риски:** `BoardPlacement` — территория surface; если surface вносит то же поле сам, шаг ограничивается двумя каталогами (+ примечание).

#### Q-11 · Чистые функции жизненного цикла (без стора, без UI)
- **Карточка:** MW-030 · **Усилие:** S–M · **Риск:** низкий · **Откат:** revert
- **Цель:** вся логика гейта проверяема на `node --test --test-isolation=none` без БД и без клиента.
- **Файлы:** Create `packages/core/src/human-decision.ts`; Modify `packages/core/src/index.ts` (реэкспорт); Create `tests/human-decision-core.test.mjs`
- **Шаги:**
  1. Тест (падающий): `openHumanDecision(input)` → `state: 'pending'`, `revision: 1`, `originState` сохранён.
  2. Тест (падающий): `answerHumanDecision(decision, command, meta)` при `state !== 'pending'` и том же `operationId` возвращает **прежний результат**; при другом `operationId` → `GATE_ALREADY_ANSWERED` с `answeredBy` в деталях.
  3. Тест: `expireHumanDecisions(decisions, nowEpochMs)` переводит только истёкшие `pending`; `pendingHumanDecisions` фильтрует по `workspaceId`/`taskId`.
  4. Реализация по образцу `packages/core/src/blocker.ts` (чистые функции, `Result`-типы, `assertRevision`/`assertFence` из `packages/core/src/guards.ts`).
  5. Команда: `node --test --test-isolation=none tests/human-decision-core.test.mjs` → `pass 5 / fail 0`.
- **Гейт:** тест зелёный; функций ровно пять (`open`, `answer`, `expire`, `pending`, `humanDecisionOfTask`), стора в модуле нет (`grep -c "sqlite\|Database" packages/core/src/human-decision.ts` → 0).
- **Риски:** соблазн положить сюда I/O — запрещено; иначе тесты без UI станут невозможны.

#### Q-12 · Таблица `human_decisions` + authority (номер миграции — **из аллокатора**, R-04)
- **Карточка:** MW-030 · **Усилие:** S · **Риск:** низкий · **Откат:** откат аддитивной миграции
- **Зависит от:** `F-18` (единый реестр миграций), `F-19` (запрет открытия без канонического набора), `F-20` (journal)
- **Цель:** новая таблица с индексом под очередь внимания; запись решения — только владельцем; **в этом шаге нет литерала версии**.
- **Правило (R-04, D08, `01-MASTER-PLAN.md` §15.3):** версия выделяется **только единым аллокатором** в composition-слое, а не литералом в шаге: `validateMigrations` (`packages/storage/src/migrations.ts:111-129`) бросает на дубле версии, и store не откроется вовсе. Занято сегодня: v1 kernel (storage), v2–v3 evidence, v4 lease, v5 planner, v6 execution. Заявки, обязанные получить уникальные номера: `background_job` (`F-37`), триггеры retention (`F-40`), `attempt_worktree` (`E-04`), схема проекции/placement (`B-12`). Поэтому `human_decisions` получает номер **в порядке обращения к аллокатору**, а не `7` и не любой другой литерал.
- **Файлы:** Add миграцию в домен `mywork-db` там, где закрепит `F-18` (сегодня единственная миграция — `packages/storage/src/migrations.ts:91`, `MYWORK_MIGRATIONS`), Create `tests/human-decision-store.test.mjs`
- **Шаги:**
  1. Тест (падающий): после открытия store `SELECT name FROM sqlite_master WHERE name='human_decisions'` → одна строка; индекс `(workspaceId, state, deadlineAt)` существует.
     Команда: `node --test --test-isolation=none tests/human-decision-store.test.mjs` → FAIL «no such table».
  2. Тест-защита от R-04: тест **не содержит литерального списка версий** — ожидаемый набор читается из аллокатора; повторный прогон `validateMigrations` на полном реестре не бросает исключение о дубле.
  3. Реализация: `CREATE TABLE human_decisions` (`STRICT`, как `outbox` в `migrations.ts:54-70`), `payload` JSON, `HUMAN_DECISION_FIELDS` по образцу `AUDIT_ENTRY_FIELDS`; версия — значение, **выданное аллокатором**.
  4. Тест: запись решения не-владельцем → `SECURITY_DENIED` (использовать `assertWriteAuthority`; домен `approval.human` уже объявлен, `authority.ts:122`).
  5. Команда: `node --test --test-isolation=none tests/human-decision-store.test.mjs` → `pass 3 / fail 0`; регрессия `node --test --test-isolation=none tests/storage.test.mjs tests/authority.test.mjs` → `fail 0`.
- **Гейт:** тест зелёный; в отчёте — **выданный аллокатором** номер, точный SQL и вывод `validateMigrations` без дубля.
- **Риски:** пока `F-18`/`F-20` не сделаны, номер выдаётся вручную — тогда он **резервируется сообщением Lead'у**, а не выбирается исполнителем (иначе R-04 повторится).

#### Q-13 · CAS: `expectedRevision` + `controllerEpoch` на команде ответа
- **Карточка:** MW-030 · **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** гейт переживает failover контроллера: старый UI не может записать ответ «по своей» ревизии.
- **Файлы:** Modify `packages/core/src/human-decision.ts`, Create `tests/human-decision-cas.test.mjs`
- **Шаги:**
  1. Тест (падающий): `expectedRevision` на 1 меньше текущей → `STALE_REVISION` с `{expected, actual}` в деталях.
  2. Тест (падающий): устаревший `controllerEpoch` → `LEASE_LOST`.
  3. Тест: успешный ответ инкрементирует `revision` на 1 и пишет `answeredBy`/`answeredAt`.
  4. Команда: `node --test --test-isolation=none tests/human-decision-cas.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — использованные коды ошибок (не новые: `STALE_REVISION`, `LEASE_LOST` уже существуют).
- **Риски:** `controllerEpoch` без живого lease в тесте — брать фикстуру lease, а не мокать epoch руками.

#### Q-14 · Идемпотентность ответа: порядок проверок именно такой
- **Карточка:** MW-030 + MW-046 (приёмка «повтор steer с тем же `operationId` даёт один эффект», `MW-046.md:21`) · **Усилие:** S · **Риск:** средний (легко сделать «уже отвечено» раньше дедупликации) · **Откат:** revert
- **Цель:** retry HTTP/двойной клик не показывает пользователю ошибку там, где всё в порядке; другой `operationId` на закрытом гейте — типизированный отказ с победителем.
- **Файлы:** Modify `packages/core/src/human-decision.ts`, Create `tests/human-decision-idempotency.test.mjs`
- **Шаги:**
  1. Тест (падающий): тот же `operationId` и та же нагрузка → тот же результат, **одна** строка аудита.
  2. Тест (падающий): тот же `operationId`, другая нагрузка → `OPERATION_ID_REUSED` (молчаливое принятие «другого ответа под тем же id» запрещено).
  3. Тест: другой `operationId` при `state !== 'pending'` → `GATE_ALREADY_ANSWERED` + текущие `revision` и `answeredBy`.
  4. Команда: `node --test --test-isolation=none tests/human-decision-idempotency.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — порядок проверок «(1) operationId → (2) state → (3) revision/epoch» одной строкой.
- **Риски:** если `operationId` хранится только в аудите, а не в сущности — дедупликация будет неполной; проверка в шаге 0.

#### Q-15 · Аудит `gate.asked` / `gate.decided` / `human.override` — с актором
- **Карточка:** MW-030 (приёмка «Human override аудируется», `MW-030.md:20`) · **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** на одно решение — ровно пара «спросили/решили» с общим id, и в строке видно **кто** ответил.
- **Файлы:** Modify `packages/core/src/human-decision.ts` (запись аудита), Modify `packages/evidence/src/audit.ts` **только если** шаг 0 покажет отсутствие поля актора; Create `tests/human-decision-audit.test.mjs`
- **Шаги:**
  1. **Шаг 0 (обязательный):** прочитать `AUDIT_ENTRY_FIELDS` (`packages/contracts/src/audit.ts:88-89` — в потоке E прочитано только начало) и ответить: несёт ли строка аудита актора. Записать вывод в отчёт. Если не несёт — добавить аддитивное поле актора (это **отдельная** правка, отдельный коммит).
  2. Тест (падающий): открытие гейта пишет `gate.asked`; ответ пишет `gate.decided`; отмена автоматического решения пишет `human.override`; у `asked`/`decided` общий id гейта.
     Команда: `node --test --test-isolation=none tests/human-decision-audit.test.mjs` → FAIL.
  3. Тест: повтор с тем же `operationId` не пишет вторую строку аудита.
  4. Команда: `node --test --test-isolation=none tests/human-decision-audit.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — дословный состав строки аудита (до/после).
- **Риски:** `gate.decided` уже используется planner'ом (`planner/src/service.ts:998`) — новое значение не должно изменить его семантику «typed gate decided by a human **or an admitted policy**».

#### Q-16 · Девять тестов без UI — доказательство, что сущность работает
- **Карточка:** MW-030 (приёмка) · **Усилие:** M · **Риск:** низкий · **Откат:** revert
- **Цель:** полный набор из `E-human-gates.md:404`, все — на `node --test --test-isolation=none` с фикстурами `tests/lib/fixtures.mjs`, без HTTP и без клиента.
- **Файлы:** Create `tests/human-decision.test.mjs`
- **Состав (9):** 1) истечение без ответа → `needs-attention` + `human-gate-deadline-exceeded`; 2) ответ после истечения → `GATE_EXPIRED` (ответ **сохраняется** в аудите); 3) ответ после отмены → `GATE_CANCELLED`; 4) ответ после смены ревизии → `GATE_SUPERSEDED` + **новый** гейт; 5) повтор с тем же `operationId` → один эффект и одна строка аудита; 6) другой `operationId` при отвеченном → `GATE_ALREADY_ANSWERED`; 7) stale `expectedRevision` → `STALE_REVISION`; 8) stale `controllerEpoch` → `LEASE_LOST`; 9) запись решения не-владельцем → `SECURITY_DENIED`.
- **Шаги:**
  1. Написать 9 тестов пакетом.
  2. Команда: `node --test --test-isolation=none tests/human-decision.test.mjs` → `pass 9 / fail 0`.
  3. Команда (регрессия): `node --test --test-isolation=none tests/guards.test.mjs tests/authority.test.mjs tests/board.test.mjs` → `fail 0`.
- **Гейт:** `node --test --test-isolation=none tests/human-decision.test.mjs` → `# pass 9`, `# fail 0`, exit 0.
- **Evidence:** вывод прогона, sha коммита, список 9 имён тестов.
- **Риски:** тесты 1 и 4 требуют управляемых часов — брать инъецированные (см. `F-…` про источник времени; `D11`), а не `Date.now()`.

#### Q-17 · Доставка ответа в живую попытку — три случая, и они не смешиваются
- **Карточка:** MW-046 (правка; `tasks.json:1217` — `planned`) · **Усилие:** M · **Риск:** высокий (касается живой сессии) · **Откат:** revert
- **Цель:** ответ человека доходит туда, где его ждут: в живую попытку, в admission или никуда (с типизированным отказом).
- **Дельта 0.2.0-rc.2 (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D1, D12) — образец и запрет.** Платформа сама доставляет поздний ответ в живую сессию ровно как steered-сообщение с источником `{kind:'user-question-reply', callId, outcome:'answered'}` (`packages/interaction/user-questions/src/index.ts:187`) — это подтверждает выбранный шагом 1 путь `mode:'steer'`. Запрет: **не строить закрытый union по `user/message.source.kind`** — формат сессии остался **v4**, но kind добавлен решением `same-version` (`docs/persistence-changes/2026-09-21-user-question-reply.md`), и следующее аддитивное значение снова сломает закрытое перечисление; читать источник нужно открыто (через `kind === …` и ветку по умолчанию, а не `never`-исчерпание).
- **Файлы:** Modify `packages/execution/src/service.ts` (или сервис, реализующий `attempt.steer`), Modify `packages/controller/src/dsh-session.ts` (`mode: 'steer'` вместо постоянного `'queue'` — `quality-D-context §38(а)`: сегодня режим всегда `'queue'`, `dsh-session.ts:640`); Create `tests/human-decision-delivery.test.mjs`
- **Шаги:**
  1. Тест (падающий): `attemptId` указан и попытка жива → ровно один `prompt` с `mode: 'steer'`; прямая запись в session store отсутствует.
  2. Тест (падающий): `attemptId` отсутствует, задача в `needs-attention` → переход `needs-attention → ready` и решение уезжает в контекст следующей попытки (через Context Fabric, Q-01) — прямой записи в сессию нет.
  3. Тест (падающий): ревизия/попытка сменились → `GATE_SUPERSEDED`, гейт `superseded`, новый гейт против новой ревизии; ответ **не переносится**.
  4. Команда: `node --test --test-isolation=none tests/human-decision-delivery.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — какой путь вызван в каждом из трёх случаев (имя функции + файл:строка).
- **Риски:** `mode: 'steer'` меняет поведение адаптера для **всех** вызовов `#prompt`; ограничить изменением сигнатуры (параметр режима), а не сменой дефолта.

#### Q-18 · `DiscussionMessage(kind='decision')` и маршруты обсуждения
- **Карточка:** MW-046 · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** решение человека видно в обсуждении карточки, идемпотентно и с аудитом.
- **Файлы:** Modify/Add: миграция обсуждения (домен — по `F-18`), Modify `packages/execution/src/service.ts`, Modify HTTP-маршруты `ctx.webServer` (`/v1/tasks/{id}/discussion`, `/v1/attempts/{id}/steer` — из объёма `MW-046.md:18`, сегодня `DiscussionMessage|attempt.steer|webServer` — 0 совпадений в `packages/*.ts`, `quality-07:20`); Create `tests/discussion-decision.test.mjs`
- **Шаги:**
  1. Тест (падающий): ответ человека создаёт ровно одно `DiscussionMessage` с `kind: 'decision'` и ссылкой на гейт.
     Команда: `node --test --test-isolation=none tests/discussion-decision.test.mjs` → FAIL.
  2. Тест: повтор `steer` с тем же `operationId` → один эффект (это дословная приёмка MW-046).
  3. Тест: маршрут для несуществующей попытки → `SESSION_NOT_FOUND` (типизированный код из объёма карточки), а не 500.
  4. Команда: `node --test --test-isolation=none tests/discussion-decision.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — имена маршрутов и коды ошибок.
- **Риски:** транспорт Web — предмет D01; шаг не выбирает транспорт, а требует, чтобы тест не зависел от выбора (тестировать сервис, не HTTP-слой).

#### Q-19 · Гейт обязан освобождать worker-сессию: запрет блокирующего `ask()` из попытки
- **Карточка:** MW-030 + MW-046 · **Решение:** D14 · **Усилие:** S · **Риск:** высокий (если не сделать — весь гейт бесполезен) · **Откат:** revert
- **Цель:** шаг агента не висит на человеке; после открытия гейта попытка завершает ход с результатом «ждём решения».
- **Файлы:** Modify путь попытки (там же, где Q-17), Create `tests/human-decision-nonblocking.test.mjs`
- **Шаги:**
  1. Тест (падающий): попытка, которой нужен ответ человека, **завершает** свой ход; в трейсе нет вызова `userQuestions.ask`, а гейт открыт.
     Команда: `node --test --test-isolation=none tests/human-decision-nonblocking.test.mjs` → FAIL.
  2. Тест: `DELEGATED_CALLER`-сценарий (живой агент не в `agents.roots()`, `user-questions/src/index.ts:138-143`, код `:142`) не приводит к ошибке попытки — вопрос уходит в `HumanDecision`.
  3. Тест: рестарт рантайма между открытием и ответом не теряет гейт (перечитать из store, `verify` ок).
  4. Реализация: единственная санкционированная точка «спросить» — открытие гейта вне tool call; блокирующий `ask()` допустим **только** как live-adapter в root-сессии контроллера (и это фиксируется комментарием со ссылкой на §29).
  5. Команда: `node --test --test-isolation=none tests/human-decision-nonblocking.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — цитата из трейса, где видно отсутствие ожидания.
- **Риски:** соблазн «пока оставить `ask()` для простоты» — это и есть дефект, который шаг закрывает; при отказе от шага гейт не может считаться durable.

---

## 3. Группа C. Work types и finish criteria (MW-045, ADR028)

**Состояние: 0 совпадений.** `rg -c -e 'WorkType|FinishCriteria|FINISH_CRITERIA|FINISH_CRITERIA_UNMET|humanAcceptance'` по `packages/**/src` → **0, exit 1**; по `tests/` → **0, exit 1**; `packages/contracts/src/worktype.ts` и `packages/core/src/worktype.ts` — `Test-Path False` (`quality-09:1-5`). `FINISH_CRITERIA_UNMET` встречается только в прозе ADR028 (строки 392, 403).

**Что требует ADR028** (`.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377`, таблица `:383-390`): 6 work types, у каждого — required evidence, verification, integration strategy и **human acceptance**:

| Work type | Evidence | Verification | Интегратор | Человеческая приёмка |
|---|---|---|---|---|
| `code` | `diff`, `test-report` | build, test, boundary | `git-merge` | на интеграции |
| `research` | `worker-report`, `review-verdict` | source-citation, claim-support | `artifact-publish` | да |
| `analysis` | `worker-report`, `review-verdict` | claim-support, data-provenance | `artifact-publish` | да |
| `document` | `worker-report`, `design-doc` | structure, terminology, link-check | `artifact-publish` | да |
| `manual` | `manual-receipt` (или `screenshot`) | operator-attested checklist | `manual-receipt` | всегда |
| `non-git-ops` | `worker-report` (или `build-log`) | command-receipt | `none` | да |

**Человеческая приёмка для 4 из 6 типов** (в моей зоне формулировки): `research`, `analysis`, `document` — «да» (приёмка обязательна один раз на результат), `manual` — «всегда» (приёмка обязательна на каждое принятое утверждение). У `code` приёмка «на интеграции» — это то же решение человека, но привязанное к моменту слияния; `non-git-ops` — «да».

#### Q-20 · `contracts/src/worktype.ts`: тип, каталог, `humanAcceptance`
- **Карточка:** MW-045 (правка; `tasks.json:1190` — `planned`, `adrs` — `:1181-1184`) · **Решение:** ADR028
- **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Файлы:** Create `packages/contracts/src/worktype.ts`; Modify `packages/contracts/src/index.ts` (звёздочный реэкспорт в блоке `:68-96`); Create `tests/worktype-contract.test.mjs`
- **Шаги:**
  1. Тест (падающий): импорт `WORK_TYPES`, `FINISH_CRITERIA`, `resolveFinishCriteria` → `undefined`.
     Команда: `node --test --test-isolation=none tests/worktype-contract.test.mjs` → FAIL.
  2. Реализация: `WorkType` (6 значений дословно из таблицы ADR028), `FinishCriteria` с полями `requiredEvidence`, `verification`, `integration`, `humanAcceptance: 'never' | 'on-integration' | 'always'`, замороженный `FINISH_CRITERIA` (ровно 6 записей), `resolveFinishCriteria(workType)`.
  3. Тест: у `manual` — `humanAcceptance: 'always'`; у `code` — `'on-integration'`; у `research`/`analysis`/`document`/`non-git-ops` — `'always'`/`'on-integration'` **точно по таблице**, без «примерно».
  4. Команда: `node --test --test-isolation=none tests/worktype-contract.test.mjs` → `pass 4 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — таблица «work type → humanAcceptance» с якорями строк ADR028.
- **Риски:** карточка указывает пути как `contracts/src/...` (`MW-045.md:18`) — в монорепо путь `packages/contracts/src/...`; исправить формулировку карточки через `30-CARD-EDITS.md`, не «как в карточке».

#### Q-21 · `FINISH_CRITERIA_UNMET`: движок отказывает в `done`
- **Карточка:** MW-045 (правка приёмки) · **Усилие:** M · **Риск:** средний (может «покраснеть» существующий путь завершения) · **Откат:** revert
- **Файлы:** Create `packages/core/src/worktype.ts` (`assertFinishCriteriaSatisfied`), Modify путь завершения попытки/задачи (`packages/execution/src/service.ts` ~), Modify `packages/contracts/src/operation.ts` (`MYWORK_ERROR_CODES` + `FINISH_CRITERIA_UNMET`); Create `tests/finish-criteria.test.mjs`
- **Шаги:**
  1. Тест (падающий): `manual`-задача без `manual-receipt` → отказ `FINISH_CRITERIA_UNMET` с перечислением недостающего evidence.
     Команда: `node --test --test-isolation=none tests/finish-criteria.test.mjs` → FAIL.
  2. Тест: `code`-задача без `test-report` → отказ; с `diff` + `test-report` → переход разрешён.
  3. Тест: `non-git-ops` (интегратор `none`) не требует интеграции, но требует `command-receipt`.
  4. Реализация: тотальная функция, возвращающая `Result`; отказ — типизированный код, не текст.
  5. Команда: `node --test --test-isolation=none tests/finish-criteria.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — точный список требуемых evidence по типам.
- **Риски:** это правило меняет смысл «Готово» — см. §9 «Что НЕ делать»: колонка «Готово» перестаёт быть доказательством приёмки.

#### Q-22 · `ARTIFACT_KINDS` и четыре интегратора без Git
- **Карточка:** MW-045 · **Усилие:** S · **Риск:** низкий · **Откат:** revert
- **Цель:** `manual-receipt`, `web-citation`, `design-doc` — законные виды артефактов; интегратор не обязан быть git.
- **Факты:** `ARTIFACT_KINDS` — 12 значений, трёх нужных нет (`packages/contracts/src/artifact.ts:62-75` — `quality-07:15`); `Review.findings`/`artifactRef` уже есть.
- **Файлы:** Modify `packages/contracts/src/artifact.ts`; Create `tests/artifact-kinds.test.mjs`
- **Шаги:**
  1. Тест (падающий): `ARTIFACT_KINDS` содержит `manual-receipt`, `web-citation`, `design-doc`; существующие 12 не переименованы.
     Команда: `node --test --test-isolation=none tests/artifact-kinds.test.mjs` → FAIL.
  2. Тест: интегратор `manual-receipt` принимает артефакт без git-контекста (нет `headSha`), а `git-merge` — не принимает.
  3. Команда: `node --test --test-isolation=none tests/artifact-kinds.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — 15 значений и их назначение.
- **Риски:** `ARTIFACT_KINDS` читает evidence-слой — проверить, что добавление не ломает `putArtifact` (`packages/evidence/src/metadata.ts`).

#### Q-23 · Человеческая приёмка по work type — связка `FinishCriteria` ↔ `HumanDecision`
- **Карточка:** MW-045 + MW-030 · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Зависит от:** Q-20, Q-21, Q-16 (гейт умеет жить), Q-19
- **Цель:** для типов с `humanAcceptance !== 'never'` завершение требует записи `answered`; триггер — `{ kind: 'work-acceptance', workType }`.
- **Файлы:** Modify `packages/core/src/worktype.ts`, Modify `packages/core/src/human-decision.ts`; Create `tests/work-acceptance.test.mjs`
- **Шаги:**
  1. Тест (падающий): `research`-задача с полным evidence, но без отвеченного гейта → отказ `FINISH_CRITERIA_UNMET` с причиной «human acceptance pending».
     Команда: `node --test --test-isolation=none tests/work-acceptance.test.mjs` → FAIL.
  2. Тест: гейт открыт автоматически с `trigger.kind === 'work-acceptance'` и `originState` = фаза на момент входа.
  3. Тест: ответ `answered` → завершение разрешено; `expired` → нет, и задача в `needs-attention` с `human-gate-deadline-exceeded`.
  4. Тест: агенту отвечать нельзя — `DecisionActor` без `kind` человека/роли → `SECURITY_DENIED` (иначе гейт вырождается в самоподтверждение; MyWork уже запрещает self-review, `tests/review.test.mjs:64-77`).
  5. Команда: `node --test --test-isolation=none tests/work-acceptance.test.mjs` → `pass 4 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — для каких 4 из 6 типов приёмка обязательна и на каком основании.
- **Риски:** для `code` приёмка «на интеграции» привязывается к моменту слияния, а не к завершению попытки — если это не выражается текущим контрактом, шаг завершается частично и фиксирует пробел в §10.

---

## 4. Группа D. Обучение и наблюдаемость (MW-032…MW-034, D16)

**Что уже есть.** `MemoryFabric`/`SkillRegistry`/`planner` — с тестами и без потребителя (§0.1). Учёт расхода **уже есть** и второй строить запрещено: `BudgetAmount = {kind:'known',value} | {kind:'unknown',reason}` (без нуля-по-умолчанию), `BudgetConsumption {tokens, cost, attempts, reviewLoops, plannerCalls}`, `EMPTY_BUDGET_CONSUMPTION`, `ModelRate`/`ModelRateTable` (`packages/contracts/src/budget.ts:31-33,36-47,50-56,207-219`); `chargeConsumption` — **единственная** функция, создающая новое `BudgetConsumption` (`packages/core/src/budget.ts:122`), `readCallTokens` `:151`, `modelCallCost` `:181`, `decideBudgetAdmission` `:450`. Пропущенное измерение записывается как `unknown`, а не 0 (`:107-116`). Платформенный снимок даёт `dsh-token-meter`: сервис `tokenMeter` (`packages/llm/token-meter/src/index.ts:94-98,111`), `measure(session: Session, requestHeader?: EpochHeader)` `:146` (не `:214` — там `estimateMessage(message: Message)`), проекции `tokenUsage`/`contextPressure`/`contextBreakdown` (`src/projection.ts:13-18,30-48,59-66`), per-turn разбивка по маршрутам (`src/turn-usage.ts:142-147`). **Ни cost, ни лимитов у метра нет** (`grep cost|currency|usd` → только проза; конфиг — `Record<string, never>`).

#### Q-24 · Fast Role Learner (MW-032) — дельта к существующему `planner`
- **Карточка:** MW-032 (приёмка — свойства-интенты без имён и чисел, `quality-07:13`) · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Зависит от:** Q-01 (контекст попытки), MW-024 (review-вердикт как вход обучения)
- **Цель:** по итогам попытки — либо `No learning`, либо **кандидат** с provenance/trust/conflict; кандидат не становится активным автоматически.
- **Файлы:** Modify `packages/planner/src/service.ts` (~ путь «предложение»: `work_proposal` уже есть, `packages/planner/src/schema.ts:112`), Create `tests/fast-role-learner.test.mjs`
- **Шаги:**
  1. Тест (падающий): успешная попытка без нового знания → ровно `No learning` (не пустой кандидат).
     Команда: `node --test --test-isolation=none tests/fast-role-learner.test.mjs` → FAIL «написано: candidate {}».
  2. Тест (падающий): кандидат несёт `provenance` (ссылки, не тела), trust-класс и признак конфликта с существующим знанием.
  3. Тест: кандидат **не** попадает в контекст следующей попытки до promotion (проверяется отсутствием элемента в снапшоте).
  4. Команда: `node --test --test-isolation=none tests/fast-role-learner.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — имя таблицы/поля, где живёт кандидат, и номера строк.
- **Риски:** «обучение» легко превращается в тихую запись в память — тогда оно обойдёт Q-03 (fabric). Запрещено: кандидат идёт через `work_proposal`/`plan_mutation`, а не в память напрямую.

#### Q-25 · Sleep Optimizer, curator и promotion-gate (MW-033)
- **Карточка:** MW-033 · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** promotion из `Draft → Offline Eval → Shadow → Canary → Stable` с `Reject`/`Rollback`, метриками и историей ревизий — и не автоматически.
- **Файлы:** Modify `packages/planner/src/service.ts` (curator), Modify место durable-job (носитель — `F-36`/`F-37`); Create `tests/optimizer-promotion.test.mjs`
- **Шаги:**
  1. Тест (падающий): promotion без offline-eval → отказ типизированным кодом; с eval, но с ухудшением метрики → `Reject`.
     Команда: `node --test --test-isolation=none tests/optimizer-promotion.test.mjs` → FAIL.
  2. Тест (падающий): бюджет `maxOptimizerCostPerDay` (имя уже есть в `BUDGET_LIMIT_NAMES`, `packages/contracts/src/budget.ts:59-87`) исчерпан → optimizer не стартует.
  3. Тест: `Rollback` возвращает предыдущую ревизию, история ревизий сохранена.
  4. Команда: `node --test --test-isolation=none tests/optimizer-promotion.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — таблица переходов и что именно измерялось на `Offline Eval`.
- **Риски:** `LocalJobRegistry` **не durable** (in-memory, `packages/jobs/jobs-local/src/index.ts:1-11`; README `:32,61`) — как носитель для optimizer не годится; носитель выбирает `F-36`.

#### Q-26 · Optimizer идемпотентен и переживает рестарт
- **Карточка:** MW-033 · **Усилие:** S · **Риск:** средний · **Откат:** revert
- **Зависит от:** `F-36`/`F-37` (durable jobs)
- **Цель:** запуск optimizer'а дважды не даёт двух promotions; прерывание не оставляет «полуприменённое» состояние.
- **Файлы:** Modify `packages/planner/src/service.ts` (или сервис job'а); Create `tests/optimizer-durability.test.mjs`
- **Шаги:**
  1. Тест (падающий): тот же `operationId` запуска → одна запись promotion и один набор метрик.
     Команда: `node --test --test-isolation=none tests/optimizer-durability.test.mjs` → FAIL.
  2. Тест: имитация рестарта между шагами → повторный запуск продолжает, а не начинает заново, и не применяет promotion дважды.
  3. Команда: `node --test --test-isolation=none tests/optimizer-durability.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — названный носитель durable-состояния.
- **Риски:** если `F-36`/`F-37` не сделаны — шаг помечается `BLOCKED` на них, а не «обходится» файловым журналом.

#### Q-27 · Экспорт `correlationId` и продуктовые события — **ссылка на `F-54` / `F-55`**
- **Тип:** шаг-ссылка (**R-14**: дубль с `20-STEPS-foundation.md` устранён, механика остаётся в 20)
- **Карточка:** MW-034 · **Решение:** D16 — «свой audit/outbox с `correlationId` — источник истины; `ctx.productTelemetry` — наружу; OTel-экспортёр не строим». **Уточнение дельты 0.2.0-rc.2 (D3):** общий транспорт теперь — отдельный сервис `ctx.otel` (`packages/telemetry/otel/src/index.ts:14`), `product-telemetry-otel` стал его политика-адаптером; ни `ctx.otel`, ни `ctx.productTelemetry` в живом профиле не смонтированы (`desktop-product-telemetry` `enabled:false`), поэтому отсутствие шва не должно ломать ни один шаг.
- **Что остаётся в 20 и здесь не дублируется:** `F-54` — экспорт существующего `correlationId` через платформенный `product-telemetry` (не OTel); `F-55` — состав событий и политика PII. Тесты обоих — тоже в 20.
- **Что файл 23 проверяет со своей стороны:** что экспорт не создаёт второй учёт и не несёт тел — это `F-51`/`F-55`, а сканирование тел — Q-39.
- **Факты (вход для `F-54`, собран мной):** `correlationId` — 172 совпадения в 35 файлах, `correlation_id` — 28/10; `otel|OTel|telemetry` по `packages/**` → **0 совпадений, rg exit 1** (`quality-04:22`) на базе `0.1.7-rc.2`; **дельта 0.2.0-rc.2:** `ctx.productTelemetry` — политика-адаптер над общим `ctx.otel`, а не самостоятельный OTLP/HTTP-экспортёр (`packages/host/product-telemetry-otel/src/index.ts:1,9,84,118`, файл 121 строка), поля записи уехали в `packages/telemetry/otel/src/event-log.ts:18,24`; шов в живом профиле **не смонтирован** (`02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D3).
- **Гейт:** выполняется в `F-54`/`F-55`; здесь — только отметка «ссылка», чтобы не было двух writers на одну механику.

#### Q-28 · Снимок метрик token/context/cost — **ссылка на `F-51` / `F-52`**
- **Тип:** шаг-ссылка (**R-14**). Мост `ctx.tokenMeter.measure(...)` → `BudgetCharge` — `F-51`; значения лимитов и поведение при превышении — `F-52`. Второй учёт запрещён (§9 п.1).
- **Что остаётся уникальным здесь (MW-034, «владелец видит расход»):**
  1. Тест (падающий): снимок содержит `tokens`, `cost`, `contextPressure` (из `tokenMeter`) и `unknown` там, где источник неизвестен — **не** 0.
     Команда: `node --test --test-isolation=none tests/metrics-counters.test.mjs` → FAIL.
  2. Тест: число вызовов `chargeConsumption` в процессе = число записанных расходов (доказательство, что второго учёта нет).
  3. Команда: `node --test --test-isolation=none tests/metrics-counters.test.mjs` → `pass 2 / fail 0`.
- **Файлы:** Create `packages/controller/src/metrics.ts` (**только** чтение существующих `BudgetConsumption`), Create `tests/metrics-counters.test.mjs`
- **Гейт:** тест зелёный; `grep -c "BudgetConsumption" packages/controller/src/metrics.ts` → 0 (метрики не объявляют свой тип расхода).
- **Передано в `F-52` (R-26, §9.2(2)):** retry-множитель провайдера в бюджете — N-й retry того же вызова не создаёт вторую запись расхода, но учитывает множитель, если провайдер его тарифицирует; тест на это — в 20.

#### Q-29 · `providerConcurrency`: собственный счётчик, а не платформенный
- **Карточка:** MW-034 (пункт «provider», `MW-034.md:17`) · **Усилие:** S · **Риск:** средний · **Откат:** revert
- **Факты:** в платформе `providerConcurrency` **отсутствует** (0 совпадений по checkout); ближайшее — `maxParallelToolCalls`, `maxParallelSubCalls` (default 10), `imageCompressionConcurrency` (`quality-04:16-17`). Значит это метрика/лимит MyWork, а не подключение готового.
- **Файлы:** Create `packages/core/src/concurrency.ts` (~ учёт in-flight вызовов модели), Modify путь вызова модели; Create `tests/provider-concurrency.test.mjs`
- **Шаги:**
  1. Тест (падающий): три параллельных вызова модели при лимите 2 → наблюдаемый пик 2 и один вызов в ожидании.
     Команда: `node --test --test-isolation=none tests/provider-concurrency.test.mjs` → FAIL.
  2. Тест: счётчик уменьшается и на ошибке, и на отмене (иначе «залипание»).
  3. Команда: `node --test --test-isolation=none tests/provider-concurrency.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — значение лимита и где оно конфигурируется.
- **Риски:** не путать с `maxParallelToolCalls` платформы; если решено переиспользовать его — шаг закрывается ссылкой с доказательством, что он покрывает вызовы модели.

#### Q-30 · Budget/step circuit-breaker — **ссылка на `F-52` / `F-53`**
- **Тип:** шаг-ссылка (**R-14**). `F-52` — значения лимитов §30 и поведение при превышении; `F-53` — шаговый circuit-breaker.
- **Моя часть (не механика, остаётся в 23):** ветка превышения обязана приводить к `HumanDecision` с триггером `NeedsAttentionReason 'budget-exhausted'`, а снятие автоматического отказа человеком — писать `human.override`; это проверяется тестами и инвариантом Q-15/Q-16/Q-36, а не вторым breaker'ом.
- **Факты (вход для `F-52`):** единственная точка входа — `budgetVerdict` → `decideBudgetAdmission` (`packages/core/src/scheduler.ts:561-568`, `quality-04:21`); `chargeConsumption` — единственная функция, создающая новое `BudgetConsumption` (`packages/core/src/budget.ts:122`); `decideBudgetAdmission` `:450`.
- **Гейт:** выполняется в `F-52`/`F-53`; здесь — отметка «ссылка».

---

## 5. Группа E. Doctor, полный conformance, session/model (MW-038, D20, N-4)

**Что уже есть.** `verify:profile` работает и проходит: 10,5 с, изолированный `DSH_HOME`, 3 хэша реального профиля не изменились (FINAL-REPORT §8.1). Conformance-каркас есть: `packages/adapter-sdk/src/conformance.ts` (`runConformance` ~`:236`, `memoryChecks` ~`:768`), тесты уже требуют «падать громко, а не молча пропускать» (`tests/adapters.test.mjs:288,304,307`), а набор `agent-runtime` покрывает все §39-имена (`:359`). **Чего нет:** модуля Doctor (0 файлов по `glob **/src/**/*doctor*`), проверки mtime/хэшей профиля, диагностики `bd`-seam, конформности «все адаптеры в CI, 0 skip», и двух тем из D N-2/N-4.

#### Q-31 · Doctor: сверка mtime/хэшей профиля и запрет немого изменения `~/.dsh`
- **Карточка:** MW-038 (правка; отчёта нет) · **Риск сценария:** RT-9 «снос профиля» (ядро подтверждено, формулировка поправлена) · **Усилие:** M · **Откат:** revert
- **Цель:** Doctor сообщает, что менялось в профиле, умеет dry-run и **не** пишет в профиль без явного флага.
- **Факты (проверено чтением):** путь профиля вычисляет `defaultDshHome()` — `packages/storage/src/layout.ts:66-68` (`join(homedir(), '.dsh')`); `resolveMyWorkLayout` (`:76-84`) добавляет `DSH_HOME_ENV`/`dshHome` и помещает состояние в `$DSH_HOME/dsh-mywork/state`; второй потребитель пути — `scripts/verify-profile.mjs:127-134`. Профиль **не под git**; существующий `verify:profile` уже сравнивает 3 хэша (FINAL-REPORT §8.1).
- **Файлы:** Create `packages/controller/src/doctor.ts` (модуля сегодня **нет**: `glob **/src/**/*doctor*` → 0 файлов, `quality-08:23`; размещение — решить в шаге 0), Modify `scripts/verify-profile.mjs` (добавить режим сверки), Create `tests/doctor-profile.test.mjs`
- **Шаги:**
  1. Тест (падающий): профиль изменён между двумя прогонами → Doctor возвращает список изменившихся путей с `before`/`after` хэшами и mtime.
     Команда: `node --test --test-isolation=none tests/doctor-profile.test.mjs` → FAIL «нет модуля doctor».
  2. Тест (падающий): вызов без `--apply` не пишет в профиль ни одного байта (сравнение mtime-снимка до/после).
  3. Тест: отсутствующий `$DSH_HOME` → типизированный отказ, а не создание каталога.
  4. Реализация: чтение и хэширование существующим способом (`scripts/verify-profile.mjs`), вывод — структурированный отчёт.
  5. Команда: `node --test --test-isolation=none tests/doctor-profile.test.mjs` → `pass 3 / fail 0`.
  6. Гейт на живом профиле (только чтение): `node scripts/verify-profile.mjs` → `verify:profile: PASS`, и **3 хэша реального профиля не изменились** (сравнить с прогоном до шага).
- **Гейт:** тест зелёный **и** `verify:profile: PASS` без изменения хэшей реального профиля.
- **Evidence:** вывод обеих команд, список путей отчёта Doctor, sha коммита.
- **Риски:** Doctor, который «лечит» профиль сам, — прямой путь к сносу. В v0.1 Doctor только читает и предлагает; запись — отдельный флаг, отдельное решение.

#### Q-32 · Диагностика `bd`-seam и CI-профиль — **ссылка на `F-13`…`F-15`, `F-17`**
- **Тип:** шаг-ссылка (**R-14**). В 20 остаётся вся механика: резолвер JS-entry (`F-13`), применение в `createProcessRunner` (`F-14`), «одна функция доступности, используемая и тестом, и Doctor'ом» (`F-15`), «skip реального backend → падение в CI-профиле» (`F-17`).
- **Снято с меня:** прежняя формулировка «диагностика — моя» неверна: `F-15` владеет именно переиспользуемой функцией. Моя часть — только **потребитель**: окно Doctor (Q-31, Q-33) печатает результат `F-15`; своей логики резолва в 23 не появляется.
- **Факты (вход для `F-13`…`F-17`, собран мной):** `spawnSync('bd', {shell:false})` → ENOENT (errno −4058) на Windows; тот же дефект в `packages/beads-adapter/src/runner.ts:96,102-108`; 23 теста реального backend молча `skipped`.
- **Осознанно не делаем в v0.1 (R-26, §12.4 п.6):** `bd init`, Dolt-remote, `bd serve` и поведение на Linux/macOS не проверяются — `MW-056` это прямо запрещает, живого Dolt в контуре нет. Запись с причиной — в §10.
- **Гейт:** выполняется в `F-13`…`F-17`; здесь — отметка «ссылка».

#### Q-33 · Полный adapter conformance как команда, а не как набор тестов
- **Карточка:** MW-038 (правка) · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** одна команда прогоняет conformance **всех** зарегистрированных адаптеров и печатает матрицу; пропуск — красный.
- **Файлы:** Modify `packages/controller/src/doctor.ts` (**зависит от Q-31**: модуль создаётся там; при невыполненном Q-31 шаг сначала создаёт каркас и не правит несуществующий файл), Modify `packages/adapter-sdk/src/conformance.ts` (**только** добавление проверок), Create `tests/doctor-conformance.test.mjs`
- **Шаги:**
  1. Шаг 0: прочитать сигнатуру `runConformance` (`packages/adapter-sdk/src/conformance.ts` ~`:236`) и список `REQUIRED_CONFORMANCE_CHECKS` (`tests/adapters.test.mjs:304`) — записать в отчёт.
  2. Тест (падающий): Doctor прогоняет conformance всех адаптеров из `myworkAdapters` и печатает матрицу `адаптер × набор × pass/fail/skip`.
     Команда: `node --test --test-isolation=none tests/doctor-conformance.test.mjs` → FAIL.
  3. Тест: `skip` в CI-профиле считается **провалом** (правило уже заявлено тестом `tests/adapters.test.mjs:307` — распространить на Doctor).
  4. Команда: `node --test --test-isolation=none tests/doctor-conformance.test.mjs` → `pass 2 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — матрица по 4+ адаптерам (dsh-runtime, beads, memory-native, memory-beads).
- **Риски:** «полный conformance» может потребовать новых проверок у адаптеров, которые их сегодня не проходят; тогда в отчёте фиксируется список непройденных, а не ослабление набора.

#### Q-34 · Session conformance: 8 тестов — **ссылка на `F-44`**
- **Тип:** шаг-ссылка (**R-14**). Владелец механики и тестов — `F-44` («три непокрытых ветки `read-only`, `danger-full-access`, «нет живого агента» и схлопнутые четыре отказа получают тесты»).
- **Что передаю в `F-44` как вход (собрано мной, `quality-06:9-21`), чтобы ничего не потерялось:**
  1. `for (const policy of HARNESS_POLICIES)`: старт с `scope.permission = policy` → ровно один `commands.execute` с `/permission ${policy}` и успешный `prompt`.
  2. `danger-full-access` при фейке с `presets: ['read-only','workspace-write']` → отказ, `session.prompt` не вызван.
  3. cold/no-live-agent: `detachAll()` **после** `create` и до `start`/`resume` → отказ про «no live agent», при этом `session.create` уже состоялся.
  4. Профиль без `commands` (и симметрично без `agents`) → свой текст отказа.
  5. `selectModel` вернул **другой** маршрут → возвращён ответ платформы, а не запрос.
  6. `session/not-found` → `invalid-ref`, не `unavailable`.
  7. `result.kind === 'success'` без текста → успешный пин.
  8. Повторный `resume` дважды пиннит одну политику и оба раза попадает в лог.
- **Четыре схлопнутых отказа (для `F-44`):** `packages/controller/src/dsh-session.ts:599-602` (нет registry/command runtime), `:606-609` (нет живого агента), `:619-622` (нет команды `/permission`), `:625-628` (команда отказала) → нужен `detail.kind` без расширения закрытого `AdapterErrorCode` (`packages/adapter-sdk/src/errors.ts:22-34`).
- **Гейт:** `node --test --test-isolation=none tests/runtime.test.mjs` → `fail 0` с 8 новыми тестами — в `F-44`; здесь отметка «ссылка».

#### Q-35 · `ModelAvailabilityPort` + `RouteRefusalReason: 'model-not-routable'` — **ссылка на `F-43`**
- **Тип:** шаг-ссылка (**R-14**). Владелец — `F-43` («модель недоступна» становится типизированным отказом; пустой `listModels` перестаёт быть «нет моделей, но и не ошибка»).
- **Что передаю в `F-43` как вход (собрано мной):**
  - `RouteRefusalReason` существует — `packages/contracts/src/routing.ts:110-124`, список `ROUTE_REFUSAL_REASONS` `:127-135` (7 значений); `model-not-routable` и `ModelAvailabilityPort` — **0 совпадений** в MyWork и в платформе (`quality-06:26-27`).
  - Порт отдельный, **не** метод в `ModelCatalogPort` (`packages/contracts/src/model-catalog.ts:113,128`), иначе `portContractVersion` (`packages/controller/src/model-catalog.ts:167`) начнёт врать о возможностях.
  - **Уточнение P20 (§0.3 п.2):** MyWork-порт ничего не синтезирует (`packages/controller/src/model-catalog.ts:119-128`); окно 1 000 000 приходит дефолтом DSH (`packages/llm/llm-deepseek/src/defaults.ts:6`) и в MyWork встречается только в фикстурах (`tests/routing.test.mjs:65,156,274`). Тест обязан **подставлять порт**, отвечающий успешно на `resolveModelInfo` при пустом `listModels`, и ожидать отказ.
- **Гейт:** `node --test --test-isolation=none tests/routing.test.mjs tests/model-availability.test.mjs` → `fail 0` — в `F-43`; здесь отметка «ссылка».

---

## 6. Группа F. Invariants, самомодификация, секреты, recovery (MW-039, D15/D17)

**Что уже есть.** В MyWork инвариантов **нет**: `InvariantRegistry`, `runtime-invariants`, `assertInvariant` — 0 совпадений; слово «invariant» живёт только в комментариях (`packages/execution/src/schema.ts:12`, `packages/execution/src/index.ts:14`, `packages/lease/src/index.ts:5`, `packages/core/src/board.ts:4`); `assertTaskInvariants` есть в `packages/core/src/task.ts:~135` (`quality-09:17,25`). Сканер секретов есть и хорош, но покрывает **3 из 6** мест: шаблоны `SECRET_PATTERNS` (8 штук, включая `credential-assignment`) — `packages/evidence/src/metadata.ts:55-72`, функция `assertNoSecretMaterial` `:178`, вызовы только на `metadata.ts:111` (идентификаторы) и `:213` (content type) плюс credential-ref (`packages/core/src/security.ts:245`). Тела артефактов (`packages/evidence/src/artifacts.ts:179`), `statement` памяти (`packages/core/src/memory.ts:1036-1089`) и текст контекстного item (`packages/core/src/context.ts:1100-1152`) не сканируются ничем; PII не покрыт ни одним шаблоном (`quality-09:14-16`).

**Что даёт платформа** (`quality-05:3-7`): `ctx.invariants` — `InvariantRegistry.register(packageName, installer)` (`packages/runtime-diagnostics/invariants/src/index.ts:94`; `super(ctx, 'invariants')` — `:113`), проверка выполняется в отдельной дочерней fiber при регистрации, падение даёт `InvariantError` с кодом `INVARIANT` и сообщением `invariant violated by "<pkg>": …`; конвенция — companion-файл `./invariant` с `inject: ['invariants']`; CI-гейт `scripts/verify-package-invariants.ts:11-21` (exit 1 на нарушения, отвергает необъяснённые пустые installer'ы).

**Чего этот шов в 0.2.0-rc.2 не даёт (дельта, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D4, §5.2).** Шов **не смонтирован** в живом профиле (строки `@deepseek-ai/dsh-invariants` среди 225 записей профиля нет), а в следующем релизе он **удаляется** вместе с `InvariantRegistry`/`InvariantError` и всеми `<pkg>/invariant`-субпутями — гайд `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md` (существует только на master `5badb150`; в чекауте `639ed0153` каталога `v0.2.0-rc.2` нет — локально не проверяемо). Строить на снимаемом шве нельзя, поэтому Q-36 ниже переписан на **свои** проверки MyWork.

#### Q-36 · Runtime-инварианты: **свой модуль, без платформенного шва** — **карточка MW-074, не MW-039**
- **Карточка:** **MW-074** «Зарегистрировать runtime-инварианты» (`30-CARD-EDITS.md` §3.19; depends `MW-058`; место в `07-acceptance` после MW-039) · **Решение:** D15 · **Усилие:** M · **Риск:** низкий · **Откат:** revert (модуль + тест)
- **Решение шага после дельты 0.2.0-rc.2: `./invariant` и `ctx.invariants.register` НЕ используются.** Шов не смонтирован в живом профиле и удаляется в следующем релизе (см. абзац выше); регистрация companion-модуля создала бы зависимость на снимаемый контракт и потребовала бы удаления в том же релизе, что и его снятие.
- **Разведение владения (согласовано, актуализация 2026-10-03):** правка **C-32** в карточке **MW-039** (`30-CARD-EDITS.md`, блок C-32, «Стало») runtime-регистрацию в её объём **не берёт**: MW-039 проверяет инварианты §59/§60 **тестами**, runtime-проверки MyWork — у **MW-074** (`30-CARD-EDITS.md` §3.19), а таблица «инвариант §59 → носитель проверки» живёт у владельца runtime-половины, то есть в MW-074. Канон: **проверяющие функции MyWork — MW-074** (этот шаг), **тесты/fault/сканеры/retention — MW-039** (Q-39…Q-41). Прежнее замечание «сократить C-32 до тестовой части» закрыто владельцем карточек — обе стороны говорят одно.
- **Цель:** нарушение инварианта падает в рантайме с атрибуцией пакету, а не тихо портит состояние; механизм — собственный, не платформенный.
- **Файлы:** Create `packages/controller/src/invariant.ts` (и, при необходимости, для `execution`/`planner`) — **обычный модуль MyWork**, без `inject: ['invariants']` и без заявления субпути `./invariant` в `exports`/`files`; Modify `packages/contracts/src/operation.ts` (**новый код** `INVARIANT_VIOLATED` в реестре `MYWORK_ERROR_CODES`, по образцу Q-09); Create `tests/invariants-runtime.test.mjs`
- **Шаги:**
  1. Тест (падающий): намеренное нарушение инварианта даёт ошибку MyWork с кодом `INVARIANT_VIOLATED` (код **создаётся здесь**, в реестре `MYWORK_ERROR_CODES`, по образцу Q-09 — §10.2 п.22) и сообщением, содержащим имя пакета/инварианта.
     Команда: `node --test --test-isolation=none tests/invariants-runtime.test.mjs` → FAIL «модуля/проверки нет».
  2. Тест: ни один манифест MyWork не объявляет companion-субпуть `./invariant` и ни один исходник не вызывает `ctx.invariants.register` — 0 совпадений (это и есть проверка отказа от снимаемого шва).
  3. Инварианты v0.1 (минимум, каждый — проверяемый): (а) ни одна попытка не стартует без снапшота (Q-01); (б) ни одна запись памяти не проходит мимо fabric (Q-03); (в) у `attempt` нет состояния «ждёт человека» — гейт живёт в `HumanDecision` (Q-19); (г) ни один вердикт гейта не появляется без строки аудита (Q-15).
  4. Команда: `node --test --test-isolation=none tests/invariants-runtime.test.mjs` → `pass 4 / fail 0`.
- **Файлы (уточнено по границе с `card-ledger`):** тест — `tests/invariants-runtime.test.mjs` (приёмка MW-074); таблица «инвариант §59 → носитель проверки» — часть объёма MW-074 и заполняется здесь.
- **Граница с MW-039 (согласована с `card-ledger`):** **MW-074** — модуль проверок MyWork, таблица «инвариант §59 → носитель проверки», приёмка `node --test --test-isolation=none tests/invariants-runtime.test.mjs`; **MW-039** (правка C-32) — deterministic integration/fault/property-проверки §59/§60 с гейтом `node --test --test-isolation=none tests/invariants.test.mjs` (флаг изоляции добавлен по канону репозитория). Здесь реализуется **только первая половина**; вторая — чужой файл и чужой шаг.
- **Гейт (исполнимая форма вместо `npx tsx scripts/verify-package-invariants.ts`):** файла `scripts/verify-package-invariants.ts` в MyWork **нет** (он в DSH-checkout, `evidence/quality-05.md:7`), `tsx` не объявлен ни в одном из 54 манифестов MyWork, пакеты MyWork не входят в workspace DSH, поэтому build-time гейт платформы к ним не применяется — и после отказа от шва он не нужен даже теоретически. Приёмка: `node --test --test-isolation=none tests/invariants-runtime.test.mjs` → `# pass 4`, `# fail 0`, exit 0 — **включая негативный тест** «искусственное нарушение даёт ошибку MyWork» (шаг 1) и тест «шов не используется» (шаг 2).
- **Evidence:** вывод теста, список имён инвариантов, вывод «`ctx.invariants` не вызывается, субпуть `./invariant` не объявлен», вывод негативного теста.
- **Риски:** инвариант, который «проверяет наличие сервиса», бесполезен — проверять **авторитетные потоки событий и мутируемые данные**, а не наличие методов. Второй риск — соблазн «взять платформенный шов, пока он есть»: он снимается в 0.2.1, и зависимость придётся удалять.

#### Q-37 · Инвариант и тест: worker-поверхность без инструментов самомодификации (**фильтр — `F-56`**)
- **Карточка:** MW-039 (инвариант и тест) · **Решение:** D15 · **Границы (R-14):** список запрещённых инструментов и сам фильтр — `F-56` («Allowlist инструментов worker-поверхности»); момент применения на старте Attempt — `E-…` (`plan-execution`). Здесь остаётся **только** инвариант MyWork (`packages/controller/src/invariant.ts`, **без** платформенного companion-субпути `./invariant` — Q-36) и тест, доказывающий, что фильтр не обходится.
- **Усилие:** M · **Риск:** высокий (иначе агент правит харнесс) · **Откат:** revert
- **Цель:** worker-сессия физически не может вызвать `cordis_*`, dynamic-плагины и `plugin_manager`; попытка приводит к отказу, а не к обходу.
- **Факты:** в MyWork списка запретов нет вообще (`workerSurface`, `allowedTools`, `toolAllowList`, `forbiddenTools`, `cordis_` — все exit 1, `quality-09:20`); архитектура MyWork прямо говорит «per-session tool allow-list нет», скоуп задаётся agent preset'ом (`packages/contracts/src/agent-runtime.ts:57`); механизм платформы: `tools.restrict(filter)` требует scoped-контекста (`agent.ctx`) и бросает на context-global (`packages/core/tools/src/index.ts:1095-1100,1105,1114-1117`), `tools.guard(guard)` даёт монотонный запрет, который **не может** форсировать allow (`:1127-1140`).
- **Файлы:** Modify `packages/controller/src/invariant.ts`, Create `tests/worker-surface.test.mjs` (сам фильтр и его место — в `F-56`/`E-…`, здесь не дублируются)
- **Шаги:**
  1. Тест (падающий): на живом фильтре `F-56` в `visible`-поверхности worker-агента нет ни одного имени из запретного списка.
     Команда: `node --test --test-isolation=none tests/worker-surface.test.mjs` → FAIL.
  2. Тест (падающий): вызов запретного инструмента из worker-сессии → отказ; монотонный `guard` срабатывает **после** `tools/pre-execute` и не отменяется allow'ом.
  3. Тест: в root-сессии те же инструменты доступны — запрет адресный, а не глобальное отключение.
  4. Инвариант (связка с Q-36): «поверхность worker-сессии не пересекается с запретным списком» — проверяется на авторитетном потоке `tools/registered`-событий.
  5. Команда: `node --test --test-isolation=none tests/worker-surface.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — ссылка на шаг `F-56` и доказательство, что проверяется фактический `visible`-набор.
- **Риски:** запрет только «по имени» обходится алиасом — тест обязан проверять фактический `visible`-набор, а не конфиг.

#### Q-38 · «Автоматика не одобряет» при **активном** `auto-review` (R-22)
- **Карточка:** MW-039 (инвариант и тест) · **Механика правила — `F-57`** · **Решение:** D15 · **Усилие:** S · **Риск:** средний · **Откат:** revert
- **Базовая линия (исправлено по R-22):** `auto-review` **активен** в профиле (`enabled: true`, строка `include: auto-review`, `fiberPhase: active`). Прежняя формулировка «по умолчанию выключен» **снята как неверная**. При этом **режима deny в пакете нет**: решения — только low+allow / medium+allow|deny / high+deny, `allow` исполняется сразу с Full access, Auto-preset = Full access + `ask` (`packages/experimental/auto-review/src/index.ts:64-67` — перечень решений `AutoReviewDecision`; `:715-716` — `allow` проходит сразу, `deny` уходит в `ask`; `:723-732` — регистрация Auto и возврат сессий к `danger-full-access`; «Full access + `ask`» — `packages/interaction/permission-presets/src/index.ts:89-91`; **переякорено 2026-10-03** на `0.2.0-rc.2`/`639ed0153`: прежний указатель `:124-126` был неверен — там `export const name`/`export const inject`; `quality-05:34-38`). RT-4 («обход review через LLM-аппрувер») подтверждён.
- **Следствие:** «только deny» — правило **MyWork**, а не настройка пакета. Запрет approve-пути и изоляция от worker-сессии — `F-57`; здесь инвариант и тест.
- **Файлы:** Modify `packages/controller/src/invariant.ts`, Create `tests/auto-review-policy.test.mjs`
- **Шаги:**
  1. Тест (падающий): `allow` от `auto-review` **не** превращается в одобрение MyWork-гейта — решение человека всё равно требуется, `answeredBy.kind === 'human'`.
     Команда: `node --test --test-isolation=none tests/auto-review-policy.test.mjs` → FAIL.
  2. Тест (инвариант): в аудите нет строки `gate.decided`, у которой `answeredBy` — агент.
  3. Тест: при активном `auto-review` worker-поверхность не получает инструментов самомодификации (`F-56`/Q-37) — проверка на фактической базовой линии профиля, а не на предположении.
  4. Команда: `node --test --test-isolation=none tests/auto-review-policy.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — фактическая базовая линия профиля (`enabled`/`fiberPhase`) с путём и строкой.
- **Риски:** аргумент «сегодня и так выключен» больше не работает; правило обязано быть верным именно потому, что пакет активен.

#### Q-39 · Сканер тел: артефакты, память, контекстный item (политика PII — `F-55`)
- **Карточка:** MW-039 (правка) · **Решение:** D17 (предварительно: секрет в теле → **refuse**, не redact — redact молча искажает evidence; политика PII — `F-55`) · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** один предикат «перед сохранением / перед prompt» сканирует тела теми же шаблонами, что уже применяются к метаданным.
- **Файлы:** Modify `packages/evidence/src/metadata.ts` (экспорт предиката для тел), Modify `packages/evidence/src/artifacts.ts:~179`, Modify `packages/core/src/memory.ts:~1036-1089`, Modify `packages/core/src/context.ts:~1100-1152`, Create `tests/body-secret-scan.test.mjs`
- **Шаги:**
  1. Тест (падающий): `putArtifact` с телом, содержащим `sk-…` → отказ — **новый член существующего `EvidenceErrorCode`** (`packages/evidence/src/errors.ts:13-32`, реальный union; имя члена выбирается при реализации), артефакт не создан.
     Команда: `node --test --test-isolation=none tests/body-secret-scan.test.mjs` → FAIL «артефакт создан».
  2. Тест (падающий): `statement` памяти с PEM-блоком → отказ; контекстный item с JWT → отказ до сборки prompt.
  3. Тест: чистые тела по-прежнему проходят (регрессия на 5 синтетических фикстур, уже существующих в тестах).
  4. Команда: `node --test --test-isolation=none tests/body-secret-scan.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — список мест, где теперь сканируется тело (**3 новых**), и формулировка политики («refuse» или иная — по `10-DECISIONS.md`).
- **Ссылка (R-14):** политика PII и состав экспортируемых событий — `F-55`; здесь PII не переопределяется.
- **Риски:** сканирование тела 9 MiB на каждый `putArtifact` — замерить стоимость и записать в отчёт; если дороже 10 мс на 1 MiB, ограничиться первыми/последними N КиБ с явной пометкой в отчёте.

#### Q-40 · Retention: окна для гейта и очереди внимания — **ссылка на `F-38`…`F-40`**
- **Тип:** шаг-ссылка (**R-14**). Механика остаётся в 20: `F-38` — `DELETE` и окна для `outbox`/`inbox_dedup`/`audit_events`; `F-39` — `VACUUM` и возврат места файловой системе; `F-40` — BLOB-артефакты под триггерами (явный путь удаления).
- **Моя часть:** ни строки SQL. Требование к 20 со стороны 23: `human_decisions` получает окно по тому же механизму, `pending` не удаляется никогда, удаление выполняется **после** evidence export (Q-43). Окна — решение D17.
- **Факты (вход):** в MyWork нет ни одного `DELETE FROM outbox`/`inbox_dedup`/`audit_events` и ни одного `VACUUM` (все exit 1, `quality-09:16`); запреты — триггерами (`packages/evidence/src/schema.ts:65,70,92,97,115,121`); тело — `BLOB NOT NULL` (`:60`).
- **Гейт:** выполняется в `F-38`…`F-40`; здесь отметка «ссылка».

#### Q-41 · Recovery: открытые гейты и снапшоты переживают аварийный рестарт
- **Карточка:** MW-039 (правка); карточка MW-031 (`recovery`) — `planned`, отчёта нет (`quality-09:18`) — моя часть только про свой домен
- **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** после падения процесса ни один гейт не «висит» без причины, ни один снапшот не объявляется существующим, если его нет.
- **Факты:** существующий recovery-код — `packages/execution/src/service.ts:115,878` (`recover`), `packages/beads-adapter/src/reconcile.ts:6`, `packages/planner/src/service.ts:436`; в `packages/storage/src` recovery/GC нет (`quality-09:19`); при рестарте платформа закрывает незавершённый turn синтетикой (`packages/core/session/src/repair.ts:96`; файл 211 строк, извлечён класс `ToolCallRecovery` — `:105`).
- **Файлы:** Modify `packages/execution/src/service.ts` (recovery-ветка), Modify `packages/core/src/human-decision.ts` (`expireHumanDecisions` при старте), Create `tests/recovery-human-decisions.test.mjs`
- **Шаги:**
  1. Тест (падающий): после рестарта `pending`-гейт с истёкшим дедлайном → `expired` + `needs-attention` с `human-gate-deadline-exceeded`.
     Команда: `node --test --test-isolation=none tests/recovery-human-decisions.test.mjs` → FAIL.
  2. Тест: `pending`-гейт без дедлайна остаётся `pending` и виден в очереди внимания (не «теряется»).
  3. Тест: снапшот, объявленный в БД, но отсутствующий физически → `verifyContextSnapshot` → `{kind:'drifted'}` с элементом `drift`, у которого `reason: 'missing'` для этого uri, — **исхода `missing` у типа нет**: `ContextVerification` — это `{kind:'intact'} | {kind:'drifted', drift}` (`packages/core/src/context.ts:643-645`, функция `:670`), `missing` — причина внутри `ContextDrift` (там же `:697`; реестр причин — `packages/contracts/src/context.ts:874-890`), и это типизированный результат, а не исключение. (Прежняя формулировка «→ `missing`» снята как неисполнимая — находка NB-6 в `91-VERIFICATION-B.md` §«Дельта 0.2.0-rc.2».)
  4. Команда: `node --test --test-isolation=none tests/recovery-human-decisions.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — что именно восстанавливается на старте и в каком порядке.
- **Риски:** пересечение с `E-…` (MW-031 recovery): мой шаг не трогает попытки/lease, только гейт и снапшот.

---

## 7. Группа G. Upgrade / export / import / repair (MW-040)

**Состояние:** не реализовано, и это записано в коде: `packages/storage/src/migrations.ts:10-11` — «export/import, repair и rollback policy — это MW-040». `MYWORK_MIGRATIONS` сегодня — **одна** миграция (`:91`, миграция version 1 `:49-82`), а пять списков миграций по доменам склеивает вызывающий (`EVIDENCE_MIGRATIONS` `packages/evidence/src/schema.ts:138`, `LEASE_MIGRATIONS` `packages/lease/src/schema.ts:66`, `CLAIM_SAGA_MIGRATIONS` `packages/execution/src/schema.ts:153`, `PLAN_MUTATION_MIGRATIONS` `packages/planner/src/schema.ts:148`).

#### Q-42 · Запрет открытия store без канонического списка + verify журнала
- **Карточка:** MW-040 (правка); **зависит от** `F-18`, `F-19`, `F-20` · **Усилие:** S · **Риск:** низкий (одно ожидаемое падение) · **Откат:** revert
- **Цель:** открыть store, не назвав полный список миграций, — типизированная ошибка; журнал сверяется при открытии.
- **Файлы:** Modify вызовы открытия в `packages/**` (те, что склеивают списки), Create `tests/migrations-registry.test.mjs` — **если `F-19` уже это сделал, шаг закрывается ссылкой** (шаг 0)
- **Шаги:**
  1. Шаг 0: проверить `F-18`/`F-19`/`F-20` в `20-STEPS-foundation.md`; при совпадении — закрыть шаг ссылкой и перейти к Q-43.
  2. Тест (падающий): `openStore({ migrations: [] })` → `MIGRATIONS_REQUIRED`.
     Команда: `node --test --test-isolation=none tests/migrations-registry.test.mjs` → FAIL.
  3. Тест: журнал содержит миграцию, которой нет в реестре (или наоборот) → отказ — **новый код в `MYWORK_ERROR_CODES`** (`packages/contracts/src/operation.ts`), с перечислением расхождений в деталях.
  4. Тест: повторное открытие на той же версии → идемпотентно, без повторного применения.
  5. Команда: `node --test --test-isolation=none tests/migrations-registry.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — канонический список и его длина.
- **Риски:** дублирование `F-19`; поэтому шаг 0 обязателен.

#### Q-43 · Evidence export до удаления (необратимость ретенции)
- **Карточка:** MW-040 · **Усилие:** M · **Риск:** средний · **Откат:** revert
- **Цель:** прежде чем БД уменьшится, evidence выгружается наружу; выгрузка идемпотентна и проверяема.
- **Факты:** `artifacts.bytes BLOB NOT NULL` (`packages/evidence/src/schema.ts:60`), `DELETE`/`UPDATE` запрещены триггерами (`:65,70,115`), аудит append-only (`:92,97,121`); платформенный аналог выгрузки — `session-log-export` (zip-стрим), но он про логи сессий, а не про артефакты MyWork.
- **Файлы:** Create `packages/evidence/src/export.ts`, Create `scripts/export-evidence.mjs`; Create `tests/evidence-export.test.mjs`
- **Шаги:**
  1. Тест (падающий): выгрузка N артефактов + M аудит-строк → каталог с файлами и манифестом (путь, sha256, размер, `correlationId`).
     Команда: `node --test --test-isolation=none tests/evidence-export.test.mjs` → FAIL.
  2. Тест: повторный запуск с тем же `operationId` не создаёт второй манифест и не перезаписывает файлы.
  3. Тест: манифест воспроизводим — sha256 выгруженного файла совпадает с sha256 `bytes` в БД.
  4. Команда: `node --test --test-isolation=none tests/evidence-export.test.mjs` → `pass 3 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — размер выгрузки и время на текущем объёме.
- **Риски:** выгрузка «внутрь» того же каталога, который чистится, — не выгрузка; путь задаётся явно и проверяется тестом на пересечение.

#### Q-44 · Import и repair: dry-run, отказ на неизвестной ревизии, пересборка производных
- **Карточка:** MW-040 · **Усилие:** M · **Риск:** высокий (пишет в состояние) · **Откат:** revert; выполнять только на копии БД
- **Цель:** импорт не «додумывает»; repair пересобирает производные (INDEX, проекции доски) и **не** трогает авторитетные леджеры.
- **Файлы:** Create `packages/storage/src/import.ts`, Create `scripts/repair.mjs`; Create `tests/import-repair.test.mjs`
- **Шаги:**
  1. Тест (падающий): импорт архива с неизвестной версией схемы → отказ — **новый код в `MYWORK_ERROR_CODES`** (`packages/contracts/src/operation.ts`), ни одной записи.
     Команда: `node --test --test-isolation=none tests/import-repair.test.mjs` → FAIL.
  2. Тест: `--dry-run` печатает план (сколько строк, какие таблицы) и не пишет ничего (сравнение размера/хэша БД).
  3. Тест: repair пересобирает производный INDEX и проекции, но не меняет `attempt`/`plan_revision` (сверка хэшей авторитетных таблиц до/после).
  4. Тест: прерывание импорта на середине → повторный запуск доводит до конца без дублей.
  5. Команда: `node --test --test-isolation=none tests/import-repair.test.mjs` → `pass 4 / fail 0`.
- **Гейт:** тест зелёный; в отчёте — план dry-run на реальной (копии) БД.
- **Риски:** «repair», который правит `done`-статусы, — запрещён: сверка леджеров — отдельное решение (D19), не самолечение.

---

## 8. Группа H. Упаковка operational v0.1 (MW-041)

**Состояние:** 12 пакетов `private: true`, 0 тегов, нет `.github`, `pnpm run build|typecheck|check` и `node scripts/pack.mjs` → EXIT=1 (битый глобальный pnpm-линк; рабочий вход — `corepack pnpm`, `F-01`); `packages/controller/package.json:17-25` содержит `files` и `dsh.bundle.patch`, у `beads-adapter` поля `dsh.bundle` нет (есть `exports`).

#### Q-45 · Распространение, `private`, `engines`, peer-манифест — **ссылка на `F-47`…`F-50`**
- **Тип:** шаг-ссылка (**R-14**). В 20 остаётся вся механика: инвентаризация используемых `ctx.*` (`F-47`), `peerDependencies` (`F-48`), `private: true` → `publishConfig`/`files` (`F-49`), матрица совместимости и ADR-пакет (`F-50`).
- **Моя часть:** ни строки механики. Решение о распространении — D04 (владелец), исполнение — 20.
- **Что передаю (вход для `F-49`):** 12 пакетов с `private: true`; `packages/controller/package.json:17-25` уже держит `files` + `dsh.bundle.patch`; у `beads-adapter` поля `dsh.bundle` нет (есть `exports`); `dsh.engines.dsh` DSH не читает — обязательство только через `peerDependencies` (§9 п.3).
- **Гейт:** в `F-47`…`F-50`; здесь отметка «ссылка».

#### Q-46 · CI-матрица и тег `v0.1.0-m1` — **ссылка на `F-25` (и `F-24`)**
- **Тип:** шаг-ссылка (**R-14**). `F-25` — «минимальный CI и тег `v0.1.0-m1`» (воспроизводимый вход и первая точка отката); `F-24` — идемпотентность `packController`. Последовательность (`install --frozen-lockfile` → `tsc` ×12 → `tsdown` → `smoke` → `node --test --test-isolation=none "tests/**/*.test.mjs"` → `verify-profile.mjs`) описана там.
- **Моя часть:** только строка 10 матрицы приёмки Q-47 (наличие тега) и проверка, что CI-профиль не пропускает backend-тесты (`F-17`).
- **Гейт:** в `F-25`; здесь отметка «ссылка».

#### Q-47 · Матрица приёмки operational v0.1 (что считается выпуском)
- **Карточка:** MW-041 · **Усилие:** S · **Риск:** низкий · **Откат:** не требуется (документ)
- **Цель:** выпуск v0.1 — это не «все тесты зелёные», а выполненный список с доказательствами.
- **Файлы:** раздел в отчёте MW-041 (`.work/reports/MW-041-operational-v0.1.md`); при необходимости — правка приёмки карточки через `30-CARD-EDITS.md`
- **Матрица (каждая строка — с командой и ожидаемым выводом):**

| # | Проверка | Команда | Ожидание |
|---|---|---|---|
| 1 | Типизация | `corepack pnpm run typecheck` | exit 0, 0 ошибок |
| 2 | Сборка | `corepack pnpm run build` | exit 0 |
| 3 | Smoke | `corepack pnpm run smoke` | 13/13 |
| 4 | Тесты | `node --test --test-isolation=none "tests/**/*.test.mjs"` | `fail 0`, `skipped 0` в CI-профиле |
| 5 | Профиль | `node scripts/verify-profile.mjs` | `verify:profile: PASS`, хэши реального профиля не изменились |
| 6 | Инварианты: runtime-проверки MyWork (MW-074) | `node --test --test-isolation=none tests/invariants-runtime.test.mjs` | `pass 4 / fail 0`, включая негативный тест «нарушение даёт ошибку MyWork» и тест «платформенный шов не используется» |
| 6а | Инварианты: тестовая половина (MW-039) | `node --test --test-isolation=none tests/invariants.test.mjs` | `pass / fail 0` |
| 7 | Границы пакетов | `node --test --test-isolation=none tests/boundaries.test.mjs` | `fail 0` (после `F-41`/`F-42`) |
| 8 | Упаковка | `node scripts/pack.mjs` | exit 0, tarball содержит `dsh.bundle.patch` и модуль инвариантов MyWork (`./invariant`-спутник в `files`/`exports` не заявляется) |
| 9 | Публикация (если D04 = registry) | `npm publish --dry-run` по каждому пакету | 0 ошибок «missing peer» |
| 10 | Тег | `git tag --list v0.1.0-m1` | ровно один тег |

- **Гейт:** все 10 строк имеют записанный вывод; любая непройденная строка делает выпуск несостоявшимся (не «частично состоявшимся»).
- **Риски:** строки 6, 8, 9 зависят от решений D04 и от `F-…`; если решение не принято, строка помечается `BLOCKED`, а не «пропущена».

---

## 9. Что НЕ делать

Список защищает от переусердствования; каждый пункт — либо запрет из FINAL-REPORT §10, либо следствие уже принятого решения.

1. **Не строить второй учёт токенов.** Учёт есть: `BudgetConsumption`, `chargeConsumption` — единственная функция, создающая новое значение (`packages/core/src/budget.ts:122`); платформенный снимок даёт `dsh-token-meter` (`ctx.tokenMeter`). Новые счётчики только **читают** их; своя формула цены запрещена (цена — `modelCallCost` по `ModelRateTable`).
2. **Не заменять `AgentRuntimePort`.** Сессия одна и она DSH-сессия; `DshSessionController` уже реализует шесть операций (`create/list/selectModel/prompt/cancel/follow`) — расширять можно только аддитивно.
3. **Не полагаться на `dsh.engines.dsh`.** DSH его не читает (гейт читает **только** `peerDependencies` имён `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` — `packages/boot/app-boot/src/plugin-compatibility.ts:75,77`); обязательство публикации — `peerDependencies` (`>=0.1.7-rc.2 <0.3.0-0`; прежняя верхняя граница `<0.2.0` отвергла бы `0.2.0` final — решение владельца 2026-10-03, `02-PLATFORM-DELTA-0.2.0-rc.2.md` §5.1).
4. **Не строить coordination subsystem/mailbox.** `outbox` + `inbox_dedup` уже есть; потребителя у второго канала нет.
5. **Не регистрировать MyWork-движок в `ctx.workflowEngine`.** Один движок на контекст — коллизия с платформенным (K4/D03).
6. **Не использовать блокирующий `ask()` из worker-попытки.** Он держит шаг агента, несовместим с `DELEGATED_CALLER` и не переживает рестарт (Q-19); допустим только как live-adapter в root-сессии.
7. **Не строить OTel-экспортёр.** D16: `correlationId` в аудите/outbox — источник истины, `ctx.productTelemetry` — наружная телеметрия; ни одного нового поля ради телеметрии. Механика — `F-54`/`F-55`, не здесь (Q-27 — ссылка). **Уточнение дельты 0.2.0-rc.2:** общий транспорт — новый сервис `ctx.otel` (`packages/telemetry/otel/src/index.ts:14`), а сам `ctx.productTelemetry` в живом профиле **не смонтирован** (`desktop-product-telemetry` `enabled:false`) — ни один шаг не смеет на него опираться (D3).
8. **Не делать `auto-review` одобряющим.** Пакет **активен** в профиле, но deny-only режима в нём нет — правило «автоматика не одобряет» живёт в MyWork как инвариант (Q-38, механика `F-57`).
9. **Не считать колонку «Готово» доказательством приёмки.** 9 падений на `done`-карточках, и в моей зоне: отчёты MW-016…MW-020 заявляют `DONE`, `tasks.json` — `planned`.
10. **Не полагаться на `LocalJobRegistry` как durable.** Он in-memory и process-local; для optimizer/миграции/импорта носитель выбирает `F-36`.
11. **Не менять `packages/contracts/src/security.ts`.** `HumanGate` там — классификатор из 5 значений, принуждаемый как **отказ**; сущность гейта живёт в новом файле.
12. **Не расширять `ModelCatalogPort` методом доступности.** Порт отдельный, иначе `portContractVersion` начнёт врать (Q-35 → `F-43`).
13. **Не «лечить» профиль `~/.dsh` автоматически.** Doctor в v0.1 только читает и предлагает; запись — отдельный флаг и отдельное решение.
14. **Не дублировать механику из `20-STEPS-foundation.md`.** Девять шагов этого файла — явные ссылки (R-14): повторное описание реестра миграций, retention, бюджета, CI или публикуемости в 23 запрещено, даже если формулировка кажется точнее.
15. **Не выбирать номер миграции вручную.** Только аллокатор (D08, `01-MASTER-PLAN.md` §15.3); иначе `validateMigrations` бросит на дубле и store не откроется (R-04).
16. **Не править код в этом файле.** Здесь только шаги: любое изменение кода — отдельная карточка и отдельный исполнитель.

## 10. Не проверено / открытые проверки

1. **Ни один тест не запускался** (запрет §5.3 брифа). Все «ожидаемые выводы» в шагах — прогноз по коду; при исполнении шага ожидание подтверждается или заменяется фактическим выводом, и это фиксируется в отчёте шага.
2. **§6 брифа (субагенты) выполнен через `workflow`-fan-out на 10 агентов** (9 вопросов + проба), потому что прямой `subagent` на глубине teammate'а запрещён рантаймом: `subagent depth 2 exceeds maxDepth 1`. Результаты — `.work/plan-v0.3/evidence/quality-01…09.md`. Если кампания требует именно `subagent`-вызовов, это ограничение среды, а не пропуск метода.
3. **Точные номера строк, помеченные `~`**, требуют сверки при исполнении: `packages/core/src/guards.ts`, `packages/execution/src/service.ts`, `packages/core/src/memory.ts:1036-1089`, `packages/core/src/context.ts:1100-1152`, `packages/evidence/src/artifacts.ts:179`, `packages/core/src/skill.ts:119,639`, `packages/controller/src/dsh-session.ts:562-575,633-649`.
4. **`AUDIT_ENTRY_FIELDS` не прочитан целиком** (`packages/contracts/src/audit.ts:88-89`) — несёт ли строка аудита актора, неизвестно; отсюда шаг 0 в Q-15. Кто проверит: исполнитель Q-15 чтением файла.
5. **`runConformance` не прочитан** (только имя и строка ~`:236`) — сигнатура и набор проверок подтверждаются шагом 0 в Q-33.
6. **Коды ошибок: что существует, что создаётся.** Существуют и не переименовываются: `STALE_REVISION`, `LEASE_LOST`, `SECURITY_DENIED`. **Создаются явным шагом** (а не предполагаются): пять кодов гейта — в Q-09 (реестр `MYWORK_ERROR_CODES`, `packages/contracts/src/operation.ts:~79`, с тестом каталога); новый член `ContextRefusalReason` — в Q-01 (`packages/contracts/src/context.ts:602-631`); новый член `EvidenceErrorCode` — в Q-39 (`packages/evidence/src/errors.ts:13-32`); код расхождения журнала миграций — в Q-42; код неподдерживаемой версии схемы — в Q-44. Конкретные имена выбираются при реализации и сверяются с реестром; в тексте шагов они больше не выдаются за существующие.
7. **`10-DECISIONS.md` на момент написания файла не существует.** Формулировки D14/D15/D16/D17/D20 взяты из сообщения `decision-desk` (направление), а не из документа. При расхождении приоритет — у `10-DECISIONS.md`; шаги ссылаются на D-номера, а не переписывают решения.
8. **ID шагов соседей:** зафиксированы чтением `20-STEPS-foundation.md` (F-01…F-62) — `F-13…F-15`, `F-17`, `F-18…F-20`, `F-24`, `F-25`, `F-28…F-32`, `F-33…F-42`, `F-43`, `F-44`, `F-47`…`F-57`. ID `E-…` (момент применения фильтра worker-поверхности) — от `plan-execution`, точные номера ожидаются; в Q-37 стоит ссылка «`E-…`».
9. **Окна хранения** (D17) не зафиксированы — механика в `F-38`…`F-40`; Q-40 передал туда требование «`human_decisions` по тому же механизму, `pending` не удаляется», но конкретные значения остаются за владельцем решения.
10. **Поведение PII-политики** (refuse или redact) не зафиксировано — владелец политики теперь `F-55` (состав событий и PII); Q-39 ограничен сканером тел.
11. **Живой профиль `C:\Users\Dmitry\.dsh` не читался напрямую** (только чтение запрещено не было, но я его не читал). Всё, что о нём сказано (дефект вложенного `sessionDefaultPermission`, мёртвые `autoRun*`), — из FINAL-REPORT §4.4 и `V1`. Кто проверит: этап 0 `F-01…F-12`.
12. **GUI и браузер не проверялись**: различение трёх гейтов в UI (Q-10/Q-17) проверяется тестами сервисов, не кликом.
13. **Пересечения с чужими файлами** по `BoardPlacement.attention?` (Q-10), `SessionLink` (Q-08) помечены как «согласовать с `plan-surface`»; финальную дедупликацию делает Lead.

### 10.1. Закрытые замечания верификации и red-team

14. **R-14 (дубли тем с `20-STEPS-foundation.md`) — закрыто.** Явные шаги-ссылки с отметкой `Тип: шаг-ссылка (R-14)`: **Q-27** → `F-54`/`F-55` (экспорт `correlationId`, состав событий, PII), **Q-28** → `F-51`/`F-52` (мост и лимиты; у меня остаётся только снимок метрик), **Q-30** → `F-52`/`F-53` (breaker), **Q-32** → `F-13`…`F-15`, `F-17` (`bd`-seam и CI-профиль), **Q-34** → `F-44` (8 тестов session conformance; список передан как вход), **Q-35** → `F-43` (model availability), **Q-40** → `F-38`…`F-40` (retention), **Q-45** → `F-47`…`F-50` (публикуемость, peer), **Q-46** → `F-25`/`F-24` (CI и тег). Частичные ссылки: **Q-37** (фильтр — `F-56`, у меня инвариант и тест), **Q-38** (правило — `F-57`, у меня инвариант и тест), **Q-39** (PII — `F-55`, у меня сканер тел), **Q-42** (реестр и journal — `F-18`…`F-20`, у меня import/repair поверх них). Итог: механика — один writer в 20; в 23 остались инварианты, тесты, политики и то, чего в 20 нет (Context/Skill/Memory, `HumanDecision`, work types, обучение, Doctor-профиль, conformance, сканеры, export/import/repair, матрица приёмки).
15. **R-22 (`auto-review` активен) — закрыто.** Q-38 переписан: базовая линия — `enabled: true`, строка `include: auto-review`, `fiberPhase: active`; формулировка «по умолчанию выключен» снята как неверная. Правило «автоматика не одобряет» остаётся правилом MyWork, потому что режима deny в пакете нет; механика — `F-57`.
16. **R-04 (коллизия версий миграций) — закрыто.** Q-12 переведён на единый аллокатор (D08, `01-MASTER-PLAN.md` §15.3): литерала версии в шаге нет, тест обязан читать ожидаемый набор из аллокатора, а не из списка `[1…6]`; в шаге добавлен тест-защита «`validateMigrations` на полном реестре не бросает о дубле». Если аллокатор ещё не готов, номер **резервируется у Lead'а**, а не выбирается исполнителем.
17. **R-26, §9.2(2) — retry-множитель провайдера в бюджете:** передано в `F-52` как требование (N-й retry не создаёт вторую запись расхода, но учитывает множитель, если провайдер его тарифицирует); тест — в 20. Здесь только запись о передаче (Q-28).
18. **R-26, §12.4 п.6 — `bd init` / Dolt / `bd serve` / Linux-macOS: осознанно не делаем в v0.1.** Причина: `MW-056` прямо запрещает `bd init` и Dolt-remote, живого Dolt в контуре нет, а проверка на Linux/macOS требует второй платформы. Взамен — диагностика `bd`-seam (`F-15`) и честный отказ вместо пропуска (`F-17`); запись продублирована в Q-32.
19. **R-26, §71 — `deliverables` (`present` + `workspace-changes`) и канонические session/file references: осознанно не беру.** Причина: это поверхность и артефакты результата (`plan-surface`/`plan-execution`), а не контекст/память/человек; в 23 нет ни одного шага, которому эти примитивы нужны. Передано Lead'у как незакрытое требование с указанием владельца — не «потеряно», а отнесено.
20. **R-26, §4.2 (потолки `maxConcurrentLlm`/`maxHeavyTools`), §35 (`verbatimModuleSyntax`), §32 (базовая линия review), §6.4 (представления All / Needs attention / Archived):** вне моей зоны (конфигурация, компилятор, review-домен, доска). Q-29 закрывает только MyWork-счётчик параллелизма вызовов модели и **не** подменяет потолки `maxConcurrentLlm`.

### 10.2. Закрытые замечания верификации B (`91-VERIFICATION-B.md`)

21. **Канон тестов приведён.** Все команды в файле — `node --test --test-isolation=none <файл…>` (канон репозитория: `package.json:16`), включая ожидаемые выводы гейтов, строку 4 матрицы Q-47 и прозу в целях шагов. Проверка: поиск по файлу строки запуска теста, за которой **не** следует флаг изоляции, даёт 0 совпадений (кроме этого абзаца, где шаблон упомянут словами).
22. **Несуществующие сущности как основание шагов — проверено по моей половине.** В `23-…` **не встречаются вовсе** (0 совпадений `Select-String`): `STALE_APPROVAL`, `review-loop-exhausted`, `runtime.prompt` у порта, `GitPort`, `readOpenHold`, `ReconcileReport.stalls`. Были и исправлены: `GATE_EXPIRED`/`GATE_CANCELLED`/`GATE_SUPERSEDED`/`GATE_ALREADY_ANSWERED`/`OPERATION_ID_REUSED`/`INVARIANT_VIOLATED`/`SECRET_IN_PAYLOAD`/`MIGRATION_JOURNAL_MISMATCH`/`SCHEMA_VERSION_UNSUPPORTED`/`CONTEXT_SNAPSHOT_MISSING` — у каждого теперь явный шаг «создать» с тестом каталога (Q-01, Q-09, Q-36, Q-39, Q-42, Q-44); `packages/controller/src/doctor.ts` — `Create` в Q-31, а Q-33 объявляет зависимость от Q-31; `packages/storage/src/layout.ts:66-68` — якорь подтверждён чтением: `defaultDshHome()` возвращает `join(homedir(), '.dsh')`, рядом `resolveMyWorkLayout` `:76-84`.
23. **Приёмка MW-074 (`npx tsx scripts/verify-package-invariants.ts`) неисполнима — заменена, а сам платформенный шов отклонён.** Проверено: `Test-Path scripts/verify-package-invariants.ts` в MyWork → **False** (файл есть только в DSH-checkout); `"tsx"` — **0** из 54 манифестов MyWork; companion-модулей `invariant.ts` в MyWork — **0**; пакеты MyWork не входят в workspace DSH, поэтому build-time гейт платформы к ним не применяется. **Дельта 0.2.0-rc.2:** шов `ctx.invariants` не смонтирован в живом профиле и удаляется в следующем релизе вместе с `InvariantRegistry`/`InvariantError` и всеми `<pkg>/invariant` (гайд `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md`, только на master — `02-PLATFORM-DELTA-0.2.0-rc.2.md` §2.2 D4, §5.2), поэтому MW-074 переписан на **свои** проверки без companion-модуля. Исполнимая форма — в Q-36 и в строке 6 матрицы Q-47: `node --test --test-isolation=none tests/invariants-runtime.test.mjs` → `# pass 4`, `# fail 0`, включая негативный тест «нарушение даёт ошибку MyWork» и тест «платформенный шов не используется». **Граница согласована с `card-ledger`:** проверяющие функции MyWork и таблица «инвариант §59 → носитель проверки» — **MW-074**; deterministic integration/fault/property-проверки §59/§60 — **MW-039** (правка C-32), гейт `node --test --test-isolation=none tests/invariants.test.mjs` (строка 6а матрицы). Правку **C-32** в карточке MW-039 (`30-CARD-EDITS.md`) владелец карточек уже сократил до тестовой половины — расхождение снято.

## 11. Реестр доказательств

| Источник | Что доказывает | Где |
|---|---|---|
| `quality-01.md` | достижимость: от `controller` — только `core`; `planner`/`memory-native` без импортёров | `.work/plan-v0.3/evidence/quality-01.md` |
| `quality-02.md` | `HumanGate` = `security.ts:171-181`, 5 значений, принуждается как отказ (`core/src/security.ts:102-110`); `export *` `contracts/src/index.ts:82,87`; `AUDIT_EVENT_TYPES` 16 значений `audit.ts:65-82`; `NEEDS_ATTENTION_REASONS` `board.ts:356-381`; таблицы `human_decisions` нет | `quality-02.md` |
| `quality-03.md` | блокирующий `ask()` без таймаута (`user-questions/src/index.ts:322-330`), блокирует шаг (`tool-calls.ts:88-93,168,199-214`), `DELEGATED_CALLER` (`:138-143`), `agent.steer` (`runtime-types.ts:224-231`), durable-состояния вопроса нет; **дельта 0.2.0-rc.2:** `askTimed()` `:234`, `{pending:true,callId}` `:261` (тип `:43`), поздний ответ `{kind:'user-question-reply'}` `:187` | `quality-03.md` |
| `quality-04.md` | `TokenMeter` (`packages/llm/token-meter/src/index.ts:101,146,214` — **`:214` это `estimateMessage`, не `measure`**; `measure` — `:146`, см. §4), сервис `tokenMeter` (`:94-98,111`), проекции (`src/projection.ts:13-18,30-48`), cost/лимитов нет; `providerConcurrency` 0 совпадений; `correlationId` 172/35, `otel|telemetry` 0 | `quality-04.md` |
| `quality-05.md` | `ctx.invariants` (`invariants/src/index.ts:94,113,136-142`), конвенция `./invariant` (`docs/subsystems/invariants.md:5,59`), build-time скрипт платформы `scripts/verify-package-invariants.ts:11-21` (**лежит в DSH-checkout, не в MyWork**); doctor-примитива нет; `jobs-local` не durable; `tools.restrict`/`guard`. **Дельта 0.2.0-rc.2:** шов не смонтирован в живом профиле и удаляется в следующем релизе вместе со всеми `<pkg>/invariant` (D4) — Q-36 переписан на свои проверки | `quality-05.md` |
| `quality-06.md` | 28 файлов тестов, 710 статических тестов; `tests/runtime.test.mjs:44-48,140,440-463`; 4 отказа `dsh-session.ts:599-628`; `AdapterErrorCode` (`adapter-sdk/src/errors.ts:22-34`); `ROUTE_REFUSAL_REASONS` 7 значений (`contracts/src/routing.ts:127-135`); `ModelAvailabilityPort` 0 | `quality-06.md` |
| `quality-07.md` | карточки MW-030/032/033/034/045/046: объём/приёмка/статусы; `ARTIFACT_KINDS` 12 (`contracts/src/artifact.ts:62-75`); `WorkType` 0 совпадений | `quality-07.md` |
| `quality-08.md` | размеры модулей MW-016…020; Doctor отсутствует; `migrations.ts:10-11` про MW-040; `packController` (`scripts/pack.mjs:~28`) | `quality-08.md` |
| `quality-09.md` | `WorkType`/`FinishCriteria` 0 (exit 1), файлов нет; ADR028 `:377,383-390`; `DELETE FROM outbox`/`VACUUM` exit 1; триггеры `schema.ts:65,70,92,97,115,121`; сканер только метаданных (`metadata.ts:55,178,111,213`); `InvariantRegistry` 0; MW-031 без отчёта | `quality-09.md` |
| Мой прямой читательский вклад | шов `apply()` монтирует две строки (`packages/controller/src/index.ts:115-128`); `tools.restrict` требует scoped-контекста и `guard` монотонен (`packages/core/tools/src/index.ts:1095-1140`) | этот файл, §0.2, Q-37 |

## 12. DoD файла

- [x] ≥28 шагов: в файле **47** шагов (`Q-01`…`Q-47`), из них **9 шагов-ссылок** (`Q-27`, `Q-30`, `Q-32`, `Q-34`, `Q-35`, `Q-40`, `Q-45`, `Q-46` полностью; `Q-28` частично) — по R-14, чтобы не было двух writers на одну механику.
- [x] Каждая группа начинается с «что уже реализовано» и `файл:строка`; шаги — только дельта.
- [x] Обязательный состав покрыт (собственным шагом или ссылкой на `F-…`): подключение MW-016…MW-020 (Q-01…Q-08), `HumanDecision` MW-030 + MW-046 (Q-09…Q-19), work types / finish criteria MW-045 + ADR028 (Q-20…Q-23), Fast Role Learner (Q-24), Sleep Optimizer (Q-25, Q-26), метрики/наблюдаемость (Q-27 → `F-54`/`F-55`, Q-28 снимок, Q-29, Q-30 → `F-52`/`F-53`), 8 тестов session conformance (Q-34 → `F-44`), `ModelAvailabilityPort` + `model-not-routable` (Q-35 → `F-43`), Doctor и сверка профиля (Q-31), adapter conformance (Q-33), `bd`-seam (Q-32 → `F-15`), invariants/crash/security (Q-36…Q-41), upgrade/export/import/repair (Q-42…Q-44), упаковка v0.1 (Q-45 → `F-47`…`F-50`, Q-46 → `F-25`, Q-47), запрет второго учёта токенов (§9 п.1, Q-28).
- [x] Раздел «Что НЕ делать» — **16** пунктов, включая три обязательных (второй учёт токенов, замена `AgentRuntimePort`, `dsh.engines.dsh`) и два новых по верификации (не дублировать механику 20; номер миграции — только аллокатор).
- [x] Раздел «Не проверено» — **23** пункта (§10 пп. 1–13 + §10.1 пп. 14–20 + §10.2 пп. 21–23), каждый с указанием, кто проверит или почему отнесён.
- [x] Замечания верификации B закрыты: канон `node --test --test-isolation=none` применён ко всем командам (§10.2 п.21); несуществующие сущности либо удалены, либо получили явный шаг «создать» с тестом (§10.2 п.22); приёмка MW-074 переписана на исполнимую форму, владение разведено с MW-039 (§10.2 п.23); после дельты 0.2.0-rc.2 платформенный шов `ctx.invariants`/`./invariant` отклонён — Q-36 ведёт свои проверки.
- [x] Опровержения/уточнения базы — §0.3, шесть пунктов; базовая линия `auto-review` исправлена по R-22 (§10.1 п.15).
- [x] ≥35 доказательств: §11 (9 evidence-файлов, каждый со своими якорями) + якоря внутри шагов.
- [x] Зависимости от чужих файлов — ссылками (`F-13…F-15`, `F-17`…`F-20`, `F-24`, `F-25`, `F-28…F-32`, `F-33`…`F-44`, `F-47`…`F-57`, `E-…`), без дублирования шагов.
- [x] Замечания верификации и red-team закрыты: **R-14** (дубли → ссылки), **R-22** (`auto-review` активен), **R-04** (версия миграции — аллокатор), **R-26** (§9.2(2) передано в `F-52`; §12.4 п.6 и §71 — «осознанно не делаем» с причиной и владельцем).
- [x] **Дельта платформы 0.2.0-rc.2 внесена** (источник — `02-PLATFORM-DELTA-0.2.0-rc.2.md`): D1 — `askTimed`/`{pending:true,callId}`/`user-question-reply`/`assertLiveRoot` в §1 (таблица фактов), вводном абзаце группы B, Q-17 и Q-19; D3 — `ctx.otel` и несмонтированный `ctx.productTelemetry` в Q-27 и §9 п.7; D4 — отказ от `./invariant` в Q-36, Q-37, строке 6/8 матрицы Q-47, §10.2 п.23 и §11; D12 — запрет закрытого union по `user/message.source.kind` в Q-17; диапазон peer `>=0.1.7-rc.2 <0.3.0-0` — §9 п.3; подтверждённые якоря: `user-questions:322-330`, `:138-143`, `:234`, `:261`, `:187`, `:43`; `tool-ask-user:98-117`; `repair.ts:96` (файл 211, `ToolCallRecovery:105`); `product-telemetry-otel:1,9,84,118` (файл 121); `telemetry/otel/src/event-log.ts:18,24`; `invariants/src/index.ts:94,113`.

