function jsonResponse(obj, status, extraHeaders) {
  // no-store, on every API reply without exception. The _headers file cannot do this because it
  // only covers static assets, not anything the Worker generates - and an API response sitting
  // in an edge cache is how one reader's gate token, prices or database rows get handed to the
  // next person who asks the same URL. Found the hard way: a stale /api/tcgsearch reply was
  // served from cache for minutes after a deploy.
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                           extraHeaders || {})
  });
}

const SB_CORS = {}; // Same-origin standalone application.
const SB_EMBED_HOSTS = ['tcgplayer.com', 'ebay.com', 'google.com', 'pricecharting.com', 'pokemontcg.io'];
async function sbHandleEmbedCheck(request, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: SB_CORS });
  const target = url.searchParams.get('url') || '';
  let t; try { t = new URL(target); } catch (_) { return jsonResponse({ error: 'bad url' }, 400, SB_CORS); }
  if (t.protocol !== 'https:') return jsonResponse({ error: 'https only' }, 400, SB_CORS);
  const host = t.hostname.replace(/^www\./, '');
  if (!SB_EMBED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return jsonResponse({ error: 'host not allowed' }, 400, SB_CORS);
  try {
    const res = await marketFetch(t.toString(), { redirect: 'follow', headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
    const xfo = res.headers.get('x-frame-options') || '';
    const csp = res.headers.get('content-security-policy') || '';
    const fa = (csp.match(/frame-ancestors[^;]*/i) || [''])[0];
    let body = ''; try { body = (await res.text()).slice(0, 20000); } catch (_) {}
    const bot = /captcha|are you a human|pardon our interruption|access denied|unusual traffic|verify you are/i.test(body);
    const framable = !xfo && !(fa && !/\*/.test(fa));
    return jsonResponse({ url: t.toString(), status: res.status, finalUrl: res.url || t.toString(),
      xFrameOptions: xfo || null, frameAncestors: fa || null, botWall: bot, framable: framable && res.status < 400 && !bot,
      verdict: xfo ? ('blocked by X-Frame-Options: ' + xfo)
             : (fa ? ('restricted by CSP ' + fa) : (bot ? 'server answered with a bot/CAPTCHA wall' : (res.status >= 400 ? ('server refused: HTTP ' + res.status) : 'no framing header seen')))
    }, 200, SB_CORS);
  } catch (err) { return jsonResponse({ error: String(err && err.message || err), verdict: 'request failed from the server' }, 200, SB_CORS); }
}

const ALT_MAX = 80;
const TCG_HEAD = {
  'Content-Type': 'application/json',
  'Origin': 'https://www.tcgplayer.com',
  'Referer': 'https://www.tcgplayer.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};
// `lines` picks which TCGplayer product lines to search. Default is English only, because that
// is what Price Lookup has always returned and widening it silently would change that tool's
// results. Card Inventory opts in to Japanese as well and labels each hit.
async function tcgSearch(query, lines, page) {
  const url = 'https://mp-search-api.tcgplayer.com/v1/search/request?q=' + encodeURIComponent(query) + '&isList=false';
  // Two lines need a wider window: TCGplayer ranks the English printings above the Japanese
  // ones, so at size 24 the JP cards never surface at all.
  const many = !!(lines && lines.length > 1);
  // 48 is the ceiling their API accepts; 60 comes back non-200.
  const body = { algorithm: 'sales_dismax', from: (page || 0) * (many ? 48 : 24), size: many ? 48 : 24,
    filters: { term: { productLineName: (lines && lines.length) ? lines : ['pokemon'] }, range: {}, match: {} },
    listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: 'Live', channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
    context: { cart: {}, shippingCountry: 'US' }, settings: { useFuzzySearch: true, didYouMean: {} } };
  const r = await marketFetch(url, { method: 'POST', headers: TCG_HEAD, body: JSON.stringify(body) });
  if (r.status !== 200) return null;
  const j = await r.json();
  return ((j.results || [])[0] || {}).results || [];
}
/* Single card or sealed product. Their catalogue carries both and the obvious fields are no
   help: every result comes back with sealed:false and productTypeId:0, boxes included — checked
   against booster boxes, elite trainer boxes and cases in both product lines.

   What does separate them is the card number. Every single has one; no box, bundle or case does.
   Rarity agrees but is weaker: some Japanese promos carry no rarity, and Japanese sealed carries
   the literal string "None". */
function tcgKind(p){
  const num = String((p.customAttributes && p.customAttributes.number) || '').trim();
  return num ? 'single' : 'sealed';
}
// Metadata for a known productId. Needed because /api/tcg?productId=... used to return
// product:null — the name, set code and number were only ever filled in on the name-search
// path, so anything that arrived with an id already (a pick from the suggestion list, a pasted
// URL) came back nameless. There is no public product-detail endpoint that answers; filtering
// the search API by productId is what works.
async function tcgProductById(productId) {
  const url = 'https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false';
  const body = { algorithm: 'sales_dismax', from: 0, size: 1,
    filters: { term: { productId: [String(productId)] }, range: {}, match: {} },
    context: { cart: {}, shippingCountry: 'US' }, settings: { useFuzzySearch: false, didYouMean: {} } };
  try {
    const r = await marketFetch(url, { method: 'POST', headers: TCG_HEAD, body: JSON.stringify(body) });
    if (r.status !== 200) return null;
    const j = await r.json();
    return (((j.results || [])[0] || {}).results || [])[0] || null;
  } catch (_) { return null; }
}
async function tcgListings(productId, conditions) {
  const url = 'https://mp-search-api.tcgplayer.com/v1/product/' + encodeURIComponent(productId) + '/listings';
  const term = { sellerStatus: 'Live', channelId: 0, language: ['English'] };
  if (conditions && conditions.length) term.condition = conditions;
  const body = { filters: { term, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } },
    from: 0, size: 25, sort: { field: 'price+shipping', order: 'asc' },
    context: { shippingCountry: 'US', cart: {} }, aggregations: ['listingType'] };
  const r = await marketFetch(url, { method: 'POST', headers: TCG_HEAD, body: JSON.stringify(body) });
  if (r.status !== 200) return null;
  const j = await r.json();
  return (j.results || [])[0] || null;
}
// The "View More Data" sales history, straight from the endpoint that panel uses.
async function tcgSales(productId, conditions) {
  const url = 'https://mpapi.tcgplayer.com/v2/product/' + encodeURIComponent(productId) + '/latestsales';
  const body = { conditions: [], languages: [], variants: [], listingType: 'All', offset: 0, limit: 25 };
  const r = await marketFetch(url, { method: 'POST', headers: TCG_HEAD, body: JSON.stringify(body) });
  if (r.status !== 200) return [];
  const j = await r.json();
  let rows = (j.data || []).map(s => {
    const price = +s.purchasePrice || 0, ship = +s.shippingPrice || 0;
    return { price, ship, total: +(price + ship).toFixed(2), qty: s.quantity || 1,
             condition: [s.condition, s.variant].filter(Boolean).join(' '),
             date: String(s.orderDate || '').slice(0, 10) };
  });
  // One condition narrows the sales to it; several means "show me the mix", so leave them alone.
  if (conditions && conditions.length === 1) {
    const want = conditions[0].toLowerCase();
    const hit = rows.filter(r2 => r2.condition.toLowerCase().indexOf(want) === 0);
    if (hit.length) rows = hit;
  }
  return rows;
}
// Search only — the printings that match a phrase, each with its product id.
//
// This exists because a cross-origin iframe will never tell us which card the reader navigated
// to; that is blocked by the browser and no amount of listening to load events changes it. Doing
// the search on our side sidesteps the problem entirely: we get the id directly, so choosing a
// printing is one click rather than copying an address out of a frame.
async function sbHandleTcgSearch(request, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: SB_CORS });
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return jsonResponse({ error: 'give a search term' }, 400, SB_CORS);
  // ?jp=1 widens the search to the Japanese product line as well. Off by default so Price
  // Lookup keeps returning exactly what it always has.
  const wantJp = url.searchParams.get('jp') === '1';
  const lines = wantJp ? ['pokemon', 'pokemon-japan'] : ['pokemon'];
  try {
    // Asking for both lines in one request does not work: TCGplayer ranks every English
    // printing above every Japanese one, so the JP cards never reach the cut however wide the
    // window. Two searches, merged, is the only way to see both.
    /* "Pikachu" has hundreds of printings and one page of twenty is a thin slice of them, so a
       caller that means to compare pictures can ask for more. Capped at three: past that the
       wait costs more than the extra candidates are worth. */
    const pages = Math.max(1, Math.min(3, parseInt(url.searchParams.get('pages') || '1', 10) || 1));
    const many = async (ls) => {
      const got = await Promise.all(Array.from({ length: pages }, (_, i) => tcgSearch(q, ls, i)));
      return got.some(x => x) ? got.reduce((a, x) => a.concat(x || []), []) : null;
    };
    let hits;
    if (wantJp) {
      const [en, jp] = await Promise.all([many(['pokemon']), many(['pokemon-japan'])]);
      if (!en && !jp) return jsonResponse({ error: 'TCGplayer search did not respond' }, 502, SB_CORS);
      hits = (en || []).concat(jp || []);
    } else {
      hits = await many(lines);
    }
    // Paging can hand the same product back twice; the picture ranking should not see it twice.
    if (hits) {
      const seen = new Set();
      hits = hits.filter(h => {
        const k = String(h.productId || '');
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });
    }
    if (!hits) return jsonResponse({ error: 'TCGplayer search did not respond' }, 502, SB_CORS);

    // TCGplayer's fuzzy search answers "Gastly 58/102" with Latios EX and Sabrina's Haunter,
    // because 58 matched their numbers. A preview list holding cards that are not the card you
    // asked for is worse than a short list - it invites picking the wrong one. So hits whose
    // name does not lead with the searched name are dropped. If that leaves nothing the
    // unfiltered list comes back, because an empty panel helps nobody.
    const nrm = v => String(v || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const qName = nrm(q).replace(/\b\d[\d ]*\b.*$/, '').trim();   // the number and all after it goes
    const lead = qName.split(' ')[0] || '';
    // Whole first word only: "Mew" must not pull in "Mewtwo".
    const named = lead ? hits.filter(h => (nrm(h.productName).split(' ')[0] || '') === lead) : hits;
    // Most popular first. TCGplayer's own relevance ordering puts sealed tins and premium
    // collections above the card, which is never what someone holding a card wants. The count
    // of live listings is the honest proxy for how heavily a printing is traded.
    const use = (named.length ? named : hits)
      .slice()
      .sort((a, b) => (b.totalListings || 0) - (a.totalListings || 0));
    return jsonResponse({ ok: true, count: use.length,
      dropped: named.length ? hits.length - named.length : 0,
      loose: !named.length && !!lead,
      results: use.slice(0, pages > 1 ? 120 : (lines.length > 1 ? 40 : 20)).map(p => ({
      productId: p.productId,
      name: p.productName,
      set: p.setName,
      setCode: p.setCode || '',
      listings: p.totalListings || 0,
      number: (p.customAttributes && p.customAttributes.number) || '',
      rarity: (p.customAttributes && p.customAttributes.rarityName) || '',
      // Among two hundred Pikachus, the printed HP is one of the few things that differs.
      hp: (p.customAttributes && p.customAttributes.hp) || '',
      kind: tcgKind(p),
      market: p.marketPrice != null ? p.marketPrice : null,
      // TCGplayer keeps Japanese cards in their own product line, so the line name is the
      // language — no guessing from set names needed.
      lang: /japan/i.test(String(p.productLineName || p.productLineUrlName || '')) ? 'JP' : 'EN',
      image: 'https://tcgplayer-cdn.tcgplayer.com/product/' + p.productId + '_in_200x200.jpg',
      url: 'https://www.tcgplayer.com/product/' + p.productId
    })) }, 200, SB_CORS);
  } catch (err) { return jsonResponse({ error: String(err && err.message || err) }, 502, SB_CORS); }
}

async function sbHandleTcg(request, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: SB_CORS });
  const name = (url.searchParams.get('name') || '').trim();
  const number = (url.searchParams.get('number') || '').trim();
  const setCode = (url.searchParams.get('set') || '').trim().slice(0, 28);
  let productId = (url.searchParams.get('productId') || '').trim();
  const conditions = (url.searchParams.get('conditions') || '').split('|').map(s => s.trim()).filter(Boolean);
  if (!name && !productId) return jsonResponse({ error: 'give a card name' }, 400, SB_CORS);
  try {
    let product = null, alts = [], nameMismatch = false;
    if (!productId) {
      // The name has to actually match. Taking the first hit regardless is how a search for
      // "Piplup 58/102" came back priced as "Prinplup 58/130" - a different Pokemon entirely,
      // reported with no hint that anything was wrong. A wrong price presented confidently is
      // worse than no price, so a name that does not match is refused rather than used.
      const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const wantName = norm(name);
      const firstWord = wantName.split(' ')[0] || '';
      // Whole words only. A substring test matched "Eevee" against "Eeveelution" and "Mew"
      // against "Mewtwo"; the searched name has to be a word-for-word prefix of the product's.
      /* The searched words, in order, as whole words — anywhere in the name rather than only at
         the front. Pokemon names carry their form as a prefix: every Ogerpon card is called
         "Teal Mask Ogerpon" or "Cornerstone Mask Ogerpon", and none of them begins with the word
         somebody typed. Insisting on the front dropped all of them.

         It is still far tighter than fuzzy matching: "Gastly 58/102" cannot match Latios,
         because Latios does not contain the word gastly anywhere. */
      const sameName = p => {
        const got = norm(p.productName);
        if (!wantName || !got) return false;
        const w = wantName.split(' ').filter(Boolean), g = got.split(' ');
        if (!w.length) return false;
        for (let at = 0; at + w.length <= g.length; at++) {
          let all = true;
          for (let i = 0; i < w.length; i++) if (g[at + i] !== w[i]) { all = false; break; }
          if (all) return true;
        }
        return false;
      };

      // Most specific query first, stopping as soon as one returns the right card. A set code
      // narrows hard when it is right - "Gastly TEF" gives exactly the two Temporal Forces
      // printings - but returns unrelated cards when it is wrong, as "Charizard MEG" does,
      // because MEG is not a set code TCGplayer knows. So it is never the only attempt.
      const tries = [];
      if (setCode) tries.push(name + ' ' + setCode);
      if (number)  tries.push(name + ' ' + number);
      tries.push(name);

      let hits = [], named = [];
      /* Which product lines to search. TCGplayer keeps Japanese Pokemon in a line of its own, so
         a search that does not name it cannot return one — which is why the price lookup never
         found a Japanese card. Asking for one side only is worth having: a card printed in both
         comes back twice otherwise, and half of it is not what was wanted. */
      const askLang = String(url.searchParams.get('jp') || '').toLowerCase();
      const wantLines = askLang === 'jp' ? ['pokemon-japan']
                      : askLang === 'en' ? ['pokemon']
                      : /^(1|true|yes|both|all)$/.test(askLang) ? ['pokemon', 'pokemon-japan']
                      : ['pokemon'];
      for (let ti = 0; ti < tries.length; ti++) {
        /* Two searches rather than one naming both lines. TCGplayer ranks every English
           printing above every Japanese one, so a single request never reaches the JP cards
           however wide the window — which is exactly why a Japanese Ogerpon promo did not
           appear even with the line named. The other search endpoint has always done it this
           way; this one was asking the wrong question. */
        let got;
        if (wantLines.length > 1){
          /* Two pages of each. One page of Japanese is 48 printings, and a promo can sit past
             that for a card with as many prints as Ogerpon — the card was findable on their site
             and not in ours purely because we never asked for the second page. */
          const [en0, jp0, en1, jp1] = await Promise.all([
            tcgSearch(tries[ti], ['pokemon'], 0), tcgSearch(tries[ti], ['pokemon-japan'], 0),
            tcgSearch(tries[ti], ['pokemon'], 1), tcgSearch(tries[ti], ['pokemon-japan'], 1)]);
          const en = (en0 || en1) ? (en0 || []).concat(en1 || []) : null;
          const jp = (jp0 || jp1) ? (jp0 || []).concat(jp1 || []) : null;
          /* Interleaved, not one after the other. Concatenating put all 48 English hits ahead of
             every Japanese one, and the list is cut at 40 — so a Japanese promo could be in the
             results and still never be shown. Taking them in turn means the cut falls on both. */
          if (!en && !jp) got = null;
          else {
            const a = en || [], b = jp || [];
            got = [];
            for (let i = 0; i < Math.max(a.length, b.length); i++){
              if (i < a.length) got.push(a[i]);
              if (i < b.length) got.push(b[i]);
            }
          }
        } else {
          const [p0, p1] = await Promise.all([
            tcgSearch(tries[ti], wantLines, 0), tcgSearch(tries[ti], wantLines, 1)]);
          got = (p0 || p1) ? (p0 || []).concat(p1 || []) : null;
        }
        if (got === null) return jsonResponse({ error: 'TCGplayer search did not respond' }, 502, SB_CORS);
        if (!got.length) continue;
        hits = got;
        named = got.filter(sameName);
        if (named.length) break;
      }
      if (!hits.length) return jsonResponse({ error: 'No TCGplayer product matched that name', count: 0, listings: [], alts: [] }, 200, SB_CORS);

      const pool = named.length ? named : [];
      // Among printings of the right card, the set code decides which one - that is the whole
      // point of reading it off the card.
      const wantSet = setCode.toLowerCase().replace(/[^a-z0-9]/g, '');
      const bySet = wantSet ? pool.filter(p => String(p.setCode || '').toLowerCase() === wantSet) : [];
      const scope = bySet.length ? bySet : pool;
      const want = number.split('/')[0].replace(/[^0-9a-z]/gi, '').toLowerCase();
      const byNumber = want ? scope.find(p => {
        const n = ((p.customAttributes && p.customAttributes.number) || '').split('/')[0].replace(/[^0-9a-z]/gi, '').toLowerCase();
        return n === want;
      }) : null;
      product = byNumber || scope[0] || null;

      if (!product) {
        // Nothing carried the right name. Hand back what was found so the reader can choose,
        // but price nothing.
        nameMismatch = true;
        return jsonResponse({
          error: 'No card named "' + name + '" was found. The closest matches are listed \u2014 pick one, or search again.',
          nameMismatch: true, count: 0, listings: [], sales: [],
          alts: hits.slice().sort((a, b) => {
            const d = p => /\d/.test(String((p.customAttributes && p.customAttributes.number) || ''));
            return (d(b) ? 1 : 0) - (d(a) ? 1 : 0);
          }).slice(0, ALT_MAX).map(p => ({
            productId: p.productId, name: p.productName, set: p.setName,
            number: (p.customAttributes && p.customAttributes.number) || '',
            market: p.marketPrice || null,
            lang: /japan/i.test(String(p.productLineName || p.productLineUrlName || '')) ? 'JP' : 'EN',
            image: 'https://tcgplayer-cdn.tcgplayer.com/product/' + p.productId + '_in_200x200.jpg',
            url: 'https://www.tcgplayer.com/product/' + p.productId
          }))
        }, 200, SB_CORS);
      }
      productId = product.productId;
      // every printing that matched, so the page can offer them instead of you hunting in the frame
      /* TCGplayer carries stub products beside the real ones: "Teal Mask Ogerpon - SV-P" sits
         next to "Teal Mask Ogerpon - 148/SV-P", numbered with the set code and nothing else. The
         stub has no artwork on their CDN at any address, so it can never show a picture, and it
         is never the card somebody meant. A number with a digit in it is the tell. */
      const numbered = p => /\d/.test(String((p.customAttributes && p.customAttributes.number) || ''));
      const rank = list => list.slice().sort((a, b) => (numbered(b) ? 1 : 0) - (numbered(a) ? 1 : 0));
      const ordered = rank(named.length ? named.concat(hits.filter(h => named.indexOf(h) < 0)) : hits);
      alts = ordered.slice(0, ALT_MAX).map(p => ({
        productId: p.productId, name: p.productName, set: p.setName, setCode: p.setCode || '',
        number: (p.customAttributes && p.customAttributes.number) || '', market: p.marketPrice || null,
        lang: /japan/i.test(String(p.productLineName || p.productLineUrlName || '')) ? 'JP' : 'EN',
        // The picture, on the same terms as the other listing: built from the id rather than
        // fetched, so it costs nothing and cannot be missing when the product is not.
        image: 'https://tcgplayer-cdn.tcgplayer.com/product/' + p.productId + '_in_200x200.jpg',
        url: 'https://www.tcgplayer.com/product/' + p.productId
      }));
    }
    // Arrived with an id rather than a name, so nothing has looked the card up yet.
    if (productId && !product) product = await tcgProductById(productId);
    let [res, sales] = await Promise.all([ tcgListings(productId, conditions), tcgSales(productId, conditions) ]);
    // Sealed product conditions are "Unopened", never "Near Mint" — so asking for a card grade
    // filters every listing away and the offers come back empty. Rather than make the caller
    // know which products are sealed, an empty filtered result falls back to unfiltered.
    if (conditions.length && res && !(res.results || []).length) {
      const un = await tcgListings(productId, []);
      if (un && (un.results || []).length) res = un;
    }
    if (!res) return jsonResponse({ error: 'TCGplayer listings did not respond' }, 502, SB_CORS);
    const listings = (res.results || []).map(l => {
      const ship = (l.sellerShippingPrice != null ? l.sellerShippingPrice : (l.shippingPrice || 0)) || 0;
      const price = +l.price || 0;
      return { price, ship, total: +(price + ship).toFixed(2), gold: !!l.goldSeller, verified: !!l.verifiedSeller,
               direct: !!l.directProduct, condition: [l.condition, l.printing].filter(Boolean).join(' '),
               seller: l.sellerName || '', rating: l.sellerRating || null, sales: l.sellerSales || null, qty: l.quantity || 1 };
    });   // keep TCGplayer's own order — it already sorts by price + shipping, so this reads straight down the page
    const slug = product ? String(product.productUrlName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
    return jsonResponse({
      productId, count: listings.length, total: res.totalResults || listings.length, listings, sales, alts,
      product: product ? { name: product.productName, set: product.setName, market: product.marketPrice,
                           setCode: product.setCode || '',
                           rarity: (product.customAttributes && product.customAttributes.rarityName) || '',
                           kind: tcgKind(product),
                           lang: /japan/i.test(String(product.productLineName || product.productLineUrlName || '')) ? 'JP' : 'EN',
                           number: (product.customAttributes && product.customAttributes.number) || '',
                           image: product.productUrlName ? ('https://tcgplayer-cdn.tcgplayer.com/product/' + productId + '_in_200x200.jpg') : null } : null,
      url: 'https://www.tcgplayer.com/product/' + productId + (slug ? '/' + slug : ''),
      conditions: (res.aggregations && res.aggregations.condition) || []
    }, 200, SB_CORS);
  } catch (err) { return jsonResponse({ error: String(err && err.message || err) }, 502, SB_CORS); }
}

