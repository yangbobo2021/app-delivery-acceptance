"""Static source associations for display only; never execution bindings/results."""
from acceptance_store import digest, inside, read


def static_case_associations(shared, local, acceptance_id, scene_ids):
    path = shared / 'tests.json'
    if not path.is_file():
        return {}
    value = read(path)
    if value.get('schema') != 'static-existing-tests-v1':
        return {}  # Other test catalogs retain their own protocol.
    if value.get('acceptance_id') != acceptance_id:
        raise ValueError('static associations belong to another acceptance')
    tests, mappings = value.get('tests'), value.get('scene_mappings')
    if not isinstance(tests, list) or not isinstance(mappings, list):
        raise ValueError('static tests and scene_mappings must be lists')
    by_id, hashes = {}, {}
    for test in tests:
        if not isinstance(test, dict) or not all(isinstance(test.get(k), str) and test[k]
                                               for k in ('id', 'title', 'file')):
            raise ValueError('invalid static test identity/title/file')
        if test['id'] in by_id:
            raise ValueError('duplicate static test: ' + test['id'])
        file = inside(local / 'workspace', test['file'])
        expected = test.get('file_sha256')
        if not isinstance(expected, str) or len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise ValueError('static test requires a source file SHA-256')
        if file not in hashes:
            hashes[file] = digest(file) if file.is_file() else None
        verification = ('unavailable' if hashes[file] is None else
                        'matches' if hashes[file] == expected else 'changed')
        by_id[test['id']] = {**test, 'source_verification': verification}
    result = {}
    for mapping in mappings:
        if not isinstance(mapping, dict):
            raise ValueError('invalid static scene mapping')
        sid, ids = mapping.get('scene_id'), mapping.get('test_ids')
        if not isinstance(sid, str) or sid not in scene_ids or sid in result:
            raise ValueError('unknown or duplicate static scene mapping: ' + str(sid))
        if not isinstance(ids, list) or not all(isinstance(tid, str) and tid in by_id for tid in ids):
            raise ValueError('unknown static test association: ' + sid)
        if len(set(ids)) != len(ids):
            raise ValueError('duplicate static test association: ' + sid)
        result[sid] = {'source': 'static_analysis', 'tests': [by_id[tid] for tid in ids],
                       'mapping_basis': mapping.get('mapping_basis', ''),
                       'limitations': mapping.get('missing_or_uncertain', '')}
    return result


def attach_static_associations(rows, associations):
    """Enrich projected scene rows without altering their execution/version facts."""
    for trace in rows:
        trace['static_case_associations'] = {
            scene['id']: associations[scene['id']]
            for scene in trace.get('scenarios', []) if scene['id'] in associations}
