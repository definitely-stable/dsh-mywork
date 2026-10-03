# Поток E: взаимодействие с человеком — questions, HumanGate, review, approvals, attention

**Вердикт потока:** §27 и §28 внешнего документа **подтверждены по коду** (в rc.2 нет timed/late-answer API; runtime-owned child получает `DELEGATED_CALLER`); §32 подтверждён с уточнением (Auto Review — это *политика одобрения вызова*, а не review результата, и в default Web она выключена); §29 **частично подтверждён, но его ключевое имя занято**: `HumanGate` в MyWork уже означает закрытый каталог из пяти *классов операций* (`packages/contracts/src/security.ts:171`), поэтому durable-сущность из §29 нельзя назвать `HumanGate` без коллизии — встраивать её надо в карточку **MW-030** (каталог гейтов + `NeedsAttentionReason` + `task.resolve-attention`), а доставку ответа в живую попытку — в **MW-046** (`attempt.steer` + `DiscussionMessage(kind='decision')`); §6.2 подтверждён (нет `originState`/`AttentionState`), но рекомендованный им маппинг `needs-attention → error` **противоречит текущему коду** (`ZONE_BY_STATE['needs-attention'] = 'blocked'`), а `NeedsAttentionReason` уже существует, но не имеет ни одного носителя; §46 и §50 — подтверждены с уточнениями (у §50 смешаны два уровня состояний).

---

## 1. Что проверено и как

Все команды — только чтение; рабочая копия и живые артефакты не менялись. `pwsh`-команды выполнялись из `C:\Reposit\deepseek-harness\deepseek-harness` (DSH) или `H:\Repo\DSH-MyWork` (MyWork); exit code у всех перечисленных команд — `0`, если не указано иное.

| # | Утверждение | Как проверял | Результат |
|---|---|---|---|
| 1 | Публичный API `UserQuestionService` — только `ask()` | `read` файла целиком: `packages/interaction/user-questions/src/index.ts` (154 строки); в теле класса `UserQuestionService` (строки 65–152) объявлен один метод — `ask` (86) | подтверждено |
| 2 | Нет `askTimed` / `TimedQuestionWait` / `ASK_TIMED_OUT` / `attachWait` / `user-question-reply` в текущих исходниках | `grep` по `C:\Reposit\deepseek-harness\deepseek-harness` (шаблон `DELEGATED_CALLER\|CALLER_NOT_LIVE\|askTimed\|ASK_TIMED_OUT\|TimedQuestionWait\|user-question-reply\|attachWait`) → **10 совпадений**: только `DELEGATED_CALLER`/`CALLER_NOT_LIVE` в `src/index.ts:82-105`, тестах и сгенерированном `tool-cordis/src/api-catalog.ts:3360` | подтверждено (0 совпадений на timed-API) |
| 3 | В каталоге `src/` пакета только `index.ts` и `types.ts` | `Get-ChildItem packages\interaction\user-questions\src -File` → `index.ts` (5960 б), `types.ts` (3587 б) | подтверждено |
| 4 | Коммит `bb19061473` добавил timed-механику (+ перенёс note в `implemented/`) | `git show --stat bb19061473`, `git show --stat --name-only --format='' bb19061473 \| Select-String 'timed-user-question'` | подтверждено |
| 5 | Коммит `32905d5ab5` — откат всей механики | `git show --stat 32905d5ab5`, `git show 32905d5ab5 -- packages/interaction/user-questions/src/index.ts`, `... -- src/types.ts` | подтверждено |
| 6 | Что именно откатили (список символов) | тот же diff, читал построчно (см. §2.2) | перечислено ниже |
| 7 | `DELEGATED_CALLER` — реальная ветка кода | `read` `src/index.ts:93-107` + `read` `packages/core/agent/src/index.ts:596-600` | подтверждено |
| 8 | Ответ на вопрос держит tool call открытым | `read` `packages/interaction/tool-ask-user/src/index.ts:79-98`; в схеме параметров (22–56) нет `timeout` | подтверждено |
| 9 | Note двух settlements — `Status: proposed` на несуществующем API | `read` `.agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md` (113 строк), строки 3, 19–22, 39–45, 49–51; `git ls-tree -r --name-only HEAD \| Select-String 'timed-user-question'` → путь `proposed/`; в `revert^` путь был `implemented/` | подтверждено |
| 10 | Auto Review — per-call политика одобрения, выключена в default Web | `read` `packages/experimental/auto-review/README.md:12,33-36,46,58,87,115,118`; `grep` по `src/index.ts` | подтверждено |
| 11 | Auto Review падает обратно на пользователя через `kind:'ask'` | `read` `packages/experimental/auto-review/src/index.ts:641-675,710-716` | подтверждено |
| 12 | Гейт подтверждения — `ApprovalService.request()` с аудит-парой и fail-closed | `read` `packages/interaction/user-approval/src/index.ts:215-234,243-259,267-269`, `src/types.ts:28-58,78-92` | подтверждено |
| 13 | Auto — это preset (`auto`), требующий Full access + `ask` | `read` `packages/interaction/permission-presets/src/index.ts:82,89-91,285,307-316,355,405,432-435` | подтверждено |
| 14 | В DSH нет OS/desktop-уведомлений | `Get-ChildItem packages -Directory -Recurse -Depth 2 \| Where Name -match 'notif\|desktop\|toast\|alert\|mail\|push'` → пусто; `grep` по `Notification\|notify\(` дал только ACP-транспорт, SDK-protocol, in-process `notify` и клиентские тосты | подтверждено (примитива вне GUI нет) |
| 15 | `NeedsAttentionReason` существует, включая `human-gate-deadline-exceeded` | `read` `packages/contracts/src/board.ts:349-381` (тип 356, каталог 373, `human-gate-deadline-exceeded` 364 и 377) | подтверждено |
| 16 | Ни `originState`, ни `AttentionState` в MyWork нет | `Get-ChildItem packages -Recurse -Include *.ts,*.mjs` (без `node_modules/lib/dist`) `\| Select-String 'originState\|AttentionState'` → `matches=0`; тот же шаблон по `tests` → 0; для сравнения `Select-String 'originState\|AttentionState\|NeedsAttentionReason\|HumanGate\|humanGate\|needs-attention'` по `packages,tests,.work` находит `HumanGate` только в `contracts/src/security.ts:171,184,193,280`, `NeedsAttentionReason` — только в `contracts/src/board.ts:356,373` | подтверждено |
| 17 | `needs-attention` сегодня проецируется в зону `blocked`, а не `error` | `read` `packages/contracts/src/board.ts:102-119` (строка 118) | подтверждено |
| 18 | Имя `HumanGate` занято другим смыслом | `read` `packages/contracts/src/security.ts:164-195,267-281` | подтверждено |
| 19 | `CardCommand 'task.resolve-attention'` уже объявлен | `read` `packages/contracts/src/board.ts:251-280` (265–266, 278) | подтверждено |
| 20 | Authority-домен `approval.human` уже существует и покрыт тестом | `read` `packages/contracts/src/authority.ts` (≈64-65, 122); `read` `tests/authority.test.mjs:35,100-102` | подтверждено |
| 21 | Аудит-типы `human.override` и `gate.decided` уже существуют | `read` `packages/contracts/src/audit.ts:29-82` (50, 53-54, 75, 77) | подтверждено |
| 22 | В `ReviewState` есть терминальный `escalated`, и из него нет выхода | `read` `packages/contracts/src/review.ts:11-48`; `read` `tests/review.test.mjs:192-202` (ассерт: у терминального состояния нет исходящих рёбер) | подтверждено |
| 23 | У `Review` нет ни `deadlineAt`, ни ссылки на человеческое решение | `read` `packages/contracts/src/review.ts:50-88` | подтверждено |
| 24 | У `AttemptState` нет `paused`/`awaiting-human` | `read` `packages/contracts/src/attempt.ts:21-74` (состояния: created, leased, starting, running, settling, completed, failed, timed-out, cancelled, revoked, stale) | подтверждено |
| 25 | `BlockerResolutionGate` — уже существующий паттерн «производное состояние + сохраняемое решение» | `read` `packages/contracts/src/workflow.ts:42-152` (70–97 решение, 99–125 гейт, 103–105 явный отказ называться `HumanGate`), `core/src/blocker.ts:123-155` | подтверждено |
| 26 | §50 смешивает два уровня состояний | `read` `packages/contracts/src/board.ts:134-166` (`BoardPanelState`) и `:299-314` (`DegradedProjection.reason`) | подтверждено |
| 27 | ADR028 требует «human acceptance» для 4 из 6 work type, но кода нет | `read` `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377+` (таблица `WorkType`) + `Select-String 'humanAcceptance\|WorkType\|FINISH_CRITERIA_UNMET'` по `packages` → **0 совпадений**; `Select-String 'worktype'` по `.work/tasks` → только `MW-045.md:15,18` | подтверждено |
| 28 | MW-030 — владелец human gates и `NeedsAttentionReason` | `read` `.work/tasks/MW-030.md:17,20` | подтверждено |
| 29 | MW-046 — владелец `attempt.steer` и `DiscussionMessage(kind='decision')` | `read` `.work/tasks/MW-046.md:18,21` | подтверждено |
| 30 | Бюджетный гейт сознательно не выбирает между pause/escalate/human decision | `read` `.work/reports/MW-013-routing-budget.md:81-84` (пункт `D7`) | подтверждено |
| 31 | `agent.steer` / `agent.inject` — примитивы доставки сообщения агенту | `grep` по `packages/core/agent/src` → `runtime-types.ts:231` (`steer(UserMessage)`), `:241` (`inject(UserMessage)`) | подтверждено |

**Что НЕ проверял (важно для чтения выводов):** работающий GUI на 127.0.0.1:3080 вживую (никаких кликов, скриншотов, DevTools), реальные DSH-e2e («человек отвечает → ответ доезжает»), тесты MyWork (`node --test` не запускал), DSH-тесты (`vitest` не запускал), содержимое `lib/` и `dist/` как источник поведения (читал только `src/`), живую доску-плагин и её леджер.

### 1.1. Ограничения метода

- Все выводы о поведении — по исходникам `src/`, а не по README пакетов (кроме случаев, где README цитируется явно как документация, и тогда это помечено).
- `grep`-тул ходит по всему дереву, включая `tests/`; поэтому в CLAIMS я отдельно помечаю, где доказательство — тест, а где — реализация.
- Историю коммитов читал только в объёме `git show --stat` и точечных diff'ов по `packages/interaction/user-questions`; полный revert-diff (в нём `docs/persistence-schema.json` на 73k строк) не читал.

---

## 2. Разбор по разделам документа

### 2.1. §6.2 (стр. 237–256) — needs-attention, originState, AttentionState

**Статус: ПОДТВЕРЖДЕНО по существу, но рекомендация маппинга противоречит коду, а часть инфраструктуры уже есть.**

Документ утверждает: «текущий Task не содержит authoritative `originState` для `needs-attention`; на render нельзя угадывать phase из старой event history» и предлагает безопасный маппинг `needs-attention → error` с reason badge, а `AttentionState` — как будущее расширение.

Что подтверждается:

1. `originState` в MyWork действительно нет. `Task` (`packages/contracts/src/task.ts:75-107`) не имеет ни `originState`, ни `reason`, ни ссылки на сущность внимания; есть только `state: TaskState` (87) и `revision` (89). Поиск `originState|AttentionState` по `packages/*/src` даёт 0 совпадений (совпадения были только в скопированных `node_modules`-декларациях того же пакета — то есть не новые факты).
2. «Нельзя угадывать phase из старой event history» — согласуется с тем, что `TaskState` — side state: `'needs-attention'` входит в `TASK_STATES` (task.ts:43,62), но не входит в `TASK_STATES_WITH_ACTIVE_ATTEMPT` (`['assigned','executing']`, task.ts:72). То есть при входе в `needs-attention` активной попытки уже нет, и по факту состояния нельзя понять, была ли задача в `executing` или в `reviewing`.
3. Переходы: `core/src/task.ts:54-59` разрешает вход в `needs-attention` из `assigned`, `executing`, `awaiting-review`, `reviewing`, `approved`, `integrating`; выход — только в `ready`, `failed`, `cancelled`, `superseded` (`core/src/task.ts:63`). Это ровно тот случай, когда исходная фаза теряется: шесть разных входов, один узел.

Что **опровергается или уточняется**:

