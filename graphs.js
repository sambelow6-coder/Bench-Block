/* Bench Block — graphs. Hand-rolled SVG (no libraries, works offline, scales
   on a phone). Reads only from analytics.js; computes nothing itself. */

"use strict";

const CH = { w: 340, h: 222, l: 54, r: 14, t: 16, b: 52 };

function chartFrame(inner, note) {
	return `<svg viewBox="0 0 ${CH.w} ${CH.h}" class="chart" role="img">${inner}</svg>`
		+ (note ? `<div class="chart-note">${note}</div>` : "");
}

/* An empty chart is still a chart: same frame, same axis captions, same week
   columns — just no series, and no invented y-values pretending to be a scale. */
function emptyFrame(xLabels, opts) {
	let g = axes({ lo: 0, hi: 1 }, xLabels || [], opts.everyNth, true) + axisLabels(opts.yLabel, opts.xLabel);
	const cx = CH.l + (CH.w - CH.l - CH.r) / 2;
	const cy = CH.t + (CH.h - CH.t - CH.b) / 2;
	g += `<text class="nodata" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle">no data yet</text>`;
	return chartFrame(g, opts.emptyMsg);
}

/* Axis captions. Without these a reader has to guess what the numbers are. */
function axisLabels(yLabel, xLabel) {
	let g = "";
	if (yLabel) {
		const cy = CH.t + (CH.h - CH.t - CH.b) / 2;
		g += `<text class="axlab" x="11" y="${cy.toFixed(1)}" text-anchor="middle" transform="rotate(-90 11 ${cy.toFixed(1)})">${esc(yLabel)}</text>`;
	}
	if (xLabel) {
		g += `<text class="axlab" x="${(CH.l + (CH.w - CH.l - CH.r) / 2).toFixed(1)}" y="${CH.h - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
	}
	return g;
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

function axes(sc, xLabels, everyNth, noYNums) {
	const plotB = CH.h - CH.b;
	let g = `<line class="ax" x1="${CH.l}" y1="${CH.t}" x2="${CH.l}" y2="${plotB}"/>
		<line class="ax" x1="${CH.l}" y1="${plotB}" x2="${CH.w - CH.r}" y2="${plotB}"/>`;
	const ticks = 4;
	for (let i = 0; i <= ticks; i++) {
		const v = sc.lo + (sc.hi - sc.lo) * (i / ticks);
		const y = yPix(v, sc);
		g += `<line class="grid" x1="${CH.l}" y1="${y.toFixed(1)}" x2="${CH.w - CH.r}" y2="${y.toFixed(1)}"/>`;
		if (!noYNums) g += `<text class="tick" x="${CH.l - 6}" y="${(y + 3.4).toFixed(1)}" text-anchor="end">${fmtTick(v)}</text>`;
	}
	const step = everyNth || Math.ceil(xLabels.length / 6) || 1;
	xLabels.forEach((lb, i) => {
		if (i % step) return;
		g += `<text class="tick" x="${xPix(i, xLabels.length).toFixed(1)}" y="${plotB + 15}" text-anchor="middle">${esc(lb)}</text>`;
	});
	return g;
}

function fmtTick(v) {
	const a = Math.abs(v);
	if (a >= 10000) return Math.round(v / 1000) + "k";
	if (a >= 1000) return (v / 1000).toFixed(1) + "k";
	if (Number.isInteger(v)) return String(v);      // counts read as 1, not 1.0
	return a >= 10 ? String(Math.round(v)) : v.toFixed(1);
}

function shortDate(d) { return d.slice(5).replace("-", "/"); }

/* One or more line series over shared categorical x positions. */
function lineChart(series, xLabels, opts) {
	opts = opts || {};
	const all = series.flatMap(s => s.pts.map(p => p.y));
	const sc = scaleY(all, opts.zeroBase);
	if (!sc || !all.some(v => v != null && isFinite(v))) return emptyFrame(xLabels, opts);
	let g = axes(sc, xLabels, opts.everyNth) + axisLabels(opts.yLabel, opts.xLabel);
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
		let last = -1;
		s.pts.forEach((p, i) => {
			if (p.y == null) return;
			last = i;
			g += `<circle class="dot ${cls}" cx="${xPix(i, s.pts.length).toFixed(1)}" cy="${yPix(p.y, sc).toFixed(1)}" r="2.6"/>`;
		});
		// call out the newest value; it's the one being read for a decision
		if (last >= 0 && opts.labelLast !== false) {
			const p = s.pts[last];
			const x = xPix(last, s.pts.length), y = yPix(p.y, sc);
			const flip = x > CH.w - CH.r - 26;
			g += `<text class="ptlab ${cls}" x="${(x + (flip ? -5 : 5)).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="${flip ? "end" : "start"}">${fmtTick(p.y)}</text>`;
		}
	});
	return chartFrame(g, opts.note);
}

