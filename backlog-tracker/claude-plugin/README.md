# PH Agent Console plugin for Claude

Packages the PH Agent Console's MCP server
(`https://backlog-tracker-e4ed2.web.app/mcp`) as a Claude plugin, so a team
member installs one thing instead of adding a connector by hand.

| File | What |
| --- | --- |
| `.claude-plugin/plugin.json` | the plugin's name, version and description |
| `.mcp.json` | the connection: one remote HTTP server, no key |
| `skills/console/SKILL.md` | how an agent should use the console's tools |
| `skills/status/SKILL.md` | `/ph-agent-console:status`, a short read-only status report |

The marketplace entry that offers it is `.claude-plugin/marketplace.json`
at the repository root.

The plugin holds no credential. Each person signs in with their own
Personalisation Hub account the first time, exactly as with the hand-added
connector, and their role in the console decides what their agent can do.

Install and release steps are in `../MCP.md` under "Install it as a plugin".
