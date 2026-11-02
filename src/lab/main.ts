// Melody lab (dev only, /lab.html): sing a section, tap each chord change, then say what it should
// have heard. Takes stay in this browser with their audio, scored against Basic Pitch

import '../style.css';
import './lab.css';
import { capture, type Capture } from '../capture.ts';
import type { Frame } from '../listen/summary.ts';
import { noteName, shiftKey } from '../music/theory.ts';
import { transcribe } from './basic-pitch.ts';
import {
    add,
    cardOf,
    EMPTY,
    type Card,
    type Tally,
    type Verdict,
} from './score.ts';
import {
    allTakes,
    AUDIO_RATE,
    decode,
    encode,
    putTake,
    removeTake,
    resample,
    type Take,
} from './takes.ts';

// the trace: the last few seconds, low male to high soprano
const WINDOW = 6;
const LOW = 40;
const HIGH = 84;
const CLEAR = 0.8;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(
    text: string,
    onClick: () => void,
    className = 'cg-btn',
): HTMLButtonElement {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

/** a labelled text box that writes into the take as you type */
function field(label: string, hint: string): HTMLInputElement {
    const input = el('input', 'cg-typed-input lab-input');
    input.placeholder = hint;
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.dataset.label = label;
    return input;
}

const root = document.querySelector<HTMLElement>('#lab')!;
const midi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const name = (m: number): string =>
    `${noteName(Math.round(m), false)}${Math.floor(Math.round(m) / 12) - 1}`;
const nameOf = (pc: number | null): string =>
    pc === null ? '—' : noteName(pc, false);

let take: Take | null = null;
let live: Capture | null = null;
let chunks: Float32Array[] = [];
let chunkAt = 0;
let useChords = false;

/* ---------- recording ---------- */

const status = el(
    'p',
    'lab-status',
    'Pick the key, press START, sing, and tap at every chord change.',
);
const keyPick = el('select', 'cg-btn lab-key');
keyPick.add(new Option('NO KEY', ''));
for (const m of [false, true])
    for (let i = 0; i < 12; i++) {
        const k = shiftKey(m ? 'Cm' : 'C', i);
        keyPick.add(new Option(`KEY ${k}`, k));
    }
const start = button('START', () => void begin(), 'cg-btn cg-btn-primary');
const stop = button('STOP', () => void end());
stop.disabled = true;
const note = el('p', 'lab-note', '—');
const cents = el('p', 'lab-cents', '');
const clarity = el('div', 'lab-clarity');
const bar = el('span', 'lab-clarity-bar');
clarity.append(bar);
const trace = el('canvas', 'lab-trace');
const tap = button('TAP · CHORD CHANGE', () => mark(), 'cg-btn lab-tap');
tap.disabled = true;

const recordRow = el('div', 'lab-row');
recordRow.append(start, stop, keyPick);
const readout = el('div', 'lab-readout');
readout.append(note, cents, clarity);

/* ---------- this take ---------- */

const takeBox = el('section', 'lab-take');
takeBox.hidden = true;
const song = field('SONG', 'Riptide');
const chords = field('CHORDS TAPPED', 'Am G C Am G C');
const expect = field('KEY NOTE PER CHORD', 'E E C E E C  (- to skip)');
const chordsToggle = el('label', 'toggle lab-toggle');
const chordsCheck = el('input', '');
chordsCheck.type = 'checkbox';
chordsToggle.append(chordsCheck, ' use the chords in the guess');
const runBp = button('BASIC PITCH', () => void basicPitch());
const download = button('DOWNLOAD', () => {
    if (take) save(take, `${slug(take)}.json`);
});
const drop = button('DELETE', () => void forget(), 'cg-btn cg-btn-quiet');
const takeRow = el('div', 'lab-row');
takeRow.append(chordsToggle, runBp, download, drop);
const card = el('div', 'lab-card');
takeBox.append(el('h2', 'cg-label', 'THIS TAKE'));
for (const input of [song, chords, expect]) {
    const wrap = el('label', 'lab-field');
    wrap.append(el('span', 'cg-label', input.dataset.label), input);
    takeBox.append(wrap);
}
takeBox.append(takeRow, card);

/* ---------- library ---------- */

const library = el('section', 'lab-library');
const list = el('ul', 'lab-list');
const batch = el('div', 'lab-card');
const importer = el('input', 'lab-file');
importer.type = 'file';
importer.accept = '.json,application/json';
importer.multiple = true;
const libraryRow = el('div', 'lab-row');
libraryRow.append(
    button('SCORE ALL', () => void scoreAll(), 'cg-btn cg-btn-primary'),
    button('EXPORT ALL', () => void exportAll()),
    button('IMPORT', () => importer.click()),
    importer,
);
library.append(el('h2', 'cg-label', 'LIBRARY'), libraryRow, list, batch);

root.append(
    el('p', 'cg-brand', 'CHARTS · MELODY LAB'),
    status,
    recordRow,
    readout,
    trace,
    tap,
    takeBox,
    library,
);

function onFrame(f: Frame): void {
    take?.frames.push(f);
    if (f.clarity >= CLEAR && f.hz > 0) {
        const m = midi(f.hz);
        note.textContent = name(m);
        const off = Math.round((m - Math.round(m)) * 100);
        cents.textContent = `${off >= 0 ? '+' : '−'}${Math.abs(off)}¢`;
    } else {
        note.textContent = '—';
        cents.textContent = '';
    }
    bar.style.width = `${Math.round(f.clarity * 100)}%`;
    bar.classList.toggle('lab-clear', f.clarity >= CLEAR);
}

async function begin(): Promise<void> {
    status.textContent = 'Asking for the microphone…';
    chunks = [];
    const got = await capture(onFrame, (pcm, at) => {
        if (!chunks.length) chunkAt = at;
        chunks.push(pcm);
    });
    if (got === 'denied') {
        status.textContent = 'Microphone blocked. Allow it and try again.';
        return;
    }
    if (got === 'unsupported') {
        status.textContent =
            'No microphone access here. It needs https or localhost.';
        return;
    }
    live = got;
    take = {
        version: 2,
        at: new Date().toISOString(),
        device: navigator.userAgent,
        key: keyPick.value || undefined,
        frames: [],
        taps: [],
    };
    takeBox.hidden = true;
    status.textContent = 'Listening. Tap on the first chord to start.';
    start.disabled = true;
    stop.disabled = false;
    tap.disabled = false;
    requestAnimationFrame(paint);
}

function mark(): void {
    if (!live || !take) return;
    take.taps.push(live.now());
    status.textContent = `Chord ${take.taps.length}. Tap at the next change.`;
}

async function end(): Promise<void> {
    if (!live || !take) return;
    const rate = live.rate;
    take.stop = live.now();
    live.stop();
    live = null;
    start.disabled = false;
    stop.disabled = true;
    tap.disabled = true;
    status.textContent = 'Saving the take…';
    if (chunks.length) {
        const pcm = await resample(chunks, rate, AUDIO_RATE);
        take.audio = { rate: AUDIO_RATE, at: chunkAt, pcm: encode(pcm) };
    }
    chunks = [];
    await putTake(take);
    status.textContent = 'Saved. Fill in the chords and key notes to score it.';
    open(take);
    void refresh();
}

/** the last few seconds as dots: bright when clear, faint when not; taps as lines */
function paint(): void {
    const ctx = trace.getContext('2d');
    if (!ctx) return;
    const frames = take?.frames ?? [];
    const taps = take?.taps ?? [];
    const ratio = devicePixelRatio || 1;
    const w = trace.clientWidth;
    const h = trace.clientHeight;
    trace.width = w * ratio;
    trace.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const last = frames[frames.length - 1]?.t ?? 0;
    const x = (t: number): number => w - ((last - t) / WINDOW) * w;
    const y = (m: number): number => h - ((m - LOW) / (HIGH - LOW)) * h;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let m = LOW; m <= HIGH; m += 12) ctx.fillRect(0, y(m), w, 1);
    ctx.fillStyle = 'rgba(197,251,69,0.5)';
    for (const t of taps) if (last - t < WINDOW) ctx.fillRect(x(t), 0, 1, h);
    for (const f of frames) {
        if (last - f.t > WINDOW || f.hz <= 0) continue;
        const clear = f.clarity >= CLEAR;
        ctx.fillStyle = clear ? '#c5fb45' : 'rgba(255,255,255,0.18)';
        const size = clear ? 3 : 2;
        ctx.fillRect(x(f.t) - 1, y(midi(f.hz)) - 1, size, size);
    }
    if (live) requestAnimationFrame(paint);
}

