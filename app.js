/* Bench Block — dumb terminal for the coach loop.
   All entries are append/replace records in localStorage; "Send to Coach"
   ships everything unsynced as a single JSON file via the share sheet
   (OneDrive → WorkoutCoach/logs) or a download. The program itself is
   read-only here: it ships with the site as program.json. */

"use strict";

const LS_ENTRIES = "bb_entries_v1";
const LS_PERSON = "bb_person";
const LS_PROG = "bb_program_cache_v1";
const APP_VERSION = "v1.0";

let prog = null;
let person = localStorage.getItem(LS_PERSON) || "sam";
let selectedDay = null;
let entries = load(LS_ENTRIES, []);

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
	if (!selectedDay) selectedDay = defaultDay();
	renderAll();
}

function defaultDay() {
	const map = { 0: "mon", 1: "mon", 2: "tue", 3: "wed", 4: "fri", 5: "fri", 6: "sat" };
	const key = map[new Date().getDay()];
	return prog.days.some(d => d.key === key) ? key : prog.days[0].key;
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
	el("week-label").textContent = prog.title + " · Week " + prog.week + " · wk of " + prog.week_of;
	document.querySelectorAll(".person-btn").forEach(b => {
		b.classList.toggle("active", b.dataset.person === person);
	});
}

function renderTabs() {
	el("day-tabs").innerHTML = prog.days.map(d =>
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
	const noteBtn = `<button class="note-btn ${rec && rec.note ? "has-note" : ""}" data-ci-note="${ci.id}">✎</button>`;
	slot.innerHTML = `
		<div class="card checkin">
			<div class="ex-name"><span class="ci-title">${esc(ci.label)} — today</span>${noteBtn}</div>
			<div class="ci-hint">${esc(ci.hint)}</div>
			<div class="scale-row">${[0, 1, 2, 3, 4, 5].map(n =>
				`<button class="scale-btn ${rec && rec.rating === n ? "sel" : ""}" data-ci="${ci.id}" data-val="${n}">${n}</button>`
			).join("")}</div>
			${rec && rec.note ? `<div class="note-view">“${esc(rec.note)}”</div>` : ""}
		</div>`;
	slot.querySelectorAll("[data-ci]").forEach(b => {
		b.onclick = () => {
			upsert({ type: "checkin", person, date: todayStr(), ex: b.dataset.ci }, { exName: ci.label, rating: Number(b.dataset.val) });
			renderCheckin(); renderFooter();
		};
	});
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
		return `<div class="rx-line">${tag}<b>${esc(ex.rx)}</b></div>`;
	}
	return prog.people.map(p =>
		`<div class="rx-line"><span class="rx-tag ${p}">${p.toUpperCase()}</span><b>${esc(ex.rx[p])}</b></div>`
	).join("");
}

function renderDay() {
	const day = prog.days.find(d => d.key === selectedDay);
	const date = todayStr();
	const skipRec = findEntry({ type: "skip", person, date, day: day.key });
	const skip = skipRec && !skipRec.retracted ? skipRec : null;
	const session = findEntry({ type: "session", person, date, day: day.key });

	let html = `
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
	for (const add of entries.filter(e => e.type === "add" && e.person === person && e.date === date && e.day === day.key)) {
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
	let html = `<div class="card ${mine ? "" : "not-yours"}">
		<div class="ex-name">${esc(ex.name)}
			${mine ? `<button class="note-btn ${note ? "has-note" : ""}" data-note="${ex.id}" data-name="${esc(ex.name)}">✎</button>` : ""}
		</div>
		${rxLines(ex)}`;
	if (mine) {
		let bubbles = "";
		for (let s = 1; s <= ex.sets; s++) {
			const rec = findEntry({ type: "set", person, date, ex: ex.id, set: s });
			const done = rec && rec.rpe !== null && rec.rpe !== undefined;
			bubbles += `<button class="set-bubble ${done ? "done" : ""}" data-set-ex="${ex.id}" data-set-name="${esc(ex.name)}" data-set="${s}">
				${done ? (rec.rpe === 5 ? "≤5" : rec.rpe) : s}</button>`;
		}
		html += `<div class="sets-row">${bubbles}</div>`;
		html += feelRow(ex, date);
	}
	if (note && note.note) html += `<div class="note-view">“${esc(note.note)}”</div>`;
	return html + "</div>";
}

const FEELS = [
	{ field: "pain", label: "PAIN", opts: [["none", "sel-good"], ["mild", "sel-warn"], ["real", "sel-bad"]] },
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
	document.querySelectorAll("[data-set-ex]").forEach(b => {
		b.onclick = () => rpeModal(b.dataset.setEx, b.dataset.setName, Number(b.dataset.set), day.key);
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

/* ---------- modals ---------- */

function openModal(html) {
	el("modal").innerHTML = html;
	el("modal-backdrop").classList.remove("hidden");
}
function closeModal() { el("modal-backdrop").classList.add("hidden"); }
el("modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });

function rpeModal(exId, exName, set, dayKey) {
	const vals = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
	openModal(`
		<div class="modal-title">${esc(exName)} — set ${set}</div>
		<div class="modal-sub">How hard was it? (RPE)</div>
		<div class="rpe-grid">
			${vals.map(v => `<button class="rpe-btn ${v >= 7 && v <= 8 ? "in-window" : ""}" data-rpe="${v}">${v}</button>`).join("")}
			<button class="rpe-btn" data-rpe="5">≤5</button>
			<button class="rpe-btn wide" data-rpe="clear">clear this set</button>
		</div>`);
	el("modal").querySelectorAll("[data-rpe]").forEach(b => {
		b.onclick = () => {
			const v = b.dataset.rpe === "clear" ? null : Number(b.dataset.rpe);
			upsert({ type: "set", person, date: todayStr(), ex: exId, set }, { exName, day: dayKey, rpe: v });
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
