// Appended to the isolated instrumented preload; no branch/hit calculation here.
;(() => {
  const {ipcRenderer}=require('electron');
  const document_id=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const send=(phase='periodic')=>ipcRenderer.send('__acceptance_istanbul_snapshot__',{
    document_id,phase,versions:process.versions,coverage:globalThis.__coverage__ || {}});
  ipcRenderer.on('__acceptance_istanbul_flush__',()=>send('requested'));
  send('preload-initialized');
  setInterval(send,500);
  process.on('exit',()=>send('exit'));
})();
