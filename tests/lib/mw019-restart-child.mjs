/**
 * One process of the durable-id restart probe (architecture §23.5; MW-018 §8.3,
 * MW-019).
 *
 * The claim under test is about *processes*: the fabric's default id source
 * mints `mem-<instance>-<n>` and a fresh process starts that counter over, so a
 * store that outlives the process is asked to create a record under an id it
 * already holds. Only a second process can show that, which is what this child
 * is for — it builds one fabric over the workspace it was handed and reports
 * what the retention answered.
 *
 * It prints exactly one JSON line and never throws: the parent asserts on the
 * report, so a child that died would read as a missing line rather than as a
 * pass.
 *
 * Usage: node mw019-restart-child.mjs <workspaceDir> <bdEntry> <default|sourced> <label>
 */

import { runCaptured } from '../../scripts/lib/process.mjs'
import { beads, core } from './fixtures.mjs'

/** Arguments: the workspace, the Beads entry point, the id source, and a label. */
const [workspace, bdEntry, mode, label] = process.argv.slice(2)

/** A runner over the real `bd`, with file-backed stdio instead of pipes. */
function fileBackedRunner(logDir) {
  let count = 0
  return {
    async run(command) {
      count += 1
      const result = runCaptured(process.execPath, [bdEntry, ...command.args], {
        cwd: command.cwd,
        env: process.env,
        logDir,
        logName: `child-${count}`,
      })
      if (result.error !== undefined) throw result.error
      return {
        code: result.status ?? 1,
        stdout: result.stdout.replace(/\r?\n$/, ''),
        stderr: result.stderr.replace(/\r?\n$/, ''),
      }
    },
  }
}

/** The report the parent reads. */
const report = { mode, label, ok: false, id: undefined, code: undefined }

try {
  const provider = beads.createBeadsMemoryProvider({
    runner: fileBackedRunner(`${workspace}/logs`),
    cwd: workspace,
    beadsDir: `${workspace}/.beads`,
  })
  const fabric = core.createMemoryFabric({
    providers: [{ provider: 'beads', port: provider }],
    policy: {
      routes: [{ match: { scope: 'workspace' }, primary: 'beads', optional: false }],
      timeoutMs: 30_000,
      diagnosticLimit: 20,
    },
    ...(mode === 'sourced' ? { nextId: beads.createBeadsMemoryIdSource({ provider }) } : {}),
  })
  const retained = await fabric.retain({
    proposal: {
      // The label matters: two identical proposals are the idempotent case and
      // would be reinforced rather than collide. What a restart does is retain a
      // *different* record under an id the previous process already used.
      statement: `a record the ${mode} process retains (${label})`,
      scope: { type: 'workspace', id: 'restart' },
      kind: 'fact',
      sources: [],
      createdBy: { component: 'mw019-restart-child' },
      trust: 'high',
    },
    actors: ['memory-provider'],
    meta: core.defineOperationMeta({ operationId: `op-${mode}-${label}`, correlationId: `corr-${mode}-${label}` }),
    nowMs: 1_700_000_000_000,
  })
  report.ok = retained.ok === true
  report.id = retained.ok === true ? retained.record.id : undefined
  report.code = retained.ok === true ? undefined : retained.code
} catch (error) {
  report.code = error?.code ?? String(error)
}

process.stdout.write(`${JSON.stringify(report)}\n`)
