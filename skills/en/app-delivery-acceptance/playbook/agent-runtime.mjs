// One model/session boundary for every acceptance workflow. Never persist credentials.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolveOpenCodeRuntime,createOpenCodeAdapter,sensitiveValues,normalizeOpenCodeEvents} from './opencode-runtime.mjs';
const require=createRequire(import.meta.url);
const parseToml=text=>require('smol-toml').parse(text);

function objectFile(path, parser=JSON.parse) {
  if (!existsSync(path)) return {};
  try { return parser(readFileSync(path, 'utf8')); }
  catch { throw Error(`Cannot read Agent configuration: ${path}`); }
}
function serviceUrl(value) {
  if (!value) return null;
  try {
    const url=new URL(value);
    // Headers, URL credentials and query tokens never enter attempt metadata.
    return url.origin+url.pathname;
  } catch { throw Error('Invalid model service URL; its value was not logged'); }
}

function resolveRuntimeConfig({env=process.env, home=homedir(), cwd=process.cwd(), model, effort}={}) {
  const agent=env.ACCEPTANCE_AGENT;
  if (!['codex','claude-code','opencode'].includes(agent))
    throw Error('Set ACCEPTANCE_AGENT to the calling Agent: codex, claude-code or opencode. No Agent fallback is performed.');
  let inherited={}, selectedModel=model||env.ACCEPTANCE_MODEL, provider, baseUrl;
  let selectedEffort=effort||env.ACCEPTANCE_EFFORT;
  let modelSource=model?'stage override':env.ACCEPTANCE_MODEL?'caller':'agent configuration';
  let opencode;
  if (agent==='codex') {
    const config=objectFile(join(env.CODEX_HOME||join(home,'.codex'),'config.toml'),parseToml);
    const profileName=env.ACCEPTANCE_CODEX_PROFILE||config.profile;
    if (profileName&&!config.profiles?.[profileName]) throw Error('Selected Codex profile is absent');
    const profile=profileName?config.profiles[profileName]:{};
    const effective={...config,...profile};
    selectedModel||=effective.model;
    selectedEffort||=effective.model_reasoning_effort;
    provider=effective.model_provider||'openai';
    // cligent isolates CLI config for permissions. Explicitly carry only model-service settings.
    for (const key of ['model_provider','model_providers','preferred_auth_method'])
      if (effective[key]!==undefined) inherited[key]=effective[key];
    baseUrl=env.OPENAI_BASE_URL||effective.model_providers?.[provider]?.base_url;
  } else if (agent==='claude-code') {
    const settingsFiles=[join(env.CLAUDE_CONFIG_DIR||join(home,'.claude'),'settings.json'),
      join(cwd,'.claude/settings.json'),join(cwd,'.claude/settings.local.json')];
    const settingsEnv=Object.assign({},...settingsFiles.map(path=>objectFile(path).env||{}));
    // A Bash invocation already carries the active settings. Fill only missing provider variables.
    inherited=Object.fromEntries(Object.entries(settingsEnv).filter(([key,value])=>
      /^(ANTHROPIC_|AWS_|GOOGLE_|CLAUDE_CODE_USE_)/.test(key)&&typeof value==='string'&&env[key]===undefined));
    const effective={...inherited,...env};
    selectedModel||=effective.ANTHROPIC_MODEL;
    selectedEffort||=effective.CLAUDE_CODE_EFFORT_LEVEL;
    const enabled=value=>value==='1'||value==='true';
    provider=enabled(effective.CLAUDE_CODE_USE_BEDROCK)?'bedrock':enabled(effective.CLAUDE_CODE_USE_VERTEX)?'vertex':
      enabled(effective.CLAUDE_CODE_USE_FOUNDRY)?'foundry':'anthropic';
    baseUrl=effective.ANTHROPIC_BASE_URL;
  } else {
    opencode=resolveOpenCodeRuntime({env,cwd,model:selectedModel,effort:selectedEffort});
    provider=opencode.service.provider;baseUrl=opencode.service.base_url;
  }
  if (typeof selectedModel!=='string'||!selectedModel.trim())
    throw Error('Current model is unknown. The calling Agent must pass ACCEPTANCE_MODEL; no model is silently substituted.');
  const metadata={schema:'acceptance-agent-runtime-v1',agent,model:selectedModel,effort:selectedEffort||null,
    service:{provider,base_url:serviceUrl(baseUrl)},model_source:modelSource,
    ...(opencode?{opencode:opencode.binding}:{})};
  return {metadata,inherited,opencode};
}

export function resolveAgentRuntime(options) { return resolveRuntimeConfig(options).metadata; }

