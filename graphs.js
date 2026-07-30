/* Bench Block — graphs. Hand-rolled SVG (no libraries, works offline, scales
   on a phone). Reads only from analytics.js; computes nothing itself. */

"use strict";

const CH = { w: 340, h: 190, l: 38, r: 10, t: 12, b: 34 };

function chartFrame(inner, note) {
	return `<svg viewBox="0 0 ${CH.w} ${CH.h}" class="chart" role="img">${inner}</svg>`
		+ (note ? `<div class="chart-note">${note}</div>` : "");
}

function scaleY(vals, zeroBase) {
	const nums = vals.filter(v => v != null && isFinite(v));
	if (!nums.length) return null;
	let lo = Math.min(...nums), hi = Math.max(...nums);
	if (zeroBase) lo = 0;
	if (hi === lo) { hi = lo + 1; }
	const pad = (hi - lo) * 0.12;
	return { lo: zeroBase ? 0 : lo - pad, hi: hi + pad };
}

function yPix(v, sc) {
	const span = sc.hi - sc.lo || 1;
	return CH.t + (CH.h - CH.t - CH.b) * (1 - (v - sc.lo) / span);
}
function xPix(i, n) {
	if (n <= 1) return CH.l + (CH.w - CH.l - CH.r) / 2;
	return CH.l + (CH.w - CH.l - CH.r) * (i / (n - 1));
}

function axes(sc, xLabels, everyNth) {
	const plotB = CH.h - CH.b;
	let g = `<line class="ax" x1="${CH.l}" y1="${CH.t}" x2="${CH.l}" y2="${plotB}"/>
		<line class="ax" x1="${CH.l}" y1="${plotB}" x2="${CH.w - CH.r}" y2="${plotB}"/>`;
	const ticks = 4;
	for (let i = 0; i <= ticks; i++) {
		const v = sc.lo + (sc.hi - sc.lo) * (i / ticks);
		const y = yPix(v, sc);
		g += `<line class="grid" x1="${CH.l}" y1="${y.toFixed(1)}" x2="${CH.w - CH.r}" y2="${y.toFixed(1)}"/>
			<text class="tick" x="${CH.l - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTick(v)}</text>`;
	}
	const step = everyNth || Math.ceil(xLabels.length / 6) || 1;
	xLabels.forEach((lb, i) => {
		if (i % step) return;
		g += `<text class="tick" x="${xPix(i, xLabels.length).toFixed(1)}" y="${plotB + 13}" text-anchor="middle">${esc(lb)}</text>`;
	});
	return g;
}

function fmtTick(v) {
	const a = Math.abs(v);
	if (a >= 10000) return Math.round(v / 1000) + "k";
	if (a >= 1000) return (v / 1000).toFixed(1) + "k";
	return a >= 10 || v === 0 ? String(Math.round(v)) : v.toFixed(1);
}

function shortDate(d) { return d.slice(5).replace("-", "/"); }

/* One or more line series over shared categorical x positions. */
function lineChart(series, xLabels, opts) {
	opts = opts || {};
    const all = series.flatMap(s => s.pts.map(p => p.y));
	const sc = scaleY(all, opts.zeroBase);
	if (!sc) return `<div class="chart-empty">no data yet</div>`;
	let g = axes(sc, xLabels, opts.everyNth);
	series.forEach((s, si) => {
		const cls = s.cls || ("c" + (si % 6 + 1));
		let d = "", open = false;
		s.pts.forEach((p, i) => {
			if (p.y == null) { open = false; return; }
			const x = xPix(i, s.pts.length).toFixed(1), y = yPix(p.y, sc).toFixed(1);
			d += (open ? " L" : " M") + x + "," + y;
			open = true;
		});
		g += `<path class="ln ${cls}" d="${d.trim()}"/>`;
		s.pts.forEach((p, i) => {
			if (p.y == null) return;
			g += `<circle class="dot ${cls}" cx="${xPix(i, s.pts.length).toFixed(1)}" cy="${yPix(p.y, sc).toFixed(1)}" r="2.6"/>`;
		});
	});
	return chartFrame(g, opts.note);
}

