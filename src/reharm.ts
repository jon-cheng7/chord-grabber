// Reharm: chord edits as a layer over the sheet, and what to suggest

import { parseChord } from './chord.ts';
import type { Line, Piece } from './parse.ts';
import { minor, mod, noteName, pitch } from './transpose.ts';

/** a chord set on one word; null removes the one that was there */
export interface Edit {
    line: number;
    piece: number;
    chord: string | null;
    /** inserted where there was no chord */
    added?: boolean;
}

export interface Option {
    chord: string;
    why: string;
}

export interface OptionGroup {
    label: string;
    options: Option[];
}

export interface Spot {
    line: number;
    piece: number;
    chord: string;
}

export interface Gap {
    /** where the passing chord goes */
    line: number;
    piece: number;
    from: string;
    to: string;
    options: Option[];
    score: number;
}

const pieces = (line: Line): Piece[] =>
    line.kind === 'lyric'
        ? line.units.flat()
        : line.kind === 'chords'
          ? line.items
          : [];

export function applyEdits(
    lines: readonly Line[],
    edits: readonly Edit[],
): readonly Line[] {
    if (!edits.length) return lines;
    return lines.map((line, i): Line => {
        const mine = edits.filter((e) => e.line === i);
        if (!mine.length) return line;
        const set = (p: Piece, k: number): Piece => {
            const e = mine.find((m) => m.piece === k);
            return e ? { ...p, chord: e.chord } : p;
        };
        if (line.kind === 'lyric') {
            let k = 0;
            const units = line.units.map((u) => u.map((p) => set(p, k++)));
            return { ...line, units, chords: true };
        }
        if (line.kind === 'chords')
            return { ...line, items: line.items.map((p, k) => set(p, k)) };
        return line;
    });
}

/** every chord in order, with where it sits */
export function spots(lines: readonly Line[]): Spot[] {
    const out: Spot[] = [];
    lines.forEach((line, i) =>
        pieces(line).forEach((p, k) => {
            if (p.chord) out.push({ line: i, piece: k, chord: p.chord });
        }),
    );
    return out;
}

export function chordAt(
    lines: readonly Line[],
    line: number,
    piece: number,
): string | null {
    const l = lines[line];
    return l ? (pieces(l)[piece]?.chord ?? null) : null;
}

/** pitch classes, bass first */
export function chordNotes(name: string): { bass: number; tones: number[] } {
    const c = parseChord(name);
    if (!c) return { bass: 0, tones: [] };
    const root = pitch(c.root);
    const q = c.quality;
    let third = minor(q) ? 3 : 4;
    let fifth = 7;
    if (/dim|°/.test(q)) [third, fifth] = [3, 6];
    if (/aug|\+/.test(q)) fifth = 8;
    if (/sus2/.test(q)) third = 2;
    else if (/sus/.test(q)) third = 5;
    const tones = new Set([root, root + third, root + fifth].map(mod));
    if (/maj7|M7|Δ/.test(q)) tones.add(mod(root + 11));
    else if (/dim7|°7/.test(q)) tones.add(mod(root + 9));
    else if (/7/.test(q)) tones.add(mod(root + 10));
    if (/6/.test(q)) tones.add(mod(root + 9));
    if (/9|add2/.test(q)) tones.add(mod(root + 2));
    const bass = c.bass ? pitch(c.bass) : root;
    return { bass, tones: [...tones] };
}

const shared = (a: string, b: string): number => {
    const x = chordNotes(a).tones;
    return chordNotes(b).tones.filter((t) => x.includes(t)).length;
};

interface KeyInfo {
    /** major tonic, the relative major for a minor key */
    tonic: number;
    flats: boolean;
}

function keyInfo(key: string | null, flats: boolean): KeyInfo | null {
    const c = key ? parseChord(key) : null;
    if (!c) return null;
    const root = pitch(c.root);
    return { tonic: minor(c.quality) ? mod(root + 3) : root, flats };
}

// triad on each major scale step
const DIATONIC: Record<number, string> = {
    0: '',
    2: 'm',
    4: 'm',
    5: '',
    7: '',
    9: 'm',
    11: 'dim',
};

