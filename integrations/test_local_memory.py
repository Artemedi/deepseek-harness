import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("local-memory.py")
SPEC = importlib.util.spec_from_file_location("local_memory", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class LocalMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.memory = MODULE.LocalMemory(Path(self.temp.name) / "memory.jsonl", max_content_bytes=32)
        self.workspace = MODULE.MemoryScope("/workspace/a")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_search_returns_only_matching_workspace(self) -> None:
        self.memory.store(self.workspace, kind="memory", title="Gateway", content="retry upstream error", source="test")
        self.memory.store(MODULE.MemoryScope("/workspace/b"), kind="memory", title="Gateway", content="retry upstream error", source="test")

        hits = self.memory.search(self.workspace, query="upstream")

        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].title, "Gateway")
        self.assertEqual(hits[0].source, "test")

    def test_rejects_oversized_content(self) -> None:
        with self.assertRaisesRegex(MODULE.MemoryError, "max_content_bytes"):
            self.memory.store(self.workspace, kind="memory", title="x", content="x" * 33, source="test")

    def test_rejects_empty_or_nul_query(self) -> None:
        with self.assertRaises(MODULE.MemoryError):
            self.memory.search(self.workspace, query="   ")
        with self.assertRaises(MODULE.MemoryError):
            self.memory.search(self.workspace, query="a\0b")

    def test_honors_result_limit(self) -> None:
        self.memory.store(self.workspace, kind="memory", title="one", content="gateway", source="test")
        self.memory.store(self.workspace, kind="memory", title="two", content="gateway", source="test")

        self.assertEqual(len(self.memory.search(self.workspace, query="gateway", limit=1)), 1)

    def test_rejects_malformed_persisted_record(self) -> None:
        self.memory.path.write_text('{"workspace":"/workspace/a"}\n', encoding="utf-8")
        with self.assertRaisesRegex(MODULE.MemoryError, "malformed record"):
            self.memory.search(self.workspace, query="gateway")

    def test_rejects_malformed_json(self) -> None:
        self.memory.path.write_text("not-json\n", encoding="utf-8")
        with self.assertRaisesRegex(MODULE.MemoryError, "malformed JSON"):
            self.memory.search(self.workspace, query="gateway")


if __name__ == "__main__":
    unittest.main()
