# execution-05 — инструменты и права worker-сессии (факты)

Пути в части A — от корня H:\Repo\DSH-MyWork; в части B (помечено DSH:) — от C:\Reposit\deepseek-harness\deepseek-harness.

A1 порт: packages/contracts/src/agent-runtime.ts:223 `AgentRuntimePort` — start:230, resume:237, status:243, stop:250, events:257; SessionPort:268 (create:274, events:281, cancel:288).
A1 реализация: packages/controller/src/dsh-session.ts:426 `DshAgentRuntime implements AgentRuntimePort`; start:450 (create:452 → scope:459 → prompt:460), resume:475, status:500, stop:526; регистрация адаптера :695, id `dsh-agent-runtime` :69.
A1 символов runAttempt/startSession в packages/** нет (grep по `runAttempt|startSession|AgentRuntimePort` — 14 совпадений, все AgentRuntimePort).
A1 scope: packages/contracts/src/agent-runtime.ts:52-64 `{agentPreset, model?, permission?}`; preset при create (dsh-session.ts:455; DshSessionController.create :178-179), model — selectModel (:564), permission — команда `/permission <mode>` (:613, #pinPermission :591, #assertScope :555).
A2 поверхность фиксируется, а не фильтруется: packages/contracts/src/context.ts:805 `toolSurface` (закрытый список полей :836), packages/core/src/context.ts:440, валидация :487, сборка снапшота :613.
A2 фильтрации нет: grep `allowedTools|toolSurface|autoReview|tools:` по packages/** — только определения toolSurface; поверхность задаёт DSH agent preset (packages/contracts/src/agent-runtime.ts:52-59 «no per-session tool allow-list»; capability scopedTools dsh-session.ts:93).
A2 (DSH:) поверхность сессии = композиция пресета: packages/bundle/web-app/presets/cordis.patch.yml:141-154 (tool-cordis, plugin-manager/tools), standard.patch.yml:145-146 (plugin-manager/tools disabled); per-session allow-list в исходниках не найден.
A3 MyWork: упоминаний cordis_-инструментов, dynamic-плагинов, auto-review и политик approve/deny инструментов нет; `cordis` только как пакет/сервис (packages/controller/src/index.ts:12, packages/controller/tsdown.config.ts:19 neverBundle); deny/approve — доменные (packages/contracts/src/team.ts:48 `review.approve`, packages/core/src/security.ts:132-144).
A4 типа `PermissionPreset` в MyWork нет (grep 0 совпадений); Permission: packages/contracts/src/team.ts:34, PERMISSIONS:61.
A4 `HarnessPolicy = 'read-only' | 'workspace-write' | 'danger-full-access'`: packages/contracts/src/security.ts:119; HARNESS_POLICIES:122; HARNESS_POLICY_CEILING:135-146; HARNESS_GOVERNED_PERMISSIONS:104.
A4 права роли: AgentBlueprint.preset+permissions packages/contracts/src/team.ts:206-208; grant (permissions+harnessPolicy) :252-260; гейт packages/core/src/security.ts:77-144.
B5 единственные литеральные регистрации cordis-инструментов: packages/extensions/tool-cordis/src/index.ts:23 `cordis_inspect_list`, :42 `cordis_inspect_query`.
B5 динамические плагины: packages/extensions/cordis-host-runner/src/index.ts:129 `DynamicCordisRunnerService` (define:156, run:253, stop:461, undefine:215); литералов `'cordis_'` в packages/** — 0; имя `cordis_define` только в текстах ошибок :159, :160, :162, :171.
B5 имена `cordis_define/cordis_run/cordis_stop/cordis_undefine/cordis_inspect_self` — только клиент/тесты: packages/client/ui-tool/src/client/tool/models/tool-call-model.ts:68-70,93; packages/extensions/ui-cordis/src/client/index.ts:119,126,140,143; packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:4019; как снятые — apps/cli/tests/web-agent-presets.e2e.ts:368, apps/cli/tests/profiles/web/tests/creator-plugin-manager.expected.e2e.ts:76.
B5 в shipped-каталоге инструментов их нет: packages/core/tools/tests/gen-tool-catalog.spec.ts:28-43; `cordis_inspect_self` упомянут в packages/client/ui-tool/src/client/tool/models/inspection-details-model.ts:29.
B6 sandbox-policy включается композицией: packages/bundle/base/cordis.patch.yml:228-229; packages/bundle/sdk-minimal/cordis.patch.yml:41-42.
B6 режимы: packages/sandbox/sandbox-policy/src/session-mode.ts:42 `SANDBOX_MODES = ['read-only','workspace-write','danger-full-access']`, событие `sandbox/mode` :33; default read-only — Config packages/sandbox/sandbox-policy/src/index.ts:71-79, resolve :167, overrideOf :178; ограничивает file-effect + workspace-write root (index.ts:1-19, renderPolicyContext :42-56).
B6 fs-observation-policy включается packages/bundle/base/cordis.patch.yml:277-278; ограничивает prior-observation CAS: packages/fs/fs-observation-policy/src/index.ts:65-71 (writeIntent), :78-80 (editIntent → FS_NOT_OBSERVED/FS_NOT_FOUND); без него мутации безусловны :4-6.
B7 auto-review включается packages/experimental/auto-review/cordis.patch.yml:2-3; гейт на вызов инструмента — подписка `tools/pre-execute` packages/experimental/auto-review/src/index.ts:686; решения PreToolDecision: 'deny' :643/:672, 'ask' :660, 'cancel' :695; вердикт ревьюера deny — :67; при approval='never' deny финален :709-710.
B7 `ApprovalPolicy = 'ask' | 'never'`: packages/interaction/user-approval/src/index.ts:67, APPROVAL_POLICIES:70, overrideOf:252, effectivePolicy:243-244; preset = sandbox+approval packages/interaction/permission-presets/src/index.ts:64-68, команда `permission` :258, AUTO_PRESET `auto` :82 и его spec :89-92.

не проверено:
- команды намеренно не запускались (нет pnpm install/build/tsdown/тестов); ни одна строка отчёта не опирается на exit code — использованы только read/grep/glob/Select-String.
- точные имена генерируемых инструментов динамического раннера: packages/extensions/cordis-host-runner/lib/typert.host.* не читался (запрет на dist/lib), в src литералов имён нет — вывод сделан по текстам ошибок и клиентским картам.
- реальный состав инструментов моей текущей сессии не проверялся (cordis_inspect_list не вызывался).
- файл packages/experimental/auto-review/src/index.ts прочитан фрагментами (:610-699): строки :1-66 и :700-740 не читались, приоритет ask/never выведен по комментарию :5 и guard :709-710.
- строки enforcement fs-sandbox/bash-sandbox/pwsh-sandbox не проверялись построчно — подтверждено только наличие пакетов и чтение общей политики.
