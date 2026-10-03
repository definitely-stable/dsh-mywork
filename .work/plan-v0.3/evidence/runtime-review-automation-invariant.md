# Runtime composition review-automation slice

Date: 2026-10-03  
Base: `main@3ce9a65eb09b321857a280c3bb8ed8c6f6b7a087`  
Branch: `runtime/review-automation-invariant`

## Purpose

Before arming the scheduler, remove two false blockers from the canonical plan and
prove the review safety boundary on the public production API.

This slice does not arm the scheduler and does not invent scheduler state. It
keeps the fail-closed Runtime Composition sequence established by PRs #2–#4.

## Finding R-42

The master plan still described R-42 as open, but the stage-4 production
`ReviewQueue` already enforces actor provenance:

- `approveReview` admits the actor before reading Git state or applying the
  transition;
- an actor with `kind: 'automatic'` is refused with `SECURITY_DENIED`;
- an automatic `allow` verdict is advisory and requires the
  `security-change` human gate;
- an automatic `deny` may enter only the request-changes / reject path.

The pure `core.transitionReview` state machine deliberately has no actor
provenance and is not an admission API. The production boundary that owns
provenance is `ReviewQueue`.

## Regression coverage added

`tests/review-staleness.test.mjs` now proves that an automatic actor cannot
approve through `ReviewQueue.approveReview`, leaves the claim/revision
unchanged, and writes no approval artifact. It also proves that
`ruleOnAutomaticVerdict('allow')` requires a human decision without mutating
the claim.

`tests/review-reject.test.mjs` now proves the non-vacuous other half: an
automatic `deny` may request changes, while an automatic `allow` cannot be
converted into a synthetic rejection and leaves Task/Review state unchanged.

## Documentation reconciliation

- root `README.md` now states that `.work/` is tracked and `check:plan`
  consumes the plan corpus;
- `.work/EXECUTION-PLAN.md` is explicitly historical/superseded;
- `.work/README.md` no longer tells new work to restart at MW-001;
- R-42 is marked fixed at the production queue boundary;
- R-53 is closed by assigning one owner/carrier per test concern and removing
  competing total pass-counts.

## Runtime Composition research for the next slice

Two platform seams were checked against DSH `0.2.0-rc.2`:

1. `ctx.workspaceRegistry.list()` owns platform workspace identity/path/session
   membership. It does **not** own MyWork's scheduler policy: enabled flag,
   Team roster, pools, role limits, workspace limits, scheduling shares,
   BudgetLimits or ledgers. Therefore it cannot truthfully synthesize a
   `SchedulerWorkspaceState`.
2. `ctx.agents.list()` enumerates live DSH Agents, but the public Agent value
   carries the session-backed id only. It does not carry the durable MyWork
   `AgentIdentity`, pool, role, workspace binding or §15 resource state required
   by `SchedulerInstanceObservation`.

Conclusion: neither missing scheduler source may be filled with guessed defaults
or a platform-only projection. The next Runtime Composition implementation must
first establish the authoritative MyWork Team/Workspace/Agent state (or an
explicit durable binding to it), then derive `workspaces`, `agents`, and
`instances`. Until then the scheduler remains deliberately unarmed.

## Acceptance for this slice

Required before merge:

1. targeted review tests pass;
2. root typecheck/build/smoke/unit contract gate passes;
3. `check:plan` passes with `scope=full`;
4. real Beads CI remains green;
5. DSH profile install/mount Gate P remains green;
6. no production source path was weakened to turn missing scheduler authority
   into an empty collection.
