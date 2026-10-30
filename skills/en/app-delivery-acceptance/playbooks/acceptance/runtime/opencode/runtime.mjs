// OpenCode owns config resolution, authentication and sessions; cligent owns event normalization.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
    config=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./config.mjs',import.meta.url))],{
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
