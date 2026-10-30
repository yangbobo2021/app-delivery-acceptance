// One model/session boundary for every acceptance workflow. Never persist credentials.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolveOpenCodeRuntime} from './opencode/runtime.mjs';
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

export function resolveRuntimeConfig({env=process.env, home=homedir(), cwd=process.cwd(), model, effort}={}) {
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
    for (const key of ['agent','model','effort','service','sdk','implementation_sha256','opencode','transport','role','role_binding_sha256'])
      if (JSON.stringify(old[key])!==JSON.stringify(metadata[key]))
        throw Error('Agent/model/service differs from this attempt. Preserve it and start a new attempt; session IDs cannot cross Agents.');
    return old;
  }
  if (resume) throw Error('Historical attempt has no Agent runtime binding. Preserve its evidence and start a new attempt.');
  writeFileSync(path,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
  return metadata;
}
