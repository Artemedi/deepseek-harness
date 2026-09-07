# 2026-09-05 — standard-claude default preset, claude preset, and Claude Code OAuth proxy cleanup

## Context

The `web` profile ships a user-authored preset `standard-claude` as the default agent preset (configured in `~/.dsh/profiles/web/cordis.patch.yml`). This preset uses the **Claude Code** product provider for the `subagent` delegation tool, while `subagent_fork` remains on the local `fork` provider.

Today `subagent` started failing with:

```
Product subagent failure (product: Claude Code; stage: query-run; category: invalid-success; exit code: 1)
```

The same call through `subagent_fork` succeeded.

## Root cause

Two layers combined to break the call:

1. **Claude CLI OAuth was stale/expired.**  
   `~/.claude/.credentials.json` had empty `accessToken`, `refreshToken`, `expiresAt: 0`, and `refreshTokenExpiresAt` in the past. Running `claude auth logout && claude auth login` refreshed the tokens and `claude -p "say hello"` then worked.

2. **A dead proxy `ANTHROPIC_BASE_URL=https://api.wello.dev` was present in `~/.claude/settings.json`.**  
   Even with valid OAuth, the CLI honours `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` from `settings.json` over the native OAuth tokens. The Wello key (`wlo_live_...`) had been rate-limited (402). Removing those env vars from `settings.json` restored the native path.

The `subagent-claude-code` provider composes the child environment as:

```ts
env: { ...scrubbedParentEnv(), ...spec.env }
```

where `scrubbedParentEnv()` strips `KEY|PASSWORD|SECRET|TOKEN` and `DSH_*` names. It does **not** add the host OAuth tokens. The SDK therefore sees neither the OAuth tokens nor a valid `ANTHROPIC_BASE_URL`, and the CLI exits 1 → SDK reports `invalid-success`.

## Decision

- Keep `standard-claude` as the default preset for the `web` profile.
- Add a new shipped preset **`claude`** (`apps/cli/config/agent-presets/claude/`) whose both `subagent` and `subagent_fork` route to the Claude Code product provider for maximum delivery.
- Document the working OAuth path for `subagent-claude-code`, the typical failure modes (expired OAuth, stale proxy env, missing Bundle), and how to switch between `standard` (all-local subagents) and `standard-claude`/`claude` (Claude Code subagents).

## Files added / changed

| File | Purpose |
|------|---------|
| `apps/cli/config/agent-presets/claude/agent.cordis.yml` | New preset: both `subagent` and `subagent_fork` route to Claude Code provider |
| `apps/cli/config/agent-presets/claude/preset.yml` | Metadata for the new preset |
| `packages/subagent/subagent-claude-code/README.md` | Added "Authentication and the OAuth lifecycle" section with diagnostic checklist and smoke test |
| `.agents/notes/implemented/architecture/2026-09-05-standard-claude-subagent-oauth.md` | This note |

## Preset routing

| Preset | Primary chat | `subagent` | `subagent_fork` | Use case |
|--------|--------------|------------|-----------------|----------|
| `standard` | free-router | `spawn` | `fork` | All-local, no Claude Code dependency |
| `standard-claude` | free-router | `claude-code` | `fork` | Claude Code subagent when OAuth is valid |
| `claude` | free-router | `claude-code` | `claude-code` | Maximum delivery when Claude Code auth is valid |

## OAuth requirements for Claude Code subagents

This deployment relies on the host Claude CLI's native OAuth. The `subagent-claude-code` provider does **not** forward host OAuth tokens to the child; the child inherits the host CLI's own settings and credentials. This is by design (see `2026-08-04-claude-code-and-codex-subagent-backends.md`).

When the host OAuth is missing, expired, or its refresh window has passed, the Claude Code subagent fails with `invalid-success`. Verify in this order:

1. `claude -p "say hello"` from the same shell that runs the DSH host process. If this fails, fix the Claude CLI first.
2. `cat ~/.claude/.credentials.json` — the `claudeAiOauth` block must have a non-empty `accessToken` and a future `refreshTokenExpiresAt`.
3. `cat ~/.claude/settings.json` — make sure the `env` block does **not** carry a stale `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` pointing at a defunct upstream. Claude Code prefers those env vars over OAuth tokens and will silently route through the wrong endpoint.
4. `dsh plugin --profile <name> list | grep subagent-claude-code` — confirm the Bundle is installed.

## How to switch presets

- In the DSH Web UI: Settings → Agent preset → choose `standard`, `standard-claude`, or `claude`.
- From a running session: preset change requires a new session; the preset binds at session start.

## Consequences

The `standard-claude` preset remains available when the operator wants Claude Code for subagents, but it now has explicit documentation for the OAuth dependency. The `claude` preset routes both delegation tools to Claude Code for maximum delivery. The `standard` preset remains the safest fallback when Claude Code auth is unavailable.

## Next steps

- Consider adding an explicit `env` forwarding option to `subagent-claude-code` for hermetic runs (deferred).