/* Bars (optionally grouped) with an optional line overlaid on its own scale. */
function comboChart(groups, bars, line, opts) {
	opts = opts || {};
	const barVals = groups.flatMap(g => g.values.filter(v => v != null));
	const bsc = scaleY(barVals.length ? barVals : [0], true);
	let g = axes(bsc, groups.map(x => x.label), opts.everyNth);
	const plotB = CH.h - CH.b;
	const slot = (CH.w - CH.l - CH.r) / Math.max(groups.length, 1);
	const bw = Math.max(3, slot / Math.max(bars.length, 1) * 0.62);
	groups.forEach((grp, gi) => {
		grp.values.forEach((v, bi) => {
			if (v == null) return;
			const cx = CH.l + slot * (gi + 0.5) + (bi - (bars.length - 1) / 2) * bw * 1.08;
			const y = yPix(v, bsc);
			g += `<rect class="bar ${bars[bi].cls}" x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, plotB - y).toFixed(1)}" rx="1.5"/>`;
		});
	});
	if (line && line.pts.some(p => p.y != null)) {
		const lsc = scaleY(line.pts.map(p => p.y));
		let d = "", open = false;
		line.pts.forEach((p, i) => {
			if (p.y == null) { open = false; return; }
			const x = (CH.l + slot * (i + 0.5)).toFixed(1), y = yPix(p.y, lsc).toFixed(1);
			d += (open ? " L" : " M") + x + "," + y;
			open = true;
		});
		g += `<path class="ln ${line.cls}" d="${d.trim()}"/>`;
		line.pts.forEach((p, i) => {
			if (p.y == null) return;
			g += `<circle class="dot ${line.cls}" cx="${(CH.l + slot * (i + 0.5)).toFixed(1)}" cy="${yPix(p.y, lsc).toFixed(1)}" r="2.6"/>`;
		});
	}
	return chartFrame(g, opts.note);
}

function scatterChart(pts, opts) {
	opts = opts || {};
	if (!pts.length) return `<div class="chart-empty">no data yet</div>`;
	const ysc = scaleY(pts.map(p => p.y), true);
	const xs = pts.map(p => p.x);
	let xlo = 0, xhi = Math.max(...xs, 1);
	xhi = xhi + (xhi - xlo) * 0.12;
	const plotB = CH.h - CH.b;
	let g = axes(ysc, [], 1);
	for (let i = 0; i <= 3; i++) {
		const v = xlo + (xhi - xlo) * (i / 3);
		const x = CH.l + (CH.w - CH.l - CH.r) * (i / 3);
		g += `<text class="tick" x="${x.toFixed(1)}" y="${plotB + 13}" text-anchor="middle">${fmtTick(v)}</text>`;
	}
	for (const p of pts) {
		const x = CH.l + (CH.w - CH.l - CH.r) * ((p.x - xlo) / (xhi - xlo || 1));
		g += `<circle class="dot c1" cx="${x.toFixed(1)}" cy="${yPix(p.y, ysc).toFixed(1)}" r="3.4"/>`;
	}
	return chartFrame(g, opts.note);
}

function legend(items) {
	return `<div class="legend">` + items.map(i =>
		`<span class="lg"><i class="sw ${i.cls}"></i>${esc(i.label)}</span>`
	).join("") + `</div>`;
}

function card(title, sub, body) {
	return `<div class="card graph-card">
		<div class="graph-title">${esc(title)}</div>
		${sub ? `<div class="graph-sub">${esc(sub)}</div>` : ""}
		${body}
	</div>`;
}

/* ---------- the page ---------- */

let graphLift = null;

