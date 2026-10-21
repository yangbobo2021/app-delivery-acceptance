import json
from pathlib import Path
import tempfile
import unittest
from scene_pipeline import prepare

class CoveragePolicyTest(unittest.TestCase):
    def test_scene_cannot_disable_project_collection_before_any_checkout_or_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            catalog=root/'catalog.json'
            catalog.write_text(json.dumps({'schema':'portable-project-catalog-v1',
                'coverage':{'policy':'required','provider':'istanbul-source-v1','prepared':'/frozen/prepared'}}))
            config={'source_checkout':str(root/'must-not-open'),'template_catalog':str(catalog),'coverage':{'policy':'off'}}
            with self.assertRaisesRegex(ValueError,'cannot downgrade'):
                prepare(config,root/'output')
            self.assertFalse((root/'output').exists())

if __name__=='__main__':unittest.main()
