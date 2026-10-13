// Pure formatting/aggregation for the context meter. No imports on purpose:
// this module is imported by both the TUI plugin and a headless test, so it
// must stay loadable without @opencode/plugin/tui or solid-js.

export type TokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export type CatalogSkill = {
  id: string
  name?: string
  description?: string
  content?: string
  autoinvoke?: boolean
}

export type SkillRow = {
  id: string
  name: string
  descChars: number
  bodyChars: number
  advertised: boolean
  loaded: boolean
}

export type SkillAudit = {
  rows: SkillRow[]
  total: number
  advertisedCount: number
  descChars: number
  loadedCount: number
  loadedChars: number
}

/**
 * Splits the skill catalog into what costs context on every single turn and
 * what only costs it when actually invoked.
 *
 * A skill is *advertised* when it has a description and is not marked
 * `autoinvoke: false` -- that description sits in the system prompt on every
 * request regardless of whether the skill is ever used. The body is only
 * paid for on activation, so `loadedChars` is what the session actually
 * spent.
 *
 * `loadedByName` maps an activated skill id to the characters it injected.
 */
export function buildSkillAudit(
  skills: CatalogSkill[],
  loadedByName: Map<string, number>,
): SkillAudit {
  const rows: SkillRow[] = skills.map((skill) => {
    const description = skill.description ?? ""
    const id = skill.name || skill.id
    const advertised = description.length > 0 && skill.autoinvoke !== false
    return {
      id,
      name: id,
      descChars: description.length,
      bodyChars: skill.content?.length ?? 0,
      advertised,
      loaded: loadedByName.has(skill.id) || loadedByName.has(id),
    }
  })

  return {
    rows,
    total: rows.length,
    advertisedCount: rows.filter((row) => row.advertised).length,
    descChars: rows.reduce((sum, row) => sum + (row.advertised ? row.descChars : 0), 0),
    loadedCount: loadedByName.size,
    loadedChars: [...loadedByName.values()].reduce((a, b) => a + b, 0),
  }
}

/**
 * Tokens the next request will carry.
 *
 * OpenCode reports per-message usage where `input` is only the uncached slice;
 * the rest of the window arrives as `cache.read`. Reasoning is generated
 * inside the window and is billed again on the following turn, so it counts
 * toward occupancy the same way Claude Code's statusline counts it.
 */
export function contextTokens(usage: TokenUsage | undefined): number {
  if (!usage) return 0
  const cache = usage.cache ?? {}
  return (usage.input ?? 0) + (cache.read ?? 0) + (cache.write ?? 0) + (usage.reasoning ?? 0)
}

/** 200000 -> "200k", 1050000 -> "1.05M". Thousands are abbreviated so the
 *  footer never wraps on a narrow terminal. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`.replace(/\.0k$/, "k")
  }
  const m = n / 1_000_000
  return `${m.toFixed(m < 10 ? 2 : 1)}M`.replace(/\.?0+M$/, "M")
}

/**
 * Skill bodies are measured in characters, not tokens -- OpenCode exposes no
 * tokenizer and a char count silently labelled "tokens" would be a lie. The
 * unit is spelled out in the output instead.
 */
export function formatKB(chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return "0 KB"
  return `${(chars / 1000).toFixed(1)} KB`
}

/**
 * OpenCode ships no tokenizer and exposes no way to count the system prompt or
 * built-in tool definitions, so a Claude-Code-style breakdown can only be exact
 * for the parts it reports. Everything derived from text is converted at 4
 * characters per token, which is the usual English average and lands within
 * roughly 10% -- hence every derived figure is labelled as an estimate.
 */
export const CHARS_PER_TOKEN = 4

export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0
  return Math.round(chars / CHARS_PER_TOKEN)
}

export type BreakdownRow = {
  label: string
  tokens: number
  share: number
  estimated: boolean
  detail?: string
}

export type ContextBreakdown = {
  rows: BreakdownRow[]
  knownTokens: number
  limit: number
  usedTokens: number
  freeTokens: number
  unaccountedTokens: number
  threshold: number
  buffer: number
}

/**
 * Builds the context table.
 *
 * The provider-reported figure is the size of the whole window, so it already
 * contains the skills, the agents, the system prompt and the tool definitions.
 * It is therefore NOT added to them -- doing so double-counts and can exceed the
 * window. Instead the measurable static parts are itemised and the remainder is
 * reported as one unattributed row.
 *
 * That remainder is real context that OpenCode simply does not expose: the
 * system prompt, the built-in tool definitions, the MCP tool schemas and the
 * conversation. Showing the gap is more honest than quietly rescaling the
 * known rows to fill it.
 *
 * Character-derived rows are estimates at CHARS_PER_TOKEN and are flagged.
 */
export function buildContextBreakdown(input: {
  windowTokens: number
  skillDescChars: number
  skillBodyChars: number
  agentChars: number
  mcpServers: number
  limit: number
  threshold: number
  buffer: number
  loadedSkills: number
  skillCount: number
  agentCount: number
}): ContextBreakdown {
  const used = input.windowTokens
  const share = (tokens: number) => (input.limit > 0 ? (tokens / input.limit) * 100 : 0)
  const desc = estimateTokens(input.skillDescChars)
  const bodies = estimateTokens(input.skillBodyChars)
  const agents = estimateTokens(input.agentChars)
  const known = desc + bodies + agents

  const rows: BreakdownRow[] = [
    {
      label: "Skill descriptions",
      tokens: desc,
      share: share(desc),
      estimated: true,
      detail: `${input.skillCount} skills - charged on every request`,
    },
    {
      label: "Skill bodies loaded",
      tokens: bodies,
      share: share(bodies),
      estimated: true,
      detail: `${input.loadedSkills} activated this session`,
    },
    {
      label: "Agent definitions",
      tokens: agents,
      share: share(agents),
      estimated: true,
      detail: `${input.agentCount} agents`,
    },
    {
      label: "System prompt, tools and conversation",
      tokens: Math.max(0, used - known),
      share: share(Math.max(0, used - known)),
      estimated: false,
      detail: `${input.mcpServers} MCP servers connected; their tool definitions are not exposed, so they sit in here`,
    },
  ]

  return {
    rows,
    knownTokens: known,
    limit: input.limit,
    usedTokens: used,
    freeTokens: Math.max(0, input.limit - used),
    unaccountedTokens: Math.max(0, used - known),
    threshold: input.threshold,
    buffer: input.buffer,
  }
}

/**
 * Proportion bar of a fixed width. `share` is a percentage of the whole.
 *
 * A row that rounds to zero cells still gets one, otherwise the small-but-real
 * costs (a few dozen tokens of agent text) would render as nothing at all and
 * the reader would conclude they are free.
 */
export function proportionBar(share: number, width = 40, filled = "█", empty = "░"): string {
  if (width <= 0) return ""
  const safe = Number.isFinite(share) ? Math.max(0, share) : 0
  const exact = (safe / 100) * width
  const cells = Math.max(exact > 0 ? 1 : 0, Math.min(width, Math.round(exact)))
  return filled.repeat(cells) + empty.repeat(width - cells)
}

/**
 * True once the window is within `margin` percent of the compaction point.
 * Used to warn before the user is surprised by an automatic compaction.
 */
export function nearThreshold(usedTokens: number, threshold: number, margin = 0.8): boolean {
  if (threshold <= 0 || usedTokens <= 0) return false
  return usedTokens >= threshold * margin
}
