import fs from 'node:fs';
import path from 'node:path';

// Commands are project data. An empty argument, braces or a familiar filename
// does not identify a shell expression, a backend or an invalid operation.
export function validArgv(value) {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string' && value[0].length > 0 &&
    value.every(part => typeof part === 'string' && !part.includes('\0'));
}
export function substituteArgv(value, bindings) {
  if (!validArgv(value)) throw Error('Command requires an executable and string arguments');
  return value.map(part => part.replace(/\{([^{}]+)\}/g, (literal, key) =>
    Object.hasOwn(bindings, key) ? bindings[key] : literal));
}
export function resolveExecutable(program, {cwd, env = process.env}) {
  const candidates = program.includes(path.sep) ? [path.resolve(cwd, program)] :
    (env.PATH ?? '').split(path.delimiter).map(folder => path.resolve(cwd, folder || '.', program));
  for (const file of candidates) {
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, fs.constants.X_OK); return fs.realpathSync(file); } }
    catch (error) { if (!['ENOENT','ENOTDIR','EACCES'].includes(error.code)) throw error; }
  }
  throw Error('Executable cannot be resolved in the actual project environment: ' + program);
}
