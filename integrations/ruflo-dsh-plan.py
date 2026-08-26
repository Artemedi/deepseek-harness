#!/usr/bin/env python3
"""Validate a Ruflo-inspired orchestration plan for DSH primitives.

This is a plan linter, not a second scheduler. DSH remains responsible for
agent lifecycle, authorization, execution, persistence, and cancellation.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class PlanError(ValueError):
    """A plan violates a bounded orchestration rule."""


@dataclass(frozen=True)
class PlanLimits:
    max_fan_out: int
    max_tasks: int
    budget: int


def validate_plan(plan: dict[str, Any]) -> PlanLimits:
    limits = plan.get("limits")
    tasks = plan.get("tasks")
    if not isinstance(limits, dict) or not isinstance(tasks, list):
        raise PlanError("plan requires object limits and array tasks")
    max_fan_out = _positive_int(limits, "maxFanOut")
    max_tasks = _positive_int(limits, "maxTasks")
    budget = _positive_int(limits, "budget")
    if len(tasks) > max_tasks:
        raise PlanError("task count exceeds maxTasks")

    names: set[str] = set()
    dependencies: dict[str, list[str]] = {}
    cost = 0
    review_count = 0
    for task in tasks:
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            raise PlanError("each task requires a string id")
        task_id = task["id"]
        if task_id in names:
            raise PlanError(f"duplicate task id: {task_id}")
        names.add(task_id)
        deps = task.get("dependsOn", [])
        if not isinstance(deps, list) or any(not isinstance(dep, str) for dep in deps):
            raise PlanError(f"invalid dependencies for task: {task_id}")
        dependencies[task_id] = deps
        cost += _positive_int(task, "cost", allow_zero=True)
        if task.get("role") == "review":
            review_count += 1

    for task_id, deps in dependencies.items():
        unknown = set(deps) - names
        if unknown:
            raise PlanError(f"task {task_id} depends on unknown task: {sorted(unknown)[0]}")
        if len(deps) > max_fan_out:
            raise PlanError(f"task {task_id} exceeds maxFanOut dependencies")
    _assert_acyclic(dependencies)
    if review_count != 1:
        raise PlanError("plan requires exactly one review task")
    if cost > budget:
        raise PlanError("task cost exceeds budget")
    return PlanLimits(max_fan_out, max_tasks, budget)


def _positive_int(mapping: dict[str, Any], key: str, *, allow_zero: bool = False) -> int:
    value = mapping.get(key)
    minimum = 0 if allow_zero else 1
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise PlanError(f"{key} must be an integer >= {minimum}")
    return value


def _assert_acyclic(graph: dict[str, list[str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visiting:
            raise PlanError("task dependencies contain a cycle")
        if node in visited:
            return
        visiting.add(node)
        for dependency in graph[node]:
            visit(dependency)
        visiting.remove(node)
        visited.add(node)

    for node in graph:
        visit(node)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8"))
        limits = validate_plan(plan)
    except (OSError, json.JSONDecodeError, PlanError) as error:
        print(f"invalid DSH orchestration plan: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"status": "valid", "limits": limits.__dict__}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
