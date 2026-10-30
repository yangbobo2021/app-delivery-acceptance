import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ID = /^AT-[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const digest = raw => createHash('sha256').update(raw).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const index = '# 验收知识与工具库\n\n## 职责\n保存跨验收复用的经验与工具；不保存本次执行结果。\n\n## 何时读取\n准备或恢复验收阶段时读取，并按索引选择适用内容。\n\n## 内容入口\n当前没有已登记的可复用知识。\n';

export function inside(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('relative path inside the project required');
  let current = root;
  for (const part of relative.split(path.sep === '\\' ? /[\\/]/ : '/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) ? fs.lstatSync(current).isSymbolicLink() : isLink(current)) {
      throw Error('symlink is not allowed: ' + current);
    }
  }
  return current;
}
function isLink(file) {
  try { return fs.lstatSync(file).isSymbolicLink(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function projectRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('absolute project_root required');
  const root = fs.realpathSync(value);
  if (!fs.statSync(root).isDirectory()) throw Error('user project directory must exist');
  for (let parent = path.dirname(root); ; parent = path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, '.acceptance')) || fs.existsSync(path.join(parent, '.acceptance-local'))) {
      throw Error('acceptance store belongs to user project root ' + parent);
    }
    if (parent === path.dirname(parent)) break;
  }
  const git = path.join(root, '.git');
  if (fs.existsSync(git) && fs.statSync(git).isFile()) {
    const text = fs.readFileSync(git, 'utf8').trim();
    if (text.startsWith('gitdir:') && fs.existsSync(path.resolve(root, text.slice(7).trim(), 'commondir'))) {
      throw Error('isolated Git worktree cannot be the acceptance store root');
    }
  }
  for (const item of ['.acceptance', '.acceptance-local', '.gitignore']) inside(root, item);
  const tracked = spawnSync('git', ['ls-files', '-z', '--', '.acceptance-local'], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout) throw Error('.acceptance-local contains tracked files');
  return root;
}

export function normalizeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('creation request object required');
  const allowed = ['project_root', 'request_id', 'acceptance_id', 'title', 'owner', 'user_request'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error('unknown create-only field: ' + key);
  for (const key of ['request_id', 'user_request']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw Error(key + ' required');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.request_id)) throw Error('invalid request_id');
  const root = projectRoot(value.project_root);
  const id = value.acceptance_id ?? ('AT-' + digest(value.request_id).slice(0, 16));
  if (!ID.test(id)) throw Error('acceptance ID must use the stable AT- prefix');
  const title = value.title ?? '交付测试';
  const owner = value.owner ?? os.userInfo().username;
  if (typeof title !== 'string' || !title.trim() || typeof owner !== 'string' || !owner.trim()) {
    throw Error('title and owner must be nonempty strings');
  }
  return { project_root: root, request_id: value.request_id, acceptance_id: id, title, owner, user_request: value.user_request };
}

