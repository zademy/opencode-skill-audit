// Headless test for the pure helpers. Run: node src/calc.test.ts
// Works unchanged on Windows (no shell-specific syntax, no cwd assumptions).

import assert from "node:assert/strict"
import {
  contextTokens,
  formatTokens,
  formatKB,
  buildSkillAudit,
  estimateTokens,
  buildContextBreakdown,
  proportionBar,
  nearThreshold,
} from "./calc.ts"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log("proportionBar")

check("fills proportionally to the whole", () => {
  assert.equal(proportionBar(50, 10), "█████░░░░░")
  assert.equal(proportionBar(100, 10), "██████████")
  assert.equal(proportionBar(0, 10), "░░░░░░░░░░")
})

check("gives a real cost at least one cell instead of nothing", () => {
  const bar = proportionBar(0.01, 40)
  assert.equal(bar.length, 40)
  assert.ok(bar.startsWith("█"))
})

check("clamps a runaway share instead of overflowing", () => {
  assert.equal(proportionBar(500, 10).length, 10)
  assert.equal(proportionBar(-20, 10), "░░░░░░░░░░")
  assert.equal(proportionBar(Number.NaN, 10), "░░░░░░░░░░")
})

check("a zero width yields an empty bar, not a crash", () => {
  assert.equal(proportionBar(50, 0), "")
})

console.log("nearThreshold")

check("warns before compaction actually hits", () => {
  assert.equal(nearThreshold(80_000, 100_000), true)
  assert.equal(nearThreshold(50_000, 100_000), false)
  assert.equal(nearThreshold(99_999, 100_000), true)
})

check("stays quiet when there is no threshold configured", () => {
  assert.equal(nearThreshold(50_000, 0), false)
  assert.equal(nearThreshold(0, 100_000), false)
})

console.log("buildSkillAudit")

check("separates always-on description cost from on-demand body cost", () => {
  const audit = buildSkillAudit(
    [
      { id: "grilling", description: "d" },
      { id: "big", description: "dd", content: "x".repeat(50) },
    ],
    new Map([["big", 50]]),
  )
  assert.equal(audit.total, 2)
  assert.equal(audit.advertisedCount, 2)
  assert.equal(audit.descChars, 3)
  assert.equal(audit.loadedCount, 1)
  assert.equal(audit.loadedChars, 50)
})

check("autoinvoke false is not advertised, so its description is not counted", () => {
  const audit = buildSkillAudit(
    [{ id: "manual", description: "hidden", autoinvoke: false }],
    new Map(),
  )
  assert.equal(audit.advertisedCount, 0)
  assert.equal(audit.descChars, 0)
  assert.equal(audit.total, 1)
})

check("a skill with no description is not advertised either", () => {
  const audit = buildSkillAudit([{ id: "bare", content: "body" }], new Map())
  assert.equal(audit.advertisedCount, 0)
})

check("marks loaded skills by either id or name", () => {
  const byName = buildSkillAudit(
    [{ id: "x", name: "friendly", description: "d" }],
    new Map([["friendly", 10]]),
  )
  const byId = buildSkillAudit(
    [{ id: "x", name: "friendly", description: "d" }],
    new Map([["x", 10]]),
  )
  assert.equal(byName.rows[0].loaded, true)
  assert.equal(byId.rows[0].loaded, true)
})

check("an empty catalog does not throw", () => {
  const audit = buildSkillAudit([], new Map())
  assert.equal(audit.total, 0)
  assert.equal(audit.descChars, 0)
})

console.log("contextTokens")

check("sums uncached input, cache read/write and reasoning", () => {
  assert.equal(
    contextTokens({ input: 1003, output: 190, reasoning: 124, cache: { read: 59977, write: 0 } }),
    1003 + 59977 + 124,
  )
})

check("treats a message with no cache as zero, not undefined", () => {
  assert.equal(contextTokens({ input: 500, output: 20 }), 500)
})

check("returns 0 for missing usage instead of throwing", () => {
  assert.equal(contextTokens(undefined), 0)
  assert.equal(contextTokens({}), 0)
})

console.log("formatTokens")

check("abbreviates thousands and millions", () => {
  assert.equal(formatTokens(200000), "200k")
  assert.equal(formatTokens(15000), "15k")
  assert.equal(formatTokens(1500), "1.5k")
  assert.equal(formatTokens(1050000), "1.05M")
})

check("keeps small values exact and zeroes safe", () => {
  assert.equal(formatTokens(512), "512")
  assert.equal(formatTokens(0), "0")
  assert.equal(formatTokens(-5), "0")
})

console.log("formatKB")

check("labels the unit because these are characters, not tokens", () => {
  assert.equal(formatKB(12400), "12.4 KB")
  assert.equal(formatKB(0), "0 KB")
})

console.log("estimateTokens")

check("divides characters at the documented ratio", () => {
  assert.equal(estimateTokens(400), 100)
  assert.equal(estimateTokens(0), 0)
  assert.equal(estimateTokens(-5), 0)
})

console.log("buildContextBreakdown")

const base = {
  windowTokens: 50_000,
  skillDescChars: 4_000,
  skillBodyChars: 8_000,
  agentChars: 2_000,
  mcpServers: 3,
  limit: 200_000,
  threshold: 15_000,
  buffer: 20_000,
  loadedSkills: 2,
  skillCount: 144,
  agentCount: 9,
}

check("itemises only the static parts, never the whole window twice", () => {
  const b = buildContextBreakdown(base)
  // descriptions 1k + bodies 2k + agents 0.5k = 3.5k of the 50k window
  assert.equal(b.knownTokens, 3_500)
  assert.equal(b.usedTokens, 50_000)
  assert.equal(b.unaccountedTokens, 46_500)
  assert.equal(b.freeTokens, 150_000)
})

check("the residual row absorbs the unmeasurable remainder", () => {
  const b = buildContextBreakdown(base)
  const residual = b.rows[3]
  assert.equal(residual.tokens, 46_500)
  assert.equal(residual.estimated, false)
})

check("the itemised rows are flagged as estimates", () => {
  const b = buildContextBreakdown(base)
  assert.equal(
    b.rows.slice(0, 3).every((row) => row.estimated),
    true,
  )
})

check("rows never exceed the window even if the catalog is huge", () => {
  const b = buildContextBreakdown({
    ...base,
    windowTokens: 10_000,
    skillDescChars: 400_000,
    skillBodyChars: 0,
    agentChars: 0,
  })
  assert.equal(b.unaccountedTokens, 0)
  assert.equal(b.rows[3].tokens, 0)
})

check("never reports negative free space", () => {
  const b = buildContextBreakdown({ ...base, windowTokens: 500_000 })
  assert.equal(b.freeTokens, 0)
})

check("a zero limit yields zero shares instead of NaN", () => {
  const b = buildContextBreakdown({ ...base, limit: 0 })
  assert.equal(
    b.rows.every((row) => row.share === 0),
    true,
  )
})

console.log(`\n${passed} checks passed`)
