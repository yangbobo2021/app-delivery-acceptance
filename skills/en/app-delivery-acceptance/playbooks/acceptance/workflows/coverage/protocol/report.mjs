// Compare tool-owned facts. This module never derives coverage units or counts.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function evidenceFiles(reportFile, report, aliases = {}) {
  const files = {[reportFile]: hash(reportFile)};
  if (!Array.isArray(report.raw_evidence) || !report.raw_evidence.length)
    throw Error('Coverage report lacks native evidence');
  for (const item of report.raw_evidence) {
    if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256 ?? ''))
      throw Error('Invalid coverage evidence binding');
    let file = item.path;
    const alias = aliases[file + '#' + item.sha256] ?? aliases[file];
    if (alias || !fs.existsSync(file) || hash(file) !== item.sha256) {
      if (alias?.sha256 !== item.sha256) throw Error('Coverage evidence hash mismatch: ' + file);
      file = alias.path;
    }
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || hash(file) !== item.sha256)
      throw Error('Coverage evidence hash mismatch: ' + file);
    files[file] = item.sha256;
  }
  return files;
}
export function unchangedEvidence(files) {
  for (const [file, expected] of Object.entries(files))
    if (!fs.existsSync(file) || hash(file) !== expected) throw Error('Coverage reader changed evidence: ' + file);
}
function facts(components) {
  if (!Array.isArray(components) || !components.length) throw Error('Coverage recount components missing');
  const seen = new Set();
  return components.map(component => {
    if (!component.id || seen.has(component.id) || !Array.isArray(component.source_paths) || !component.source_paths.length)
      throw Error('Coverage recount component identity invalid');
    seen.add(component.id);
    const value = {id: component.id, source_paths: [...component.source_paths].sort()};
    const metricNames = new Set(['line', 'branch', ...Object.keys(component).filter(name =>
      ['measured', 'incomplete', 'unavailable'].includes(component[name]?.status))]);
    for (const name of metricNames) {
      const metric = component[name];
      if (!metric || !['measured', 'incomplete', 'unavailable'].includes(metric.status))
        throw Error('Coverage recount metric status invalid: ' + name);
      if (metric.status !== 'unavailable') {
        if (['line', 'branch'].includes(name) || Object.hasOwn(metric, 'covered') || Object.hasOwn(metric, 'total')) {
          if (!Number.isSafeInteger(metric.covered) || !Number.isSafeInteger(metric.total) ||
              metric.covered < 0 || metric.total < metric.covered) throw Error('Coverage recount counts invalid: ' + name);
        } else if (!Object.hasOwn(metric, 'tool_output')) throw Error('Native coverage metric lacks tool output: ' + name);
      } else if (!metric.reason) throw Error('Unavailable coverage recount needs a reason');
      // Human labels/reasons are descriptive; tool-provided numerical facts,
      // including any extra unit data, must still agree.
      value[name] = Object.fromEntries(Object.entries(metric).filter(([key]) => !['reason', 'label'].includes(key)));
    }
    return value;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export function assertRecount(report, recount) {
  if (!['measured', 'incomplete'].includes(report.status) || report.status !== recount.status)
    throw Error('Coverage recount status mismatch; expected=' + report.status + '; actual=' + recount.status);
  const expected = facts(report.components), actual = facts(recount.components);
  if (!equal(actual, expected))
    throw Error('Coverage native recount mismatch; expected=' + JSON.stringify(expected) + '; actual=' + JSON.stringify(actual));
}
