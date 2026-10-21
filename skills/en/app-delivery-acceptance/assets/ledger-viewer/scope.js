/* Original requirements remain visible; organization is a separate read-only layer. */
(function(root) {
  'use strict';
  const list = v => Array.isArray(v) ? v : [];
  function plan(data, run) {
    if (run && run.ledger_match !== 'current') return run.read_consistent !== false && run.scope_snapshot_valid ? run.documents?.['acceptance-plan.snapshot.json'] || null : null;
    return data?.documents?.['acceptance-plan.json'] || null;
  }
  function checks(value, requirementId) {
    return list(value?.checks).filter(c => !requirementId || c.requirement_id === requirementId);
  }
  function disposition(value, requirementId) {
    const values = checks(value, requirementId);
    if (!value) return 'legacy';
    if (!values.length) return 'unmapped';
    const kinds = new Set(values.map(c => c.disposition));
    return kinds.size === 1 ? [...kinds][0] : 'mixed';
  }
  function units(value, scene) {
    return list(value?.units).filter(u => list(scene?.scope?.unit_ids).includes(u.id));
  }
  function matches(value, record, unitId, isScene) {
    if (!unitId) return true;
    return isScene ? list(record.scope?.unit_ids).includes(unitId) : list(value?.units).some(u => u.id === unitId && (list(u.requirement_ids).includes(record.id) || list(u.rule_ids).includes(record.id)));
  }
  // A unit link alone is not evidence of check coverage. Only authored criteria
  // present in the scene's acceptance instructions can supply source mappings.
  function mapping(value, unit, scene) {
    if (!list(scene?.scope?.unit_ids).includes(unit.id)) return [];
    const admitted = checks(value).filter(c => c.disposition === 'included' && list(unit.check_ids).includes(c.id)).map(c => c.id);
    return list(scene?.scope?.criteria).filter(c => list(scene.acceptance?.criteria).includes(c.criterion)).map(c => ({
      criterion:c.criterion,
      check_ids:list(c.check_ids).filter(id => admitted.includes(id)),
      rule_ids:list(c.rule_ids).filter(id => list(unit.rule_ids).includes(id))
    })).filter(c => c.check_ids.length || c.rule_ids.length);
  }
  function organizationTrace(value, scenes) {
    return list(value?.units).map(unit => ({unit,
      checks:checks(value).filter(c => list(unit.check_ids).includes(c.id)),
      owned:list(scenes).filter(s => s.generation_unit_id === unit.id),
      references:list(scenes).filter(s => s.generation_unit_id !== unit.id && list(s.scope?.unit_ids).includes(unit.id)).map(scene => ({scene,mapping:mapping(value,unit,scene)}))
    }));
  }
  function snapshot(run, name) {
    const file = name.replace(/\.json$/, '.snapshot.json');
    const hash = run?.documents?.['run.json']?.ledger_hashes?.[name];
    return run?.read_consistent !== false && hash && run?.file_hashes?.[file] === hash ? run.documents?.[file] || null : null;
  }
  const api = {plan, checks, disposition, units, matches, mapping, organizationTrace, snapshot};
  root.AcceptanceScope = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
