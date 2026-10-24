import {ROOT_ID, discovery, readProgress, saveProgress, toggleVisited, isDrag, upPath, earthPath, searchNodes, rotateDrag,resolveSpaceTarget,wheelStep,advanceZoomSpring} from './engine.js';
import {renderSnapshot,pngBlob} from './snapshot.js';
import {createMotionMap} from './motion-map.js';

const $ = id => document.getElementById(id);
const canvas = $('map'), context = canvas.getContext('2d');
const state = {nodes:new Map(),path:[ROOT_ID],mode:'globe',rotation:[-18,-18,0],zoom:1,pan:[0,0],hover:null,focused:null,modality:'pointer',filter:'all',query:'',countries:[],loading:false,ready:false,revision:0,page:1,drawnPoints:[]};
let progress;
try { progress=readProgress(localStorage); } catch { progress={visited:new Set(),available:false}; }
state.visited=progress.visited;
let projection, flatBase=null,globeBase=null, frame=0, width=1, height=1, pointer=null, toastTimer, lastRows=[], loadTicket=0,cameraMotion=null,motionOverlay=null;
let measuredFrames=[],lastMeasuredFrame=0,zoomSpring=null;
let pointerClient=null;
let motionMap=null,motionMapTried=false;
function resetFrameMeasurement(){measuredFrames=[];lastMeasuredFrame=0;}
function recordFrame(start){
  canvas.dataset.renderMs=(performance.now()-start).toFixed(1);
  if(measuredFrames.length){const f=measuredFrames.slice(-120).sort((a,b)=>a-b);canvas.dataset.frameStats=JSON.stringify({frames:f.length,meanMs:+(f.reduce((a,b)=>a+b,0)/f.length).toFixed(1),p95Ms:+f[Math.min(f.length-1,Math.floor(f.length*.95))].toFixed(1)});}
}
const regionLoads = new Map();
const continentCenters={Asia:[92,34],Europe:[18,51],Africa:[20,3],'North America':[-105,42],'South America':[-61,-19],Oceania:[144,-22],Antarctica:[0,-85]};
const continentShort={Asia:'AS',Europe:'EU',Africa:'AF','North America':'NA','South America':'SA',Oceania:'OC',Antarctica:'AN'};
const parent=()=>state.nodes.get(state.path.at(-1));
const asFeature=node=>({type:'Feature',geometry:node.geometry,properties:{},id:node.id});
const children=()=> (parent()?.children || []).map(id=>state.nodes.get(id)).filter(Boolean);
const hasChildren=node=>Boolean(node?.children?.length);
const niceKind=node=>node?.kind || 'Region';
const isCountry=node=>node?.id?.startsWith('country:');
const isContinent=node=>node?.id?.startsWith('continent:');
const isRoot=node=>node?.id===ROOT_ID;
const currentCountry=()=>state.path.map(id=>state.nodes.get(id)).find(isCountry);
const effectiveHover=()=>state.hover || (state.modality==='keyboard'?state.focused:null);
const activeNode=()=>state.nodes.get(effectiveHover());
const visitedCountryCodes=new Set();
try{for(const code of JSON.parse(localStorage.getItem('worldwide.highlight-countries.v1')||'[]'))if(typeof code==='string')visitedCountryCodes.add(['HKG','MAC','TWN'].includes(code)?'CHN':code);}catch{}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const coarseCache=new WeakMap();
function renderFeature(node,force=false){
  if(!force&&!(pointer?.dragging||previewPointer||cameraMotion||zoomSpring))return asFeature(node);
  let geometry=coarseCache.get(node.geometry);
  if(!geometry){
    const ring=coords=>{if(coords.length<100)return coords;const step=Math.max(1,Math.floor(coords.length/100)),out=coords.filter((_,i)=>i%step===0);if(out.at(-1)!==coords.at(-1))out.push(coords.at(-1));return out;};
    geometry={...node.geometry,coordinates:node.geometry.type==='Polygon'?node.geometry.coordinates.map(ring):node.geometry.type==='MultiPolygon'?node.geometry.coordinates.map(poly=>poly.map(ring)):node.geometry.coordinates};coarseCache.set(node.geometry,geometry);
  }
  return {type:'Feature',geometry,properties:{}};
}
function cameraSnapshot(){return projection?{mode:state.mode,blend:projection.atlasBlend??(state.mode==='flat'?1:0),rotate:projection.rotate(),scale:projection.scale(),translate:projection.translate()}:null;}
function startCameraMotion(from,instant=false){
  zoomSpring=null;
  if(!from||reducedMotion.matches){cameraMotion=null;motionOverlay?.remove();motionOverlay=null;invalidate();return;}
  cameraMotion={from,started:performance.now(),duration:360};
  resetFrameMeasurement();
  invalidate();
}
function blendedProjection(blend){
  const raw=(lambda,phi)=>{const a=d3.geoOrthographicRaw(lambda,phi),b=d3.geoMercatorRaw(lambda,Math.max(-1.569,Math.min(1.569,phi)));return[a[0]*(1-blend)+b[0]*blend,a[1]*(1-blend)+b[1]*blend];};
  raw.invert=(x,y)=>{let lambda=Math.max(-Math.PI,Math.min(Math.PI,x)),phi=Math.max(-1.5,Math.min(1.5,y));for(let i=0;i<15;i++){const p=raw(lambda,phi),dx=p[0]-x,dy=p[1]-y;if(Math.abs(dx)+Math.abs(dy)<1e-7)break;const h=1e-5,a=raw(lambda+h,phi),b=raw(lambda,phi+h),aa=(a[0]-p[0])/h,ab=(b[0]-p[0])/h,ba=(a[1]-p[1])/h,bb=(b[1]-p[1])/h,det=aa*bb-ab*ba;if(Math.abs(det)<1e-9)break;lambda-=(dx*bb-dy*ab)/det;phi-=(dy*aa-dx*ba)/det;phi=Math.max(-1.569,Math.min(1.569,phi));}return[lambda,phi];};
  return d3.geoProjection(raw).clipAngle(90+89.99*blend).clipExtent([[0,0],[width,height]]).precision(.9);
}
function applyCameraMotion(){
  if(!cameraMotion)return;
  const t=Math.min(1,(performance.now()-cameraMotion.started)/cameraMotion.duration),e=1-(1-t)**3,from=cameraMotion.from;
  const to={rotate:projection.rotate(),scale:projection.scale(),translate:projection.translate()},targetBlend=state.mode==='flat'?1:0;
  const angles=to.rotate.map((target,i)=>from.rotate[i]+(((target-from.rotate[i]+540)%360)-180)*e);
  const blend=from.blend+(targetBlend-from.blend)*e;
  if(Math.abs(from.blend-targetBlend)>.001){projection=blendedProjection(blend);projection.atlasBlend=blend;}
  projection.rotate(angles).scale(from.scale*(to.scale/from.scale)**e).translate(to.translate.map((v,i)=>from.translate[i]+(v-from.translate[i])*e));
  if(t<1)invalidate();else{cameraMotion=null;motionOverlay?.remove();motionOverlay=null;invalidate();}
}
function stopCameraMotion(){
  if(zoomSpring){state.zoom=Math.exp(zoomSpring.value);zoomSpring=null;}
  if(!cameraMotion)return;
  if(projection){if(state.mode==='globe'){state.rotation=projection.rotate();state.zoom=projection.scale()/baseGlobeScale();const c=[width*.5,height*.49];state.pan=projection.translate().map((v,i)=>v-c[i]);}else if(flatBase){state.zoom=projection.scale()/flatBase.scale;state.pan=projection.translate().map((v,i)=>v-flatBase.translate[i]);}}
  cameraMotion=null;motionOverlay?.remove();motionOverlay=null;
}

