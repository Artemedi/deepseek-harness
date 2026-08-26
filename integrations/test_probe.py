import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parent / "tencentdb-agent-memory" / "probe.py"
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


if __name__ == "__main__":
    unittest.main()
