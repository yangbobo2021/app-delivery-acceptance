"""Synthetic Git fixtures only; no application tests, services or model calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SKILL/'scripts'), str(SKILL/'playbook/v4')]
from acceptance_store import initialize, read_knowledge, save, read
from acceptance_workspace import (POLICY, workspace_path, workspace_lease, ensure_workspace,
                                  verify_frozen_workspace, finish_scene, require_scene_lease)


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()/'project'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Fixture')
        (self.root/'src').mkdir(); (self.root/'e2e').mkdir()
        (self.root/'src/app.txt').write_text('original product\n')
        (self.root/'e2e/original.txt').write_text('fixture only\n')
        self.git('add', '.'); self.git('commit', '-qm', 'synthetic fixture')
        self.rev = self.git('rev-parse', 'HEAD')
        self.at = 'AT-workspace'
        initialize(self.root, self.at, 'Fixture', 'Tester', {'targets':['fixture']}, 'Fixture')
        self.binding = read_knowledge(self.root, self.at, [])['acceptance']
        self.config = {'acceptance':self.binding, 'project_root':str(self.root),
                       'revision':self.rev, 'test_roots':['e2e'], 'workspace_policy':POLICY}
        self.out = self.root/'.acceptance-local'/self.at/'workflows/scene-a'

    def git(self, *args, root=None):
        return subprocess.check_output(['git', *args], cwd=root or self.root, text=True).strip()

    def create(self):
        with workspace_lease(self.config, self.out):
            return ensure_workspace(self.config, self.root, self.rev)

    def catalog(self, root):
        import hashlib
        return {'project_root':str(root),'revision':self.rev,'test_roots':['e2e'],
                'workspace_policy':POLICY, 'source_hashes':{
                'src/app.txt':hashlib.sha256((root/'src/app.txt').read_bytes()).hexdigest()}}

    def test_reuses_one_workspace_and_keeps_uncommitted_test_code(self):
        root = self.create()
        (root/'e2e/new.txt').write_text('candidate case\n')
        with workspace_lease(self.config, self.out, scene=True):
            self.assertEqual(ensure_workspace(self.config, self.root, self.rev),root)
            verify_frozen_workspace(self.config,self.catalog(root))
            finish_scene(self.config,self.out)
        second = self.out.with_name('scene-b')
        with workspace_lease(self.config, second, scene=True):
            self.assertEqual(ensure_workspace(self.config,self.root,self.rev),root)
            self.assertEqual((root/'e2e/new.txt').read_text(),'candidate case\n')
            finish_scene(self.config,second)
        self.assertEqual(len(self.git('worktree','list','--porcelain').split('worktree '))-1,2)
        self.assertFalse((self.out/'checkout').exists())

    def test_process_lock_and_persistent_interruption_owner(self):
        self.create()
        with workspace_lease(self.config,self.out,scene=True):
            with self.assertRaisesRegex(ValueError,'busy'):
                with workspace_lease(self.config,self.out):pass
        second=self.out.with_name('scene-b')
        with self.assertRaisesRegex(ValueError,'another scene'):
            with workspace_lease(self.config,second,scene=True):pass
        with self.assertRaisesRegex(ValueError,'another scene'):
            with workspace_lease(self.config,second):pass
        with workspace_lease(self.config,self.out,scene=True):
            finish_scene(self.config,self.out)
        with workspace_lease(self.config,second,scene=True):finish_scene(self.config,second)

    def failed_attempt(self):
        from acceptance_store import digest
        root = self.create()
        self.out.mkdir(parents=True)
        config = {**self.config, 'output_dir': str(self.out)}
        path = self.out / 'config.json'
        save(path, config)
        save(self.out / 'catalog.json', self.catalog(root))
        save(self.out / 'state.json', {'config_sha256': digest(path),
             'stages': {'evidence': {'status': 'parked', 'error': 'fixture infrastructure gap'}}})
        with workspace_lease(config, self.out, scene=True):
            pass
        return path, root

    def test_inspected_failure_closes_owner_without_rewriting_facts(self):
        from supersede_scene import supersede
        from acceptance_store import digest
        path, root = self.failed_attempt()
        old = digest(self.out / 'state.json')
        record = supersede(path, 'Inspected fixture gap corrected; new frozen attempt will follow')
        self.assertEqual(record['state_sha256'], old)
        self.assertEqual(digest(self.out / 'state.json'), old)
        self.assertFalse((root.parent / 'workspace-owner.json').exists())
        next_out = self.out.with_name('scene-new-attempt')
        with workspace_lease(self.config, next_out, scene=True):
            finish_scene(self.config, next_out)

    def test_superseding_live_or_changed_source_keeps_owner(self):
        from supersede_scene import supersede
        path, root = self.failed_attempt()
        save(self.out / 'execution-intent.json', {'child_pid': os.getpid()})
        with self.assertRaisesRegex(ValueError, 'child still alive'):
            supersede(path, 'Fixture inspection')
        (self.out / 'execution-intent.json').unlink()
        (root / 'src/app.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'frozen product source'):
            supersede(path, 'Fixture inspection')
        self.assertTrue((root.parent / 'workspace-owner.json').exists())
        self.assertFalse((self.out / 'superseded.json').exists())

    def test_running_or_judged_attempt_cannot_be_superseded(self):
        from supersede_scene import supersede
        path, root = self.failed_attempt()
        state = read(self.out / 'state.json')
        state['stages']['evidence']['status'] = 'running'
        save(self.out / 'state.json', state)
        with self.assertRaisesRegex(ValueError, 'running/uncertain'):
            supersede(path, 'Fixture inspection')
        save(self.out / 'summary.json', {'review_status': 'passed'})
        with self.assertRaisesRegex(ValueError, 'completed judgment'):
            supersede(path, 'Fixture inspection')
        self.assertTrue((root.parent / 'workspace-owner.json').exists())

    def test_completed_repair_submission_can_still_be_blocked(self):
        from supersede_scene import supersede
        path, root = self.failed_attempt()
        answer = self.out / 'review-repair-1/answer.json'
        save(answer, {'status': 'blocked', 'reason': 'new preparation required'})
        state = read(self.out / 'state.json')
        state['stages'] = {'review-repair-1': {'status': 'completed',
            'result': {'answer': str(answer)}}}
        save(self.out / 'state.json', state)
        supersede(path, 'Actual blocked repair inspected; prepare a new version')
        self.assertFalse((root.parent / 'workspace-owner.json').exists())

    def test_wrong_location_and_foreign_existing_checkout_rejected(self):
        with self.assertRaisesRegex(ValueError,'workspace must'):
            workspace_path({**self.config,'workspace':str(self.out/'checkout')})
        root=workspace_path(self.config)
        root.mkdir(); (root/'important.txt').write_text('keep')
        with workspace_lease(self.config,self.out):
            with self.assertRaisesRegex(ValueError,'never overwrite'):
                ensure_workspace(self.config,self.root,self.rev)
        self.assertEqual((root/'important.txt').read_text(),'keep')

    def test_product_edit_or_revision_change_never_silently_reset(self):
        root=self.create();catalog=self.catalog(root)
        (root/'src/app.txt').write_text('changed product\n')
        with self.assertRaisesRegex(ValueError,'frozen product source'):
            verify_frozen_workspace(self.config,catalog)
        self.git('add','src/app.txt',root=root); self.git('commit','-qm','new product revision',root=root)
        with workspace_lease(self.config,self.out):
            with self.assertRaisesRegex(ValueError,'workspace revision changed'):
                ensure_workspace(self.config,self.root,self.rev)
        self.assertEqual((root/'src/app.txt').read_text(),'changed product\n')
        newrev=self.git('rev-parse','HEAD',root=root)
        newconfig={**self.config,'project_root':str(root),'revision':newrev}
        with workspace_lease(newconfig,self.out):
            self.assertEqual(ensure_workspace(newconfig,root,newrev),root)
        self.assertEqual(self.binding['id'],self.at)

    def test_untracked_product_edits_rejected_but_existing_test_edits_allowed(self):
        root=self.create();catalog=self.catalog(root)
        (root/'e2e/new.txt').write_text('new test')
        verify_frozen_workspace(self.config,catalog)
        (root/'src/extra.txt').write_text('untracked product')
        with self.assertRaisesRegex(ValueError,'outside declared test roots'):
            verify_frozen_workspace(self.config,catalog)

    def test_public_prepare_builds_catalog_in_shared_workspace(self):
        spec={**self.config,'schema':'portable-project-prep-v1','source_paths':['src/app.txt']}
        specpath=self.root/'spec.json';save(specpath,spec)
        out=self.out.with_name('prepare')
        command=[sys.executable,str(SKILL/'playbook/v4/prepare_project.py'),str(specpath),str(out)]
        p=subprocess.run(command,text=True,capture_output=True)
        self.assertEqual(p.returncode,0,p.stderr)
        catalog=read(out/'catalog.json')
        self.assertEqual(catalog['project_root'],str(workspace_path(self.config)))
        self.assertEqual(catalog['workspace_policy'],POLICY)
        p=subprocess.run(command,text=True,capture_output=True)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout)['state'],'reused')

    def test_public_scene_preparation_reuses_prepared_root(self):
        root=self.create();catalog={**self.catalog(root),'schema':'portable-project-catalog-v1'}
        catpath=self.root/'catalog.json';save(catpath,catalog)
        config={**self.config,'source_checkout':str(root),'template_catalog':str(catpath)}
        from scene_pipeline import prepare
        for folder in [self.out,self.out.with_name('scene-b')]:
            with workspace_lease(config,folder,scene=True):
                result=prepare(config,folder)
                self.assertEqual(result['root'],str(root))
                self.assertFalse((folder/'checkout').exists())
                finish_scene(config,folder)

    def test_modifying_role_requires_a_live_parent_lease(self):
        root=self.create();catalog=self.catalog(root)
        with self.assertRaisesRegex(ValueError,'owning scene'):
            require_scene_lease(catalog if 'acceptance' in catalog else {**catalog,'acceptance':self.binding})
        with workspace_lease(self.config,self.out,scene=True):
            require_scene_lease({**catalog,'acceptance':self.binding})
            child=subprocess.run([sys.executable,str(SKILL/'scripts/acceptance_workspace.py')],
                input=json.dumps({**catalog,'acceptance':self.binding}),text=True,capture_output=True)
            self.assertEqual(child.returncode,0,child.stderr)
            finish_scene(self.config,self.out)
        self.assertNotIn('ACCEPTANCE_WORKSPACE_LEASE',os.environ)

    def test_child_checks_read_only_lock_without_reopening_for_write(self):
        root = self.create()
        catalog = {**self.catalog(root), 'acceptance': self.binding}
        lock = self.root/'.acceptance-local'/self.at/'workspace.lock'
        original_mode = lock.stat().st_mode & 0o777
        try:
            with workspace_lease(self.config, self.out, scene=True):
                lock.chmod(0o444)
                child = subprocess.run([sys.executable, str(SKILL/'scripts/acceptance_workspace.py')],
                    input=json.dumps(catalog), text=True, capture_output=True)
                self.assertEqual(child.returncode, 0, child.stderr)
                finish_scene(self.config, self.out)
        finally:
            lock.chmod(original_mode)

    def test_symlink_workspace_and_wrong_policy_rejected(self):
        root=workspace_path(self.config);root.symlink_to(self.root,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'symlink'):
            workspace_path(self.config)
        root.unlink()
        with self.assertRaisesRegex(ValueError,'per-scene'):
            workspace_path({**self.config,'workspace_policy':'per-scene'})


if __name__=='__main__':unittest.main()