function notify(message) {
  clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,2900);
}
function storageStatus(ok) {
  $('storage-label').textContent=ok?'Progress saved in this browser':'Storage unavailable · export to keep progress';
  if(!ok)$('storage-label').style.color='#986132';
}
storageStatus(progress.available);

function mark(id) {
  if(!id || id===ROOT_ID)return notify('Focus or point to a region, then press Space.');
  const node=state.nodes.get(id);if(!node)return;
  const selected=toggleVisited(state.visited,id);
  let ancestor=node,guard=0;while(ancestor&&!isCountry(ancestor)&&guard++<15)ancestor=state.nodes.get(ancestor.parent);
  if(ancestor?.code)visitedCountryCodes.add(ancestor.code);
  try{localStorage.setItem('worldwide.highlight-countries.v1',JSON.stringify([...visitedCountryCodes]));}catch{}
  let ok=false;try{ok=saveProgress(localStorage,state.visited);}catch{}
  storageStatus(ok);updateProgress();updateRows(state.filter==='visited');updateHoverCard();invalidate();
  notify(`${node.native || node.name} ${selected?'marked visited':'removed from visited'}.${ok?'':' Progress is in memory only; export a backup.'}`);
}

async function loadCountry(node) {
  if(regionLoads.has(node.code))return regionLoads.get(node.code);
  const promise=(async()=>{
    const response=await fetch(`data/regions/${encodeURIComponent(node.code)}.json`);
    if(!response.ok)throw Error(`Regional data could not be loaded (${response.status}).`);
    const data=await response.json();
    for(const item of [...(data.divisions||[]),...(data.locals||[]),...(data.places||[])]) state.nodes.set(item.id,item);
    // Country files may explicitly provide their children when there are no admin1 polygons.
    if(data.children)node.children=data.children;
    node.children=(node.children||[]).filter(id=>state.nodes.has(id));
    return data;
  })();
  regionLoads.set(node.code,promise);
  try{return await promise;}catch(e){regionLoads.delete(node.code);throw e;}
}
async function restoreHighlights(){
  for(const id of state.visited){const match=/^division:([A-Z]{3}):/.exec(id);if(match)visitedCountryCodes.add(['HKG','MAC','TWN'].includes(match[1])?'CHN':match[1]);}
  const results=await Promise.allSettled([...visitedCountryCodes].map(code=>state.countries.find(n=>n.code===code)).filter(Boolean).map(node=>loadCountry(node)));
  if(results.some(result=>result.status==='rejected'))notify('Some saved highlights could not load. Open their country to try again; your visits are still saved.');
  invalidate();
}

async function enter(node, options={}) {
  if(!node || state.loading)return;
  if(!isCountry(node) && !hasChildren(node)){mark(node.id);return;}
  stopCameraMotion();const from=cameraSnapshot(),ticket=++loadTicket;
  if(isCountry(node)){
    state.loading=true;showStatus('Opening regional atlas…');
    try{await loadCountry(node);}catch(error){
      if(ticket!==loadTicket)return;
      state.loading=false;showStatus(error.message,()=>{hideStatus();enter(node,options);});return;
    }
    if(ticket!==loadTicket)return;
    state.loading=false;hideStatus();
    if(!hasChildren(node)){mark(node.id);return;}
    state.mode='flat';
  }
  const nextPath=[];let cursor=node;let guard=0;
  while(cursor&&guard++<12){nextPath.unshift(cursor.id);cursor=state.nodes.get(cursor.parent);}
  if(nextPath[0]!==ROOT_ID)nextPath.unshift(ROOT_ID);
  state.path=nextPath;
  if(state.mode==='globe'){
    const [lng,lat]=(isContinent(node)?continentCenters[node.name]:[node.lng,node.lat])||[0,0];state.rotation=[-lng,-lat,0];
  }
  state.zoom=1;state.pan=[0,0];state.hover=null;state.focused=null;state.query='';state.page=1;$('search').value='';
  renderView();startCameraMotion(from,options.keyboard);
  if(options.keyboard)$('region-list').querySelector('.row-enter')?.focus();
}
function goUp(instant=false){
  if(state.path.length===1)return;
  stopCameraMotion();const from=cameraSnapshot();
  ++loadTicket;state.loading=false;hideStatus();state.path=upPath(state.path);
  state.zoom=1;state.pan=[0,0];state.hover=null;state.focused=null;state.query='';state.page=1;$('search').value='';renderView();startCameraMotion(from,instant);
}
function goEarth(){
  stopCameraMotion();const from=cameraSnapshot();
  ++loadTicket;state.loading=false;hideStatus();state.path=earthPath();state.mode='globe';state.zoom=1;state.pan=[0,0];state.hover=null;state.focused=null;state.query='';state.page=1;$('search').value='';renderView();startCameraMotion(from);
}
function setMode(mode){if(state.mode===mode)return;stopCameraMotion();const from=cameraSnapshot();state.mode=mode;state.zoom=1;state.pan=[0,0];if(mode==='globe'&&!isRoot(parent())){const p=parent(),center=isContinent(p)?continentCenters[p.name]:[p.lng,p.lat];if(center)state.rotation=[-center[0],-center[1],0];}renderView();startCameraMotion(from);}
function showStatus(message,retry){
  const box=$('map-status');box.replaceChildren();box.hidden=false;
  if(!retry){const spin=document.createElement('span');spin.className='spinner';box.append(spin);}
  const label=document.createElement('span');label.textContent=message;box.append(label);
  if(retry){const button=document.createElement('button');button.textContent='Try again';button.onclick=retry;box.append(button);}
}
function hideStatus(){$('map-status').hidden=true;$('copy-image').disabled=!state.ready;}

