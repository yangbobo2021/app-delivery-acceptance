import unittest

from project_view import catalog_observed_scene_ids, current_progress_for_catalog


class CatalogCurrentListsTest(unittest.TestCase):
    def test_later_target_list_supersedes_old_candidate_without_hiding_cases(self):
        def scene(identifier):
            return {'id': identifier, 'requirement_id': 'R1'}

        progress = {'previews': [
            {'stage': 'scenario_self_checked', 'generated_at': '2026-01-01T00:00:00Z',
             'progress_folder': 'old', 'scenarios': [scene('R1-S01'), scene('R1-S04')]},
            {'stage': 'scenario_self_checked', 'generated_at': '2026-01-02T00:00:00Z',
             'progress_folder': 'new', 'scenarios': [scene('R1-S01'), scene('R1-S02')]},
            {'stage': 'reviewed', 'progress_folder': 'case', 'scenarios': [scene('R1-S01')]},
        ], 'case_history': []}
        self.assertEqual(catalog_observed_scene_ids([], progress), {'R1-S01', 'R1-S02'})
        self.assertEqual([item['progress_folder'] for item in current_progress_for_catalog(progress)['previews']],
                         ['case', 'new'])
        progress['case_history'].append({'scenarios': [scene('R1-S04')]})
        self.assertEqual(catalog_observed_scene_ids([], progress), {'R1-S01', 'R1-S02', 'R1-S04'})


if __name__ == '__main__':
    unittest.main()
