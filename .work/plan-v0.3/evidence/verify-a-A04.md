# verify-a-A04 — controller/dsh-session, security, tools.restrict

Ревизия репозитория MyWork: `git rev-parse HEAD` = `0c657ae1434202865bd330f0eeaf2b60eb78f6d4` (H:\Repo\DSH-MyWork).
Проверялись только чтением: `H:\Repo\DSH-MyWork\packages\**` и checkout DSH `C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts` (read-only).
Никаких мутаций, install, build и прогонов тестов не выполнялось.

## Якорь A04-1: 10-DECISIONS.md:1181,1211 → packages/controller/src/dsh-session.ts:199-207 и :203

- **Вердикт:** ПОДТВЕРЖДЕНО (цитата дословна; формулировка самого якоря «tools/restrict/approval» этим строкам не соответствует — см. комментарий)
- **Что проверено:** read `H:\Repo\DSH-MyWork\packages\controller\src\dsh-session.ts` offset 160 limit 70 (строки 199-207, 203); read `.work\plan-v0.3\10-DECISIONS.md` offset 1175 limit 60 (строки 1181, 1211); grep по `10-DECISIONS.md` (`tools.restrict` — строки 1240, 1258, 1264, 1288; `approval.request` — строка 1209)
- **Фактическое значение:**
  - `:199` `prompt(` → `:200-205` `request: { readonly requestId: string; readonly sessionId: string` / `:203` `readonly mode: 'queue' | 'steer'` / `:204` `readonly content: readonly { readonly type: 'text'; readonly text: string }[]` / `:206` `signal: AbortSignal,` / `:207` `): Promise<{ readonly accepted: true }>`
  - 10-DECISIONS.md:1181: «`packages/controller/src/dsh-session.ts:199-207` — `prompt(request: { requestId, sessionId, mode: 'queue' | 'steer', content }, signal)`; `:203` — `readonly mode: 'queue' | 'steer'`»
- **Оценка severity:** minor
- **Комментарий:** Цитата в решении совпадает с первоисточником дословно: `prompt(...)` занимает ровно 199-207, а `:203` — это `readonly mode: 'queue' | 'steer'`; строка 1211 ссылается на `:203` корректно. Дефект — в формулировке якоря: `tools.restrict` и `approval` в этих строках не встречаются вообще. `tools.restrict` в документе цитируется в другой секции (D15, строки 1240/1258/1264/1288), `approval.request(req)` — на строке 1209. Платформенный шов из строки 1258 проверен отдельно по checkout DSH: `C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts:1097` — `restrict(filter: ToolRestriction): () => void`, и `:1100` — контекстно-глобальный вызов бросает (`tools.restrict() requires a scoped context (agent.ctx)…`), что подтверждает и строку 1288 решения. Т.е. якорь отсылает к верным строкам, но описывает их чужой рубрикой.

## Якорь A04-2: 10-DECISIONS.md:1226 → packages/controller/src/dsh-session.ts:175-179

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\controller\src\dsh-session.ts` (строки 175-179, интерфейс `DshSessionController`), read `10-DECISIONS.md` offset 1205 limit 95 (строка 1226)
- **Фактическое значение:**
  - `:175` `create(request: {` / `:176` `readonly cwd?: string` / `:177` `readonly sessionId?: string` / `:178` `readonly agentPreset?: string` / `:179` `}): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>`
  - 10-DECISIONS.md:1226: «`packages/controller/src/dsh-session.ts:175-179` — `create({ cwd?, sessionId?, agentPreset? })` — `agentPreset` необязателен»
- **Оценка severity:** info
- **Комментарий:** Файл и диапазон строк совпадают; `agentPreset?` действительно опционален (строка 178) — то есть контракт обёртки допускает `create` без пресета агента. Решение при этом честно помечает поведение такой сессии как непроверенное, так что утверждение не переоценивает доказательство: сами строки подтверждают только необязательность поля, а не работоспособность сессии без агента. Рубрика якоря («steer/queue или tools.restrict») строкам 175-179 тоже не соответствует — `steer` упомянут в другом предложении строки 1226.

## Якорь A04-3: 10-DECISIONS.md:1210,1252,1290,1298 → packages/contracts/src/security.ts:171-193, :201, :212 + packages/core/src/security.ts:102-110

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\contracts\src\security.ts` offset 160 limit 65 и offset 268 limit 28; read `packages\core\src\security.ts` offset 90 limit 30; read `10-DECISIONS.md` offset 1205 limit 95 (строки 1210, 1252, 1258, 1264, 1288, 1290, 1298); grep `export \* from` в `packages\contracts\src\index.ts` (строка 82 — `./security.ts`); read `C:\Reposit\deepseek-harness\deepseek-harness\packages\core\tools\src\index.ts` offset 1085 limit 30
- **Фактическое значение:**
  - security.ts `:171` `export type HumanGate =`, `:184` `export const HUMAN_GATES: readonly HumanGate[] = Object.freeze([`, `:193` `export const DOMAIN_IMPLIED_GATES: Readonly<Partial<Record<OperationDomain, HumanGate>>> = Object.freeze({`, `:280` `readonly gate?: HumanGate` (внутри `interface OperationRequest`, `:268-281`)
  - security.ts `:201` `export const REVIEWER_DEFAULT_PERMISSIONS: readonly Permission[] = Object.freeze([` / `:212` `export const IMPLEMENTATION_WRITE_PERMISSIONS: readonly Permission[] = Object.freeze([`
  - core/security.ts `:102` `const gate = operation.gate ?? DOMAIN_IMPLIED_GATES[operation.domain]` → `:104-109` `return denied('human-gate', `dsh-mywork: operation "…" is a §28 gate ("…") and is decided by a human, never by a permission`, …)`