function renderView(){
  const p=parent();if(!p)return;
  $('copy-image').disabled=!state.ready||state.loading;
  const root=isRoot(p),country=isCountry(p),continent=isContinent(p);
  $('parent-name').textContent=p.name;
  $('parent-native').textContent=root?'7 continents':p.native!==p.name?p.native:`${niceKind(p)} · ${p.nativeAvailable===false?'source-name label':'regional atlas'}`;
  $('view-title').textContent=p.native || p.name;
  $('view-eyebrow').textContent=state.path.map(id=>state.nodes.get(id).name).join(' › ');
  $('view-description').textContent=root?'7 continents · a browser-saved record of your discoveries':continent?'Countries and territories':country?'Regional boundaries and mapped places':'Mapped local divisions and settlements';
  $('globe-mode').setAttribute('aria-pressed',String(state.mode==='globe'));
  $('flat-mode').setAttribute('aria-pressed',String(state.mode==='flat'));
  $('up-button').disabled=root;
  $('interaction-hint').textContent=state.mode==='globe'?'↔ Drag to turn the world. Click to explore.':'↔ Drag to pan. Scroll to zoom. Click a region to explore.';
  $('search').placeholder=root?'Find a continent…':continent?'Find a country…':'Find a region or place…';
  $('map-location').textContent=`${root?'EARTH':p.name.toLocaleUpperCase()} / ${state.mode==='globe'?'ORTHOGRAPHIC':'PLANAR'}`;
  canvas.setAttribute('aria-label',`${p.name}, ${state.mode==='globe'?'3D globe. Drag to rotate':'2D map. Drag to pan'}. Use the region list for keyboard exploration. Space marks the focused region. Right-click goes up one level.`);
  const crumbs=$('breadcrumbs');crumbs.replaceChildren();
  for(const [i,id] of state.path.entries()){
    const node=state.nodes.get(id);if(i){const sep=document.createElement('span');sep.textContent='›';sep.className='crumb-divider';sep.setAttribute('aria-hidden','true');crumbs.append(sep);}
    const button=document.createElement('button');button.textContent=i===0?'◎ Earth':node.name;button.setAttribute('aria-label',`Go to ${node.name}`);
    if(i===state.path.length-1)button.setAttribute('aria-current','location');
    button.onclick=()=>{if(i===0){goEarth();return;}stopCameraMotion();const from=cameraSnapshot();state.path=state.path.slice(0,i+1);state.zoom=1;state.pan=[0,0];state.hover=null;state.focused=null;state.page=1;state.query='';$('search').value='';renderView();startCameraMotion(from);};crumbs.append(button);
  }
  const all=children();
  $('list-heading').textContent=root?'CONTINENTS':continent?'COUNTRIES & TERRITORIES':country?(p.code==='CAN'?'PROVINCES & TERRITORIES':p.code==='USA'?'STATES & FEDERAL DISTRICT':p.code==='DEU'?'LÄNDER':p.code==='CHN'?'PROVINCE-LEVEL DIVISIONS':p.code==='GBR'?'CONSTITUENT NATIONS':'REGIONS & PLACES'):all.some(x=>x.geometry)?'LOCAL DIVISIONS':'MAPPED CITIES & TOWNS';
  let note='Mark a region and its children independently. Your count reflects only this view.';
  if(country)note='';
  else if(!root&&!continent)note=all.some(n=>n.geometry)?(p.kind==='Municipality'?'Mapped district boundaries: geoBoundaries / OpenStreetMap, 2017 snapshot; later changes may be absent.':'Local levels follow the source hierarchy; their meaning varies by country.'):'GeoNames settlements: population over 500 plus some administrative seats. This is not a complete count of every city or town.';
  if(p.nativeAvailable===false)note+=' Native label unavailable; the source name is shown.';
  $('coverage-note').textContent=note;$('coverage-note').hidden=!note;
  updateProgress();updateRows(true);updateHoverCard();fitProjection();invalidate();
}
function updateProgress(){
  const p=parent();if(!p)return;
  const d=discovery(p,state.nodes,state.visited);
  $('percentage').replaceChildren(document.createTextNode(String(d.percentage)),Object.assign(document.createElement('span'),{textContent:'%'}));
  $('progress-ring').style.setProperty('--progress',`${d.percentage}%`);
  const unit=isRoot(p)?'continents':isContinent(p)?'countries & territories':isCountry(p)?(p.code==='CAN'?'provinces & territories':p.code==='USA'?'states & federal district':p.code==='DEU'?'Länder':'mapped regions'):'mapped child places';
  $('progress-count').textContent=`${d.visited.toLocaleString()} / ${d.total.toLocaleString()} visited`;
  $('progress-kind').textContent=d.total?unit:'No child units in this dataset';
  $('progress-ring').setAttribute('role','img');$('progress-ring').setAttribute('aria-label',`${d.visited} of ${d.total} ${unit} visited, ${d.percentage} percent`);
}
function updateRows(rebuild=false){
  if(!rebuild){
    document.querySelectorAll('.region-row').forEach(row=>{
      const selected=state.visited.has(row.dataset.id);row.classList.toggle('is-visited',selected);row.querySelector('.row-enter').setAttribute('aria-description',selected?'Visited':'Unexplored');
    });return;
  }
  const list=$('region-list');list.replaceChildren();
  let filtered=searchNodes(children(),state.query).filter(n=>state.filter==='all'||state.visited.has(n.id));
  filtered.sort((a,b)=>isRoot(parent())?0:a.name.localeCompare(b.name));
  const cap=120,visible=filtered.slice(0,cap*state.page);lastRows=visible;
  if(!visible.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=state.query?'No matching regions. Try a native or English name.':state.filter==='visited'?'Your discoveries will appear here. Point to a region and press Space to mark it visited.':'No child places are included for this region. You can still mark the region itself visited.';list.append(empty);}
  const fragment=document.createDocumentFragment();
  for(const node of visible){
    const row=document.createElement('div');row.className='region-row';row.dataset.id=node.id;
    const symbol=isContinent(node)?continentShort[node.name]:node.geometry?'◈':'·';row.dataset.symbol=symbol;
    row.classList.toggle('is-visited',state.visited.has(node.id));row.classList.toggle('is-hovered',effectiveHover()===node.id);
    const button=document.createElement('button');button.className='row-enter';button.dataset.region=node.id;button.setAttribute('aria-label',`${node.native||node.name}${node.native!==node.name?', '+node.name:''}, ${niceKind(node)}. ${hasChildren(node)||isCountry(node)?'Enter to explore; Space to mark visited.':'Enter or Space to toggle visited.'}`);
    button.setAttribute('aria-description',state.visited.has(node.id)?'Visited':'Unexplored');
    const icon=document.createElement('span');icon.className='region-symbol';icon.setAttribute('aria-hidden','true');icon.textContent=symbol;
    const text=document.createElement('span');text.className='row-text';const native=document.createElement('span');native.className='row-native';native.textContent=node.native||node.name;
    const english=document.createElement('span');english.className='row-english';english.textContent=`${node.native&&node.native!==node.name?node.name+' · ':''}${niceKind(node)}${node.nativeAvailable===false?' · source name':''}`;
    text.append(native,english);button.append(icon,text);
    if(hasChildren(node)||isCountry(node)){const arrow=document.createElement('span');arrow.className='row-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');button.append(arrow);}
    button.onclick=e=>enter(node,{keyboard:e.detail===0});
    button.onfocus=()=>{state.focused=node.id;updateHover();};
    button.onblur=e=>{if(!e.relatedTarget?.closest?.(`[data-id="${CSS.escape(node.id)}"]`)){state.focused=null;updateHover();}};
    row.onpointerenter=()=>{state.hover=node.id;updateHover();};row.onpointerleave=()=>{state.hover=null;updateHover();};
    row.append(button);fragment.append(row);
  }
  list.append(fragment);
  if(visible.length<filtered.length){
    const more=document.createElement('button');more.textContent=`Show more · ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()}`;more.className='empty';more.onclick=()=>{state.page++;updateRows(true);list.querySelectorAll('.row-enter')[visible.length]?.focus();};list.append(more);
  }
  // Removed/reordered rows do not reliably dispatch pointerleave. Re-hit the live
  // DOM after search/navigation so Space can never act on a stale hovered row.
  queueMicrotask(()=>{if(!pointerClient)return;const target=document.elementFromPoint(...pointerClient),row=target?.closest('.region-row');state.hover=row?.dataset.id||(target===canvas&&!cameraMotion?hit([pointerClient[0]-canvas.getBoundingClientRect().left,pointerClient[1]-canvas.getBoundingClientRect().top]):null);updateHover();});
}
function updateHover(){
  document.querySelectorAll('.region-row.is-hovered').forEach(n=>n.classList.remove('is-hovered'));
  const id=effectiveHover();if(id)document.querySelector(`.region-row[data-id="${CSS.escape(id)}"]`)?.classList.add('is-hovered');
  updateHoverCard();invalidate();
}
function updateHoverCard(){
  updateHints();
  const node=state.nodes.get(effectiveHover());$('hover-card').hidden=!node;if(!node)return;
  $('hover-kind').textContent=niceKind(node).toLocaleUpperCase();$('hover-native').textContent=node.native||node.name;
  $('hover-name').textContent=node.native!==node.name?node.name:node.nativeAvailable===false?'Native label unavailable · source name shown':node.population?`Population ${node.population.toLocaleString()} · source estimate`:node.name;
  $('hover-action').textContent=`${state.visited.has(node.id)?'Visited':'Unexplored'} · ${hasChildren(node)||isCountry(node)?'Click to explore':'Click to mark'} · Space to toggle`;
}
function updateHints(){
  const node=activeNode(),up=state.nodes.get(state.path.at(-2));
  if($('left-hint'))$('left-hint').textContent=node?(hasChildren(node)||isCountry(node)?`Explore ${node.name}`:state.visited.has(node.id)?'Remove visit':'Mark visited'):'Hover a region';
  if($('right-hint')){$('right-hint').textContent=up?`Back to ${up.name}`:'At Earth';$('right-hint').parentElement.hidden=!up;}
}

