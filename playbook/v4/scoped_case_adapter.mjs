import {isAbsolute} from 'node:path';
import {cligent} from '../v3/runtime-path.mjs';

// The host has already checked these runtime directories against the current
// acceptance. SDK additionalDirectories grants the exact external directories
// without changing cwd, network access, approval policy or sandbox mode.
export async function scopedSdk(loadSdk, roots) {
  if (!Array.isArray(roots) || roots.some(p => typeof p !== 'string' || !isAbsolute(p)))
    throw Error('Case runtime write roots must be host-validated absolute directories');
  const sdk = await loadSdk();
  const extend = options => ({...options,
    additionalDirectories: [...new Set([...(options?.additionalDirectories ?? []), ...roots])]});
  return {...sdk, Codex: class extends sdk.Codex {
    startThread(options) { return super.startThread(extend(options)); }
    resumeThread(id, options) { return super.resumeThread(id, extend(options)); }
  }};
}

export function caseAdapter(roots) {
  return new cligent.CodexAdapter({loadSdk: () => scopedSdk(cligent.loadCodexSdk, roots)});
}
