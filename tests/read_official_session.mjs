// Use the selected installed runtime's official codec, not assumptions about journal layout.
import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.ACCEPTANCE_PACKAGE_ROOT??fileURLToPath(new URL('../skills/en/app-delivery-acceptance/playbooks/acceptance/',import.meta.url));
const {openSessionStore}=await import(pathToFileURL(path.join(root,'node_modules/@sublang/playbook/reference/sdlc/code.playbook/session-store.js')));
const [directory,id]=process.argv.slice(2);const stream=await openSessionStore(directory).readStream(id);process.stdout.write(JSON.stringify(stream.entries.map(entry=>entry.record)));
