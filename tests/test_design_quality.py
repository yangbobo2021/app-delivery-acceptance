import copy
import unittest
import test_playbook as gate_fixture
PLAYBOOK, save = gate_fixture.PLAYBOOK, gate_fixture.save
import design_quality


class SharedDesignContractTest(unittest.TestCase):
    setUp = gate_fixture.PlaybookGatesTest.setUp
    def documents(self):
        return PLAYBOOK.read_json(self.ledger / "scenarios.json"), PLAYBOOK.read_json(self.ledger / "coverage_review.json")

    def test_standard_mismatch_cannot_pass(self):
        scenes, review = self.documents()
        review["design_standard"] = "reviewer-only-standard"
        save(self.ledger / "coverage_review.json", review)
        self.assertIn("same current design_standard", " ".join(PLAYBOOK.validate_black_box(self.project)["gates"]["coverage_review"]["issues"]))

    def test_missing_generation_basis_blocks_even_with_linked_scenario(self):
        scenes, review = self.documents(); scenes.pop("design_basis")
        save(self.ledger / "scenarios.json", scenes)
        self.assertIn("no generation design_basis", " ".join(PLAYBOOK.validate_black_box(self.project)["gates"]["black_box_scenarios"]["issues"]))

    def test_basis_change_stales_review_without_changing_scenario(self):
        scenes, review = self.documents()
        scenes["design_basis"][0]["coverage_items"][0]["condition"] = "过期验证码再次提交"
        save(self.ledger / "scenarios.json", scenes)
        self.assertIn("stale for scenarios_sha256", " ".join(PLAYBOOK.validate_black_box(self.project)["gates"]["coverage_review"]["issues"]))

    def test_sufficient_requires_every_coverage_item_and_shared_criterion(self):
        scenes, review = self.documents()
        review["items"][0]["coverage_results"] = []
        review["items"][0]["criteria_checks"][0]["status"] = "gap"
        errors = design_quality.review_errors(review, scenes, {"REQ-1": {}}, {s["id"]: s for s in scenes["items"]})
        self.assertTrue(any("exactly the generated coverage items" in e for e in errors))
        self.assertTrue(any("unresolved criterion" in e for e in errors))

    def test_merged_coverage_and_single_applicable_technique_are_allowed(self):
        scenes, review = self.documents()
        basis = scenes["design_basis"][0]
        added = copy.deepcopy(basis["coverage_items"][0]); added["id"] = "REQ-1-C-extra"
        added["condition"] = "过期验证码在重试时提交"; basis["coverage_items"].append(added)
        self.assertEqual(design_quality.basis_errors(scenes, {"REQ-1": {}}, {"SC-B": scenes["items"][0]}, {"M-2": {}}), [])
        # Many coverage items may share the same scenario/method. No technique quota.

    def test_gap_requires_requirement_grounded_escaping_counterexample(self):
        scenes, review = self.documents(); item = review["items"][0]
        item["verdict"] = "gap"
        item["findings"] = [{"kind": "coverage_gap", "requirement_basis": "过期代码必须拒绝", "condition": "重新提交过期代码", "scenario_ids": ["SC-B"]}]
        errors = design_quality.review_errors(review, scenes, {"REQ-1": {}}, {"SC-B": scenes["items"][0]})
        for field in ("escaping_fault", "why_existing_misses", "expected_detection"):
            self.assertTrue(any(field in e for e in errors))
        item["findings"][0].update(escaping_fault="首次拒绝但重试接受", why_existing_misses="方法仅执行首次提交", expected_detection="再次提交仍需拒绝且不创建账户")
        self.assertEqual(design_quality.review_errors(review, scenes, {"REQ-1": {}}, {"SC-B": scenes["items"][0]}), [])

    def test_suggestion_does_not_block_but_unconfirmed_requirement_is_clarification(self):
        scenes, review = self.documents(); item = review["items"][0]
        item["findings"] = [{"kind": "suggestion", "requirement_basis": "过期代码必须拒绝", "condition": "场景内包含多组输入", "recommendation": "可按输入分组显示", "reason_nonblocking": "现有方法已明确每组的拒绝判据与证据"}]
        self.assertEqual(design_quality.review_errors(review, scenes, {"REQ-1": {}}, {s["id"]: s for s in scenes["items"]}), [])
        item["findings"] = [{"kind": "requirement_clarification", "requirement_basis": "原文仅规定过期", "condition": "到期时刻与当前时刻相等", "question": "边界相等是否算过期？"}]
        self.assertTrue(any("unresolved findings" in e for e in design_quality.review_errors(review, scenes, {"REQ-1": {}}, {s["id"]: s for s in scenes["items"]})))
        item["verdict"] = "needs_clarification"
        self.assertEqual(design_quality.review_errors(review, scenes, {"REQ-1": {}}, {s["id"]: s for s in scenes["items"]}), [])