function getFeatures(nodes){return {type:'FeatureCollection',features:nodes.filter(n=>n.geometry).map(asFeature)};}
function baseGlobeScale(){
  const p=parent(),key=`${p?.id}:${width}:${height}`,earthScale=Math.min(width*.365,height*.44);
  if(globeBase?.key===key)return globeBase.scale;
  let scale=earthScale;
  if(p?.geometry&&!isRoot(p)&&!isContinent(p)){
    try{const fitted=d3.geoOrthographic().rotate([-(p.lng||0),-(p.lat||0),0]).fitExtent([[width*.1,height*.12],[width*.86,height*.88]],asFeature(p));if(Number.isFinite(fitted.scale()))scale=Math.max(earthScale,fitted.scale());}catch{}
  }
  globeBase={key,scale};return scale;
}
function minimumZoom(){return state.mode==='globe'?Math.min(width,height)*.125/baseGlobeScale():flatBase?.minimumZoom||.35;}
function zoomBy(factor){const next=state.zoom*factor;if(Number.isFinite(next)&&next>0)state.zoom=Math.max(minimumZoom(),next);invalidate();}
function smoothZoomTo(target){
  target=Math.max(minimumZoom(),target);if(!Number.isFinite(target)||target<=0)return;
  if(reducedMotion.matches){zoomSpring=null;state.zoom=target;invalidate();return;}
  if(!zoomSpring){stopCameraMotion();zoomSpring={value:Math.log(state.zoom),target:Math.log(target),velocity:0,last:performance.now()};resetFrameMeasurement();}
  else zoomSpring.target=Math.log(target);
  invalidate();
}
function advanceWheelMotion(){
  if(!zoomSpring)return;const now=performance.now(),next=advanceZoomSpring(zoomSpring,(now-zoomSpring.last)/1000);Object.assign(zoomSpring,next,{last:now});state.zoom=Math.max(minimumZoom(),Math.exp(next.value));if(next.settled)zoomSpring=null;else invalidate();
}
function fitProjection(){
  if(!state.ready)return;
  const p=parent(),cx=width*.5,cy=height*.49;
  if(state.mode==='globe'){
    projection=d3.geoOrthographic().rotate(state.rotation).translate([cx+state.pan[0],cy+state.pan[1]]).scale(baseGlobeScale()*state.zoom).clipAngle(90).precision(.5);
  }else{
    const key=`${p.id}:${width}:${height}`;
    if(flatBase?.key===key){projection=flatBase.projection;projection.rotate(flatBase.rotate).scale(flatBase.scale*state.zoom).translate([flatBase.translate[0]+state.pan[0],flatBase.translate[1]+state.pan[1]]);return;}
    let focus;
    if(p.geometry)focus=asFeature(p);
    else if(isContinent(p))focus=getFeatures(state.countries.filter(c=>c.continent===p.name));
    else if(isRoot(p))focus=getFeatures(state.countries.filter(c=>c.code!=='ATA'));
    else {const withCoords=children().filter(n=>Number.isFinite(n.lng)&&Number.isFinite(n.lat));focus={type:'MultiPoint',coordinates:withCoords.map(n=>[n.lng,n.lat])};}
    const center=isRoot(p)?[0,0]:isContinent(p)?continentCenters[p.name]:[p.lng||0,p.lat||0];
    projection=d3.geoMercator().rotate([-(center?.[0]||0),0]).precision(.3).clipExtent([[0,0],[width,height]]);
    // Regional map extents leave room for map controls and labels.
    try{
      const extent=[[Math.min(75,width*.1),Math.min(45,height*.1)],[width-Math.min(95,width*.13),height-Math.min(55,height*.13)]];
      projection.fitExtent(extent,focus);
      if(!Number.isFinite(projection.scale()))projection.scale(4000).center([0,p.lat||0]).translate([cx,cy]);
    }catch{projection.scale(width/7).translate([cx,cy]);}
    flatBase={key,projection,rotate:projection.rotate(),scale:projection.scale(),translate:projection.translate()};
    if(isRoot(p)){const b=d3.geoPath(projection).bounds(focus),span=Math.min(b[1][0]-b[0][0],b[1][1]-b[0][1]);flatBase.minimumZoom=Number.isFinite(span)&&span>0?Math.min(width,height)*.25/span:.35;}
    projection.scale(flatBase.scale*state.zoom).translate([flatBase.translate[0]+state.pan[0],flatBase.translate[1]+state.pan[1]]);
  }
}
function invalidate(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();if(snapshotSession)renderPreview();});}
function prepareMotionMap(){
  if(!motionMapTried){motionMapTried=true;motionMap=createMotionMap();canvas.dataset.motionRenderer=motionMap?'webgl':'canvas';}
  if(!motionMap)return;
  const key=`${state.path.join('|')}:${state.nodes.size}:${[...state.visited].sort().join('|')}`;
  if(prepareMotionMap.key===key)return;
  const p=parent(),root=isRoot(p),cont=isContinent(p),layers=[];
  for(const c of state.countries)layers.push({feature:renderFeature(c,true),fill:'#c9d7b9'});
  for(const c of state.countries)if(state.visited.has(c.id)||root&&state.visited.has(`continent:${c.continent}`))layers.push({feature:renderFeature(c,true),fill:'#b1ce79'});
  if(!root&&!cont){if(p.geometry&&!isCountry(p))layers.push({feature:renderFeature(p,true),fill:state.visited.has(p.id)?'#b1ce79':'#d1dec0'});for(const n of children().filter(n=>n.geometry))layers.push({feature:renderFeature(n,true),fill:state.visited.has(n.id)?'#b1ce79':'#c0d2b0'});}
  for(const id of state.visited){const n=state.nodes.get(id);if(n?.geometry&&!isCountry(n)&&!isContinent(n)&&!state.path.includes(id))layers.push({feature:renderFeature(n,true),fill:'#b1ce79'});}
  const elapsed=motionMap.setData(layers,key,state.countries.length);prepareMotionMap.key=key;
  if(elapsed&&cameraMotion)cameraMotion.started+=elapsed;
}
function draw(){
  if(!state.ready||width<2||height<2)return;advanceWheelMotion();fitProjection();if(!projection)return;applyCameraMotion();
  const renderStart=performance.now();
  if(pointer?.dragging||previewPointer||cameraMotion||zoomSpring){if(lastMeasuredFrame&&renderStart-lastMeasuredFrame<250)measuredFrames.push(renderStart-lastMeasuredFrame);lastMeasuredFrame=renderStart;}else lastMeasuredFrame=0;
  canvas.dataset.rotation=JSON.stringify(projection.rotate());
  canvas.dataset.path=JSON.stringify(state.path);
  canvas.dataset.mode=state.mode;
  canvas.dataset.blend=String(projection.atlasBlend??(state.mode==='flat'?1:0));
  canvas.dataset.scale=String(projection.scale());
  canvas.dataset.zoom=String(state.zoom);canvas.dataset.animating=String(Boolean(cameraMotion||zoomSpring));
  canvas.dataset.visitedGeometries=String([...state.visited].filter(id=>{const n=state.nodes.get(id);return n?.geometry&&!isCountry(n)&&!isContinent(n);}).length);
  context.clearRect(0,0,width,height);const path=d3.geoPath(projection,context),p=parent(),hover=effectiveHover();
  const moving=pointer?.dragging||previewPointer||cameraMotion||zoomSpring;
  if(moving){
    prepareMotionMap();
    if(motionMap){
      const surface=motionMap.render({width,height,ratio:canvas.width/width,scale:projection.scale(),translate:projection.translate(),rotate:projection.rotate(),blend:projection.atlasBlend??(state.mode==='flat'?1:0)});
      context.drawImage(surface,0,0,width,height);
      for(const id of state.visited){const n=state.nodes.get(id);if(n&&!n.geometry&&!isContinent(n)&&isVisible([n.lng,n.lat])){const q=projection([n.lng,n.lat]);context.beginPath();context.arc(q[0],q[1],3,0,2*Math.PI);context.fillStyle='#b1ce79';context.fill();}}
      drawLabels(children());recordFrame(renderStart);return;
    }
  }
  const morphing=cameraMotion&&Math.abs(cameraMotion.from.blend-(state.mode==='flat'?1:0))>.001;
  const globe=state.mode==='globe'&&!morphing,isWorld=isRoot(p),isCont=isContinent(p),scale=projection.scale();
  if(globe){
    const [x,y]=projection.translate();context.save();context.shadowColor='#25443820';context.shadowBlur=35;context.shadowOffsetY=22;context.beginPath();context.arc(x,y,scale,0,2*Math.PI);context.fillStyle='#244d48';context.fill();context.restore();
    const sea=context.createRadialGradient(x-scale*.37,y-scale*.45,scale*.05,x+scale*.15,y+scale*.1,scale*1.2);sea.addColorStop(0,'#426e64');sea.addColorStop(.65,'#244d48');sea.addColorStop(1,'#183e3b');context.beginPath();path({type:'Sphere'});context.fillStyle=sea;context.fill();
  }else{
    context.fillStyle='#edf0e3';context.fillRect(0,0,width,height);
    if(morphing){context.beginPath();path({type:'Sphere'});context.fillStyle='#426e64';context.fill();}
  }
  context.beginPath();path(d3.geoGraticule10());context.strokeStyle=globe?'#b7d9bd17':'#7f9e7920';context.lineWidth=.6;context.stroke();
  const rootContinent=hover?.startsWith('continent:')?state.nodes.get(hover)?.name:null;
  for(const country of state.countries){
    const relevant=isWorld || isCont&&country.continent===p.name || currentCountry()?.id===country.id;
    let visited=state.visited.has(country.id)||(isWorld&&state.visited.has(`continent:${country.continent}`));
    if(!isWorld&&!isCont)visited=state.visited.has(country.id);
    let fill=relevant?(visited?'#b1ce79':globe?'#7eaa90':'#c9d7b9'):globe?'#5e8474':'#dce3d0';
    if(country.id===hover || rootContinent===country.continent)fill='#e1e6ba';
    if(!isWorld&&!isCont&&relevant)fill=state.visited.has(country.id)?'#b6cc89':globe?'#7eaa90':'#d3ddc2';
    context.beginPath();path(renderFeature(country));context.fillStyle=fill;context.fill();context.strokeStyle=globe?'#234c4270':'#7d94796a';context.lineWidth=relevant?.65:.4;context.stroke();
  }
  const childNodes=children(),polygonNodes=childNodes.filter(n=>n.geometry);
  if(!isWorld&&!isCont){
    // Keep enclosing administrative geometry visible when exploring settlement-only layers.
    if(p.geometry&&!isCountry(p)){context.beginPath();path(renderFeature(p));context.fillStyle=state.visited.has(p.id)?'#bfce9c':globe?'#7eaa90':'#d1dec0';context.fill();context.strokeStyle='#638168';context.lineWidth=1;context.stroke();}
    for(const node of polygonNodes){context.beginPath();path(renderFeature(node));context.fillStyle=node.id===hover?'#e1e6ba':state.visited.has(node.id)?'#b1ce79':globe?'#86ac8e':'#c0d2b0';context.fill();context.strokeStyle=globe?'#2d574b':'#6b8865';context.lineWidth=.75;context.stroke();}
  }
  // Persist exact visited descendant shapes on wider views without selecting ancestors.
  for(const id of state.visited){
    const node=state.nodes.get(id);if(!node||isCountry(node)||isContinent(node)||state.path.includes(id))continue;
    if(node.geometry){context.beginPath();path(renderFeature(node));context.fillStyle='#b1ce79';context.fill();context.strokeStyle=globe?'#d3e6a5':'#749044';context.lineWidth=.8;context.stroke();}
    else if(isVisible([node.lng,node.lat])){const point=projection([node.lng,node.lat]);context.beginPath();context.arc(point[0],point[1],isWorld||isCont?3:4,0,Math.PI*2);context.fillStyle='#b1ce79';context.fill();context.strokeStyle='#426b3a';context.lineWidth=.8;context.stroke();}
  }
  if(globe){
    const [x,y]=projection.translate();const shade=context.createRadialGradient(x-scale*.28,y-scale*.3,scale*.3,x,y,scale);shade.addColorStop(0,'#0c302000');shade.addColorStop(.7,'#0c302003');shade.addColorStop(1,'#0b2c3359');context.beginPath();path({type:'Sphere'});context.fillStyle=shade;context.fill();context.beginPath();context.arc(x,y,scale-.5,0,Math.PI*2);context.strokeStyle='#aac7a74a';context.lineWidth=1;context.stroke();
  }
  drawLabels(childNodes);
  if(isWorld){
    context.save();context.font='italic 11px Georgia';context.fillStyle=globe?'#c6d9c08a':'#8d9f87';context.textAlign='center';
    for(const [text,coord] of [['Atlantic Ocean',[-30,0]],['Indian Ocean',[78,-23]],['Pacific Ocean',[-145,0]]]){if(isVisible(coord)){const pt=projection(coord);if(pt)context.fillText(text,...pt);}}context.restore();
  }
  recordFrame(renderStart);prepareMotionMap();
}
function isVisible(coord){
  if(!coord||!projection)return false;
  if(state.mode==='globe'){const center=d3.geoRotation(state.rotation).invert([0,0]);if(d3.geoDistance(coord,center)>Math.PI*.49)return false;}
  const pt=projection(coord);return pt&&Number.isFinite(pt[0])&&pt[0]>8&&pt[0]<width-8&&pt[1]>8&&pt[1]<height-8;
}
function drawLabels(nodes){
  const p=parent(),root=isRoot(p),hover=effectiveHover(),occupied=[],pointMode=!root&&!isContinent(p)&&!nodes.some(n=>n.geometry);
  state.drawnPoints=[];
  const sorted=[...nodes].sort((a,b)=>Number(b.id===hover)-Number(a.id===hover)||(b.population||0)-(a.population||0));
  context.textAlign='center';context.textBaseline='middle';
  for(const node of sorted){
    const coord=root?continentCenters[node.name]:[node.lng,node.lat];if(!isVisible(coord))continue;
    const pt=projection(coord);if(!pt)continue;
    const selected=state.visited.has(node.id),active=node.id===hover;
  if(pointMode){
      context.beginPath();context.arc(pt[0],pt[1],active?5:selected?3.5:2.5,0,Math.PI*2);context.fillStyle=selected?'#799c3f':'#345e4a';context.fill();context.strokeStyle='#f5f8e7';context.lineWidth=1;context.stroke();state.drawnPoints.push({id:node.id,point:pt});
    }
    if(!active&&occupied.length>=(root?15:pointMode?36:95))continue;
    const text=node.native||node.name;
    const fontSize=root?Math.min(width<500?12:14,width/36):active?12:node.geometry?10:10;
    context.font=`${root||active?'550':'450'} ${fontSize}px Atlas,system-ui,sans-serif`;
    const measure=context.measureText(text).width, x=pt[0], y=pt[1]+(pointMode?-11:0),box=[x-measure/2-5,y-8,x+measure/2+5,y+8];
    if(!active&&occupied.some(r=>box[0]<r[2]&&box[2]>r[0]&&box[1]<r[3]&&box[3]>r[1]))continue;
    occupied.push(box);
    context.lineWidth=root?3:3;context.lineJoin='round';context.strokeStyle=state.mode==='globe'?'#345b46ae':'#eef2e3e6';context.strokeText(text,x,y);context.fillStyle=state.mode==='globe'?'#f2f3df':'#274c36';context.fillText(text,x,y);
    if(root&&node.native!==node.name){context.font='9px Atlas,system-ui';context.strokeText(node.name,x,y+16);context.fillStyle=state.mode==='globe'?'#d2e0c2':'#6a805f';context.fillText(node.name,x,y+16);}
  }
}
function pointOf(event){const bounds=canvas.getBoundingClientRect();return[event.clientX-bounds.left,event.clientY-bounds.top];}
function hit(point){
  if(!projection||!state.ready)return null;
  const p=parent(),coord=projection.invert(point);if(!coord||coord.some(n=>!Number.isFinite(n)))return null;
  if(state.mode==='globe'){const center=projection.translate();if(Math.hypot(point[0]-center[0],point[1]-center[1])>projection.scale())return null;}
  if(isRoot(p)){
    const found=state.countries.find(c=>d3.geoContains(asFeature(c),coord));return found?`continent:${found.continent}`:null;
  }
  const nodes=children(),polygons=nodes.filter(n=>n.geometry);
  if(polygons.length){const found=polygons.find(n=>d3.geoContains(asFeature(n),coord));return found?.id||null;}
  let best=null,bestDistance=15;
  // Point hits must match the visible layer, rather than invisible points behind the globe.
  for(const node of nodes){if(!isVisible([node.lng,node.lat]))continue;const xy=projection([node.lng,node.lat]),dist=Math.hypot(point[0]-xy[0],point[1]-xy[1]);if(dist<bestDistance){best=node.id;bestDistance=dist;}}
  return best;
}

canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||pointer||!state.ready)return;
  stopCameraMotion();
  resetFrameMeasurement();
  const pt=pointOf(event);pointer={id:event.pointerId,start:pt,last:pt,rotation:[...state.rotation],pan:[...state.pan],dragging:false};
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',event=>{
  const pt=pointOf(event);
  if(pointer){
    if(event.pointerId!==pointer.id)return;
    if(isDrag(pointer.start,pt))pointer.dragging=true;
    if(pointer.dragging){if(!canvas.classList.contains('dragging')){canvas.classList.add('dragging');state.hover=null;state.focused=null;updateHoverCard();}
      const delta=[pt[0]-pointer.start[0],pt[1]-pointer.start[1]];
      if(state.mode==='globe')state.rotation=rotateDrag(pointer.rotation,delta);else state.pan=[pointer.pan[0]+delta[0],pointer.pan[1]+delta[1]];
      invalidate();
    }
    pointer.last=pt;
  }else{
    const id=hit(pt);if(state.hover!==id){state.hover=id;updateHover();}
    canvas.style.cursor=id?'pointer':'grab';
  }
});
function endPointer(event,cancelled=false){
  if(!pointer||event.pointerId!==pointer.id)return;
  const old=pointer;pointer=null;canvas.classList.remove('dragging');
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(!cancelled&&!old.dragging){const id=hit(pointOf(event));state.hover=id;updateHover();if(id)enter(state.nodes.get(id));}
  invalidate();
}
canvas.addEventListener('pointerup',event=>endPointer(event));
canvas.addEventListener('pointercancel',event=>endPointer(event,true));
canvas.addEventListener('lostpointercapture',event=>{if(pointer?.id===event.pointerId){pointer=null;canvas.classList.remove('dragging');}});
canvas.addEventListener('pointerleave',()=>{if(!pointer){state.hover=null;updateHover();}});
let wheelLocked=false,lastWheel=0;
canvas.addEventListener('wheel',event=>{
  event.preventDefault();if(!zoomSpring)stopCameraMotion();const step=wheelStep({zoom:zoomSpring?Math.exp(zoomSpring.target):state.zoom,deltaY:event.deltaY,depth:state.path.length,locked:wheelLocked,lastEvent:lastWheel,now:performance.now(),minZoom:minimumZoom()});wheelLocked=step.locked;lastWheel=step.lastEvent;
  if(step.ascend){zoomSpring=null;goUp();notify('Zoomed out · up one level');return;}
  smoothZoomTo(step.zoom);
},{passive:false});
document.querySelector('.app-shell').addEventListener('contextmenu',event=>{if(event.target.closest('input'))return;event.preventDefault();goUp();});