const core = (name: string): string => {
    const c = parseChord(name);
    if (!c) return name;
    const kind = /^(?:dim|°)/.test(c.quality)
        ? 'dim'
        : minor(c.quality)
          ? 'm'
          : '';
    return `${c.root}${kind}`;
};

/** what to swap a chord for, safest first in each group */
export function suggestFor(
    name: string,
    key: string | null,
    flats: boolean,
): OptionGroup[] {
    const c = parseChord(name);
    if (!c) return [];
    const k = keyInfo(key, flats);
    const root = pitch(c.root);
    const base = core(name);
    const isMinor = /m$/.test(base);
    const isDim = /dim$/.test(base);
    const n = (p: number): string => noteName(p, flats);
    const deg = (step: number): string =>
        k ? `${n(k.tonic + step)}${DIATONIC[step] ?? ''}` : '';
    const d = k ? mod(root - k.tonic) : -1;

    const colour: Option[] = isDim
        ? [{ chord: `${base}7`, why: 'fuller diminished' }]
        : isMinor
          ? [
                { chord: `${base}7`, why: 'softer, jazzier' },
                { chord: `${base}add9`, why: 'open, airy' },
                { chord: `${c.root}sus4`, why: 'unresolved' },
            ]
          : [
                { chord: `${base}add9`, why: 'open, airy' },
                { chord: `${base}sus2`, why: 'open, no third' },
                { chord: `${base}sus4`, why: 'wants to resolve' },
                {
                    chord: d === 7 ? `${base}7` : `${base}maj7`,
                    why: d === 7 ? 'stronger pull home' : 'warm, dreamy',
                },
            ];

    const third = mod(root + (isMinor || isDim ? 3 : 4));
    const fifth = mod(root + (isDim ? 6 : 7));
    const bass: Option[] = [
        { chord: `${base}/${n(third)}`, why: 'third in the bass: smoother' },
        { chord: `${base}/${n(fifth)}`, why: 'fifth in the bass: floating' },
    ];
    if (k && d !== 0)
        bass.push({ chord: `${base}/${n(k.tonic)}`, why: 'over the home note' });

    const swap: Option[] = [];
    const borrowed: Option[] = [];
    const spicy: Option[] = [];
    if (k) {
        const add = (list: Option[], step: number, why: string, q?: string) => {
            const chord = q === undefined ? deg(step) : `${n(k.tonic + step)}${q}`;
            list.push({ chord, why });
        };
        if (d === 0) {
            add(swap, 9, 'relative minor: same feel, sadder');
            add(swap, 4, 'shares two notes');
        } else if (d === 2) {
            add(swap, 5, 'same job, brighter');
            add(borrowed, 2, 'major 2: pushes to 5', '');
        } else if (d === 4) {
            add(swap, 0, 'shares two notes');
            add(borrowed, 4, 'major 3: leads to 6m', '');
        } else if (d === 5) {
            add(swap, 2, 'same job, softer');
            add(swap, 9, 'shares two notes');
            add(borrowed, 5, 'minor 4: bittersweet', 'm');
            add(borrowed, 10, '♭7: borrowed lift', '');
        } else if (d === 7) {
            add(swap, 4, 'shares two notes');
            add(borrowed, 10, '♭7: softer way home', '');
            add(spicy, 1, 'tritone sub: slides home', '7');
        } else if (d === 9) {
            add(swap, 0, 'same feel, brighter');
            add(swap, 5, 'shares two notes');
            add(borrowed, 8, '♭6: bigger, cinematic', '');
        }
        if (d !== 7 && !isDim)
            spicy.push({ chord: `${n(root)}7`, why: 'dominant: pulls a 4th up' });
    }

    const rank = (list: Option[]): Option[] => {
        const seen = new Set([name]);
        return list
            .filter((o) => {
                if (seen.has(o.chord)) return false;
                seen.add(o.chord);
                return true;
            })
            .sort((a, b) => shared(name, b.chord) - shared(name, a.chord));
    };
    return [
        { label: 'COLOUR', options: rank(colour) },
        { label: 'BASS', options: rank(bass) },
        { label: 'SWAP', options: rank(swap) },
        { label: 'BORROWED', options: rank(borrowed) },
        { label: 'SPICY', options: rank(spicy) },
    ].filter((g) => g.options.length);
}

