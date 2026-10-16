import hashlib, subprocess, tempfile, unittest, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from code_coverage import pinned_source_bytes
class GitlinkSourceTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.git(self.root,'init','-q');self.child=self.root/'client';self.child.mkdir();self.git(self.child,'init','-q')
  (self.child/'app.ts').write_text('export const n = 1;\n');self.git(self.child,'add','app.ts');self.commit(self.child);self.child_rev=self.git(self.child,'rev-parse','HEAD').strip()
  self.git(self.root,'update-index','--add','--cacheinfo',f'160000,{self.child_rev},client');self.commit(self.root);self.rev=self.git(self.root,'rev-parse','HEAD').strip()
 def git(self,root,*args):return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.DEVNULL,text=True)
 def commit(self,root):self.git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture')
 def test_reads_child_commit_pinned_by_parent(self):self.assertEqual(pinned_source_bytes(self.root,self.rev,'client/app.ts'),b'export const n = 1;\n')
 def test_does_not_follow_child_head_or_working_bytes(self):
  (self.child/'app.ts').write_text('export const n = 2;\n');self.git(self.child,'add','app.ts');self.commit(self.child)
  self.assertEqual(pinned_source_bytes(self.root,self.rev,'client/app.ts'),b'export const n = 1;\n')
  self.assertNotEqual(hashlib.sha256((self.child/'app.ts').read_bytes()).digest(),hashlib.sha256(pinned_source_bytes(self.root,self.rev,'client/app.ts')).digest())
 def test_untracked_child_file_is_rejected(self):
  (self.child/'secret.ts').write_text('untracked')
  with self.assertRaises(subprocess.CalledProcessError):pinned_source_bytes(self.root,self.rev,'client/secret.ts')
 def test_traversal_and_symbolic_revision_rejected(self):
  for revision,path in [(self.rev,'../app.ts'),('HEAD','client/app.ts'),(self.rev,str(self.child/'app.ts'))]:
   with self.assertRaises(ValueError):pinned_source_bytes(self.root,revision,path)
 def test_gitlink_itself_is_not_source(self):
  with self.assertRaises(ValueError):pinned_source_bytes(self.root,self.rev,'client')
if __name__=='__main__':unittest.main()
