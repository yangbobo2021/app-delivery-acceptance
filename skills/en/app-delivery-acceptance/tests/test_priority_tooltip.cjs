const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Trace=require('../assets/ledger-viewer/traceability.js');
function harness(){
 let document;
 class Node{
  constructor(tag,value=''){this.tag=tag;this.value=value;this.children=[];this.dataset={};this.attributes={};this.style={};this.events={};}
  append(...children){for(const c of children){this.children.push(c);c.parent=this;}}
  setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,f){this.events[k]=f;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  closest(tag){for(let n=this;n;n=n.parent)if(n.tag===tag)return n;return null;}
  getBoundingClientRect(){return this.tag==='span'?{left:470,top:560,bottom:580,width:30,height:20}:{width:440,height:110};}
  focus(){document.activeElement=this;this.events.focus?.();}
 }
 const walk=n=>[n,...n.children.flatMap(walk)];
 document={body:new Node('body'),createElement:t=>new Node(t),createTextNode:v=>new Node('#text',v),querySelectorAll:()=>walk(document.body).filter(n=>n.dataset.priorityKey)};
 const window={innerWidth:500,innerHeight:650,addEventListener(){},removeEventListener(){}};
 const context=vm.createContext({Node,document,window,AcceptanceTrace:Trace});
 const src=fs.readFileSync(path.resolve(__dirname,'../assets/ledger-viewer/viewer.js'),'utf8');
 vm.runInContext(src.slice(0,src.indexOf('let loadingLedger = false;')),context);
 return {document,context,run:code=>vm.runInContext(code,context)};
}
test('hover/focus tooltips show real reasons, stay in viewport and close with leave or Escape',()=>{
 const h=harness();h.run('state.data={};var n=priorityBadge({id:"A",priority:"P0",priority_reason:"失效会误删他人预订"});document.body.append(n);n.events.mouseenter();');
 let tip=h.document.body.children.find(n=>n.attributes.role==='tooltip');assert.ok(tip);assert.equal(tip.children[1].children[0].value,'失效会误删他人预订');assert.equal(tip.style.left,'48px');assert.equal(tip.style.top,'442px');
 h.run('n.events.mouseleave()');assert.ok(!h.document.body.children.some(n=>n.attributes.role==='tooltip'));
 h.run('n.focus()');assert.equal(h.run('n.attributes["aria-describedby"]'),'priority-tooltip');
 h.run('n.events.keydown({key:"Escape",stopPropagation(){}})');assert.equal(h.run('n.attributes["aria-describedby"]'),undefined);
});
test('tooltip portals inside an open dialog and refresh restores the matching badge and updated reason',()=>{
 const h=harness();h.run('state.data={};var dlg=el("dialog");document.body.append(dlg);var n=priorityBadge({id:"A",priority:"P1",priority_reason:"原原因"});dlg.append(n);n.focus();');
 assert.ok(h.run('priorityTip.tip.parent===dlg'));
 h.run('var saved=capturePriorityTooltip();hidePriorityTooltip();n.remove();n=priorityBadge({id:"A",priority:"P1",priority_reason:"最新原因"});dlg.append(n);restorePriorityTooltip(saved);');
 assert.equal(h.run('priorityTip.tip.children[1].children[0].value'),'最新原因');assert.equal(h.run('document.activeElement===n'),true);assert.equal(h.run('priorityTip.tip.parent===dlg'),true);
 h.run('hidePriorityTooltip();n.remove();restorePriorityTooltip(saved);');assert.equal(h.run('priorityTip'),null);
});
