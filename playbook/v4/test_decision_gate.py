import json
from pathlib import Path
import tempfile
import unittest

from decision_gate import validate


class DecisionGateTest(unittest.TestCase):
    def test_pass_requires_successful_execution_and_no_findings(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = Path(folder) / "execution.json"
            answer = {"status": "passed", "coverage": "covered", "oracle": "independent input",
                      "evidence": "frozen log", "summary": "passed", "findings": []}
            receipt.write_text(json.dumps({"exit_code": 1}))
            result = validate(answer, {"frozen_execution_receipt": str(receipt)})
            self.assertEqual(result["status"], "invalid")
            receipt.write_text(json.dumps({"exit_code": 0}))
            self.assertEqual(validate(answer, {"frozen_execution_receipt": str(receipt)})["status"], "valid")

    def test_product_bug_requires_failed_execution_and_product_finding(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = Path(folder) / "execution.json"
            receipt.write_text(json.dumps({"exit_code": 1}))
            answer = {"status": "product_bug", "coverage": "covered", "oracle": "contract",
                      "evidence": "frozen log", "summary": "bug", "findings": []}
            self.assertEqual(validate(answer, {"frozen_execution_receipt": str(receipt)})["status"], "invalid")
            answer["findings"] = [{"kind": "product", "reason": "valid input rejected",
                                   "requested_change": "fix product behavior"}]
            self.assertEqual(validate(answer, {"frozen_execution_receipt": str(receipt)})["status"], "valid")


if __name__ == "__main__":
    unittest.main()