$('globe-mode').onclick=()=>setMode('globe');$('flat-mode').onclick=()=>setMode('flat');$('up-button').onclick=goUp;
function animateZoom(factor){if(!zoomSpring)stopCameraMotion();smoothZoomTo((zoomSpring?Math.exp(zoomSpring.target):state.zoom)*factor);}
$('zoom-in').onclick=()=>animateZoom(1.25);
$('zoom-out').onclick=()=>animateZoom(1/1.25);
$('fit-button').onclick=()=>{stopCameraMotion();const from=cameraSnapshot();state.zoom=1;state.pan=[0,0];fitProjection();startCameraMotion(from);invalidate();};
$('search').addEventListener('input',event=>{state.query=event.target.value;state.page=1;state.focused=null;updateRows(true);updateHover();});
for(const filter of ['all','visited'])$('filter-'+filter).onclick=()=>{state.filter=filter;state.page=1;$('filter-all').setAttribute('aria-pressed',String(filter==='all'));$('filter-visited').setAttribute('aria-pressed',String(filter==='visited'));updateRows(true);};
$('export-progress').onclick=()=>{
  const blob=new Blob([JSON.stringify({application:'Worldwide',version:1,exported:new Date().toISOString(),visited:[...state.visited].sort()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`worldwide-progress-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
};
let snapshotSession=null,previewPointer=null,previewFrame=null;
const preview=$('image-preview');
function renderPreview(){
  if(!snapshotSession)return;
  const p=parent(),rendered=renderSnapshot({map:canvas,title:p.native||p.name,english:p.name,kind:state.path.map(id=>state.nodes.get(id).name).join(" › "),progress:discovery(p,state.nodes,state.visited),unit:$('progress-kind').textContent,brand:document.querySelector('.brand-icon'),coverage:$('coverage-note').textContent,now:snapshotSession.date},preview);
  previewFrame=rendered.mapFrame;
  preview.dataset.pan=JSON.stringify(state.pan);preview.dataset.region=p.id;preview.dataset.progress=$('progress-count').textContent;
}
$('copy-image').onclick=()=>{
  if(!state.ready||state.loading)return notify('Wait for this region to finish loading.');
  stopCameraMotion();cameraMotion=null;motionOverlay?.remove();motionOverlay=null;
  snapshotSession={pan:[...state.pan],zoom:state.zoom,date:new Date()};state.hover=null;state.focused=null;draw();renderPreview();
  $('image-feedback').textContent='Drag the map below to choose your framing. Copy image saves exactly this preview.';
  $('retry-copy').disabled=!(navigator.clipboard?.write&&globalThis.ClipboardItem);
  if($('retry-copy').disabled)$('image-feedback').textContent='Drag to choose your framing. This browser does not support image copying; use Download PNG.';
  $('image-dialog').showModal();
};
preview.addEventListener('pointerdown',event=>{
  if(event.button!==0||previewPointer||!snapshotSession||!previewFrame)return;
  const r=preview.getBoundingClientRect(),scale=r.width/preview.width,x=(event.clientX-r.left)/scale,y=(event.clientY-r.top)/scale;
  if(x<previewFrame.x||x>previewFrame.x+previewFrame.width||y<previewFrame.y||y>previewFrame.y+previewFrame.height)return;
  previewPointer={id:event.pointerId,start:[event.clientX,event.clientY],pan:[...state.pan],factor:width/(previewFrame.width*scale)};preview.setPointerCapture(event.pointerId);preview.classList.add('dragging');
  resetFrameMeasurement();
});
preview.addEventListener('pointermove',event=>{
  if(previewPointer?.id!==event.pointerId)return;
  state.pan=[previewPointer.pan[0]+(event.clientX-previewPointer.start[0])*previewPointer.factor,previewPointer.pan[1]+(event.clientY-previewPointer.start[1])*previewPointer.factor];invalidate();
});
function endPreviewDrag(event,cancel=false){if(previewPointer?.id!==event.pointerId)return;if(cancel)state.pan=previewPointer.pan;previewPointer=null;preview.classList.remove('dragging');if(preview.hasPointerCapture(event.pointerId))preview.releasePointerCapture(event.pointerId);invalidate();}
preview.addEventListener('pointerup',event=>endPreviewDrag(event));preview.addEventListener('pointercancel',event=>endPreviewDrag(event,true));preview.addEventListener('lostpointercapture',()=>{previewPointer=null;preview.classList.remove('dragging');});
preview.addEventListener('wheel',event=>{event.preventDefault();smoothZoomTo((zoomSpring?Math.exp(zoomSpring.target):state.zoom)*Math.exp(Math.max(-20,Math.min(20,-event.deltaY*.0015))));},{passive:false});
preview.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();state.pan[0]+=event.key==='ArrowLeft'?-18:event.key==='ArrowRight'?18:0;state.pan[1]+=event.key==='ArrowUp'?-18:event.key==='ArrowDown'?18:0;invalidate();});
$('close-image').onclick=()=>$('image-dialog').close();
$('image-dialog').addEventListener('close',()=>{if(snapshotSession){zoomSpring=null;state.pan=snapshotSession.pan;state.zoom=snapshotSession.zoom;snapshotSession=null;previewPointer=null;invalidate();}});
$('retry-copy').onclick=async()=>{
  stopCameraMotion();draw();renderPreview();const png=pngBlob(preview);
  try{await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);$('image-feedback').textContent='Image copied to clipboard with this framing, visited highlights and discovery progress.';$('copy-image').dataset.lastResult='copied';notify('Image copied to clipboard.');}
  catch{$('image-feedback').textContent='Clipboard access was unavailable or denied. The image has not been copied; use Download PNG.';$('copy-image').dataset.lastResult='download-fallback';}
};
$('download-image').onclick=async()=>{
  try{stopCameraMotion();draw();renderPreview();const blob=await pngBlob(preview),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`worldwide-${parent().name.toLocaleLowerCase().replace(/[^a-z0-9]+/g,'-')||'region'}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);notify('PNG download started.');}catch{notify('The PNG could not be created. Please try again.');}
};
$('about-button').onclick=()=>$('about-dialog').showModal();$('close-about').onclick=()=>$('about-dialog').close();
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
document.addEventListener('keydown',event=>{
  if(event.key==='Tab'||event.key.startsWith('Arrow'))state.modality='keyboard';
  const dialog=$('about-dialog').open?$('about-dialog'):$('image-dialog').open?$('image-dialog'):null;if(dialog){if(event.key==='Escape'){event.preventDefault();dialog.close();goEarth();}return;}
  if(event.key==='Escape'){event.preventDefault();goEarth();return;}
  if(event.target.matches('input,textarea,[contenteditable=true]'))return;
  if(event.key==='/'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();$('search').focus();return;}
  if(event.code==='Space'){
    canvas.dataset.lastSpace=JSON.stringify({hover:state.hover,focused:state.focused,modality:state.modality,target:event.target.dataset?.region});
    const node=state.nodes.get(resolveSpaceTarget({hover:state.hover,focused:state.focused,modality:state.modality,target:event.target.dataset?.region}));
    // Map and region controls share one Space handler, avoiding native button double activation.
    if(event.target.closest('.row-enter')||event.target===canvas||!event.target.closest('button')){event.preventDefault();if(!event.repeat)mark(node?.id);}return;
  }
  if(event.key==='ArrowLeft' && !event.target.matches('input')){event.preventDefault();goUp(true);return;}
  if(event.key==='ArrowRight'){const node=activeNode();if(node){event.preventDefault();enter(node,{keyboard:true});}return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)&&event.target.closest('.region-list')){
    event.preventDefault();const rows=[...$('region-list').querySelectorAll('.row-enter')];const i=rows.findIndex(x=>x.dataset.region===event.target.dataset.region);rows[Math.max(0,Math.min(rows.length-1,i+(event.key==='ArrowDown'?1:-1)))]?.focus();return;
  }
  if(event.target===canvas){
    if(event.key==='Enter'){event.preventDefault();enter(activeNode());}
    if(state.mode==='globe'&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();state.rotation[1]+=event.key==='ArrowUp'?10:-10;fitProjection();invalidate();}
  }
});
document.addEventListener('pointermove',event=>{pointerClient=[event.clientX,event.clientY];if(state.modality!=='pointer'){state.modality='pointer';updateHover();}},{capture:true,passive:true});
document.addEventListener('pointerdown',event=>{pointerClient=[event.clientX,event.clientY];state.modality='pointer';if(!event.target.closest('.region-row')&&event.target!==canvas){state.hover=null;updateHover();}},{capture:true,passive:true});
window.addEventListener('storage',event=>{if(event.key==='worldwide.progress.v1'){try{state.visited=readProgress(localStorage).visited;updateProgress();updateRows();invalidate();}catch{}}});
new ResizeObserver(()=>{
  if(cameraMotion)stopCameraMotion();
  const rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2);width=rect.width;height=rect.height;if(width<2||height<2)return;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);fitProjection();if(state.ready)state.zoom=Math.max(minimumZoom(),state.zoom);fitProjection();invalidate();
}).observe($('map-stage'));