- **Оценка severity:** info
- **Комментарий:** Все четыре ссылки точны. «Принуждение гейта как отказа» (строка 1210) подтверждено буквально: ветка возвращает `denied('human-gate', …)` и до проверок workspace/credential не доходит — гейт не может быть одобрен правами. Allowlist/denylist-различение из 1252/1290/1298 подтверждено: `REVIEWER_DEFAULT_PERMISSIONS` — allowlist из четырёх прав, `IMPLEMENTATION_WRITE_PERMISSIONS` — запретный список из трёх (`workspace.write`, `git.write`, `shell`), и ни одно имя не пересекается. Побочно подтверждено утверждение 1210 о звёздном реэкспорте (`index.ts:82` `export * from './security.ts'`), из-за которого коллизия имён была бы молчаливой подменой. Платформенная форма фильтра — `ToolRestriction` с `allow` (keep only) и `deny` (remove) и требованием scoped-контекста (DSH `core/tools/src/index.ts:1091-1101`) — согласуется с «allowlist навешивается на контекст worker-агента» (строка 1288).

## Якорь A04-4: 10-DECISIONS.md:1216 → packages/core/src/skill.ts:870-888

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\core\src\skill.ts` offset 860 limit 40 (строки 870-888; файл 1196 строк, 52687 байт); read `10-DECISIONS.md` offset 1205 limit 95 (строка 1216)
- **Фактическое значение:**
  - `:870` `const SKILL_TRANSITIONS: Readonly<Record<SkillStatus, readonly SkillStatus[]>> = Object.freeze({` → `:871-874` `candidate: […'active','archived']`, `active: […'stale','archived']`, `stale: […'active','archived']`, `archived: []`
  - `:882` `export function isAllowedSkillTransition(from: SkillStatus, to: SkillStatus): boolean {` → `:883` `return isAllowedTransition(from, to)`
  - 10-DECISIONS.md:1216: «`packages/core/src/skill.ts:870-888` даёт готовый образец `SKILL_TRANSITIONS` + `isAllowedSkillTransition`»
- **Оценка severity:** minor
- **Комментарий:** Оба названных символа лежат внутри заявленного диапазона: таблица переходов — 870-875, экспортируемая проверка — 882-884. Две неточности помельче: `SKILL_TRANSITIONS` не экспортируется (объявлена без `export`, строка 870), а `:888` — это тело приватного помощника `isAllowedTransition` (887-889), т.е. верхняя граница диапазона на две строки шире, чем нужно. Как «образец» для `HumanDecision` символы всё же доступны через `isAllowedSkillTransition` (:882) и `skillTransitionTargets` (:892) — на корректность утверждения это не влияет.

## Якорь A04-5: 10-DECISIONS.md:1645 → packages/execution/src/schema.ts:120

- **Вердикт:** ПОДТВЕРЖДЕНО
- **Что проверено:** read `packages\execution\src\schema.ts` offset 108 limit 28 (строки 108-135, файл 161 строка); read `10-DECISIONS.md` offset 1638 limit 14 (строки 1642-1646)
- **Фактическое значение:**
  - `:120` `CREATE TABLE attempt (` → `:121-133` `attempt_id TEXT PRIMARY KEY`, `task_id`, `workspace_id`, `agent_id`, `state TEXT NOT NULL CHECK (state IN ${ATTEMPT_STATE_CHECK})`, `revision`, `fence`, `controller_epoch`, `lease_expires_at`, `operation_id`, `created_at`, `settled_at`, `) STRICT;`
  - 10-DECISIONS.md:1645: «Task Graph MyWork живёт в `packages/execution/src/schema.ts:120` (`attempt`), и ни одной живой БД с ней нет»
- **Оценка severity:** info
- **Комментарий:** Строка 120 — в точности начало DDL таблицы `attempt`; дополнительно виден уникальный индекс `attempt_task_live_lease` (`:135`) и CHECK по состояниям, т.е. таблица действительно доменная, а не декоративная. Утверждение о том, что `attemptId` отсутствует в леджере (`src/protocol.ts:190` — `sessionId`), осталось вне моего мандата (внешний плагин, только чтение живого профиля) и не проверялось; сам якорь A04-5 им не является.

## Якорь A04-6: 10-DECISIONS.md:1682 → packages/contracts/src/attempt.ts:36

- **Вердикт:** ПОДТВЕРЖДЕНО (цитата и строка совпадают; имя `AttemptOutcome` в репозитории отсутствует — см. комментарий)
- **Что проверено:** read `packages\contracts\src\attempt.ts` offset 24 limit 26 (строки 24-49; файл 127 строк); read `10-DECISIONS.md` offset 1676 limit 12 (строка 1682); grep `^export (type|interface|const)` по `attempt.ts`; grep `AttemptOutcome` по `H:\Repo\DSH-MyWork\packages` и по `.work\plan-v0.3\evidence` (0 совпадений)
- **Фактическое значение:**
  - `:34` `/** Terminal failure. */` / `:35` `| 'failed'` / `:36` `/** Terminal failure: the attempt exceeded its deadline. */` / `:37` `| 'timed-out'`
  - 10-DECISIONS.md:1682: «Контракты: `AttemptOutcome`/`Attempt` (`packages/contracts/src/attempt.ts:36` — «Terminal failure: the attempt exceeded its deadline») получает различение причины»
- **Оценка severity:** minor
- **Комментарий:** Цитата дословна, строка 36 — это doc-комментарий состояния `'timed-out'` (само значение на 37), т.е. цитата про статус attempt подтверждена буквально. **Найденный дефект:** тип `AttemptOutcome` не существует — grep по `packages` не находит ни одного вхождения (0 совпадений), а фактический экспорт `attempt.ts` таков: `AttemptState` (:21), `ATTEMPT_STATES` (:46), `ATTEMPT_ACTIVE_STATES` (:61), `ATTEMPT_TERMINAL_STATES` (:70), `Lease` (:80), `WorktreeRef` (:92), `Attempt` (:104). Значит половина пары «`AttemptOutcome`/`Attempt`» — вымышленный символ: правка «получает различение причины» адресуема только к `Attempt` (и каталогам состояний), а `AttemptOutcome` придётся либо создать, либо вычеркнуть из формулировки. На вердикт якоря (цитата о статусе) это не влияет, но при планировании шага это надо учесть.

## Сводка

| Якорь | ref | Вердикт | severity |
|---|---|---|---|
| A04-1 | 10-DECISIONS.md:1181,1211 | ПОДТВЕРЖДЕНО | minor |
| A04-2 | 10-DECISIONS.md:1226 | ПОДТВЕРЖДЕНО | info |
| A04-3 | 10-DECISIONS.md:1210,1252,1290,1298 | ПОДТВЕРЖДЕНО | info |
| A04-4 | 10-DECISIONS.md:1216 | ПОДТВЕРЖДЕНО | minor |
| A04-5 | 10-DECISIONS.md:1645 | ПОДТВЕРЖДЕНО | info |
| A04-6 | 10-DECISIONS.md:1682 | ПОДТВЕРЖДЕНО | minor |

СУММА: подтверждено 6, неверная строка 0, ложно 0, не существует 0, устарело 0, не проверено 0.
