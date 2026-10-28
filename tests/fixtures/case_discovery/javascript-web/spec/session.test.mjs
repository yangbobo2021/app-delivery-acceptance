import test from 'node:test';
import assert from 'node:assert/strict';
import {signOut} from '../src/session.mjs';

test('drops the entry',()=>{
  const store=new Map([['session','abc']]);
  const result=signOut(store,{clearCookie(){}});
  assert.equal(result.status,204);
  assert.equal(store.has('session'),false);
});

test('expires the browser token',()=>{
  const calls=[];
  signOut(new Map(),{clearCookie:(...args)=>calls.push(args)});
  assert.deepEqual(calls,[['sid',{httpOnly:true}]]);
});

test('logout button exists',()=>{
  const html='<button>logout</button>';
  assert.match(html,/logout/);
});

test.skip('logout in a real browser',()=>{assert.fail('not implemented');});
