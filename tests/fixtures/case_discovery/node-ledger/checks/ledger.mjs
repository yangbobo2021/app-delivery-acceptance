import test from 'node:test';
import assert from 'node:assert/strict';
import {Ledger} from '../ledger.mjs';
test('withdraw enough balance returns and stores the reduced balance',()=>{
  const account=new Ledger(10);
  assert.equal(account.withdraw(4),6);
  assert.equal(account.balance,6);
});
test('insufficient balance rejects and keeps the original balance',()=>{
  const account=new Ledger(3);
  assert.throws(()=>account.withdraw(4),/insufficient/);
  assert.equal(account.balance,3);
});
