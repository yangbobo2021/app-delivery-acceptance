// Preserve numeric lexical types while reading historical Python JSON. In JSON,
// 1 and 1.0 are different inputs to that historical hash protocol, even though
// JavaScript represents both as one Number. The metadata never enters output.
const numbers=new WeakMap();
export function parseJson(raw){
  return JSON.parse(raw,function(key,value,context){
    if(typeof value==='number'&&context?.source){
      let fields=numbers.get(this);if(!fields){fields=new Map();numbers.set(this,fields);}
      fields.set(key,{value,source:context.source});
    }
    return value;
  });
}
export function copyNumbers(from,to){
  const fields=numbers.get(from),merged=new Map(numbers.get(to)??[]);
  for(const key of Object.keys(from))if(Object.hasOwn(to,key)&&Object.is(from[key],to[key])){
    merged.delete(key);const item=fields?.get(key);if(item&&Object.is(item.value,to[key]))merged.set(key,item);
  }
  if(merged.size)numbers.set(to,merged);else numbers.delete(to);
  return to;
}
export function cloneJson(value){
  if(value===null||typeof value!=='object')return value;
  const result=Array.isArray(value)?value.map(cloneJson):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cloneJson(v)]));
  return copyNumbers(value,result);
}
const unicodeOrder=(a,b)=>{
  const left=[...a],right=[...b];for(let i=0;i<Math.min(left.length,right.length);i++){const difference=left[i].codePointAt(0)-right[i].codePointAt(0);if(difference)return difference;}return left.length-right.length;
};
function number(value,source){
  if(!Number.isFinite(value))throw Error('Non-finite frozen number');
  if(source&&!/[.eE]/.test(source))return source; // Exact historical integer, including integers beyond JS precision.
  const serialized=JSON.stringify(value),floating=source?/[.eE]/.test(source):/[.eE]/.test(serialized);
  if(!floating)return serialized;
  const abs=Math.abs(value);
  if(abs!==0&&(abs<1e-4||abs>=1e16)){
    const [mantissa,exponent]=value.toExponential().split('e'),integer=Number(exponent);
    return mantissa+'e'+(integer<0?'-':'+')+String(Math.abs(integer)).padStart(2,'0');
  }
  if(Object.is(value,-0))return '-0.0';
  return serialized.includes('.')?serialized:serialized+'.0';
}
export function canonical(value,parent,key){
  if(typeof value==='number'){
    const item=parent&&numbers.get(parent)?.get(String(key));
    return number(value,item&&Object.is(item.value,value)?item.source:undefined);
  }
  if(Array.isArray(value))return '['+value.map((item,i)=>canonical(item,value,i)).join(', ')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort(unicodeOrder).map(k=>JSON.stringify(k)+': '+canonical(value[k],value,k)).join(', ')+'}';
  if(value===undefined)throw Error('Undefined frozen identity value');
  return JSON.stringify(value);
}
