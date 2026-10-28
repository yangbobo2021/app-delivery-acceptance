// Lifecycle adapter only: Istanbul owns all counters and coverage semantics.
const fs = require('node:fs'), path = require('node:path');
const {threadId}=require('node:worker_threads');
const output = process.env.ACCEPTANCE_ISTANBUL_OUTPUT;
if (output) {
  fs.mkdirSync(output, {recursive:true});
  const started = new Date().toISOString();
  function save(id, data, runtime, extra={}) {
    if (!data || typeof data !== 'object') return;
    const file = path.join(output, id+'.json'), temp=file+'.tmp';
    fs.writeFileSync(temp, JSON.stringify({schema:'istanbul-runtime-snapshot-v1', started_at:started,
      captured_at:new Date().toISOString(), runtime, versions:process.versions,
      ...extra, coverage:data}));
    fs.renameSync(temp,file);
  }
  const flush = (phase='periodic') => save('node-'+process.pid+'-thread-'+threadId, globalThis.__coverage__ || {},
    process.versions.electron ? 'electron-main' : 'node', {phase,thread_id:threadId});
  flush('collector-ready');
  const timer=setInterval(flush,500); timer.unref();
  process.on('exit',()=>flush('exit'));
  process.on('SIGUSR2',()=>flush('requested'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
    flush(signal);
    // Preserve the runtime's default termination, and any product signal handlers.
    if (process.listenerCount(signal)===1) {process.removeAllListeners(signal);process.kill(process.pid,signal);}
  });
  globalThis.__acceptanceIstanbulFlush = flush;
  if (process.versions.electron && process.type==='browser') {
    const {ipcMain,BrowserWindow}=require('electron');
    ipcMain.on('__acceptance_istanbul_snapshot__',(event,payload)=>{
      if (!payload || !/^[a-zA-Z0-9-]+$/.test(payload.document_id)) return;
      save('preload-'+process.pid+'-'+event.sender.id+'-'+payload.document_id,payload.coverage,
        'electron-preload',{document_id:payload.document_id,versions:payload.versions,phase:payload.phase});
    });
    globalThis.__acceptanceIstanbulNativeFlush=async()=>{
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('__acceptance_istanbul_flush__');
      await new Promise(resolve=>setTimeout(resolve,150));
      flush('requested');
    };
  }
}
