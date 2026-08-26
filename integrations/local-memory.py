#!/usr/bin/env python3
"""Small provider-neutral local memory reference implementation.

This is an integration reference, not a replacement for DSH session storage.
Every search result is explicit and bounded; callers can record the returned
observation in the DSH session log before using it in a later prompt.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


class MemoryError(Exception):
    """Base error for bounded local memory operations."""


@dataclass(frozen=True)
class MemoryScope:
    workspace: str


@dataclass(frozen=True)
class MemoryHit:
    id: str
    kind: str
    title: str
    content: str
    source: str
    score: float


class LocalMemory:
    """Workspace-scoped JSONL memory provider with deterministic literal search."""

    def __init__(self, path: str | os.PathLike[str], *, max_content_bytes: int = 32_768) -> None:
        if max_content_bytes < 1:
            raise ValueError("max_content_bytes must be positive")
        self.path = Path(path)
        self.max_content_bytes = max_content_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def store(self, scope: MemoryScope, *, kind: str, title: str, content: str, source: str) -> str:
        self._validate_scope(scope)
        self._validate_text("title", title)
        self._validate_text("content", content)
        self._validate_text("source", source)
        if len(content.encode("utf-8")) > self.max_content_bytes:
            raise MemoryError("content exceeds max_content_bytes")
        record = {
            "id": f"local:{uuid.uuid4()}",
            "workspace": scope.workspace,
            "kind": kind,
            "title": title,
            "content": content,
            "source": source,
        }
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        return str(record["id"])

    def search(self, scope: MemoryScope, *, query: str, limit: int = 10) -> list[MemoryHit]:
        self._validate_scope(scope)
        self._validate_text("query", query)
        if not 1 <= limit <= 100:
            raise MemoryError("limit must be between 1 and 100")
        needle = query.casefold()
        hits: list[MemoryHit] = []
        if not self.path.exists():
            return hits
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line:
                continue
            record: dict[str, Any] = json.loads(line)
            if record["workspace"] != scope.workspace:
                continue
            haystack = f'{record["title"]}\n{record["content"]}'.casefold()
            if needle not in haystack:
                continue
            hits.append(MemoryHit(
                id=str(record["id"]), kind=str(record["kind"]), title=str(record["title"]),
                content=str(record["content"]), source=str(record["source"]), score=1.0,
            ))
            if len(hits) == limit:
                break
        return hits

    @staticmethod
    def _validate_scope(scope: MemoryScope) -> None:
        if not scope.workspace or "\x00" in scope.workspace:
            raise MemoryError("workspace scope must be non-empty and NUL-free")

    @staticmethod
    def _validate_text(name: str, value: str) -> None:
        if not value.strip() or "\x00" in value:
            raise MemoryError(f"{name} must be non-empty and NUL-free")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.environ.get("DSH_MEMORY_DB", "memory.jsonl"))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--query")
    parser.add_argument("--store-title")
    parser.add_argument("--store-content")
    parser.add_argument("--store-source", default="local-memory")
    args = parser.parse_args()
    provider = LocalMemory(args.db)
    scope = MemoryScope(args.workspace)
    if args.store_title is not None or args.store_content is not None:
        if args.store_title is None or args.store_content is None:
            parser.error("--store-title and --store-content must be supplied together")
        print(provider.store(scope, kind="memory", title=args.store_title, content=args.store_content, source=args.store_source))
        return 0
    if args.query is None:
        parser.error("--query or store arguments are required")
    print(json.dumps([asdict(hit) for hit in provider.search(scope, query=args.query)], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
