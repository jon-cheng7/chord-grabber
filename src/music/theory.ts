// Music theory on chord names: pitch, keys, spelling, transposing, numerals, chord notes

import { optional, parseChord } from './chord.ts';

const SHARPS = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// how each key is usually written
const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = [
    'Cm',
    'C#m',
    'Dm',
    'Ebm',
    'Em',
    'Fm',
    'F#m',
    'Gm',
    'G#m',
    'Am',
    'Bbm',
    'Bm',
];
const FLAT_KEYS = new Set([
    'F',
    'Bb',
    'Eb',
    'Ab',
    'Db',
    'Gb',
    'Dm',
    'Gm',
    'Cm',
    'Fm',
    'Bbm',
    'Ebm',
]);
const STEPS: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
};

export const mod = (n: number): number => ((n % 12) + 12) % 12;

export function pitch(note: string): number {
    let p = STEPS[note[0] ?? ''] ?? 0;
    for (const ch of note.slice(1)) p += ch === '#' || ch === '♯' ? 1 : -1;
    return mod(p);
}

export const minor = (quality: string): boolean =>
    /^(?:m(?!aj)|min|-)/.test(quality);

/** 'G' up 2 → 'A', 'Em' up 1 → 'Fm' */
export function noteName(p: number, flats: boolean): string {
    return (flats ? FLATS : SHARPS)[mod(p)] ?? 'C';
}

export function shiftKey(key: string, n: number): string {
    const chord = parseChord(key);
    if (!chord) return key;
    const p = mod(pitch(chord.root) + n);
    return (minor(chord.quality) ? MINOR : MAJOR)[p] ?? key;
}

/** semitones from one key to another, the short way round */
export function keyDistance(from: string, to: string): number {
    const a = parseChord(from);
    const b = parseChord(to);
    if (!a || !b) return 0;
    const d = mod(pitch(b.root) - pitch(a.root));
    return d > 6 ? d - 12 : d;
}

/** an optional chord stays in its brackets */
const keep = (name: string, out: string): string =>
    optional(name) ? `(${out})` : out;

export function transposeChord(
    name: string,
    n: number,
    flats: boolean,
): string {
    const chord = parseChord(name);
    if (!chord) return name;
    const names = flats ? FLATS : SHARPS;
    const note = (root: string): string => names[mod(pitch(root) + n)] ?? root;
    const bass = chord.bass ? `/${note(chord.bass)}` : '';
    return keep(name, `${note(chord.root)}${chord.quality}${bass}`);
}

/** sharps or flats, from the key the chords end up in */
export function usesFlats(writtenKey: string, n: number): boolean {
    return FLAT_KEYS.has(shiftKey(writtenKey, n));
}

/** Cadd9 → C, Em7 → Em, D/F# → D: the root and whether it's minor */
export function simplifyChord(name: string): string {
    const chord = parseChord(name);
    if (!chord) return name;
    const q = chord.quality;
    const kind = /^(?:dim|°)/.test(q) ? 'dim' : minor(q) ? 'm' : '';
    return keep(name, `${chord.root}${kind}`);
}

const DEGREES = [
    '1',
    '♭2',
    '2',
    '♭3',
    '3',
    '4',
    '♯4',
    '5',
    '♭6',
    '6',
    '♭7',
    '7',
];

const NUMERALS = [
    'I',
    '♭II',
    'II',
    '♭III',
    'III',
    'IV',
    '♯IV',
    'V',
    '♭VI',
    'VI',
    '♭VII',
    'VII',
];

/** G in the key of D → IV; Em7 → ii7; Bdim → vii°; D/F# → I/3 */
export function numberChord(name: string, key: string): string {
    const chord = parseChord(name);
    const home = parseChord(key);
    if (!chord || !home) return name;
    const tonic = pitch(home.root);
    const step = (note: string): number => mod(pitch(note) - tonic);
    // minor and diminished in lower case, so the m goes
    const dim = /^(?:dim|°)/.exec(chord.quality);
    const low = dim || minor(chord.quality);
    const quality = dim
        ? `°${chord.quality.slice(dim[0].length)}`
        : chord.quality.replace(/^(?:min|m(?!aj)|-)/, '');
    const numeral = NUMERALS[step(chord.root)] ?? '?';
    // the bass as a scale step, like figured bass
    const bass = chord.bass ? `/${DEGREES[step(chord.bass)] ?? '?'}` : '';
    const shown = `${low ? numeral.toLowerCase() : numeral}${quality}${bass}`;
    return keep(name, shown);
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
    // a 9, 11 or 13 carries its seventh along, unless it's only added
    const stacked = !/add/.test(q) && /9|11|13/.test(q);
    if (/maj|M7|Δ/.test(q) && (/7/.test(q) || stacked))
        tones.add(mod(root + 11));
    else if (/dim7|°7/.test(q)) tones.add(mod(root + 9));
    else if (/7/.test(q) || stacked) tones.add(mod(root + 10));
    if (/6/.test(q)) tones.add(mod(root + 9));
    if (/9|add2/.test(q)) tones.add(mod(root + 2));
    if (/11/.test(q)) tones.add(mod(root + 5));
    if (/13/.test(q)) tones.add(mod(root + 9));
    const bass = c.bass ? pitch(c.bass) : root;
    return { bass, tones: [...tones] };
}
