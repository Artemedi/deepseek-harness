# Harness Integrations

Operational integration project for DeepSeek Harness and external agent infrastructure.

This repository keeps integration plans, adapters, probes, deployment notes, and an append-only audit log. It is not a fork of DeepSeek Harness and does not replace DSH's agent loop, session log, tool authorization, or persistence.

## Scope

The first integrations are:

- TencentDB Agent Memory: first practical target through its OpenAI-compatible DSH proxy path.
- OpenViking: later optional remote context provider; it remains a separately deployed AGPLv3 service.
- Ruflo: patterns only, applied over DSH subagents, Agent Teams, workflows, and jobs. Its runtime is not embedded.

## Priority

1. Fix and verify gateway error transparency for free-model routes. The recurring `This turn failed` plus `api_error: Upstream error.` response is a P0 reliability issue.
2. Validate TencentDB Agent Memory as an opt-in external proxy.
3. Define a DSH-native `ctx.memory` capability with durable, bounded, authorized recall.
4. Add TencentDB and OpenViking providers behind that capability.
5. Apply Ruflo-style task DAG, coordinator, budget, and review patterns to existing DSH primitives.

The detailed decision record is in [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md). The provider-neutral DSH memory contract is in [`docs/DSH_MEMORY_SEAM.md`](docs/DSH_MEMORY_SEAM.md), external provider rules are in [`docs/EXTERNAL_MEMORY_ADAPTERS.md`](docs/EXTERNAL_MEMORY_ADAPTERS.md), and the Ruflo-to-DSH plan validator is [`integrations/ruflo-dsh-plan.py`](integrations/ruflo-dsh-plan.py). Every operational change is recorded in [`AUDIT_LOG.md`](AUDIT_LOG.md).

## Quick Start

The TencentDB probe does not send model content unless `--check-chat` is explicitly supplied:

```bash
python3 integrations/tencentdb-agent-memory/probe.py
python3 integrations/tencentdb-agent-memory/probe.py --check-chat --model <model>
```

The DSH route template is [`integrations/tencentdb-agent-memory/dsh-settings.yaml.example`](integrations/tencentdb-agent-memory/dsh-settings.yaml.example). It is opt-in and intentionally points to `/dsh/default` without a trailing `/v1`, as required by the TencentDB DSH adapter.

## Repository Rules

- Never commit API keys, SSH private keys, `.env` files, database volumes, raw conversation logs, or unredacted provider responses.
- Keep external services replaceable and DSH session history authoritative.
- Record failed probes and infrastructure blockers in [`AUDIT_LOG.md`](AUDIT_LOG.md), including the exact command and result.
- Run the smallest relevant validation before each commit.

## Upstream References

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [OpenViking](https://github.com/volcengine/OpenViking)
- [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
- [Ruflo](https://github.com/ruvnet/ruflo)
