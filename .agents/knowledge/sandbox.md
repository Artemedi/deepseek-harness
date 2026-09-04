# DSH file sandbox in this environment

## Current runtime context (this session)

- **DSH file policy: `workspace-write`.** Any operation the sandbox allows may
  modify files under the session workspace `/var/home/Trintos/projects`.
- Approval policy: `ask` — operations requiring approval use the configured
  answerer; without one the request **fails closed**.
- The sandbox may deny file operations with
  `[sandbox: file access denied under <mode> mode]`. That is a **policy
  denial, not a bug** — do not retry another way. To escalate, set
  `sandbox_permissions` to the **narrowest wider mode** that suffices and
  supply a one-sentence justification; if `check:windows-wine` or similar is
  blocked, retry with `danger-full-access`. A rejected escalation is **final
  for that command** — never work around it.

## What this means for agent work in DSH

1. File writes to `/var/home/Trintos/projects/deepseek-harness/**` are permitted
   under `workspace-write` (the working files in `.agents/HANDOFF.md`,
   `.agents/knowledge/`, `.agents/plans/` all land here).
2. `bash`, `grep`, `glob`, `read` on workspace files work without escalation.
3. **Sandbox failures are reported via the `[exit code: N]` marker.** When a
   `bash` result shows a non-zero exit, investigate before proceeding — a
   sandbox denial can masquerade as a "command failed".
4. **Host escalation path** (from AGENTS.md): when required `gh`,
   `pnpm`, build, test, or generator commands fail because the agent sandbox
   blocks credentials, network, IPC, file watching, or nested
   `sandbox-exec`, retry the **unchanged** command with the narrowest host
   escalation before diagnosing authentication or project failure. Require
   sandbox evidence; **never** bypass genuine test failures or the product
   sandbox under test.

## Gotchas carried forward

- `bwrap` (bubblewrap) is not available in this sandbox
  (`spawn bwrap ENOENT` — observed during early exploration). Anything relying
  on nested `sandbox-exec`/`bwrap` will fail; use host escalation only if a
  real DSH command needs that capability and provide evidence first.
- 232 zombie `packages/*/<pkg>/package.json)` files (note trailing paren)
  appear as untracked in `git status`. They are **not real packages** —
  artifacts from an interrupted `pnpm install`; safe to ignore, do not `git add`.
