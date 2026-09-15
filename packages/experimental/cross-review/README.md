# @deepseek-ai/dsh-experimental-cross-review

Opt-in risk-based independent review policy. The plugin classifies explicitly configured tool names, runs a separate one-shot reviewer with a structured verdict, records the result in the owning Session log, and denies execution unless the record is `approved`.

## Config

```yaml
- id: cross-review
  name: '@deepseek-ai/dsh-experimental-cross-review'
  config:
    reviewerSubagentProvider: spawn
    reviewerProvider: '<independent-provider-route>'
    reviewerModel: '<independent-model>'
    rules:
      fs_write: code-change
      deploy: production
    reviewerAllowedTools: [read_file, search_files, report]
    maxEvidenceBytes: 16384
    maxReasonBytes: 1024
    failClosedOnUnavailable: true
```

`reviewerProvider` and `reviewerModel` are required; `reviewerSubagentProvider` selects the child-run transport. The policy refuses a reviewer route identical to the executor route. The reviewer receives only bounded JSON tool evidence and uses an explicit tool allow-list. Keep write, rollout, MCP, credential, and production tools out of that list. The reviewer route is a second recipient of the evidence, so sensitive-data deployments must approve that data flow explicitly.

## Durable record

Each reviewed call appends and flushes `cross-review/evaluated` in the owning Session before the guarded tool body can start. The event is log-only and contains the exact call id, tool name, risk class, decision, reviewer run id, and bounded reason. A missing, invalid, rejected, or unavailable review is fail-closed by default.

## Model Experience

### Review gate

#### What the model sees

A denied tool result states that cross-review is required and includes the bounded reviewer reason. Reviewer prompts and records do not enter the parent model history.

#### Token effect

Each configured risky call adds one reviewer model request. The deployment controls the reviewer route and model.

#### KV Cache effect

The reviewer runs in a separate child session. The parent session cache is unchanged; the parent receives only the normal tool outcome.

## Known Limitations and Deferred Work

- **Explicit configuration only** — unknown tools are not classified or reviewed.
- **No correctness authority** — an approved model verdict does not replace deterministic tests, policy checks, or human approval for rollout.
- **No human override surface** — unavailable or rejected reviews remain blocked until a future audited approval capability is added.
- **No automatic risk inference from arbitrary arguments** — deployments must name the tool and risk class explicitly.
