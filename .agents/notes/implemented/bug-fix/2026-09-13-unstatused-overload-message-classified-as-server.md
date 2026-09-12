# Agent Note: Unstatused upstream overload messages classify as a retryable server failure

Status: implemented

English | [中文](2026-09-13-unstatused-overload-message-classified-as-server.zh.md)

## Problem

A forensic review of real DSH session logs traced a locally-hosted OpenAI-compatible gateway's repeated failures back to `dsh-llm-pi-ai`'s `classifyPiAiError`. The gateway forwarded its upstream's capacity failure as a flattened error body with no numeric HTTP status of its own, worded `Upstream error from Nvidia: Service temporarily overloaded`. None of `classifyPiAiError`'s patterns matched: no `401`/`403`/`429`/`5xx` digits, no `timeout`, `network`, `connection`, or `stream ended` wording. The message fell through to the generic `PI_AI_ERROR` code.

`dsh-llm-retry`'s normal mode only retries `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, and `TRANSPORT`. `PI_AI_ERROR` is outside that set, so every occurrence surfaced immediately as a terminal turn error instead of reaching the provider's configured retry budget — on a backend failure mode ("overloaded", "temporarily overloaded") that is transient by construction and recovers without caller action.

## Decision

`classifyPiAiError` now matches `/\boverloaded\b/i` and returns `SERVER`, alongside the existing bare `upstream error.` and `5xx`-digit patterns that already cover other unstatused gateway-flattened bodies. The match sits case-insensitively on the word boundary so it covers "overloaded", "temporarily overloaded", and similar upstream wording without depending on a specific vendor's exact phrasing.

## Testing

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` gained a case mirroring the existing "flattened gateway upstream envelope" test: a `503` response body carrying the exact observed message classifies as `{ code: 'SERVER' }` through the real streaming adapter, not just the internal classifier function.

## Alternatives considered

**Match the specific observed vendor string ("Nvidia").** Rejected: the failure mode is a generic gateway capacity condition, not vendor-specific: coupling the pattern to one upstream's name would miss the same wording from any other flattened-gateway backend behind an OpenAI-compatible route.

**Add a fifth retryable code instead of reusing `SERVER`.** Rejected: an overloaded backend is a server-side capacity failure with no new caller-facing distinction from the existing `SERVER` code's retry treatment; a new code would only duplicate `SERVER`'s classification without changing behavior.

## Consequences

A provider whose gateway reports overload without a numeric status (observed here on a local free-tier router) now retries under its configured `retryPolicy` instead of failing the turn on the first occurrence. The pattern is deliberately narrow (`overloaded` only); other unclassified gateway wordings still fall through to `PI_AI_ERROR` and remain non-retryable until a concrete observed case justifies widening the classifier.
