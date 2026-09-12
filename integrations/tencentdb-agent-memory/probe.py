#!/usr/bin/env python3
"""Probe the DSH LLM proxy route without sending model content.

The proxy is a separate component from the TencentDB MemoryCore Gateway.
The MemoryCore gateway runs on port 8420 and exposes /v3/* endpoints;
this probe hits the proxy on port 8096 (/dsh/default and /health).
It never prints authorization headers or request bodies.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Response:
    status: int
    body: str
    headers: dict[str, str]


def request(url: str, *, method: str = "GET", payload: bytes | None = None, token: str | None = None) -> Response:
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return Response(res.status, res.read().decode("utf-8", "replace"), dict(res.headers.items()))
    except urllib.error.HTTPError as err:
        return Response(err.code, err.read().decode("utf-8", "replace"), dict(err.headers.items()))
    except urllib.error.URLError as err:
        return Response(0, str(err.reason), {})


def classify(body: str) -> str:
    try:
        parsed: Any = json.loads(body)
    except json.JSONDecodeError:
        return "non-json-response"
    if not isinstance(parsed, dict):
        return "json-non-object"
    error = parsed.get("error")
    if isinstance(error, dict) and error.get("type") == "api_error" and error.get("message") == "Upstream error.":
        return "gateway-upstream-error"
    if isinstance(parsed.get("error"), dict):
        return "structured-error"
    return "other-json-response"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("TDAI_PROXY_BASE_URL", "http://127.0.0.1:8096/dsh/default"))
    parser.add_argument("--token", default=os.environ.get("TDAI_PROXY_USER_KEY"))
    parser.add_argument("--model", default=os.environ.get("TDAI_PROXY_MODEL", ""))
    parser.add_argument("--check-chat", action="store_true", help="send a minimal non-streaming chat request")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    health = request(f"{base_url.rsplit('/dsh/', 1)[0]}/health", token=args.token)
    print(json.dumps({"check": "health", "status": health.status, "classification": classify(health.body)}, ensure_ascii=False))

    if not args.check_chat:
        return 0 if 200 <= health.status < 500 else 1

    if not args.model:
        print("--model or TDAI_PROXY_MODEL is required with --check-chat", file=sys.stderr)
        return 2
    payload = json.dumps({
        "model": args.model,
        "messages": [{"role": "user", "content": "ping"}],
        "stream": False,
        "max_tokens": 8,
    }).encode("utf-8")
    chat = request(f"{base_url}/chat/completions", method="POST", payload=payload, token=args.token)
    print(json.dumps({
        "check": "chat-completions",
        "status": chat.status,
        "classification": classify(chat.body),
        "request_id": chat.headers.get("x-request-id") or chat.headers.get("x-correlation-id"),
    }, ensure_ascii=False))
    return 0 if chat.status < 500 else 1


if __name__ == "__main__":
    raise SystemExit(main())
