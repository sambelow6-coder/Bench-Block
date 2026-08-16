/* Bench Block — dumb terminal for the coach loop.
   All entries are append/replace records in localStorage; "Send to Coach"
   posts them to a Google Form Sam owns, whose responses land in a Sheet in
   his Drive that Claude reads at check-in. The program itself is read-only
   here: it ships with the site as program.json. */

"use strict";

const LS_ENTRIES = "bb_entries_v1";
const LS_PERSON = "bb_person";
const LS_PROG = "bb_program_cache_v1";
const APP_VERSION = "v2.1";

/* Fire-and-forget by necessity: a cross-origin form POST is opaque, so the
   browser cannot read a success response. Hence no-cors, "resend everything"
   as the safety net, and dedup on the reading end — latest ts per logical
   fact wins, so duplicate rows are harmless. */
const FORM_ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSd76kw58-fu-5CqhWPLMrgkE722sbdrZxnKqRsPxVINx-AIWQ/formResponse";
const FORM_FIELD = "entry.1121346272";
const CHUNK_CHARS = 30000;

/* Read-back: the same response Sheet, fetched as CSV, is the shared log. Both
   lifters' entries merge into every device, so the sheet — not any one phone —
   is the durable store. Needs the sheet set to "anyone with the link can view". */
const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1SPE64Lt0Z-xZrLL5ow1373zmslKS_PtFD_LBVCggNgk/gviz/tq?tqx=out:csv";

let prog = null;
let person = localStorage.getItem(LS_PERSON) || "sam";
let selectedDay = null;
let viewWeek = null;
let view = "log";
let entries = load(LS_ENTRIES, []);

const DAY_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

