import importlib.util
import json
import subprocess
import sys
import time
import unittest
from pathlib import Path


INTEGRATION_ROOT = Path(__file__).parent / "tencentdb-agent-memory"
MODULE_PATH = INTEGRATION_ROOT / "probe.py"
STUB_PATH = INTEGRATION_ROOT / "stub_gateway.py"
SPEC = importlib.util.spec_from_file_location("tdai_probe", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ProbeTests(unittest.TestCase):
    def test_classifies_gateway_and_malformed_responses(self) -> None:
        cases = [
            ('{"error":{"type":"api_error","message":"Upstream error."}}', "gateway-upstream-error"),
            ('{"error":{"type":"api_error","message":"rate limited"}}', "gateway-api-error"),
            ('{"error":{"type":"validation","message":"bad"}}', "structured-error"),
            ('{"status":"ok"}', "other-json-response"),
            ('[]', "json-non-object"),
            ("not-json", "non-json-response"),
        ]
        for body, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(MODULE.classify(body), expected)

    def test_reads_diagnostic_headers_case_insensitively(self) -> None:
        response = MODULE.Response(502, "", {"x-ReQuEsT-iD": "request-1"})
        self.assertEqual(MODULE.header(response, "X-Request-ID"), "request-1")
        correlation = MODULE.Response(502, "", {"X-CORRELATION-ID": "correlation-1"})
        self.assertEqual(MODULE.header(correlation, "x-correlation-id"), "correlation-1")

    def test_transport_failure_is_explicit_status_zero(self) -> None:
        response = MODULE.request("http://127.0.0.1:1/health")
        self.assertEqual(response.status, 0)
        self.assertNotEqual(response.body, "")
        self.assertEqual(response.headers, {})

    def test_real_stub_wire_path_preserves_gateway_diagnostics(self) -> None:
        port = 19096
        process = subprocess.Popen(
            [sys.executable, str(STUB_PATH), "--port", str(port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            for _ in range(20):
                health = MODULE.request(f"http://127.0.0.1:{port}/health")
                if health.status == 200:
                    break
                time.sleep(0.05)
            completed = subprocess.run(
                [sys.executable, str(MODULE_PATH), "--base-url", f"http://127.0.0.1:{port}/dsh/default", "--model", "stub", "--check-chat"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stderr, "")
            output = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual(output[0], {"check": "health", "status": 200, "classification": "other-json-response"})
            self.assertEqual(output[1], {"check": "chat-completions", "status": 502, "classification": "gateway-upstream-error", "request_id": "stub-request-0001"})
            self.assertNotIn("Authorization", completed.stdout)
            self.assertNotIn("Upstream error.", completed.stdout)
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
