import unittest

from acceptance_store import validate_catalog


class CatalogDesignGapTests(unittest.TestCase):
    def catalog(self):
        return {
            'schema': 'acceptance-catalog-v1',
            'project': {'id': 'sample'},
            'requirements': [{'id': 'R1', 'text': '可保存记录；标识必须保持不变。'}],
            'scenarios': [{'id': 'R1-S01', 'requirement_id': 'R1'}],
            'design_gaps': [{'requirement_id': 'R1', 'quote': '标识必须保持不变',
                             'reason': '当前合同未提供可观察标识的入口。'}],
        }

    def test_exact_owned_gap_can_be_published(self):
        validate_catalog(self.catalog())

    def test_unrelated_or_unanchored_gap_is_rejected(self):
        for replacement in [
            {'requirement_id': 'R2', 'quote': '标识必须保持不变', 'reason': '缺入口'},
            {'requirement_id': 'R1', 'quote': '另一个合同片段', 'reason': '缺入口'},
            {'requirement_id': 'R1', 'quote': '', 'reason': '缺入口'},
            {'requirement_id': 'R1', 'quote': '标识必须保持不变', 'reason': ''},
        ]:
            with self.subTest(replacement=replacement):
                value = self.catalog()
                value['design_gaps'] = [replacement]
                with self.assertRaises(ValueError):
                    validate_catalog(value)


if __name__ == '__main__':
    unittest.main()
