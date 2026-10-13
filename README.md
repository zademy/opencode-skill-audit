# skill-audit

An OpenCode v2 TUI plugin that reports what is filling the context window, on
demand. Nothing is drawn in the TUI until you type one of two commands:

| Command        | What it shows                                                       |
| -------------- | ------------------------------------------------------------------- |
| `/context`     | Category breakdown of the window: skills, agents, and the remainder |
| `/skill-audit` | Every skill, split by advertised vs loaded, with its size           |

A skill activation is a `skill` **tool call**, not a message. `type=skill` on
the message API returns nothing even for a session that has loaded several
skills, so the plugin reads the tool parts.

## Build and install

Two steps, done by hand.

**1. Compile.**

```sh
npm run build
```

`src/*.ts` becomes `dist/*.js`.

**2. Create the plugin folder and copy the two files into it.**

macOS / Linux:

```sh
mkdir -p ~/.config/opencode/plugins/skill-audit
cp dist/tui.js dist/calc.js ~/.config/opencode/plugins/skill-audit/
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\opencode\plugins\skill-audit" | Out-Null
Copy-Item dist\tui.js, dist\calc.js "$HOME\.config\opencode\plugins\skill-audit\"
```

Result:

```
~/.config/opencode/plugins/skill-audit/
  tui.js      <- entrypoint
  calc.js
```

Redo both steps whenever you edit `src/`. OpenCode picks up new files on its own
within ~100ms, so there is no restart.

Two details that are easy to get wrong:

- `tui.js` must sit at the **root** of the plugin folder. OpenCode discovers a
  directory plugin from `<dir>/tui.*`; a folder holding `tui.js` inside a `dist/`
  subfolder is silently **not** loaded, with no error anywhere.
- Do not put a `package.json` in the plugin folder. It is inert there, and its
  `exports` field would be a lie: it describes `./src/tui.tsx` while the real
  entrypoint is `tui.js` at the root. Verified on v2.0.26 - deleting it changes
  nothing and the path never appears in the log. That field only matters for a
  package published to npm, which this is not.

Run `npm install` once beforehand. The plugin path is XDG-style on **every**
platform, including native Windows where it is
`C:\Users\<you>\.config\opencode\plugins\` - not `%APPDATA%`. That is
deliberate, not an oversight.

Confirm it was picked up:

```sh
opencode plugin list
```

`skill-audit` should appear with source `local`.

Note that appearing there is not proof it loaded - it lists plugins whose source
has a syntax error. The real check is the log:

```sh
grep 'plugin operation failed' ~/.local/share/opencode/log/opencode.log | tail -5
```

## `/skill-audit`

Type `/skill-audit` in the TUI for a searchable list of every skill OpenCode
knows about, split by what each one actually costs:

```
166 skills · 144 advertised · 52.9 KB in every prompt
○ grilling           1.1 KB every prompt
○ writing-skills     3.4 KB every prompt
● grilling           12.6 KB · 48.2 KB body
```

| Marker     | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| filled dot | Loaded — its body is in this session's window right now        |
| hollow dot | Advertised — only its description is in the prompt, every turn |
| small dot  | Not advertised (`autoinvoke: false`, or no description)        |

| Marker     | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| filled dot | Loaded — its body is in this session's window right now        |
| hollow dot | Advertised — only its description is in the prompt, every turn |
| small dot  | Not advertised (`autoinvoke: false`, or no description)        |

This is the distinction that matters. A skill is **not** loaded just because
it exists. What costs context permanently is the _set of descriptions_, and on
a typical install that is the larger number: measured here, 52,952 characters
of descriptions across 144 skills, versus 1,277,582 characters of bodies that
only arrive when a skill is actually invoked. One skill on its own
(`scroll-world`) is 47,931 characters of body.

Rows are ordered loaded-first, then by description size, so the biggest
permanent cost sits at the top. Typing filters by name.

## `/context`

The category breakdown, in the spirit of Claude Code's `/context`:

```
Context                                   anthropic/claude-sonnet-4-5

████████████████████████░░░░░░░░░░░░░░░░░  61.4%
612.3k of 1M

  Category                     Tokens   Share
  Skill descriptions            13.2k~     1.3%
    144 skills — charged on every request
  Skill bodies loaded             3.7k~     0.4%
    2 activated this session
  Agent definitions               1.1k~     0.1%
    9 agents
  System prompt, tools, chat    594.3k     59.4%
    3 MCP servers; their tool definitions are not exposed, so they sit in here

  Free                         387.7k     38.8%   compaction 15k +20k

~ estimated from characters (÷4); system prompt and built-in tools are not exposed
```

`~` marks an estimate. The window total is measured by the provider and is
exact; everything derived from text is converted at 4 characters per token,
because OpenCode ships no tokenizer.

The last row is the honest part: OpenCode exposes neither the system prompt nor
the built-in tool definitions, and `Mcp.Server` carries no tool schemas. That
context is real, so it is reported as one unnamed remainder rather than being
quietly redistributed across the rows above it. Note that the provider figure
_is_ the whole window, so it is never added to the itemised rows — doing so
double-counts.

## Verify

```sh
npm run check        # format:check + lint + typecheck + build:check + test
npm run format       # prettier --write .
npm run lint         # eslint
npm run build        # compile src/ to dist/
npm test             # 18 checks, pure formatting and aggregation
```

The rendered output has no automated test. Every accessor is wrapped so a name
that moves degrades to an empty row rather than an exception, and every number
is computed by a tested pure function in `src/calc.ts`.

## Limitations

- Skill scanning reads the cached message page, which the TUI caps at the most
  recent 50 messages. This is intentional: a compaction drops those bodies from
  the window too, so recent history is what the percentage is measuring.
- Compaction config is read once at startup, so changing
  `compaction.keep.tokens` needs an OpenCode restart.
- State is in-memory only. Nothing is persisted across sessions.
- Known OpenCode bug [#50710](https://github.com/sst/opencode/issues/50710):
  on native Windows a global config can read correctly while the running service
  registers zero entries. If the footer shows nothing on Windows, run
  `opencode plugin list` first — if `skill-audit` is absent the plugin never
  loaded, which is that bug and not this plugin.