export function bindAgentRuntime(directory, metadata, {resume=false}={}) {
  const path=join(resolve(directory),'agent-runtime.json');
  if (existsSync(path)) {
    const old=objectFile(path);
    for (const key of ['agent','model','effort','service','sdk','implementation_sha256','opencode'])
      if (JSON.stringify(old[key])!==JSON.stringify(metadata[key]))
        throw Error('Agent/model/service differs from this attempt. Preserve it and start a new attempt; session IDs cannot cross Agents.');
    return old;
  }
  if (resume) throw Error('Historical attempt has no Agent runtime binding. Preserve its evidence and start a new attempt.');
  writeFileSync(path,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  return metadata;
}

// Claude SDK accepts message streams rather than Codex local_image blocks.
// Read pixels here so both adapters review the exact frozen evidence.
export function claudePrompt(prompt) {
  if (typeof prompt === 'string') return prompt;
  if (!Array.isArray(prompt) || !prompt.length) throw Error('Invalid multimodal prompt');
  const content=prompt.map(block=>{
    if (block.type==='text' && typeof block.text==='string') return {type:'text',text:block.text};
    if (block.type!=='local_image' || typeof block.path!=='string') throw Error('Unsupported multimodal block');
    const bytes=readFileSync(block.path);
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
      bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
      bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
    if(!mime)throw Error('Unsupported screenshot image format');
    return {type:'image',source:{type:'base64',media_type:mime,data:bytes.toString('base64')}};
  });
  return (async function*(){yield {type:'user',message:{role:'user',content},parent_tool_use_id:null};})();
}

export function createAgentRuntime({directory,resume=false,model,...resolution}={}) {
  const {metadata,inherited,opencode}=resolveRuntimeConfig({model,...resolution});
  const sdk={codex:'@openai/codex-sdk','claude-code':'@anthropic-ai/claude-agent-sdk',opencode:'@opencode-ai/sdk'}[metadata.agent];
  const sdkPackage=objectFile(fileURLToPath(new URL(`./node_modules/${sdk}/package.json`,import.meta.url)));
  if (!sdkPackage.version) throw Error('Selected Agent SDK is missing; run scripts/ensure_runtime.py');
  metadata.sdk={package:sdk,version:sdkPackage.version};
  const implementation=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url)));
  if (opencode) for (const path of ['./opencode-runtime.mjs','./opencode-config.mjs'])
    implementation.update(readFileSync(new URL(path,import.meta.url)));
  metadata.implementation_sha256=implementation.digest('hex');
  if (directory) bindAgentRuntime(directory,metadata,{resume});
  return {
    metadata,
    async *run(prompt, options={}) {
      if (options.model&&options.model!==metadata.model) throw Error('Model differs from bound Agent runtime');
      let adapter,readStructuredOutput;
      const jsonOutput=options.jsonOutput;
      const jsonResultSchema=options.jsonResultSchema;
      delete (options={...options}).jsonOutput;
      delete options.jsonResultSchema;
      if (options.effort&&options.effort!==metadata.effort) throw Error('Effort differs from bound Agent runtime');
      if (metadata.agent==='codex') {
        const {CodexAdapter}=await import('@sublang/cligent/adapters/codex');
        const {Codex}=await import('@openai/codex-sdk');
        adapter=new CodexAdapter({loadSdk:async()=>({Codex:class extends Codex {
          constructor(options) {
            super({...options,
              ...(process.env.OPENAI_BASE_URL?{baseUrl:process.env.OPENAI_BASE_URL}:{}),
              ...(metadata.service.provider==='openai'&&(process.env.CODEX_API_KEY||process.env.OPENAI_API_KEY)
                ?{apiKey:process.env.CODEX_API_KEY||process.env.OPENAI_API_KEY}:{}),
              config:{...inherited,...options?.config}});
          }
        }})});
      } else if (metadata.agent==='claude-code') {
        const {ClaudeCodeAdapter}=await import('@sublang/cligent/adapters/claude-code');
        const {query}=await import('@anthropic-ai/claude-agent-sdk');
        adapter=new ClaudeCodeAdapter({loadSdk:async()=>({query:({prompt,options})=>
          query({prompt:claudePrompt(prompt),options:{...options,env:{...inherited,...options.env},
            settingSources:[],strictMcpConfig:true,mcpServers:{},
            disallowedTools:[...new Set([...(options.disallowedTools??[]),'Agent','Skill'])]}})})});
      } else {
        const mapped=await createOpenCodeAdapter(opencode,metadata,prompt,{...options,jsonOutput,jsonResultSchema});
        adapter=mapped.adapter;prompt=mapped.prompt;options=mapped.options;
        readStructuredOutput=mapped.readStructuredOutput;
      }
      // Model-only stages receive no file/tool access in Claude as well as no write/shell/network.
      const policy=options.permissions;
      if (metadata.agent==='claude-code'&&policy&&
          ['fileWrite','shellExecute','networkAccess'].every(key=>policy[key]==='deny'))
        options={...options,allowedTools:[]};
      else if (metadata.agent==='claude-code'&&policy?.fileWrite==='deny')
        options={...options,allowedTools:['Read','Glob','Grep']};
      // A fresh adapter invocation starts a fresh session unless this stage explicitly resumes its own.
      const secrets=Object.entries({...process.env,...inherited})
        .filter(([key,value])=>/(TOKEN|KEY|PASSWORD|SECRET|AUTH)/i.test(key)&&typeof value==='string'&&value.length>8)
        .map(([,value])=>value);
      secrets.push(...(opencode?.secrets??[]),...sensitiveValues(opencode?.environment));
      for (const provider of Object.values(inherited.model_providers??{}))
        for (const value of Object.values(provider.http_headers??{}))
          if (typeof value==='string'&&value.length>8) secrets.push(value,value.replace(/^Bearer /i,''));
      const redact=value=>secrets.reduce((text,secret)=>text.replaceAll(secret,'[REDACTED]'),value);
      try {
        const events=adapter.run(prompt,{...options,model:metadata.model,effort:opencode?undefined:metadata.effort??undefined});
        for await (const event of opencode?normalizeOpenCodeEvents(events,{readStructuredOutput}):events)
          yield JSON.parse(redact(JSON.stringify(event)));
      } catch (error) { throw Error(redact(error.message)); }
    },
  };
}
