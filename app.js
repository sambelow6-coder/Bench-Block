/* Bench Block — dumb terminal for the coach loop.
   All entries are append/replace records in localStorage; "Send to Coach"
   ships everything unsynced as a single JSON file via the share sheet
   (OneDrive → WorkoutCoach/logs) or a download. The program itself is
   read-only here: it ships with the site as program.json. */

"use strict";

const LS_ENTRIES = "bb_entries_v1";
const LS_PERSON = "bb_person";
const LS_PROG = "bb_program_cache_v1";
const APP_VERSION = "v1.4";

let prog = null;
let person = localStorage.getItem(LS_PERSON) || "sam";
let selectedDay = null;
let viewWeek = null;
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
	renderTabs();
	renderCheckin();
	renderDay();
	renderFooter();
}

function renderHeader() {
	const w = weekDef();
	el("app-title").textContent = "Bench Block — Week " + w.week;
	el("week-label").textContent = prog.title + " · wk of " + w.week_of + " ▾";
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

function renderCheckin() {
	const slot = el("checkin-slot");
	const ci = (prog.checkins || []).find(c => c.person === person);
	if (!ci) { slot.innerHTML = ""; return; }
	const rec = findEntry({ type: "checkin", person, date: todayStr(), ex: ci.id });
	const sleep = findEntry({ type: "sleep", person, date: todayStr() });
	const noteBtn = `<button class="note-btn ${rec && rec.note ? "has-note" : ""}" data-ci-note="${ci.id}">✎</button>`;
	slot.innerHTML = `
		<div class="card checkin">
			<div class="ex-name"><span class="ci-title">${esc(ci.label)} — today</span>${noteBtn}</div>
			<div class="ci-hint">${esc(ci.hint)}</div>
			<div class="scale-row">${[0, 1, 2, 3, 4, 5].map(n =>
				`<button class="scale-btn ${rec && rec.rating === n ? "sel" : ""}" data-ci="${ci.id}" data-val="${n}">${n}</button>`
			).join("")}</div>
			${rec && rec.note ? `<div class="note-view">“${esc(rec.note)}”</div>` : ""}
			<div class="ci-hint sleep-label">Sleep — hours in bed last night</div>
			<div class="sleep-row">
				<input class="modal-input" id="sleep-input" type="number" step="0.5" min="0" max="24" inputmode="decimal" placeholder="7.5" value="${sleep && sleep.hours != null ? sleep.hours : ""}">
				<button class="modal-btn primary" id="sleep-save">${sleep && sleep.hours != null ? "update" : "save"}</button>
			</div>
		</div>`;
	slot.querySelectorAll("[data-ci]").forEach(b => {
		b.onclick = () => {
			upsert({ type: "checkin", person, date: todayStr(), ex: b.dataset.ci }, { exName: ci.label, rating: Number(b.dataset.val) });
			renderCheckin(); renderFooter();
		};
	});
	el("sleep-save").onclick = () => {
		const v = parseFloat(el("sleep-input").value);
		if (isNaN(v) || v < 0 || v > 24) { toast("Enter hours, e.g. 7.5", true); return; }
		upsert({ type: "sleep", person, date: todayStr() }, { hours: v });
		renderCheckin(); renderFooter();
		toast("Sleep logged: " + v + " hrs");
	};
	const nb = slot.querySelector("[data-ci-note]");
	if (nb) nb.onclick = async () => {
		const v = await noteModal(ci.label + " — note", rec && rec.note);
		if (v === null) return;
		upsert({ type: "checkin", person, date: todayStr(), ex: ci.id }, { exName: ci.label, note: v, rating: rec ? rec.rating : undefined });
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
		html += exerciseCard({ id: "add:" + add.id, name: add.exName + " (added)", for: person, sets: 5, rx: add.note ? "added: " + add.note : "added today" }, date, day.key);
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
		let bubbles = "";
		for (let s = 1; s <= ex.sets; s++) {
			const rec = findEntry({ type: "set", person, date, ex: ex.id, set: s });
			const done = rec && rec.rpe !== null && rec.rpe !== undefined;
			const label = done
				? `<span>${rec.rpe === 5 ? "≤5" : rec.rpe}</span>${rec.weight != null ? `<span class="sub">${rec.weight}</span>` : ""}`
				: s;
			bubbles += `<button class="set-bubble ${done ? "done" : ""}" data-set-ex="${ex.id}" data-set-name="${esc(ex.name)}" data-set="${s}">${label}</button>`;
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
		const v = await twoFieldModal("Add an exercise", "What is it?", "Why? (optional)");
		if (!v || !v[0].trim()) return;
		entries.push({ id: uid(), ts: new Date().toISOString(), person, date, synced: false, type: "add", day: day.key, exName: v[0].trim(), note: v[1].trim() });
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
	// prefill weight: this set's logged weight, else the latest weight on this exercise today
	const existing = findEntry({ type: "set", person, date, ex: exId, set });
	let pre = existing && existing.weight != null ? existing.weight : "";
	if (pre === "") {
		const prior = entries.filter(e => e.type === "set" && e.person === person && e.date === date && e.ex === exId && e.weight != null);
		if (prior.length) pre = prior[prior.length - 1].weight;
	}
	openModal(`
		<div class="modal-title">${esc(exName)} — set ${set}</div>
		<div class="modal-sub">Weight used (lb) — optional</div>
		<input class="modal-input" id="m-weight" type="number" inputmode="decimal" step="2.5" min="0" placeholder="e.g. 185" value="${pre}">
		<div class="modal-sub">How hard was it? (RPE) — tapping saves both</div>
		<div class="rpe-grid">
			${vals.map(v => `<button class="rpe-btn ${v >= 7 && v <= 8 ? "in-window" : ""}" data-rpe="${v}">${v}</button>`).join("")}
			<button class="rpe-btn" data-rpe="5">≤5</button>
			<button class="rpe-btn wide" data-rpe="clear">clear this set</button>
		</div>`);
	el("modal").querySelectorAll("[data-rpe]").forEach(b => {
		b.onclick = () => {
			const clear = b.dataset.rpe === "clear";
			const wv = parseFloat(el("m-weight").value);
			upsert({ type: "set", person, date, ex: exId, set }, {
				exName, day: dayKey,
				rpe: clear ? null : Number(b.dataset.rpe),
				weight: clear || isNaN(wv) ? null : wv
			});
			closeModal(); renderDay(); renderFooter();
		};
	});
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

async function sendToCoach(all) {
	const batch = entries.filter(e => all || !e.synced);
	if (!batch.length) { toast("Nothing to send"); return; }
	const stamp = todayStr().replace(/-/g, "") + "_" + new Date().toTimeString().slice(0, 5).replace(":", "");
	const fname = `coachlog_${person}_${stamp}.json`;
	const payload = {
		app: "bench-block", format: 1, exported_at: new Date().toISOString(),
		exported_by: person, program_version: prog ? prog.program_version : null,
		note_to_coach: "Latest record per (person,date,type,ex,set/field) wins; rpe/value null = cleared.",
		entries: batch
	};
	const file = new File([JSON.stringify(payload, null, 1)], fname, { type: "application/json" });
	let shared = false;
	if (navigator.canShare && navigator.canShare({ files: [file] })) {
		try { await navigator.share({ files: [file], title: fname }); shared = true; }
		catch (e) { if (e.name === "AbortError") return; }
	}
	if (!shared) {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(file);
		a.download = fname;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	}
	batch.forEach(e => e.synced = true);
	save(); renderFooter();
	toast(batch.length + " entries sent — drop in WorkoutCoach/logs");
}

el("send-btn").onclick = () => sendToCoach(false);
el("resend-all").onclick = () => sendToCoach(true);

/* ---------- person toggle ---------- */

document.querySelectorAll(".person-btn").forEach(b => {
	b.onclick = () => {
		person = b.dataset.person;
		localStorage.setItem(LS_PERSON, person);
		renderAll();
	};
});

/* ---------- boot ---------- */

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadProgram();
