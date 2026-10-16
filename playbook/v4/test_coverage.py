import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from coverage_evidence import freeze_coverage


class FrozenCoverageTest(unittest.TestCase):
    def test_same_run_report_keeps_zero_hit_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            execution = root / "execution"
            execution.mkdir()
            receipt = execution / "execution.json"
            receipt.write_text(json.dumps({"start_utc": datetime.now(timezone.utc).isoformat()}))
            report = execution / "coverage.json"
            report.write_text(json.dumps({"files": {"src/app.py": {
                "executed_lines": [1], "missing_lines": [2]}}}))
            result, saved = freeze_coverage({"policy": "required", "source_paths": ["src/app.py"],
                "line_report_path": "{artifacts}/coverage.json", "line_parser": "coveragepy-json"},
                root, execution, receipt, root / "frozen-report")
            self.assertEqual(result["status"], "measured")
            self.assertEqual(result["line_files"][0]["executable_lines"], [1, 2])
            self.assertEqual(result["line_files"][0]["hit_lines"], [1])
            self.assertTrue(saved.is_file())

    def test_missing_required_report_is_not_zero_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            execution = root / "execution"
            execution.mkdir()
            receipt = execution / "execution.json"
            receipt.write_text(json.dumps({"start_utc": datetime.now(timezone.utc).isoformat()}))
            with self.assertRaisesRegex(ValueError, "report missing"):
                freeze_coverage({"policy": "required", "source_paths": ["src/app.py"],
                    "line_report_path": "{artifacts}/coverage.json", "line_parser": "coveragepy-json"},
                    root, execution, receipt, root / "frozen-report")


if __name__ == "__main__":
    unittest.main()
