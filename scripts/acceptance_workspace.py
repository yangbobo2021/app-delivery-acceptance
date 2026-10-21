"""One reusable, sequential Git workspace per acceptance; never reset or delete it."""
from contextlib import contextmanager
import fcntl
import json
import os
import sys
from pathlib import Path
import subprocess

from acceptance_store import guard, inside, locations, owned_path, read, save

POLICY = 'single-acceptance-v1'


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def workspace_path(config):
    binding = config['acceptance']
    _, _, local = locations(binding['project_root'], binding['id'])
    expected = inside(local, 'workspace')
    if config.get('workspace_policy', POLICY) != POLICY:
        raise ValueError('per-scene worktrees are retired; create a new single-workspace handoff, keep old evidence')
    if config.get('workspace') and Path(config['workspace']).absolute() != expected:
        raise ValueError('workspace must be .acceptance-local/<AT-ID>/workspace')
    return expected


@contextmanager
def workspace_lease(config, output, *, scene=False):
    """Serialize preparation/execution/review; interrupted scenes retain ownership."""
    guard(config, [output])
    root = workspace_path(config)
    local = root.parent
    owner_path = inside(local, 'workspace-owner.json')
    output = owned_path(local / 'workflows', output)
    with inside(local, 'workspace.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError('acceptance workspace is busy; scenes and preparation must run sequentially') from exc
        owner = read(owner_path) if owner_path.exists() else None
        if owner and (not scene or owner.get('output_dir') != str(output)):
            raise ValueError('another scene owns this workspace; resume/reconcile it before starting another scene')
        if scene and not owner:
            save(owner_path, {'schema': 'acceptance-workspace-owner-v1',
                             'acceptance_id': config['acceptance']['id'], 'output_dir': str(output)})
        previous = os.environ.get('ACCEPTANCE_WORKSPACE_LEASE')
        os.environ['ACCEPTANCE_WORKSPACE_LEASE'] = str(output)
        try:
            yield root
        finally:
            if previous is None:
                os.environ.pop('ACCEPTANCE_WORKSPACE_LEASE', None)
            else:
                os.environ['ACCEPTANCE_WORKSPACE_LEASE'] = previous
            fcntl.flock(lock, fcntl.LOCK_UN)


def finish_scene(config, output):
    """Release only a completed scene, while its caller still holds the lease."""
    path = workspace_path(config).parent / 'workspace-owner.json'
    if not path.exists() or read(path).get('output_dir') != str(Path(output).resolve()):
        raise ValueError('workspace ownership changed')
    path.unlink()


def ensure_workspace(config, source, revision, components=(), component_sources=None):
    """Call under a lease. Reuse existing bytes; mismatch stops without checkout/reset."""
    root = workspace_path(config)
    source = Path(source).resolve()
    if git(source, 'rev-parse', 'HEAD') != revision:
        raise ValueError('source revision differs from frozen catalog/spec')
    common = git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if root.exists():
        if not (root / '.git').exists() or Path(git(root, 'rev-parse', '--show-toplevel')).resolve() != root:
            raise ValueError('workspace exists but is not the registered Git checkout; never overwrite it')
        if git(root, 'rev-parse', 'HEAD') != revision:
            raise ValueError('workspace revision changed; freeze a new version/catalog under the same acceptance ID')
        if Path(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve() != Path(common).resolve():
            raise ValueError('workspace belongs to another Git repository')
    else:
        subprocess.run(['git', 'worktree', 'add', '--detach', str(root), revision], cwd=source,
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    sources = component_sources or {}
    for item in components:
        part = inside(root, item['path'])
        if part == root:
            raise ValueError('component must be beneath workspace')
        if (part / '.git').exists():
            if Path(git(part, 'rev-parse', '--show-toplevel')).resolve() != part:
                raise ValueError('invalid component checkout')
        else:
            if part.exists():
                if not part.is_dir() or any(part.iterdir()):
                    raise ValueError('component destination is not empty; never overwrite it')
                part.rmdir()
            origin = Path(sources.get(item['path'], source / item['path'])).resolve()
            if git(origin, 'rev-parse', 'HEAD') != item['revision']:
                raise ValueError('component source revision mismatch')
            subprocess.run(['git', 'worktree', 'add', '--detach', str(part), item['revision']], cwd=origin,
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if git(part, 'rev-parse', 'HEAD') != item['revision']:
            raise ValueError('component revision changed; prepare the new version explicitly')
    return root


def verify_frozen_workspace(config, catalog):
    """Test-only edits can accumulate. Product bytes/versions cannot drift during a scene."""
    root = workspace_path(config)
    if Path(catalog['project_root']).resolve() != root or catalog.get('workspace_policy') != POLICY:
        raise ValueError('catalog must be newly prepared for the single acceptance workspace')
    if git(root, 'rev-parse', 'HEAD') != catalog['revision']:
        raise ValueError('workspace revision changed; freeze a new version/catalog')
    if catalog.get('preparation_protocol') == 'two-agent-v1' and not catalog.get('runtime'):
        raise ValueError('catalog is missing its runtime Agent binding')
    runtime = catalog.get('runtime')
    if runtime:
        if not isinstance(runtime, dict) or not all(runtime.get(key) for key in ('manifest', 'sha256')):
            raise ValueError('catalog runtime binding is incomplete')
        from runtime_preparation import validate_runtime
        checked = validate_runtime(runtime['manifest'], expected_acceptance=config['acceptance'], resmoke=False)
        if (checked['runtime_sha256'] != runtime['sha256'] or
                checked['workspace'] != str(root) or checked['revision'] != catalog['revision']):
            raise ValueError('catalog runtime Agent result changed or belongs to another checkout')
    from acceptance_store import digest
    for name, expected in catalog.get('source_hashes', {}).items():
        file = inside(root, name)
        if not file.is_file() or digest(file) != expected:
            raise ValueError('frozen product source changed: ' + name)
    allowed = tuple(name.rstrip('/') + '/' for name in catalog.get('write_roots', catalog.get('test_roots', [])))
    components = {item['path']: item['revision'] for item in catalog.get('components', [])}
    for prefix, revision in [('', catalog['revision']), *components.items()]:
        repo = inside(root, prefix)
        if git(repo, 'rev-parse', 'HEAD') != revision:
            raise ValueError('frozen component revision changed: ' + prefix)
        names = set(git(repo, 'diff', '--name-only', 'HEAD').splitlines())
        names.update(git(repo, 'ls-files', '--others', '--exclude-standard').splitlines())
        for name in names:
            full = prefix + '/' + name if prefix else name
            if not prefix and full in components:
                continue
            if not full.startswith(allowed):
                raise ValueError('workspace change outside declared test roots: ' + full)


def require_scene_lease(config):
    """Public case/repair model runners must be children of the leased pipeline."""
    root = workspace_path(config)
    if config.get('workspace_policy') != POLICY or Path(config['project_root']).resolve() != root:
        raise ValueError('case runner requires a newly prepared single-workspace catalog')
    owner_path = root.parent / 'workspace-owner.json'
    lease = os.environ.get('ACCEPTANCE_WORKSPACE_LEASE')
    if not lease or not owner_path.is_file() or read(owner_path).get('output_dir') != lease:
        raise ValueError('case/repair entry requires the owning scene pipeline lease')
    # The scene host owns and creates this file. A debugging child only needs
    # to test its held lock; it must not need write access to the ID root.
    with (root.parent / 'workspace.lock').open('r') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        fcntl.flock(lock, fcntl.LOCK_UN)
        raise ValueError('workspace lease is no longer held; stop before starting a model')


if __name__ == '__main__':
    try:
        require_scene_lease(json.load(sys.stdin))
    except (ValueError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
