/** Worldwide geography preparation. Node >=20; no package installation required. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'dist/data');
const vendorDir = path.join(root, 'dist/vendor');
const cacheDir = process.env.WORLDWIDE_DATA_CACHE || path.join(os.tmpdir(), 'worldwide-geography-cache');
await Promise.all([fs.mkdir(path.join(dataDir, 'regions'), { recursive: true }), fs.mkdir(vendorDir, { recursive: true }), fs.mkdir(cacheDir, { recursive: true })]);
const inputHashes = {};
async function download(url, key) {
  const dest = path.join(cacheDir, key);
  let bytes;
  try { if (process.argv.includes('--refresh')) throw new Error('refresh'); bytes = await fs.readFile(dest); }
  catch { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: ${response.status}`); bytes = Buffer.from(await response.arrayBuffer()); await fs.writeFile(dest, bytes); }
  inputHashes[key] = { url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  console.log(`Loaded ${key}: ${(bytes.length / 1048576).toFixed(1)} MiB`);
  return bytes;
}
function unzipOne(bytes, suffix) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65558) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('ZIP end record missing');
  let cursor = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP directory corrupt');
    const method = bytes.readUInt16LE(cursor + 10), size = bytes.readUInt32LE(cursor + 20);
    const nl = bytes.readUInt16LE(cursor + 28), xl = bytes.readUInt16LE(cursor + 30), cl = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nl).toString('utf8');
    if (name.endsWith(suffix)) {
      const pos = bytes.readUInt32LE(cursor + 42);
      const start = pos + 30 + bytes.readUInt16LE(pos + 26) + bytes.readUInt16LE(pos + 28);
      const compressed = bytes.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
    }
    cursor += 46 + nl + xl + cl;
  }
  throw new Error(`ZIP entry ${suffix} missing`);
}
function* lines(text) { let start = 0; for (;;) { const end = text.indexOf('\n', start); if (end < 0) { if (start < text.length) yield text.slice(start); return; } yield text.slice(start, end).replace(/\r$/, ''); start = end + 1; } }
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const [countryBytes, divisionBytes, sampledBytes, nativeBytes, d3Bytes, d3License, cityZip, admin1Bytes, admin2Bytes, chinaZip, countyBytes, chinaNamesBytes, openccBytes, openccLicense, openccThirdParty] = await Promise.all([
  download(base + 'ne_10m_admin_0_countries.geojson', 'countries.geojson'),
  download(base + 'ne_10m_admin_1_states_provinces.geojson', 'divisions.geojson'),
  download(base + 'ne_10m_populated_places.geojson', 'sampled-places.geojson'),
  download('https://raw.githubusercontent.com/mledoze/countries/master/countries.json', 'native-countries.json'),
  download('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', 'd3.min.js'),
  download('https://cdn.jsdelivr.net/npm/d3@7.9.0/LICENSE', 'd3-LICENSE'),
  download('https://download.geonames.org/export/dump/cities500.zip', 'cities500.zip'),
  download('https://download.geonames.org/export/dump/admin1CodesASCII.txt', 'admin1CodesASCII.txt'),
  download('https://download.geonames.org/export/dump/admin2Codes.txt', 'admin2Codes.txt'),
  download('https://download.geonames.org/export/dump/CN.zip', 'CN.zip'),
  download('https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/CHN/ADM3/geoBoundaries-CHN-ADM3_simplified.geojson', 'china-counties.geojson'),
  download('https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist/pcas-code.json', 'china-division-names.json'),
  download('https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/full.js', 'opencc.full.js'),
  download('https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/LICENSE', 'opencc-LICENSE'),
  download('https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/THIRD_PARTY_LICENSES.md', 'opencc-THIRD-PARTY-LICENSES'),
]);
await fs.writeFile(path.join(vendorDir, 'd3.min.js'), d3Bytes);
await fs.writeFile(path.join(vendorDir, 'LICENSE-d3.txt'), d3License);
await fs.writeFile(path.join(vendorDir, 'LICENSE-opencc.txt'), openccLicense);
await fs.writeFile(path.join(vendorDir, 'THIRD-PARTY-LICENSES-opencc.md'), openccThirdParty);
const context = vm.createContext({}); vm.runInContext(d3Bytes.toString(), context); const d3 = context.d3;
const openccContext=vm.createContext({});vm.runInContext(openccBytes.toString(),openccContext);
const simplified={tw:openccContext.OpenCC.Converter({from:'tw',to:'cn'}),hk:openccContext.OpenCC.Converter({from:'hk',to:'cn'})};
const countryFeatures = JSON.parse(countryBytes).features;
const divisionFeatures = JSON.parse(divisionBytes).features;
const nativeCountries = new Map(JSON.parse(nativeBytes).map(x => [x.cca3, x]));
const sampleCities = new Map(JSON.parse(sampledBytes).features.map(x => [String(x.properties.GEONAMESID), x.properties]));
const admin1 = new Map([...lines(admin1Bytes.toString())].filter(Boolean).map(x => { const a = x.split('\t'); return [a[0], { name: a[1], id: a[3] }]; }));
const admin2 = new Map([...lines(admin2Bytes.toString())].filter(Boolean).map(x => { const a = x.split('\t'); return [a[0], { name: a[1], id: a[3] }]; }));
const languageCodes = { eng:'en',fra:'fr',deu:'de',zho:'zh',rus:'ru',spa:'es',por:'pt',ara:'ar',jpn:'ja',kor:'ko',hin:'hi',ben:'bn',urd:'ur',fas:'fa',nld:'nl',pol:'pl',ita:'it',swe:'sv',tur:'tr',vie:'vi',ind:'id',hun:'hu',ell:'el',heb:'he',ukr:'uk',msa:'ms',tha:'th',ron:'ro',ces:'cs',slk:'sk',dan:'da',fin:'fi',nor:'no',nno:'nn',nob:'nb',isl:'is',lit:'lt',lav:'lv',est:'et',srp:'sr',hrv:'hr',bul:'bg',mkd:'mk',slv:'sl',sqi:'sq',hye:'hy',kat:'ka',aze:'az',kaz:'kk',uzb:'uz',kir:'ky',tgk:'tg',mon:'mn',mya:'my',khm:'km',lao:'lo',nep:'ne',sin:'si',tam:'ta',tel:'te',amh:'am',swa:'sw',som:'so',pus:'ps',prs:'fa',div:'dv',bel:'be',bos:'bs',cnr:'sr',gle:'ga',cym:'cy',glg:'gl',eus:'eu',cat:'ca',mlt:'mt',mlg:'mg',fil:'tl',tgl:'tl'};
const preferred = { CHN:'zho',TWN:'zho',HKG:'zho',MAC:'zho',CAN:'eng',CHE:'deu',BEL:'nld',LUX:'fra',IND:'hin',PAK:'urd',AFG:'prs',SGP:'eng',ZAF:'eng',IRL:'eng',NZL:'eng',GBR:'eng',ESP:'spa',BIH:'bos',ISR:'heb',BTN:'dzo',LKA:'sin',FJI:'eng',PNG:'eng',NAM:'eng',MUS:'fra',HTI:'fra',TZA:'swa'};
const scriptByLang = { zh:/[\u3400-\u9fff]/u,ja:/[\u3040-\u30ff\u3400-\u9fff]/u,ko:/[\uac00-\ud7af]/u,ru:/[\u0400-\u04ff]/u,uk:/[\u0400-\u04ff]/u,bg:/[\u0400-\u04ff]/u,sr:/[\u0400-\u04ff]/u,mk:/[\u0400-\u04ff]/u,be:/[\u0400-\u04ff]/u,kk:/[\u0400-\u04ff]/u,ky:/[\u0400-\u04ff]/u,tg:/[\u0400-\u04ff]/u,mn:/[\u0400-\u04ff]/u,ar:/[\u0600-\u06ff]/u,fa:/[\u0600-\u06ff]/u,ur:/[\u0600-\u06ff]/u,ps:/[\u0600-\u06ff]/u,he:/[\u0590-\u05ff]/u,hi:/[\u0900-\u097f]/u,ne:/[\u0900-\u097f]/u,bn:/[\u0980-\u09ff]/u,ta:/[\u0b80-\u0bff]/u,te:/[\u0c00-\u0c7f]/u,th:/[\u0e00-\u0e7f]/u,lo:/[\u0e80-\u0eff]/u,my:/[\u1000-\u109f]/u,km:/[\u1780-\u17ff]/u,hy:/[\u0530-\u058f]/u,ka:/[\u10a0-\u10ff]/u,el:/[\u0370-\u03ff]/u,si:/[\u0d80-\u0dff]/u,am:/[\u1200-\u137f]/u };
function langFor(code) { const entry = nativeCountries.get(code); const three = preferred[code] || Object.keys(entry?.languages || {})[0] || 'eng'; return languageCodes[three] || three; }
function nativeName(p, code, fallback, upper = false) { const lang = langFor(code); const key = (upper ? 'NAME_' : 'name_') + lang; const direct = p[key]; const local = upper ? null : p.name_local?.split('|')[0]; return { native: direct || local || fallback, nativeStatus: direct || local || lang === 'en' ? 'source-language' : 'fallback', language: lang }; }
function cityName(a, code) {
  const lang = langFor(code), p = sampleCities.get(a[0]);
  const translated = p?.['NAME_' + lang.toUpperCase()];
  if (translated) return { native: translated, nativeStatus: 'source-language', language: lang };
  const script = scriptByLang[lang];
  if (script) { const local = [a[1], ...a[3].split(',')].find(s => script.test(s)); if (local) return { native: local, nativeStatus: 'local-script', language: lang }; return { native: a[1], nativeStatus: 'fallback', language: lang }; }
  return { native: a[1], nativeStatus: 'source-name', language: lang };
}
function signedArea(r) { let area = 0; for (let i=1;i<r.length;i++) area += r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1]; return area/2; }
function segmentDistance(p,a,b) { const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1))); return (p[0]-a[0]-t*x)**2+(p[1]-a[1]-t*y)**2; }
function rdp(points,tolerance) { if(points.length<3)return points; let far=0,idx=0; for(let i=1;i<points.length-1;i++){const dist=segmentDistance(points[i],points[0],points.at(-1));if(dist>far){far=dist;idx=i;}} if(far<=tolerance*tolerance)return [points[0],points.at(-1)]; return [...rdp(points.slice(0,idx+1),tolerance).slice(0,-1),...rdp(points.slice(idx),tolerance)]; }
function ringSimple(ring,tolerance) {
  if(ring.length<12)return ring.map(p=>p.map(v=>+v.toFixed(4)));
  const open=ring.slice(0,-1); let far=1; for(let i=2;i<open.length;i++)if((open[i][0]-open[0][0])**2+(open[i][1]-open[0][1])**2>(open[far][0]-open[0][0])**2+(open[far][1]-open[0][1])**2)far=i;
  const simple=[...rdp(open.slice(0,far+1),tolerance).slice(0,-1),...rdp([...open.slice(far),open[0]],tolerance)];
  const a=signedArea(ring),b=signedArea(simple);
  const selected=simple.length>=4&&Math.sign(a)===Math.sign(b)&&Math.abs(b)>=Math.abs(a)*.85 ? simple:ring;
  return selected.map(p=>p.map(v=>+v.toFixed(4)));
}
function polygonNormal(rings,tol) { let result=rings.map(r=>ringSimple(r,tol)); if(d3.geoArea({type:'Polygon',coordinates:result})>2*Math.PI) result=result.map(r=>[...r].reverse()); return result; }
function geometry(g,tol=.025) { if(!g)return null;return g.type==='Polygon'?{type:g.type,coordinates:polygonNormal(g.coordinates,tol)}:{type:'MultiPolygon',coordinates:g.coordinates.map(p=>polygonNormal(p,tol))}; }
const continentNames = { Africa:'أفريقيا',Antarctica:'Antarctica',Asia:'亚洲',Europe:'Europe','North America':'North America','South America':'América del Sur',Oceania:'Oceania' };
const countries = [], countryByCode = new Map(), isoToCode = new Map(), regions = new Map(), sourceDivisionById = new Map(), divisionByJoin = new Map(), ukLocalByJoin = new Map();
for(const feature of countryFeatures) {
  const p=feature.properties, code=p.ADM0_A3;
  const sourceNative=nativeCountries.get(code); const nat=sourceNative?.name.native; const three=preferred[code] || Object.keys(nat||{})[0];
  const oceanAffiliation={SYC:'Africa',SHN:'Africa',MUS:'Africa',MDV:'Asia',IOT:'Asia',ATF:'Antarctica',HMD:'Antarctica',BVT:'Antarctica',SGS:'Antarctica',CLP:'North America'};
  const continent=continentNames[p.CONTINENT]?p.CONTINENT:oceanAffiliation[code];
  if(!continent)throw new Error(`Unassigned continent for ${code}`);
  const iso2=p.ISO_A2?.length===2?p.ISO_A2:sourceNative?.cca2||p.ISO_A2_EH||'';
  const c={id:'country:'+code,code,iso2,name:sourceNative?.name.common||p.NAME||p.ADMIN,native:nat?.[three]?.common||p.NAME||p.ADMIN,continent,geometry:geometry(feature.geometry,.045),children:[],kind:p.TYPE==='Sovereign country'?'Country':'Country / territory',lng:+p.LABEL_X,lat:+p.LABEL_Y,language:langFor(code),nativeAvailable:!!nat||langFor(code)==='en',nativeStatus:nat||langFor(code)==='en'?'source-language':'fallback'};
  countries.push(c);countryByCode.set(code,c);if(c.iso2&&c.iso2!=='-99')isoToCode.set(c.iso2,code);regions.set(code,{divisions:[],places:[],locals:[]});
}
const ukNations={England:['ENG','England'],Scotland:['SCT','Alba'],Wales:['WLS','Cymru'],'Northern Ireland':['NIR','Northern Ireland']};
for(const [name,[code,native]] of Object.entries(ukNations)) {
  const features=divisionFeatures.filter(f=>f.properties.adm0_a3==='GBR'&&f.properties.geonunit===name);
  const polys=features.flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(p=>polygonNormal(p,.02));
  const geom={type:'MultiPolygon',coordinates:polys}; const centroid=d3.geoCentroid(geom);
  const node={id:`division:GBR:${code}`,parent:'country:GBR',name,native,kind:'Constituent country',geometry:geom,lng:centroid[0],lat:centroid[1],children:[],nativeStatus:'source-language',language:code==='WLS'?'cy':code==='SCT'?'gd':'en'};
  regions.get('GBR').divisions.push(node);countryByCode.get('GBR').children.push(node.id);divisionByJoin.set('GB.'+code,node);
  for(const feature of features) {
    const p=feature.properties;
    const local={id:'local:GBR:'+p.adm1_code,parent:node.id,name:p.name_en||p.name,...nativeName(p,'GBR',p.name),kind:code==='SCT'?'Council area':code==='WLS'?'Principal area':code==='NIR'?'Former district (source boundary)':'County / borough',geometry:geometry(feature.geometry,.016),lng:+p.longitude,lat:+p.latitude,children:[],sourceCode:p.gn_a1_code};
    regions.get('GBR').locals.push(local);node.children.push(local.id);
    if(p.gn_a1_code?.split('.')[1])ukLocalByJoin.set('GB.'+code+'.'+p.gn_a1_code.split('.')[1],local);
  }
}
// These ISO-coded dependencies are included inside their governing map units by
// Natural Earth admin0. Keep their settlement records without inventing countries.
for(const [iso,code] of Object.entries({YT:'FRA',RE:'FRA',GP:'FRA',MQ:'FRA',GF:'FRA',BQ:'NLD',TK:'NZL',SJ:'NOR',CC:'AUS',CX:'AUS'}))if(countryByCode.has(code))isoToCode.set(iso,code);
let excludedPseudoDivisions=0;
const usedDivisionIds=new Set();
for(const feature of divisionFeatures) {
  const p=feature.properties,code=p.adm0_a3,country=countryByCode.get(code);
  if(!country||code==='GBR')continue;
  if(code==='CHN'&&(p.iso_3166_2?.includes('~')||!p.type_en)){excludedPseudoDivisions++;continue;}
  let id='division:'+code+':'+(p.iso_3166_2&&p.iso_3166_2!=='-99'?p.iso_3166_2:p.adm1_code);if(usedDivisionIds.has(id))id+=':'+p.adm1_code;usedDivisionIds.add(id);const geom=geometry(feature.geometry,.022);
  const node={id,parent:country.id,name:p.name_en||p.name||'Unnamed division',...nativeName(p,code,p.name),kind:code==='DEU'?'Land':p.type_en||'Administrative division',geometry:geom,lng:+p.longitude,lat:+p.latitude,children:[],sourceCode:p.gn_a1_code||null};
  if(code==='CAN'&&p.iso_3166_2==='CA-QC'){node.native=p.name_fr||'Québec';node.language='fr';node.nativeStatus='source-language';}
  regions.get(code).divisions.push(node);country.children.push(id);sourceDivisionById.set(id,p);
  if(p.gn_a1_code&&p.gn_a1_code.split('.')[1])divisionByJoin.set(p.gn_a1_code,node);
}
// Genuine municipal district/county records: GeoNames uses aggregate ADM2 for these
// municipalities, then ADM3 for their districts. Skip its duplicate aggregate tier.
const municipalCodes=new Set(['22','23','28','33']); const municipalLocals=new Map();
const sourceMunicipalLocals=[];
const chinaText=unzipOne(chinaZip,'CN.txt');
for(const line of lines(chinaText)) {
  const a=line.split('\t');if(a[6]!=='A'||a[7]!=='ADM3'||!municipalCodes.has(a[10]))continue;
  const division=divisionByJoin.get('CN.'+a[10]);if(!division||!a[12])continue;
  const key=[a[8],a[10],a[11],a[12]].join('.');
  const node={id:'local:geonames:'+a[0],parent:division.id,name:a[2]||a[1],...cityName(a,'CHN'),kind:'District / county',lng:+a[5],lat:+a[4],children:[],sourceCode:key};
  sourceMunicipalLocals.push(node);
}
const municipalities=regions.get('CHN').divisions.filter(d=>d.kind==='Municipality');
const officialMunicipalNames=new Map(JSON.parse(chinaNamesBytes).filter(n=>['11','12','31','50'].includes(n.code)).map(n=>[({'11':'Beijing','12':'Tianjin','31':'Shanghai','50':'Chongqing'})[n.code],n.children.flatMap(g=>g.children)]));
const canonicalDistrict=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\b(county|district|city|new|area|autonomous|qu|xian)\b/g,'').replace(/[^a-z0-9]/g,'');
for(const feature of JSON.parse(countyBytes).features) {
  const geom=geometry(feature.geometry,.004),center=d3.geoCentroid(geom);
  const parent=municipalities.find(d=>d3.geoContains(d.geometry,center));if(!parent)continue;
  const name=feature.properties.shapeName;
  const peers=sourceMunicipalLocals.filter(d=>d.parent===parent.id);
  const canonical=canonicalDistrict(name);
  const source=peers.find(d=>canonicalDistrict(d.name)===canonical)||peers.find(d=>canonical.startsWith(canonicalDistrict(d.name).slice(0,Math.max(4,d.name.split(' ')[0].length))))||peers.find(d=>canonicalDistrict(d.name).startsWith(canonical.split(' ')[0]));
  // A neighboring Tangshan polygon in the old boundary source slightly crosses
  // the Tianjin outline. Require a matching genuine municipality source record.
  if(!source)continue;
  const aliases={'万县':'万州','梁山':'梁平','开县':'开州','壁山':'璧山','蓟县':'蓟州'};
  let nativeBase=aliases[source.native]||source.native;nativeBase=nativeBase.replace(/(区|县|镇)$/,'');
  const official=officialMunicipalNames.get(parent.name)?.find(n=>n.name.startsWith(nativeBase));
  const kind=official?/县$/.test(official.name)?'County':'District':/county/i.test(name)?'County':'District';
  let englishName=name;if(kind==='District')englishName=name.replace(/County$/,'District');if(name==='Ji County'&&official)englishName='Jizhou District';
  const node={id:'local:CHN:'+feature.properties.shapeID,parent:parent.id,name:englishName,native:official?.name||source.native,nativeStatus:official?'source-language':source.nativeStatus,language:'zh',kind,geometry:geom,lng:center[0],lat:center[1],children:[],sourceCode:official?.code||source.sourceCode};
  regions.get('CHN').locals.push(node);parent.children.push(node.id);if(source?.sourceCode)municipalLocals.set(source.sourceCode,node);
}
let unmatched=0,nativeFallbacks=0,settlementCount=0,omittedUnassignedSettlements=0;
const omittedByCountry={};
const cityText=unzipOne(cityZip,'cities500.txt');
const fallbackDivision=new Map();
for(const line of lines(cityText)) {
  const a=line.split('\t');if(a.length<19)continue;
  const code=isoToCode.get(a[8]);if(!code){unmatched++;continue;}
  const country=countryByCode.get(code),packet=regions.get(code),lng=+a[5],lat=+a[4];
  let parent=divisionByJoin.get(a[8]+'.'+a[10]);
  if(!parent&&packet.divisions.length) {
    const key=code+':'+a[10];
    if(fallbackDivision.has(key))parent=fallbackDivision.get(key);
    else { const candidates=packet.divisions; const matchName=admin1.get(a[8]+'.'+a[10])?.name.toLocaleLowerCase(); parent=candidates.find(d=>d.name.toLocaleLowerCase()===matchName);if(parent)fallbackDivision.set(key,parent); }
    if(!parent)parent=packet.divisions.find(d=>d3.geoContains(d.geometry,[lng,lat]));
  }
  if(code==='GBR'&&parent){const local=ukLocalByJoin.get('GB.'+a[10]+'.'+a[11])||packet.locals.find(d=>d.parent===parent.id&&d3.geoContains(d.geometry,[lng,lat]));if(local)parent=local;}
  if(code==='CHN'&&municipalCodes.has(a[10])) {
    const local=municipalLocals.get([a[8],a[10],a[11],a[12]].join('.'))||packet.locals.find(d=>d.parent===parent?.id&&d.geometry&&d3.geoContains(d.geometry,[lng,lat]));
    // Major municipality names denote the municipal whole, not another child city.
    if(['Beijing','Shanghai','Tianjin','Chongqing'].includes(a[2]))continue;
    if(local)parent=local;
    else {omittedUnassignedSettlements++;omittedByCountry[code]=(omittedByCountry[code]||0)+1;continue;}
  }
  if(packet.divisions.length&&!parent){omittedUnassignedSettlements++;omittedByCountry[code]=(omittedByCountry[code]||0)+1;continue;}
  const native=cityName(a,code);if(native.nativeStatus==='fallback')nativeFallbacks++;
  const population=+a[14]||0;
  const node={id:'place:'+a[0],parent:parent?.id||country.id,name:a[2]||a[1],...native,kind:a[7]==='PPLC'?'Capital city':'City / town',lng,lat,population,children:[],sourceFeature:a[7]};
  packet.places.push(node);(parent||country).children.push(node.id);settlementCount++;
}
// User's selected atlas convention: Hong Kong, Macao and Taiwan are navigated
// inside China. Preserve their genuine lower administrative structures.
const progressAliases={};const omittedChineseNameSettlements={};
const chinaCountry=countryByCode.get('CHN'),chinaPacket=regions.get('CHN');
const polygonParts=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
for(const [code,native,kind] of [['HKG','香港','Special administrative region'],['MAC','澳门','Special administrative region'],['TWN','台湾','Province']]) {
  const original=countryByCode.get(code),packet=regions.get(code);const id='division:CHN:'+code;
  const division={...original,id,parent:chinaCountry.id,name:code==='MAC'?'Macao':original.name,native,kind,language:'zh-Hans',nativeAvailable:true,nativeStatus:'source-language',legacyIds:[original.id],children:[...original.children]};
  delete division.continent;
  const convert=simplified[code==='TWN'?'tw':'hk'];
  for(const node of [...packet.divisions,...packet.locals,...packet.places]) {if(node.parent===original.id)node.parent=id;node.native=convert(node.native);node.language='zh-Hans';if(/[\u3400-\u9fff]/u.test(node.native)){node.nativeAvailable=true;node.nativeStatus='source-language';}}
  const omitted=packet.places.filter(n=>!/[\u3400-\u9fff]/u.test(n.native));const omittedIds=new Set(omitted.map(n=>n.id));
  omittedChineseNameSettlements[code]=omitted.length;
  for(const node of [division,...packet.divisions,...packet.locals])node.children=node.children.filter(child=>!omittedIds.has(child));
  chinaPacket.divisions.push(division);chinaPacket.locals.push(...packet.divisions,...packet.locals);chinaPacket.places.push(...packet.places.filter(n=>!omittedIds.has(n.id)));
  chinaCountry.children.push(id);chinaCountry.geometry={type:'MultiPolygon',coordinates:[...polygonParts(chinaCountry.geometry),...polygonParts(original.geometry)]};
  progressAliases[original.id]=id;regions.delete(code);countryByCode.delete(code);countries.splice(countries.indexOf(original),1);
  await fs.rm(path.join(dataDir,'regions',code+'.json'),{force:true});
}
// Normalize all China primary labels, including source translations that mix scripts.
for(const node of [chinaCountry,...chinaPacket.divisions,...chinaPacket.locals,...chinaPacket.places])if(/[\u3400-\u9fff]/u.test(node.native)){node.native=simplified.tw(node.native);node.language='zh-Hans';}
const taoyuan=chinaPacket.locals.find(n=>n.id==='division:TWN:TW-TAO');if(taoyuan)taoyuan.kind='Special Municipality';
settlementCount=[...regions.values()].reduce((sum,p)=>sum+p.places.length,0);
nativeFallbacks=[...regions.values()].reduce((sum,p)=>sum+p.places.filter(n=>n.nativeStatus==='fallback').length,0);
const allNodes=new Map(countries.map(c=>[c.id,c]));for(const packet of regions.values())for(const n of [...packet.divisions,...packet.locals,...packet.places]){n.nativeAvailable=n.nativeStatus!=='fallback';allNodes.set(n.id,n);}
// Never expose an empty district as if a comprehensive town inventory exists.
let localCount=0,divisionCount=0;
for(const [code,packet] of regions) {
  packet.coverage={divisions:packet.divisions.length,settlements:packet.places.length,localUnits:packet.locals.length,omittedUnassignedSettlements:omittedByCountry[code]||0,settlementCoverage:'GeoNames cities500: settlements over 500 people plus selected administrative seats; not every settlement.',nativeNames:'Native/source names where supplied; fallback names explicitly identified.',boundaryConvention:code==='CHN'?'34 province-level atlas divisions including Hong Kong, Macao and Taiwan, with simplified Mandarin labels. Municipality districts/counties use geoBoundaries / OpenStreetMap polygons representing 2017; a historical snapshot.':code==='GBR'?'4 constituent countries plus 232 source councils/counties. Natural Earth retains historical local boundaries, including the former 26 Northern Ireland districts; not a current local-government inventory.':'Generalized Natural Earth boundary snapshot; administrative changes may postdate the source.'};
  divisionCount+=packet.divisions.length;localCount+=packet.locals.length;
  await fs.writeFile(path.join(dataDir,'regions',code+'.json'),JSON.stringify(packet));
}
const continents=Object.entries(continentNames).map(([name,native])=>({id:'continent:'+name,name,native,kind:'Continent',children:countries.filter(c=>c.continent===name).map(c=>c.id)}));
const coverage={retrievedAt:new Date().toISOString(),countryMapUnits:countries.length,firstLevelDivisions:divisionCount,settlements:settlementCount,localUnits:localCount,nativeNameFallbacks:nativeFallbacks,unmatchedSettlements:unmatched,omittedUnassignedSettlements,omittedByCountry,excludedPseudoDivisions,continentConvention:'Seven continents; map units assigned once using Natural Earth CONTINENT. Ocean-island map units assigned by geographic affiliation. Territories are included and totals are map units, not a sovereign-state count.',boundaryConvention:'Natural Earth de facto cartographic map units; disputed borders do not imply endorsement.',settlementCoverage:'GeoNames cities500 population threshold and administrative seats. Records unassignable to an included division are omitted rather than mixed into division denominators. Counts describe records included here, not an exhaustive inventory of all cities/towns.',nativeNameCoverage:'Country/native-language names and local-script alternatives where supplied. English/romanized fallbacks are tagged. Native naming is incomplete; multilingual areas may have additional local names.',hierarchy:'Country-specific first level. UK uses four constituent countries and source council/county boundaries. China direct municipalities use genuine available district/county records; missing town inventories remain empty. City/town is a settlement class, not a universally uniform administrative rank.',sources:inputHashes};
coverage.progressAliases=progressAliases;coverage.omittedChineseNameSettlements=omittedChineseNameSettlements;coverage.chinaDivisionCount=34;
coverage.atlasGrouping='User-selected China atlas grouping: 23 provinces including Taiwan, 5 autonomous regions, 4 direct municipalities, 2 special administrative regions (Hong Kong and Macao). All included labels for Hong Kong, Macao and Taiwan use simplified Mandarin Chinese; settlement records lacking a sourced Chinese label are omitted.';
coverage.boundaryConvention='Natural Earth cartographic shapes with user-selected China atlas grouping of Hong Kong, Macao and Taiwan; administrative and disputed boundaries are geographic reference data.';
await fs.writeFile(path.join(dataDir,'world.json'),JSON.stringify({countries,continents,coverage,progressAliases}));
await fs.writeFile(path.join(dataDir,'coverage.json'),JSON.stringify(coverage,null,2));
for(const [code,count] of [['CHN',34],['CAN',13],['USA',51],['DEU',16],['GBR',4]])if(regions.get(code).divisions.length!==count||countryByCode.get(code).children.length!==count)throw new Error(`${code} count failed: ${regions.get(code).divisions.length} / ${countryByCode.get(code).children.length}`);
for(const node of allNodes.values())if(new Set(node.children).size!==node.children.length)throw new Error(`Duplicate children for ${node.id}`);
for(const [id,node] of allNodes) { if(node.parent&&!allNodes.has(node.parent))throw new Error(`Missing parent ${id}`);for(const child of node.children)if(!allNodes.has(child)||allNodes.get(child).parent!==id)throw new Error(`Invalid child ${id} -> ${child}`); }
await fs.writeFile(path.join(root,'DATA_SOURCES.md'),`# Worldwide geographic data\n\nPrepared ${coverage.retrievedAt}. Input SHA-256 digests and exact URLs are recorded in dist/data/coverage.json. Run \`node scripts/prepare-data.mjs\` to reproduce from the host cache; add \`--refresh\` to fetch new source snapshots. Raw source files stay in the operating-system temporary cache, outside the published bundle. Node 20+ is sufficient.\n\n## Sources and licenses\n\n- Natural Earth 1:10m Admin 0 Countries, Admin 1 States/Provinces, Populated Places: https://www.naturalearthdata.com/ . GeoJSON downloaded from the maintainers' nvkelso/natural-earth-vector repository. Public domain; multilingual name fields derive from Wikidata CC0. Terms: https://www.naturalearthdata.com/about/terms-of-use/ . Acknowledgement: Made with Natural Earth.\n- GeoNames cities500.zip, admin1CodesASCII.txt, admin2Codes.txt and CN.zip from https://download.geonames.org/export/dump/ . Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/ . Credit: GeoNames, https://www.geonames.org/ . Modified by selecting/combining records, choosing name alternatives, grouping under included divisions, and omitting duplicate municipality settlement records. Documentation: https://download.geonames.org/export/dump/readme.txt .\n- Native country names and language metadata: https://github.com/mledoze/countries . Open Database License 1.0 (ODbL): https://opendatacommons.org/licenses/odbl/1-0/ . Only country-name/language metadata are combined here; this derived database is offered under ODbL 1.0, retaining compatible source attribution.\n- China municipality district/county polygons: geoBoundaries CHN ADM3, boundaryID CHN-ADM3-62558664, year represented 2017, pinned repository commit 9469f09. Source: Lee Beryman and OpenStreetMap. Copyright OpenStreetMap contributors, https://www.openstreetmap.org/copyright . Open Database License 1.0. Credit geoBoundaries, https://www.geoboundaries.org/ . Metadata: https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM3/ . Source names are joined with GeoNames where possible; polygons are simplified and selected for the four direct municipalities.\n- Municipality district names/codes: modood Administrative-divisions-of-China, https://github.com/modood/Administrative-divisions-of-China , MIT license; compiled from National Bureau of Statistics 2023 administrative-division data. Used to reconcile Chinese names and district/county types for the 86 mapped units of Beijing, Shanghai, Tianjin and Chongqing; geometry remains the disclosed 2017 snapshot.\n- OpenCC-js 1.4.2: https://github.com/nk2028/opencc-js ; MIT code plus Apache-2.0 dictionary data. Used during preparation for full phrase/dictionary Traditional-to-Simplified Chinese conversion (Hong Kong and Taiwan locale converters), then all China labels normalized to simplified Chinese. License and third-party notices are retained in dist/vendor/LICENSE-opencc.txt and THIRD-PARTY-LICENSES-opencc.md.\n- D3 7.9.0: https://github.com/d3/d3 , ISC license copied into dist/vendor/LICENSE-d3.txt.\n\n## Actual coverage\n\n${countries.length} country/territory map units; ${divisionCount} first-level divisions; ${settlementCount} cities/towns; ${localCount} sourced local units (UK councils/counties and China municipality districts/counties). Canada: 13 provinces/territories. US: 50 states plus District of Columbia, 51 units. Germany: 16 Länder. UK: 4 constituent countries assembled from Natural Earth geonunit boundaries, with source local councils/counties retained beneath each nation, and settlement records assigned by codes or containment. Northern Ireland retains former 26-district source boundaries and is not a current local-government inventory.\n\nThis atlas uses the user-selected China grouping of 34 province-level units: 23 provinces including Taiwan, 5 autonomous regions, 4 direct municipalities and 2 special administrative regions (Hong Kong and Macao). The three source map-unit geometries are included in China and their genuine lower divisions are retained. Natural Earth's Paracel Islands pseudo-division is excluded from the division denominator. Hong Kong, Macao and Taiwan are grouped beneath China according to the requested atlas convention. Their labels are simplified Mandarin Chinese using OpenCC; source English names remain secondary search aids. Settlement records without any sourced Chinese label are omitted: ${JSON.stringify(omittedChineseNameSettlements)}. All lower administrative identities remain sourced. Beijing, Shanghai, Tianjin and Chongqing do not get an artificial duplicate child city. District/county polygons from geoBoundaries, derived from OpenStreetMap and representing 2017, are presented below their municipality. GeoNames names supply local-script alternatives where available. Settlement records are assigned by exact codes or polygon containment, skipping GeoNames' aggregate duplicate ADM2 tier. This is a historical boundary snapshot, not a current official administrative inventory. Empty town coverage is explicit rather than invented.\n\nGeoNames cities500 includes settlements over 500 people and selected administrative seats. It is not all cities/towns. City / town is a neutral settlement label; no uniform population threshold is used to invent official city status. Capital city comes from GeoNames PPLC source codes. Country-first-level->settlement browsing is a geographic shortcut and does not imply every country's legal hierarchy is identical. Only sourced extra local levels are provided.\n\nNatural Earth admin1 is a beta cartographic dataset, omits certain tiny countries, and may lag recent administrative reforms. Labels and counts describe this bundled snapshot. Natural Earth documentation: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/ . Native names use available regional-language translations, source names or local-script alternatives; ${nativeFallbacks} settlement records require tagged fallback names. Naming and multilingual coverage are not complete. English names remain available for navigation. Seven continent groups include territories; country totals should say countries & territories/map units rather than sovereign states.\n\n## Transformations\n\nCountry and subdivision coordinates are rounded to four decimals and generalized using conservative closed-ring Douglas-Peucker simplification, retaining tiny rings and rejecting simplification with changed orientation or more than 15% planar-area loss. Shared borders may have tiny generalization differences; no cadastral/measurement precision is implied. Polygon winding is determined by D3 spherical area, per polygon, rather than assumed from file convention, and normalized for D3 rendering/containment. Original source label points are retained. Admin1 assignment prefers exact GeoNames administrative-code joins, then matching administrative names, then geometric containment; unassigned settlements are omitted wherever a country has divisions, keeping first-level denominators pure. Countries without included divisions have settlement children directly. ${omittedUnassignedSettlements} unassigned settlement records were omitted; per-country counts are recorded in coverage.json. Native country-name metadata and source credits remain in this source repository.\n\nThe source snapshot is provided without warranty of accuracy, completeness or timeliness.\n`);
console.log(JSON.stringify({status:'PASS',countries:countries.length,divisions:divisionCount,settlements:settlementCount,localUnits:localCount,nativeFallbacks,unmatched,divisionCounts:Object.fromEntries(['CHN','CAN','USA','DEU','GBR'].map(code=>[code,regions.get(code).divisions.length]))},null,2));

await fs.appendFile(path.join(root,"DATA_SOURCES.md"),"\nTaiwan has 21 mapped local divisions in this Natural Earth snapshot; Lienchiang is not included in that boundary layer. Taoyuan is identified as a Special Municipality, correcting the older source type following its 2014 upgrade: https://english.ey.gov.tw/Page/61BF20C3E89B856/82a96894-3e47-4e47-9dc7-cc4d9a58895d . Counts remain counts of included map records.\n");