/* Bars (optionally grouped) with an optional line overlaid on its own scale. */
function comboChart(groups, bars, line, opts) {
	opts = opts || {};
	const barVals = groups.flatMap(g => g.values.filter(v => v != null));
	const lineVals = line ? line.pts.map(p => p.y).filter(v => v != null) : [];
	if (!barVals.some(v => v !== 0) && !lineVals.length) return emptyFrame(groups.map(x => x.label), opts);
	const bsc = scaleY(barVals.length ? barVals : [0], true);
	let g = axes(bsc, groups.map(x => x.label), opts.everyNth) + axisLabels(opts.yLabel, opts.xLabel);
	const plotB = CH.h - CH.b;
	const labelBars = groups.length * Math.max(bars.length, 1) <= 10;
	const slot = (CH.w - CH.l - CH.r) / Math.max(groups.length, 1);
	const bw = Math.max(3, slot / Math.max(bars.length, 1) * 0.62);
	groups.forEach((grp, gi) => {
		grp.values.forEach((v, bi) => {
			if (v == null) return;
			const cx = CH.l + slot * (gi + 0.5) + (bi - (bars.length - 1) / 2) * bw * 1.08;
			const y = yPix(v, bsc);
			g += `<rect class="bar ${bars[bi].cls}" x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, plotB - y).toFixed(1)}" rx="1.5"/>`;
			if (labelBars) g += `<text class="barlab" x="${cx.toFixed(1)}" y="${(y - 3.5).toFixed(1)}" text-anchor="middle">${fmtTick(v)}</text>`;
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
	if (!pts.length) return emptyFrame([], opts);
	const ysc = scaleY(pts.map(p => p.y), true);
	const xs = pts.map(p => p.x);
	let xlo = 0, xhi = Math.max(...xs, 1);
	xhi = xhi + (xhi - xlo) * 0.12;
	const plotB = CH.h - CH.b;
	let g = axes(ysc, [], 1) + axisLabels(opts.yLabel, opts.xLabel);
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
	const lifts = liftsAvailable(person);
	// every card renders in every state; an empty one shows its own frame and
	// says what would fill it, rather than the page hiding itself
	if (!graphLift || !lifts.includes(graphLift)) graphLift = lifts.includes("bench") ? "bench" : lifts[0];
	let html = sets.length ? "" :
		`<div class="card chart-note">Nothing logged for ${esc(person)} yet — every chart below is waiting on data and says what would fill it.</div>`;
	if (!graphLift || !lifts.includes(graphLift)) graphLift = lifts.includes("bench") ? "bench" : lifts[0];

	// 1. estimated 1RM — the progress line
	if (lifts.length) {
		const pick = `<div class="lift-pick">` + lifts.map(l =>
			`<button class="chip ${l === graphLift ? "on" : ""}" data-lift="${esc(l)}">${esc(l)}</button>`
		).join("") + `</div>`;
		const s = e1rmWeekly(person, graphLift);
		const filled = s.filter(p => p.y != null).length;
		html += card("Estimated 1RM — " + graphLift, "best set of each week · Epley with RPE spent as reps in reserve",
			pick + lineChart([{ pts: s, cls: "c1" }], s.map(p => shortDate(p.x)), {
				yLabel: "est. 1RM (lb)", xLabel: "week beginning",
				emptyMsg: "needs weight + reps + RPE on a set — log a weight and this fills in",
				note: filled === 1 ? "one week in — this becomes a trend from week 2" : null
			}));
	}

	// 2. volume against progress: tonnage and hard sets keep their own axes
	// rather than being fudged onto one
	const load = weeklyLiftLoad(person, graphLift);
	const noWeight = load.reduce((s, r) => s + r.noWeight, 0);
	html += card("Volume vs progress — " + (graphLift || "—"), "is more work actually buying strength?",
		comboChart(
			load.map(r => ({ label: shortDate(r.week), values: [r.tonnage] })),
			[{ cls: "c2" }],
			{ pts: load.map(r => ({ y: r.best })), cls: "c1" },
			{
				yLabel: "tonnage (lb)", xLabel: "week beginning",
				emptyMsg: "no weights logged for " + (graphLift || "this lift") + " yet",
				note: noWeight ? noWeight + " logged set" + (noWeight > 1 ? "s" : "") + " had no weight entered, so they add nothing to the tonnage rather than counting as zero" : null
			}
		) + legend([{ cls: "c2", label: "weekly tonnage — weight × reps, all sets" }, { cls: "c1", label: "best e1RM that week" }])
		+ `<div class="graph-sub sub-head">Hard sets per week — sets taken at RPE 7 or above</div>`
		+ comboChart(load.map(r => ({ label: shortDate(r.week), values: [r.hardSets] })), [{ cls: "c3" }], null,
			{ yLabel: "hard sets", xLabel: "week beginning", emptyMsg: "no sets at RPE 7+ yet" }));

	// 3. RPE drift at fixed %
	const drift = rpeDrift(person, graphLift);
	const wkLabels = axisWeeks(person).map(shortDate);
	html += card("RPE drift at fixed %", "same load, week over week · falling = stronger, climbing = deload",
		lineChart(drift.map((d, i) => ({ pts: d.pts, cls: "c" + (i % 6 + 1) })), drift.length ? drift[0].pts.map(p => shortDate(p.x)) : wkLabels,
			{ yLabel: "average RPE", xLabel: "week beginning", emptyMsg: "fills in once a percentage-based set is logged" })
		+ (drift.length ? legend(drift.map((d, i) => ({ cls: "c" + (i % 6 + 1), label: d.pct + "% of max" }))) : ""));

	// 4. knee dose-response (Manny)
	const knee = kneeDose(person);
	const hasKneeCheck = (prog.checkins || []).some(c => c.person === person && c.id === "knee_am");
	if (hasKneeCheck || knee.length) {
		// only mornings that actually follow leg work are a dose; the rest are the
		// baseline this is measured against
		const dosed = knee.filter(k => k.x > 0);
		const rest = knee.filter(k => k.x === 0);
		const base = rest.length ? (rest.reduce((s, k) => s + k.y, 0) / rest.length).toFixed(1) : null;
		let note = dosed.length < 5 ? "a handful of points is a hint, not a curve" : "";
		if (base != null) note += (note ? " · " : "") + "baseline after non-leg days: " + base + " (" + rest.length + " mornings)";
		html += card("Knee dose-response", "each dot is one morning after a leg day · further right = heavier the day before, higher = angrier knee",
			scatterChart(dosed, { yLabel: "morning knee 0–5", xLabel: "leg tonnage the day before (lb)", note, emptyMsg: "no morning check-in yet that followed a leg day" }));
		const line = checkinSeries(person, "knee_am");
		html += card("Knee score over time", "the gate: worse the next morning means the dose was too high",
			lineChart([{ pts: line, cls: "c4" }], line.map(p => shortDate(p.x)),
				{ zeroBase: true, yLabel: "morning knee 0–5", xLabel: "date", emptyMsg: "no morning knee check-ins logged yet" }));
	}

	// 5. hard sets per muscle
	const mus = weeklyMuscleSets(person);
	html += card("Hard sets per muscle per week", "RPE ≥ 7 · a set counts toward every muscle it trains, so bars overlap",
		comboChart(
			mus.muscles.length
				? mus.weeks.map((w, wi) => ({ label: shortDate(w), values: mus.muscles.map(m => m.counts[wi]) }))
				: wkLabels.map(l => ({ label: l, values: [0] })),
			mus.muscles.length ? mus.muscles.map((m, i) => ({ cls: "c" + (i % 6 + 1) })) : [{ cls: "c1" }],
			null,
			{ yLabel: "hard sets", xLabel: "week beginning", emptyMsg: "fills in once a set is logged at RPE 7 or above" }
		) + (mus.muscles.length ? legend(mus.muscles.map((m, i) => ({ cls: "c" + (i % 6 + 1), label: m.name }))) : ""));

	// 6. sleep vs session quality (weekly averages)
	const sq = weeklySleepQuality(person);
	html += card("Sleep vs session quality", "weekly averages · blank days are skipped, never counted as zero",
		lineChart([
			{ pts: sq.map(r => ({ x: r.week, y: r.sleep })), cls: "c5" },
			{ pts: sq.map(r => ({ x: r.week, y: r.quality })), cls: "c1" }
		], sq.map(r => shortDate(r.week)), {
			zeroBase: true, yLabel: "hours / rating", xLabel: "week beginning",
			emptyMsg: "fills in from the morning sleep entry and the session rating",
			note: sq.some(r => r.sleep != null) ? "two people over a few weeks is not enough to call a correlation real" : null
		})
		+ legend([{ cls: "c5", label: "avg hours in bed" }, { cls: "c1", label: "avg session rating 1–5" }]));

	// 7. bodyweight and relative strength
	const bw = bodyweightSeries(person);
	const byDate = new Map(e1rmSeries(person, graphLift).map(p => [p.x, p.y]));
	const rel = bw.map(p => ({ x: p.x, y: byDate.has(p.x) ? +(byDate.get(p.x) / p.y).toFixed(2) : null }));
	html += card("Bodyweight", "with relative strength underneath, on days both were logged",
		lineChart([{ pts: bw, cls: "c6" }], bw.map(p => shortDate(p.x)),
			{ yLabel: "bodyweight (lb)", xLabel: "date", emptyMsg: "fills in from the bodyweight entry in the morning check-in" })
		+ `<div class="graph-sub sub-head">Relative strength — ${esc(graphLift || "lift")} e1RM per pound of you</div>`
		+ lineChart([{ pts: rel, cls: "c1" }], rel.map(p => shortDate(p.x)),
			{ yLabel: "e1RM ÷ bodyweight", xLabel: "date", emptyMsg: "needs a bodyweight and a weighted set on the same day" }));

	// 8. adherence
	const adh = adherence(person);
	if (adh.length) {
		// keep this last; it is the only card that is meaningless without a program
		html += card("Adherence", "how much of the written program actually got done",
			comboChart(
				adh.map(r => ({ label: shortDate(r.week), values: [r.prescribed, r.done] })),
				[{ cls: "c3" }, { cls: "c2" }], null,
				{ yLabel: "sets", xLabel: "week beginning" }
			) + legend([{ cls: "c3", label: "sets prescribed" }, { cls: "c2", label: "sets completed" }])
			+ adh.map(r => `<div class="adh-line">wk of ${shortDate(r.week)} — <b>${r.done} of ${r.prescribed} sets</b> (${Math.round(r.done / r.prescribed * 100)}%)${r.skippedSets ? ", " + r.skippedSets + " skipped" : ""}${r.skippedDays ? ", " + r.skippedDays + " day off-plan" : ""}</div>`).join("")
			+ (adh.some(r => r.reasons.length)
				? `<div class="reasons">${adh.filter(r => r.reasons.length).map(r =>
					`<div class="reason-wk">wk of ${shortDate(r.week)}</div>` +
					r.reasons.map(x => `<div class="reason">• ${esc(x)}</div>`).join("")
				).join("")}</div>`
				: `<div class="chart-note">nothing skipped yet</div>`));
	}

	if (sets.length) {
		const assumed = sets.filter(s => s.assumedReps && s.reps != null).length;
		html += `<div class="card chart-note">Reps were taken from the prescription on ${assumed} of ${sets.length} logged sets — that is the "assume they were hit" default, and only edited sets differ. Anything left blank counts as missing, never as zero.</div>`;
	}

	host.innerHTML = html;
	host.querySelectorAll("[data-lift]").forEach(b => {
		b.onclick = () => { graphLift = b.dataset.lift; renderGraphs(); };
	});
}

/* ---------- program view ---------- */

/* The shape of the prescription without the weights, which change every week.
   Built from the structured fields, never parsed back out of the rx text. */
function schemeLine(ex) {
	const bits = [];
	const raw = String((typeof ex.rx === "string" ? ex.rx : (ex.rx ? ex.rx[prog.people[0]] : "")) || "");
	const reps = ex.reps;

	if (ex.timed) {
		const dur = raw.match(/\d+\s*(?:sec|min)\b/i);
		bits.push(ex.sets + " × " + (dur ? dur[0] : "") + " holds");
	} else if (ex.amrap) bits.push(ex.sets + " × AMRAP");
	else if (reps && typeof reps === "object") {
		bits.push(ex.sets + " sets · " + prog.people.filter(p => reps[p] != null).map(p => p + " " + reps[p]).join(" / ") + " reps");
	} else if (reps != null) bits.push(ex.sets + "×" + reps);
	else bits.push(ex.sets + " sets");

	const pct = ex.pct;
	if (pct && typeof pct === "object") {
		const parts = prog.people.filter(p => pct[p] != null).map(p => pct[p] + "% (" + p + ")");
		if (parts.length) bits.push(parts.join(", ") + (parts.length < prog.people.length ? ", RPE for the rest" : ""));
	} else if (pct != null) bits.push(pct + "% of max");
	else bits.push("by RPE");

	// keep the coaching cues from the rx text; drop loads, rep schemes and durations
	const cue = raw.split("·").map(s => s.trim()).filter(s =>
		s && !/lb|%\)/.test(s) && !/^\d+\s*×/.test(s) && !/^\d+ sets/.test(s) && !/^RPE/.test(s) && !/^\d+\s*(?:sec|min)\b/i.test(s)
	);
	if (cue.length) bits.push(cue.join(" · "));
	return bits.join(" · ");
}

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
			${day.exercises.length ? day.exercises.map(ex => {
				const mine = ex.for === "both" || ex.for === person;
				return `<div class="prog-ex ${mine ? "" : "not-yours"}">
					<div class="prog-ex-name">${esc(ex.name)}${ex.for !== "both" ? `<span class="rx-tag ${ex.for}"> ${ex.for.toUpperCase()} ONLY</span>` : ""}</div>
					<div class="prog-scheme">${esc(schemeLine(ex))}</div>
					${ex.tags ? `<div class="tags">${ex.tags.map(t => esc(t)).join(" · ")}</div>` : ""}
				</div>`;
			}).join("") : `<div class="prog-scheme">No lifting — morning check-in only (sleep, bodyweight, and the ${person === "manny" ? "knee" : "back"} score).</div>`}
		</div>`;
	}

	html += `<div class="card">
		<div class="graph-title">Standing rules</div>
		${(prog.rules || []).map(r => `<div class="reason">• ${esc(r)}</div>`).join("")}
	</div>`;
	el("day-card").innerHTML = html;
}
