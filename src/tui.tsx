import { Plugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import {
  contextTokens,
  formatTokens,
  formatKB,
  buildSkillAudit,
  buildContextBreakdown,
  proportionBar,
  nearThreshold,
} from "./calc.ts"

/**
 * On-demand context reporting. Nothing renders in the TUI until you ask:
 *
 *   /context      what is filling the window, broken down by category
 *   /skill-audit  every skill OpenCode knows, split by what each one costs
 *
 * Skill activations are recorded as `skill` tool calls, not as messages.
 * Verified against the live API: a session that loaded four skills returns zero
 * results for `type=skill`. The tool's content array is the exact text injected
 * into the window, so its length is the real cost.
 */
function loadedSkillMap(messages: any[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const message of messages) {
    for (const part of (message as any)?.content ?? []) {
      if (part?.type !== "tool" || part?.name !== "skill") continue
      const name = part?.state?.input?.id
      if (!name) continue
      let chars = 0
      for (const chunk of part?.state?.content ?? []) chars += String(chunk?.text ?? "").length
      out.set(name, Math.max(out.get(name) ?? 0, chars))
    }
  }
  return out
}

/**
 * OpenCode exposes no "current session" accessor, so this assumes the session
 * touched most recently is the one on screen. That holds for a foreground TUI; it
 * would be wrong if you switched tabs without sending anything.
 */
function currentSession(context: any): any {
  const all = context.data.session.list()
  if (!Array.isArray(all) || all.length === 0) return undefined
  return all.slice().sort((a: any, b: any) => (b?.time?.updated ?? 0) - (a?.time?.updated ?? 0))[0]
}

const BAR_WIDTH = 62
const COL_LABEL = 48
const COL_VALUE = 10
const COL_SHARE = 8

export default Plugin.define({
  id: "skill-audit",
  setup(context) {
    const muted = () => context.theme?.text?.muted ?? context.theme?.text?.base
    const alert = () =>
      context.theme?.warning ?? context.theme?.error ?? context.theme?.text?.feedback

    const read = () => {
      const session = currentSession(context)
      const messages = session ? (context.data.session.message.list(session.id) ?? []) : []
      const catalog = context.data.location?.skill?.list?.(context.location) ?? []
      const agents = context.data.location?.agent?.list?.(context.location) ?? []
      const servers = context.data.location?.mcp?.server?.list?.(context.location) ?? []
      const loaded = loadedSkillMap(messages)

      let windowTokens = 0
      for (let i = messages.length - 1; i >= 0; i--) {
        const usage = (messages[i] as any)?.tokens
        if (usage) {
          windowTokens = contextTokens(usage)
          break
        }
      }

      const model = session?.model
      const models = context.data.location?.model?.list?.(context.location) ?? []
      const limit =
        (Array.isArray(models) ? models : []).find(
          (m: any) => m?.providerID === model?.providerID && m?.modelID === model?.id,
        )?.limit?.context ?? 0

      const agentChars = agents.reduce(
        (sum: number, agent: any) =>
          sum + String(agent?.description ?? "").length + String(agent?.system ?? "").length,
        0,
      )

      return { catalog, agents, servers, loaded, windowTokens, model, limit, agentChars }
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "skill-audit.context",
          title: "Context breakdown",
          group: "Skill audit",
          slash: { name: "context" },
          run: async () => {
            const state = read()
            const audit = buildSkillAudit(state.catalog, state.loaded)
            const config = await (context.client as any)?.config?.get?.().catch(() => undefined)

            const breakdown = buildContextBreakdown({
              windowTokens: state.windowTokens,
              skillDescChars: state.catalog.reduce(
                (sum: number, s: any) =>
                  sum + (s?.autoinvoke === false ? 0 : String(s?.description ?? "").length),
                0,
              ),
              skillBodyChars: audit.loadedChars,
              agentChars: state.agentChars,
              mcpServers: Array.isArray(state.servers) ? state.servers.length : 0,
              limit: state.limit,
              threshold: config?.compaction?.keep?.tokens ?? 0,
              buffer: config?.compaction?.buffer ?? 0,
              loadedSkills: audit.loadedCount,
              skillCount: audit.advertisedCount,
              agentCount: Array.isArray(state.agents) ? state.agents.length : 0,
            })

            const pct = (tokens: number) =>
              state.limit > 0 ? `${((tokens / state.limit) * 100).toFixed(1)}%` : "-"
            const usedPct = state.limit > 0 ? (state.windowTokens / state.limit) * 100 : 0
            const warn = nearThreshold(state.windowTokens, breakdown.threshold)

            context.ui.dialog.set({ size: "large", centered: true })
            context.ui.dialog.show(
              () => (
                <box flexDirection="column" padding={1}>
                  <box flexDirection="row" alignItems="baseline">
                    <text fg={context.theme?.text?.base}>Context</text>
                    <text fg={muted()}>{state.model?.modelID ?? "unknown model"}</text>
                  </box>

                  <box flexDirection="row" alignItems="baseline" marginTop={1} gap={2}>
                    <text fg={warn ? alert() : context.theme?.text?.base}>
                      {proportionBar(usedPct, BAR_WIDTH)}
                    </text>
                    <text
                      width={7}
                      textAlign="right"
                      fg={warn ? alert() : context.theme?.text?.base}
                    >
                      {usedPct.toFixed(1) + "%"}
                    </text>
                  </box>
                  <text fg={muted()}>
                    {formatTokens(breakdown.usedTokens) + " of " + formatTokens(breakdown.limit)}
                  </text>

                  <box flexDirection="row" marginTop={1}>
                    <text width={COL_LABEL} fg={muted()} truncate>
                      Category
                    </text>
                    <text width={COL_VALUE} textAlign="right" fg={muted()}>
                      Tokens
                    </text>
                    <text width={COL_SHARE} textAlign="right" fg={muted()}>
                      Share
                    </text>
                  </box>

                  <For each={breakdown.rows}>
                    {(row) => (
                      <box flexDirection="column">
                        <box flexDirection="row" alignItems="baseline">
                          <text
                            width={COL_LABEL}
                            truncate
                            fg={row.estimated ? muted() : context.theme?.text?.base}
                          >
                            {row.label}
                          </text>
                          <text
                            width={COL_VALUE}
                            textAlign="right"
                            fg={row.estimated ? muted() : context.theme?.text?.base}
                          >
                            {(row.estimated ? "~" : "") + formatTokens(row.tokens)}
                          </text>
                          <text width={COL_SHARE} textAlign="right" fg={muted()}>
                            {pct(row.tokens)}
                          </text>
                        </box>
                        <Show when={row.detail}>
                          <text fg={muted()} paddingLeft={2} truncate>
                            {row.detail}
                          </text>
                        </Show>
                      </box>
                    )}
                  </For>

                  <box flexDirection="row" marginTop={1} alignItems="baseline">
                    <text width={COL_LABEL} fg={muted()}>
                      Free
                    </text>
                    <text width={COL_VALUE} textAlign="right" fg={muted()}>
                      {formatTokens(breakdown.freeTokens)}
                    </text>
                    <Show when={breakdown.threshold > 0}>
                      <box flexDirection="row" width={COL_SHARE + 14}>
                        <text textAlign="right" fg={warn ? alert() : muted()} truncate>
                          {"compaction " +
                            formatTokens(breakdown.threshold) +
                            (breakdown.buffer > 0 ? " +" + formatTokens(breakdown.buffer) : "")}
                        </text>
                      </box>
                    </Show>
                  </box>

                  <Show when={warn}>
                    <text fg={alert()}>Approaching compaction — compact now to free context.</text>
                  </Show>

                  <text fg={muted()} marginTop={1} truncate>
                    ~ estimated from characters (÷4); system prompt and tools not exposed
                  </text>
                </box>
              ),
              () => {},
            )
          },
        },
        {
          id: "skill-audit.audit",
          title: "Skill audit",
          group: "Skill audit",
          slash: { name: "skill-audit" },
          run: async () => {
            const state = read()
            const audit = buildSkillAudit(state.catalog, state.loaded)

            const options = audit.rows.map((row) => ({
              title: (row.loaded ? "● " : "○ ") + row.name,
              description: formatKB(row.descChars + row.bodyChars),
              value: row.id,
              loaded: row.loaded,
              descChars: row.descChars,
              bodyChars: row.bodyChars,
              category: row.loaded ? "Loaded this session" : "Not loaded",
            }))

            // A leading slash switches sort/filter mode. Skill names never start
            // with one, so this cannot collide with the name search.
            const bySize = (a: any, b: any) =>
              Number(b.loaded) - Number(a.loaded) || b.descChars - a.descChars
            const byName = (a: any, b: any) => a.value.localeCompare(b.value)
            const byBody = (a: any, b: any) => b.bodyChars - a.bodyChars

            await context.ui.dialog.select({
              title:
                audit.advertisedCount +
                "/" +
                audit.total +
                " advertised · " +
                formatKB(audit.descChars) +
                " in every prompt",
              placeholder: "/unused · /big · /name · /size",
              options: options as any,
              search: (query, all) => {
                const q = query.trim().toLowerCase()
                if (q === "/unused") {
                  return all.filter((o: any) => !o.loaded).sort(byBody)
                }
                if (q === "/big") return [...all].sort(byBody)
                if (q === "/name") return [...all].sort(byName)
                if (q === "/size") return [...all].sort(bySize)
                if (q.startsWith("/")) return [...all].sort(bySize)
                return q
                  ? all.filter((o: any) => o.value.toLowerCase().includes(q))
                  : [...all].sort(bySize)
              },
            })
          },
        },
      ],
    }))
  },
})
