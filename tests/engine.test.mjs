import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discovery,readProgress,saveProgress,toggleVisited,isDrag,upPath,earthPath,searchNodes,rotateDrag,STORAGE_KEY,resolveSpaceTarget,wheelStep,advanceZoomSpring} from '../dist/engine.js';
test('discovery counts only included immediate children and ignores parent selection',()=>{
  const nodes=new Map([['province',{}],['territory',{}],['city',{}]]),p={id:'country',children:['province','territory','missing']};
  const visited=new Set(['country','province','city']);assert.deepEqual(discovery(p,nodes,visited),{visited:1,total:2,percentage:50});
  toggleVisited(visited,'territory');assert.equal(discovery(p,nodes,visited).percentage,100);assert.ok(visited.has('city'));
});
test('empty coverage has a truthful zero denominator',()=>assert.deepEqual(discovery({children:[]},new Map(),new Set()),{visited:0,total:0,percentage:0}));
test('selection is independent at every level and toggles in both directions',()=>{const visited=new Set();toggleVisited(visited,'province');assert.ok(!visited.has('city'));assert.equal(toggleVisited(visited,'city'),true);assert.equal(toggleVisited(visited,'province'),false);assert.ok(visited.has('city'));});
test('browser profile storage persists and restores stable IDs independently',()=>{const a=new Map(),b=new Map();const storage=map=>({getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)});assert.equal(saveProgress(storage(a),new Set(['country:CHN','division:CHN:11'])),true);assert.deepEqual([...readProgress(storage(a)).visited],['country:CHN','division:CHN:11']);assert.equal(readProgress(storage(b)).visited.size,0);assert.equal(JSON.parse(a.get(STORAGE_KEY)).version,1);});
test('blocked or damaged browser storage is reported without breaking exploration',()=>{assert.equal(saveProgress({setItem(){throw Error();}},new Set()),false);assert.equal(readProgress({getItem(){return 'bad JSON';}}).available,false);});
test('right click goes up exactly one level and Escape has a direct Earth route',()=>{assert.deepEqual(upPath(['earth','continent:Asia','country:CHN','division:Beijing']),['earth','continent:Asia','country:CHN']);assert.deepEqual(upPath(['earth']),['earth']);assert.deepEqual(earthPath(),['earth']);});
test('drag threshold separates activation from rotation and rotation never snaps or clamps',()=>{assert.equal(isDrag([0,0],[2,2]),false);assert.equal(isDrag([0,0],[7,0]),true);const end=rotateDrag([10,20,0],[50,500]);assert.deepEqual(end,[24,-120,0]);assert.deepEqual(rotateDrag(end,[0,0]),end);});
test('native and English names can both be searched',()=>{const nodes=[{name:'Germany',native:'Deutschland',kind:'Country'},{name:'China',native:'中国'}];assert.equal(searchNodes(nodes,'中国')[0].name,'China');assert.equal(searchNodes(nodes,'deutsch')[0].name,'Germany');});
test('Space gives pointer hover priority and never falls back to a selected parent or stale mouse focus',()=>{
  assert.equal(resolveSpaceTarget({hover:'province',focused:'country',target:'country',modality:'keyboard'}),'province');
  assert.equal(resolveSpaceTarget({hover:null,focused:'country',target:'country',modality:'pointer'}),null);
  assert.equal(resolveSpaceTarget({hover:null,focused:'province',modality:'keyboard'}),'province');
  assert.equal(resolveSpaceTarget({hover:null,focused:null,modality:'keyboard'}),null);
});
test('a wheel gesture ascends one level, ignores momentum, and permits the next deliberate gesture',()=>{
  let result=wheelStep({zoom:1,deltaY:1000,depth:4,locked:false,lastEvent:0,now:1000,minZoom:.25});assert.equal(result.ascend,true);
  for(const now of [1010,1050,1110]){result=wheelStep({zoom:result.zoom,deltaY:1000,depth:3,locked:result.locked,lastEvent:result.lastEvent,now,minZoom:.25});assert.equal(result.ascend,false);}
  assert.equal(wheelStep({zoom:result.zoom,deltaY:1000,depth:3,locked:result.locked,lastEvent:result.lastEvent,now:1800,minZoom:.25}).ascend,true);
  assert.equal(wheelStep({zoom:1,deltaY:100000,depth:1,locked:false,lastEvent:0,now:1000,minZoom:.3}).zoom,.3);
  assert.ok(wheelStep({zoom:20,deltaY:-100,depth:1,locked:false,lastEvent:0,now:1000,minZoom:.3}).zoom>20);
});
test('repeated wheel targets blend through a continuous spring with velocity preserved and no queued reversal',()=>{
  let spring={value:0,target:1,velocity:0};
  for(let i=0;i<8;i++)spring={...spring,...advanceZoomSpring(spring,1/120)};
  const oldVelocity=spring.velocity;assert.ok(oldVelocity>0);
  spring.target=2;spring={...spring,...advanceZoomSpring(spring,1/120)};assert.ok(spring.velocity>oldVelocity);
  const current=spring.value;spring.target=-1;spring={...spring,...advanceZoomSpring(spring,1/120)};assert.ok(Math.abs(spring.value-current)<.1);
  for(let i=0;i<15;i++)spring={...spring,...advanceZoomSpring(spring,1/120)};
  assert.ok(spring.velocity<0,'Reversal responds without waiting for the previous target');
  for(let i=0;i<240;i++)spring={...spring,...advanceZoomSpring(spring,1/120)};
  assert.equal(spring.value,-1);assert.equal(spring.velocity,0);assert.equal(spring.settled,true);
});