export function createAcceptance(value) {
  // Validation precedes lock and store creation. No model, Python or project command is invoked.
  const request = normalizeRequest(value);
  const root = request.project_root, id = request.acceptance_id;
  const shared = inside(root, '.acceptance/' + id);
  const local = inside(root, '.acceptance-local/' + id);
  const pointer = inside(root, '.acceptance-local/current.json');
  const lock = inside(root, '.acceptance-local/current.lock.d');
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw Error('acceptance lifecycle is busy; inspect current.lock.d before recovery'); throw error; }
  const created = [], directories = [];
  let modifiedIgnore;
  function mkdir(directory, mode = 0o755) {
    if (!fs.existsSync(directory)) { fs.mkdirSync(directory, { mode }); directories.push(directory); }
    else if (!fs.statSync(directory).isDirectory()) throw Error('directory required: ' + directory);
  }
  function write(file, raw, mode = 0o644) {
    fs.writeFileSync(file, raw, { flag: 'wx', mode }); created.push(file);
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), json({ pid: process.pid, request_id: request.request_id, created_at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    // Recheck protected paths after acquiring the lifecycle claim.
    for (const name of ['.acceptance/' + id, '.acceptance-local/' + id, '.acceptance-local/current.json', '.acceptance/knowledge/INDEX.md']) inside(root, name);
    const current = fs.existsSync(pointer) ? read(pointer) : null;
    if (current && (Object.keys(current).length !== 1 || !ID.test(current.acceptance_id))) throw Error('invalid current.json');
    if (current && current.acceptance_id !== id) throw Error('current acceptance is ' + current.acceptance_id + '; finish it before creating another acceptance');
    if (fs.existsSync(shared) || fs.existsSync(local)) {
      if (!current || current.acceptance_id !== id) throw Error('acceptance ID already exists without matching current pointer');
      const receipt = read(inside(root, '.acceptance-local/' + id + '/creation-result.json'));
      const original = read(inside(root, '.acceptance/' + id + '/creation.json'));
      if (receipt.schema !== 'acceptance-creation-result-v1' || JSON.stringify(receipt.request) !== JSON.stringify(request) ||
          original.request_id !== request.request_id) throw Error('creation request conflicts with existing acceptance');
      for (const [name, expected] of Object.entries(receipt.identity_files)) {
        const file = inside(root, name);
        if (digest(fs.readFileSync(file)) !== expected) throw Error('creation identity changed: ' + name);
      }
      return { ...receipt, status: 'already_created', scope_status: fs.existsSync(path.join(shared, 'scope.json')) ? 'defined' : 'not_defined' };
    }
    mkdir(inside(root, '.acceptance'));
    mkdir(shared);
    mkdir(local, 0o700);
    mkdir(inside(root, '.acceptance/knowledge'));
    const knowledge = inside(root, '.acceptance/knowledge/INDEX.md');
    if (!fs.existsSync(knowledge)) write(knowledge, index);
    const ignore = inside(root, '.gitignore');
    const before = fs.existsSync(ignore) ? fs.readFileSync(ignore) : null;
    const text = before?.toString('utf8') ?? '';
    if (!/^\/?\.acceptance-local\/\s*$/m.test(text)) {
      const after = text + (text && !text.endsWith('\n') ? '\n' : '') + '/.acceptance-local/\n';
      if (before === null) write(ignore, after);
      else { fs.writeFileSync(ignore, after); modifiedIgnore = { before, after }; }
    }
    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
    if (git.status === 0 && spawnSync('git', ['check-ignore', '--no-index', '--', path.join(local, 'creation-probe')], { cwd: root }).status !== 0) {
      throw Error('.acceptance-local must actually be Git-ignored');
    }
    const createdAt = new Date().toISOString();
    write(path.join(shared, 'manifest.json'), json({ schema: 'acceptance-manifest-v1', acceptance_id: id,
      project_id: path.basename(root), title: request.title, owner: request.owner, created_at: createdAt }));
    write(path.join(shared, 'creation.json'), json({ schema: 'acceptance-creation-v1', acceptance_id: id,
      request_id: request.request_id, user_request: request.user_request, created_at: createdAt,
      mode: 'create_only', stop_reason: 'created_without_scope' }));
    const identityFiles = Object.fromEntries(['manifest.json', 'creation.json'].map(name => {
      const file = path.join(shared, name); return [path.relative(root, file), digest(fs.readFileSync(file))];
    }));
    const receipt = { schema: 'acceptance-creation-result-v1', status: 'created', request,
      acceptance_id: id, project_root: root, shared, local, current: pointer, created_at: createdAt,
      scope_status: 'not_defined', stopped_after: 'create', identity_files: identityFiles,
      created_files: [...created.map(file => path.relative(root, file)), path.relative(root, path.join(local, 'creation-result.json')), path.relative(root, pointer)],
      modified_files: modifiedIgnore ? ['.gitignore'] : [],
      next_step: 'Define the real scope for this same AT only when requested; no requirements, scenarios or cases have been generated.' };
    write(path.join(local, 'creation-result.json'), json(receipt), 0o600);
    write(pointer, json({ acceptance_id: id }), 0o600);
    return receipt;
  } catch (error) {
    // Roll back only files created by this live call, never pre-existing AT data.
    for (const file of created.reverse()) fs.unlinkSync(file);
    if (modifiedIgnore && fs.readFileSync(path.join(root, '.gitignore'), 'utf8') === modifiedIgnore.after) {
      fs.writeFileSync(path.join(root, '.gitignore'), modifiedIgnore.before);
    }
    for (const directory of directories.reverse()) fs.rmdirSync(directory);
    throw error;
  } finally {
    fs.rmSync(path.join(lock, 'owner.json'), { force: true });
    fs.rmdirSync(lock);
  }
}
