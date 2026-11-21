import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseChips} from '../static/search-chip-selection.js';

test('rotation shows every valid idea before repeating, while keeping each set diverse',()=>{
  const entries=Array.from({length:37},(_,i)=>({query:'idea '+i,group:'subject '+i%9,valid_until:1000}));
  const seen=new Set(),observed=new Set();let previous=[],seed=123;
  const random=()=>((seed=seed*16807%2147483647)-1)/2147483646;
  for(let draw=0;observed.size<entries.length;draw++){
    assert.ok(draw<20,'Does not get stuck at the end of a cycle');
    const selected=chooseChips(entries,{previous,seen,random,now:100});assert.ok(selected.length);
    assert.equal(new Set(selected.map(i=>entries[i].group)).size,selected.length);
    for(const i of selected){assert.ok(!observed.has(entries[i].query),'No repeats before exhaustion');observed.add(entries[i].query);}
    previous=selected;
  }
  const next=chooseChips(entries,{previous,seen,random,now:100});
  assert.ok(next.length);assert.ok(next.every(i=>!previous.includes(i)),'No immediate repeats at cycle boundary');
});
test('saved history survives catalogue reordering; newly added ideas come before repeats',()=>{
  const entries=[{query:'a',group:'a'},{query:'b',group:'b'},{query:'c',group:'c'}],seen=new Set(['a','b','c']);
  const updated=[entries[2],{query:'fresh',group:'new'},entries[0],{query:'expired',group:'old',valid_until:1}];
  assert.deepEqual(chooseChips(updated,{seen,now:10}).map(i=>updated[i].query),['fresh']);
  assert.ok(!seen.has('expired'));
});
