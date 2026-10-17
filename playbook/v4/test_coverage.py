import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from coverage_evidence import freeze_coverage


class FrozenCoverageTest(unittest.TestCase):
    def test_unregistered_report_cannot_be_certified_by_format_or_tool_label(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report = root / 'coverage.lcov'
            report.write_text('SF:src/a.ts\nDA:1,1\nend_of_record\n')
            with self.assertRaisesRegex(ValueError, 'registered dedicated provider'):
                freeze_coverage({'policy':'required', 'line_report_path':str(report),
                                 'line_parser':'lcov', 'tools':[{'name':'istanbul','version':'1'}]},
                                root, root, root/'execution.json', root/'frozen')

    def test_missing_required_report_is_not_zero_coverage(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            execution = root / "execution"
            execution.mkdir()
            receipt = execution / "execution.json"
            receipt.write_text(json.dumps({"start_utc": datetime.now(timezone.utc).isoformat()}))
            with self.assertRaisesRegex(ValueError, "registered dedicated provider"):
                freeze_coverage({"policy": "required", "source_paths": ["src/app.py"],
                    "line_report_path": "{artifacts}/coverage.json", "line_parser": "coveragepy-json"},
                    root, execution, receipt, root / "frozen-report")


if __name__ == "__main__":
    unittest.main()
