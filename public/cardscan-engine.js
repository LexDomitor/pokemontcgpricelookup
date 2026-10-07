// Developed for Arcane 9 Labs by Alex Puh and Kyle He
// Card Scanner detection engine — shared by the developer page and the chat page.
//
// Lifted verbatim from cardscan.html so the chat front end does not re-derive any of it. The
// original page still carries its own copy; consolidating the two is worth doing but was not
// worth the risk of editing a working page to do it.
(function (root) {
'use strict';
let cvReady = false;
const C = root.CardScanCore;
const ENGINE = { onReady: null };

const CV_SOURCES = [
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    'https://unpkg.com/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    'https://docs.opencv.org/4.9.0/opencv.js'
];
let setBoot = () => {};
function onStatus(fn){ setBoot = fn || (() => {}); }
// Builds differ in how they announce themselves — some call Module.onRuntimeInitialized, some
// resolve a promise, some just define the global. Polling for a usable cv covers all of them.
function whenCvReady(done, fail){
    const t0 = Date.now();
    (function poll(){
        const g = window.cv;
        // Usable first, promise second — and the order matters. An Emscripten module carries a
        // `then` that resolves with itself, so testing for a promise first spins forever on a
        // module that was ready all along.
        if (g && g.Mat && g.imread) return done();
        if (g && typeof g.then === 'function'){ g.then(m => { if (m && m !== g) window.cv = m; setTimeout(poll, 0); }, fail); return; }
        if (Date.now() - t0 > 90000) return fail('loaded but never finished starting up');
        setTimeout(poll, 200);
    })();
}
function loadCv(i){
    i = i || 0;
    if (i >= CV_SOURCES.length){
        setBoot('OpenCV could not be loaded from any source', true);
        return;
    }
    setBoot('loading OpenCV (~10MB)' + (i ? ' — source ' + (i+1) : '') + '…');
    const el = document.createElement('script');
    el.async = true;
    el.src = CV_SOURCES[i];
    el.onerror = () => { el.remove(); loadCv(i + 1); };
    el.onload = () => whenCvReady(
        () => { cvReady = true; setBoot('OpenCV ready'); (ENGINE.onReady || (()=>{}))(); },
        () => { el.remove(); loadCv(i + 1); }
    );
    document.head.appendChild(el);
}
loadCv(0);

// ── Module 1: detection ───────────────────────────────────────────────────────
// Straight from the spec. Each stage's Mat is released explicitly — OpenCV.js is WASM and
// nothing here is garbage collected, so a few binder pages will exhaust memory otherwise.
// One parameter set is not enough. A binder page lit from one side wants a different threshold
// from a card on a dark desk, and whichever setting seals a card's border also tends to seal the
// gaps *between* cards into a single blob. So several strategies run, every candidate is pooled,
// and the pool is deduplicated afterwards.
//
// RETR_LIST rather than RETR_EXTERNAL is the other half of the fix: with EXTERNAL, one merged
// blob hides every card inside it, which is exactly the "one quad round the whole photo" failure.
const STRATEGIES = [
    { name: 'adaptive-15', kind: 'adaptive', block: 15, c: 4, close: 3 },
    { name: 'adaptive-31', kind: 'adaptive', block: 31, c: 6, close: 0 },
    { name: 'canny-lo',    kind: 'canny', lo: 30,  hi: 90,  close: 3 },
    { name: 'canny-hi',    kind: 'canny', lo: 60,  hi: 180, close: 3 },
    { name: 'otsu',        kind: 'otsu',  close: 3 },
    // Silver and holo frames sit at almost the same brightness as a black binder pocket, so a
    // brightness threshold cannot separate them. These two look for the *edge* instead: a
    // gradient pass responds to the border itself, and a hard CLAHE stretches what little
    // local contrast exists before thresholding.
    { name: 'gradient',    kind: 'sobel', close: 3 },
    { name: 'clahe-hard',  kind: 'clahe', clip: 6.0, close: 3 },
    // Everything above works on brightness, which throws colour away — and a colourful EX border
    // or a promo on a coloured background can differ hugely in hue while matching almost exactly
    // in brightness. These two keep the colour: one takes the strongest edge found in any of the
    // red, green and blue channels, the other thresholds saturation, which separates a colourful
    // card from a neutral background regardless of how light or dark either is.
    { name: 'rgb-edge',    kind: 'rgbedge', close: 5 },
    { name: 'saturation',  kind: 'sat',     close: 5 },
    // A border broken into segments only becomes a closed contour once the gaps are bridged;
    // a wide close does that at the cost of precision, which the rect fit then recovers.
    // A wide close can bridge gaps of roughly its own kernel size, so this is sized for a
    // genuinely fragmented border rather than a few nicks. It smears the outline, which is
    // exactly what the rotated-rect fit is there to recover.
    { name: 'bridge',      kind: 'rgbedge', close: 21 }
];

function buildMask(gray, src, st){
    const m = new cv.Mat();
    if (st.kind === 'adaptive'){
        cv.adaptiveThreshold(gray, m, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, st.block, st.c);
    } else if (st.kind === 'canny'){
        cv.Canny(gray, m, st.lo, st.hi);
    } else if (st.kind === 'sobel'){
        const gx = new cv.Mat(), gy = new cv.Mat(), ax = new cv.Mat(), ay = new cv.Mat();
        cv.Sobel(gray, gx, cv.CV_16S, 1, 0, 3);
        cv.Sobel(gray, gy, cv.CV_16S, 0, 1, 3);
        cv.convertScaleAbs(gx, ax); cv.convertScaleAbs(gy, ay);
        cv.addWeighted(ax, 0.5, ay, 0.5, 0, m);
        cv.threshold(m, m, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        gx.delete(); gy.delete(); ax.delete(); ay.delete();
    } else if (st.kind === 'clahe'){
        const hard = new cv.CLAHE(st.clip, new cv.Size(8, 8));
        hard.apply(gray, m); hard.delete();
        cv.adaptiveThreshold(m, m, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 21, 5);
    } else if (st.kind === 'rgbedge'){
        // An edge invisible in brightness can be strong in one channel; take the max of all three.
        const ch = new cv.MatVector();
        cv.split(src, ch);
        const acc = cv.Mat.zeros(src.rows, src.cols, cv.CV_8U);
        for (let i = 0; i < 3; i++){
            const gx = new cv.Mat(), gy = new cv.Mat(), ax = new cv.Mat(), ay = new cv.Mat(), e = new cv.Mat();
            cv.Sobel(ch.get(i), gx, cv.CV_16S, 1, 0, 3);
            cv.Sobel(ch.get(i), gy, cv.CV_16S, 0, 1, 3);
            cv.convertScaleAbs(gx, ax); cv.convertScaleAbs(gy, ay);
            cv.addWeighted(ax, 0.5, ay, 0.5, 0, e);
            cv.max(acc, e, acc);
            gx.delete(); gy.delete(); ax.delete(); ay.delete(); e.delete();
        }
        cv.threshold(acc, m, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        acc.delete(); ch.delete();
    } else if (st.kind === 'sat'){
        const rgb = new cv.Mat(), hsv = new cv.Mat(), ch = new cv.MatVector();
        cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
        cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
        cv.split(hsv, ch);
        cv.adaptiveThreshold(ch.get(1), m, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, -6);
        rgb.delete(); hsv.delete(); ch.delete();
    } else {
        cv.threshold(gray, m, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    }
    if (st.close){
        const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(st.close, st.close));
        cv.morphologyEx(m, m, cv.MORPH_CLOSE, k);
        k.delete();
    }
    return m;
}

// Corners of a rotated rect, computed rather than asked for — cv.RotatedRect.points differs
// between opencv.js builds, and the maths is three lines.
function rectCorners(rr){
    const a = rr.angle * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const w = rr.size.width / 2, h = rr.size.height / 2, cx = rr.center.x, cy = rr.center.y;
    return [[-w,-h],[w,-h],[w,h],[-w,h]].map(p => ({ x: cx + p[0]*co - p[1]*si, y: cy + p[0]*si + p[1]*co }));
}

function quadsFromMask(mask, imgArea, imgW, imgH){
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(mask, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const good = [], bad = [];
    for (let i = 0; i < contours.size(); i++){
        const c = contours.get(i);
        const peri = cv.arcLength(c, true);
        if (peri > 40){
            const approx = new cv.Mat();
            cv.approxPolyDP(c, approx, 0.02 * peri, true);

            // Path 1 — a clean four-point trace. Most accurate when the border is unbroken.
            if (approx.rows === 4){
                const pts = [];
                for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
                let v = null; try { v = C.classifyQuad(pts, imgArea, { imgW: imgW, imgH: imgH }); } catch(_) {}
                if (v) (v.ok ? good : bad).push(v);
            }
            // Path 2 — the border is broken, bumpy, or bleeds into a background of the same
            // colour, so it never reduces to four points. Fit the tightest rotated rectangle
            // instead and ask how much of it the contour actually fills: a card fills its own
            // bounding box almost completely, whereas a smear of noise does not. This is what
            // rescues the colourful EX borders that fragment into a dozen segments.
            else if (approx.rows >= 4 && approx.rows <= 14){
                try {
                    const rr = cv.minAreaRect(c);
                    const rectArea = rr.size.width * rr.size.height;
                    const extent = rectArea > 0 ? cv.contourArea(c) / rectArea : 0;
                    if (extent > 0.62 && rectArea > 0){
                        const v = C.classifyQuad(rectCorners(rr), imgArea, { imgW: imgW, imgH: imgH });
                        if (v.ok) { v.viaRect = true; good.push(v); } else bad.push(v);
                    }
                } catch(_) {}
            }
            approx.delete();
        }
        c.delete();
    }
    contours.delete(); hier.delete();
    return { good, bad };
}

function detectQuads(src, wantMask){
    const gray = new cv.Mat(), base = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));   // even out a page lit from one side
    clahe.apply(gray, base);
    clahe.delete();
    cv.GaussianBlur(base, base, new cv.Size(5, 5), 0);

    const imgArea = src.rows * src.cols;
    let accepted = [], rejected = [], perStrategy = [], maskOut = null;

    STRATEGIES.forEach(st => {
        const mask = buildMask(base, src, st);
        const r = quadsFromMask(mask, imgArea, src.cols, src.rows);
        perStrategy.push(st.name + ':' + r.good.length);
        accepted = accepted.concat(r.good);
        rejected = rejected.concat(r.bad);
        if (wantMask && st.name === wantMask){ maskOut = mask; } else { mask.delete(); }
    });

    gray.delete(); base.delete();
    const merged = C.dedupeQuads(accepted.map(v => v.quad));
    return { quads: merged, rejected, perStrategy, mask: maskOut, rawCount: accepted.length };
}

// ── warp to the canonical 450×628 ─────────────────────────────────────────────
function warp(src, quad){
    const W = C.WARP_W, H = C.WARP_H;
    const from = cv.matFromArray(4, 1, cv.CV_32FC2,
        [quad[0].x,quad[0].y, quad[1].x,quad[1].y, quad[2].x,quad[2].y, quad[3].x,quad[3].y]);
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, W,0, W,H, 0,H]);
    const M = cv.getPerspectiveTransform(from, to);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    from.delete(); to.delete(); M.delete();
    return dst;
}

// -- OCR ----------------------------------------------------------------------
// Tesseract runs in its own worker. It is created once and reconfigured between passes rather
// than rebuilt, because spinning up a worker costs seconds and a binder page needs dozens of
// reads. Nothing here corrects or guesses: whatever comes back is written down verbatim, and a
// poor read is flagged rather than tidied up.
let _tess = null, _tessBusy = null;
async function tessWorker(){
    if (_tess) return _tess;
    if (_tessBusy) return _tessBusy;
    _tessBusy = (async () => {
        setBoot('loading the text reader\u2026');
        _tess = await Tesseract.createWorker('eng', 1, { logger: () => {} });
        setBoot('OpenCV ready');
        return _tess;
    })();
    return _tessBusy;
}

const PASS = {
    title:  { region: 'title',  scale: 4, psm: '7',
              chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz \'-.&' },
    hp:     { region: 'hp',     scale: 5, psm: '7', chars: '0123456789HP' },
    numL:   { region: 'numberLeft',  scale: 5, psm: '7', chars: '0123456789/' },
    numR:   { region: 'numberRight', scale: 5, psm: '7', chars: '0123456789/' }
};

// The 4-5x upscale is the single biggest accuracy win: title text on a 450px card is only about
// 20px tall, well under what Tesseract wants. CLAHE then Otsu flattens foil and uneven lighting,
// and the mean check inverts light-on-dark titles, which full-art and V cards use constantly.
// One preprocessing recipe is not enough. Otsu is excellent on flat printed text and terrible on
// foil, gradients and full-art backgrounds, where it can erase the title outright. Tesseract is
// also often better on plain greyscale than on a badly binarised image. So several versions of
// the same crop are produced and the reader picks whichever it was most confident about.
function prepVariants(cardMat, spec){
    const r = C.regionPx(spec.region);
    const rect = new cv.Rect(Math.max(0, r.x), Math.max(0, r.y),
                             Math.min(r.w, C.WARP_W - r.x), Math.min(r.h, C.WARP_H - r.y));
    const roi = cardMat.roi(rect);
    const up = new cv.Mat(), g = new cv.Mat();
    // The upscale is the single biggest accuracy win: title text on a 450px card is ~20px tall,
    // well below what Tesseract wants to see.
    cv.resize(roi, up, new cv.Size(rect.width * spec.scale, rect.height * spec.scale), 0, 0, cv.INTER_CUBIC);
    cv.cvtColor(up, g, cv.COLOR_RGBA2GRAY);
    const cl = new cv.CLAHE(2.0, new cv.Size(8, 8));
    cl.apply(g, g); cl.delete();

    const out = [];
    const push = (name, mat) => {
        const c = document.createElement('canvas');
        cv.imshow(c, mat); out.push({ name, canvas: c }); mat.delete();
    };

    const grey = new cv.Mat(); g.copyTo(grey); push('grey', grey);

    const inv = new cv.Mat(); cv.bitwise_not(g, inv); push('grey-inv', inv);

    const otsu = new cv.Mat();
    cv.threshold(g, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    if (cv.mean(otsu)[0] < 127) cv.bitwise_not(otsu, otsu);   // light text on a dark card
    push('otsu', otsu);

    const adap = new cv.Mat();
    cv.adaptiveThreshold(g, adap, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 12);
    if (cv.mean(adap)[0] < 127) cv.bitwise_not(adap, adap);
    push('adaptive', adap);

    roi.delete(); up.delete(); g.delete();
    return out;
}

async function runPass(worker, cardMat, spec){
    const variants = prepVariants(cardMat, spec);
    await worker.setParameters({ tessedit_pageseg_mode: spec.psm, tessedit_char_whitelist: spec.chars });
    let best = { text: '', conf: -1, variant: '-', canvas: variants[0].canvas };
    for (const v of variants){
        let res;
        try { res = await worker.recognize(v.canvas); } catch (_) { continue; }
        const text = (res.data.text || '').replace(/\s+/g, ' ').trim();
        // An empty read is worthless however confident it claims to be.
        const conf = text ? (res.data.confidence || 0) : -1;
        if (conf > best.conf) best = { text, conf, variant: v.name, canvas: v.canvas };
    }
    return best;
}

// Read the whole card in one go and keep every word's position, rather than cropping fixed
// rectangles and hoping the layout matches. This is what copes with cards whose name sits
// somewhere unusual, and with a detected box that landed slightly inside the card's edge.
async function readWhole(worker, cardMat){
    const up = new cv.Mat(), g = new cv.Mat();
    cv.resize(cardMat, up, new cv.Size(C.WARP_W * 2, C.WARP_H * 2), 0, 0, cv.INTER_CUBIC);
    cv.cvtColor(up, g, cv.COLOR_RGBA2GRAY);
    const cl = new cv.CLAHE(2.0, new cv.Size(8, 8));
    cl.apply(g, g); cl.delete();
    const cnv = document.createElement('canvas');
    cv.imshow(cnv, g);
    up.delete(); g.delete();

    // Sparse text, no whitelist: the point is to see everything on the card and choose afterwards.
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
    let res;
    try { res = await worker.recognize(cnv); } catch (_) { return { words: [], canvas: cnv }; }
    const W = cnv.width, H = cnv.height;
    const words = ((res.data && res.data.words) || []).map(w => ({
        text: w.text || '', conf: w.confidence || 0,
        x0: w.bbox.x0 / W, x1: w.bbox.x1 / W, y0: w.bbox.y0 / H, y1: w.bbox.y1 / H
    }));
    return { words, canvas: cnv };
}

async function readCard(worker, cardMat){
    // Two independent attempts. The targeted crops are sharper when the layout is standard; the
    // whole-card read is far more forgiving when it is not. Each field takes whichever answered.
    const whole = await readWhole(worker, cardMat);
    const picked = C.pickFields(whole.words);

    const title = await runPass(worker, cardMat, PASS.title);
    const hp    = await runPass(worker, cardMat, PASS.hp);
    const l = await runPass(worker, cardMat, PASS.numL);
    const r = await runPass(worker, cardMat, PASS.numR);
    const num = (r.conf > l.conf ? r : l);

    const better = (a, aConf, b, bConf) => {
        if (!a) return { v: b, src: 'whole' };
        if (!b) return { v: a, src: 'crop' };
        return bConf > aConf + 8 ? { v: b, src: 'whole' } : { v: a, src: 'crop' };
    };
    const tPick = better(title.text, title.conf, picked.title, picked.titleConf);
    const hPick = better((hp.text.match(/\d{1,3}/) || [''])[0], hp.conf, picked.hp, 70);
    const nPick = better(num.text, num.conf, picked.number, 70);

    return {
        strips: { title: title.canvas, hp: hp.canvas, num: num.canvas },
        variant: title.variant + '/' + tPick.src,
        words: whole.words.length,
        title_raw: tPick.v,
        hp_raw: hPick.v,
        number_raw: nPick.v,
        ocr_confidence: Math.max(0, Math.round(Math.max(title.conf, picked.titleConf))),
        number_zone: (r.conf > l.conf ? 'right' : 'left')
    };
}



let localReader;
ENGINE.readLocal = async card => {
    if(!root.Tesseract){
        if(!localReader)localReader=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>{localReader=null;reject(Error('Could not download the local text reader. Check your connection and retry.'));};document.head.appendChild(s);});
        await localReader;
    }
    const result=await readCard(await tessWorker(),card);
    return {title:result.title_raw,hp:result.hp_raw,number:result.number_raw,set:'',raw:JSON.stringify({confidence:result.ocr_confidence})};
};
ENGINE.load = loadCv;
ENGINE.onStatus = onStatus;
ENGINE.ready = () => cvReady;
ENGINE.detect = detectQuads;
ENGINE.warp = warp;
ENGINE.rectCorners = rectCorners;
root.CardScanEngine = ENGINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