/* ---------- one take ---------- */

function open(t: Take): void {
    take = t;
    takeBox.hidden = false;
    song.value = t.song ?? '';
    chords.value = t.chords ?? '';
    expect.value = t.expect ?? '';
    keyPick.value = t.key ?? '';
    runBp.disabled = !t.audio;
    runBp.textContent = t.bp ? 'BASIC PITCH ✓' : 'BASIC PITCH';
    void render();
}

// what you type is kept as you type it, a moment after you stop
let pending = 0;
const edited = (): void => {
    if (!take) return;
    take.song = song.value.trim() || undefined;
    take.chords = chords.value.trim() || undefined;
    take.expect = expect.value.trim() || undefined;
    window.clearTimeout(pending);
    pending = window.setTimeout(() => {
        if (take) void putTake(take).then(refresh);
        void render();
    }, 400);
};
for (const input of [song, chords, expect])
    input.addEventListener('input', edited);
keyPick.addEventListener('change', () => {
    if (!take || live) return;
    take.key = keyPick.value || undefined;
    void putTake(take);
    void render();
});
chordsCheck.addEventListener('change', () => {
    useChords = chordsCheck.checked;
    if (take) void render();
});

const MARKS: Record<Verdict['mark'], string> = {
    right: '✓',
    wrong: '✗',
    unsure: '?',
    skip: '',
};