class CheckItemUnionTest(unittest.TestCase):
    def documents(self):
        scenes = {"S1": {"requirement_ids": ["R"], "method_ids": ["M1"]}, "S2": {"requirement_ids": ["R"], "method_ids": ["M2"]}}
        cover = {"id": "C", "check_points": [{"id": p, "text": "必须验证" + p} for p in ["A", "B", "C"]], "scenario_ids": ["S1", "S2"], "method_ids": ["M1", "M2"]}
        document = {"design_standard": design_quality.STANDARD, "design_basis": [{"requirement_id": "R", "coverage_items": [cover]}]}
        item = {"requirement_id": "R", "reason": "对照三个检查点及两场景实际判据", "scope": ["原需求规则"], "limitations": [], "verdict": "sufficient", "findings": [], "coverage_results": [{"coverage_id": "C", "status": "covered", "reason": "两个方法合计检查三点", "scenario_coverage": [{"scenario_id": "S1", "method_ids": ["M1"], "covered_point_ids": ["A", "B"], "reason": "方法一明确检查A与B"}, {"scenario_id": "S2", "method_ids": ["M2"], "covered_point_ids": ["A", "C"], "reason": "方法二明确检查A与C"}]}], "criteria_checks": [{"criterion": c, "status": "passed", "reason": "需求、实际判据及范围保持一致"} for c in design_quality.CRITERIA]}
        return {"design_standard": design_quality.STANDARD, "items": [item]}, document, scenes

    def test_complementary_scenarios_and_overlap_pass_by_union(self):
        review, design, scenes = self.documents()
        self.assertEqual(design_quality.review_errors(review, design, {"R": {}}, scenes), [])
        review["items"][0]["coverage_results"][0]["scenario_coverage"][1]["covered_point_ids"] = ["A", "B"]
        self.assertTrue(any("union of check points (partial)" in e for e in design_quality.review_errors(review, design, {"R": {}}, scenes)))

    def test_false_full_coverage_unknown_points_and_unrelated_scenarios_block(self):
        review, design, scenes = self.documents()
        c = review["items"][0]["coverage_results"][0]["scenario_coverage"][1]
        c["scenario_id"] = "unrelated"; c["covered_point_ids"] = ["outside"]
        errors = design_quality.review_errors(review, design, {"R": {}}, scenes)
        self.assertTrue(any("unrelated or duplicate contribution" in e for e in errors))
        self.assertTrue(any("covered_point_ids" in e for e in errors))

    def test_partial_and_gap_are_truthful_but_cannot_be_sufficient(self):
        review, design, scenes = self.documents(); result=review["items"][0]["coverage_results"][0]
        result["scenario_coverage"] = result["scenario_coverage"][:1]; result["status"]="partial"
        self.assertTrue(any("cannot be sufficient" in e for e in design_quality.review_errors(review, design, {"R": {}}, scenes)))
        result["scenario_coverage"] = []; result["status"]="gap"
        self.assertFalse(any("status must match union" in e for e in design_quality.review_errors(review, design, {"R": {}}, scenes)))
        result["scenario_coverage"] = [{"scenario_id":"S1","method_ids":["M1"],"covered_point_ids":[{}],"reason":"畸形记录"}]
        self.assertTrue(any("covered_point_ids" in e for e in design_quality.review_errors(review, design, {"R": {}}, scenes)))
