import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {object} from '../shared/definitions.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw Error('source input quality: '+message);};
function relative(root,value){
  if(typeof value!=='string'||!value.trim())fail('document path required');
  const absolute=path.resolve(root,value),name=path.relative(root,absolute);
  if(!name||name==='..'||name.startsWith('..'+path.sep)||path.isAbsolute(name))fail('document outside project: '+value);
  return name.split(path.sep).join('/');
}
function file(root,name){
  const target=path.join(root,name),actual=fs.realpathSync(target);
  relative(fs.realpathSync(root),actual);
  if(!fs.statSync(actual).isFile())fail('source is not a file: '+name);
  return fs.readFileSync(target);
}
// Resolve declared locations, never infer requirements from a project-specific SPEC grammar.
function location(root,origin){
  if(origin.file!==undefined){
    const value=origin.file;
    if(!object(value)||!Number.isSafeInteger(value.start_line)||value.start_line<1||!Number.isSafeInteger(value.end_line)||value.end_line<value.start_line)fail('origin.file needs path and a valid inclusive line range');
    return {path:relative(root,value.path),start:value.start_line,end:value.end_line};
  }
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(origin.reference??''))return null;
  const match=/^(.+?):([1-9]\d*)(?:-([1-9]\d*))?(?=@|\s|$)/.exec(origin.reference??'');
  if(!match)return null;
  const name=relative(root,match[1]);
  return {path:name,start:Number(match[2]),end:Number(match[3]??match[2])};
}

export function freezeSourceInputs(request,candidate,root,previous){
  const supplied=request.definitions.context??{};
  const inherit=request.mode!=='replace'||Object.hasOwn(supplied,'source_documents');
  const prior=inherit?previous?.context.source_documents??[]:[];
  if(!Array.isArray(prior))fail('context.source_documents must be an array');
  for(const key of ['source_documents','required_source_documents'])if(Object.hasOwn(supplied,key)&&!equal(supplied[key],previous?.context[key]))fail('use source_inputs to supply verified '+key);
  if(prior.length)candidate.context.required_source_documents??=prior.map(document=>document.path);
  const sources=new Map(prior.map(document=>[document.path,document]));
  const input=request.source_inputs;
  if(input!==undefined){
    if(!object(input)||!Array.isArray(input.required_documents)||!Array.isArray(input.documents))fail('source_inputs needs required_documents and documents arrays');
    const required=input.required_documents.map(name=>relative(root,name));
    if(new Set(required).size!==required.length)fail('duplicate required document');
    const received=new Set();
    for(const document of input.documents){
      if(!object(document))fail('document snapshot object required');
      const name=relative(root,document.path);
      if(received.has(name))fail('duplicate snapshot: '+name);
      received.add(name);
      if(typeof document.text!=='string'||!/^[a-f0-9]{64}$/.test(document.sha256??''))fail('complete text and SHA-256 required: '+name);
      const bytes=file(root,name);
      if(hash(bytes)!==document.sha256||!bytes.equals(Buffer.from(document.text,'utf8')))fail('snapshot text/hash differs from actual file: '+name);
      sources.set(name,{path:name,sha256:document.sha256,text:document.text,...(document.purpose?{purpose:document.purpose}:{})});
    }
    for(const name of required)if(!received.has(name))fail('missing required document snapshot: '+name);
    for(const name of received)if(!required.includes(name))fail('snapshot absent from required_documents inventory: '+name);
    candidate.context.required_source_documents=[...new Set([...(candidate.context.required_source_documents??[]),...required])];
  }
  // The host declares the conversation's required background; the workflow verifies and freezes it.
  // This cannot discover a document the host omitted from both the declaration and the request.
  for(const name of candidate.context.required_source_documents??[]){
    const document=sources.get(name);
    if(!document)fail('missing frozen background: '+name);
    if(hash(Buffer.from(document.text??'','utf8'))!==document.sha256)fail('invalid frozen background hash: '+name);
  }
  for(const group of ['requirements','reverse_rules','scenarios'])for(const item of request.definitions[group]??[]){
    const origin=item.origin??{},loc=location(root,origin);
    if(!loc)continue;
    const document=sources.get(loc.path);
    if(!document)fail('file origin requires a complete source_inputs snapshot: '+item.id+' '+loc.path);
    const bytes=file(root,loc.path);
    if(hash(bytes)!==document.sha256||!bytes.equals(Buffer.from(document.text,'utf8')))fail('frozen source differs from current file: '+loc.path);
    const lines=document.text.split('\n');
    if(loc.end<loc.start||loc.end>lines.length)fail('source line range outside document: '+item.id);
    const quote=item[group==='scenarios'?'description':'text'];
    if(typeof quote!=='string'||!quote.trim()||!lines.slice(loc.start-1,loc.end).join('\n').includes(quote))fail('source line range does not contain original text: '+item.id+' '+loc.path+':'+loc.start+'-'+loc.end);
    const declaredHash=/\bsha256:([a-f0-9]{64})\b/.exec(origin.reference??'')?.[1];
    if(declaredHash&&declaredHash!==document.sha256)fail('origin reference hash mismatch: '+item.id);
    if(origin.file){
      const human=/^(.+?):([1-9]\d*)(?:-([1-9]\d*))?(?=@|\s|$)/.exec(origin.reference??'');
      if(human&&(relative(root,human[1])!==loc.path||Number(human[2])!==loc.start||Number(human[3]??human[2])!==loc.end))fail('origin.file conflicts with human reference: '+item.id);
    }
  }
  if(sources.size)candidate.context.source_documents=[...sources.values()];
  return candidate;
}
