# foundation-16 — allowlist набора инструментов сессии (READ-ONLY research)

ПОДТВЕРЖДЕНО
- Сервис и метод: packages/core/tools/src/index.ts:807 `export class ToolRuntime extends Service`, имя в ctx — packages/core/tools/src/index.ts:849 `super(ctx, 'tools')`; фильтр — packages/core/tools/src/index.ts:1097 `restrict(filter: ToolRestriction): () => void`; тип — packages/core/tools/src/index.ts:700 `interface ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }`; презентация — packages/core/tools/src/index.ts:974 `presentAs(mode: ToolPresentationMode): () => void`.
- Ограничения вызова: packages/core/tools/src/index.ts:1100 «requires a scoped context (agent.ctx)»; :1105 пустой фильтр — ошибка; :1111 запрещено имя run_code; :1114-1117 неизвестное имя инструмента — ошибка (значит deny нельзя объявить заранее).
- Фильтр применяется ПРИ ВЫБОРКЕ, а не при регистрации: packages/core/tools/src/index.ts:1178 `private view(scope?: ScopeKey): ToolView`, пересечение фильтров по цепочке — packages/core/tools/src/index.ts:1200 `if (layers.every(layer => layer.admits(name))) visible.set(name, definition)`; предикат — packages/core/tools/src/index.ts:758 `admits(name: string): boolean`; чтение — packages/core/tools/src/index.ts:1230-1231 `get()` → `this.view(scope).visible.get(name)`. `register()` packages/core/tools/src/index.ts:1063 фильтр не проверяет.
- Из фильтра исключены собственные регистрации scope — packages/core/tools/src/index.ts:1204-1208 (комментарий :1163-1168: фильтр режет унаследованное, не своё) — и транспорт run_code — packages/core/tools/src/index.ts:1215-1217.
- Динамическая регистрация после старта сессии поддержана и попадает под фильтр: packages/core/tools/src/index.ts:1083-1087 пишет в слои через `layers.effect`; каждое изменение эмитит packages/core/tools/src/index.ts:835 `this.ctx.emit('tools/change')` (событие объявлено packages/core/tools/src/index.ts:208); схемы пересобираются провайдером — packages/core/tools/src/index.ts:854 + packages/core/system-prompt/src/index.ts:365 `type ToolProvider = (context: AssembleContext) => ToolProviderResult` и :521 `tools(provider)`. Так как фильтр живёт в view(), глобальный инструмент, зарегистрированный позже, режется строкой :1200.
- Живой пример пост-стартовой регистрации под фильтром: packages/experimental/browser-use-runtime/src/mcp.ts:191 `ctx.on('tools/change', refreshBlockedMasks)` → packages/experimental/browser-use-runtime/src/mcp.ts:117 `state.mask.ctx.tools.restrict({ deny: inherited.map(...) })`.
- Дочерние агенты: packages/subagent/subagent/src/child-agent.ts:218 `childCtx.tools.restrict(composition.toolFilter)`; конфиг — packages/subagent/tool-subagent/src/index.ts:87 и :126 `toolFilter: z.object(...)`, пустой фильтр отвергается — packages/subagent/tool-subagent/src/index.ts:318-319.
- auto-review, возвращаемые решения: packages/experimental/auto-review/src/index.ts:65-67 `AutoReviewDecision` = `{risk:'low',decision:'allow'}` | `{risk:'medium',decision:'allow'}` | `{risk:'medium'|'high',decision:'deny',reason?: string}`; парсер — packages/experimental/auto-review/src/index.ts:562-587 (те же 4 формы, reason только с deny); промпт — packages/experimental/auto-review/src/index.ts:43-49; применение — packages/experimental/auto-review/src/index.ts:710-716 (deny → `denied()`, allow → `askUser` если downstream ≠ allow). «request-changes» и «approve» там нет.
- MyWork packages/contracts/src/security.ts:201-206 `REVIEWER_DEFAULT_PERMISSIONS = ['workspace.read','git.read','tests','review.approve']`; packages/contracts/src/security.ts:212-216 `IMPLEMENTATION_WRITE_PERMISSIONS = ['workspace.write','git.write','shell']`.

ОПРОВЕРГНУТО / УТОЧНЕНО
- Номера строк в вопросе перепутаны: 201 — это REVIEWER_DEFAULT_PERMISSIONS, 212 — IMPLEMENTATION_WRITE_PERMISSIONS (packages/contracts/src/security.ts:201, :212).
- «request-changes» в DSH-пакетах отсутствует: Select-String по всем *.ts вне node_modules/tests → hit count 0, exit code 0.
- «approve» встречается не в auto-review, а только в hooks-протоколе: packages/hooks/hook-protocol/src/types.ts:119 `decision?: 'approve' | 'allow' | 'block' | 'deny' | 'ask'`; нормализация — packages/hooks/hook-protocol/src/merge.ts:39 `case 'approve': case 'allow': return 1`.
- Ожидание «фильтр на регистрации» не подтвердилось: регистрация фильтр игнорирует, отбор — в view().
- `allowedTools`/`toolFilter` в самом runtime-API нет; внешнее имя делегирования — `toolFilter` (allow/deny), а `presentAs` — не allowlist, а выбор формы презентации (native/ptc/both).

НЕ ПРОВЕРЕНО
- Живой профиль C:\Users\Dmitry\.dsh\profiles\web не читал — вопросом не требовался.
- Не запускал тесты и сборку (запрещено условием) — выводы только из чтения исходников.
- Все внешние драйверы субагентов не сверял: packages/subagent/subagent-acp/src/index.ts:151, subagent-codex, subagent-claude-code объявляют `toolFilter: false` — проверено выборочно по grep, не построчно.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-16-tools-restrict.md
