# Agent Note: Preserve free-model gateway failures

Status: proposed

English | [中文](2026-08-26-free-model-gateway-upstream-error.zh.md)

## Problem

A request routed through the free-model gateway can terminate with the GUI message `This turn failed` and the only diagnostic payload `{"type":"api_error","message":"Upstream error."}`. The gateway hides the provider, HTTP status, stable error code, request id, and retryability, so the user cannot distinguish a temporary upstream outage from a rejected request or a DSH transport failure.

This is a gateway/provider error-reporting problem. It is independent of OpenViking, which may provide durable context retrieval but cannot repair a failed model request or recover lost gateway diagnostics.

## Proposal

Trace the free-model route end to end and preserve structured upstream failures through the gateway, API transport, session event, and Web UI. The resulting diagnostic must retain the provider or route identity, HTTP status when available, stable error code, request id when available, original message, and retryability classification without exposing credentials or authorization headers.

Transient gateway and provider failures should use the existing retry or fallback policy where that policy applies. The pi-ai adapter currently receives only a flattened `Upstream error.` message from the minimal gateway envelope, so it classifies that exact message as `SERVER`; the default bounded retry policy can then recover it. This is a temporary recovery classification, not a replacement for preserving provider facts. Permanent failures should remain actionable in the trajectory and status view, and the user should be able to retry the turn without reconstructing the prompt.

Add a keyless regression fixture for a gateway response containing only the current `api_error` envelope and fixtures for structured, retryable, and permanent upstream failures. The fixture must verify the durable error facts and the rendered diagnostic.

## Alternatives considered

- **Keep the literal `Upstream error` message.** Rejected because it loses the facts needed for diagnosis, retry decisions, and support reports.

- **Fix only the Web UI.** Rejected because the gateway has already discarded information before the client can render it; a client-only change cannot recover provider status or request identity.

- **Treat every gateway failure as retryable.** Rejected because authentication, invalid-request, quota, and policy failures should not cause unbounded or misleading retries.

- **Use OpenViking as the recovery mechanism.** Rejected because context storage does not provide transport diagnostics, provider failover, or request retry semantics.

## Acceptance criteria

- A free-model gateway failure preserves the original structured facts through the session log and Web UI when the gateway supplies them.
- A response containing only `api_error: Upstream error.` is labeled as a gateway upstream failure and includes a request correlation id when one exists.
- Retryable and permanent failures follow distinct, tested policies without leaking secrets.
- The user can retry a failed turn from the existing conversation state.
- Keyless assembled web tests cover the minimal envelope and structured gateway errors.

## Risks

Gateway implementations may disagree on error envelopes and may omit request ids or status codes. The adapter must keep a stable DSH error vocabulary while retaining the raw diagnostic only in a bounded, redacted form. Retry or fallback can duplicate provider work, so idempotency and attempt limits must remain explicit.
