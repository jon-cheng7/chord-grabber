// Melody lab (dev only, /lab.html): sing, tap at each chord change, see what was heard.
// Takes download as pitch tracks and taps, never audio, to build a test set

import './style.css';
import './lab.css';
import { capture, type Capture } from './capture.ts';
import { summarize, tuning, type Frame, type Key } from './listen/summary.ts';
import { parseChord } from './music/chord.ts';
import { minor, noteName, pitch, shiftKey } from './music/theory.ts';

interface Take {
    version: 1;
    at: string;
    device: string;
    frames: Frame[];
    taps: number[];
    /** the song's key, if you set one */
    key?: string;
}

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

const root = document.querySelector<HTMLElement>('#lab')!;
const midi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const name = (m: number): string =>
    `${noteName(Math.round(m), false)}${Math.floor(Math.round(m) / 12) - 1}`;

let take: Take = { version: 1, at: '', device: '', frames: [], taps: [] };
let live: Capture | null = null;

const status = el('p', 'lab-status', 'Sing or hum. Tap at every chord change.');
const note = el('p', 'lab-note', '—');
const cents = el('p', 'lab-cents', '');
const clarity = el('div', 'lab-clarity');
const bar = el('span', 'lab-clarity-bar');
clarity.append(bar);
const trace = el('canvas', 'lab-trace');
const start = button('START', () => void begin(), 'cg-btn cg-btn-primary');
const stop = button('STOP', () => end());
const tap = button('TAP · CHORD CHANGE', () => mark(), 'cg-btn lab-tap');
const save = button('DOWNLOAD TAKE', () => download());
const load = el('input', 'lab-file');
load.type = 'file';
load.accept = '.json,application/json';
const open = button('OPEN TAKE', () => load.click());
const results = el('section', 'lab-results');
stop.disabled = true;
tap.disabled = true;
save.disabled = true;

// the song's key: off-pitch notes are read as the scale note they lean toward
const keyPick = el('select', 'cg-btn lab-key');
keyPick.add(new Option('NO KEY', ''));
for (const m of [false, true])
    for (let i = 0; i < 12; i++) {
        const k = shiftKey(m ? 'Cm' : 'C', i);
        keyPick.add(new Option(`KEY ${k}`, k));
    }
keyPick.addEventListener('change', () => {
    take.key = keyPick.value || undefined;
    if (!live && take.frames.length) report();
});
const keyOf = (name: string | undefined): Key | null => {
    const c = name ? parseChord(name) : null;
    return c ? { tonic: pitch(c.root), minor: minor(c.quality) } : null;
};

const controls = el('div', 'lab-row');
controls.append(start, stop, keyPick, save, open, load);
const readout = el('div', 'lab-readout');
readout.append(note, cents, clarity);
root.append(
    el('p', 'cg-brand', 'CHARTS · MELODY LAB'),
    status,
    controls,
    readout,
    trace,
    tap,
    results,
);

function onFrame(f: Frame): void {
    take.frames.push(f);
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
    const got = await capture(onFrame);
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
        version: 1,
        at: new Date().toISOString(),
        device: navigator.userAgent,
        frames: [],
        taps: [],
        key: keyPick.value || undefined,
    };
    results.replaceChildren();
    status.textContent = 'Listening. Tap on the first chord to start.';
    start.disabled = true;
    stop.disabled = false;
    tap.disabled = false;
    save.disabled = true;
    requestAnimationFrame(paint);
}

function mark(): void {
    if (!live) return;
    take.taps.push(live.now());
    status.textContent = `Chord ${take.taps.length}. Tap at the next change.`;
}

function end(): void {
    live?.stop();
    live = null;
    start.disabled = false;
    stop.disabled = true;
    tap.disabled = true;
    save.disabled = !take.frames.length;
    status.textContent = 'Stopped.';
    report();
}

/** the last few seconds as dots: bright when clear, faint when not; taps as lines */
function paint(): void {
    const ctx = trace.getContext('2d');
    if (!ctx) return;
    const ratio = devicePixelRatio || 1;
    const w = trace.clientWidth;
    const h = trace.clientHeight;
    trace.width = w * ratio;
    trace.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const last = take.frames[take.frames.length - 1]?.t ?? 0;
    const x = (t: number): number => w - ((last - t) / WINDOW) * w;
    const y = (m: number): number => h - ((m - LOW) / (HIGH - LOW)) * h;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let m = LOW; m <= HIGH; m += 12) ctx.fillRect(0, y(m), w, 1);
    ctx.fillStyle = 'rgba(197,251,69,0.5)';
    for (const t of take.taps)
        if (last - t < WINDOW) ctx.fillRect(x(t), 0, 1, h);
    for (const f of take.frames) {
        if (last - f.t > WINDOW || f.hz <= 0) continue;
        const clear = f.clarity >= CLEAR;
        ctx.fillStyle = clear ? '#c5fb45' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(
            x(f.t) - 1,
            y(midi(f.hz)) - 1,
            clear ? 3 : 2,
            clear ? 3 : 2,
        );
    }
    if (live) requestAnimationFrame(paint);
}

/** what the summary made of it: per chord, its notes, or unknown */
function report(): void {
    const spans = summarize(take.frames, take.taps, keyOf(take.key));
    const tuned = tuning(take.frames);
    const sure = spans.filter((s) => s.sure).length;
    results.replaceChildren(
        el(
            'p',
            'cg-label',
            `${spans.length} CHORDS · ${sure} SURE · TUNING ${tuned >= 0 ? '+' : '−'}${Math.abs(Math.round(tuned))}¢`,
        ),
    );
    if (!spans.length) {
        results.append(
            el('p', 'lab-status', 'No closed chords: tap at least twice.'),
        );
        return;
    }
    const table = el('table', 'lab-table');
    const head = el('tr', '');
    for (const h of ['#', 'SECONDS', 'SUNG', 'KMN', 'ALSO', ''])
        head.append(el('th', '', h));
    table.append(head);
    const names = (pcs: number[]): string =>
        pcs.map((n) => noteName(n, false)).join(' ') || '—';
    spans.forEach((s, i) => {
        const row = el('tr', s.sure ? '' : 'lab-unsure');
        // unsure: the front runner, greyed, so a near miss is visible
        const lead = s.key ?? s.notes[0];
        row.append(
            el('td', '', String(i + 1)),
            el('td', '', s.length.toFixed(1)),
            el('td', '', `${Math.round((s.voiced / s.length) * 100)}%`),
            el('td', 'lab-kmn', lead === undefined ? '—' : names([lead])),
            el('td', 'lab-notes', names(s.notes.filter((n) => n !== lead))),
            el('td', '', s.sure ? 'SURE' : 'UNKNOWN'),
        );
        table.append(row);
    });
    results.append(table);
}

function download(): void {
    const blob = new Blob([JSON.stringify(take)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `take-${take.at.replace(/[:.]/g, '-')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// a saved take runs through the summary again: change the rules, compare
load.addEventListener('change', () => {
    const file = load.files?.[0];
    load.value = '';
    if (!file) return;
    void file.text().then((text) => {
        try {
            take = JSON.parse(text) as Take;
            keyPick.value = take.key ?? '';
            status.textContent = `Opened a take from ${take.at}.`;
            save.disabled = false;
            paint();
            report();
        } catch {
            status.textContent = 'That isn’t a take file.';
        }
    });
});

// space taps, so a pedal that sends space works too
addEventListener('keydown', (e) => {
    if (e.key !== ' ' || !live) return;
    e.preventDefault();
    if (!e.repeat) mark();
});
