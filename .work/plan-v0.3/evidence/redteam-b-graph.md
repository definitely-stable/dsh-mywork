# Red Team B — сырые выводы скриптов (кампания v0.3, 2026-09-27)

Скрипты: `.tmp/plan-v03-red-b/{graph,crosschecks,crosschecks2,cedits,sidebyside,stepcards}.ps1`.
Все команды — только чтение; `.work/tasks/**` не изменялся.

## 1. `graph.ps1` — 55 узлов (факт) и 73 узла (предложение §3.21)

```text
########## A. CURRENT ##########
== A. CURRENT ledger (tasks.json as-is, 55 nodes) : nodes=55 ==
dangling (dep is not a node): 0
self-deps: 0 
deps targeting superseded (MW-027/MW-035): 2
   MW-035 -> MW-027 (status=superseded)
   MW-038 -> MW-027 (status=superseded)
cycles: 0
topological order covered 55 of 55 nodes (unequal => cycle present)
-- declared depth vs computed --
-- roots (depth 0) --
   MW-001
-- sinks (nobody depends on them) --
   MW-035, MW-041, MW-051, MW-052

########## B. PROPOSED ##########
== B. PROPOSED ledger (55 + 18 = 73 nodes, with 3.21 overrides) : nodes=73 ==
dangling (dep is not a node): 0
self-deps: 0 
deps targeting superseded (MW-027/MW-035): 1
   MW-035 -> MW-027 (status=superseded)
cycles: 0
topological order covered 73 of 73 nodes (unequal => cycle present)
-- declared depth vs computed --
   MW-056: computed=0 declared=0
   MW-057: computed=1 declared=1
   MW-058: computed=8 declared=8
   MW-059: computed=4 declared=4
   MW-060: computed=0 declared=0
   MW-061: computed=17 declared=17
   MW-062: computed=7 declared=7
   MW-063: computed=19 declared=19
   MW-064: computed=4 declared=4
   MW-065: computed=20 declared=20
   MW-066: computed=12 declared=12
   MW-067: computed=16 declared=16
   MW-068: computed=9 declared=9
   MW-069: computed=13 declared=13
   MW-070: computed=8 declared=8
   MW-071: computed=1 declared=1
   MW-073: computed=20 declared=20
   MW-074: computed=9 declared=9
-- roots (depth 0) --
   MW-001, MW-056, MW-060
-- sinks (nobody depends on them) --
   MW-035, MW-041, MW-051, MW-052, MW-057, MW-061, MW-062, MW-065, MW-066, MW-067, MW-068, MW-069, MW-070, MW-074

########## C. reverse refs (proposed graph) ##########
   MW-027: <- MW-035
   MW-035: <- (никто)
   MW-038: <- MW-039, MW-041, MW-055
   MW-041: <- (никто)
   MW-042: <- MW-038, MW-043, MW-047, MW-049, MW-052, MW-064
   MW-043: <- MW-029
   MW-046: <- MW-050
   MW-047: <- MW-029, MW-038, MW-054, MW-073
   MW-048: <- MW-036, MW-037, MW-049, MW-051, MW-063
   MW-049: <- MW-050, MW-052
   MW-050: <- MW-053
   MW-053: <- MW-055
   MW-054: <- MW-055, MW-073
   MW-055: <- MW-041
   MW-064: <- MW-049, MW-050
   MW-060: <- MW-041, MW-063, MW-071
   MW-063: <- MW-041
   MW-059: <- MW-058, MW-062, MW-068
   MW-058: <- MW-068, MW-074
   MW-048: <- MW-036, MW-037, MW-049, MW-051, MW-063

########## D. current dependsOn of every card ##########
   MW-001 [planned] 00-foundation  deps=
   MW-002 [planned] 00-foundation  deps=MW-001
   MW-003 [planned] 00-foundation  deps=MW-002
   MW-004 [planned] 00-foundation  deps=MW-003
   MW-005 [planned] 00-foundation  deps=MW-003
   MW-006 [planned] 00-foundation  deps=MW-004,MW-005
   MW-007 [planned] 00-foundation  deps=MW-005,MW-006
   MW-008 [planned] 00-foundation  deps=MW-004,MW-007
   MW-009 [planned] 01-runtime  deps=MW-004,MW-008
   MW-010 [planned] 01-runtime  deps=MW-005,MW-009
   MW-011 [planned] 01-runtime  deps=MW-010
   MW-012 [planned] 01-runtime  deps=MW-009,MW-010,MW-011
   MW-013 [planned] 01-runtime  deps=MW-005,MW-006,MW-007
   MW-014 [planned] 01-runtime  deps=MW-012,MW-013
   MW-015 [planned] 01-runtime  deps=MW-005,MW-007,MW-013
   MW-016 [planned] 02-context  deps=MW-005,MW-006,MW-008,MW-013
   MW-017 [planned] 02-context  deps=MW-006,MW-016
   MW-018 [planned] 02-context  deps=MW-005,MW-008,MW-016
   MW-019 [planned] 02-context  deps=MW-018
   MW-020 [planned] 02-context  deps=MW-008,MW-015,MW-016
   MW-021 [planned] 03-execution  deps=MW-008,MW-012
   MW-022 [planned] 03-execution  deps=MW-014,MW-015,MW-016,MW-017,MW-018,MW-020,MW-021
   MW-023 [planned] 03-execution  deps=MW-022
   MW-024 [planned] 03-execution  deps=MW-015,MW-020,MW-023
   MW-025 [planned] 03-execution  deps=MW-010,MW-021,MW-024
   MW-026 [planned] 03-execution  deps=MW-011,MW-015,MW-016
   MW-027 [superseded] 04-control  deps=MW-005,MW-010,MW-025
   MW-028 [planned] 04-control  deps=MW-009,MW-014,MW-022,MW-025
   MW-029 [planned] 04-control  deps=MW-018,MW-026,MW-028,MW-043,MW-047
   MW-030 [planned] 04-control  deps=MW-007,MW-012,MW-020,MW-029
   MW-031 [planned] 04-control  deps=MW-012,MW-014,MW-020,MW-025,MW-030
   MW-032 [planned] 05-learning  deps=MW-017,MW-018,MW-024
   MW-033 [planned] 05-learning  deps=MW-006,MW-013,MW-032
   MW-034 [planned] 05-learning  deps=MW-013,MW-016,MW-020,MW-025,MW-032
   MW-035 [superseded] 06-ui  deps=MW-027,MW-029,MW-034
   MW-036 [planned] 06-ui  deps=MW-006,MW-029,MW-030,MW-048
   MW-037 [planned] 06-ui  deps=MW-033,MW-034,MW-048
   MW-038 [planned] 07-acceptance  deps=MW-010,MW-015,MW-019,MW-027,MW-029,MW-031
   MW-039 [planned] 07-acceptance  deps=MW-007,MW-024,MW-025,MW-030,MW-031,MW-033,MW-038
   MW-040 [planned] 07-acceptance  deps=MW-004,MW-039
   MW-041 [planned] 07-acceptance  deps=MW-028,MW-036,MW-037,MW-038,MW-039,MW-040,MW-055
   MW-042 [planned] 01b-board  deps=MW-003
   MW-043 [planned] 04b-board  deps=MW-042,MW-011,MW-026
   MW-044 [planned] 04b-board  deps=MW-011,MW-014,MW-022,MW-025
   MW-045 [planned] 04b-board  deps=MW-044,MW-023,MW-025
   MW-046 [planned] 04b-board  deps=MW-012,MW-022,MW-030
   MW-047 [planned] 04b-board  deps=MW-042,MW-010,MW-011,MW-025
   MW-048 [planned] 06-ui  deps=MW-029
   MW-049 [planned] 06-ui  deps=MW-048,MW-042
   MW-050 [planned] 06-ui  deps=MW-049,MW-046
   MW-051 [planned] 06-ui  deps=MW-044,MW-045,MW-048
   MW-052 [planned] 06-ui  deps=MW-049,MW-042
   MW-053 [planned] 06-ui  deps=MW-050
   MW-054 [planned] 07-migration  deps=MW-047,MW-029,MW-030
   MW-055 [planned] 07-acceptance  deps=MW-053,MW-054,MW-031,MW-038,MW-039

```

