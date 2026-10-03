# verify-b-02 · Якоря «evidence» и «controller» (независимая проверка, попытка опровержения)

Метод: прямое чтение первоисточников (read/grep), допуск по строке ±10. Запись — только этот файл.
Проверяемый текст якорей: `21-STEPS-execution.md:21` (evidence), `:22` (controller), `23-STEPS-quality.md:571`, `20-STEPS-foundation.md:1597`.
Все восемь целевых файлов существуют; номеров строк вне файлов нет.

## Итог по якорям

| № | Якорь | Объявлено | Факт (строка источника) | Вердикт |
|---|---|---|---|---|
| 1 | `packages/evidence/src/artifacts.ts:43` | `sha256Hex` | 43: `export function sha256Hex(bytes: Uint8Array): string {` (тело 44–45 `createHash('sha256')…digest('hex')`) | ПОДТВЕРЖДЕНО |
| 2 | `artifacts.ts:132` / `:191` | `putArtifact` / `getArtifact` | 132: `export function putArtifact(executor, request, now): ArtifactPutResult {`; 191: `export function getArtifact(executor, ref): Artifact {` | ПОДТВЕРЖДЕНО |
| 3 | `packages/evidence/src/audit.ts:127` | `appendAuditEntry` | 127: `export function appendAuditEntry(executor, entry): AuditAppendResult {` | ПОДТВЕРЖДЕНО |
| 4 | `packages/evidence/src/schema.ts:26`, `:35`, `:38` | «v3» + маркеры | 26: `export const EVIDENCE_SCHEMA_VERSION = 3`; 35: `ARTIFACT_IMMUTABLE_MARKER = 'mywork.artifact.immutable'`; 38: `AUDIT_APPEND_ONLY_MARKER = 'mywork.audit.append-only'` | ПОДТВЕРЖДЕНО |
| 5 | `packages/controller/src/dsh-session.ts:426`, `:450`, `:475`, `:500`, `:526` | `DshAgentRuntime`; start/resume/status/stop | 426: `export class DshAgentRuntime implements AgentRuntimePort {`; 450: `async start(…)`; 475: `async resume(…)`; 500: `async status(…)`; 526: `async stop(…)` | ПОДТВЕРЖДЕНО |
| 6 | `dsh-session.ts:613`, `:695` | «/permission»; «регистрация адаптера» | 613: `execution = await commands.execute(agent, \`/permission ${permission}\`, [], …)`; 695: `adapters.register<AgentRuntimePort>({` | ПОДТВЕРЖДЕНО |
| 7 | `packages/controller/src/index.ts:101`, `:115-128` | `BOUNDED_CONTEXTS`; `apply` | 101: `export const BOUNDED_CONTEXTS: readonly string[] = Object.freeze(['control'])`; 115: `export function apply(ctx: Context, config?: Config): void {` … 128: `}` | ПОДТВЕРЖДЕНО |
| 8 | `scripts/verify-profile.mjs:127-134`, `:170` | `realProfileFingerprint`; `packContract`/`packController` | 127: `function realProfileFingerprint() {` … 134: `}`; 170: `const tarball = packController({ outDir: join(workDir, 'pack') })` | ЧАСТИЧНО |

## Разбор спорного (якорь 8)

- Диапазон `:127-134` точен по обеим границам: 127 — объявление функции, 128–132 — список трёх кандидатов
  (`~/.dsh/profiles/web/package.json`, `cordis.patch.yml`, `settings.yaml`), 133 — `return new Map(...)`, 134 — `}`.
  Комментарий 123–126 подтверждает смысл: «Real-profile files that must stay byte-identical».
- `:170` содержит **`packController`** — да: вызов из импорта 20: `import { packController, repoRoot } from './pack.mjs'`.
  Определение — `scripts/pack.mjs:28` `export function packController(options = {})`.
- **`packContract` в проекте не существует:** grep по всему рабочему каталогу — 0 совпадений (в `scripts/` 4 совпадения только
  `packController`: `pack.mjs:28`, `pack.mjs:58`, `verify-profile.mjs:20`, `verify-profile.mjs:170`). Утверждение о наличии
  `packContract` в `:170` (или рядом) — НЕ_СУЩЕСТВУЕТ; сама строка 170 верна только для `packController`.
- Смежный дефект того же семейства (вне 8 якорей, найден попутно): `20-STEPS-foundation.md:1597` даёт якорь
  «`scripts/verify-profile.mjs:22` (`packController`)», но 22 — пустая строка; `packController` там на строке 20 (импорт).
  Это ошибка на 2 строки в плане (не в коде).

## Проверка утверждений о содержании (не только номеров)

- «Неизменяемость/append-only в БД» (строка 21 плана) подтверждается использованием констант в DDL, а не только их объявлением:
  `schema.ts:67,72` (триггеры `artifacts_no_update/_delete` → `ARTIFACT_IMMUTABLE_MARKER`), `:94,99` (`audit_events_no_update/_delete`
  → `AUDIT_APPEND_ONLY_MARKER`), `:118,124` — v3-гварды `*_no_replace` (`BEFORE INSERT`), т.е. «v3» из `:26` реально применяется
  в `EVIDENCE_MIGRATIONS` (`:147 version: EVIDENCE_SCHEMA_VERSION`, `:148 name: EVIDENCE_SCHEMA_NAME = 'evidence-immutability'`).
- Соседние якоря той же строки таблицы (вне списка, проверены выборочно на ложность): `store.ts:110 createArtifactStore`,
  `:125 createAuditLog` — верны.
- Строка 22 плана: `apply` действительно только `mountModelCatalog` (`index.ts:123`) и `mountDshRuntime` (`:127`); импортов
  store/lease/planner/execution/scheduler/evidence в `index.ts` нет (импорты 12–48) — тезис «не монтируются» верен.
- Якорь `:695` — это регистрация именно agent-runtime-адаптера (kind `DSH_AGENT_RUNTIME_KIND`, `:696`), рядом `:688` — session-адаптер;
  формулировка «регистрация адаптера» не ошибочна, но неоднозначна (две регистрации в `mountDshRuntime`, `:688` и `:695`).
- `23-STEPS-quality.md:571` (`verify-profile.mjs:127-134` как источник знания пути профиля) — подтверждается: кандидаты 129–131.

## Ограничения

- Запуск `pnpm`/`node --test`/`verify:profile` не производился (запрещено условием); выводы — только по тексту исходников.
- Файлы плана и кода не изменялись; единственная запись — этот evidence-файл.
