/* Bench Block — analytics. Pure derivation from `entries` + `prog`; nothing
   here renders or mutates. Every derived training number lives in exactly one
   function so the graphs and the coach can never disagree.
   Assumes app.js has merged prog.library into each week's exercise defs. */

"use strict";

const HARD_RPE = 7;          // a "hard set" for volume-counting purposes
const LEG_TAGS = ["quads", "hams", "glutes"];

function ymd(d) {
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* number-or-{person:number} → number */
function perPerson(v, person) {
	return v && typeof v === "object" ? v[person] : v;
}

function defOf(id) {
	// ad-hoc additions carry their own identity on the add record
	if (id && id.indexOf("add:") === 0) {
		const a = entries.find(e => e.type === "add" && e.id === id.slice(4));
		return a ? { name: a.exName, tags: a.tags || [], reps: a.reps != null ? a.reps : null } : null;
	}
	if (!prog) return null;
	for (const w of prog.weeks) {
		for (const d of w.days) {
			for (const ex of d.exercises) if (ex.id === id) return ex;
		}
	}
	return null;
}

/* Monday of the week containing dateStr */
function weekStart(dateStr) {
	const d = new Date(dateStr + "T12:00:00");
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return ymd(d);
}

function prevDay(dateStr) {
	const d = new Date(dateStr + "T12:00:00");
	d.setDate(d.getDate() - 1);
	return ymd(d);
}

/* Epley, with RPE spent as reps-in-reserve. Validated against Sam's own
   280×3 @ RPE 9.5 → 313, which is where he self-assessed (315). */
function e1rm(weight, reps, rpe) {
	if (!weight || !reps) return null;
	const rir = rpe == null ? 0 : Math.max(0, 10 - rpe);
	return weight * (1 + (reps + rir) / 30);
}

/* Completed sets only: an RPE was tapped and the set was not skipped. Reps
   fall back to the prescription, which is what "assume they were hit" means. */
function doneSets(person) {
	return entries.filter(e => e.type === "set" && e.person === person && !e.skipped && e.rpe != null)
		.map(e => {
			const def = defOf(e.ex) || {};
			const reps = e.reps != null ? e.reps : perPerson(def.reps, person);
			return {
				date: e.date, ex: e.ex, set: e.set, rpe: e.rpe,
				weight: e.weight != null ? e.weight : null,
				reps: reps != null ? reps : null,
				assumedReps: e.reps == null,
				lift: def.lift || null, tags: def.tags || [],
				pct: perPerson(def.pct, person) || null,
				tonnage: (e.weight != null && reps != null) ? e.weight * reps : 0
			};
		});
}

/* Any lift with logged sets — weight not required, so the picker still works
   before anyone has typed a weight (the e1RM chart says so itself instead of
   the page silently having no selected lift). */
function liftsAvailable(person) {
	const s = new Set();
	for (const d of doneSets(person)) if (d.lift) s.add(d.lift);
	if (!s.size) for (const w of prog.weeks) for (const dy of w.days) for (const ex of dy.exercises) {
		if (ex.lift && (ex.for === "both" || ex.for === person)) s.add(ex.lift);
	}
	return [...s].sort();
}

/* Best estimated 1RM per WEEK — the trend line. Per-session values sawtooth by
   design (heavy day always outranks the moderate day), which reads as noise
   rather than progress, so the week's best set is the honest signal. */
function e1rmWeekly(person, lift) {
	const weeks = weeksWithData(person);
	const best = new Map();
	for (const d of doneSets(person)) {
		if (d.lift !== lift || d.weight == null || d.reps == null) continue;
		const v = e1rm(d.weight, d.reps, d.rpe);
		if (v == null) continue;
		const wk = weekStart(d.date);
		if (!best.has(wk) || v > best.get(wk)) best.set(wk, v);
	}
	return weeks.map(w => ({ x: w, y: best.has(w) ? Math.round(best.get(w)) : null }));
}

/* Best estimated 1RM per training day for one lift. */
function e1rmSeries(person, lift) {
	const byDate = new Map();
	for (const d of doneSets(person)) {
		if (d.lift !== lift || d.weight == null || d.reps == null) continue;
		const v = e1rm(d.weight, d.reps, d.rpe);
		if (v == null) continue;
		if (!byDate.has(d.date) || v > byDate.get(d.date)) byDate.set(d.date, v);
	}
	return [...byDate.entries()].sort().map(([date, v]) => ({ x: date, y: Math.round(v) }));
}

function weeksWithData(person) {
	const s = new Set();
	for (const e of entries) if (e.person === person && e.date) s.add(weekStart(e.date));
	return [...s].sort();
}

/* Weekly tonnage + hard sets for one lift, alongside that week's best e1RM —
   the "is more volume buying anything" view. */
function weeklyLiftLoad(person, lift) {
	const weeks = weeksWithData(person);
	const rows = weeks.map(w => ({ week: w, tonnage: 0, hardSets: 0, best: null }));
	const idx = new Map(rows.map((r, i) => [r.week, i]));
	for (const d of doneSets(person)) {
		if (d.lift !== lift) continue;
		const i = idx.get(weekStart(d.date));
		if (i == null) continue;
		rows[i].tonnage += d.tonnage;
		if (d.rpe >= HARD_RPE) rows[i].hardSets++;
		const v = e1rm(d.weight, d.reps, d.rpe);
		if (v != null && (rows[i].best == null || v > rows[i].best)) rows[i].best = v;
	}
	return rows.map(r => ({ ...r, tonnage: Math.round(r.tonnage), best: r.best == null ? null : Math.round(r.best) }));
}

/* RPE drift: same prescribed percentage, week over week. Falling = getting
   stronger; climbing = fatigue outrunning recovery (the deload alarm). */
function rpeDrift(person, lift) {
	const weeks = weeksWithData(person);
	const pcts = new Map();
	for (const d of doneSets(person)) {
		if (d.lift !== lift || !d.pct) continue;
		if (!pcts.has(d.pct)) pcts.set(d.pct, new Map());
		const wk = weekStart(d.date);
		const m = pcts.get(d.pct);
		if (!m.has(wk)) m.set(wk, []);
		m.get(wk).push(d.rpe);
	}
	return [...pcts.entries()].sort((a, b) => a[0] - b[0]).map(([pct, m]) => ({
		pct,
		pts: weeks.map(w => {
			const arr = m.get(w);
			return { x: w, y: arr ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : null };
		})
	}));
}

function legTonnageOn(person, dateStr) {
	let t = 0, hard = 0;
	for (const d of doneSets(person)) {
		if (d.date !== dateStr) continue;
		if (!d.tags.some(tg => LEG_TAGS.includes(tg))) continue;
		t += d.tonnage;
		if (d.rpe >= HARD_RPE) hard++;
	}
	return { tonnage: Math.round(t), hardSets: hard };
}

/* Dose-response: yesterday's leg load against this morning's knee score.
   The gate that drives Manny's progression. */
function kneeDose(person) {
	const out = [];
	for (const e of entries) {
		if (e.type !== "checkin" || e.ex !== "knee_am" || e.person !== person || e.rating == null) continue;
		const load = legTonnageOn(person, prevDay(e.date));
		out.push({ date: e.date, x: load.tonnage, hardSets: load.hardSets, y: e.rating });
	}
	return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

function checkinSeries(person, id) {
	return entries.filter(e => e.type === "checkin" && e.ex === id && e.person === person && e.rating != null)
		.map(e => ({ x: e.date, y: e.rating })).sort((a, b) => a.x < b.x ? -1 : 1);
}

/* Hard sets per muscle per week. A set counts fully toward every muscle its
   exercise trains — standard practice, so totals across muscles exceed total
   sets on purpose. */
function weeklyMuscleSets(person) {
	const weeks = weeksWithData(person);
	const muscles = new Map();
	for (const d of doneSets(person)) {
		if (d.rpe < HARD_RPE) continue;
		const wk = weekStart(d.date);
		for (const tg of d.tags) {
			if (!muscles.has(tg)) muscles.set(tg, new Map());
			const m = muscles.get(tg);
			m.set(wk, (m.get(wk) || 0) + 1);
		}
	}
	const names = [...muscles.keys()].sort();
	return {
		weeks,
		muscles: names.map(n => ({ name: n, counts: weeks.map(w => muscles.get(n).get(w) || 0) }))
	};
}

/* Weekly averages: hours in bed vs how the sessions actually felt. */
function weeklySleepQuality(person) {
	const weeks = weeksWithData(person);
	const sleep = new Map(), qual = new Map();
	const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
	for (const e of entries) {
		if (e.person !== person || !e.date) continue;
		const wk = weekStart(e.date);
		if (e.type === "sleep" && e.hours != null) push(sleep, wk, e.hours);
		if (e.type === "session" && e.rating != null) push(qual, wk, e.rating);
	}
	const avg = (m, w) => {
		const a = m.get(w);
		return a && a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null;
	};
	return weeks.map(w => ({ week: w, sleep: avg(sleep, w), quality: avg(qual, w) }));
}

function bodyweightSeries(person) {
	return entries.filter(e => e.type === "bodyweight" && e.person === person && e.lb != null)
		.map(e => ({ x: e.date, y: e.lb })).sort((a, b) => a.x < b.x ? -1 : 1);
}

/* Prescribed vs completed, plus why anything was missed. */
function adherence(person) {
	const weeks = weeksWithData(person);
	const rows = weeks.map(w => ({ week: w, prescribed: 0, done: 0, skippedSets: 0, skippedDays: 0, reasons: [] }));
	const idx = new Map(rows.map((r, i) => [r.week, i]));

	for (const w of prog.weeks) {
		const i = idx.get(weekStart(w.week_of));
		if (i == null) continue;
		for (const day of w.days) {
			for (const ex of day.exercises) {
				if (ex.for === "both" || ex.for === person) rows[i].prescribed += ex.sets || 0;
			}
		}
	}
	for (const e of entries) {
		if (e.person !== person || !e.date) continue;
		const i = idx.get(weekStart(e.date));
		if (i == null) continue;
		if (e.type === "set" && e.skipped) { rows[i].skippedSets++; if (e.note) rows[i].reasons.push(e.exName + " set " + e.set + ": " + e.note); }
		else if (e.type === "set" && e.rpe != null) rows[i].done++;
		else if (e.type === "skip" && !e.retracted) { rows[i].skippedDays++; rows[i].reasons.push("whole day (" + e.day + ")" + (e.note ? ": " + e.note : "")); }
		else if (e.type === "exskip" && !e.retracted) rows[i].reasons.push((e.exName || e.ex) + " skipped" + (e.note ? ": " + e.note : ""));
	}
	// a week with no prescription in the program (trained past the last authored
	// week) would chart as 0-prescribed and read as a failure — drop it instead
	return rows.filter(r => r.prescribed > 0);
}
