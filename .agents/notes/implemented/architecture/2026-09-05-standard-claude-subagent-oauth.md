# Agent Note: Standard Claude presets and Claude Code OAuth cleanup

Status: implemented

English | [中文](2026-09-05-standard-claude-subagent-oauth.zh.md)

## Problem

The `web` profile uses the user-authored `standard-claude` preset as its default Agent preset. Its `subagent` tool delegates through the Claude Code product provider while `subagent_fork` remains local. A stale Claude CLI login and an obsolete proxy in the host settings caused delegated calls to exit unsuccessfully even though local forks still worked. Operators had no repository documentation that distinguished these authentication paths or explained which presets depend on Claude Code.

## Decision

Keep `standard-claude` available and ship the `claude` preset under `apps/cli/config/agent-presets/claude/`. The `claude` preset routes both `subagent` and `subagent_fork` through the Claude Code product provider; `standard-claude` routes only `subagent` through Claude Code; `standard` keeps both delegation paths local.

The `subagent-claude-code` provider constructs the child environment from the scrubbed parent environment and the explicit request environment:

```ts
const childEnvironment = { ...scrubbedParentEnv(), ...spec.env }
```

`scrubbedParentEnv()` removes names matching credential-like keys and `DSH_*`. It does not copy OAuth tokens into the child process. Claude Code instead uses the host CLI's own settings and credential store. A stale `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` in the Claude settings takes precedence over native OAuth and can silently route the child through an obsolete endpoint.

The package README documents the OAuth lifecycle, common `invalid-success` causes, the Bundle requirement, and a safe smoke test. Operators validate the Claude CLI from the same environment that launches DSH, refresh its login when necessary, remove obsolete provider overrides, and then start a new DSH session because an Agent preset binds at session creation.

## Preset routing

| Preset | Primary chat | `subagent` | `subagent_fork` | Use case |
|---|---|---|---|---|
| `standard` | free-router | `spawn` | `fork` | Local delegation without Claude Code |
| `standard-claude` | free-router | `claude-code` | `fork` | Claude Code for ordinary subagents, local in-process forks |
| `claude` | free-router | `claude-code` | `claude-code` | Both delegation paths through Claude Code |

## Verification

- `claude -p "say hello"` succeeds from the same environment that launches the DSH host.
- `dsh plugin --profile <name> list` shows `subagent-claude-code` when a Claude-backed preset is used.
- The profile dump resolves `standard`, `standard-claude`, and `claude` to the routing shown above.
- A new session using the selected preset can complete the corresponding delegation call.

## Alternatives considered

**Forward host OAuth tokens explicitly.** Rejected because the product provider deliberately relies on the Claude CLI's credential store and scrubs credential-like parent variables. Copying raw OAuth material into child environment variables would widen secret exposure and duplicate the CLI's refresh lifecycle.

**Route every preset through Claude Code.** Rejected because `standard` must remain usable without an external Claude Code login, and `standard-claude` intentionally retains a local fork path.

**Keep the obsolete proxy as a fallback.** Rejected because Claude Code gives configured provider overrides precedence over native OAuth. A dead or rate-limited endpoint therefore breaks otherwise valid host authentication instead of providing redundancy.

## Consequences

Operators can choose local delegation, a mixed route, or an all-Claude route explicitly. Claude-backed presets depend on a healthy host Claude CLI login and clean provider settings, while `standard` remains the fallback when Claude Code authentication is unavailable. Authentication changes take effect for new sessions rather than mutating an already composed Agent.