function cell(v: Verdict | null): HTMLTableCellElement[] {
    if (!v) return [el('td', 'lab-muted', '—'), el('td', '', '')];
    const pick = el('td', `lab-mark lab-${v.mark}`, nameOf(v.lead));
    pick.append(el('span', 'lab-sign', ` ${MARKS[v.mark]}`));
    return [
        pick,
        el(
            'td',
            'lab-muted',
            v.mark === 'skip' ? '' : v.heard ? 'heard' : 'missed',
        ),
    ];
}

const sum = (t: Tally): string =>
    t.total
        ? `${t.right} right · ${t.wrong} wrong · ${t.unsure} unsure · heard ${t.heard}/${t.total}`
        : 'no answers yet';

async function render(): Promise<void> {
    if (!take) return;
    const c: Card = await cardOf(take, useChords);
    const table = el('table', 'lab-table');
    const head = el('tr', '');
    for (const h of ['#', 'CHORD', 'SHOULD BE', 'OURS', '', 'BASIC PITCH', ''])
        head.append(el('th', '', h));
    table.append(head);
    c.rows.forEach((r, i) => {
        const row = el('tr', '');
        row.append(
            el('td', 'lab-muted', String(i + 1)),
            el('td', '', r.chord || '—'),
            el('td', 'lab-expect', nameOf(r.expect)),
            ...cell(r.ours),
            ...cell(r.bp),
        );
        table.append(row);
    });
    card.replaceChildren(
        el(
            'p',
            'lab-sum',
            `OURS (${c.source === 'audio' ? 're-run on the audio' : 'as heard live'}): ${sum(c.ours)}`,
        ),
        el(
            'p',
            'lab-sum',
            c.bp ? `BASIC PITCH: ${sum(c.bp)}` : 'BASIC PITCH: not run yet',
        ),
        c.rows.length
            ? table
            : el('p', 'lab-status', 'No chords: tap at least once.'),
    );
}

async function basicPitch(t = take): Promise<void> {
    if (!t?.audio) return;
    runBp.disabled = true;
    status.textContent = 'Basic Pitch: loading the model…';
    t.bp = await transcribe(decode(t.audio.pcm), t.audio.at, (p) => {
        status.textContent = `Basic Pitch: ${Math.round(p * 100)}%`;
    });
    await putTake(t);
    status.textContent = 'Basic Pitch done.';
    if (t === take) open(t);
    void refresh();
}

