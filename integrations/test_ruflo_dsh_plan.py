import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("ruflo_dsh_plan", ROOT / "ruflo-dsh-plan.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load plan validator")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


VALID = json.loads((ROOT / "ruflo-dsh-plan.example.json").read_text(encoding="utf-8"))


class RufloDshPlanTests(unittest.TestCase):
    def test_accepts_bounded_dag_with_single_review(self):
        limits = MODULE.validate_plan(VALID)
        self.assertEqual(limits.budget, 12)

    def test_rejects_cycles(self):
        plan = {"limits": {"maxFanOut": 3, "maxTasks": 4, "budget": 4}, "tasks": [
            {"id": "a", "dependsOn": ["b"], "cost": 1}, {"id": "b", "dependsOn": ["a"], "cost": 1},
            {"id": "review", "role": "review", "dependsOn": ["a"], "cost": 1},
        ]}
        with self.assertRaisesRegex(MODULE.PlanError, "cycle"):
            MODULE.validate_plan(plan)

    def test_rejects_budget_and_fanout_violations(self):
        plan = {"limits": {"maxFanOut": 1, "maxTasks": 4, "budget": 1}, "tasks": [
            {"id": "a", "cost": 2}, {"id": "review", "role": "review", "cost": 0, "dependsOn": ["a", "missing"]},
        ]}
        with self.assertRaisesRegex(MODULE.PlanError, "depends on unknown"):
            MODULE.validate_plan(plan)
        plan["tasks"][1]["dependsOn"] = ["a"]
        with self.assertRaisesRegex(MODULE.PlanError, "budget"):
            MODULE.validate_plan(plan)

    def test_execute_runs_only_after_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "marker"
            command = [sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).write_text('ran')"]
            valid = subprocess.run([sys.executable, str(ROOT / "ruflo-dsh-plan.py"), str(ROOT / "ruflo-dsh-plan.example.json"), "--execute", "--", *command], check=False)
            self.assertEqual(valid.returncode, 0)
            self.assertEqual(marker.read_text(encoding="utf-8"), "ran")

            invalid = dict(VALID)
            invalid["tasks"] = [{"id": "worker", "cost": 1}]
            plan_path = Path(directory) / "invalid.json"
            plan_path.write_text(json.dumps(invalid), encoding="utf-8")
            marker.unlink()
            rejected = subprocess.run([sys.executable, str(ROOT / "ruflo-dsh-plan.py"), str(plan_path), "--execute", "--", *command], check=False)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertFalse(marker.exists())

    def test_requires_exactly_one_review(self):
        plan = {"limits": {"maxFanOut": 2, "maxTasks": 4, "budget": 1}, "tasks": [{"id": "a", "cost": 1}]}
        with self.assertRaisesRegex(MODULE.PlanError, "review"):
            MODULE.validate_plan(plan)


if __name__ == "__main__":
    unittest.main()
