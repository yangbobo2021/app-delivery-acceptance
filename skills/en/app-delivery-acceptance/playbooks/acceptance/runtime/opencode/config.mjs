// Private IPC only: stdout contains native resolved configuration and must never be logged.
import {createOpencodeServer,createOpencodeClient} from '@opencode-ai/sdk/v2';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),25000);
const abort=()=>controller.abort();
process.once('SIGTERM',abort);process.once('SIGINT',abort);
let server;
try {
  server=await createOpencodeServer({hostname:'127.0.0.1',port:0,timeout:20000,
    signal:controller.signal,config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT||'{}')});
  const headers=process.env.OPENCODE_SERVER_PASSWORD?{Authorization:'Basic '+Buffer.from(
    `${process.env.OPENCODE_SERVER_USERNAME||'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}:undefined;
  const client=createOpencodeClient({baseUrl:server.url,headers});
  const result=await client.config.get({directory:process.cwd()},{signal:controller.signal});
  if(result.error||!result.data) throw Error('Cannot resolve native configuration');
  process.stdout.write(JSON.stringify(result.data));
} catch {
  process.stderr.write('OpenCode native configuration resolution failed\n');
  process.exitCode=1;
} finally {
  clearTimeout(timer);server?.close();
  process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);
}
