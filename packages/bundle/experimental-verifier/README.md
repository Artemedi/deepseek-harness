---
description: "Add the experimental verifier service and explicit verify_pair tool to a selected dsh profile from a source checkout."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-verifier-bundle

English | [中文](README.zh.md)

## Summary

This opt-in layer adds the experimental JSON verifier service and `verify_pair` tool to one selected profile. No shipped base, headless, or Web profile includes it. Install or remove it through the profile package manager so dependency resolution and patch reconciliation stay profile-local. The package is private and intended for built source checkouts; its score remains probabilistic evidence rather than correctness authority.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

From a built source checkout, install the local package into the selected profile and remove it by package name:

```text
pnpm dsh plugin --profile web add ./packages/bundle/experimental-verifier
pnpm dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verifier-bundle
```

The profile-local dependency graph makes both private experimental packages resolvable, and reconciliation activates the declared `dsh.bundle.patch`. A package without that declaration can be installed as a dependency but contributes no layer. Do not copy these rows directly into the profile patch.

### What you get

The layer inserts `experimental-verifier`, configured for the bounded Mistral-compatible route and `MISTRAL_API_KEY`, followed by `experimental-tool-verifier`. The service owns provider requests and response validation; the tool owns the model-facing schema and compact result.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is a static two-row patch carrier. Profile reconciliation applies [`cordis.patch.yml`](cordis.patch.yml); later profile or user rows with the same ids replace these complete configurations. The TypeScript entry has no runtime behavior, and each inserted package owns its service, tool, and invariants.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Verifier service and tool rows with bounded defaults |
| [`src/index.ts`](src/index.ts) | Empty bundle entry |
| [`src/invariant.ts`](src/invariant.ts) | Static bundle composition invariant |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Verifier service](../../experimental/verifier/README.md) — provider and validation contract.
- [Verifier tool](../../experimental/tool-verifier/README.md) — model-facing schema and boundary.
- [Bundle package map](../README.md) — shipped and optional profile layers.
- [Generated composition graph](../../../apps/cli/composition.md) — current profile rows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted verifier tool; that package owns its model-facing schema and result.

#### KV Cache effect

The bundle itself adds no request prefix. The inserted tool definition is stable while the profile composition is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints follow from the bundle's private, opt-in status.

- **Source checkout only** — the private package is not published as a release dependency.
- **Whole-row overrides** — later patches replace a row's complete configuration rather than merging individual fields.
- **No automatic verification** — the layer exposes only explicit `verify_pair` calls.
- **No correctness authority** — deterministic evidence and human review remain required.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