function weekDef() {
	return prog.weeks.find(w => w.week === viewWeek) || prog.weeks[0];
}
function dayDateStr(w, dayKey) {
	const d = new Date(w.week_of + "T12:00:00");
	d.setDate(d.getDate() + (DAY_OFFSET[dayKey] || 0));
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ---------- tiny utils ---------- */

function load(key, fallback) {
	try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
	catch (e) { return fallback; }
}
function save() { localStorage.setItem(LS_ENTRIES, JSON.stringify(entries)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() {
	const d = new Date();
	return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function esc(s) {
	return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function el(id) { return document.getElementById(id); }

function toast(msg, bad) {
	const t = document.createElement("div");
	t.className = "toast";
	if (bad) t.style.background = "var(--bad)";
	t.textContent = msg;
	document.body.appendChild(t);
	setTimeout(() => t.remove(), 2200);
}

/* ---------- entry store ----------
   upsert: one logical fact (this person, this date, this slot) has one
   record; changing it rewrites the record and re-flags it unsynced, so
   corrections reach the coach as data, not silence. */

function findEntry(match) {
	return entries.find(e => Object.keys(match).every(k => e[k] === match[k]));
}
function upsert(match, data) {
	let e = findEntry(match);
	if (e) { Object.assign(e, data, { ts: new Date().toISOString(), synced: false }); }
	else {
		e = Object.assign({ id: uid(), ts: new Date().toISOString(), person, date: todayStr(), synced: false }, match, data);
		entries.push(e);
	}
	save();
	return e;
}
function pendingCount() { return entries.filter(e => !e.synced).length; }

/* One logical fact = one key, matching the upsert match-objects above. Used to
   merge the shared sheet into this device without duplicating anything. */
function keyOf(e) {
	switch (e.type) {
		case "add": return "add|" + e.id;
		case "set": return ["set", e.person, e.date, e.ex, e.set].join("|");
		case "feel": return ["feel", e.person, e.date, e.ex, e.field].join("|");
		case "sleep": return ["sleep", e.person, e.date].join("|");
		case "session": return ["session", e.person, e.date, e.day].join("|");
		case "skip": return ["skip", e.person, e.date, e.day].join("|");
		default: return [e.type, e.person, e.date, e.ex].join("|");
	}
}

/* RFC-4180-ish: payload cells are JSON, so quotes and newlines inside cells
   are real and must survive. */
function parseCsv(text) {
	const rows = [];
	let row = [], cell = "", inQ = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQ) {
			if (c === '"') {
				if (text[i + 1] === '"') { cell += '"'; i++; }
				else inQ = false;
			} else cell += c;
		} else if (c === '"') inQ = true;
		else if (c === ",") { row.push(cell); cell = ""; }
		else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
		else if (c !== "\r") cell += c;
	}
	if (cell.length || row.length) { row.push(cell); rows.push(row); }
	return rows;
}

function mergeRemote(remote) {
	const byKey = new Map();
	for (const e of entries) byKey.set(keyOf(e), e);
	let changed = 0;
	for (const r of remote) {
		if (!r || !r.type) continue;
		const k = keyOf(r);
		const mine = byKey.get(k);
		if (!mine) {
			const copy = Object.assign({}, r, { synced: true });
			entries.push(copy); byKey.set(k, copy); changed++;
		} else if (!mine.synced) {
			// an un-sent local edit is the newest thing this device knows; it wins
			// here and wins in the sheet too once it sends (latest ts per fact)
			continue;
		} else if ((r.ts || "") > (mine.ts || "")) {
			Object.assign(mine, r, { synced: true }); changed++;
		}
	}
	if (changed) save();
	return changed;
}

async function pullShared(manual) {
	if (navigator.onLine === false) { if (manual) toast("Offline — can't refresh", true); return; }
	let text;
	try {
		const r = await fetch(SHEET_CSV + "&_=" + Date.now(), { cache: "no-store" });
		if (!r.ok) throw new Error("http " + r.status);
		text = await r.text();
	} catch (e) {
		if (manual) toast("Couldn't reach the shared log", true);
		return;
	}
	const remote = [];
	for (const row of parseCsv(text)) {
		const cell = row[row.length - 1];
		if (!cell || cell.indexOf('"entries"') === -1) continue;
		try {
			const p = JSON.parse(cell);
			if (Array.isArray(p.entries)) remote.push(...p.entries);
		} catch (e) { /* a row we can't read is a row we ignore */ }
	}
	const changed = mergeRemote(remote);
	if (changed) renderAll();
	else renderFooter();
	if (manual) toast(changed ? "Pulled " + changed + " from the shared log" : "Already up to date");
}

/* ---------- program ---------- */

async function loadProgram() {
	try {
		const r = await fetch("program.json", { cache: "no-cache" });
		if (!r.ok) throw new Error("http " + r.status);
		prog = await r.json();
		localStorage.setItem(LS_PROG, JSON.stringify(prog));
	} catch (e) {
		prog = load(LS_PROG, null);
		if (!prog) {
			el("day-card").innerHTML = "<div class='card'>Couldn't load the program and no cached copy exists yet. Get online once and reopen.</div>";
			return;
		}
		toast("Offline — using cached program");
	}
	// back-compat: wrap a cached single-week program into the weeks shape
	if (!prog.weeks) prog.weeks = [{ week: prog.week || 1, week_of: prog.week_of, days: prog.days }];
	// movement identity (name/tags/lift) lives once in the library; fold it in so
	// every consumer — cards, graphs, coach — sees one merged def
	for (const w of prog.weeks) {
		for (const d of w.days) {
			d.exercises = d.exercises.map(ex => Object.assign({}, (prog.library || {})[ex.id] || {}, ex));
		}
	}
	if (!prog.current_week) prog.current_week = prog.weeks[0].week;
	if (!viewWeek || !prog.weeks.some(w => w.week === viewWeek)) viewWeek = prog.current_week;
	if (!selectedDay) selectedDay = defaultDay();
	renderAll();
}

function defaultDay() {
	const map = { 0: "mon", 1: "mon", 2: "tue", 3: "wed", 4: "fri", 5: "fri", 6: "sat" };
	const key = map[new Date().getDay()];
	const days = weekDef().days;
	return days.some(d => d.key === key) ? key : days[0].key;
}
function dayKeyToday() {
	const map = { 1: "mon", 2: "tue", 3: "wed", 5: "fri", 6: "sat" };
	return map[new Date().getDay()] || null;
}

/* ---------- rendering ---------- */

function renderAll() {
	renderHeader();
	renderViewTabs();
	if (view === "log") {
		el("day-tabs").classList.remove("hidden");
		renderTabs();
		renderCheckin();
		renderDay();
	} else {
		el("day-tabs").classList.add("hidden");
		if (view === "graphs") renderGraphs();
		else renderProgramView();
	}
	renderFooter();
}

function renderViewTabs() {
	document.querySelectorAll(".view-tab").forEach(b => {
		b.classList.toggle("active", b.dataset.view === view);
	});
}

function renderHeader() {
	const w = weekDef();
	el("app-title").innerHTML = "Week " + w.week + ' <span id="week-caret">▾</span>';
	el("week-label").textContent = "wk of " + w.week_of + " · browse weeks";
	el("brand").onclick = cycleModal;
	document.querySelectorAll(".person-btn").forEach(b => {
		b.classList.toggle("active", b.dataset.person === person);
	});
}

function renderTabs() {
	el("day-tabs").innerHTML = weekDef().days.map(d =>
		`<button class="day-tab ${d.key === selectedDay ? "active" : ""} ${d.key === dayKeyToday() ? "today" : ""}" data-day="${d.key}">${d.key.toUpperCase()}</button>`
	).join("");
	document.querySelectorAll(".day-tab").forEach(b => {
		b.onclick = () => { selectedDay = b.dataset.day; renderAll(); };
	});
}

/* The daily card belongs to the day you're LOOKING at, exactly like the sets
   do — so sleep and bodyweight (and Manny's knee) are one value per day tab
   and can be back-filled, instead of every tab showing one shared "today". */
function renderCheckin() {
	const slot = el("checkin-slot");
	const date = dayDateStr(weekDef(), selectedDay);
	const isToday = date === todayStr();
	const when = isToday ? "today" : selectedDay.toUpperCase() + " " + date.slice(5);
	const ci = (prog.checkins || []).find(c => c.person === person);
	const rec = ci ? findEntry({ type: "checkin", person, date, ex: ci.id }) : null;
	const sleep = findEntry({ type: "sleep", person, date });
	const bw = findEntry({ type: "bodyweight", person, date });
	const noteBtn = ci ? `<button class="note-btn ${rec && rec.note ? "has-note" : ""}" data-ci-note="${ci.id}">✎</button>` : "";
	const scale = ci ? `
			<div class="ci-hint">${esc(ci.hint)}</div>
			<div class="scale-row">${[0, 1, 2, 3, 4, 5].map(n =>
				`<button class="scale-btn ${rec && rec.rating === n ? "sel" : ""}" data-ci="${ci.id}" data-val="${n}">${n}</button>`
			).join("")}</div>
			${rec && rec.note ? `<div class="note-view">“${esc(rec.note)}”</div>` : ""}` : "";
	slot.innerHTML = `
		<div class="card checkin">
			<div class="ex-name"><span class="ci-title">${ci ? esc(ci.label) : "Daily check-in"} — ${when}</span>${noteBtn}</div>
			${scale}
			<div class="ci-hint sleep-label">Sleep — hours in bed ${isToday ? "last night" : "the night before " + when}</div>
			<div class="sleep-row">
				<input class="modal-input" id="sleep-input" type="number" step="0.5" min="0" max="24" inputmode="decimal" placeholder="7.5" value="${sleep && sleep.hours != null ? sleep.hours : ""}">
				<button class="modal-btn primary" id="sleep-save">${sleep && sleep.hours != null ? "update" : "save"}</button>
			</div>
			<div class="ci-hint sleep-label">Bodyweight (lb) — ${isToday ? "this morning" : when}, if you have it</div>
			<div class="sleep-row">
				<input class="modal-input" id="bw-input" type="number" step="0.2" min="0" max="600" inputmode="decimal" placeholder="185" value="${bw && bw.lb != null ? bw.lb : ""}">
				<button class="modal-btn primary" id="bw-save">${bw && bw.lb != null ? "update" : "save"}</button>
			</div>
		</div>`;
	const forWhen = isToday ? "" : " for " + when;
	slot.querySelectorAll("[data-ci]").forEach(b => {
		b.onclick = () => {
			upsert({ type: "checkin", person, date, ex: b.dataset.ci }, { exName: ci.label, rating: Number(b.dataset.val) });
			renderCheckin(); renderFooter();
		};
	});
	el("sleep-save").onclick = () => {
		const v = parseFloat(el("sleep-input").value);
		if (isNaN(v) || v < 0 || v > 24) { toast("Enter hours, e.g. 7.5", true); return; }
		upsert({ type: "sleep", person, date }, { hours: v });
		renderCheckin(); renderFooter();
		toast("Sleep logged: " + v + " hrs" + forWhen);
	};
	el("bw-save").onclick = () => {
		const v = parseFloat(el("bw-input").value);
		if (isNaN(v) || v <= 0 || v > 600) { toast("Enter pounds, e.g. 185", true); return; }
		upsert({ type: "bodyweight", person, date }, { lb: v });
		renderCheckin(); renderFooter();
		toast("Bodyweight logged: " + v + " lb" + forWhen);
	};
	const nb = slot.querySelector("[data-ci-note]");
	if (nb) nb.onclick = async () => {
		const v = await noteModal(ci.label + " — note", rec && rec.note);
		if (v === null) return;
		upsert({ type: "checkin", person, date, ex: ci.id }, { exName: ci.label, note: v, rating: rec ? rec.rating : undefined });
		renderCheckin(); renderFooter();
	};
}

function rxLines(ex) {
	if (typeof ex.rx === "string") {
		const tag = ex.for !== "both" ? `<span class="rx-tag ${ex.for}">${ex.for.toUpperCase()}</span>` : "";
		const mine = ex.for === "both" || ex.for === person;
		return `<div class="rx-line ${mine ? "mine" : ""}">${tag}<b>${esc(ex.rx)}</b></div>`;
	}
	// active person first, and bigger
	const order = [person, ...prog.people.filter(p => p !== person)];
	return order.map(p =>
		`<div class="rx-line ${p === person ? "mine" : ""}"><span class="rx-tag ${p}">${p.toUpperCase()}</span><b>${esc(ex.rx[p])}</b></div>`
	).join("");
}

function renderDay() {
	const w = weekDef();
	const day = w.days.find(d => d.key === selectedDay) || w.days[0];
	const date = dayDateStr(w, day.key);
	const skipRec = findEntry({ type: "skip", person, date, day: day.key });
	const skip = skipRec && !skipRec.retracted ? skipRec : null;
	const session = findEntry({ type: "session", person, date, day: day.key });

	let html = "";
	if (w.week !== prog.current_week) html += `
		<div class="card week-banner">Viewing week ${w.week}${w.label ? " · " + esc(w.label) : ""} — this day is ${date}
			<div><button class="linkish" id="back-current">back to current week</button></div>
		</div>`;

	html += `
		<div class="day-head">
			<div class="day-title">${esc(day.title)}</div>
			<div class="day-actions">
				<button class="linkish" id="add-ex">+ add exercise</button>
				${skip ? "" : `<button class="linkish danger" id="skip-day">skip today</button>`}
			</div>
		</div>`;

	if (skip) html += `
		<div class="card skip-banner">Skipped today (${person})
			${skip.note ? `<span class="note-text">“${esc(skip.note)}”</span>` : ""}
			<div><button class="linkish" id="unskip">un-skip</button></div>
		</div>`;

	for (const ex of day.exercises) html += exerciseCard(ex, date, day.key);

	// ad-hoc additions for this person/date/day
	for (const add of entries.filter(e => e.type === "add" && !e.retracted && e.person === person && e.date === date && e.day === day.key)) {
		html += exerciseCard({
			id: "add:" + add.id, name: add.exName + " (added)", for: person,
			sets: add.sets || 3, reps: add.reps || null, tags: add.tags || [],
			rx: (add.reps ? (add.sets || 3) + "×" + add.reps + " · " : "") + (add.note ? "added: " + add.note : "added today")
		}, date, day.key);
	}

	html += `
		<div class="card">
			<div class="session-title">Session overall (${person}) — 1 to 5 ${sessionNoteBtn(session)}</div>
			<div class="scale-row">${[1, 2, 3, 4, 5].map(n =>
				`<button class="scale-btn ${session && session.rating === n ? "sel" : ""}" data-sess="${n}">${n}</button>`
			).join("")}</div>
			${session && session.note ? `<div class="note-view">“${esc(session.note)}”</div>` : ""}
		</div>`;

	el("day-card").innerHTML = html;
	wireDay(day, date);
}

function sessionNoteBtn(session) {
	return `<button class="note-btn ${session && session.note ? "has-note" : ""}" id="sess-note" style="float:right">✎</button>`;
}

function exerciseCard(ex, date, dayKey) {
	const mine = ex.for === "both" || ex.for === person;
	const note = findEntry({ type: "note", person, date, ex: ex.id });
	const isAdded = ex.id.startsWith("add:");
	const skipRec = findEntry({ type: "exskip", person, date, ex: ex.id });
	const exSkipped = !!(skipRec && !skipRec.retracted);
	let controls = "";
	if (mine) {
		controls += `<button class="note-btn ${note && note.note ? "has-note" : ""}" data-note="${ex.id}" data-name="${esc(ex.name)}">✎</button>`;
		if (!exSkipped) controls += `<button class="mini-btn" data-exskip="${ex.id}" data-name="${esc(ex.name)}">skip</button>`;
		if (isAdded) controls += `<button class="mini-btn danger" data-del-add="${ex.id.slice(4)}" data-name="${esc(ex.name)}">✕</button>`;
	}
	let html = `<div class="card ${mine ? "" : "not-yours"}">
		<div class="ex-name">${esc(ex.name)}${controls}</div>
		${rxLines(ex)}`;
	if (mine && exSkipped) {
		html += `<div class="ex-skip-line">skipped${skipRec.note ? " — “" + esc(skipRec.note) + "”" : ""}
			<button class="linkish" data-exunskip="${ex.id}">un-skip</button></div>`;
	} else if (mine) {
		const rxReps = perPerson(ex.reps, person);
		let bubbles = "";
		for (let s = 1; s <= ex.sets; s++) {
			const rec = findEntry({ type: "set", person, date, ex: ex.id, set: s });
			const skipped = rec && rec.skipped;
			const done = !skipped && rec && rec.rpe !== null && rec.rpe !== undefined;
			let label = s;
			if (skipped) label = `<span>—</span>`;
			else if (done) {
				// only surface reps when they differ from what was prescribed
				const shortfall = rec.reps != null && rxReps != null && rec.reps !== rxReps;
				const sub = rec.weight != null ? rec.weight + (shortfall ? "×" + rec.reps : "") : (shortfall ? rec.reps + " reps" : "");
				label = `<span>${rec.rpe === 5 ? "≤5" : rec.rpe}</span>${sub ? `<span class="sub">${sub}</span>` : ""}`;
			}
			bubbles += `<button class="set-bubble ${done ? "done" : ""} ${skipped ? "skipped" : ""}" data-set-ex="${ex.id}" data-set-name="${esc(ex.name)}" data-set="${s}">${label}</button>`;
		}
		html += `<div class="sets-row">${bubbles}</div>`;
		html += feelRow(ex, date);
	}
	if (note && note.note) html += `<div class="note-view">“${esc(note.note)}”</div>`;
	return html + "</div>";
}

const FEELS = [
	{ field: "pain", label: "PAIN", opts: [["none", "sel-good"], ["discomfort", "sel-warn"], ["≥3", "sel-bad"]] },
	{ field: "weight", label: "WT", opts: [["easy", "sel-warn"], ["right", "sel-good"], ["heavy", "sel-bad"]] },
	{ field: "volume", label: "VOL", opts: [["easy", "sel-warn"], ["right", "sel-good"], ["heavy", "sel-bad"]] }
];

function feelRow(ex, date) {
	let html = `<div class="feel-row">`;
	for (const f of FEELS) {
		const rec = findEntry({ type: "feel", person, date, ex: ex.id, field: f.field });
		html += `<div class="feel-group"><span class="feel-label">${f.label}</span>`;
		for (const [opt, cls] of f.opts) {
			const sel = rec && rec.value === opt;
			html += `<button class="feel-btn ${sel ? cls : ""}" data-feel-ex="${ex.id}" data-feel-name="${esc(ex.name)}" data-field="${f.field}" data-val="${opt}">${opt}</button>`;
		}
		html += `</div>`;
	}
	return html + `</div>`;
}

function wireDay(day, date) {
	const back = el("back-current");
	if (back) back.onclick = () => { viewWeek = prog.current_week; renderAll(); };
	document.querySelectorAll("[data-set-ex]").forEach(b => {
		b.onclick = () => rpeModal(b.dataset.setEx, b.dataset.setName, Number(b.dataset.set), day.key, date);
	});
	document.querySelectorAll("[data-feel-ex]").forEach(b => {
		b.onclick = () => {
			const match = { type: "feel", person, date, ex: b.dataset.feelEx, field: b.dataset.field };
			const rec = findEntry(match);
			upsert(match, { exName: b.dataset.feelName, day: day.key, value: rec && rec.value === b.dataset.val ? null : b.dataset.val });
			renderDay(); renderFooter();
		};
	});
	document.querySelectorAll("[data-note]").forEach(b => {
		b.onclick = async () => {
			const match = { type: "note", person, date, ex: b.dataset.note };
			const rec = findEntry(match);
			const v = await noteModal("Note — " + b.dataset.name, rec && rec.note);
			if (v === null) return;
			upsert(match, { exName: b.dataset.name, day: day.key, note: v });
			renderDay(); renderFooter();
		};
	});
	document.querySelectorAll("[data-exskip]").forEach(b => {
		b.onclick = async () => {
			const v = await noteModal("Skipping " + b.dataset.name + " — why? (optional)", "");
			if (v === null) return;
			upsert({ type: "exskip", person, date, ex: b.dataset.exskip }, { exName: b.dataset.name, day: day.key, note: v, retracted: false });
			renderDay(); renderFooter();
		};
	});
	document.querySelectorAll("[data-exunskip]").forEach(b => {
		b.onclick = () => {
			const match = { type: "exskip", person, date, ex: b.dataset.exunskip };
			const rec = findEntry(match);
			if (rec && rec.synced) upsert(match, { retracted: true });
			else if (rec) { entries = entries.filter(e => e !== rec); save(); }
			renderDay(); renderFooter();
		};
	});
	document.querySelectorAll("[data-del-add]").forEach(b => {
		b.onclick = () => {
			if (!confirm("Delete " + b.dataset.name + "?")) return;
			const rec = entries.find(e => e.id === b.dataset.delAdd);
			if (!rec) return;
			if (rec.synced) Object.assign(rec, { retracted: true, synced: false, ts: new Date().toISOString() });
			else entries = entries.filter(e => e !== rec);
			// drop this exercise's local-only child records (sets/feels/notes never sent)
			entries = entries.filter(e => !(e.ex === "add:" + rec.id && !e.synced));
			save(); renderDay(); renderFooter();
		};
	});
	const skipBtn = el("skip-day");
	if (skipBtn) skipBtn.onclick = async () => {
		const v = await noteModal("Skipping today — why? (optional)", "");
		if (v === null) return;
		upsert({ type: "skip", person, date, day: day.key }, { note: v, retracted: false });
		renderDay(); renderFooter();
	};
	const unskip = el("unskip");
	if (unskip) unskip.onclick = () => {
		const match = { type: "skip", person, date, day: day.key };
		const rec = findEntry(match);
		if (rec && rec.synced) {
			// the skip already reached the coach — ship a retraction instead of going silent
			upsert(match, { retracted: true });
		} else if (rec) {
			entries = entries.filter(e => e !== rec);
			save();
		}
		renderDay(); renderFooter();
	};
	el("add-ex").onclick = async () => {
		const v = await addExerciseModal();
		if (!v || !v.name.trim()) return;
		entries.push({
			id: uid(), ts: new Date().toISOString(), person, date, synced: false, type: "add",
			day: day.key, exName: v.name.trim(), note: v.why.trim(), tags: v.tags, reps: v.reps
		});
		save(); renderDay(); renderFooter();
	};
	document.querySelectorAll("[data-sess]").forEach(b => {
		b.onclick = () => {
			upsert({ type: "session", person, date, day: day.key }, { rating: Number(b.dataset.sess) });
			renderDay(); renderFooter();
		};
	});
	const sn = el("sess-note");
	if (sn) sn.onclick = async () => {
		const match = { type: "session", person, date, day: day.key };
		const rec = findEntry(match);
		const v = await noteModal("Session note", rec && rec.note);
		if (v === null) return;
		upsert(match, { note: v, rating: rec ? rec.rating : undefined });
		renderDay(); renderFooter();
	};
}

/* ---------- cycle browser ---------- */

function cycleModal() {
	const blocks = {};
	for (const w of prog.weeks) {
		const b = Math.ceil(w.week / 4);
		(blocks[b] = blocks[b] || []).push(w);
	}
	let html = `<div class="modal-title">${esc(prog.meso || prog.title)}</div>
		<div class="modal-sub">${prog.weeks.length} week${prog.weeks.length > 1 ? "s" : ""} loaded · tap a week to view it (everything logged there comes with it)</div>`;
	for (const b of Object.keys(blocks)) {
		const ws = blocks[b];
		html += `<div class="block-head">Block ${b} — week${ws.length > 1 ? "s" : ""} ${ws[0].week}${ws.length > 1 ? "–" + ws[ws.length - 1].week : ""}</div>`;
		for (const w of ws) {
			const dates = w.days.map(d => dayDateStr(w, d.key));
			const logged = entries.filter(e => dates.includes(e.date)).length;
			html += `<button class="week-row ${w.week === viewWeek ? "viewing" : ""}" data-week="${w.week}">
				<span>Week ${w.week}${w.label ? " · " + esc(w.label) : ""}</span>
				<span class="week-meta">wk of ${w.week_of}${w.week === prog.current_week ? " · current" : ""}${logged ? " · " + logged + " logged" : ""}</span>
			</button>`;
		}
	}
	openModal(html);
	el("modal").querySelectorAll("[data-week]").forEach(b => {
		b.onclick = () => { viewWeek = Number(b.dataset.week); closeModal(); renderAll(); };
	});
}

/* ---------- modals ---------- */

function openModal(html) {
	el("modal").innerHTML = html;
	el("modal-backdrop").classList.remove("hidden");
}
function closeModal() { el("modal-backdrop").classList.add("hidden"); }
el("modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });

function rpeModal(exId, exName, set, dayKey, date) {
	const vals = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
	const def = (weekDef().days.flatMap(d => d.exercises).find(e => e.id === exId)) || {};
	const existing = findEntry({ type: "set", person, date, ex: exId, set });

	// weight: this set's own, else carry the last weight logged on it today
	let preW = existing && existing.weight != null ? existing.weight : "";
	if (preW === "") {
		const prior = entries.filter(e => e.type === "set" && e.person === person && e.date === date && e.ex === exId && e.weight != null);
		if (prior.length) preW = prior[prior.length - 1].weight;
	}
	// reps: assume the prescription was hit — only a miss needs typing
	const rxReps = perPerson(def.reps, person);
	const preR = existing && existing.reps != null ? existing.reps : (rxReps != null ? rxReps : "");
	const repsField = def.timed ? "" : `
		<div class="field">
			<div class="modal-sub">Reps${def.amrap ? " (AMRAP — enter it)" : rxReps != null ? " — prescribed " + rxReps : ""}</div>
			<input class="modal-input" id="m-reps" type="number" inputmode="numeric" step="1" min="0" placeholder="${def.amrap ? "e.g. 9" : "reps"}" value="${preR}">
		</div>`;

	openModal(`
		<div class="modal-title">${esc(exName)} — set ${set}</div>
		<div class="field-row">
			<div class="field">
				<div class="modal-sub">Weight (lb)</div>
				<input class="modal-input" id="m-weight" type="number" inputmode="decimal" step="2.5" min="0" placeholder="e.g. 185" value="${preW}">
			</div>
			${repsField}
		</div>
		<div class="modal-sub">How hard was it? (RPE) — tapping saves all of it</div>
		<div class="rpe-grid">
			${vals.map(v => `<button class="rpe-btn ${v >= 7 && v <= 8 ? "in-window" : ""}" data-rpe="${v}">${v}</button>`).join("")}
			<button class="rpe-btn" data-rpe="5">≤5</button>
			<button class="rpe-btn wide danger" id="m-skip-set">skip this set</button>
			<button class="rpe-btn wide" data-rpe="clear">clear this set</button>
		</div>`);

	el("modal").querySelectorAll("[data-rpe]").forEach(b => {
		b.onclick = () => {
			const clear = b.dataset.rpe === "clear";
			const wv = parseFloat(el("m-weight").value);
			const rvEl = el("m-reps");
			const rv = rvEl ? parseInt(rvEl.value, 10) : NaN;
			upsert({ type: "set", person, date, ex: exId, set }, {
				exName, day: dayKey,
				rpe: clear ? null : Number(b.dataset.rpe),
				weight: clear || isNaN(wv) ? null : wv,
				reps: clear || isNaN(rv) ? null : rv,
				skipped: false, note: clear ? null : (existing ? existing.note : null)
			});
			closeModal(); renderDay(); renderFooter();
		};
	});
	el("m-skip-set").onclick = async () => {
		closeModal();
		const why = await noteModal("Skipping set " + set + " of " + exName + " — why? (optional)", "");
		if (why === null) return;
		upsert({ type: "set", person, date, ex: exId, set }, {
			exName, day: dayKey, skipped: true, rpe: null, weight: null, reps: null, note: why
		});
		renderDay(); renderFooter();
	};
}

function noteModal(title, existing) {
	return new Promise(resolve => {
		openModal(`
			<div class="modal-title">${esc(title)}</div>
			<textarea class="modal-input" id="m-text" rows="3">${existing ? esc(existing) : ""}</textarea>
			<div class="modal-row">
				<button class="modal-btn" id="m-cancel">Cancel</button>
				<button class="modal-btn primary" id="m-save">Save</button>
			</div>`);
		el("m-cancel").onclick = () => { closeModal(); resolve(null); };
		el("m-save").onclick = () => { const v = el("m-text").value; closeModal(); resolve(v); };
		el("m-text").focus();
	});
}

/* Muscle tags on an ad-hoc addition, so it lands in the volume graphs instead
   of waiting for the next check-in to be classified. Optional — untagged
   additions still log fine, they just don't count toward a muscle. */
const MUSCLES = ["chest", "front delt", "triceps", "lats", "upper back", "biceps", "quads", "hams", "glutes", "core"];

function addExerciseModal() {
	return new Promise(resolve => {
		openModal(`
			<div class="modal-title">Add an exercise</div>
			<input class="modal-input" id="m-f1" placeholder="What is it?">
			<div class="field-row">
				<div class="field">
					<div class="modal-sub">Sets</div>
					<input class="modal-input" id="m-sets" type="number" inputmode="numeric" min="1" max="12" value="3">
				</div>
				<div class="field">
					<div class="modal-sub">Target reps</div>
					<input class="modal-input" id="m-arep" type="number" inputmode="numeric" min="1" placeholder="10">
				</div>
			</div>
			<div class="modal-sub">Muscles it trains (optional)</div>
			<div class="tag-pick">${MUSCLES.map(m => `<button class="chip" data-tag="${m}">${m}</button>`).join("")}</div>
			<textarea class="modal-input" id="m-f2" rows="2" placeholder="Why? (optional)"></textarea>
			<div class="modal-row">
				<button class="modal-btn" id="m-cancel">Cancel</button>
				<button class="modal-btn primary" id="m-save">Add</button>
			</div>`);
		const picked = new Set();
		el("modal").querySelectorAll("[data-tag]").forEach(b => {
			b.onclick = () => {
				const t = b.dataset.tag;
				if (picked.has(t)) { picked.delete(t); b.classList.remove("on"); }
				else { picked.add(t); b.classList.add("on"); }
			};
		});
		el("m-cancel").onclick = () => { closeModal(); resolve(null); };
		el("m-save").onclick = () => {
			const reps = parseInt(el("m-arep").value, 10);
			const sets = parseInt(el("m-sets").value, 10);
			const out = {
				name: el("m-f1").value, why: el("m-f2").value,
				tags: [...picked], reps: isNaN(reps) ? null : reps,
				sets: isNaN(sets) ? 3 : Math.min(12, Math.max(1, sets))
			};
			closeModal(); resolve(out);
		};
		el("m-f1").focus();
	});
}

function twoFieldModal(title, ph1, ph2) {
	return new Promise(resolve => {
		openModal(`
			<div class="modal-title">${esc(title)}</div>
			<input class="modal-input" id="m-f1" placeholder="${esc(ph1)}">
			<textarea class="modal-input" id="m-f2" rows="2" placeholder="${esc(ph2)}"></textarea>
			<div class="modal-row">
				<button class="modal-btn" id="m-cancel">Cancel</button>
				<button class="modal-btn primary" id="m-save">Add</button>
			</div>`);
		el("m-cancel").onclick = () => { closeModal(); resolve(null); };
		el("m-save").onclick = () => { const v = [el("m-f1").value, el("m-f2").value]; closeModal(); resolve(v); };
		el("m-f1").focus();
	});
}

/* ---------- send to coach ---------- */

function renderFooter() {
	const n = pendingCount();
	el("pending-badge").textContent = n ? "(" + n + " new)" : "(nothing new)";
	el("send-btn").disabled = !n;
	el("version-tag").textContent = APP_VERSION + " · program v" + (prog ? prog.program_version : "?");
}

function batchId() { return person + "-" + Date.now().toString(36); }

/* Greedy split so no single form answer exceeds the field limit. Months of
   "resend everything" would blow one answer; parts are re-stitched by batch. */
function chunkEntries(batch) {
	const chunks = [];
	let cur = [];
	for (const e of batch) {
		cur.push(e);
		if (JSON.stringify(cur).length > CHUNK_CHARS) {
			if (cur.length === 1) { chunks.push(cur); cur = []; }
			else { const last = cur.pop(); chunks.push(cur); cur = [last]; }
		}
	}
	if (cur.length) chunks.push(cur);
	return chunks;
}

function payloadFor(chunk, id, part, parts) {
	return JSON.stringify({
		app: "bench-block", format: 2, batch: id, part, parts,
		exported_at: new Date().toISOString(), exported_by: person,
		app_version: APP_VERSION, program_version: prog ? prog.program_version : null,
		note_to_coach: "Latest record per (person,date,type,ex,set/field) wins; rpe/value null = cleared; retracted:true undoes a skip/add.",
		entries: chunk
	});
}

async function postToForm(text) {
	const fd = new FormData();
	fd.append(FORM_FIELD, text);
	// opaque response: resolves on delivery, throws only on network failure
	await fetch(FORM_ACTION, { method: "POST", mode: "no-cors", body: fd });
}

async function sendToCoach(all) {
	const batch = entries.filter(e => all || !e.synced);
	if (!batch.length) { toast("Nothing to send"); return; }
	if (navigator.onLine === false) { toast("Offline — try again on data/wifi", true); return; }

	const btn = el("send-btn");
	btn.disabled = true;
	const label = btn.firstChild;
	const wasText = label.textContent;
	label.textContent = "Sending… ";

	const chunks = chunkEntries(batch);
	const id = batchId();
	try {
		for (let i = 0; i < chunks.length; i++) {
			await postToForm(payloadFor(chunks[i], id, i + 1, chunks.length));
		}
	} catch (e) {
		label.textContent = wasText;
		renderFooter();
		toast("Send failed — check signal, then retry", true);
		return;
	}
	batch.forEach(e => e.synced = true);
	save();
	label.textContent = wasText;
	renderFooter();
	toast("Sent " + batch.length + " to coach ✓");
	// pick up whatever the other lifter sent while we were logging
	setTimeout(() => pullShared(false), 3000);
}

/* Manual escape hatch: hands the same JSON to the share sheet, for the day
   Forms is down or a send silently vanished. */
async function saveAsFile() {
	const batch = entries.length ? entries : [];
	if (!batch.length) { toast("Nothing logged yet"); return; }
	const stamp = todayStr().replace(/-/g, "") + "_" + new Date().toTimeString().slice(0, 5).replace(":", "");
	const fname = `coachlog_${person}_${stamp}.json`;
	const file = new File([payloadFor(batch, batchId(), 1, 1)], fname, { type: "application/json" });
	if (navigator.canShare && navigator.canShare({ files: [file] })) {
		try { await navigator.share({ files: [file], title: fname }); return; }
		catch (e) { if (e.name === "AbortError") return; }
	}
	const a = document.createElement("a");
	a.href = URL.createObjectURL(file);
	a.download = fname;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

el("send-btn").onclick = () => sendToCoach(false);
el("resend-all").onclick = () => sendToCoach(true);
el("save-file").onclick = saveAsFile;
el("pull-now").onclick = () => pullShared(true);

/* ---------- person toggle ---------- */

document.querySelectorAll(".person-btn").forEach(b => {
	b.onclick = () => {
		person = b.dataset.person;
		localStorage.setItem(LS_PERSON, person);
		renderAll();
	};
});

document.querySelectorAll(".view-tab").forEach(b => {
	b.onclick = () => { view = b.dataset.view; renderAll(); };
});

/* ---------- boot ---------- */

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadProgram().then(() => pullShared(false));
// coming back to a backgrounded app is the other moment the shared log may have moved
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible" && prog) pullShared(false);
});