async function forget(): Promise<void> {
    if (!take || !confirm('Delete this take?')) return;
    await removeTake(take.at);
    take = null;
    takeBox.hidden = true;
    void refresh();
}

/* ---------- library ---------- */

const slug = (t: Take): string =>
    `${(t.song ?? 'take').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${t.at.slice(0, 16).replace(/[:T]/g, '-')}`;

function save(data: unknown, file: string): void {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function refresh(): Promise<void> {
    const takes = (await allTakes()).sort((a, b) => b.at.localeCompare(a.at));
    list.replaceChildren(
        ...takes.map((t) => {
            const li = el('li', 'lab-item');
            const when = new Date(t.at).toLocaleString();
            const tags = [
                `${t.taps.length} chords`,
                t.key ? `key ${t.key}` : 'no key',
                t.expect ? 'answers' : 'no answers',
                t.audio ? 'audio' : 'no audio',
                t.bp ? 'basic pitch' : '',
            ].filter(Boolean);
            const words = el('span', 'lab-item-words');
            words.append(
                el('span', 'lab-item-title', t.song ?? 'Untitled'),
                el('span', 'lab-muted', `${when} · ${tags.join(' · ')}`),
            );
            li.append(
                words,
                button('OPEN', () => open(t)),
            );
            return li;
        }),
    );
    if (!takes.length)
        list.append(el('li', 'lab-status', 'No takes yet. Record one above.'));
}

/** every take with answers, Basic Pitch run where it's missing, totals at the bottom */
async function scoreAll(): Promise<void> {
    const takes = (await allTakes()).filter(
        (t) => t.expect && t.taps.length > 0,
    );
    if (!takes.length) {
        batch.replaceChildren(
            el('p', 'lab-status', 'No takes with answers to score yet.'),
        );
        return;
    }
    for (const [i, t] of takes.entries())
        if (t.audio && !t.bp) {
            status.textContent = `Basic Pitch on take ${i + 1} of ${takes.length}…`;
            await basicPitch(t);
        }
    status.textContent = 'Scoring…';
    const table = el('table', 'lab-table');
    const head = el('tr', '');
    for (const h of ['TAKE', 'OURS', 'BASIC PITCH'])
        head.append(el('th', '', h));
    table.append(head);
    let ours = EMPTY;
    let bp = EMPTY;
    for (const t of takes) {
        const c = await cardOf(t, useChords);
        ours = add(ours, c.ours);
        if (c.bp) bp = add(bp, c.bp);
        const row = el('tr', '');
        row.append(
            el('td', '', t.song ?? 'Untitled'),
            el('td', '', sum(c.ours)),
            el('td', '', c.bp ? sum(c.bp) : '—'),
        );
        table.append(row);
    }
    const total = el('tr', 'lab-total');
    total.append(
        el('td', '', 'ALL'),
        el('td', '', sum(ours)),
        el('td', '', sum(bp)),
    );
    table.append(total);
    batch.replaceChildren(
        el(
            'p',
            'lab-sum',
            `${takes.length} takes · chords ${useChords ? 'used' : 'not used'} in the guess`,
        ),
        table,
    );
    status.textContent = 'Scored.';
}

async function exportAll(): Promise<void> {
    save(
        await allTakes(),
        `melody-takes-${new Date().toISOString().slice(0, 10)}.json`,
    );
}

// a single take or a whole export, mixed as you like
importer.addEventListener('change', () => {
    const files = [...(importer.files ?? [])];
    importer.value = '';
    void (async () => {
        let n = 0;
        for (const file of files) {
            try {
                const data = JSON.parse(await file.text()) as Take | Take[];
                for (const t of Array.isArray(data) ? data : [data]) {
                    if (!t.at || !Array.isArray(t.frames)) continue;
                    await putTake(t);
                    n++;
                }
            } catch {
                // not a take: skipped
            }
        }
        status.textContent = `Imported ${n} take${n === 1 ? '' : 's'}.`;
        void refresh();
    })();
});

// space taps, so a pedal that sends space works too
addEventListener('keydown', (e) => {
    if (e.key !== ' ' || !live) return;
    e.preventDefault();
    if (!e.repeat) mark();
});

void refresh();
