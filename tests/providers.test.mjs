import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProviders, parseIndexedModels, modelSource, printablesThumbnail } from '../server/providers.mjs';
const rss = '<rss><channel><item><title>Test &amp; model</title><link>https://www.thingiverse.com/thing:123</link><description>Indexed description</description></item><item><title>Duplicate</title><link>https://www.thingiverse.com/thing:123/comments</link></item><item><title>Makerworld model</title><link>https://makerworld.com/en/models/456-widget</link></item><item><title>Unrelated</title><link>https://evil.example/thingiverse.com/thing:1</link></item></channel></rss>';
const json = data => new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('combined search returns live catalog items plus validated indexed models, interleaved and deduplicated',async()=>{
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push(url);
  if(url.includes('printables.com/graphql')) {assert.equal(JSON.parse(options.body).variables.query,'benchy');return json({data:{searchPrints2:{items:[{id:'1',name:'Live model',slug:'live-model',user:{publicUsername:'Maker'},image:{filePath:'media/test.jpg'}}],totalCount:30}}});}
  return new Response(rss);
 };
 const result=await searchProviders('benchy','all',{fetchImpl,env:{},useCache:false});
 assert.equal(result.items.length,3);assert.equal(result.items[0].searchMode,'live');
 assert.equal(result.items[1].provider,'thingiverse'); assert.equal(result.items[2].provider,'makerworld');
 assert.equal(result.items[1].title,'Test & model'); assert.equal(result.errors.length,0);assert.equal(result.hasMore,true);
 assert.equal(requests.length,2); assert.equal(result.indexedAttribution.name,'Bing');
});
test('source filter returns actual matching items instead of search-page links',async()=>{
 const result=await searchProviders('benchy','makerworld',{fetchImpl:async()=>new Response(rss),env:{},useCache:false});
 assert.equal(result.items.length,1);assert.equal(result.items[0].source,'https://makerworld.com/en/models/456-widget');
});
test('failed live providers retain working indexed results and report their error',async()=>{
 const result=await searchProviders('benchy','all',{fetchImpl:async url=>url.includes('graphql')?new Response('Blocked',{status:503}):new Response(rss),env:{},useCache:false});
 assert.equal(result.items.length,2);assert.equal(result.errors[0].provider,'printables');
});
test('indexed parsing rejects non-model links, unsafe URLs and spoofed domains',()=>{
 assert.equal(parseIndexedModels(rss).length,2);
 assert.equal(modelSource('javascript:alert(1)'),undefined);
 assert.equal(modelSource('https://thingiverse.com.evil.example/thing:123'),undefined);
 assert.equal(modelSource('https://www.printables.com/search/models?q=benchy'),undefined);
});

test('Printables search uses lightweight thumbnail paths',()=>{ assert.equal(printablesThumbnail('media/prints/1/images/a/benchy.jpg'),'https://media.printables.com/media/prints/1/images/a/thumbs/inside/640x480/jpg/benchy.webp'); });
