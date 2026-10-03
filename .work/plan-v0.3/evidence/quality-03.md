# quality-03 — Q03 ask/approval (root якорей: C:\Reposit\deepseek-harness\deepseek-harness, только чтение)

1. user-questions: packages/interaction/user-questions, name @deepseek-ai/dsh-user-questions (package.json:2), main lib/index.js (:14), exports "."/"./types"/"./src/*" (:16-27).
2. Экспорты src/index.ts: default UserQuestionService (:154), UserQuestionService (:65), UserQuestionError (:34), AskUserQuestionRequest (:31), type-реэкспорт Answer/AnswerItem/Intent/Item/Option (:25-28).
3. ask(request): Promise<AskUserQuestionAnswer> — src/index.ts:86; request {questions, agent?, signal?} — types.ts:70-77 (item :36-51); ответ {answers:[{id,selected[],custom?}]} — types.ts:54-67.
4. Таймаута нет: grep 'timeout|Timeout|TIMEOUT' по packages/interaction — 1 совпадение, и то setTimeout в тесте (user-approval/tests/approval.spec.ts:320); единственная отмена — request.signal (src/index.ts:87-89).
5. Таксономия ошибок ask(): ASK_ABORTED (:41-47, :146-148), EMPTY_QUESTIONS (:90-92), CALLER_NOT_LIVE (:96-100), DELEGATED_CALLER (:101-106), BAD_INTENT (:118-128), NO_PROVIDER (:130-133).
6. Ждёт waterfall: ctx.waterfall('user-questions/request', …) с agent-scope через scopeTarget (:135-142); контракт mode: waterfall — types.ts:88-92; без ответчика промис реджектится, автоответа/дефолта нет (:130-133).
7. Owned (дочерний) агент не может спросить человека — DELEGATED_CALLER, вопрос обязан вернуться в его финальном результате (:101-106).
8. user-approval: packages/interaction/user-approval; ApprovalOutcome = 'allowed-once'|'rejected'|'cancelled'|'unavailable' (src/types.ts:28-32), OUTCOMES — тот же словарь (src/index.ts:55).
9. fail-closed: нет ответчика / ответчик бросил / не-словарный возврат → нормализуется в 'unavailable' (:280-292); request() требует открытого turn, иначе throw до любых записей (:215-223).
10. Политики per-session: ApprovalPolicy='ask'|'never' (:67, :70), Config.policy default 'ask' (:151-153), effectivePolicy = session override ?? config ?? 'ask' (:243-245).
11. Override durable в логе сессии: approval/policy, побеждает последнее (:40-45); setApprovalPolicy (:100-105), overrideOf читает последнее (:252-259), setPolicy переключает живого агента + agent.inject-уведомление (:184-195).
12. 'never' решается ДО dispatch → детерминированный 'rejected' (:275); текст NEVER_SENTENCE/ASK_SENTENCE уходит модели через systemPrompt.context (:73-75, :162-173).
13. Аудит durable: пара approval/asked (:225-230) + approval/decided (:232) с одним id; типы types.ts:44-58; парность/словарь проверяет invariant (src/invariant.ts:32-48, :58-102).
14. Отмена approval: aborted signal → 'cancelled' сразу, поздний ответ отбрасывается (:268-269, :293-306).
15. Инструмент: packages/interaction/tool-ask-user/src/index.ts:19-20, inject ['tools','userQuestions'] (:14); схема questions[].{id,question,header?,options[]{label,description?},multi_select?} (:22-56), output {answers[{id,selected[],custom?}]} (:57-78); таймаута в схеме нет.
16. execute: ctx.userQuestions.ask({…, ...exec.agent, signal: exec.signal}) + обратный маппинг ответа (:79-98); других веток (retry/timeout) нет.
17. agent.steer(message: UserMessage): void — очередь к ближайшей границе шага; idle стартует turn, running забирает на следующей границе шага (core/agent/src/runtime-types.ts:224-231).
18. agent.inject(message): void — контекст к следующему pre-step без пробуждения (:233-241); рядом send(message,target,wakeup) (:204-215), followup (:217-222), cancel (:176-183, чистит очередь и абортит активный turn).
19. Steer в живую сессию: session-controller prompt mode 'steer' → agent.steer (api/session-controller/src/commands.ts:364), queue action 'steer' → inbox.remove + agent.steer (:495-498); платформенный потребитель — extensions/cordis-host-runner/src/index.ts:1048, :1061, :1085, inject :1155.
20. Пока ask() ждёт — шаг заблокирован: tool/call пишется durable до dispatch (core/agent-loop/src/tool-calls.ts:168, :263-266), группа ждётся до опустошения inFlight (:219-231); ask_user_question не объявляет isConcurrencySafe → executionMode exclusive (core/tools/src/index.ts:1303-1311), эксклюзивный вызов идёт группой из одного и служит барьером (:88-93, :204-205); лимит параллелизма 10 (agent-loop/src/constants.ts:6).
21. Прерывание turn: exec.signal = сигнал шага (tool-calls.ts:74-80) → ask бросает ASK_ABORTED, вызов модели отдаёт error-результат (containment: core/tools/src/index.ts:1657, :1674-1680, :1909-1917); нестартованные вызовы получают синтетику TOOL_ABORTED_BEFORE_DISPATCH (tool-calls.ts:238-260).
22. Durable-состояния «ждём ответа человека» НЕТ: в KNOWN_SESSION_EVENT_TYPES нет ни одного question-события, только approval/asked|decided|policy — core/session/src/known-event-types.ts:22-82; session control не хранит и не реплеит эти waterfall — .agents/notes/implemented/architecture/2026-08-18-session-history-and-event-transport.md:212.
23. Обрыв транспорта: pending forwarded dispatch реджектится при завершении источника Remote-событий (api/remotes/src/index.ts:47-81, :96-104, :106-121, :129-132); клиент-ответчик — client/ui-user-questions/src/client/index.ts:105-107 (локальные коды ASK_ABORTED/ASK_CANCELLED — contract/slots.ts:106, :155, :191).
24. Рестарт: незавершённый turn закрывается синтетикой; tool/call без tool/result → error tool/result с TOOL_OUTCOME_UNKNOWN («its outcome is unknown… ask the user») — core/session/src/repair.ts:21, :104-106, :127-154, :175-177 (экспорт core/session/src/index.ts:32); resume зовёт interruptedTurnClosers — core/agent-loop/src/index.ts:848-856. Вопрос не перезадаётся; timed/durable-вариант (timeout, askTimed(), ASK_TIMED_OUT, проекция durable state) — только proposed: .agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md:3, :19, :45, :49, :105 («real Host restart remain integration coverage gaps»).

не проверено:
- Ничего не запускалось (pnpm/tsdown/node --test запрещены) → exit-code-якорей нет, только read/grep/glob.
- Сборки lib/** не читались; только src, tests-упоминания и .agents-заметки.
- Реальный Host restart и отключение браузера не воспроизводились — выводы 22-24 получены по коду и заметке.
- UI-рендер вопроса (карточка/композер) детально не разбирался, только точка claim'а и коды отмены.
- Прочие answerer'ы (plan-mode: packages/plan/plan-mode/src/index.ts:303, :320) не изучались.

EVIDENCE: .work/plan-v0.3/evidence/quality-03.md
