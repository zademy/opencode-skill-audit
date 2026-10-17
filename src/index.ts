import { Plugin } from "@opencode/plugin"

/**
 * Server-runtime entry. This plugin is TUI-only: the footer and commands
 * live in the "./tui" export. The root exists so the server runtime loads
 * something valid instead of TUI code it cannot run.
 */
export default Plugin.define({
  id: "skill-audit",
  setup() {},
})
