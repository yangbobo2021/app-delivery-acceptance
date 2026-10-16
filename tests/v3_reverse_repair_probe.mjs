import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {splitDiffEntries} from '../playbook/v3/reverse/chunks.mjs';
import {collectSourceReads,verifySourceReads,combineSourceReadRounds,verifyReverseReadEvidence} from '../playbook/v3/reverse/source-reads.mjs';
import {normalizeRuleCoverage} from '../playbook/v3/reverse/normalize.mjs';
import {applyCaseCodeRepair} from '../playbook/v3/cases/code-repair.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const root=mkdtempSync(join(tmpdir(),'acceptance-v3-probe-'));
try{
 const entries=[{path:'a.ts',patch:'diff --git a/a.ts b/a.ts\n'+('@@ -1 +1 @@\n-old\n+new\n').repeat(1800)},
  {path:'b.ts',patch:'diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-old\n+new\n'}];
 const chunks=splitDiffEntries(entries,3000);
 assert.ok(chunks.length>2);
 assert.ok(chunks.every(x=>x.text.length<=3000));
 assert.equal(chunks.map(x=>x.text).join(''),entries.map(x=>x.patch).join(''));

 mkdirSync(join(root,'src'));mkdirSync(join(root,'specs'));mkdirSync(join(root,'tests'));
 const source='export const value = 1;\n'+('const visible = true;\n').repeat(300);
 const contract='The user sees a visible value.\n';
 writeFileSync(join(root,'src/a.ts'),source);writeFileSync(join(root,'specs/contract.md'),contract);
 const inventory={source_paths:['src/a.ts'],source_hashes:{'src/a.ts':sha(source)},
  files:[{path:'specs/contract.md',kind:'noncode',sha256:sha(contract)}]};
 const evidence=collectSourceReads([{kind:'lines',path:'specs/contract.md',start:1,end:1},
  {kind:'search',pattern:'visible',paths:['src/a.ts']},
  {kind:'lines',path:'../outside',start:1,end:1}],inventory,root);
 assert.equal(evidence.results[0].matches[0].excerpt,contract.trim());
 assert.equal(evidence.results[1].matches.length,8);
 assert.ok(evidence.results[2].denied);
 assert.ok(verifySourceReads(evidence,inventory,root));
 assert.ok(JSON.stringify(evidence.results).length<=12000);
 const supplemental=collectSourceReads([{kind:'lines',path:'src/a.ts',start:1,end:2}],inventory,root);
 const wide=collectSourceReads([{kind:'lines',path:'src/a.ts',start:1,end:81},
  {kind:'lines',path:'src/a.ts',start:82,end:162}],inventory,root,{revision:true});
 assert.equal(wide.evidence_char_limit,32000);
 assert.ok(verifySourceReads(wide,inventory,root));
 assert.ok(wide.results.every(x=>x.matches.every(m=>!m.truncated)));
 const revised=combineSourceReadRounds(evidence,supplemental,inventory,root);
 assert.equal(revised.rounds.length,2);
 assert.ok(verifyReverseReadEvidence(revised,inventory,root));
 assert.ok(verifyReverseReadEvidence(combineSourceReadRounds(revised,supplemental,inventory,root),inventory,root));
 assert.throws(()=>combineSourceReadRounds(combineSourceReadRounds(revised,supplemental,inventory,root),supplemental,inventory,root),/round limit/);
 revised.rounds[1].evidence.results[0].matches[0].excerpt='tampered';
 assert.equal(verifyReverseReadEvidence(revised,inventory,root),false);
 const denied=collectSourceReads([{kind:'search',pattern:'visible',paths:Array(40).fill('src/a.ts')}],inventory,root);
 assert.equal(denied.results[0].kind,'denied');
 assert.ok(verifySourceReads(denied,inventory,root));
 const normalized=normalizeRuleCoverage({reverse_rules:[{id:'R-new',status:'needs_confirmation'}],
  behavior_impacts:[{id:'B1',coverage:'existing_rule',target_ids:['R-new']}]},[]);
 assert.deepEqual(normalized.changes,[{id:'B1',from:'existing_rule',to:'unresolved'}]);
 assert.equal(normalized.candidate.behavior_impacts[0].coverage,'unresolved');
 writeFileSync(join(root,'tests/a.test.ts'),'test("scenario", () => { expect(1).toBe(1); });\n');
 const output=join(root,'output');mkdirSync(join(output,'attempt-2'),{recursive:true});
 const old=readFileSync(join(root,'tests/a.test.ts'),'utf8');
 const receipt=applyCaseCodeRepair({projectRoot:root,outputDir:output,attempt:2,
  catalog:[{id:'C1',kind:'automated',origin:'new',test_file:'tests/a.test.ts',selector:'scenario'}],
  selected:['C1'],productSources:['src/a.ts'],candidate:{edits:[{test_file:'tests/a.test.ts',expected_sha256:sha(old),
   replacements:[{old:'expect(1).toBe(1)',new:'expect(2).toBe(2)'}]}]}});
 assert.equal(receipt.files[0].after_sha256,sha(readFileSync(join(root,'tests/a.test.ts'))));
 assert.throws(()=>applyCaseCodeRepair({projectRoot:root,outputDir:output,attempt:3,
  catalog:[{id:'C1',kind:'automated',origin:'new',test_file:'src/a.ts',selector:'value'}],
  selected:['C1'],productSources:['src/a.ts'],candidate:{edits:[{test_file:'src/a.ts',expected_sha256:sha(source),
   replacements:[{old:'value = 1',new:'value = 2'}]}]}}),/selected declared test file/);
 symlinkSync(join(root,'src/a.ts'),join(root,'tests/alias.test.ts'));
 assert.throws(()=>applyCaseCodeRepair({projectRoot:root,outputDir:output,attempt:4,
  catalog:[{id:'C2',kind:'automated',origin:'new',test_file:'tests/alias.test.ts',selector:'value'}],
  selected:['C2'],productSources:['src/a.ts'],candidate:{edits:[{test_file:'tests/alias.test.ts',expected_sha256:sha(source),
   replacements:[{old:'value = 1',new:'value = 2'}]}]}}),/symlink/);
 console.log('v3 reverse/repaired-code probes passed');
}finally{rmSync(root,{recursive:true,force:true});}
