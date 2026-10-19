import json
import hashlib
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

    def test_ui_pass_requires_frozen_screenshot_and_visual_review(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            receipt = root / 'execution.json'
            receipt.write_text(json.dumps({'exit_code': 0}))
            image = root / 'state.png'
            image.write_bytes(b'png-test-bytes')
            image_sha = hashlib.sha256(image.read_bytes()).hexdigest()
            manifest = root / 'frozen-evidence.json'
            manifest.write_text(json.dumps({'files': [{'path': str(image), 'sha256': image_sha}]}))
            bound = {'frozen_execution_receipt': str(receipt),
                     'frozen_evidence_manifest': str(manifest), 'ui_acceptance': {'required': True}}
            answer = {'status': 'passed', 'coverage': 'covered', 'oracle': 'contract',
                      'evidence': 'frozen image', 'summary': 'passed', 'findings': [],
                      'ui_review': {'status': 'unverified', 'screenshot_paths': [], 'reason': 'missing image review'}}
            self.assertEqual(validate(answer, bound)['status'], 'invalid')
            answer['ui_review'] = {'status': 'passed', 'screenshot_paths': [str(image)],
                                   'reason': 'controls visible and aligned in frozen image'}
            self.assertIn('multimodal', ' '.join(validate(answer, bound)['errors']))
            metrics = {'image_inputs': [{'path': str(image), 'sha256': image_sha}]}
            self.assertEqual(validate(answer, bound, metrics)['status'], 'valid')
            alias = root / 'same-state.png'
            alias.write_bytes(image.read_bytes())
            manifest.write_text(json.dumps({'files': [{'path': str(image), 'sha256': image_sha},
                                                       {'path': str(alias), 'sha256': image_sha}]}))
            answer['ui_review']['screenshot_paths'] = [str(alias)]
            self.assertEqual(validate(answer, bound, metrics)['status'], 'valid')

    def test_visual_bug_can_be_found_after_successful_business_command(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            receipt = root / 'execution.json'
            receipt.write_text(json.dumps({'exit_code': 0}))
            image = root / 'state.png'
            image.write_bytes(b'png-test-bytes')
            image_sha = hashlib.sha256(image.read_bytes()).hexdigest()
            manifest = root / 'frozen-evidence.json'
            manifest.write_text(json.dumps({'files': [{'path': str(image), 'sha256': image_sha}]}))
            answer = {'status': 'product_bug', 'coverage': 'covered', 'oracle': 'UI quality standard',
                      'evidence': 'frozen image', 'summary': 'visual defect',
                      'findings': [{'kind': 'product', 'reason': 'save control obscured',
                                    'requested_change': 'repair layout'}],
                      'ui_review': {'status': 'failed', 'screenshot_paths': [str(image)],
                                    'reason': 'save control obscured in frozen image'}}
            bound = {'frozen_execution_receipt': str(receipt),
                     'frozen_evidence_manifest': str(manifest), 'ui_acceptance': {'required': True}}
            self.assertEqual(validate(answer, bound)['status'], 'invalid')
            metrics = {'image_inputs': [{'path': str(image), 'sha256': image_sha}]}
            self.assertEqual(validate(answer, bound, metrics)['status'], 'valid')


if __name__ == "__main__":
    unittest.main()
