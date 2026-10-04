// 千斩的 service worker：先拿缓存打开（第二次秒开、断网也能玩），同时在后台取新版；
// 新版内容和缓存里的不一样（按内容的 SHA-256 比，不看 ETag：每次部署文件时间都会变）就存下来，告诉页面刷新一下
const CACHE = 'senzan-v4', ASSETS = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...['drive', 'boss'].map(k => `music/${k}.mp3`)], LATER = ['stealth', 'final', 'ending']; // 通用五首里只先装 drive、boss；另外三首页面过一会儿才取，取的时候顺手缓存（下面 fixed 那段）；music/more/ 下每章自己的曲子放过才缓存
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})); // 第一次装上就缓存好，不用等第二次打开
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); // 旧版本的缓存清掉
  await self.clients.claim();
})()));
const hashOf = async r => { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())); return [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join(''); };
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 外站请求照常走网络
  const scope = new URL(self.registration.scope).pathname, page = req.mode === 'navigate';
  if (page && url.pathname !== scope && url.pathname !== scope + 'index.html') return; // 只接管游戏页本身，直接打开 og.jpg、README 这些照常
  const fixed = url.pathname.includes('/music/'); // 音乐文件不会改（要改就换名字）：有缓存就直接用，不再回源
  if (!page && !fixed && !ASSETS.some(a => new URL(a, self.registration.scope).pathname === url.pathname)) return;
  const key = page ? './' : req;
  e.respondWith((async () => {
    let c = null, hit = null;
    try { c = await caches.open(CACHE); hit = await c.match(key); } catch (err) {} // 存储被禁用之类：当没缓存
    if (hit && fixed) return hit;
    const was = page && hit ? hit.clone() : null; // 下面要拿旧的那份算哈希：先复制一份，原件要交给页面
    const fresh = fetch(page ? './' : req, { cache: 'no-cache' }).then(async r => {
      if (r.ok && c) try {
        if (page) {
          const h = await hashOf(r.clone()), old = await c.match('__hash').then(x => x && x.text()).catch(() => null) || (was ? await hashOf(was) : null); // 装上时缓存的那份还没记哈希：拿它自己算
          await c.put(key, r.clone()); await c.put('__hash', new Response(h));
          if (hit && old && old !== h) for (const cl of await self.clients.matchAll()) cl.postMessage('updated');
        } else await c.put(key, r.clone());
      } catch (err) {} // 写缓存失败不影响这次的网络响应
      return r;
    });
    if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
    try { return await fresh; } catch (err) { return Response.error(); }
  })());
});
