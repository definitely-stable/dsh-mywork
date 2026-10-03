# Q05 dsh primitives — evidence (repo C:\Reposit\deepseek-harness\deepseek-harness, read-only; anchors file:line)
## 1 invariants / ./invariant companion
- @deepseek-ai/dsh-invariants: class InvariantRegistry extends Service, super(ctx,'invariants'); register(packageName, installer): () => void; duplicate/blank name throws — packages/runtime-diagnostics/invariants/src/index.ts:94,113,136-142
- InvariantError code 'INVARIANT', message `invariant violated by "<pkg>": …`; fail(message) throws — same:50-66; Config enabled(true)/package_allowlist/package_blocklist regexes, selection — :14-22,95-99,121-126
- Convention: each package ships a ./invariant companion exporting name, inject=['invariants'], apply(ctx) → ctx.invariants.register(PACKAGE_NAME, install) — docs/subsystems/invariants.md:5,59; sample packages/sandbox/sandbox-policy/src/invariant.ts:11-13,38-43
- When checked: enabled installer runs in a child Cordis fiber, sync/async completion joined at registration; failure disposes the fiber and releases the reservation — invariants/src/index.ts:153-192
- Build-time conformance: scripts/verify-package-invariants.ts:11-21 (exit 1 on violations; rejects unexplained empty installers, wrong names, wiring gaps)
## 2 doctor / health / conformance
- NO doctor primitive: `rg -i '\bdoctor\b' packages apps docs scripts` → no matches, rg-exit=1
- Nearest: invariants (runtime); verify-package-invariants (CI, exit 1); profile-bundle load warning packages/boot/app-boot/src/config-schema/index.ts:30; ctx.pluginInventory packages/host/plugin-inventory/src/index.ts:55
## 3 upgrade / export / import / repair
- plugin_manager tool: 8 actions (list_plugins,list_bundles,set_plugin,set_bundle,install_bundle,remove_bundle,list_version_exemptions,set_version_exemption) — packages/boot/plugin-manager/src/tools.ts:20-23; every action escalates via approveEscalation({requestedMode:'danger-full-access'}) — tools.ts:38-44
- PluginManager extends TypertRemoteService, super(ctx,'pluginManager') — src/index.ts:176,206; listPlugins :256, inspect :341, setPluginEnabled :425, setBundleEnabled :443, installBundle :462, removeBundle :601, exemptions :232,245
- Install repair = re-run pnpm --frozen-lockfile or --config.lockfile=false after a post-install refusal — src/operations.ts:506-514
- Export op: @deepseek-ai/dsh-session-log-export, name='session-log-download', inject ['commands','connection'] — session-query/session-log-export/src/index.ts:1,40-41 (zip streaming :22-32)
- storage-domain has NO export/import: table()/global API get/entries/keys/put/delete/update — storage/storage-domain/src/domain.ts:42-90,108; only record-level invalidRecords:'backup-and-skip' — src/spec.ts:60-67
- Boot-time upgrades: credentials-local one-shot flat-layout upgrade — credentials/credentials-local/src/index.ts:794,814; session-format chain packages/session/session-format-v0-to-v1 … v3-to-v4
## 4 jobs-local durability + archive admission
- In-memory by design: "keeps every job … in memory" — packages/jobs/jobs-local/src/index.ts:1-11; "records are in-memory, so a durable or cross-process backend must implement the same contract differently" README.md:32; "Every record disappears when the harness process exits" README.md:61
- export class LocalJobRegistry extends JobRegistry — src/index.ts:128; per-owner concurrency and ring caps — :32-61
- installJobArchiveAdmission(ctx, registry): answers workspace/session-activity and kills owned live jobs on workspace/session-stop with 'session archived' — packages/jobs/jobs/src/archive-admission.ts:24-41; installed by every registry — jobs/src/index.ts:94-96
- Workspace side: archiveSession asks the waterfall and refuses while activity is non-empty — packages/workspace/workspace/src/index.ts:350-357,363
## 5 one line each
- storage-domain @deepseek-ai/dsh-storage-domain: ctx.storageDomain, DomainFacility.open(spec), Config backend+routes, inject ['storage'] — src/index.ts:36-38,52-62,103
- session-query-sqlite @deepseek-ai/dsh-session-query-sqlite: SqliteSessionQueryEngine extends SessionQueryEngine (super :245), SQLite FTS5, implements ctx.sessionQuery (seam @deepseek-ai/dsh-session-query/src/index.ts:106) — src/index.ts:1-5,203
- spillStore @deepseek-ai/dsh-spill: abstract SpillStore.saveText(input): Promise<SpillRef> — src/index.ts:45-55; impl @deepseek-ai/dsh-spill-local LocalSpillStore :65, saveText :149, private mkdtemp root spill-local/src/store.ts:36-39
- deliverables: @deepseek-ai/dsh-tool-present registers tool `present`, inject ['tools','fs','sessionProjections'] — src/index.ts:26,38-42; @deepseek-ai/dsh-workspace-changes provides ctx.workspaceChanges on workspace/changes, inject ['subprocess'] — src/index.ts:1-10,30,118
- product-telemetry @deepseek-ai/dsh-host-product-telemetry-otel: ctx.productTelemetry, explicit OTLP/HTTP events only, no automatic collection — src/index.ts:1,80,102
- sandbox-policy @deepseek-ai/dsh-sandbox-policy: ctx.sandboxPolicy (SandboxPolicyService), resolve(request), overrideOf(session) — src/index.ts:110,126,164,178
- fs-observation-policy @deepseek-ai/dsh-fs-observation-policy: event-only, registers NO service — src/index.ts:1-7; listeners fs/write-intent :119, fs/edit-intent :122, fs/observed :127; edit without prior read → FS_NOT_OBSERVED :78-88
- credentials @deepseek-ai/dsh-credentials: abstract CredentialProvider, ctx.credentials, resolve/describe/set/unset/readRecord — src/index.ts:170-172,183-224; authorization @deepseek-ai/dsh-authorization: ctx.authorization, flow list/stop — src/index.ts:189,197,231
- approval @deepseek-ai/dsh-user-approval: ctx.approval, policy 'ask'|'never' (default 'ask'), setApprovalPolicy appends durable approval/policy — src/index.ts:100-105,150-156
- commands @deepseek-ai/dsh-commands: ctx.commands, register(definition): () => void, list(agent) — src/index.ts:277,285,315; systemPrompt @deepseek-ai/dsh-system-prompt: ctx.systemPrompt :422, section(section: PromptSection): () => void :454 (scoped shadowing, non-finite order throws), context() :489, SECTION_ORDERS :125-159
## 6 auto-review
- Lives at packages/experimental/auto-review, @deepseek-ai/dsh-experimental-auto-review, name='experimental-auto-review', inject ['approval','llm','permissionPresets','sessions','tools'] — src/index.ts:124-126; activated by cordis.patch.yml row id auto-review
- Reviews every native call and every started PTC inner call once before its body; outer run_code transport excluded — src/index.ts:1-9
- Decisions: only low+allow, medium+allow|deny, high+deny (+optional reason) — src/index.ts:64-67, README.md:87; an allow executes immediately with Full access
- Deny: under approval policy never a denial is final; under ask the user is asked — README.md:12,58. NO deny-only mode: it is the per-session Auto preset (AUTO_PRESET='auto' interaction/permission-presets/src/index.ts:82,89); rg 'denyOnly|deny-only|deny_only' over packages → no matches

EVIDENCE: .work/plan-v0.3/evidence/quality-05.md
