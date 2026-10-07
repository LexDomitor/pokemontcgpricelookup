// Card Scanner — pure pipeline geometry.
//
// Deliberately free of OpenCV, the DOM and any I/O: everything here is data in, data out, so it
// runs under Node for tests and ports to Python cheaply if browser OCR turns out to be too weak.
// A quad is [{x,y} × 4] in source-image pixels.
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.CardScanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var CARD_RATIO = 63 / 88;          // 0.71590… a real Pokémon card, width / height
    var RATIO_TOL  = 0.10;
    var MIN_AREA_FRAC = 0.01;          // ignore specks: at least 1% of the image
    // A portrait phone photo is roughly 0.75 wide-to-tall, which sits inside the card ratio
    // tolerance, so the image border itself reads as a perfect card and hides everything inside
    // it. The first attempt at stopping that was a 45% area cap, which was wrong: a close-up of
    // a single card legitimately fills most of the frame and was being thrown away. The border
    // is now identified by what it actually is — a quad sitting on the edges of the image — and
    // the cap only catches the near-total cases that check cannot see.
    var MAX_AREA_FRAC = 0.97;
    var FRAME_MARGIN = 0.015;          // corners this close to the edge mean "the photo itself"

    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };

    /**
     * Sort four points into top-left, top-right, bottom-right, bottom-left.
     * The sum/difference trick is orientation-tolerant, which matters because contour points
     * arrive in whatever order the tracer happened to walk them.
     */
    function orderCorners(pts) {
        if (!pts || pts.length !== 4) throw new Error('orderCorners needs exactly 4 points');
        var sum = pts.map(function (p) { return p.x + p.y; });
        var dif = pts.map(function (p) { return p.y - p.x; });
        var idxMin = function (a) { return a.indexOf(Math.min.apply(null, a)); };
        var idxMax = function (a) { return a.indexOf(Math.max.apply(null, a)); };
        var tl = pts[idxMin(sum)], br = pts[idxMax(sum)];
        var tr = pts[idxMin(dif)], bl = pts[idxMax(dif)];
        return [tl, tr, br, bl];
    }

    /** Average the opposing edges — a tilted or slightly trapezoidal quad has unequal sides. */
    function quadSize(q) {
        return {
            w: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2,
            h: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
        };
    }

    function quadArea(q) {                       // shoelace
        var a = 0;
        for (var i = 0; i < 4; i++) {
            var j = (i + 1) % 4;
            a += q[i].x * q[j].y - q[j].x * q[i].y;
        }
        return Math.abs(a) / 2;
    }

    function centroid(q) {
        return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
                 y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    }

    /** Shift the corner order one position — turns a landscape reading into a portrait one. */
    function rotateQuad(q) { return [q[3], q[0], q[1], q[2]]; }

    function isConvex(q) {
        var sign = 0;
        for (var i = 0; i < 4; i++) {
            var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
            var cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (cross === 0) continue;
            var s = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
        return true;
    }

    /**
     * Does this quad look like a card? Returns the verdict plus the numbers behind it, so the
     * debug overlay can explain a rejection instead of just dropping the shape silently.
     */
    function classifyQuad(quad, imageArea, opts) {
        opts = opts || {};
        var tol = opts.ratioTol == null ? RATIO_TOL : opts.ratioTol;
        var minFrac = opts.minAreaFrac == null ? MIN_AREA_FRAC : opts.minAreaFrac;
        var maxFrac = opts.maxAreaFrac == null ? MAX_AREA_FRAC : opts.maxAreaFrac;

        var q = orderCorners(quad);
        var size = quadSize(q);
        var area = quadArea(q);
        var landscape = size.w > size.h;
        // A sideways card is still a card: compare the portrait-normalised ratio.
        var ratio = landscape ? size.h / size.w : size.w / size.h;
        var areaFrac = imageArea > 0 ? area / imageArea : 0;

        var reasons = [];
        if (!isConvex(q)) reasons.push('not convex');
        if (areaFrac < minFrac) reasons.push('too small (' + (areaFrac * 100).toFixed(2) + '% of image)');
        if (areaFrac > maxFrac) reasons.push('too large (' + (areaFrac * 100).toFixed(1) + '% of image)');
        // Is this the picture's own border? Every corner hugging an edge is the giveaway, and it
        // holds whatever the photo's proportions happen to be.
        if (opts.imgW && opts.imgH) {
            var mx = opts.imgW * FRAME_MARGIN, my = opts.imgH * FRAME_MARGIN;
            var onEdge = q.every(function (p) {
                return (p.x <= mx || p.x >= opts.imgW - mx) && (p.y <= my || p.y >= opts.imgH - my);
            });
            if (onEdge) reasons.push('this is the image border, not a card');
        }
        if (Math.abs(ratio - CARD_RATIO) > tol) reasons.push('aspect ' + ratio.toFixed(3) + ' outside ' + CARD_RATIO.toFixed(3) + '±' + tol);

        return {
            quad: landscape ? rotateQuad(q) : q,   // hand back an upright quad either way
            ok: reasons.length === 0,
            ratio: ratio, area: area, areaFrac: areaFrac,
            landscape: landscape, width: size.w, height: size.h,
            reasons: reasons
        };
    }

    /**
     * Reading order: top-to-bottom, left-to-right, so the user can hold the binder page beside
     * the screen and work straight down it.
     *
     * Rows are split on a gap larger than half the median card height rather than a fixed pixel
     * value — that tolerance is what lets a page photographed at a tilt still group correctly,
     * since a tilt shifts centroids vertically far less than a full row's spacing.
     */
    function sortReadingOrder(quads) {
        if (!quads || !quads.length) return [];

        var items = quads.map(function (q, i) {
            var oq = orderCorners(q);
            return { quad: q, index: i, c: centroid(oq), h: quadSize(oq).h };
        });

        var heights = items.map(function (it) { return it.h; }).sort(function (a, b) { return a - b; });
        var mid = Math.floor(heights.length / 2);
        var medianH = heights.length % 2 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
        var gap = medianH / 2;

        items.sort(function (a, b) { return a.c.y - b.c.y; });

        var rows = [], cur = [items[0]];
        for (var i = 1; i < items.length; i++) {
            if (items[i].c.y - cur[cur.length - 1].c.y > gap) { rows.push(cur); cur = [items[i]]; }
            else cur.push(items[i]);
        }
        rows.push(cur);

        var out = [];
        rows.forEach(function (row, r) {
            row.sort(function (a, b) { return a.c.x - b.c.x; });
            row.forEach(function (it, c) {
                out.push({ quad: it.quad, index: it.index, row: r + 1, col: c + 1, centroid: it.c });
            });
        });
        return out;
    }

    /** Is a point inside a convex quad? Used to spot a blob that has swallowed several cards. */
    function pointInQuad(p, q) {
        var sign = 0;
        for (var i = 0; i < 4; i++) {
            var a = q[i], b = q[(i + 1) % 4];
            var cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            if (cross === 0) continue;
            var s2 = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s2;
            else if (s2 !== sign) return false;
        }
        return true;
    }

    /**
     * Collapse the candidate list.
     *
     * Two things have to go. Running contour detection over several parameter sets finds the same
     * card repeatedly, and a card's inner and outer border can both trace — those are near
     * duplicates, resolved by keeping the larger of any pair sharing a centroid. Separately, a
     * threshold that merges the gaps between cards yields one blob around the whole group; any
     * quad holding two or more other centroids is that, and is dropped.
     */
    function dedupeQuads(quads, opts) {
        opts = opts || {};
        if (!quads.length) return [];
        var items = quads.map(function (q) {
            var oq = orderCorners(q);
            return { quad: oq, c: centroid(oq), area: quadArea(oq), size: quadSize(oq) };
        });

        // 1. Drop grouping blobs: a quad holding two or more other centroids is the whole page,
        //    not a card.
        var containerMin = opts.containerMin == null ? 2 : opts.containerMin;
        var kept = items.filter(function (it) {
            var inside = 0;
            for (var j = 0; j < items.length; j++) {
                if (items[j] === it) continue;
                // Only markedly smaller shapes count as "contained". A card holds its own artwork
                // window and its inner border, and at 0.92 those two made every card look like a
                // page blob and got it thrown away. A real page's children are a tenth its size.
                if (items[j].area < it.area * 0.55 && pointInQuad(items[j].c, it.quad)) inside++;
            }
            return inside < containerMin;
        });
        if (!kept.length) kept = items;

        // 2. Drop inner frames. A card's artwork window is about 0.76 normalised aspect, which
        //    sits inside the card tolerance, so it reads as a card in its own right. What gives
        //    it away is that it lives inside a slightly larger quad. "Slightly" is the point —
        //    a parent only a few times bigger is the card itself, whereas one many times bigger
        //    is a page blob and its child is a real card that must be kept.
        var loR = opts.nestLo == null ? 1.15 : opts.nestLo;
        var hiR = opts.nestHi == null ? 4.5  : opts.nestHi;
        // How far a quad's proportions sit from a real card. The nested rule needs this: on its
        // own, "inside something 1.15-4.5x bigger" also describes a genuine card sitting on a
        // background blob, and that evicted the real cards while keeping their artwork windows.
        // A parent may only displace a child if the parent is the more card-shaped of the two.
        var shapeErr = function (it) {
            var r = it.size.w > it.size.h ? it.size.h / it.size.w : it.size.w / it.size.h;
            return Math.abs(r - CARD_RATIO);
        };
        kept = kept.filter(function (it) {
            for (var j = 0; j < kept.length; j++) {
                var p = kept[j];
                if (p === it) continue;
                var ratio = p.area / it.area;
                if (ratio > loR && ratio < hiR && shapeErr(p) <= shapeErr(it) && pointInQuad(it.c, p.quad)) return false;
            }
            return true;
        });

        // 3. Collapse repeats of the same card found by different strategies, and choose which
        //    of them to keep by shape rather than by size.
        //
        //    Size is the wrong criterion and it matters: a strategy that closes gaps with a wide
        //    kernel grows the region outward, so the biggest candidate is reliably the least
        //    accurate one. Keeping it produced warps with a fat dark margin around the card,
        //    which silently shifted every crop region off the text it was aiming at. The
        //    candidate whose proportions sit closest to a real card is the tight one; ties go to
        //    the smaller, since dilation only ever inflates.
        var groups = [];
        kept.forEach(function (it) {
            var g = null;
            for (var i = 0; i < groups.length; i++) {
                var h = groups[i][0];
                var tol = Math.max(8, Math.min(h.size.w, h.size.h) * 0.4);
                if (Math.hypot(h.c.x - it.c.x, h.c.y - it.c.y) < tol) { g = groups[i]; break; }
            }
            if (g) g.push(it); else groups.push([it]);
        });
        var offBy = shapeErr;
        var out = groups.map(function (g) {
            return g.slice().sort(function (a, b) {
                var d = offBy(a) - offBy(b);
                if (Math.abs(d) > 0.012) return d;
                return a.area - b.area;
            })[0];
        });

        // 4. Cards on one page are all the same size. Once there are enough of them the median
        //    area is a reliable yardstick, and anything far from it is an artwork window or a
        //    sleeve rather than a card. Skipped for small counts, where there is no consensus
        //    to appeal to.
        var minForModal = opts.minForModal == null ? 4 : opts.minForModal;
        if (out.length >= minForModal) {
            var areas = out.map(function (o) { return o.area; }).slice().sort(function (a, b) { return a - b; });
            var mid = Math.floor(areas.length / 2);
            var med = areas.length % 2 ? areas[mid] : (areas[mid - 1] + areas[mid]) / 2;
            var lo = opts.modalLo == null ? 0.55 : opts.modalLo;
            var hi = opts.modalHi == null ? 1.8  : opts.modalHi;
            var filtered = out.filter(function (o) { return o.area >= med * lo && o.area <= med * hi; });
            if (filtered.length >= minForModal) out = filtered;
        }

        return out.map(function (o) { return o.quad; });
    }

    /**
     * Push a quad's corners outward from its centre. Detection tends to land just inside the
     * card's edge, and a few percent of loss at the top is enough to shear the name and HP off
     * the crop entirely. Widening costs a sliver of background, which OCR ignores.
     */
    function expandQuad(q, frac) {
        var c = centroid(q);
        var f = 1 + (frac == null ? 0.03 : frac);
        return q.map(function (p) {
            return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f };
        });
    }

    /**
     * Pick the fields out of a full-card OCR result.
     *
     * `words` are {text, conf, x0, y0, x1, y1} with coordinates already normalised to 0-1 of the
     * card. Reading the whole card and then choosing by position beats cropping fixed rectangles:
     * it survives the layout differences between eras, and it does not fail simply because the
     * detected box sat a few percent inside the card.
     */
    function pickFields(words) {
        var w = (words || []).filter(function (x) { return x.text && x.text.trim(); });
        var out = { title: '', hp: '', number: '', titleConf: 0 };
        if (!w.length) return out;

        // Collector number: the only thing on a card shaped like 123/456, and it lives low down.
        var numRe = /^\(?\d{1,3}\s*\/\s*\d{1,3}\)?$/;
        var nums = w.filter(function (x) { return x.y0 > 0.86 && numRe.test(x.text.trim()); });
        if (!nums.length) nums = w.filter(function (x) { return numRe.test(x.text.trim()); });
        if (nums.length) {
            nums.sort(function (a, b) { return b.conf - a.conf; });
            out.number = nums[0].text.trim().replace(/[()\s]/g, '');
        }

        // HP: a 1-3 digit number in the top band, over on the right. Either beside the letters
        // "HP" or on its own, depending on the era.
        var top = w.filter(function (x) { return x.y1 < 0.20; });
        var hpTok = top.filter(function (x) { return /^\d{1,3}$/.test(x.text.trim()) && x.x0 > 0.55; });
        if (!hpTok.length) hpTok = top.filter(function (x) { return /^(HP)?\d{1,3}(HP)?$/i.test(x.text.replace(/\s/g, '')) && x.x0 > 0.5; });
        if (hpTok.length) {
            hpTok.sort(function (a, b) { return b.x1 - a.x1; });        // rightmost wins
            out.hp = (hpTok[0].text.match(/\d{1,3}/) || [''])[0];
        }

        // Name: the tallest run of letters in the top band, left of the HP corner. Card names are
        // set larger than anything else up there, so glyph height is the giveaway.
        var cand = top.filter(function (x) {
            return x.x0 < 0.72 && /[A-Za-z]/.test(x.text) && !/^HP$/i.test(x.text.trim());
        });
        if (cand.length) {
            var tallest = cand.reduce(function (a, b) { return (b.y1 - b.y0) > (a.y1 - a.y0) ? b : a; });
            var h = tallest.y1 - tallest.y0;
            var mid = (tallest.y0 + tallest.y1) / 2;
            // everything sharing that line, in reading order
            var line = cand.filter(function (x) {
                return Math.abs(((x.y0 + x.y1) / 2) - mid) < h * 0.6 && (x.y1 - x.y0) > h * 0.45;
            }).sort(function (a, b) { return a.x0 - b.x0; });
            out.title = line.map(function (x) { return x.text.trim(); }).join(' ').replace(/\s+/g, ' ').trim();
            out.titleConf = Math.round(line.reduce(function (a, x) { return a + x.conf; }, 0) / line.length);
        }
        return out;
    }

    /** Fractional crop regions on the canonical 450×628 warp, straight from the spec. */
    var WARP_W = 450, WARP_H = 628;
    var REGIONS = {
        // The band is a little wider than the text needs. A tight crop shears the tops off
        // capitals, and Tesseract reads a clipped glyph far worse than a small one.
        title:       { x0: 0.05, x1: 0.68, y0: 0.032, y1: 0.128 },
        // The title crop stops at 0.68 to keep HP and the type symbol out of the read. HP is
        // worth having in its own right though — "Charizard 120 HP" is a far tighter search than
        // the name alone — so it gets its own pass over the strip the title deliberately drops.
        hp:          { x0: 0.66, x1: 0.98, y0: 0.025, y1: 0.125 },
        // Generous bands for the vision model. Narrow strips have to be aimed precisely and
        // shear the name off when the detected box sits a little inside the card; a quarter of
        // the card cannot miss. The middle half is artwork and attack text — noise here — so it
        // is dropped, which also keeps the image small.
        topBand:     { x0: 0.0, x1: 1.0, y0: 0.0,  y1: 0.25 },
        bottomBand:  { x0: 0.0, x1: 1.0, y0: 0.75, y1: 1.0 },
        // The collector number sits right on the bottom edge; a 1.5% band clips it on any card
        // whose warp is a pixel or two generous, so this reaches further up.
        numberLeft:  { x0: 0.03, x1: 0.36, y0: 0.955, y1: 0.998 },
        numberRight: { x0: 0.64, x1: 0.97, y0: 0.955, y1: 0.998 }
    };
    function regionPx(name, w, h) {
        var r = REGIONS[name];
        if (!r) throw new Error('unknown region: ' + name);
        w = w || WARP_W; h = h || WARP_H;
        var x = Math.round(r.x0 * w), y = Math.round(r.y0 * h);
        return { x: x, y: y,
                 w: Math.max(1, Math.round(r.x1 * w) - x),
                 h: Math.max(1, Math.round(r.y1 * h) - y) };
    }

    /** Flag rules, kept here so the browser and any future port agree on what "needs review" means. */
    function needsReview(row) {
        return (row.title_raw || '').trim().length < 3
            || (row.ocr_confidence != null && row.ocr_confidence < 65)
            || !String(row.number_raw || '').trim()
            || row.detection_method === 'fallback';
    }

    function cropName(sourceStem, row, col) {
        return String(sourceStem).replace(/[^\w.-]+/g, '_') + '_r' + row + 'c' + col + '.jpg';
    }

    var CSV_COLUMNS = ['source_image', 'row', 'col', 'crop_file', 'title_raw', 'title_edited',
                       'number_raw', 'number_edited', 'hp_raw', 'hp_edited',
                       'ocr_confidence', 'detection_method', 'needs_review'];

    /** Every field quoted — card names carry commas, apostrophes and full stops. */
    function toCSV(rows) {
        var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
        var out = [CSV_COLUMNS.map(esc).join(',')];
        rows.forEach(function (r) { out.push(CSV_COLUMNS.map(function (k) { return esc(r[k]); }).join(',')); });
        return out.join('\r\n');
    }

    return {
        CARD_RATIO: CARD_RATIO, WARP_W: WARP_W, WARP_H: WARP_H, REGIONS: REGIONS, CSV_COLUMNS: CSV_COLUMNS,
        orderCorners: orderCorners, quadSize: quadSize, quadArea: quadArea, centroid: centroid,
        rotateQuad: rotateQuad, isConvex: isConvex, classifyQuad: classifyQuad,
        pointInQuad: pointInQuad, dedupeQuads: dedupeQuads, MAX_AREA_FRAC: MAX_AREA_FRAC,
        expandQuad: expandQuad, pickFields: pickFields,
        sortReadingOrder: sortReadingOrder, regionPx: regionPx, needsReview: needsReview,
        cropName: cropName, toCSV: toCSV
    };
});
