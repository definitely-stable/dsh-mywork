# F-15 · `bd`-seam в пробе и в диагностике (Doctor)

**Статус: READY_FOR_REVIEW**

## Что сделано

1. Создан `packages/beads-adapter/src/probe.ts`: `probeBeads`, `describeBeadsProbe`, `DEFAULT_PROBE_TIMEOUT_MS = 5_000` (меньше `DEFAULT_COMMAND_TIMEOUT_MS = 30_000`), кэш на процесс.
2. Проба подключена в **Doctor-путь адаптера** — `BeadsTaskGraphAdapter.doctor()` (найдена реальная точка подключения, см. ниже).
3. Локальная проба из `tests/beads-adapter.test.mjs` заменена на общий `probeBeads` (одна функция «доступен ли `bd`» у теста и у Doctor'а).
4. Создан `tests/beads-probe.test.mjs` — 2 теста (гейт F-15).

## Изменённые пути

- Create `packages/beads-adapter/src/probe.ts`
- Create `tests/beads-probe.test.mjs`
- Modify `packages/beads-adapter/src/adapter.ts` (`doctor()`: находка `beads.binary`; `run()`: отказ запуска → `ADAPTER_UNAVAILABLE`)
- Modify `packages/beads-adapter/src/index.ts` (реэкспорт `probe.ts`)
- Modify `tests/beads-adapter.test.mjs` (проба через `probeBeads`, хелпер `bd()` через seam)

## Точка подключения Doctor (шаг 4 плана)

План помечал её как `~` («конкретный файл Doctor не проверен»). Проверено: Doctor — это **метод порта** `TaskGraphPort.doctor(): Promise<readonly DiagnosticReport[]>` (`packages/contracts/src/taskgraph.ts:406`), и реализация уже есть — `BeadsTaskGraphAdapter.doctor()` (`adapter.ts:698` до правки). Правка `packages/controller/src/index.ts` **не нужна и не делалась** (она и вне моего write-scope): находка `beads.binary` теперь первая в отчёте, а при недоступном `bd` Doctor возвращает только её — остальные проверки без запускаемого `bd` недостоверны.

## Таблица «команда → exit code → наблюдение»

| Команда | exit | Наблюдение |
| --- | --- | --- |
| `node --test --test-isolation=none tests/beads-probe.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0 / ℹ skipped 0` — **гейт F-15** |
| `(Select-String -Path packages\beads-adapter\src\*.ts -Pattern 'export function probeBeads').Count` | 0 | **1** — ровно одно объявление (гейт F-15); функция не `async`, а возвращает `Promise`, поэтому литерал шага совпадает |
| Тест 1 (подставной runner, `code 0`) | 0 | `available: true`, `version: '1.3.0'` из `bd version 1.3.0 (f45b249ce: HEAD@f45b249ce6b4)` |
| Тест 2 (подставные отказы) | 0 | `code 1` → `{ available: false, reason: 'nonzero-exit', code: 1, stderr: 'no workspace' }`; `ENOENT`/`errno -4058` → `reason: 'spawn-failed'`; `BeadsLaunchRefusal` → `reason: 'binary-not-found'` + `hint` |
| `node --test --test-isolation=none --test-name-pattern='real bd' tests/beads-adapter.test.mjs` | 1 → затем 0 | Doctor-тесты с реальным `bd` проходят: `the doctor reports a complete status.custom as healthy (real bd)`, `… warns and names every missing status …`, `… reports a missing workspace with the init command and runs no init` |
| `tsc --noEmit -p packages/beads-adapter/tsconfig.json` | 0 | Ошибок типов нет |

## Контракт пробы

- **Никогда не бросает**: `nonzero-exit` (код + stderr), `spawn-failed` (код ОС + `errno`), `timeout`, `binary-not-found` (+ команда установки) — всё значения.
- Кэш на процесс включается только для дефолтного пути (без инъекции `runner`/`launch`); `cache: false` его отключает, инъекция — тоже.
- `describeBeadsProbe` — одна строка для Doctor'а и для сообщения о пропуске в тестах (F-16), поэтому они не могут разойтись.

## Ограничения

- Пропускная способность Doctor'а: при недоступном `bd` возвращается **одна** находка `beads.binary` (severity `error`) с `fixCommand` из `hint`; ветки `beads.workspace`/`beads.status.custom`/`beads.events.journal` в этом случае не выполняются — это осознанный fail-closed выбор.
- Проба внутри адаптера идёт через **его** runner (инъекция), поэтому не зависит от `PATH`; дефолтная проба резолвит seam сама.
- Кэш живёт до конца процесса: долгоживущий процесс не заметит, что `bd` появился позже.

## Что НЕ проверено

- Таймаут-ветка (`reason: 'timeout'`) — юнит-тестом не покрыта (нужен раннер, который не отвечает); распознавание идёт по тексту ошибки раннера (`exceeded Nms and was killed`).
- Doctor на машине без `bd` — проверено только логикой пробы с подставным раннером, не живым отсутствием бинаря.
