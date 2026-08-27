# Experimental Verifier Bundle

`@deepseek-ai/dsh-experimental-verifier-bundle` is a private opt-in DSH profile bundle. It installs the experimental verifier service and explicit `verify_pair` tool into the selected profile. It is not part of the base, headless, or Web bundles.

## Installation

From a source checkout that has built this bundle, install it through the profile package manager:

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh plugin --profile web add ./packages/bundle/experimental-verifier
```

The profile-local dependency graph makes the two private experimental packages resolvable by `dsh-web.service`. Do not copy the bundle patch rows into a profile `cordis.patch.yml` directly.

Verify before restart:

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh --profile web --dump-config
```

Remove the bundle through the same interface:

```sh
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verifier-bundle
```

## Model Experience

### Indirect verifier tool

#### What the model sees

This bundle adds the `verify_pair` tool only through its verifier dependency. The service and tool package READMEs define its schema and result.

#### Token effect

The bundle adds no request itself. Each explicit `verify_pair` call makes one bounded external verifier request.

#### KV Cache effect

The bundle adds no prompt section or durable context. The normal tool call and result records remain the replay source.

## Known Limitations and Deferred Work

- **Private source bundle** — it is intended for a source checkout and is not published as a release package.
- **No automatic verification** — the bundle exposes only explicit `verify_pair`; it does not change agent-loop or goal behavior.
- **No correctness authority** — deterministic evidence and human review remain required.
