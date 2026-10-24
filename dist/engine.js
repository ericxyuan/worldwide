export const STORAGE_KEY = 'worldwide.progress.v1';
export const ROOT_ID = 'earth';
export const CONTINENT_NAMES = {Africa:'Africa',Antarctica:'Antarctica',Asia:'Asia',Europe:'Europe','North America':'North America','South America':'South America',Oceania:'Oceania'};
export function percent(visited, total) { return total ? Math.round(visited / total * 100) : 0; }
export function discovery(parent, nodes, visited) {
  const children = (parent.children || []).filter(id => nodes.has(id));
  const count = children.reduce((n,id) => n + Number(visited.has(id)), 0);
  return {visited:count,total:children.length,percentage:percent(count,children.length)};
}
export function readProgress(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || '{"visited":[]}');
    if (!Array.isArray(data.visited)) throw Error('Invalid progress');
    return {visited:new Set(data.visited.filter(x=>typeof x === 'string' && x.length < 220)),available:true};
  } catch { return {visited:new Set(),available:false}; }
}
export function saveProgress(storage, visited) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({version:1,visited:[...visited].sort(),updated:new Date().toISOString()})); return true; }
  catch { return false; }
}
export function toggleVisited(visited, id) {
  if (visited.has(id)) {visited.delete(id);return false;}
  visited.add(id);return true;
}
export function isDrag(start, point, threshold=6) { return Math.hypot(point[0]-start[0],point[1]-start[1]) >= threshold; }
export function upPath(path) { return path.length > 1 ? path.slice(0,-1) : path; }
export function earthPath() { return [ROOT_ID]; }
export function descendantsAreIndependent(parent, child, visited) { return visited.has(parent) && !visited.has(child); }
export function fold(text) { return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase(); }
export function searchNodes(nodes, query) { const q=fold(query).trim();return nodes.filter(n=>fold(`${n.native} ${n.name} ${n.kind}`).includes(q)); }
export function rotateDrag(rotation, delta) { return [rotation[0]+delta[0]*.28, rotation[1]-delta[1]*.28,rotation[2] || 0]; }
export function resolveSpaceTarget({hover,focused,modality,target}) {return hover||(modality==='keyboard'?(target||focused):null)||null;}
export function wheelStep({zoom,deltaY,depth,locked,lastEvent,now,minZoom}) {
  if(now-lastEvent>600)locked=false;
  const next=zoom*Math.exp(Math.max(-20,Math.min(20,-deltaY*.0015)));
  if(next<.7&&depth>1&&!locked)return{ascend:true,locked:true,zoom:1,lastEvent:now};
  return{ascend:false,locked,zoom:Number.isFinite(next)&&next>0?Math.max(locked?.7:minZoom,next):zoom,lastEvent:now};
}
export function advanceZoomSpring(spring,dt){
  dt=Math.max(0,Math.min(.032,dt));
  const velocity=spring.velocity+(240*(spring.target-spring.value)-31*spring.velocity)*dt;
  const value=spring.value+velocity*dt;
  const settled=Math.abs(spring.target-value)<.0001&&Math.abs(velocity)<.002;
  return {value:settled?spring.target:value,velocity:settled?0:velocity,settled};
}