async function init(){
  showStatus('Loading the world…');
  try{
    if(!globalThis.d3)throw Error('The map library could not be loaded. Please refresh or try again.');
    const response=await fetch('data/world.json');if(!response.ok)throw Error(`The world atlas could not be loaded (${response.status}).`);
    const world=await response.json();state.countries=world.countries;
    let migrated=false;for(const [oldId,newId]of Object.entries(world.progressAliases||{})){if(state.visited.delete(oldId)){state.visited.add(newId);migrated=true;visitedCountryCodes.add('CHN');}}if(migrated)try{saveProgress(localStorage,state.visited);}catch{}
    for(const continent of world.continents){continent.parent=ROOT_ID;state.nodes.set(continent.id,continent);}
    for(const country of world.countries){country.parent=`continent:${country.continent}`;state.nodes.set(country.id,country);}
    state.nodes.set(ROOT_ID,{id:ROOT_ID,name:'Earth',native:'Earth',kind:'Planet',children:world.continents.map(c=>c.id)});
    state.ready=true;$('data-stats').textContent=world.coverage?.summary||`${world.countries.length} country and territory map units. Country-sized data files load as you explore. See the full source notes for counts and boundary dates.`;
    hideStatus();renderView();restoreHighlights();
  }catch(error){showStatus(error.message,init);$('region-list').innerHTML='<p class="empty">Your atlas is temporarily unavailable. Try loading it again.</p>';}
}
init();

// A read-only diagnostic snapshot supports reproducible interaction checks and bug reports.
window.worldwide={snapshot:()=>({ready:state.ready,path:[...state.path],mode:state.mode,rotation:[...state.rotation],visited:[...state.visited],progress:parent()?discovery(parent(),state.nodes,state.visited):null,nodeCount:state.nodes.size,hover:state.hover}),getNode:id=>{const n=state.nodes.get(id);return n?{...n,geometry:undefined}:null;}};
