Корень путей: C:\Reposit\deepseek-harness\deepseek-harness\packages\ (checkout c7c4c725c7, `git rev-parse --short HEAD` exit 0)

1) реальные .restrict()/.guard() вне core/tools — 3 продовых места:
- subagent/subagent/src/child-agent.ts:218 — `if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter)` внутри applyChildComposition(childCtx,parent,composition) (200-219); докблок 178-199: фильтр — собственный вклад скоупа ребёнка, невидим родителю/сиблингам, ставится в creation window.
- experimental/browser-use-runtime/src/mcp.ts:117 — `state.mask.ctx.tools.restrict({ deny: inherited.map(t => t.name) })` в refreshBlockedMasks (108-122): эксклюзивный браузер занят другой сессией → MCP-инструменты маскируются у этого агента; mask-scope 116 `createScope(ctx, agent)`; триггеры `agent/created` (177-190, {prepend:true}) и `tools/change` (191).
- subagent/subagent-in-process-driver/src/structured.ts:109 — childCtx.tools.guard(...): после фиксации structured-output терминальный guard запрещает любой следующий вызов (коммент 105-108: guard идёт после всего pre-execute waterfall, deny-or-abstain).

2) scoped agent.ctx:
- скоуп агента: core/agent-loop/src/agent.ts:130 `this.scope = createScope(loopCtx, this)`; сам контекст — api/remotes/src/index.ts:72 `{ value: agent.ctx, subject: agent, agentId: agent.id }`.
- получить: ctx.agents.get(id) core/agent/src/index.ts:566-567, ctx.agents.list() 586; createScope(ctx,key) core/scope/src/index.ts:137-147 и scopeOf 154-156; клиентская сторона — api/session-controller/src/client/scope.ts:44,65, retainAgentScope service.ts:487.
- restrict без scoped-контекста бросает: core/tools/src/index.ts:1100.
- событие создания: `agent/created` (payload {agent, source:'startup'|'resume', signal}); scoped-резолвер core/scope/src/scoped-events.generated.ts:12; прод-слушатели: experimental/browser-use-runtime/src/mcp.ts:177, subagent/tool-subagent/src/index.ts:702 (+`agent/disposed` 705, `tools/change` 709), context/file-reference-local/src/index.ts:92.
- применить restrict ПОСЛЕ создания, но ДО первого вызова инструмента: гарантированное окно `setup` — core/agent/src/index.ts:100-118 (setup ждут после минта agentCtx и ДО session/created, agent/created и первой сборки промпта; restrict() назван явно), commit 37-54; то же на resume: ResumeAgentOptions.setup 134-143.
- фабрика: core/agent-loop/src/index.ts:775 `await raceAbort(setup?.(prepared.agent.ctx, prepared.agent), ...)`, публикация 778; порядок закреплён тестами core/agent-loop/tests/scope-lifecycle.spec.ts:339 и core/agent-loop/tests/resume.spec.ts:599 ('startup'/'resume'); последняя точка — `agent/pre-step` до запроса, core/agent-loop/tests/loop.spec.ts:1215 (используется driver'ом subagent-in-process-driver/src/index.ts:83).

3) continuable-ребёнок — применимо:
- гейт возможностей: subagent/subagent/src/types.ts:134 (toolFilter), 186-192 ("applied as a scoped tools.restrict() in the child's creation window"); проверка subagent/src/index.ts:649.
- spawn/fork in-process → общий драйвер: subagent-spawn-in-process/src/index.ts:58, subagent-fork-in-process/src/index.ts:78 → subagent-in-process-driver/src/index.ts:122-143 (setup → applyChildComposition 124 с request.toolFilter 126 → agents.create({setup}) 134-143).
- фильтр durable у continuable: subagent/subagent/src/descriptor.ts:85,122,143; append события `subagent/descriptor` — continuation-activation.ts:627.
- cold resume: continuation.ts:425-427 (descriptor из персистентного лога) → 447 composition{toolFilter: descriptor.toolFilter} → applyChildComposition в setup и для create (641), и для resume (634): continuation-activation.ts:623-650.
- durable-схема: session/session-format-v0-to-v1/src/payload-validation.ts:971-975, dispositions.ts:94; out-of-process провайдеры объявляют toolFilter:false (subagent/src/out-of-process.ts:57-63, subagent-acp/src/index.ts:143-151) → сервис отклоняет запрос; конфиг инструмента: subagent/tool-subagent/src/index.ts:87,126,318-319,521.

4) restart/resume:
- restriction процесс-локальна: core/tools/src/index.ts:736 `restrictions = new AnonymousEntries<CompiledToolRestriction>()`, слои — core/scope/src/store.ts:159-163 (Map в памяти); снимается dispose'ом скоупа (core/tools/tests/scoped.spec.ts:313-314).
- в session-log/формат не сериализуется: `Select-String 'restrictions'` по core/session, session, api/session-controller, core/agent → 0 совпадений (persistence_restriction_hits=0).
- на resume переустанавливается: api/session-controller/src/agent.ts:437-441 и 469-473 передают `setup: composition.setup` из composeAgent (381-397, mount пресета), также commands.ts:283 и bundle/headless/src/index.ts:279.
- «INHERITED surface»: core/tools/src/index.ts:1156-1168 (коммент: restrictions фильтруют то, что скоуп НАСЛЕДУЕТ), сборка inherited 1185-1191, пересечение `layers.every(layer => layer.admits(name))` 1200, собственный слой вне фильтра 1202-1208, admits 757-764.

5) «снять нельзя» — опровергнуто как абсолют, подтверждено как монотонность:
- restriction пересекаются: core/tools/src/index.ts:696-705, 1198-1200; guard — «monotonic», без allow-результата: 723-731, 1126-1135 ("no guard can force-allow a call another guard denied"), 1144-1154.
- поздний prepend-слушатель tools/pre-execute с {kind:'allow'} не обходит guard: core/tools/tests/scoped.spec.ts:302-309.
- но снять свой можно: restrict/guard возвращают собственный disposer (1095, 1119-1123, 1137-1141) — core/tools/tests/scoped.spec.ts:165-170 (liftAllow), 300-314 (liftFirst + scope.dispose); API очистки чужих нет (extensions/tool-cordis/src/api-catalog.ts:7570-7578).
- чужой скоуп не снимает: фильтр ребёнка не трогает родителя (core/tools/tests/scoped.spec.ts:225-232), родительский доходит до всех вложенных (252-261).

не проверено:
- сборка/тесты/install не запускались (запрет задачи): все выводы — статическое чтение кода и имён тестов; ни один тест не исполнен.
- не проверено, ставит ли какой-либо пользовательский preset restrict в своём composition (в packages/preset/** вызовов .restrict( нет).
- не проверено поведение при живой HMR-перезагрузке плагина и при fork-сессии относительно restriction.
- искал только packages/**; apps/**, lib/**, native/** checkout'а не смотрел.
- файл .work/plan-v0.3/evidence/execution-07.md до записи отсутствовал (Test-Path = False); соседние evidence-* файлы не читал.
