# verify-b-06 — Якоря платформы DSH (только чтение, режим опровержения)

Первоисточник: `C:\Reposit\deepseek-harness\deepseek-harness`, HEAD `c7c4c725c7889abfdb46fcdd78b14940232940cf`;
`git status --short` по всем проверенным путям — пусто (гонки с писателем нет). Допуск по строке ±10.
Сверяемый текст плана: `20-STEPS-foundation.md:1160,1172,1243,1246,1574,1692`; `21-STEPS-execution.md:815-818,1115`;
`23-STEPS-quality.md:59-60,651,660,686`; `30-CARD-EDITS.md:58-60`; `evidence/quality-04.md:13`; `quality-05.md:7,35`;
`evidence/foundation-16-tools-restrict.md:11`.
## 1) `packages/core/tools/src/index.ts:736` «restrictions»; `:1095-1140` restrict/guard — **ПОДТВЕРЖДЕНО**
Обе границы верны. `736: readonly restrictions = new AnonymousEntries<CompiledToolRestriction>()` (поле класса `ToolLayer`,
докблок `733` «One scope's complete tool-registry contribution»). Докблок ограничения начинается `1090`, `1095` —
последняя строка JSDoc (`@returns the exact disposer…`), `1097: restrict(filter: ToolRestriction): () => void {`, тело до
`1124` (в т.ч. `1114: const known = this.view(scope).restrictableNames`, `1115-1117` — throw на неизвестное имя: «deny нельзя
объявить заранее» из `20-STEPS-foundation.md:1692` подтверждено, `:1114-1117` точно). Верхняя граница `1140` внутри
`guard()`: `1136: guard(guard: ToolGuard): () => void {` … `1140: { label: 'tools.guard()', notify: false },`; диапазон
покрывает и restrict, и guard. Монотонность (guard не может вернуть allow) — `723-731` («guards have no allow result»).

## 2) `packages/core/tools/src/index.ts:796-800` maxParallelSubCalls — **ПОДТВЕРЖДЕНО**
`796: const maxParallelSubCalls = value ?? 10`, `797-798` проверка положительного целого + throw, `800: return maxParallelSubCalls`.
Внутри `resolveMaxParallelSubCalls` (`795`), докблок `794` про «run_code overlap cap»; схема `812: maxParallelSubCalls:
z.natural().min(1).default(10)`. Обе границы верны, default 10 подтверждён.

## 3) `packages/boot/app-boot/src/plugin-compatibility.ts:68,75,76,77` peer-compat gate — **ПОДТВЕРЖДЕНО**
Все четыре строки дословно совпадают с цитатами плана: `68: if (!Object.hasOwn(fields, 'peerDependencies')) return undefined`
(нет peer'ов → гейта нет), `75: if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue`
(только dsh-имена), `76: const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range`,
`77: if (requirement.trim() === '' || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true }))`.
Дополнительно верны якоря того же файла из плана: `44-49` `getDshRuntimeVersion`, `61-88` `evaluatePluginCompatibility`,
`81: if (Object.keys(peers).length === 0) return undefined`, `96-103` `pluginCompatibilityWarning` (файл 103 строки).

## 4) `packages/experimental/auto-review/src/index.ts` «только deny режима НЕТ» — **ПОДТВЕРЖДЕНО**
`64: type AutoReviewDecision =`, `65 low+allow`, `66 medium+allow`, `67 medium|high+deny (reason?)` — ровно заявленные
комбинации, 4 формы парсера (`562-587`). Конфига/флага режима у плагина нет (нет `Config`, нет `denyOnly`);
`rg 'denyOnly|deny-only|deny_only'` по `packages` → 0 совпадений. Ссылки `:710` (ветка `never` → `denied`),
`:641 denied`, `:657 askUser`, `:686 tools/pre-execute` — точны. **Но** соседнее утверждение
`evidence/foundation-16-tools-restrict.md:11` инвертировано: код на `715-716` — `if (decision.decision === 'allow' ||
downstream.kind !== 'allow') return downstream;` затем `return askUser(...)`, т.е. askUser получает **deny-вердикт при
разрешённом downstream**, а не «allow при downstream ≠ allow».

## 5) `packages/jobs/jobs-local/src/index.ts:35-39` буферы 256 KiB / 16 KiB — **ПОДТВЕРЖДЕНО**
`35` — докблок «Default live ring retention per job, in UTF-8 bytes», `36: const DEFAULT_RETAIN_BYTES = 256 * 1024`,
`38` — докблок settled, `39: const DEFAULT_SETTLED_RETAIN_BYTES = 16 * 1024`. Значения совпадают с документированными
дефолтами схемы (`51: omission defaults to 262144`, `54: 16384`) и применениями `139,144`. Обе границы внутри диапазона.

## 6) `scripts/verify-package-invariants.ts:11-21` build-time конформанс, exit 1 — **ПОДТВЕРЖДЕНО**
`11: const violations = collectPackageInvariantViolations(root)`, `13: if (violations.length > 0)`, `14-17` печать,
`18: process.exit(1)`, `21` финальный `console.log(...conform)`. Файл ровно 21 строка — верхняя граница = конец файла.
Уточнение (minor): сами правила отказа живут в импортируемом `scripts/package-invariants.ts` (пустые installer'ы `326-332`,
имена/проводка `277,291,294-300`), т.е. атрибуция «rejects…» на `:11-21` в `quality-05.md:7` неточна по адресу, но верна
по сути. Отдельно: `23-STEPS-quality.md:660` требует «пустой installer с комментарием `No runtime invariant:`» — гейт
такой файл **отвергает** (`326-332` — пустое тело блока всегда violation), а требуемое объяснение проверяется в README
(regex `13`, применение `197-202`); в `packages/**/src/**.ts` строки `No runtime invariant:` нет вовсе (0 совпадений).

## 7) `packages/core/agent-loop/src/index.ts:334-335` maxParallelToolCalls — **ПОДТВЕРЖДЕНО**
`334: static Config: z<{ agents?: Config['agents']; maxParallelToolCalls?: number }, Config> = z.object({`,
`335: maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS).volatile(),` — обе строки точны.
Аналоги-цепочка из `quality-04.md:13` тоже верна: `tool-calls.ts:132: const maxParallelToolCalls =
ctx.agentLoop.config.maxParallelToolCalls.get()`, `:200: while (!aborted && nextToStart < group.length && inFlight.size <
maxParallelToolCalls)`. Заявленный как отсутствующий в `llm` `inFlight` реально есть только здесь (agent-loop).

## 8) `packages/llm/llm/src` — нет `providerConcurrency` / `concurren|inFlight|semaphore` — **ПОДТВЕРЖДЕНО**
`rg 'providerConcurrency'` по всему чек-ауту → 0 совпадений (проверено только что на HEAD). `rg
'concurren|inFlight|semaphore|Semaphore'` по `packages/llm/llm/src` (13 `.ts`: index, message, content, types, assembler,
assistant-stream, call-config, retry-policy, api-key, attribution, brand, error, invariant) → 0 совпадений. Утверждение
«в платформе метрики/лимита провайдерной параллельности нет» верно; ближайшие аналоги существуют только в
`agent-loop` (§7) и `core/tools` (§2).

## Итог
8 из 8 якорей существуют и указывают на заявленные символы со заявленным содержанием; номеров вне файла и сдвигов >±10 нет.
Две неточности — смежные, не в самих якорях: инвертированное описание ветки `askUser` (`foundation-16:11`) и «пустой
installer с комментарием» (`23-STEPS:660`), противоречащее `package-invariants.ts:326-332`.
