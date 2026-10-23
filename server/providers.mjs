export const providers = [
  { id:'printables', name:'Printables', color:'#f07842', mode:'live' },
  { id:'thingiverse', name:'Thingiverse', color:'#2379da', env:'THINGIVERSE_TOKEN', mode:'index' },
  { id:'makerworld', name:'MakerWorld', color:'#30a56b', mode:'index' },
  { id:'myminifactory', name:'MyMiniFactory', color:'#de7448', env:'MYMINIFACTORY_KEY', mode:'index' },
  { id:'cults3d', name:'Cults3D', color:'#9368d3', mode:'index' },
];
export function providerStatus(env = process.env) { return providers.map(p => ({ ...p, connected:true, mode:p.env && env[p.env] ? 'live' : p.mode })); }
const cache = new Map();
const printablesQuery = 'query SpoolSearch($query:String!,$limit:Int,$offset:Int){searchPrints2(query:$query,limit:$limit,offset:$offset,ordering:best_match){items{id name slug user{publicUsername} image{filePath}} totalCount}}';
export function printablesThumbnail(filePath) {
  if (!filePath) return undefined;
  const match = filePath.match(/^(.*)\/([^/]+)\.([a-z0-9]+)$/i);
  return match ? new URL(`${match[1]}/thumbs/inside/640x480/${match[3]}/${match[2]}.webp`, 'https://media.printables.com/').href : new URL(filePath,'https://media.printables.com/').href;
}
function httpUrl(value) { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
function decodeXml(value = '') {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    const names = { amp:'&', quot:'"', apos:"'", lt:'<', gt:'>' };
    if (names[entity]) return names[entity];
    const point = entity.startsWith('#x') ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
export function modelSource(value) {
  const safe = httpUrl(value); if (!safe) return;
  const url = new URL(safe), host = url.hostname.replace(/^www\./,'');
  let provider, id;
  if (host === 'printables.com') { id = url.pathname.match(/^\/model\/(\d+)/)?.[1]; provider='printables'; }
  if (host === 'thingiverse.com') { id = url.pathname.match(/^\/thing:(\d+)/)?.[1]; provider='thingiverse'; }
  if (host === 'makerworld.com') { id = url.pathname.match(/^\/[a-z-]+\/models\/(\d+)/)?.[1]; provider='makerworld'; }
  if (host === 'myminifactory.com') { id = url.pathname.match(/^\/object\/(?:3d-print-)?([^/]+)/)?.[1]; provider='myminifactory'; }
  if (host === 'cults3d.com') { id = url.pathname.match(/^\/[a-z]+\/3d-model\/([^?#]+)/)?.[1]; provider='cults3d'; }
  if (!id) return;
  // Drop duplicate files/comments tabs while retaining the model's canonical path.
  if (provider === 'printables') url.pathname = url.pathname.split('/').slice(0,3).join('/');
  if (provider === 'thingiverse') url.pathname = '/thing:'+id;
  if (provider === 'makerworld') url.pathname = url.pathname.split('/').slice(0,4).join('/');
  url.search=''; url.hash='';
  return { id:`${provider}:${id}`, provider, source:url.href };
}
export function parseIndexedModels(xml) {
  const items = new Map();
  for (const [, content] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const value = key => decodeXml(content.match(new RegExp(`<${key}>([\\s\\S]*?)<\\/${key}>`))?.[1] || '');
    const source = modelSource(value('link')); if (!source || items.has(source.id)) continue;
    items.set(source.id,{...source,title:value('title').replace(/<[^>]*>/g,'').slice(0,500),creator:'',summary:value('description').replace(/<[^>]*>/g,'').slice(0,350),searchMode:'index'});
  }
  return [...items.values()];
}
export async function searchProviders(query, selected = 'all', { fetchImpl = fetch, env = process.env, offset = 0, useCache = true } = {}) {
  query = String(query).trim().slice(0,200);
  if (!query) return { items:[], errors:[], sources:[], total:0 };
  const key = `${query.toLowerCase()}:${selected}:${offset}:${!!env.THINGIVERSE_TOKEN}:${!!env.MYMINIFACTORY_KEY}`;
  const cached = cache.get(key);
  if (useCache && cached && Date.now()-cached.at < 5*60*1000) return cached.result;
  const chosen = providerStatus(env).filter(p => selected === 'all' || p.id === selected);
  if (!chosen.length) throw new Error('Unknown search source.');
  async function response(url, options = {}) {
    const result = await fetchImpl(url,{...options,signal:AbortSignal.timeout(18000)});
    if (!result.ok) throw new Error(result.status === 403 ? 'The source blocked this request.' : `Search returned HTTP ${result.status}.`);
    if (Number(result.headers.get('content-length')) > 5*1024*1024) throw new Error('Search response was too large.');
    return result;
  }
  const errors = [], sources = [];
  const indexedProviders = chosen.filter(p=>p.mode==='index');
  const batches = await Promise.all(chosen.filter(p=>p.mode==='live').map(async provider => {
    try {
      let items, total;
      if (provider.id === 'printables') {
        const data = await (await response('https://api.printables.com/graphql/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:printablesQuery,variables:{query,limit:24,offset}})})).json();
        if (data.errors?.length) throw new Error('Printables search changed or is temporarily unavailable.');
        if (!Array.isArray(data.data?.searchPrints2?.items)) throw new Error('Unexpected Printables response.');
        items = data.data.searchPrints2.items.map(i=>({id:`printables:${i.id}`,title:i.name,creator:i.user?.publicUsername||'',image:printablesThumbnail(i.image?.filePath),originalImage:i.image?.filePath ? new URL(i.image.filePath,'https://media.printables.com/').href : undefined,source:`https://www.printables.com/model/${i.id}-${i.slug}`,provider:provider.id,searchMode:'live'}));
        total = data.data.searchPrints2.totalCount;
      } else if (provider.id === 'thingiverse') {
        const data = await (await response(`https://api.thingiverse.com/search/${encodeURIComponent(query)}?type=things&per_page=24&page=${Math.floor(offset/24)+1}`,{headers:{Authorization:`Bearer ${env.THINGIVERSE_TOKEN}`}})).json();
        const hits = data.hits || data;
        if (!Array.isArray(hits)) throw new Error('Unexpected Thingiverse response.');
        items = hits.map(i=>({id:`thingiverse:${i.id}`,title:i.name,creator:i.creator?.name||'',image:httpUrl(i.thumbnail||i.preview_image),source:`https://www.thingiverse.com/thing:${i.id}`,provider:provider.id,searchMode:'live'})); total = data.total;
      } else {
        const data = await (await response(`https://www.myminifactory.com/api/v2/search?q=${encodeURIComponent(query)}&per_page=24&page=${Math.floor(offset/24)+1}&key=${encodeURIComponent(env.MYMINIFACTORY_KEY)}`)).json();
        items = (data.items||[]).map(i=>({id:`myminifactory:${i.id}`,title:i.name,creator:i.designer?.name||'',image:httpUrl(i.images?.[0]?.thumbnail?.url||i.images?.[0]?.original?.url),source:httpUrl(i.url)||`https://www.myminifactory.com/object/3d-print-${i.id}`,provider:provider.id,searchMode:'live'})); total=data.total_count;
      }
      sources.push({provider:provider.id,mode:'live',count:items.length,total}); return items;
    } catch(error) {
      errors.push({provider:provider.id,error:error.message+' Showing indexed results when available.'});
      indexedProviders.push(provider); return [];
    }
  }));
  if (indexedProviders.length) {
    try {
      // The RSS feed provides actual indexed result items, rendered here with attribution.
      // We validate canonical model URLs because engines can ignore site operators.
      const constraint = selected === 'all' ? '3d print model' : `${chosen[0].name} 3d model`;
      const url = 'https://www.bing.com/search?format=rss&count=50&first='+String(offset+1)+'&q='+encodeURIComponent(`${query} ${constraint}`);
      const result = await response(url);
      const xml = await result.text(); if (!xml.includes('<rss')) throw new Error('The search index did not return a result feed.');
      const indexItems = parseIndexedModels(xml);
      for (const provider of indexedProviders) {
        const items = indexItems.filter(i=>i.provider===provider.id);
        sources.push({provider:provider.id,mode:'index',count:items.length}); batches.push(items);
      }
    } catch(error) { for (const provider of indexedProviders) errors.push({provider:provider.id,error:error.message}); }
  }
  const seen = new Set(), items = [];
  for (let i=0;i<Math.max(0,...batches.map(b=>b.length));i++) for (const batch of batches) {
    const item = batch[i]; if (item && !seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }
  const result = {items,errors,sources,total:items.length,offset,hasMore:sources.some(s=>s.mode==='live' && s.total>offset+24),indexedAttribution:sources.some(s=>s.mode==='index') ? {name:'Bing',url:'https://www.bing.com/search?q='+encodeURIComponent(query+' 3d print model')} : undefined};
  if (useCache) { if (cache.size>=100) cache.delete(cache.keys().next().value); cache.set(key,{at:Date.now(),result}); }
  return result;
}