function renderGraphs() {
	const host = el("day-card");
	el("checkin-slot").innerHTML = "";
	const sets = doneSets(person);
	if (!sets.length) {
		host.innerHTML = `<div class="card">Nothing logged yet for ${person}. Graphs appear as soon as there are sets in the log — they read the same shared history the coach does.</div>`;
		return;
	}

	const lifts = liftsAvailable(person);
	if (!graphLift || !lifts.includes(graphLift)) graphLift = lifts.includes("bench") ? "bench" : lifts[0];
	let html = "";

	// 1. estimated 1RM — the progress line
	if (lifts.length) {
		const pick = `<div class="lift-pick">` + lifts.map(l =>
			`<button class="chip ${l === graphLift ? "on" : ""}" data-lift="${esc(l)}">${esc(l)}</button>`
		).join("") + `</div>`;
		const s = e1rmWeekly(person, graphLift);
		const filled = s.filter(p => p.y != null).length;
		html += card("Estimated 1RM — " + graphLift, "best set of each week · Epley with RPE spent as reps in reserve",
			pick + lineChart([{ pts: s, cls: "c1" }], s.map(p => shortDate(p.x)),
				{ note: filled < 2 ? "one week in — this becomes a trend from week 2" : null }));
	}

	// 2. volume against progress: tonnage and hard sets kept on their own axes
	// rather than fudged onto one, then read against the same e1RM line
	const load = weeklyLiftLoad(person, graphLift);
	html += card("Volume vs progress — " + graphLift, "weekly tonnage (bars) against best e1RM that week (line)",
		comboChart(
			load.map(r => ({ label: shortDate(r.week), values: [r.tonnage] })),
			[{ cls: "c2" }],
			{ pts: load.map(r => ({ y: r.best })), cls: "c1" }
		) + legend([{ cls: "c2", label: "tonnage (lb)" }, { cls: "c1", label: "best e1RM" }])
		+ `<div class="graph-sub" style="margin-top:12px">Hard sets per week (RPE ≥ 7)</div>`
		+ comboChart(load.map(r => ({ label: shortDate(r.week), values: [r.hardSets] })), [{ cls: "c3" }], null));

	// 3. RPE drift at fixed %
	const drift = rpeDrift(person, graphLift);
	if (drift.length) {
		const weeks = drift[0].pts.map(p => shortDate(p.x));
		html += card("RPE drift at fixed %", "same prescribed load, week over week · falling = stronger, climbing = deload",
			lineChart(drift.map((d, i) => ({ pts: d.pts, cls: "c" + (i % 6 + 1) })), weeks, {})
			+ legend(drift.map((d, i) => ({ cls: "c" + (i % 6 + 1), label: d.pct + "%" }))));
	}

	// 4. knee dose-response (Manny)
	const knee = kneeDose(person);
	if (knee.length) {
		// only mornings that actually follow leg work are a dose; the rest are the
		// baseline this is measured against
		const dosed = knee.filter(k => k.x > 0);
		const rest = knee.filter(k => k.x === 0);
		const base = rest.length ? (rest.reduce((s, k) => s + k.y, 0) / rest.length).toFixed(1) : null;
		let note = dosed.length < 5 ? "a handful of points is a hint, not a curve" : "";
		if (base != null) note += (note ? " · " : "") + "baseline after non-leg days: " + base + " (" + rest.length + " mornings)";
		html += card("Knee: next morning vs previous day's leg load", "x = leg tonnage the day before · y = morning knee score",
			scatterChart(dosed, { note }));
		const line = checkinSeries(person, "knee_am");
		html += card("Knee score over time", "the gate: worse next morning means the dose was too high",
			lineChart([{ pts: line, cls: "c4" }], line.map(p => shortDate(p.x)), { zeroBase: true }));
	}

	// 5. hard sets per muscle
	const mus = weeklyMuscleSets(person);
	if (mus.muscles.length) {
		html += card("Hard sets per muscle per week", "RPE ≥ 7 · a set counts toward every muscle it trains, so totals overlap",
			comboChart(
				mus.weeks.map((w, wi) => ({ label: shortDate(w), values: mus.muscles.map(m => m.counts[wi]) })),
				mus.muscles.map((m, i) => ({ cls: "c" + (i % 6 + 1) })),
				null
			) + legend(mus.muscles.map((m, i) => ({ cls: "c" + (i % 6 + 1), label: m.name }))));
	}

	// 6. sleep vs session quality (weekly averages)
	const sq = weeklySleepQuality(person);
	if (sq.some(r => r.sleep != null || r.quality != null)) {
		html += card("Sleep vs session quality", "weekly averages · hours in bed against how sessions felt",
			lineChart([
				{ pts: sq.map(r => ({ x: r.week, y: r.sleep })), cls: "c5" },
				{ pts: sq.map(r => ({ x: r.week, y: r.quality })), cls: "c1" }
			], sq.map(r => shortDate(r.week)), { zeroBase: true, note: "two people and a few weeks is not enough to call a correlation real" })
			+ legend([{ cls: "c5", label: "avg hours in bed" }, { cls: "c1", label: "avg session 1–5" }]));
	}

	// 7. bodyweight and relative strength
	const bw = bodyweightSeries(person);
	if (bw.length) {
		const byDate = new Map(e1rmSeries(person, graphLift).map(p => [p.x, p.y]));
		const rel = bw.map(p => ({ x: p.x, y: byDate.has(p.x) ? +(byDate.get(p.x) / p.y).toFixed(2) : null }));
		html += card("Bodyweight", "and " + graphLift + " e1RM per pound of you, where both were logged the same day",
			lineChart([{ pts: bw, cls: "c6" }], bw.map(p => shortDate(p.x)), {})
			+ (rel.some(r => r.y != null)
				? lineChart([{ pts: rel, cls: "c1" }], rel.map(p => shortDate(p.x)), { note: "e1RM ÷ bodyweight" })
				: ""));
	}

	// 8. adherence
	const adh = adherence(person);
	if (adh.length) {
		html += card("Adherence", "sets completed against sets prescribed",
			comboChart(
				adh.map(r => ({ label: shortDate(r.week), values: [r.prescribed, r.done] })),
				[{ cls: "c3" }, { cls: "c2" }], null
			) + legend([{ cls: "c3", label: "prescribed" }, { cls: "c2", label: "completed" }])
			+ (adh.some(r => r.reasons.length)
				? `<div class="reasons">${adh.filter(r => r.reasons.length).map(r =>
					`<div class="reason-wk">wk of ${shortDate(r.week)}</div>` +
					r.reasons.map(x => `<div class="reason">• ${esc(x)}</div>`).join("")
				).join("")}</div>`
				: `<div class="chart-note">nothing skipped yet</div>`));
	}

	const assumed = sets.filter(s => s.assumedReps && s.reps != null).length;
	html += `<div class="card chart-note">Reps were taken from the prescription on ${assumed} of ${sets.length} logged sets — that is the "assume they were hit" default, and only edited sets differ.</div>`;

	host.innerHTML = html;
	host.querySelectorAll("[data-lift]").forEach(b => {
		b.onclick = () => { graphLift = b.dataset.lift; renderGraphs(); };
	});
}

