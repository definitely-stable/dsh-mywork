# ЗАДАЧА 5 — клиентская половина 0.4.3: данные и ревизии (только чтение)

База путей: `C:\Users\Dmitry\.dsh\profiles\web\node_modules\@linxin666\dsh-client-ui-task-board\` = `<PL>`. Версия: `<PL>package.json:4` — `"version": "0.4.3"`.

## 1) Факты

- `<PL>src/protocol.ts:13` — `export const TASK_BOARD_API_PREFIX = '/api/task-board'`
- `<PL>src/client/host-api.ts:22` — `const CLIENT_API_PREFIX = TASK_BOARD_API_PREFIX.slice(1)`
- `<PL>src/client/host-api.ts:27` — `const REQUEST_TIMEOUT_MS = 15_000`
- `<PL>src/client/host-api.ts:126-128` — `async state(): Promise<TaskBoardSnapshot> { return await this.request(`${CLIENT_API_PREFIX}/state`, { cache: 'no-store' })`
- `<PL>src/client/host-api.ts:134-141` — `post()`: `request(`${CLIENT_API_PREFIX}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) })`
- `<PL>src/client/host-api.ts:105-124` — `bootstrap()` = `state()`, затем `post(requestId, { kind: 'import', sourceId, tasks: [...legacy] })` при `this.storage?.getItem(IMPORT_MARKER) !== ledgerId`
- `<PL>src/client/host-api.ts:143-157` — `private async request()`: `AbortController` + `setTimeout(..., REQUEST_TIMEOUT_MS)`; в `finally` — `clearTimeout(timeout)`
- `<PL>src/client/host-api.ts:40` — `export type HostApiFailure = 'not-mounted' | 'unauthorized' | 'locked' | 'rejected' | 'timeout' | 'unreachable' | 'unexpected'`
- `<PL>src/client/host-api.ts:43-48` — `export class HostApiError extends Error` / `this.name = 'HostApiError'`
- `<PL>src/client/host-api.ts:145-153` / `:75` / `:84` / `:86` / `:88-90` — маппинг: abort→`'timeout'`, fetch-сбой→`'unreachable'`, 404→`'not-mounted'`, 401/403→`'unauthorized'`, 503|/lock/i→`'locked'`, `error:'forbidden'`→`'unauthorized'`, прочее→`'unexpected'`
- `<PL>src/client/host-api.ts:167-172` — `parseDraft()`: `fetch(`${CLIENT_API_PREFIX}/parse`, { method: 'POST', ... })`; свой таймаут НЕ ставится, берётся `signal?: AbortSignal` вызывающего
- `<PL>src/client/host-api.ts:206` — `const events = new EventSource(`${CLIENT_API_PREFIX}/events`)`
- `<PL>src/client/host-api.ts:208-216` — `events.onmessage`: `JSON.parse(message.data)`; `typeof parsed.revision !== 'number'` → `throw new Error('invalid event frame')` → `catch { listener() }`
- `<PL>src/client/host-api.ts:220-225` — `events.onerror`: троттлинг `STREAM_ERROR_NOTIFY_MS` (`host-api.ts:29` = `15_000`), затем `listener()`; явного `new EventSource`/реконнекта/опроса в коде НЕТ
- `<PL>src/client/host-api.ts:226-231` — `onVisible` → `document.addEventListener('visibilitychange', ...)`; возврат `() => { document.removeEventListener(...); events.close() }`
- `<PL>src/host-routes.ts:220` / `:229` / `:238` — `path: `${TASK_BOARD_API_PREFIX}/events``, `'content-type': 'text/event-stream; charset=utf-8'`, `setInterval(() => { res.write(': ping\n\n') }, HEARTBEAT_MS)`; `<PL>src/host-routes.ts:18` — `const HEARTBEAT_MS = 15_000`
- `<PL>src/core/controller.ts:690-699` — `private onRemoteEvent(event)`: при `event.revision === this.hostState.revision` + объектных `scheduler`/`power` — `this.hostState = { ...this.hostState, revision: ..., scheduler: ..., power: ... }`, `this.notify()`, `return`; иначе `void this.refreshRemote()`
- `<PL>src/core/controller.ts:684-689` — комментарий-обоснование: «skip the full /state fetch; otherwise the 5 s heartbeat would re-clone and re-serialize the whole ledger per tab»
- `<PL>src/core/controller.ts:732-747` — `private async refreshRemote(preserveError?)`: `this.acceptRemote(await transport.state())`
- `<PL>src/core/controller.ts:749-766` — `private acceptRemote(snapshot)`: `this.tasks = [...snapshot.tasks]` (#754), `this.hostState = this.mirrorOf(snapshot)` (#755), сброс `transportError`, сброс `selectedTaskId` при пропавшей/архивной задаче, `this.notify()`
- `<PL>src/core/controller.ts:753` — `if (sameGeneration && this.hostState !== undefined && snapshot.revision < this.hostState.revision) return false` (старая ревизия той же генерации отбрасывается)
- `<PL>src/core/controller.ts:718-730` — `private mirrorOf(snapshot): HostMirror`: `sessionDefaultPermission ?? this.hostState?.sessionDefaultPermission` (аналогично `maxSubtaskDepth`, `teamRunAvailable`)
- `<PL>src/core/controller.ts:138` — `export type HostMirror = Pick<TaskBoardSnapshot, 'revision' | 'scheduler' | 'power' | 'sessionDefaultPermission' | 'maxSubtaskDepth' | 'teamRunAvailable'>`
- `<PL>src/core/controller.ts:672-675` — `if (!this.remoteSubscribed) { this.remoteSubscribed = true; this.disposers.push(transport.subscribe(...)) }` (не более одной SSE-подписки)
- `<PL>src/core/controller.ts:222-226` — `subscribeExternal` создаётся только при `this.deps.transport === undefined`; `<PL>src/core/store.ts:34` — `subscribeExternal?(listener: () => void): () => void`
- `<PL>src/core/controller.ts:227-229` — `this.disposers.push(this.deps.sessions.subscribe(() => { this.onSessionsChanged() }))`; `<PL>src/core/controller.ts:612-614` — тело пустое
- `<PL>src/core/controller.ts:234-237` — `dispose(): for (const dispose of this.disposers.splice(0)) dispose(); this.listeners.clear()`
- Клиентских таймеров в панели НЕТ: `grep setTimeout|setInterval|EventSource|AbortController` по `src/**` дал только `host-api.ts:144,145,206,227`, `host-ai.ts:125-128`, `host-service.ts:75,79,150,238`, `host-runner.ts:65`, `power-inhibitor.ts`, `PluginSettingsCard.tsx:302,314,386`
- `<PL>src/client/index.ts:127` — `export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'configForms', 'locale', 'remote', 'remote.session', 'uiWorkspace', 'layout']`
- `<PL>lib/client.js` — `exports.apply = apply; exports.bindSettingsForm = bindSettingsForm; exports.inject = inject; exports.servedEntryId = servedEntryId;` (сборка `lib/client.js`, конец файла; в бандле `inject:` встречается 2× внутри `slots.register`)
- `<PL>package.json:32-44` — `"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-api-workspace-controller", "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-workspace"], "platform": "web" } }`
- `<PL>cordis.patch.yml:10-12` — `- insert: - id: ui-task-board / name: '@linxin666/dsh-client-ui-task-board'`
- Единого префикса data-атрибутов панели НЕТ: найдены `data-dsh-taskboard-view` (`<PL>src/client/native-panel.tsx:77`), `data-dsh-taskboard-board` (`<PL>src/client/board/TaskBoard.tsx:152`), `data-dsh-panel-entry={TASK_BOARD_PANEL_ID}` (`<PL>src/client/native-panel.tsx:49`), `data-dsh-plugin="task-board"` (`native-panel.tsx:77`, `TaskBoard.tsx:152`)
- `<PL>src/core/controller.ts:66` — `export const TASK_BOARD_PANEL_ID = 'task-board'`
- Второй SSE-клиент: `<PL>src/client/TaskBoardSettingsCard.tsx:136` — `const events = new EventSource('api/task-board/events')`; `:139-140` читает `frame.power`; `:145` — `return () => { live = false; events.close() }`; ревизия не читается

## 2) Не проверено

- Реальная частота SSE-кадров и поведение брокера при обрыве (сеть/прокси) — только код, без запуска GUI.
- Реконнект EventSource отдан браузеру (своего кода реконнекта нет); фактический интервал реконнекта в живом браузере не измерялся.
- `TaskBoardSettingsCard.tsx` не подписывает `events.onerror` — отмечено по коду (`:136-146`), поведение при ошибке потока не воспроизводилось.
- `lib/client.js` собран из `src` этой же версии (совпадение строк проверено выборочно: `task-board/events`, `slice(1)`, `data-dsh-*`).
- Искал так: read `src/client/host-api.ts`, `src/client/index.ts`, `src/core/controller.ts`, `src/host-service.ts`, `src/protocol.ts`; grep `EventSource|setTimeout|setInterval|data-dsh-[a-z-]+` по `src/**`; read `src/host-routes.ts:190-293`, `src/client/native-panel.tsx:1-124`, `package.json`, `cordis.patch.yml`; Select-String по `lib/client.js`.

## 3) Что это значит для плана

- Клиент читает Host по четырём маршрутам (`/state`, `/action`, `/parse`, `/events`) под document-relative префиксом без ведущего слэша — Transport-контракт (`controller.ts:31-45`) уже абстрагирует половину Host-API, её можно заменить, не трогая контроллер.
- Ревизия живёт в двух местах: `onRemoteEvent` (`:690-699`) экономит refetch на том же `revision`, а `acceptRemote` (`:753`) отбрасывает только откат ревизии внутри одной генерации ledgerId — правила «тот же revision из /state» и «кадр без scheduler/power» определены явно.
- Реальное число подписок на панель: SSE-подписка ровно одна (`remoteSubscribed`), плюс подписка на sessions и опционально store; таймеров в клиенте панели нет — снятие через `dispose()`/`uiDisposer` (`index.ts:397-401`, `controller.ts:234-237`).
- Клиентская половина объявляет свой `inject` (`index.ts:127`) отдельно от манифестного `dsh.client.inject` (`package.json:33-42`) — это два разных списка, оба нужно учитывать при замене/версионировании.