// Card prices via the free Pokémon TCG API (carries TCGplayer's price block per card).
async function sbHandleCardPrice(request, url) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: SB_CORS });
  const name = (url.searchParams.get('name') || '').trim();
  const set  = (url.searchParams.get('set')  || '').trim();
  const code = (url.searchParams.get('code') || '').trim();
  if (!name && !set && !code) return jsonResponse({ error: 'give a name, set or code' }, 400, SB_CORS);
  const esc = s => '"' + String(s).replace(/["\\]/g, '') + '"';
  const num = code ? String(code).split('/')[0].trim().replace(/[^0-9a-zA-Z]/g, '') : '';
  // Punctuation and suffixes break exact matching ("Lillies Clefairy ex" never matches
  // "Lillie's Clefairy ex"), so try progressively looser queries and stop at the first hit.
  const words = name.replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w && !/^(ex|gx|v|vmax|vstar|holo|holofoil|reverse|full|art|rare|promo|the|of|and)$/i.test(w));
  const pick = words.sort((a, b) => b.length - a.length)[0] || '';   // the most distinctive word
  const setQ = set ? '(set.name:' + esc(set) + ' OR set.series:' + esc(set) + ' OR set.id:' + esc(set) + ')' : '';
  const tries = [];
  if (name) tries.push([ 'name:' + esc(name), setQ, num ? 'number:' + esc(num) : '' ].filter(Boolean).join(' '));
  if (pick && num) tries.push('name:' + pick + ' number:' + esc(num));
  if (pick && setQ) tries.push('name:' + pick + ' ' + setQ);
  if (pick) tries.push('name:' + pick);
  if (!name && num) tries.push([ setQ, 'number:' + esc(num) ].filter(Boolean).join(' '));
  if (!tries.length) return jsonResponse({ error: 'give a name, set or code' }, 400, SB_CORS);

  async function run(q) {
    const api = 'https://api.pokemontcg.io/v2/cards?pageSize=24&q=' + encodeURIComponent(q);
    for (let i = 0; i < 3; i++) {                                   // the upstream 500s intermittently
      try {
        const r = await marketFetch(api, { headers: { 'Accept': 'application/json' } });
        if (r.status === 200) return await r.json();
      } catch (_) {}
      await new Promise(z => setTimeout(z, 250));
    }
    return null;
  }
  let q = '';                                  // referenced by the catch below, so keep it out here
  try {
    let j = null, anyReply = false;
    for (const t of tries) {
      q = t; j = await run(t);
      if (j) anyReply = true;
      if (j && (j.data || []).length) break;
    }
    if (!anyReply) return jsonResponse({ error: 'The price source is not responding right now — try again in a moment.', query: q }, 502, SB_CORS);
    let data = (j && j.data) || [];
    // when we had to loosen the query, prefer rows whose number actually matches
    if (num && data.length > 1) {
      const exact = data.filter(c => String(c.number).toLowerCase() === num.toLowerCase());
      if (exact.length) data = exact;
    }
    const cards = data.slice(0, 12).map(c => ({
      id: c.id, name: c.name, number: c.number, printedTotal: c.set && c.set.printedTotal,
      setName: c.set && c.set.name, setSeries: c.set && c.set.series, releaseDate: c.set && c.set.releaseDate,
      rarity: c.rarity || null, image: (c.images && c.images.small) || null,
      tcgplayerUrl: (c.tcgplayer && c.tcgplayer.url) || null,
      pricesUpdated: (c.tcgplayer && c.tcgplayer.updatedAt) || null,
      prices: (c.tcgplayer && c.tcgplayer.prices) || null,
      cardmarket: (c.cardmarket && c.cardmarket.prices) ? { trend: c.cardmarket.prices.trendPrice, avg30: c.cardmarket.prices.avg30 } : null,
    }));
    return jsonResponse({ query: q, count: cards.length, cards }, 200, SB_CORS);
  } catch (err) { return jsonResponse({ error: String(err && err.message || err), query: q }, 502, SB_CORS); }
}

