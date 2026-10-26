// OpenCode owns config resolution, authentication and sessions; cligent owns event normalization.
import {execFileSync, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const credentialKey=/^(?:api[_-]?key|key|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|secret|client[_-]?secret|authorization|auth|credentials?|headers)$/i;

export function sensitiveValues(value, sensitive=false) {
  if (typeof value==='string') return sensitive && value.length>3 ? [value] : [];
  if (!value || typeof value!=='object') return [];
  return Object.entries(value).flatMap(([key,item])=>sensitiveValues(item,
    sensitive || /key|token|password|secret|auth|headers/i.test(key)));
}

function withoutCredentials(value) {
  if (!value || typeof value!=='object') return value;
  if (Array.isArray(value)) return value.map(withoutCredentials);
  return Object.fromEntries(Object.entries(value).filter(([key])=>
    !credentialKey.test(key)).map(([key,item])=>[key,withoutCredentials(item)]));
}

export function resolveOpenCodeRuntime({env, cwd, model, effort}) {
  if (typeof model!=='string' || !model.trim())
    throw Error('Current model is unknown. Pass ACCEPTANCE_MODEL=provider/model for OpenCode.');
  const slash=model.indexOf('/');
  if (slash<1 || slash===model.length-1 || model!==model.trim())
    throw Error('OpenCode requires an explicit ACCEPTANCE_MODEL in provider/model form.');
  let config,version;
  try {
    // Never print this output: native interpolation may include credentials.
    config=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./opencode-config.mjs',import.meta.url))],{
      env,cwd,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
    version=execFileSync('opencode',['--version'],{
      env,cwd,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
  } catch {
    throw Error('Cannot resolve the calling OpenCode configuration/CLI. Preserve its PATH, XDG paths, OPENCODE_CONFIG and authentication environment.');
  }
  const provider=model.slice(0,slash),modelId=model.slice(slash+1);
  const providerConfig=config.provider?.[provider];
  const variant=effort||null;
  // A custom provider variant must exist; OpenCode otherwise silently ignores it.
  if (variant && !providerConfig?.models?.[modelId]?.variants?.[variant])
    throw Error('OpenCode effort must name a configured model variant; no effort is silently substituted.');
  const service={provider,base_url:providerConfig?.options?.baseURL??null};
  const identity=withoutCredentials({provider:providerConfig??{},model,variant});
  // Strip query credentials before computing/publicizing the service identity.
  const urlSecrets=[];
  if (service.base_url) {
    try {
      const url=new URL(service.base_url);
      const credentialParams=[...url.searchParams].filter(([key])=>credentialKey.test(key)||/signature$/i.test(key));
      urlSecrets.push(service.base_url,...[url.username,url.password,...credentialParams.map(([,value])=>value)].filter(v=>v.length>3));
      service.base_url=url.origin+url.pathname;
      url.username='';url.password='';
      for (const [key] of credentialParams) url.searchParams.delete(key);
      if (identity.provider.options) identity.provider.options.baseURL=url.toString();
    } catch {throw Error('Invalid OpenCode provider URL; its value was not logged');}
  }
  const environment={...env};
  for (const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_DIR'])
    if (environment[key]) environment[key]=resolve(cwd,environment[key]);
  return {service,variant,environment,providerConfig,
    binding:{cli_version:version,config_sha256:createHash('sha256').update(JSON.stringify(identity)).digest('hex')},
    secrets:[...sensitiveValues(providerConfig),...urlSecrets]};
}

export function openCodePermissions(policy) {
  const bypass=policy?.mode==='bypass';
  const normalized=bypass?{mode:'auto',fileWrite:'allow',shellExecute:'allow',networkAccess:'allow'}:policy;
  const modelOnly=normalized && ['fileWrite','shellExecute','networkAccess'].every(k=>normalized[k]==='deny');
  return {policy:normalized,permission:{
    '*':'deny',
    ...(!modelOnly?{read:'allow',glob:'allow',grep:'allow',list:'allow',external_directory:'allow'}:{}),
    edit:normalized?.fileWrite??'ask',bash:normalized?.shellExecute??'ask',
    webfetch:normalized?.networkAccess??'ask',websearch:normalized?.networkAccess??'ask',
    // The host owns independent roles. Never recursively launch other Skills/Agents.
    task:'deny',skill:'deny',question:'deny',
  }};
}

export function openCodePrompt(prompt) {
  if (typeof prompt==='string') return {text:prompt,images:[]};
  if (!Array.isArray(prompt) || !prompt.length) throw Error('Invalid multimodal prompt');
  const texts=[],images=[];
  for (const block of prompt) {
    if (block.type==='text' && typeof block.text==='string') {texts.push(block.text);continue;}
    if (block.type!=='local_image' || typeof block.path!=='string') throw Error('Unsupported multimodal block');
    const bytes=readFileSync(block.path);
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
      bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
      bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
    if (!mime) throw Error('Unsupported screenshot image format');
    images.push({type:'file',mime,filename:block.path.split('/').at(-1),url:`data:${mime};base64,${bytes.toString('base64')}`});
  }
  return {text:texts.join('\n\n'),images};
}

// The acceptance runners consume final `text` snapshots. OpenCode may emit only deltas.
export async function* normalizeOpenCodeEvents(events, {readStructuredOutput}={}) {
  const state=new Map();
  for await (const event of events) {
    const key=event.sessionId;
    const current=state.get(key)??{text:'',snapshot:false};
    if (event.type==='tool_use') {current.text='';current.snapshot=false;}
    if (event.type==='text_delta') {current.text+=event.payload?.delta??'';current.snapshot=false;}
    if (event.type==='text') {current.text=event.payload?.content??'';current.snapshot=true;}
    if (event.type==='done' && event.payload?.status==='success') {
      if (readStructuredOutput) {
        const result=await readStructuredOutput(event.sessionId);
        yield {...event,type:'text',payload:{content:JSON.stringify(result),source:'opencode-structured'}};
      } else if (current.text && !current.snapshot)
        yield {...event,type:'text',payload:{content:current.text}};
    }
    state.set(key,current);
    yield event;
  }
}

export function openCodeStructuredResult(messages, submitted) {
  const final=messages.map(({info})=>info).filter(info=>info.role==='assistant' &&
    info.sessionID===submitted.sessionID && info.parentID===submitted.messageID)
    .sort((a,b)=>(a.time?.created??0)-(b.time?.created??0)).at(-1);
  if (!final?.time?.completed || final.error || !final.structured ||
      typeof final.structured.result!=='object' || final.structured.result===null ||
      Array.isArray(final.structured.result))
    throw Error('OpenCode did not submit a valid structured JSON result for this request');
  return final.structured.result;
}

export function openCodeOutputFormat(resultSchema={type:'object',additionalProperties:true}) {
  if (!resultSchema || resultSchema.type!=='object') throw Error('OpenCode JSON result schema must describe an object');
  return {type:'json_schema',retryCount:2,schema:{type:'object',
    properties:{result:resultSchema},required:['result'],additionalProperties:false}};
}

export async function createOpenCodeAdapter(state, metadata, prompt, options) {
  const {OpenCodeAdapter,wrapOpencodeClient}=await import('@sublang/cligent/adapters/opencode');
  const {createOpencodeClient}=await import('@opencode-ai/sdk/v2');
  const {text,images}=openCodePrompt(prompt);
  const {jsonOutput=false,jsonResultSchema,...runOptions}=options;
  const {policy,permission}=openCodePermissions(options.permissions);
  if (jsonOutput) permission.StructuredOutput='allow';
  let submitted;
  const nativeMessages=new Map();
  const config={
    model:metadata.model,small_model:metadata.model,enabled_providers:[metadata.service.provider],
    ...(state.providerConfig?{provider:{[metadata.service.provider]:state.providerConfig}}:{}),
    default_agent:'acceptance-runtime',
    agent:{'acceptance-runtime':{mode:'primary',permission,
      prompt:'Complete only the acceptance task supplied in this session. Preserve the requested JSON output and evidence boundaries. When the StructuredOutput result envelope is requested, put the complete task JSON object inside result; explanatory prose is not a result submission.'}},
    permission,share:'disabled',autoupdate:false,
  };
  const environment={...state.environment,OPENCODE_CONFIG_CONTENT:JSON.stringify(config)};
  const adapter=new OpenCodeAdapter({readyTimeoutMs:30000},{
    spawnProcess:(command,args,spawnOptions)=>spawn(command,args,{...spawnOptions,env:environment}),
    loadSdk:async()=>({createClient:({baseUrl})=>{
      const real=createOpencodeClient({baseUrl,...(environment.OPENCODE_SERVER_PASSWORD?{
        headers:{Authorization:'Basic '+Buffer.from(`${environment.OPENCODE_SERVER_USERNAME||'opencode'}:${environment.OPENCODE_SERVER_PASSWORD}`).toString('base64')}
      }:{})});
      // Keep native structured objects before cligent normalizes text/tool events.
      // Reading the legacy message-list endpoint can fail serializing json_schema
      // user messages in OpenCode 1.19.4; the live assistant event is authoritative.
      const subscribe=real.event.subscribe.bind(real.event);
      real.event.subscribe=async(...args)=>{
        const subscription=await subscribe(...args);
        return {...subscription,stream:(async function*(){
          for await(const event of subscription.stream) {
            if (event.type==='message.updated' && event.properties?.info?.role==='assistant') {
              const info=event.properties.info;
              nativeMessages.set(info.id,{info});
            }
            yield event;
          }
        })()};
      };
      // Keep the original text part intact for cligent causal event correlation.
      const dispatch=real.session.promptAsync.bind(real.session);
      real.session.promptAsync=(request,...rest)=>{
        const messageID=request.messageID??`msg_${Date.now().toString(16).padStart(12,'0')}${randomBytes(12).toString('hex')}`;
        submitted={sessionID:request.sessionID,messageID,directory:request.directory};
        return dispatch({...request,
          ...(jsonOutput?{messageID}:{}),
          ...(state.variant?{variant:state.variant}:{}),
          ...(jsonOutput?{format:openCodeOutputFormat(jsonResultSchema)}:{}),
          parts:[...(request.parts??[]),...images]},...rest);
      };
      return wrapOpencodeClient(real,{apiVersion:'v2'});
    }}),
  });
  const readStructuredOutput=jsonOutput?async(sessionID)=>{
    if (!submitted?.messageID || sessionID!==submitted.sessionID)
      throw Error('OpenCode structured result has no matching submitted request');
    return openCodeStructuredResult([...nativeMessages.values()],submitted);
  }:undefined;
  return {adapter,prompt:text,readStructuredOutput,options:{...runOptions,permissions:policy,
    // The configured native variant is injected above, including custom providers.
    effort:undefined}};
}