/* ---------- program view ---------- */

function renderProgramView() {
	el("checkin-slot").innerHTML = "";
	const w = weekDef();
	let html = `<div class="card">
		<div class="graph-title">${esc(prog.meso || prog.title)}</div>
		<div class="graph-sub">Week ${w.week} · wk of ${w.week_of}${w.label ? " · " + esc(w.label) : ""}</div>
		<div class="prog-maxes">${prog.people.map(p =>
			`<div class="${p === person ? "mine-line" : ""}"><span class="rx-tag ${p}">${p.toUpperCase()}</span> ` +
			Object.entries(prog.maxes[p] || {}).map(([k, v]) => k + " " + v).join(" · ") + `</div>`
		).join("")}</div>
	</div>`;

	for (const day of w.days) {
		html += `<div class="card">
			<div class="graph-title">${day.key.toUpperCase()} — ${esc(day.title)}</div>
			${day.exercises.map(ex => {
				const mine = ex.for === "both" || ex.for === person;
				return `<div class="prog-ex ${mine ? "" : "not-yours"}">
					<div class="prog-ex-name">${esc(ex.name)}${ex.tags ? `<span class="tags">${ex.tags.map(t => esc(t)).join(" · ")}</span>` : ""}</div>
					${rxLines(ex)}
				</div>`;
			}).join("")}
		</div>`;
	}

	html += `<div class="card">
		<div class="graph-title">Standing rules</div>
		${(prog.rules || []).map(r => `<div class="reason">• ${esc(r)}</div>`).join("")}
	</div>`;
	el("day-card").innerHTML = html;
}