export async function handleApi(request){
 const url=new URL(request.url);
 if(request.method!=='GET')return jsonResponse({error:'GET only'},405,{'Allow':'GET'});
 if((url.searchParams.get('q')||'').length>300)return jsonResponse({error:'Search is too long'},400);
 if(url.pathname==='/api/tcg')return sbHandleTcg(request,url);
 if(url.pathname==='/api/tcgsearch')return sbHandleTcgSearch(request,url);
 if(url.pathname==='/api/cardprice')return sbHandleCardPrice(request,url);
 if(url.pathname==='/api/embedcheck')return sbHandleEmbedCheck(request,url);
 return jsonResponse({error:'Not found'},404);
}

async function marketFetch(target,options={}){
 let url=new URL(target),opts={...options};
 for(let hop=0;hop<5;hop++){
  if(url.protocol!=='https:'||!SB_EMBED_HOSTS.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw Error('Upstream host not allowed');
  const response=await fetch(url,{...opts,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(![301,302,303,307,308].includes(response.status))return response;
  const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Invalid upstream redirect');
  url=new URL(location,url);if(response.status===303||([301,302].includes(response.status)&&opts.method==='POST')){opts={...opts,method:'GET'};delete opts.body;}
 }
 throw Error('Too many upstream redirects');
}
