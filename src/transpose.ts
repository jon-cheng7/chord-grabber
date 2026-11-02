// Chords and keys moved up or down by semitones, across a whole sheet

import { isChord } from './music/chord.ts';
import {
    mod,
    numberChord,
    simplifyChord,
    transposeChord,
} from './music/theory.ts';
import type { Line, Piece } from './parse.ts';

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

export function simplifyLines(lines: readonly Line[]): readonly Line[] {
    return mapChords(lines, simplifyChord);
}

export function numberLines(
    lines: readonly Line[],
    key: string,
): readonly Line[] {
    return mapChords(lines, (name) => numberChord(name, key));
}
