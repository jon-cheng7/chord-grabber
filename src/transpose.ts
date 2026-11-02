// Chords and keys moved up or down by semitones

import { isChord, parseChord } from './chord.ts';
import type { Line, Piece } from './parse.ts';

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
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
    return `${note(chord.root)}${chord.quality}${bass}`;
}

/** sharps or flats, from the key the chords end up in */
export function usesFlats(writtenKey: string, n: number): boolean {
    return FLAT_KEYS.has(shiftKey(writtenKey, n));
}

/** the first chord stands in for an unknown key */
export function firstChord(lines: readonly Line[]): string | null {
    for (const line of lines) {
        const pieces =
            line.kind === 'lyric'
                ? line.units.flat()
                : line.kind === 'chords'
                  ? line.items
                  : [];
        const hit = pieces.find((p) => p.chord);
        if (hit?.chord) {
            const c = parseChord(hit.chord);
            if (c) return `${c.root}${minor(c.quality) ? 'm' : ''}`;
        }
    }
    return null;
}

/** every chord name through one function, bar notation included */
function mapChords(
    lines: readonly Line[],
    fn: (name: string) => string,
): readonly Line[] {
    const move = (p: Piece): Piece =>
        p.chord ? { ...p, chord: fn(p.chord) } : p;
    // bar notation like |C / G / |, left as text by the parser
    const text = (t: string): string =>
        t.replace(/[^\s|]+/g, (token) =>
            isChord(token) ? fn(token) : token,
        );
    return lines.map((line): Line => {
        if (line.kind === 'lyric')
            return { ...line, units: line.units.map((u) => u.map(move)) };
        if (line.kind === 'chords')
            return {
                ...line,
                items: line.items.map((p) =>
                    p.chord ? move(p) : { ...p, text: text(p.text) },
                ),
            };
        return line;
    });
}

export function transposeLines(
    lines: readonly Line[],
    n: number,
    flats: boolean,
): readonly Line[] {
    if (!mod(n)) return lines;
    return mapChords(lines, (name) => transposeChord(name, n, flats));
}

/** Cadd9 → C, Em7 → Em, D/F# → D: the root and whether it's minor */
export function simplifyChord(name: string): string {
    const chord = parseChord(name);
    if (!chord) return name;
    const q = chord.quality;
    const kind = /^(?:dim|°)/.test(q) ? 'dim' : minor(q) ? 'm' : '';
    return `${chord.root}${kind}`;
}

export function simplifyLines(lines: readonly Line[]): readonly Line[] {
    return mapChords(lines, simplifyChord);
}
