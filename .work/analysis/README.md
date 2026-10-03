# Historical analysis corpus

Everything under `.work/analysis/<date>/` is a frozen historical research snapshot.
It records the facts, assumptions, platform versions, rejected alternatives and
recommendations that were true when that campaign ran. It is evidence for why
later decisions changed; it is **not** an executable plan and it is not current
repository guidance.

For current work use, in order:

1. the actual `main` source/tests/CI state;
2. `.work/plan-v0.3/01-MASTER-PLAN.md` §1.4 and §16–§18;
3. `.work/plan-v0.3/02-PLATFORM-DELTA-0.2.0-rc.2.md`;
4. the specific current step/evidence file named by the master plan.

Old versions, commit ids, peer ranges, line anchors and commands inside dated
analysis folders must not be copied into current code or plans without
re-verification. In particular, the 2026-09-26 corpus predates the
`0.2.0-rc.2` platform re-anchor and may intentionally contain the superseded
peer range `>=0.1.7-rc.2 <0.2.0`.

## Citation-gate boundary

`scripts/check-plan-citations.mjs` intentionally scans the current
`.work/plan-v0.3` corpus plus tracked repository surfaces. It does not scan
`.work/analysis/**`. That exclusion is deliberate: changing historical
evidence to make a current lexical gate green would rewrite the record of the
earlier campaign.

If a historical conclusion becomes relevant again, re-verify it against the
current repository/platform and record the new conclusion in the current plan
or a new dated analysis corpus; do not silently edit the old conclusion into a
current one.
