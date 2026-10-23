#!/usr/bin/env python3
"""Isolated Linux cold install; never copies credentials to a report or image."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import uuid

SKILL = Path(__file__).resolve().parents[2]


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--image', default='acceptance-skill-probe:20261021')
    args = parser.parse_args()
    if not args.output.is_absolute() or args.output.exists():
        parser.error('Use a new absolute output directory')
    if os.environ.get('ACCEPTANCE_AGENT') != 'codex' or not os.environ.get('ACCEPTANCE_MODEL'):
        parser.error('This environment probe needs the actual caller Codex/model')
    args.output.mkdir(parents=True)
    name = 'acceptance-quality-' + uuid.uuid4().hex[:10]
    repo = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], cwd=SKILL, text=True).strip())
    archive = args.output / 'source.tar'
    run(['git', 'archive', '--format=tar', '--output=' + str(archive), 'HEAD'], cwd=repo)
    codex_home = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex'))
    auth = codex_home / 'auth.json'
    if not auth.is_file():
        parser.error('Caller Codex authentication unavailable; do not create a fallback identity')
    uid, gid = str(os.getuid()), str(os.getgid())
    linux_repo = '/opt/Quality Skill 测试'
    linux_skill = linux_repo + '/' + SKILL.relative_to(repo).as_posix()
    command = ['docker', 'create', '--name', name, '--label', 'purpose=acceptance-agent-quality',
               '--env', 'HOME=/home/quality', '--env', 'CODEX_HOME=/home/quality/.codex',
               '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'ACCEPTANCE_AGENT', '--env', 'ACCEPTANCE_MODEL',
               '--mount', f'type=bind,source={auth},target=/home/quality/.codex/auth.json,readonly']
    config = codex_home / 'config.toml'
    if config.is_file():
        command += ['--mount', f'type=bind,source={config},target=/home/quality/.codex/config.toml,readonly']
    for key in ('ACCEPTANCE_EFFORT', 'ACCEPTANCE_CODEX_PROFILE', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'):
        if key in os.environ:
            command += ['--env', key]
    command += ['--entrypoint', '/bin/sh', args.image, '-c', 'exec sleep infinity']
    container = subprocess.check_output(command, text=True).strip()
    state = {'container': name, 'container_id': container, 'uid': uid, 'gid': gid,
             'skill': linux_skill, 'workspace': '/work', 'image': args.image,
             'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
             'credential_handling': 'Caller auth/config mounted read-only; container never committed; remove after tests.'}
    (args.output / 'environment.json').write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    run(['docker', 'start', name], stdout=subprocess.DEVNULL)
    setup = ['docker', 'exec', '--user', '0', name]
    run(setup + ['mkdir', '-p', linux_repo, '/work', '/home/quality/.codex'])
    run(['docker', 'cp', str(archive), name + ':/tmp/source.tar'])
    run(setup + ['tar', '-xf', '/tmp/source.tar', '-C', linux_repo])
    run(setup + ['chown', '-R', uid + ':' + gid, linux_repo, '/work'])
    run(setup + ['chown', uid + ':' + gid, '/home/quality', '/home/quality/.codex'])
    prefix = ['docker', 'exec', '--user', uid + ':' + gid, '--workdir', linux_skill, name]
    with (args.output / 'cold-install.log').open('w') as stream:
        run(prefix + ['python3', linux_skill + '/scripts/ensure_runtime.py'], stdout=stream, stderr=subprocess.STDOUT)
    with (args.output / 'preflight.log').open('w') as stream:
        run(prefix + ['node', linux_skill + '/playbook/agent-preflight.mjs'], stdout=stream, stderr=subprocess.STDOUT)
    with (args.output / 'reuse-install.log').open('w') as stream:
        run(prefix + ['python3', linux_skill + '/scripts/ensure_runtime.py'], stdout=stream, stderr=subprocess.STDOUT)
    print(json.dumps({'status': 'ready', **state}, ensure_ascii=False))


if __name__ == '__main__':
    main()