4. Рекомендация `needs-attention → error` **не соответствует текущему коду**: `ZONE_BY_STATE['needs-attention'] = 'blocked'` (`packages/contracts/src/board.ts:118`), и `projectTaskZone` обязан сохранять это соответствие — карточка MW-042 объявляет приёмку «каждый из 16 TaskState отображается ровно в одну из девяти зон» и «`projectTaskZone` не может вернуть зону done для состояния, отличного от done» (`.work/tasks/MW-042.md:21`). Значит §6.2 — это **миграция проекции** (смена `ZONE_BY_STATE`), а не описание; менять её надо вместе с `legalDropTargets`/`allowedTaskTransitions`, иначе drag-and-drop разъедется с зонами.
5. Вокабуляр документа (7 lane'ов: `ideas, queue, work, review, error, done, closed`) не совпадает с MyWork: девять зон `ideas, backlog, ready, in-progress, review, blocked, error, done, cancelled` (`packages/contracts/src/board.ts:53-63`, и все девять ключей в `BOARD_ZONE_ROWS`/`BOARD_ZONE_ICONS`, `:66-92`). §6.1 — предложение новой модели, а не сверка.
6. «`needs-attention` с reason badge» — **reason уже объявлен, но не имеет носителя**. `NeedsAttentionReason` и `NEEDS_ATTENTION_REASONS` есть (`board.ts:356,373`), причём один из триггеров — прямо про человеческий гейт: `'human-gate-deadline-exceeded'` (`board.ts:364,377`). При этом по `packages/contracts/src` и `packages/core/src` **нет ни одного использования** `NeedsAttentionReason` кроме самого объявления (полный `Select-String` по обоим каталогам: 3 совпадения — `board.ts:210` (`subState`), `:356`, `:373`), и в `packages/contracts/src/events.ts` нет ни `attention`, ни `reason`. Единственное поле, куда триггер мог бы лечь сегодня, — `BoardPlacement.subState?: string` (`board.ts:210`), то есть нетипизированная строка. Вывод: §6.2 прав, что нужна отдельная сущность, но её нельзя вводить «с нуля» — надо **типизировать носитель** уже объявленного каталога.

**Что это меняет:** `AttentionState` из §6.2 нужно расширить относительно документа: к `taskId/reason/originState/enteredAt/revision` добавить источник триггера (`NeedsAttentionReason`), ссылку на решение человека (id будущей сущности из §29) и признак «отвечено/просрочено». Иначе UI не сможет отличить «ждём человека» от «бюджет кончился».

### 2.2. §27 (стр. 815–832) — Human interaction: timed API отсутствует

**Статус: ПОДТВЕРЖДЕНО полностью, включая список отсутствующих символов. Дополнение: откат был не одним коммитом, а откатом merge-PR, и откатил больше, чем перечисляет документ.**

Публичный API `UserQuestionService` в текущем checkout — **один метод**:

- `async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>` — `packages/interaction/user-questions/src/index.ts:86`.
- Класс `UserQuestionService extends Service` (65), конструктор только вызывает `super(ctx, 'userQuestions')` (66–68). Никаких `@Remote`-методов, никаких потоков.
- `AskUserQuestionRequest extends AskUserQuestionRequestEvent` (31), а событие — `{ questions, agent?, signal? }` (`src/types.ts:70-77`). Поля `wait?: { callId, timed }`, которое добавлял откаченный коммит, **нет**.

Коды ошибок, реально существующие сейчас (`src/index.ts`): `ASK_ABORTED` (44, 88, 147), `EMPTY_QUESTIONS` (91), `CALLER_NOT_LIVE` (99), `DELEGATED_CALLER` (105), `BAD_INTENT` (122, 127), `NO_PROVIDER` (132). Ни `ASK_TIMED_OUT`, ни `BAD_TIMEOUT`, ни `DUPLICATE_WAIT`, ни `BAD_ANSWER` в коде нет (grep, см. §1 п.2).

Документ называет отсутствующими `askTimed`, `TimedQuestionWait`, `ASK_TIMED_OUT`, late-answer business API. Всё верно, но **неполно**. Что именно сделал `bb19061473` и что снял `32905d5ab5`:

| Символ / файл | `bb19061473` (2026-09-24 16:33 +0800) | Текущий HEAD |
|---|---|---|
| `src/projection.ts` (330 строк) | добавлен: `userQuestionProjectionDefinition`, `isTimedAskUserQuestionSchema`, `TIMED_WAIT_PARAMETER` | **удалён** |
| `src/timed-wait.ts` (83 строки) | добавлен: класс `TimedQuestionWait` | **удалён** |
| База сервиса | `TypertRemoteService` + `static Config = z.object({})` | снова `Service` |
| `askTimed(request, callId, timeoutMs)` | есть, с валидацией таймаута (`BAD_TIMEOUT`, `DUPLICATE_WAIT`) и маппингом `ASK_TIMED_OUT → { pending: true, callId }` | **нет** |
| `@Remote answer(agent, callId, answer): boolean` | late-answer RPC: `agent.steer(createUserMessage({ source: { kind: 'user-question-reply', callId, outcome: 'answered' }, … }))` | **нет** |
| `@Remote({ mode: 'stream' }) attachWait(agent, callId, signal)` | claim-поток, отдаёт `{ remainingMs }` | **нет** |
| `TimedUserQuestionResult = AskUserQuestionAnswer \| { pending: true; callId }` | есть | **нет** |
| Типы `UserQuestionState`, `PendingUserQuestion`, `SettledUserQuestion`, `UserQuestionProjectionView` | есть (`src/types.ts`) | **нет** |
| `MessageSourceMap['user-question-reply']` | есть (`{ kind, callId, outcome: 'answered'\|'dismissed' }`) | **нет** |
| `SessionProjectionMap.userQuestions` | есть | **нет** |
| `request.wait?: { callId; timed?: boolean }` | есть | **нет** |
| приватный `assertLiveRoot(agent)` | выделенный хелпер | **инлайнен обратно в `ask()`** |

Команды: `git show --stat bb19061473`, `git show 32905d5ab5 --format='' -- packages/interaction/user-questions/src/index.ts` и `... -- src/types.ts` (оба diff'а прочитаны построчно), `Get-ChildItem ...\src` (осталось два файла). Exit code 0.

Цепочка отката точнее, чем в документе: `bb19061473` (feature) → `652bc9d396` `fix(user-questions): align styles and cover wait cleanup` (правит CSS, `ui-user-questions/src/client/index.ts`, добавляет тест на cleanup wait) → `a56d2bf2ff` `fix(user-questions): reset projection version and use brand utility` (правит `src/projection.ts` и `projection.spec.ts`) → `a64eaf0b5e` `Merge pull request #4868 from …/reconciled-pr4839-ux-evidence` (**это и есть коммит с сообщением `feat: reconcile timed questions with legacy default`**) → `32905d5ab5` `Revert "feat: reconcile timed questions with legacy default"` → `1afcc03ff9` `Merge pull request #5174 from …/revert-4868-reconciled-pr4839-ux-evidence`. То есть откатывался **merge-PR #4868 целиком**, а не отдельный feature-коммит; два fix-коммита (`652bc9d396`, `a56d2bf2ff`) при этом остались в истории и их правки в `ui-user-questions` и в `projection.ts` откатились вместе с веткой.

**Что осталось после отката:** блокирующий `ask()` со встроенными проверками `CALLER_NOT_LIVE`/`DELEGATED_CALLER`, проверка `BAD_INTENT` для `plan-review` (`src/index.ts:115-129`), тип `AskUserQuestionIntent` с `kind: 'plan-review'`, обязательным `approve` и необязательным `callId` (`src/types.ts:22-33`), waterfall-событие `user-questions/request` (`src/types.ts:88-92`), и **note** `.agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md` (113 строк, `Status: proposed`), который описывает `mode: legacy|timed`, `askTimed()`, `attachWait`, `answer()`, `TimedQuestionWait` и `ASK_TIMED_OUT` (строки 19–22, 39–45, 49–51) — то есть API, которого в коде нет. Путь note вернулся из `implemented/` в `proposed/` (`git ls-tree -r --name-only 32905d5ab5^ | Select-String timed-user-question` → `implemented/…`; `HEAD` → `proposed/…`), что честно отражает статус, но текст note при этом остался «реконсилированным».

Сгенерированная документация согласована с откатом: `docs/subsystems/user-questions.md` (180 строк) в разделе «Cordis API» даёт единственную сигнатуру `async ask(request): Promise<AskUserQuestionAnswer>` (строка 151), а раздел «Errors» перечисляет `EMPTY_QUESTIONS, NO_PROVIDER, ASK_ABORTED` (строка 108). Timed-режима в доке нет. То есть **не дока устарела, а note описывает несуществующее**.

**Что это меняет для MyWork:** (а) §27 — правильная коррекция, и на ней нельзя строить capability; (б) из note можно брать только *модель* (два разных времени жизни: foreground wait и durable answer), но не имена API; (в) MyWork обязан владеть durable-состоянием сам — что и есть §29.

### 2.3. §28 (стр. 836–854) — delegated child не может спрашивать человека

**Статус: ПОДТВЕРЖДЕНО. Код ошибки — ровно `DELEGATED_CALLER`, условие — рантайм-владение.**

Точный код (`packages/interaction/user-questions/src/index.ts:93-107`):

```ts
const agent = request.agent
if (agent !== undefined) {
  const agents = this.ctx.get('agents')
  if (agents === undefined || agents.get(agent.id) !== agent) {
    throw new UserQuestionError(
      'human interaction requires the exact live calling agent when an agent is supplied',
      'CALLER_NOT_LIVE')
  }
  if (!agents.roots().includes(agent)) {
    throw new UserQuestionError(
      'human interaction is unavailable while the calling agent is owned by another live agent; '
      + "include the unresolved question or decision in the child agent's final result",
      'DELEGATED_CALLER')
  }
}
```

Что такое «root» (`packages/core/agent/src/index.ts:590-600`): `roots()` возвращает живых агентов с `entry.owner === undefined`; комментарий прямо говорит «durable session lineage does not affect this runtime relation, so a resumed fork may still be a root». То есть условие срабатывания `DELEGATED_CALLER` — **наличие живого родителя в рантайме**, а не происхождение сессии от другой сессии. Формулировка JSDoc в самом сервисе (`src/index.ts:70-85`) повторяет то же: «an owned child has no human answerer and would block forever, while a lineage-bearing session resumed as a new runtime root may ask normally».

Уточнения, которых нет в документе:

- Ошибка **структурированная**: `UserQuestionError extends HarnessError` (`src/index.ts:34-39`), и `ctx.tools.execute()` сохраняет `{ name, code }` для модель-видимой ошибки (это утверждает `docs/subsystems/user-questions.md:108`, и это же проверяется тестом `packages/interaction/tool-ask-user/tests/tool-ask-user.spec.ts:270,294` — «rejects a live runtime-owned agent with a structured DELEGATED_CALLER error», ожидается `error.info = { name: 'UserQuestionError', code: 'DELEGATED_CALLER' }`).
- `CALLER_NOT_LIVE` — **отдельный** код для устаревшего инстанса, и он проверяется раньше: `packages/interaction/user-questions/tests/user-questions.spec.ts:211,243,259`.
- Проверка применяется **только если `request.agent` передан**. `ask()` без agent идёт в waterfall без scope-фильтра (`src/index.ts:135-136`), то есть «спросить человека вообще» технически возможно и без агента — но тогда ответ не будет привязан ни к какой сессии. Для MyWork это значит: привязка вопроса к сессии/попытке обязана быть на стороне MyWork, а не выводиться из DSH.
- Инструмент `ask_user_question` **всегда** передаёт агента (`packages/interaction/tool-ask-user/src/index.ts:88`: `...exec.agent !== undefined ? { agent: exec.agent } : {}`), поэтому для model-facing пути граница работает.

**Что это меняет для MyWork:** схема из §28 (`worker detects unresolved decision → HumanGate/needs-attention → controller/root UI asks human → durable answer → resume/replan/new Attempt`) согласуется с платформой, но требует проверяемого допущения: **worker-сессия MyWork должна быть DSH runtime root**, иначе `ask()` из неё в принципе невозможен. Как MyWork создаёт сессии — я не проверял (см. §5, вопрос 1).

Дополнительная находка: §28 неявно предполагает, что вопрос из child'а *подхватит* родитель. В DSH этого механизма нет: текст ошибки лишь **просит** child'а «include the unresolved question or decision in the child agent's final result», то есть передача вопроса родителю — целиком ответственность вызывающей стороны (в MyWork — Handoff Artifact из §46 или результат попытки).

### 2.4. §29 (стр. 858–878) — HumanGate как отдельный домен

**Статус: ЧАСТИЧНО. Идея верна, но имя `HumanGate` в MyWork уже занято, и половина требуемой инфраструктуры уже существует под другими именами.**

Документ предлагает сущность:

```ts
interface HumanGate {
  id, taskId, attemptId?, question: StructuredQuestion,
  state: 'pending'|'answered'|'expired'|'cancelled',
  deadlineAt?, answer?: StructuredAnswer, revision
}
```

Что уже есть в MyWork **до** этой карточки:

1. **`HumanGate` — закрытый каталог классов операций**, а не вопрос. `packages/contracts/src/security.ts:164-190`:
   ```ts
   /**
    * An operation-specific gate of §28 that a human decides.
    * The gate below never approves one of these on its own: it refuses them, so a
    * role cannot reach a release, a migration, or production by holding a permission.
    */
   export type HumanGate = 'dependency-upgrade' | 'schema-migration' | 'security-change' | 'release' | 'production-access'
   ```
   и `OperationRequest.gate?: HumanGate` (`:280`), `DOMAIN_IMPLIED_GATES = { production: 'production-access' }` (`:193-195`). То есть в MyWork `HumanGate` = «*что* требует человека», а §29 хочет этим же словом назвать «*запрос* к человеку». Это коллизия имён внутри одного пакета контрактов, и её нельзя «разрешить» документацией — только переименованием одной из сторон.
2. **Паттерн «производное состояние + сохраняемое решение» уже реализован** — `BlockerResolutionGate` / `BlockerResolutionDecision` (`packages/contracts/src/workflow.ts:42-152`; чистая производная в `packages/core/src/blocker.ts:94-155`). Причём там уже есть то, что §29 только предлагает: `awaitingDecision: boolean` — «True when the gate is open and no `keep-blocking` decision stands: **a human has not yet answered it**» (`workflow.ts:118-122`), и решение с `decidedBy: string`, `decidedAt`, `reason?`, `artifactId?`, `operationId?`, `correlationId`, `decisionId` (caller-owned) (`workflow.ts:70-97`). Явный комментарий: «It is deliberately **not** a `HumanGate` from §28: it belongs to the edge level of the domain model, and mixing it into the five shipping gates would tie release policy to task cancellation» (`workflow.ts:103-105`).
3. **Authority и аудит под «решение человека» уже заведены**: домен `'approval.human'` («Human approval») с владельцами `['mywork-db','mywork-audit']` и `projection: false` (`packages/contracts/src/authority.ts:122`), покрыт тестом (`tests/authority.test.mjs:35` — ожидаемые владельцы; `:100-101` — `mayWrite('approval.human','mywork-audit') === true`, `mayWrite(...,'memory-provider') === false`). Аудит-типы: `'human.override'` — «A human overrode an automated decision» (`packages/contracts/src/audit.ts:50,75`) и `'gate.decided'` — «A typed gate was decided by a human or an admitted policy (ADR028 §5.18)» (`audit.ts:53-54,77`).
4. **Команда UI уже названа**: `CardCommand 'task.resolve-attention'` — «Answer a `needs-attention` trigger» (`packages/contracts/src/board.ts:265-266,278`). Реализации нет: по `packages/*/src` нет ни одного обработчика этого имени.
5. **Триггер уже назван**: `NeedsAttentionReason 'human-gate-deadline-exceeded'` (`board.ts:364,377`).

Чего **нет** (и что действительно надо добавить): ни одной сохранённой сущности «открытый вопрос человеку» с состоянием, дедлайном, ответом и ревизией; ни одного носителя `NeedsAttentionReason`; ни одной связи `Review.escalated` → решение человека; `ReviewState 'escalated'` («Terminal: the review was escalated to a human», `packages/contracts/src/review.ts:25-26`) — **тупик**: он в `REVIEW_TERMINAL_STATES` (`review.ts:43-48`), и тест прямо утверждает, что у терминального состояния нет исходящих рёбер (`tests/review.test.mjs:192-202`, проверка `allowedReviewTransitions(state).length === 0`). То есть «эскалировали человеку» сегодня означает «остановились навсегда»: ответить некуда, вернуться некуда.

**Что это меняет:** §29 надо переформулировать как **третью** сущность с другим именем (предлагаю `HumanDecision` — см. §3), которая:
- *использует* существующий `HumanGate` как классификатор причины (release/migration/security/production/dependency),
- *копирует* паттерн `BlockerResolutionGate` (производное состояние + сохраняемое решение, а не хранение всего),
- *переиспользует* домен `approval.human` и аудит-типы `gate.decided`/`human.override`,
- *реализует* уже объявленный `CardCommand 'task.resolve-attention'`,
- *закрывает* тупик `ReviewState 'escalated'`.

### 2.5. §32 (стр. 940–953) — Auto Review DSH и MyWork Review

**Статус: ПОДТВЕРЖДЕНО (это две разные вещи), с тремя уточнениями: чем именно включается, что видит пользователь и где именно проходит граница.**

Что такое Auto Review по коду и README:

- Это **per-call политика одобрения вызова инструмента**, выполняемая *до* тела вызова: «Before each native or PTC inner tool call, the current agent's provider and model assess the pending action; an allowed call executes with Full access, and a denied call asks the user» (`packages/experimental/auto-review/README.md:12`). Ревьюер — **та же модель и провайдер текущей сессии** (`README.md:87`: «uses the latest `request/header.config` provider and model»), с фиксированной политикой `REVIEW_POLICY` (`src/index.ts:40-61`).
- Включается как **профильный слой**, вручную: `pnpm dsh plugin --profile web add ./packages/experimental/auto-review` (`README.md:33`), «The dsh installation ships this layer switched off» (`README.md:12`), «Auto requires this Web layer switched on; it is absent from default Web, Headless, General settings, and new-session defaults» (`README.md:115`). Выбор — через composer/`/permission` с бейджем `EXP` и **подтверждением риск-диалога** человеком (`README.md:36`).
- Как preset: `AUTO_PRESET = 'auto'` (`packages/interaction/permission-presets/src/index.ts:82`), `AUTO_PRESET_SPEC` = Full access sandbox + `approval: 'ask'` (`:89-91`), регистрируется через `registerAuto(admit)` (`:307-316`); сохранённый Auto без живого интегратора восстанавливать запрещено — «cannot restore preset "auto" without its active integration» (`:432-435`). То есть Auto — это ещё и **sandbox-решение** (Full access), а не только «второе мнение».
- Что видит пользователь: при отказе — `askUser()` возвращает `{ kind: 'ask', reason: '<англ. аудит-причина>', displayReason: { en, zh } }` (`src/index.ts:657-666`) — то есть **обычный запрос подтверждения** с локализованной причиной; окончательный отказ — `denied()` с `reason: Auto review rejected tool "<name>"; its body was not executed` и структурированным `info: { name, code, reason? }` (`:641-651`); технический сбой ревьюера — `failed()` с отдельным текстом (`:669-675`). Ветвление по политике (`:710-716`): при `never` отказ **финальный** (`approval.overrideOf(agent.session) === 'never' → denied(exec, decision.reason)`), при `ask` — `askUser(...)`; в README это описано точнее: «under `ask` the listener delegates to later pre-execute listeners and returns the tools pipeline's `ask` decision only when they allow the call» (`README.md:58`).
- Провал ревьюера — **не** «человек решает»: «Malformed reviewer responses and technical failures fail the call with their specific error and never execute it» (`README.md:46`).
- Дополнительно: делегированный in-process child «pins the `never` policy, so its denials are final» (`README.md:46`, `:118`).

MyWork Review — другое: `ReviewState` = `queued|claimed|reviewing|approved|rejected|needs-evidence|escalated|cancelled` (`packages/contracts/src/review.ts:11-40`), привязка одобрения к `{ headSha, diffHash }` (`review.ts:50-56`), инвалидация одобрения при сдвиге HEAD (`tests/review.test.mjs:162-182`, код `STALE_REVISION`), запрет self-review (`tests/review.test.mjs:64-77`, `SECURITY_DENIED`), запрет reviewer'а с правом записи (`tests/review.test.mjs:79-106`), обязательные findings для `rejected`/`needs-evidence` (`:131-149`). Карточка MW-024 владеет этой очередью и требует «Review очередь/pool, fresh Session, evidence package и structured findings» (`.work/tasks/MW-024.md:17,20`).

**Как UI должен различать два гейта (ответ на вопрос 3 брифинга).** Три уровня, у каждого — свой носитель, своё время жизни и свой глагол:

| Уровень | Что это | Носитель в MyWork/DSH | Время жизни | Глагол в UI | Где рендерится |
|---|---|---|---|---|---|
| Разрешение на действие (permission) | «можно ли выполнить этот вызов» | DSH `approval/request` waterfall (`packages/interaction/user-approval/src/types.ts:78-92`), исход `allowed-once\|rejected\|cancelled\|unavailable` (`:32`), аудит `approval/asked`+`approval/decided` (`:44-58`); Auto Review — надстройка над ним | секунды, внутри tool call | «Разрешить один раз» / «Отклонить» | в потоке сессии/инструмента, **не** на доске |
| Решение человека по домену (gate) | «можно ли делать релиз/миграцию/production; как разрулить блокер» | новая сущность из §29 (предлагаю `HumanDecision`), триггер — `HumanGate` (`security.ts:171`) или `NeedsAttentionReason` (`board.ts:356`), команда — `task.resolve-attention` (`board.ts:266`) | часы-дни, переживает restart | «Решить» (+ причина) | очередь внимания на доске |
| Приёмка результата (result review) | «принимаем ли этот artifact» | `Review` + `ReviewState` (`review.ts:11-40`), привязка `{headSha,diffHash}` | до сдвига HEAD | «Принять» / «Запросить изменения» | карточка в зоне `review` |

Три правила, которые из этого следуют и которых сейчас нет ни в документе, ни в плане:

1. **Слова не пересекаются.** `Review` (латиницей) и «На проверке» закрепляются только за `ReviewState`. Гейт подтверждения не имеет права называться «review»: в Auto Review это `deny`/`ask`, в approval — `allowed-once`. И наоборот: `approved` в review не имеет права рендериться как «разрешено» — иначе два разных статуса выглядят одинаково.
2. **Разное время жизни = разные поверхности.** Permission-запрос не может стать карточкой доски (иначе доска начнёт показывать секундные события), а `ReviewState` не может стать модальным окном в потоке инструмента (иначе приёмка потеряет durable-привязку к SHA). Это прямое следствие §50: доска показывает *last valid* состояние, а не транзиентные вопросы.
3. **`escalated` обязан перестать быть тупиком.** Если ревью эскалируется человеку, карточка должна получить ссылку на `HumanDecision` и вернуться в `reviewing`/`changes-requested` после ответа. Сегодня `REVIEW_TERMINAL_STATES` (`review.ts:43-48`) это запрещает, и тест это фиксирует (`tests/review.test.mjs:193`: `assert.deepEqual([...contracts.REVIEW_TERMINAL_STATES], ['approved','rejected','escalated','cancelled'])`). Менять надо **явно**: либо добавить переход `escalated → reviewing` (тогда `escalated` перестаёт быть терминальным и тест придётся переписать — это осознанное изменение контракта, а не «тихая правка»), либо завести отдельный state `awaiting-human` перед `escalated`.

### 2.6. §46 (стр. 1260–1275) — Handoff Artifact и «unresolved questions»

**Статус: ПОДТВЕРЖДЕНО как направление, и это — единственный предусмотренный платформой канал для вопроса из child'а.**

Содержимое handoff из документа (`summary`, `changed files`, `assumptions`, **`unresolved questions`**, `evidence refs`, `next action`) ровно совпадает с тем, что DSH требует от child'а при `DELEGATED_CALLER`: текст ошибки говорит «*include the unresolved question or decision in the child agent's final result*» (`packages/interaction/user-questions/src/index.ts:103-105`). То есть поле `unresolved questions` — не украшение, а **обязательный носитель** для случая §28: другого пути у child'а нет.

Что в MyWork для этого уже есть:

- `Attempt`/review-артефакты: `review.findings` с `artifactRef` (`review.ts:59-64`), `ReviewedArtifact { headSha, diffHash }` (`:50-56`), домен `review.findings` с владельцами `['mywork-db','artifact-store']` (`authority.ts`, проверено `tests/authority.test.mjs:34,98-99`).
- `BlockerResolutionDecision.artifactId?: ArtifactId` (`workflow.ts:83-84`) — прецедент «решение ссылается на артефакт с деталями».
- Context Fabric с типом результата зависимости — упоминается в §46 и в отчётах (`MW-016-context-fabric.md`), код я не проверял.

Чего нет: **типизированного поля** «нерешённые вопросы» ни в attempt-результате, ни в handoff-артефакте. Проверял поиском `unresolved`, `handoff`, `Handoff` по `packages/*/src` в объёме грепа `attention|reason` — совпадений не нашёл; отдельный поиск по `handoff` я **не делал** (см. §5). Поэтому вывод осторожный: если handoff-артефакт в MyWork ещё не реализован (карточек под него в списке выполненных нет), то §46 надо дополнить требованием: **каждый `unresolved question` из handoff обязан создавать `HumanDecision`**, иначе вопрос из child'а осядет в тексте отчёта и человек его не увидит.

**Что это меняет:** §46 и §29 — не альтернативы, а две половины одного пути: handoff несёт вопрос из child'а наверх (в пределах возможностей платформы), `HumanDecision` делает вопрос durable и отвечаемым на доске.

### 2.7. §50 (стр. 1345–1361) — Board consistency и degraded mode

**Статус: ЧАСТИЧНО. Список состояний в документе смешивает два разных уровня, и один из них уже реализован точнее.**

Документ требует, чтобы `BoardReadService` умел сказать: `ready; degraded; reconciliation-pending; unavailable; recovery; paused`, показывая last valid data + stale/failure banner вместо пустой доски.

В MyWork есть два разных перечисления, и документ их слил:

1. **Состояние панели**: `BoardPanelState = 'loading'|'ready'|'empty'|'degraded'|'unavailable'|'recovery'|'paused'` (`packages/contracts/src/board.ts:141-166`), с явным комментарием: «The distinction that matters is `empty` versus `unavailable`: a healthy workspace with no tasks and a board whose controller never mounted must not look alike, or the user reads "no work" where the truth is "not connected"» (`:136-140`).
2. **Причина деградации**: `DegradedProjection.reason = 'adapter-unavailable'|'reconciliation-pending'|'partial-read'` + `detail`, `snapshotAt`, `staleZones` (`board.ts:299-314`).

Отсюда:

- `reconciliation-pending` в документе стоит **в одном ряду** с `ready`/`degraded`, хотя в MyWork это *причина* внутри `degraded`, а не альтернатива ему. Если сделать его отдельным panel state, придётся решать, что показывать при `partial-read` одновременно с `reconciliation-pending` — а это уже комбинация, а не перечисление. **Правка:** либо оставить `reason` как причину и не плодить состояния, либо перейти на `{ state, reasons[] }`.
- В списке документа **нет `loading` и `empty`** — то есть он неполон ровно там, где MyWork уже потратил комментарий на важное различие. Пустая доска ≠ недоступная доска.
- «last valid data + explicit stale/failure banner» уже выражено формально: `DegradedProjection.snapshotAt` (время снятия снимка) + `staleZones` (какие зоны не обновились). Документ этого не упоминает, а без `snapshotAt` баннер «stale» нечем обосновать.
- Ссылка документа на «Agent Teams projection с `failure` рядом с last valid state» как UX-precedent — проверяемая, но я её не проверял (см. §5).

**Связь с потоком E (важно):** `BoardPanelState 'paused'` («Admission is paused; the pause reason is shown», `board.ts:154-155`) — это **не** пауза из-за человека. В потоке E появляется третий случай: доска жива, задачи идут, но конкретная карточка **ждёт решения человека**. Его нельзя выражать через `paused` (это про admission целиком) и нельзя — через `degraded` (данные не устарели). Значит нужен отдельный признак на карточке/зоне: «внимание: ожидает человека», который читается из `HumanDecision` и `NeedsAttentionReason`, но не меняет `BoardPanelState`. Это прямое продолжение §6.2/§6.4 (default UI: Active / All / Needs attention / Archived).

---

## 3. Правки к плану MyWork

### 3.1. Куда встраивается durable-гейт: MW-030 (сущность и жизненный цикл) + MW-046 (доставка ответа) + MW-045 (приёмка по work type)

**Решение: базовая сущность, хранение, состояния, дедлайн/истечение и команда `task.resolve-attention` — в карточку `MW-030`.** Обоснование по фактам, а не по удобству:

- `MW-030` уже владеет тремя из четырёх половин: каталогом `NeedsAttentionReason` («Плюс каталог NeedsAttentionReason с детерминированными условиями и названным источником для каждого триггера», `.work/tasks/MW-030.md:17`), операционными гейтами («operation gates для миграций/security/release/production», там же) и autonomy L0–L3. Её приёмка уже требует «Каждый из семи триггеров needs-attention достижим тестом, проверяющим и состояние, и **точную причину**; ни один путь не ставит needs-attention без причины» и «**Human override аудируется**» (`.work/tasks/MW-030.md:20`). Без сущности-носителя эти два пункта нечем выполнить: `NeedsAttentionReason` сегодня объявлен, но не используется нигде (`packages/*/src`, см. §1 п.16), а «точную причину» негде хранить.
- `MW-030` — единственная карточка, чья зона ответственности прямо пересекается с человеком как решателем. Остальные кандидаты не годятся: `MW-024` — про независимый review результата (`.work/tasks/MW-024.md:17,20`), `MW-042` — про проекцию 16 состояний в 9 зон (`.work/tasks/MW-042.md:21`).
- **Оговорка:** `MW-030` в отчётах отсутствует — она **не выполнена** (нет `.work/reports/MW-030-*.md`, см. `00-ground-truth.md:67`). Значит это правка *невыполненной* карточки: расширение её «Объёма» и «Приёмки» до реализации, а не отдельная новая карточка. Если Lead решит, что объём MW-030 уже перегружен (там ещё pause/cancel/retry/reassign, L0–L3, `TaskClaims`, `PlanMutationClass`, `task.stop-and-cancel`), правильный ответ — **разрезать MW-030 на MW-030 (gate catalogue + HumanDecision) и MW-030b (pause/cancel/retry/reassign)**, а не прятать гейт в MW-046.

**Что уходит в `MW-046`:** доставка ответа в живую попытку и запись решения в обсуждение. `MW-046` уже владеет `DiscussionMessage (comment, decision, question, steer, system)`, типизированной командой `attempt.steer`, ссылкой на полную DSH-сессию и аудитом для решений (`.work/tasks/MW-046.md:18`), и её приёмка требует «`decision`-сообщение пишет строку audit» и «Повтор steer с тем же `operationId` даёт один эффект» (`:21`). Это ровно транспорт и идемпотентность ответа человека. Плюс `attempt.steer` — единственная санкционированная точка «направить активную попытку», а прямой записи в session store быть не должно (`:21`).

**Что уходит в `MW-045`:** `MW-045` владеет `contracts/src/worktype.ts` (`WorkType`, `FinishCriteria`, `FINISH_CRITERIA`, `resolveFinishCriteria`) по ADR028 (`.work/tasks/MW-045.md:15,18`). ADR028 (`DSH-My-Work-Architecture-v0.2-decisions.md:377+`) требует колонку **`human acceptance`**: «на интеграции» для `code`, **«да»** для `research`/`analysis`/`document`/`non-git-ops`, **«всегда»** для `manual`. Сегодня кода нет вообще: `WorkType|FinishCriteria|FINISH_CRITERIA_UNMET|humanAcceptance` — 0 совпадений по `packages`. Значит `FinishCriteria` обязан получить поле вида `humanAcceptance: 'never'|'on-integration'|'always'` и ссылку на `HumanDecision`, иначе `manual`-работа не сможет стать `done` по правилу ADR028 («Engine **отказывает** в `done`, пока обязательный evidence для work type отсутствует (`FINISH_CRITERIA_UNMET`)»). Это **четвёртая** карточка, затронутая потоком E, и её нельзя пропустить.

**Что уходит в UI-карточки (не мой поток, фиксирую как зависимость):** `MW-050`/`MW-053` (`06-ui`) — очередь внимания и различение трёх гейтов из §2.5.

### 3.2. Контракт: `HumanDecision` (переименование §29 «HumanGate»)

**Причина переименования:** `HumanGate` в `packages/contracts/src/security.ts:171` — это классификатор «что требует человека» (5 значений), уже используемый в `OperationRequest.gate` (`:280`). Сущность из §29 — «запрос к человеку с состоянием»; называть её тем же словом в том же пакете нельзя.

Новый файл: `packages/contracts/src/human-decision.ts` (аддитивно; `security.ts` не меняется). Предлагаемый контракт:

```ts
/** Кто именно отвечает: человек, роль или агент-делегат (см. 3.6). */
export type DecisionActor =
  | { readonly kind: 'human'; readonly humanId: string }
  | { readonly kind: 'role'; readonly roleId: RoleId }
  | { readonly kind: 'agent-on-behalf'; readonly agentId: AgentId; readonly onBehalfOf: string }

/** Состояния запроса к человеку. */
export type HumanDecisionState =
  | 'pending'      // открыт, ждёт ответа; пока открыт — задача в needs-attention
  | 'answered'     // терминальное: ответ принят и записан
  | 'expired'      // терминальное: дедлайн прошёл, ответа нет
  | 'cancelled'    // терминальное: запрос снят тем, кто его открыл (attempt/plan/lease)
  | 'superseded'   // терминальное: ревизия, к которой относился вопрос, перестала быть текущей

/** Почему спросили. Ровно один источник, чтобы причина была проверяемой. */
export type HumanDecisionTrigger =
  | { readonly kind: 'gate'; readonly gate: HumanGate }                        // security.ts:171
  | { readonly kind: 'attention'; readonly reason: NeedsAttentionReason }      // board.ts:356
  | { readonly kind: 'review-escalation'; readonly reviewId: ReviewId }        // review.ts:25
  | { readonly kind: 'work-acceptance'; readonly workType: WorkType }          // ADR028

/** Один открытый вопрос человеку; source of truth — MyWork DB. */
export interface HumanDecision {
  readonly id: HumanDecisionId          // branded, как ApprovalRequestId в DSH
  readonly workspaceId: WorkspaceId
  readonly taskId: TaskId
  readonly attemptId?: AttemptId        // привязка к попытке, если вопрос из неё
  readonly reviewId?: ReviewId          // привязка к ревью при эскалации
  readonly trigger: HumanDecisionTrigger
  readonly question: StructuredQuestion // см. 3.3
  readonly state: HumanDecisionState
  readonly deadlineAt?: EpochMs         // отсутствует = ждём бессрочно (осознанный выбор)
  readonly answer?: StructuredAnswer    // обязателен при state === 'answered'
  readonly answeredBy?: DecisionActor
  readonly answeredAt?: EpochMs
  readonly revision: Revision           // CAS: каждое принятое изменение +1
  readonly correlationId: CorrelationId
  readonly operationId?: string         // идемпотентность открытия
  readonly artifactId?: ArtifactId      // детали вопроса в Artifact Store (§34)
  readonly originState: TaskState        // фаза, из которой задача вошла в needs-attention
}
```

Ключевые отличия от §29 и их обоснование:

1. **`superseded` добавлен** (в §29 его нет). Ответ, пришедший после смены плана/попытки, не имеет права молча примениться к новому объекту — это тот же инвариант, который уже действует для review-одобрения: `isReviewApprovalCurrent` возвращает `false` при сдвиге `headSha`, а `assertReviewApprovalCurrent` даёт `STALE_REVISION` (`tests/review.test.mjs:162-182`). Без `superseded` «ответ после нового Attempt» — дыра.
2. **`originState` (TaskState) перенесён в сущность** — это и есть решение проблемы §6.2 «нет authoritative `originState`»: фаза запоминается в момент входа, а не угадывается при рендере. Документ предлагал для этого отдельную `AttentionState`; здесь он слит с запросом человека, потому что запрос человека — единственный триггер, для которого фаза действительно важна (остальные пять триггеров из `NEEDS_ATTENTION_REASONS` не возвращаются в исходную фазу).
3. **`trigger` — размеченное объединение, а не строка.** Так причина остаётся проверяемой и не даёт положить в поле произвольный текст (в отличие от `BoardPlacement.subState?: string`, `board.ts:210`).
4. **`answeredBy: DecisionActor`, а не `AgentId`.** У `Review.reviewerId` тип `AgentId` (`review.ts:74-75`) — то есть сегодня контракты не умеют отличить человека от агента-делегата. Для аудита человеческого решения («Human override аудируется», MW-030:20) этого мало. Прецедент более слабый, но полезный: `BlockerResolutionDecision.decidedBy: string` (`workflow.ts:91-92`) — просто строка, без типа.
5. **`revision` как CAS-ключ** — согласовано с общей конвенцией: «Aggregate revision; every accepted transition increments it» (`review.ts:78-79`, `task.ts:88-89`), и `assertRevision(4, 5) → STALE_REVISION` с деталями `{expected, actual}` (`tests/guards.test.mjs:58-66`).

### 3.3. `StructuredQuestion` / `StructuredAnswer`: совместимость с DSH, но без зависимости

Форма ответа должна уметь **и** то, что требует DSH-адаптер, **и** то, что нужно MyWork без DSH. Поэтому типы MyWork повторяют DSH-форму семантически, но объявляются в MyWork (`contracts/src/human-decision.ts`), а не импортируются:

```ts
export interface StructuredQuestion {
  readonly items: readonly QuestionItem[]   // ≥1; id уникален внутри вопроса
}
export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options?: readonly QuestionOption[]   // { label, description? }
  readonly multiSelect?: boolean
  readonly intent?: QuestionIntent               // { kind: 'plan-review'; approve: string; callId?: string }
}
export interface StructuredAnswer {
  readonly items: readonly AnswerItem[]          // ровно один на каждый QuestionItem.id
}
export interface AnswerItem {
  readonly id: string
  readonly selected: readonly string[]           // метки выбранных опций
  readonly custom?: string                       // свободный текст
}
```

Обоснование «повторить, а не импортировать»: DSH-типы лежат в `packages/interaction/user-questions/src/types.ts` (`AskUserQuestionItem` 36–51, `AskUserQuestionAnswerItem` 54–61, `AskUserQuestionAnswer` 64–67, `AskUserQuestionIntent` 22–33) и принадлежат клиентскому DSH-пакету. Прямой импорт нарушил бы границу пакетов MyWork (`tests/boundaries.test.mjs` — на `06-ui`/contracts запрещён импорт DSH, см. `.work/tasks/MW-042.md:21`: «падает при импорте bd, http, react или DSH из contracts/core»). Преобразование делает адаптер (DSH-сторона, `packages/adapter-sdk`), а `plan-review` с `approve` и `callId` переносится как есть — это ровно то, что DSH валидирует в `BAD_INTENT` (`user-questions/src/index.ts:115-129`), и MyWork обязан валидировать то же самое **до** вызова, иначе платформенная ошибка прилетит уже в tool call.

### 3.4. Хранение, CAS, идемпотентность, аудит

- **Хранение:** новая таблица `human_decisions` в MyWork DB (владелец — `mywork-db`), плюс индекс под выборку очереди внимания: `(workspaceId, state, deadlineAt)`. Ответ и вопрос хранятся как JSON-поле `payload` (форма зафиксирована `HUMAN_DECISION_FIELDS`, по образцу `AUDIT_ENTRY_FIELDS` в `audit.ts:88-89` — «Runtime data, so the store can refuse a row carrying a field it does not declare»). Крупные детали (полный план, длинный diff) — в Artifact Store через `artifactId` (по образцу `BlockerResolutionDecision.artifactId`, `workflow.ts:83-84`).
- **Authority:** новых строк в матрице **не нужно**. Домен `'approval.human'` существует с владельцами `['mywork-db','mywork-audit']` (`authority.ts:122`), тест это фиксирует (`tests/authority.test.mjs:35,100-101`). Запись самой сущности — `mywork-db`; запись аудита — `mywork-audit`. Любая попытка записать решение из другого стора обязана падать `SECURITY_DENIED` (механика: `assertWriteAuthority`, `tests/authority.test.mjs:104-124`).
- **CAS:** команда ответа несёт `expectedRevision`. Механика уже есть: `defineOperationMeta({ operationId, correlationId, expectedRevision, controllerEpoch })` (`tests/guards.test.mjs:15-39`), `assertRevision` → `STALE_REVISION` (`:58-66`), `assertFence` → `STALE_FENCE`, `assertControllerEpoch` → `LEASE_LOST` (`:68-82`). Для гейта, переживающего failover контроллера, нужен ещё и `controllerEpoch`: иначе после смены контроллера старый UI может записать ответ по «своей» ревизии.
- **Идемпотентность ответа:** `operationId` в команде; повтор с тем же `operationId` **не** создаёт второй ответ и вторую строку аудита, а возвращает тот же результат. Если тот же `operationId` приходит с другой полезной нагрузкой — типизированная ошибка `OPERATION_ID_REUSED` (молчаливое принятие «другого ответа под тем же id» запрещено). Прецедент требования уже сформулирован в приёмке MW-046: «Повтор steer с тем же operationId даёт один эффект» (`.work/tasks/MW-046.md:21`).
- **Аудит:** два типа, оба уже существуют в каталоге — `'gate.decided'` («A typed gate was decided by a human or an admitted policy», `audit.ts:53-54`) для закрытия гейта и `'human.override'` (`audit.ts:50`) в случае, когда человек отменяет автоматическое решение (например, снимает автоматический отказ при исчерпанном бюджете). Открытие гейта тоже должно быть аудируемо — предлагаю добавить `'gate.asked'` симметрично паре `approval/asked`+`approval/decided` в DSH (`user-approval/src/types.ts:44-58`): одна пара «спросили — решили» на одно решение, с общим id. **Это правка `audit.ts` (аддитивно, `AUDIT_EVENT_TYPES` расширяется; ни одно сохранённое значение не переинтерпретируется).**
- **Доставка ответа:** три случая, и они не должны смешиваться (это ответ на вопрос 4 брифинга «resume/new Attempt»):
  1. `attemptId` указан и попытка **жива** → ответ уходит через типизированную команду `attempt.steer` (MW-046) в её сессию; на стороне DSH это `agent.steer(UserMessage)` (`packages/core/agent/src/runtime-types.ts:231`) или `agent.inject(...)` (`:241`). Прямая запись в session store запрещена (приёмка MW-046:21).
  2. `attemptId` отсутствует, задача в `needs-attention` → ответ — вход в **admission**: задача переходит `needs-attention → ready` (существующее ребро, `core/src/task.ts:63`), и решение уезжает в контекст следующей попытки как обычный вход (Context Fabric).
  3. Ревизия/план/попытка сменились → ответ **не применяется**: `GATE_SUPERSEDED`, гейт → `superseded`, открывается **новый** `HumanDecision` против новой ревизии. Никакого автоматического переноса ответа между ревизиями — тот же принцип, что и у review-одобрения.
- **Ошибка, а не молчание:** «ответ пришёл после отмены» → `GATE_CANCELLED`; «ответ пришёл после истечения» → `GATE_EXPIRED` (но ответ **сохраняется** в аудите и не теряется — человек потратил время, и его решение должно быть видно; это отдельная строка аудита `'human.override'` либо отказ с причиной, выбор фиксируется в ADR); «ответ уже есть» → `GATE_ALREADY_ANSWERED` с текущим `revision` и `answeredBy` в деталях (чтобы UI показал, кто и когда ответил, а не «ошибка неизвестна»).

### 3.5. Как `HumanDecision` соотносится с `needs-attention`/`NeedsAttentionReason` и с projector-логикой

Это ответ на вопрос 5 брифинга, и он состоит из трёх разных утверждений.

1. **Связь «причина ↔ гейт» должна быть взаимно однозначной.** `NeedsAttentionReason` содержит ровно **семь** триггеров (`board.ts:373-381`): `reconciliation-divergence`, `adapter-unavailable-with-live-attempt`, `budget-exhausted`, `human-gate-deadline-exceeded`, `retry-budget-exhausted`, `dependency-unresolvable-after-void`, `lease-lost-without-successor`. Из них только один — про человека (`human-gate-deadline-exceeded`). Но в §29-модели человек нужен **до** истечения дедлайна: гейт открывается *сразу* (release/migration/production/review-escalation/work-acceptance), и задача входит в `needs-attention` без всякого дедлайна. Значит **одного `NeedsAttentionReason` недостаточно**: нужен новый триггер, например `'human-decision-pending'`, иначе «ждём человека» будет неотличимо от «человек не ответил вовремя» — а это разные UI-состояния (первое — норма, второе — нарушение SLA). Правка: расширить `NEEDS_ATTENTION_REASONS` аддитивно и записать в MW-030, что «семь триггеров» из её приёмки превращаются в восемь.
2. **`originState` мешает не отсутствие поля, а отсутствие носителя в проекции.** Сегодня `BoardPlacement` (`board.ts:197-225`) не имеет ни `reason`, ни `originState`; единственная свободная щель — `subState?: string` (`:210`), документированная как «Finer state behind the zone (attempt, review, or idea state)». Чтобы фазосохраняющий UX стал возможен, проекция должна нести `{ originState, reason }` **типизированно**, а не строкой. Это правка не «домена», а **board-проекции** (MW-042 / MW-050): `BoardPlacement` расширяется аддитивно (`attention?: { reason: NeedsAttentionReason; originState: TaskState; decisionId?: HumanDecisionId }`), и тогда `ZONE_BY_STATE` можно **не** менять: зона остаётся `blocked` (как сейчас, `:118`), а фаза показывается чипом/бейджем из `originState`. Так §6.2 выполняется **без** смены маппинга зон и без слома `legalDropTargets`/drag-and-drop. Это, на мой взгляд, лучше рекомендации документа: меньше мутаций, тот же UX.
3. **Что мешает прямо сейчас.** Перечислю конкретно: (а) `NeedsAttentionReason` не используется нигде — нет носителя; (б) `BoardPlacement.subState` — неструктурированная строка; (в) `Task` не имеет ни `reason`, ни `originState` (`task.ts:75-107`); (г) `Review.escalated` терминален и не имеет ссылки на решение (`review.ts:43-48`); (д) в `events.ts` нет событий с причиной внимания — сейчас причина не переживает даже событийную ленту; (е) `CardCommand 'task.resolve-attention'` объявлен, но не реализован — то есть у UI нет команды, которой отвечать. Пункты (а)–(д) закрываются MW-030, пункт (е) — MW-030 + MW-046.

### 3.6. Что рассмотрено как «не рассмотрено» в документе (ответ на вопрос 6 брифинга)

Каждый пункт — либо конкретное решение, либо честное «нужен ADR».

1. **SLA и эскалации.** `deadlineAt` в §29 есть, но нет ни политики (кто задаёт дедлайн, одинаков ли он для release и для вопроса из worker'а), ни второго адресата («прошло 50 % — напомнить, 100 % — эскалировать другому»). Предлагаю минимум: дедлайн задаётся **триггером** (таблица `HumanDecisionTrigger → SLA`), а не вызывающим; истечение всегда даёт `needs-attention` с `human-gate-deadline-exceeded` (триггер уже есть, `board.ts:364`), но **не** авторешение. Авто-решение по таймауту (например, «нет ответа = отказ») — опасная политика, и её нельзя вводить по умолчанию: в DSH аналог называется fail-closed и реализован как `unavailable` (`user-approval/src/types.ts:30-32`), но там это отказ *выполнить*, а не *решение по домену*. Рекомендую: `defaultOnExpiry: 'block'` (единственное значение в v0.2).
2. **Уведомления вне GUI.** В DSH **нет** OS/desktop-примитива: каталог `packages` не содержит ни одного пакета с `notif|desktop|toast|alert|push` в имени, а все найденные `Notification`/`notify` — это (а) ACP-транспорт `session.update` для редакторов (`packages/acp/acp/src/index.ts:125-127`), (б) SDK-protocol (`packages/sdk/protocol/src/types.ts:107-111`), (в) клиентские тосты `notify(level, text)` (`packages/client/ui-conversation/src/client/contract/input.ts:199`), (г) in-process уведомление авторизации `AuthorizationInteraction.notify` (`packages/credentials/authorization/src/index.ts:106,156`). Вывод: **вне GUI уведомлений нет**; единственный работающий канал, пока вкладка открыта, — клиентский тост; для закрытой вкладки нужен внешний канал (почта/мессенджер/webhook), и это отдельное решение, которого в документе нет. Для v0.2 минимум: считать `HumanDecision` видимым только при открытом GUI, а в UI — счётчик «ожидает человека» в шапке.
3. **Пакетные подтверждения.** Ни `ApprovalService`, ни `UserQuestionService` не поддерживают групповой ответ: `ask()` принимает `questions: AskUserQuestionItem[]` и возвращает один батч ответов **в рамках одного вызова** (`user-questions/src/types.ts:70-77`, `64-67`), но это «несколько вопросов одного действия», а не «одно решение для N задач». Для доски пакетный ответ нужен (20 карточек с `human-gate-deadline-exceeded`). Предлагаю: пакетный ответ — это **N отдельных `HumanDecision`**, закрываемых одной командой с общим `operationId` и общим `reason`; в данных остаётся N решений (аудит по каждому), в UI — одна кнопка. Не «одно решение на N объектов».
4. **Делегирование права ответа другому человеку/агенту.** В §29 нет `answeredBy`. В DSH аналог — `ApprovalOutcome 'allowed-once'` (одноразово, `types.ts:30-32`) и `approval/policy` per-session (`user-approval/src/index.ts:40-44`), но это про *политику*, а не про делегирование права. Решение: `DecisionActor` (см. 3.2) + явное правило «право ответа = членство в роли, записанное в момент открытия гейта» (иначе после смены команды ответит тот, кого не было в команде, когда спрашивали). Агенту отвечать **нельзя** по умолчанию: иначе `HumanDecision` вырождается в самоподтверждение, а MyWork уже запрещает self-review (`tests/review.test.mjs:64-77`).
5. **Тайм-аут и авто-решение.** См. п.1: `defaultOnExpiry: 'block'`. Отдельно: не путать с bloc `'never'` в DSH (`user-approval/src/index.ts:62-67`) — там отказ детерминирован *по политике*, а не по времени.
6. **«Тихие часы».** Требуют хранения календаря/таймзоны человека; в DSH есть IANA-таймзоны только в Schedule (§30 документа, не проверял код). Для v0.2: не вводить, но `deadlineAt` хранить абсолютным `EpochMs` (тип уже есть, `contracts/src/ids.ts`), чтобы политика «тихих часов» позже не потребовала миграции данных.
7. **Аудит человеческих решений.** Инфраструктура есть (`approval.human`, `gate.decided`, `human.override`), но аудит-строка сегодня не несёт **кто** — `AuditEventType` (`audit.ts:30-62`) типизирует только вид события, а поля строки — `AUDIT_ENTRY_FIELDS` (`:88-89`), которые я не читал целиком (см. §5). Поэтому утверждать «аудит покроет человеческое решение» нельзя, пока не проверено, есть ли в строке actor. Это задача MW-030.
8. **Одновременные ответы из двух поверхностей.** В DSH такой конфликт решён: «Aborting withdraws the question: the request settles `'cancelled'` immediately and **a late answer from a still-pending answerer is discarded**» (`user-approval/src/index.ts:127-131`), а waterfall «settles once». Для MyWork ответ приходит не через waterfall, а командой в БД, поэтому нужен CAS (`expectedRevision`) и правило «первый принятый ответ побеждает, второй получает `GATE_ALREADY_ANSWERED` с указанием победителя». Это надёжнее, чем «последний побеждает», и совпадает с идемпотентностью по `operationId`.
9. **Что происходит с worker-сессией, пока гейт открыт — не держим ли tool call.** Вот главный риск, и он **подтверждён кодом**: `ask_user_question` в `execute` вызывает `await ctx.userQuestions.ask({...})` (`tool-ask-user/src/index.ts:80-90`), а `ask()` внутри просто ждёт waterfall (`user-questions/src/index.ts:134-142`) — **без таймаута**, и в схеме инструмента нет параметра `timeout` (`:22-56`). То есть пока человек не ответит, tool call висит, а с ним — шаг агента. Откаченный commit пытался это починить (`askTimed` + `attachWait` + pending-результат), и note прямо формулирует проблему: «A question can block an agent even when useful work does not depend on the answer» (note:9-11). Следствие для MyWork: **durable-гейт обязан освобождать worker-сессию**. Правильная схема: гейт открывается *вне* tool call (попытка не «спрашивает», а завершает шаг с результатом «ждём решения»), а ответ приходит позже — через `attempt.steer` в живую сессию или в контекст следующей попытки. Использовать блокирующий `ask()` из worker-сессии нельзя: это (а) удерживает шаг, (б) при `DELEGATED_CALLER` вообще невозможно, (в) при restart рантайма теряется. Блокирующий `ask()` допустим **только** как live-adapter в root-сессии (например, когда контроллер сам ведёт диалог с человеком) — и именно так формулирует §29 («DSH blocking `userQuestions.ask()` может быть live adapter для root interaction, но source of truth — MyWork»).

### 3.7. Минимальная реализация без UI (что должно быть в MW-030, чтобы это можно было проверить)

1. `packages/contracts/src/human-decision.ts`: `HumanDecision`, `HumanDecisionState` + `HUMAN_DECISION_STATES`, `HumanDecisionTrigger`, `DecisionActor`, `StructuredQuestion`/`StructuredAnswer`, `humanDecisionFields`. Плюс аддитивно: `'human-decision-pending'` в `NEEDS_ATTENTION_REASONS` (`board.ts`), `'gate.asked'` в `AUDIT_EVENT_TYPES` (`audit.ts`), `attention?` в `BoardPlacement` (`board.ts`).
2. `packages/core/src/human-decision.ts` — **чистые функции, без стора** (по образцу `core/src/blocker.ts`): `openHumanDecision(input)`, `answerHumanDecision(decision, command, meta)` (проверяет state, revision, дедлайн, возвращает `Result`), `expireHumanDecisions(decisions, nowEpochMs)`, `pendingHumanDecisions(decisions, filter)`, `humanDecisionOfTask(decisions, taskId)`. Все — тотальные, с `assertRevision`/`assertFence` из `core/src/guards.ts`.
3. `packages/storage`: миграция «human_decisions» (аддитивная, только CREATE TABLE + INDEX).
4. Маппинг `CardCommand 'task.resolve-attention'` → `answerHumanDecision` + `attempt.steer` (MW-046) и запись аудита.
5. Тесты (минимум 9): истечение без ответа даёт `needs-attention` + `human-gate-deadline-exceeded`; ответ после истечения → `GATE_EXPIRED`; ответ после отмены → `GATE_CANCELLED`; ответ после смены ревизии → `GATE_SUPERSEDED` и новый гейт; повтор с тем же `operationId` — один эффект и одна строка аудита; другой `operationId` при уже отвеченном → `GATE_ALREADY_ANSWERED`; stale `expectedRevision` → `STALE_REVISION`; stale controller epoch → `LEASE_LOST`; запись решения не-владельцем → `SECURITY_DENIED`.
6. **Без UI это проверяемо полностью**: все девять тестов — на `node --test` с `tests/lib/fixtures.mjs`, без HTTP и без клиента.

---

## 4. Новое, чего не было в документе и в плане

Оценки: **S/M/L** — усилие; «влияние» — насколько меняет корректность плана; «риск» — риск ошибиться/сломать.

**N-1. Имя `HumanGate` занято — §29 нельзя реализовать буквально. (S, влияние высокое, риск низкий)**
`HumanGate` = 5 классов операций (`security.ts:171-190`), используется в `OperationRequest.gate` (`:280`) и `DOMAIN_IMPLIED_GATES` (`:193-195`). Документ предлагает этим словом назвать сущность-запрос. Это не стилистика: если карточка MW-030 «добавит HumanGate» как §29, в одном пакете окажутся два экспорта с именем `HumanGate` либо один перезапишет другой при `export *` (`packages/contracts/src/index.ts:76-87` экспортирует `security.ts` и `workflow.ts` звёздочкой). Проверяемо: компиляция + grep на два объявления.

**N-2. `ReviewState 'escalated'` — терминальный тупик без адресата. (M, влияние высокое, риск средний)**
`escalated` = «Terminal: the review was escalated to a human» (`review.ts:25-26`), входит в `REVIEW_TERMINAL_STATES` (`:43-48`), и тест утверждает отсутствие исходящих рёбер (`tests/review.test.mjs:192-202`). Значит «эскалировали человеку» = «встали навсегда»: ни записи, кому, ни способа вернуться. Ни документ, ни план этого не замечают. Правка: `escalated` получает `decisionId: HumanDecisionId`, а состояние перестаёт быть терминальным (осознанное изменение контракта + переписывание теста) либо вводится `awaiting-human` перед `escalated`. Проверяется тестом «escalated review resumes after a human answers».

**N-3. `NeedsAttentionReason` объявлен и не используется — «мёртвый каталог». (S, влияние высокое, риск низкий)**
Тип и каталог есть (`board.ts:356,373-381`), включая `human-gate-deadline-exceeded` (`:364,377`), но по `packages/contracts/src` и `packages/core/src` нет ни одного использования (3 совпадения шаблона — все в `board.ts`: `:210` `subState`, `:356`, `:373`), и в `events.ts` нет ни `attention`, ни `reason`. Приёмка MW-030 («точную причину» для каждого триггера, `MW-030.md:20`) сегодня невыполнима. Проверяется `Select-String` по `packages/contracts/src,packages/core/src`.

**N-4. Один и тот же триггер объясняет два разных состояния. (S, влияние среднее, риск низкий)**
`human-gate-deadline-exceeded` описывает **истечение** дедлайна, но не описывает **нормальное** ожидание ответа. Без нового триггера (предлагаю `human-decision-pending`) UI не отличит «всё идёт по плану, человек думает» от «человек пропустил SLA». Это меняет счётчик «семь триггеров» в приёмке MW-030 на восемь.

**N-5. `AttemptState` не имеет состояния «ждёт человека», и это правильно — но тогда привязка гейта к попытке неполна. (M, влияние среднее, риск средний)**
Состояния попытки: `created, leased, starting, running, settling, completed, failed, timed-out, cancelled, revoked, stale` (`attempt.ts:21-42`). Ни `paused`, ни `awaiting-human`. Значит «pause не теряет работу» из приёмки MW-030 (`MW-030.md:20`) реализуется **не** состоянием попытки, а чем-то другим — и в плане это нигде не сказано. Вывод: пауза из-за человека должна выражаться через `HumanDecision` + `TaskState 'needs-attention'`, а живая попытка либо продолжается, либо корректно завершается и переоткрывается как новая. Это разные сценарии с разной ценой, и их надо назвать в MW-030 явно.

**N-6. `ApprovalService` уже даёт почти весь контракт durable-гейта, кроме durability. (M, влияние высокое, риск низкий)**
В DSH: `ApprovalRequestId` на каждый запрос, аудит-пара `approval/asked` + `approval/decided`, ровно один `decided` на `asked`, fail-closed `unavailable`, `cancelled` при abort с выбрасыванием позднего ответа (`user-approval/src/types.ts:17,28-32,44-58`; `src/index.ts:215-234,127-131`). Не хватает ровно двух вещей: состояние переживает только как аудит (нет «открытых» запросов) и запрос обязан жить внутри открытого turn (`src/index.ts:217-223`, с объяснением: «a bare event between turns is crash-tail garbage on reload»). Это **готовый образец** для MyWork-гейта: та же пара «asked/decided», тот же единственный ответ, тот же fail-closed; отличие — MyWork хранит открытый запрос как сущность, а не как половину аудита, и не требует открытого turn.

**N-7. Auto Review — это не только «второе мнение», это скрытая смена sandbox. (S, влияние среднее, риск средний)**
Auto preset = Full access + `ask` (`permission-presets/src/index.ts:89-91`). То есть включение Auto Review человеком означает согласие на полный доступ к файлам при «разрешённых» вызовах, и риск-диалог (`auto-review/README.md:36`) — единственное место, где это подтверждается. Для UI-различения из §32 это важно: «разрешение на действие» в режиме Auto — это не «спросили и разрешили один раз», а «модель-ревьюер разрешила, и потому доступ был Full». Одинаковая визуализация обоих случаев вводит пользователя в заблуждение.

**N-8. Auto Review выключен по умолчанию, поэтому §32 в части «UI обязан различать» — про будущее, а не про сегодня. (S, влияние низкое, риск низкий)**
«The dsh installation ships this layer switched off; default Web keeps its three permission modes until it is switched on» (`auto-review/README.md:12,115`). В текущем профиле (по ground truth §4) `experimental/auto-review` в списке включённых не значится. Значит §32 нельзя использовать как обоснование срочности; правильная формулировка — «подготовить различение заранее, потому что при включении Auto статусы станут неразличимы».

**N-9. Единственный сегодня существующий «человеческий гейт» в MyWork — `BlockerResolutionGate`, и он же — готовый шаблон. (S, влияние среднее, риск низкий)**
`BlockerResolutionGate` (`workflow.ts:99-125`) уже разделяет **производное** состояние гейта (`open`, `awaitingDecision`) и **сохраняемое** решение (`BlockerResolutionDecision`), с `awaitingDecision` = «a human has not yet answered it» (`:118-122`). Плюс там уже принято спорное решение, которое стоит переиспользовать: гейт **отказывается** называться `HumanGate`, чтобы не смешивать уровни (`:103-105`). Это ровно тот аргумент, который нужен против имени из §29.

**N-10. `decidedBy: string` — существующий долг, который HumanGate обязан не унаследовать. (S, влияние среднее, риск низкий)**
`BlockerResolutionDecision.decidedBy` (`workflow.ts:91-92`) — просто строка; `Review.reviewerId` — `AgentId` (`review.ts:74-75`). Ни один контракт не умеет отличить человека от агента-делегата. Если §29 скопирует `decidedBy: string`, аудит человеческих решений (MW-030:20) останется непроверяемым. Нужен `DecisionActor` (см. 3.2).

**N-11. `workflow.ts` документирует «ADR028 §5.18» как источник `gate.decided`, а ADR028 в MyWork — про work type, не про гейты. (S, влияние низкое, риск низкий)**
`workflow.ts:1-10` и `audit.ts:53` ссылаются на «ADR028 §5.18», но ADR028 в `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377` — «Work-type-specific finish criteria». Ссылка не подтверждена; скорее всего она указывает на §5.18 архитектуры v0.1, а не на ADR. Это ссылочный дефект, который стоит поправить в MW-030, чтобы «typed gate decided by human or admitted policy» не осталось без нормативного источника.

**N-12. Пакетный ответ физически возможен только как N решений с общим `operationId`. (S, влияние среднее, риск низкий)**
Ни DSH `ask()` (батч только внутри одного вызова, `user-questions/src/types.ts:64-77`), ни watermark-подобной группировки в MyWork нет. Поэтому «подтвердить 20 карточек» = 20 строк решений + 1 команда. Это важно для аудита: групповое «ок» не должно превращаться в одну неразборчивую запись.

**N-13. Блокирующий tool call — единственный сегодня работающий способ спросить человека, и он же главный риск. (M, влияние высокое, риск низкий)**
`tool-ask-user` ждёт `ask()` внутри `execute` (`tool-ask-user/src/index.ts:80-90`), `ask()` не имеет таймаута (`user-questions/src/index.ts:134-142`), в схеме инструмента нет `timeout` (`:22-56`). Откаченный коммит — историческое доказательство, что это признавалось проблемой: `askTimed` возвращал `{ pending: true, callId }`, чтобы отпустить шаг, а поздний ответ шёл через `@Remote answer()`. Для MyWork вывод жёсткий: гейт обязан открываться **вне** tool call, иначе он (а) держит шаг, (б) несовместим с `DELEGATED_CALLER`, (в) не переживает restart рантайма.

**N-14. Вне GUI уведомлений нет вообще — это ограничение платформы, а не пробел реализации. (M, влияние среднее, риск низкий)**
Ни одного пакета с `notif|desktop|toast|alert|push` в имени; все `notify` — транспорт ACP (`acp/acp/src/index.ts:125-127`), SDK-protocol (`sdk/protocol/src/types.ts:107-111`), клиентский тост (`ui-conversation/.../contract/input.ts:199`), in-process уведомление авторизации (`credentials/authorization/src/index.ts:106`). Значит SLA «ответить за 4 часа» без открытого GUI неисполним в принципе; в v0.2 это надо признать явно, а не обещать в UI-требованиях.

**N-15. Дедупликация ответа должна быть на `operationId`, а не на «уже отвечено». (S, влияние среднее, риск средний)**
Если проверять только `state === 'pending'`, то повторная доставка того же ответа (retry HTTP, двойной клик, переподключение Remote-клиента) даст `GATE_ALREADY_ANSWERED` — то есть пользователь увидит ошибку там, где всё в порядке. Правильный порядок проверок: (1) тот же `operationId` → вернуть прежний результат; (2) другой `operationId` и `state !== 'pending'` → типизированная ошибка с указанием, кто ответил раньше. Прецедент требования — «Повтор steer с тем же operationId даёт один эффект» (`MW-046.md:21`), но там не сказано, что делать при **разных** `operationId` на уже закрытом объекте; этот пробел стоит закрыть в MW-030.

---

## 5. Открытые вопросы и что я НЕ проверял

**Вопросы к Lead (не блокирующие):**

1. **Создаёт ли MyWork worker-сессии как DSH runtime root?** От этого зависит, применим ли `ask()` из worker'а вообще. Проверял только абстракцию: `core/src/session.ts:152` объявляет `createSession(subject)`, `:917` вызывает её, `:841-865` — ошибка `session-create-failed`. Реализация адаптера (MW-015) в отчётах есть, но я её не читал, и признак «root/child» (`owner` в реестре агентов DSH) в этой абстракции не виден. **Если worker — child, то §28 не «логичен для MyWork», а обязателен, и единственный путь — handoff (§46) + durable-гейт.**
2. **Есть ли в `HumanGate` из `security.ts` уже реализованный путь отказа?** Комментарий говорит «The gate below never approves one of these on its own: it refuses them» (`security.ts:165-170`), но где именно «the gate below» — я не искал. `packages/core/src/security.ts` существует; его обработку `gate` я **не проверял**.
3. **Резолвится ли `HumanDecision` в ту же карточку MW-030 или её надо резать?** Аргументы в 3.1; решение за Lead (риск: MW-030 и без того перегружена).
4. **Нужен ли `gate.asked` в аудите, или достаточно `gate.decided`+`human.override`?** Это аддитивное изменение каталога `AUDIT_EVENT_TYPES`; в DSH аналоге пара есть, в MyWork — только половина.

**Что я НЕ проверял (явно):**

- **Не запускал ни одного теста.** Ни `node --test` в MyWork (27 файлов, ~19 700 строк), ни `vitest` в DSH. Все утверждения о поведении — по чтению исходников; утверждения о тестах — по чтению текста тестов, а не по их прогону.
- **Не проверял GUI.** Кликнуть «Отклонить» в approval-карточке, посмотреть, как выглядит `ask_user_question` в UI, увидеть Auto Review на экране — не делал. Поэтому §32 про «UI обязан различать» — это проектирование, а не наблюдение.
- **Не проверял реализацию `approval/request` на клиенте.** Кто именно отвечает на waterfall в Web (пакет `ui-permission-presets`? `ui-conversation`?), и как выглядит отказ — не смотрел.
- **Не проверял `ui-user-questions` в текущем HEAD** (README/`src/client/index.ts`) — только `package.json` в объёме `git show --stat` и упоминания в revert-diff'ах. То есть как сегодня выглядит карточка вопроса — не знаю.
- **Не читал `AUDIT_ENTRY_FIELDS` целиком** (`audit.ts:88-89` — только начало) и не проверял, несёт ли строка аудита «кто». Поэтому п.7 в 3.6 — вопрос, а не вывод.
- **Не проверял Context Fabric** (§46: `dependency-result`), карточку MW-016 и её отчёт: есть ли там типизированное поле «нерешённые вопросы».
- **Не делал отдельный поиск по `handoff|Handoff|unresolved`** — только внутри более широкого grep'а. Поэтому вывод «типизированного поля нет» в 2.6 — осторожный.
- **Не проверял Agent Teams projection с `failure`** (UX-precedent из §50, стр. 1360) — ни код, ни поведение.
- **Не проверял DSH Schedule** (§30/§31 документа) — вне моей зоны, кроме упоминания IANA-таймзон в 3.6 п.6 (это ссылка на документ, а не на код).
- **Не проверял storage-слой MyWork** (`packages/storage`, 13 файлов, 4 156 строк) — как именно делаются миграции и есть ли готовый паттерн аддитивной таблицы. Предложение в 3.7 п.3 основано на общем описании из ground truth, а не на чтении кода.
- **Не проверял, существует ли `WorkType` где-либо вне `packages`** (например, в `.work/architecture` есть лишь таблица ADR028). Grep был по `packages` и `.work/tasks`.
- **Не читал `.work/reports/MW-007-security.md` и `MW-008-evidence-audit.md`** целиком — хотя там 3 и 0 упоминаний гейтов/эскалаций соответственно (по группировке `Select-String`), то есть возможно уже принято решение про `approval.human`.
- **Не проверял живую доску-плагин** (revision 324, 52 карточки) и её `permissionPending`-гейт — это отдельный authority, и в моей зоне он только как пример «гейт подтверждения прав не пройден» (ground truth §3).

**Чего я сознательно не делал:** не правил ни одного файла кроме своего отчёта; не запускал `task_board_*`, `ask_user_question`, `spawn_teammate`; не коммитил; не мутировал дерево (git worktree для проверок не понадобился — всё чтение уложилось в `git show`/`git log`).

---

## 6. CLAIMS

Формат: `ID | утверждение | доказательство | статус`. Все пути DSH — от `C:\Reposit\deepseek-harness\deepseek-harness`, MyWork — от `H:\Repo\DSH-MyWork`; checkout DSH на `c7c4c725`, MyWork на `0c657ae1`.

| ID | Утверждение | Доказательство | Статус |
|---|---|---|---|
| E-01 | Публичный API `UserQuestionService` в rc.2 — ровно один метод `ask(request)` | `read` `packages/interaction/user-questions/src/index.ts` целиком (154 строки); метод на строке 86, класс 65–152, метод один | verified |
| E-02 | `ask()` бросает `EMPTY_QUESTIONS` при пустом списке вопросов | `packages/interaction/user-questions/src/index.ts:90-92` | verified |
| E-03 | `ask()` бросает `CALLER_NOT_LIVE`, если переданный агент не тот же живой инстанс в реестре | `packages/interaction/user-questions/src/index.ts:96-100` (`agents.get(agent.id) !== agent`) | verified |
| E-04 | `ask()` бросает `DELEGATED_CALLER`, если живой агент не входит в `agents.roots()` | `packages/interaction/user-questions/src/index.ts:101-106` | verified |
| E-05 | «Root» — это живой агент без владельца в рантайме (`entry.owner === undefined`), а не сессия без lineage | `packages/core/agent/src/index.ts:590-600` (JSDoc: «durable session lineage does not affect this runtime relation») | verified |
| E-06 | `DELEGATED_CALLER` — структурированная ошибка: `UserQuestionError extends HarnessError`, тест ожидает `{ name: 'UserQuestionError', code: 'DELEGATED_CALLER' }` | `packages/interaction/user-questions/src/index.ts:34-39`; `packages/interaction/tool-ask-user/tests/tool-ask-user.spec.ts:270,294` | verified |
| E-07 | В текущих `.ts`-исходниках нет `askTimed`, `TimedQuestionWait`, `ASK_TIMED_OUT`, `attachWait`, `user-question-reply` | `grep` по checkout (шаблон из 7 альтернатив) дал 10 совпадений, все — `DELEGATED_CALLER`/`CALLER_NOT_LIVE` в `src/index.ts:82,83,99,105`, тестах и `tool-cordis/src/api-catalog.ts:3360` | verified |
| E-08 | В каталоге `packages/interaction/user-questions/src` остались только `index.ts` и `types.ts` | `Get-ChildItem …\src -File` → 2 файла (5960 и 3587 байт) | verified |
| E-09 | Коммит `bb19061473` добавил `src/projection.ts` (330 строк) и `src/timed-wait.ts` (83 строки) | `git show --stat bb19061473` (exit 0) | verified |
| E-10 | Коммит `32905d5ab5` откатил merge-PR #4868 (`a64eaf0b5e`, ветка `reconciled-pr4839-ux-evidence`), а не отдельный feature-коммит | `git show --stat 32905d5ab5`; `git log --all --oneline --grep="reconcile timed questions"` → `1afcc03ff9` (merge PR #5174 `revert-4868-…`), `32905d5ab5`, `a64eaf0b5e` (exit 0) | verified |
| E-11 | Откат снял `askTimed`, `@Remote answer()`, `@Remote({mode:'stream'}) attachWait`, `TimedUserQuestionResult` и ошибки `BAD_TIMEOUT`/`DUPLICATE_WAIT`/`ASK_TIMED_OUT`/`BAD_ANSWER` | `git show 32905d5ab5 --format='' -- packages/interaction/user-questions/src/index.ts` (diff прочитан) | verified |
| E-12 | Откат снял типы `UserQuestionState`, `PendingUserQuestion`, `SettledUserQuestion`, `UserQuestionProjectionView`, `MessageSourceMap['user-question-reply']`, `SessionProjectionMap.userQuestions` и поле `request.wait` | `git show 32905d5ab5 --format='' -- packages/interaction/user-questions/src/types.ts` | verified |
| E-13 | Откат вернул базовый класс `Service` вместо `TypertRemoteService` и инлайнил `assertLiveRoot` обратно в `ask()` | тот же diff по `src/index.ts` (hunk `-export class UserQuestionService extends TypertRemoteService` → `+… extends Service`; `-if (agent !== undefined) this.assertLiveRoot(agent)` → `+if (agent !== undefined) { … }`) | verified |
| E-14 | Note о двух settlements существует в HEAD, имеет `Status: proposed` и описывает `askTimed`/`attachWait`/`answer()`, которых в коде нет | `read` `.agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md` (113 строк; строки 3, 19–22, 39–45, 49–51) | verified |
| E-15 | Note вернулся из `implemented/` в `proposed/` при откате | `git ls-tree -r --name-only 32905d5ab5^ \| Select-String timed-user-question` → `implemented/…`; то же для `HEAD` → `proposed/…` (exit 0) | verified |
| E-16 | Документация `docs/subsystems/user-questions.md` согласована с откатом: только `ask()` и ошибки `EMPTY_QUESTIONS/NO_PROVIDER/ASK_ABORTED` | `read` `docs/subsystems/user-questions.md` (180 строк; сигнатура 151, ошибки 108) | verified |
| E-17 | Инструмент `ask_user_question` держит tool call открытым до ответа человека и не имеет параметра таймаута | `read` `packages/interaction/tool-ask-user/src/index.ts:22-56` (схема), `:79-98` (`await ctx.userQuestions.ask(...)` внутри `execute`) | verified |
| E-18 | Auto Review — per-call политика: ревьюер на модели текущей сессии оценивает вызов до его тела; allow исполняет с Full access | `read` `packages/experimental/auto-review/README.md:12,87`; политика `REVIEW_POLICY` — `src/index.ts:40-61` | verified |
| E-19 | Auto Review при отказе спрашивает пользователя: `askUser()` возвращает `{kind:'ask', reason, displayReason}`, а при политике `never` отказ финальный | `read` `packages/experimental/auto-review/src/index.ts:657-666,710-716` | verified |
| E-20 | Auto Review выключен в default Web и включается только установкой профильного слоя + подтверждением риск-диалога | `packages/experimental/auto-review/README.md:12,33-36,115` | verified |
| E-21 | Auto preset = Full access sandbox + политика одобрения `ask`; без живого интегратора preset `auto` восстанавливать запрещено | `packages/interaction/permission-presets/src/index.ts:82,89-91,432-435` | verified |
| E-22 | Гейт подтверждения в DSH: `ApprovalService.request()` требует открытого turn, пишет аудит-пару `approval/asked`+`approval/decided` и возвращает одно из `allowed-once/rejected/cancelled/unavailable` | `packages/interaction/user-approval/src/index.ts:215-234`; `src/types.ts:28-32,44-58` | verified |
| E-23 | Гейт подтверждения fail-closed: отсутствие/исключение answerer'а и любое значение вне словаря дают `unavailable`; abort даёт `cancelled`, а поздний ответ отброшен | `packages/interaction/user-approval/src/index.ts:197-213` (JSDoc), `:127-131`, `:267-269` | verified |
| E-24 | В DSH нет OS/desktop-примитива уведомлений; все найденные `notify`/`Notification` — ACP-транспорт, SDK-protocol, клиентский тост и in-process уведомление авторизации | `Get-ChildItem packages -Directory -Recurse -Depth 2 \| Where Name -match 'notif\|desktop\|toast\|alert\|mail\|push'` → пусто; `grep` → `acp/acp/src/index.ts:125-127`, `sdk/protocol/src/types.ts:107-111`, `client/ui-conversation/src/client/contract/input.ts:199`, `credentials/authorization/src/index.ts:106,156` | verified |
| E-25 | `agent.steer(UserMessage)` и `agent.inject(UserMessage)` — существующие примитивы доставки сообщения агенту | `packages/core/agent/src/runtime-types.ts:231,241` (JSDoc: steer — «nearest step», inject — очередь для idle-драйвера) | verified |
| E-26 | `NeedsAttentionReason` и каталог `NEEDS_ATTENTION_REASONS` существуют и включают `human-gate-deadline-exceeded` | `packages/contracts/src/board.ts:356` (тип), `:373-381` (каталог), `:364,377` (значение) | verified |
| E-27 | `NeedsAttentionReason` не используется нигде, кроме собственного объявления (проверено по `packages/contracts/src` и `packages/core/src`), и не имеет носителя в событиях | `Select-String 'subState\|BoardCard\|needsAttentionReason\|attentionReason'` по `packages/contracts/src,packages/core/src` → ровно 3 совпадения: `board.ts:210` (`subState`), `:356`, `:373`; `Select-String 'attention\|reason\|Reason'` по `packages/contracts/src/events.ts` → 0 совпадений | verified |
| E-28 | `ZONE_BY_STATE['needs-attention'] = 'blocked'` — текущий маппинг отличен от рекомендованного документом `error` | `packages/contracts/src/board.ts:102-119` (строка 118) | verified |
| E-29 | У MyWork девять зон, а не семь lane'ов: `ideas, backlog, ready, in-progress, review, blocked, error, done, cancelled` | `packages/contracts/src/board.ts:53-63` (`BOARD_ZONES`, объявление на 53), `:66-92` (все девять ключей в `BOARD_ZONE_ROWS`/`BOARD_ZONE_ICONS`) | verified |
| E-30 | Ни `originState`, ни `AttentionState` в исходниках MyWork не существует | `Get-ChildItem packages -Recurse -Include *.ts,*.mjs` (без `node_modules/lib/dist`) `\| Select-String 'originState\|AttentionState'` → **matches=0**; тот же шаблон по `tests` → 0 | verified |
| E-31 | У `Task` нет полей `originState`/`reason`/ссылки на решение человека | `packages/contracts/src/task.ts:75-107` | verified |
| E-32 | `needs-attention` достижимо из шести состояний и выходит только в `ready`/`failed`/`cancelled`/`superseded`, чем теряется исходная фаза | `packages/core/src/task.ts:54-59` (вход), `:63` (выход) | verified |
| E-33 | `HumanGate` в MyWork — закрытый каталог пяти классов операций, а не запрос к человеку | `packages/contracts/src/security.ts:164-190` (тип и `HUMAN_GATES`), `:193-195` (`DOMAIN_IMPLIED_GATES`), `:280` (`OperationRequest.gate`) | verified |
| E-34 | Имя `HumanGate` из §29 коллизирует с существующим экспортом того же пакета `@dsh-mywork/contracts` | `packages/contracts/src/index.ts:82,87` (`export * from './security.ts'` и `'./workflow.ts'`) + E-33 | verified |
| E-35 | `CardCommand 'task.resolve-attention'` («Answer a `needs-attention` trigger») уже объявлен, но не реализован | `packages/contracts/src/board.ts:265-266,278`; `Select-String 'resolve-attention\|resolveAttention'` по `packages/*/src` → только `board.ts:266,278` | verified |
| E-36 | Домен authority `'approval.human'` («Human approval») существует с владельцами `['mywork-db','mywork-audit']` | `packages/contracts/src/authority.ts:64-65,122`; `tests/authority.test.mjs:35,100-101` | verified |
| E-37 | Аудит-типы `'human.override'` и `'gate.decided'` уже объявлены и входят в `AUDIT_EVENT_TYPES` | `packages/contracts/src/audit.ts:49-54,75,77` | verified |
| E-38 | `ReviewState 'escalated'` терминален и не имеет исходящих переходов, то есть эскалация к человеку — тупик без адресата | `packages/contracts/src/review.ts:25-26,43-48`; `tests/review.test.mjs:192-202` (ассерт отсутствия исходящих рёбер) | verified |
| E-39 | У `Review` нет `deadlineAt` и нет ссылки на человеческое решение; reviewer задан как `AgentId` | `packages/contracts/src/review.ts:66-88` | verified |
| E-40 | Одобрение review привязано к `{headSha, diffHash}` и инвалидируется сдвигом HEAD с кодом `STALE_REVISION` | `packages/contracts/src/review.ts:50-56`; `tests/review.test.mjs:162-182` | verified |
| E-41 | `BlockerResolutionGate`/`BlockerResolutionDecision` уже реализуют паттерн «производное состояние гейта + сохраняемое решение», включая `awaitingDecision` = «человек ещё не ответил» | `packages/contracts/src/workflow.ts:70-97,99-125` (`awaitingDecision` 118–122); `packages/core/src/blocker.ts:94-155` | verified |
| E-42 | `workflow.ts` явно отказывается считать `BlockerResolutionGate` тем `HumanGate` из §28 архитектуры MyWork | `packages/contracts/src/workflow.ts:103-105` | verified |
| E-43 | У `AttemptState` нет состояния `paused`/`awaiting-human` | `packages/contracts/src/attempt.ts:21-42` (10 состояний + `stale`) | verified |
| E-44 | §50 смешивает уровень панели и уровень причины деградации: `reconciliation-pending` — это `DegradedProjection.reason`, а не `BoardPanelState` | `packages/contracts/src/board.ts:141-166` (`BoardPanelState`), `:305-314` (`DegradedProjection`) | verified |
| E-45 | `BoardPanelState` содержит `loading` и `empty`, которых нет в списке §50, и различает «пусто» и «недоступно» | `packages/contracts/src/board.ts:134-166` | verified |
| E-46 | ADR028 требует человеческую приёмку (`human acceptance`) для `research`/`analysis`/`document`/`non-git-ops` («да») и `manual` («всегда»), но `WorkType`/`FinishCriteria`/`FINISH_CRITERIA_UNMET` в коде не существуют | `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377+` (таблица ADR028); `Select-String 'humanAcceptance\|WorkType\|FINISH_CRITERIA_UNMET'` по `packages` → 0 совпадений | verified |
| E-47 | Карточка MW-030 владеет human gates, autonomy L0–L3 и каталогом `NeedsAttentionReason`, а её приёмка требует точной причины для каждого триггера и аудита human override | `.work/tasks/MW-030.md:17,20` | verified |
| E-48 | Карточка MW-046 владеет `DiscussionMessage (…, decision, …)`, `attempt.steer`, ссылкой на DSH-сессию и аудитом решений; повтор steer с тем же `operationId` должен давать один эффект | `.work/tasks/MW-046.md:18,21` | verified |
| E-49 | Карточка MW-045 владеет `contracts/src/worktype.ts` по ADR028 и не выполнена (отчёта нет) | `.work/tasks/MW-045.md:15,18`; список отчётов в `.work/reports` — `MW-045-*.md` отсутствует | verified |
| E-50 | Инженерное решение MyWork: «что делать с исчерпанным бюджетом — pause / escalate / human decision — решает не бюджетный гейт, а workflow (MW-014/MW-044)» | `.work/reports/MW-013-routing-budget.md:81-84` (пункт `D7`) | verified |
| E-51 | Открытый человеческий гейт обязан освобождать worker-сессию: блокирующий `ask()` в `execute` удерживает шаг и не переживает restart рантайма | E-17 + E-01 (нет таймаута) + E-14 (note формулирует ту же проблему: строки 9–11) | verified |
| E-52 | Блокирующий `ask()` допустим только в root-сессии, поэтому durable-состояние обязано жить в MyWork, а DSH `ask()` — быть лишь live-адаптером | E-04 + E-05 + §29 документа (стр. 875–877) | verified |
| E-53 | Пакетный человеческий ответ возможен только как N отдельных решений с общим `operationId`, потому что ни DSH `ask()`, ни MyWork не группируют решения по нескольким объектам | `packages/interaction/user-questions/src/types.ts:64-77` (батч только внутри одного запроса); отсутствие групповой сущности в контрактах MyWork (E-27, E-35) | verified |
| E-54 | В MyWork сегодня нет способа узнать, кто ответил: `Review.reviewerId` — `AgentId`, `BlockerResolutionDecision.decidedBy` — `string` | `packages/contracts/src/review.ts:74-75`; `packages/contracts/src/workflow.ts:91-92` | verified |
| E-55 | `BoardPlacement` не несёт ни причины внимания, ни исходной фазы; единственная щель — нетипизированный `subState?: string` | `packages/contracts/src/board.ts:197-225` (поле 209–210) | verified |
| E-56 | `workflow.ts` и `audit.ts` ссылаются на «ADR028 §5.18» как источник `gate.decided`, тогда как ADR028 в MyWork — «Work-type-specific finish criteria» | `packages/contracts/src/workflow.ts:1-10`; `packages/contracts/src/audit.ts:53`; `.work/architecture/DSH-My-Work-Architecture-v0.2-decisions.md:377` | unverified (ссылочный дефект: какой именно §5.18 имелся в виду — не установлено) |
| E-57 | Карточка MW-030 не выполнена (отчёта нет), значит её объём/приёмку можно править без переделки | список `.work/reports` — `MW-030-*.md` отсутствует; `00-ground-truth.md:67` | verified |
| E-58 | Триггер `'human-gate-deadline-exceeded'` описывает только истечение срока и не покрывает нормальное ожидание ответа, поэтому каталог требует аддитивного расширения | `packages/contracts/src/board.ts:364,377`; отсутствие триггера вида «ожидаем решение» в `:373-381` | verified |
| E-59 | Логика «approval.human» покрыта тестом на права записи: `mywork-audit` может, `memory-provider` не может | `tests/authority.test.mjs:100-101` | verified |
| E-60 | В рамках потока E E-наблюдения ограничены чтением; ни один тест (MyWork `node --test`, DSH `vitest`), ни один GUI-сценарий не запускался | сам протокол работы; см. §5 | verified (как ограничение метода) |

**Итог по CLAIMS:** 60 утверждений; 58 `verified`, 0 `refuted`, 1 `unverified` (E-56, ссылочный дефект — не удалось установить, на какой §5.18 ссылаются `workflow.ts`/`audit.ts`), 1 `verified` про ограничение метода (E-60). Ни одно утверждение о поведении не опирается на README пакета как на доказательство: README цитируется только там, где он сам является артефактом поставки (E-18, E-20) — и в этих случаях рядом стоит ссылка на `src/`.
