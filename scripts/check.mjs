import {readFile,readdir,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const world=JSON.parse(await readFile('dist/data/world.json','utf8'));
const nodes=new Map([...world.continents,...world.countries].map(n=>[n.id,n]));
const counts={countries:world.countries.length,continents:world.continents.length,divisions:0,locals:0,places:0};
assert.equal(world.continents.length,7);assert.ok(world.countries.length>=240);
for(const country of world.countries){
  const file=JSON.parse(await readFile(`dist/data/regions/${country.code}.json`,'utf8'));
  for(const kind of ['divisions','locals','places'])for(const n of file[kind]||[]){assert.ok(!nodes.has(n.id),`Duplicate ${n.id}`);nodes.set(n.id,n);counts[kind]++;}
}
let unknown=0;for(const node of nodes.values()){
  assert.ok(node.id&&node.name,`Missing identity ${node.id}`);
  for(const id of node.children||[]){assert.ok(nodes.has(id),`Missing child ${id} of ${node.id}`);const child=nodes.get(id);if(child.parent)assert.equal(child.parent,node.id,`Parent mismatch ${id}`);}
  if(node.parent&&node.parent!=='earth')assert.ok(nodes.has(node.parent),`Unknown parent ${node.parent}`);
  if(node.geometry){assert.ok(['Polygon','MultiPolygon','GeometryCollection'].includes(node.geometry.type),`Unexpected geometry ${node.id}`);}
  else if(!node.id.startsWith('continent:'))assert.ok(Number.isFinite(node.lng)&&Number.isFinite(node.lat),`No location ${node.id}`);
  if(node.nativeAvailable===false)unknown++;
}
for(const [code,count] of [['CAN',13],['USA',51],['DEU',16],['CHN',34],['GBR',4]])assert.equal(world.countries.find(c=>c.code===code)?.children.length,count,`${code} primary divisions`);
assert.ok(!world.countries.some(n=>['HKG','MAC','TWN'].includes(n.code)),'Regrouped map units must not be duplicated');
const china=nodes.get('country:CHN');
assert.equal(china.children.filter(id=>nodes.get(id).kind==='Province').length,23);
assert.equal(china.children.filter(id=>nodes.get(id).kind==='Autonomous Region').length,5);
assert.equal(china.children.filter(id=>nodes.get(id).kind==='Municipality').length,4);
for(const code of ['HKG','MAC','TWN']){const node=nodes.get(`division:CHN:${code}`);assert.ok(node?.geometry);assert.equal(node.parent,'country:CHN');assert.equal(world.progressAliases[`country:${code}`],node.id);}
assert.ok(counts.places>100000,'Expected broad GeoNames settlement coverage');
assert.ok((await stat('dist/vendor/d3.min.js')).size>10000);
for(const file of ['index.html','styles.css','app.js','engine.js','DATA_SOURCES.md'])assert.ok((await stat(path.join('dist',file))).size>0);
console.log(JSON.stringify({status:'PASS',...counts,nodes:nodes.size,nativeFallbacks:unknown}));
