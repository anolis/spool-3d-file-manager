const providers = [
  { id: 'thingiverse', name: 'Thingiverse', env: 'THINGIVERSE_TOKEN', color: '#2379da', search: 'https://www.thingiverse.com/search?q=' },
  { id: 'myminifactory', name: 'MyMiniFactory', env: 'MYMINIFACTORY_KEY', color: '#de7448', search: 'https://www.myminifactory.com/search/?query=' },
  { id: 'printables', name: 'Printables', color: '#f07842', search: 'https://www.printables.com/search/models?q=' },
  { id: 'makerworld', name: 'MakerWorld', color: '#30a56b', search: 'https://makerworld.com/en/search/models?keyword=' },
  { id: 'cults3d', name: 'Cults3D', color: '#9368d3', search: 'https://cults3d.com/en/search?q=' },
];
export function providerStatus() { return providers.map(({ env, ...provider }) => ({ ...provider, connected: !!(env && process.env[env]), env })); }
async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}. Check your connection and API key.`);
  return response.json();
}
export async function searchProviders(query, selected) {
  const connected = providers.filter(p => p.env && process.env[p.env] && (!selected || selected === 'all' || p.id === selected));
  const results = await Promise.all(connected.map(async provider => {
    try {
      if (provider.id === 'thingiverse') {
        const data = await fetchJson(`https://api.thingiverse.com/search/${encodeURIComponent(query)}?type=things&per_page=24`, { Authorization: `Bearer ${process.env.THINGIVERSE_TOKEN}` });
        return { provider: provider.id, items: (data.hits || data).map(i => ({ id: `thingiverse:${i.id}`, title: i.name, creator: i.creator?.name || '', image: i.thumbnail || i.preview_image, source: i.public_url || `https://www.thingiverse.com/thing:${i.id}`, provider: provider.id })) };
      }
      const data = await fetchJson(`https://www.myminifactory.com/api/v2/search?q=${encodeURIComponent(query)}&per_page=24&key=${encodeURIComponent(process.env.MYMINIFACTORY_KEY)}`);
      return { provider: provider.id, items: (data.items || []).map(i => ({ id: `myminifactory:${i.id}`, title: i.name, creator: i.designer?.name || '', image: i.images?.[0]?.thumbnail?.url || i.images?.[0]?.original?.url, source: i.url, provider: provider.id })) };
    } catch (error) { return { provider: provider.id, items: [], error: error.message }; }
  }));
  // Interleave providers so one large result set does not bury other sites.
  const items = [];
  for (let i = 0; i < Math.max(0, ...results.map(r => r.items.length)); i++) for (const result of results) if (result.items[i]) items.push(result.items[i]);
  return { items, errors: results.filter(r => r.error).map(({ provider, error }) => ({ provider, error })), connected: connected.length };
}