// fewer, better: a gap needs room, a reason, and somewhere to land
const MIN_WORDS = 3;
const MAX_CHANGES = 3;
const THRESHOLD = 0.35;

const words = (line: Line): Piece[] =>
    line.kind === 'lyric' ? line.units.flat() : [];

/** passing chords worth offering: at most one per line */
export function passingGaps(
    lines: readonly Line[],
    key: string | null,
    flats: boolean,
): Gap[] {
    const k = keyInfo(key, flats);
    const n = (p: number): string => noteName(p, flats);
    const all = spots(lines);
    const best = new Map<number, Gap>();

    all.forEach((a, i) => {
        const b = all[i + 1];
        const line = lines[a.line];
        if (!b || !line || line.kind !== 'lyric') return;
        const ws = words(line);
        if (ws.filter((p) => p.chord).length >= MAX_CHANGES) return;
        const sameLine = b.line === a.line;
        const end = sameLine ? b.piece : ws.length;
        // the words held under chord a, not counting its own
        let at = end - 1;
        while (at > a.piece && !ws[at]?.text.trim()) at--;
        const room = at - a.piece + 1;
        if (room < MIN_WORDS || at <= a.piece) return;

        const ca = parseChord(a.chord);
        const cb = parseChord(b.chord);
        if (!ca || !cb) return;
        const ra = pitch(ca.root);
        const rb = pitch(cb.root);
        const step = mod(rb - ra);
        const bMinor = /m$/.test(core(b.chord));
        const options: Option[] = [];
        let fit = 0;
        let place = at;
        if (step === 2) {
            options.push({ chord: `${n(ra + 1)}dim`, why: 'chromatic step up' });
            fit = 1;
        } else if (step === 10) {
            options.push({ chord: `${core(a.chord)}/${n(ra - 1)}`, why: 'bass steps down' });
            fit = 0.9;
        } else if (step === 8 || step === 9) {
            // walk the bass down a third through the note between
            const mid = mod(ra - (step === 9 ? 1 : 2));
            const over = k
                ? [7, 0, 2, 4, 5, 9]
                      .map((s) => `${n(k.tonic + s)}${DIATONIC[s]}`)
                      .find((ch) => chordNotes(ch).tones.includes(mid))
                : null;
            if (over) {
                const onRoot = chordNotes(over).bass === mid;
                options.push({
                    chord: onRoot ? over : `${over}/${n(mid)}`,
                    why: 'bass walks down',
                });
                fit = 0.9;
                place = Math.round((a.piece + 1 + at) / 2);
            }
        } else if (step === 3 || step === 4) {
            const mid = mod(ra + 2);
            options.push({ chord: `${core(a.chord)}/${n(mid)}`, why: 'bass walks up' });
            fit = 0.8;
            place = Math.round((a.piece + 1 + at) / 2);
        } else if (step === 5) {
            const third = mod(ra + (/m$/.test(core(a.chord)) ? 3 : 4));
            options.push({ chord: `${core(a.chord)}/${n(third)}`, why: 'bass walks up' });
            fit = 0.8;
        } else if (step === 0) {
            options.push({ chord: `${ca.root}sus4`, why: 'a lift and back' });
            if (k) options.push({ chord: `${n(ra + 5)}/${n(ra)}`, why: '4 over the same bass' });
            fit = 0.6;
        }
        // a lead-in works into almost anything but home
        const lead = `${n(rb + 7)}7`;
        if (!(k && rb === k.tonic && !bMinor) && lead !== a.chord) {
            options.push({ chord: lead, why: `lead-in: pulls to ${b.chord}` });
            fit = Math.max(fit, 0.7);
        }
        if (!options.length) return;

        // landing on a new line or section counts most
        const landing = sameLine ? 0.5 : 1;
        const score = (Math.min(room, 6) / 6) * fit * landing;
        if (score < THRESHOLD) return;
        if (place <= a.piece) place = at;
        if (ws[place]?.chord) return;
        const gap = { line: a.line, piece: place, from: a.chord, to: b.chord, options, score };
        const had = best.get(a.line);
        if (!had || had.score < score) best.set(a.line, gap);
    });
    return [...best.values()];
}
