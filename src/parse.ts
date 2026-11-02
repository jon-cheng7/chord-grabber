// Chord sheet text → lines of chords and lyrics

import { isChord, isChordLineFiller } from './chord.ts';

/** a chord sitting over the start of text; text may be empty */
export interface Piece {
    chord: string | null;
    text: string;
}

export type Line =
    | { kind: 'section'; label: string }
    | { kind: 'blank' }
    /** unbreakable word groups, so wrapping never splits a chord from its syllable */
    | { kind: 'lyric'; units: Piece[][]; chords: boolean }
    | { kind: 'chords'; items: Piece[] }
    | { kind: 'tab'; text: string };

interface Placed {
    col: number;
    name: string;
}

interface Scanned {
    /** line with chord markup removed */
    text: string;
    chords: Placed[];
    /** nothing but chords and filler */
    chordOnly: boolean;
    /** inline chords: words without the names, chords at word positions */
    bare: string;
    bareChords: Placed[];
}

// columns a chord can drift right to reach its word
const SNAP = 2;
const SECTION = /^\s*\[([^\]]{1,40})\]\s*$/;
const TAB = /^\s*[eBGDAEbgdae]?\s*\|[-0-9hpbr/\\~x|()\s]*$/;

/** UG marks chords as [ch]Am[/ch]; columns count once the tags are gone */
function scanMarked(line: string): Scanned {
    const chords: Placed[] = [];
    const bareChords: Placed[] = [];
    let text = '';
    let bare = '';
    const re = /\[ch\](.*?)\[\/ch\]/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
        const between = line.slice(last, m.index);
        text += between;
        bare += between;
        const name = m[1] ?? '';
        chords.push({ col: text.length, name });
        bareChords.push({ col: bare.length, name });
        text += name;
        last = m.index + m[0].length;
    }
    text += line.slice(last);
    bare += line.slice(last);
    const chordOnly =
        chords.length > 0 &&
        bare.split(/\s+/).filter(Boolean).every(isChordLineFiller);
    return { text, chords, chordOnly, bare, bareChords };
}

/** plain text: a chord line is one where every word is a chord or filler */
function scanPlain(line: string): Scanned {
    const chords: Placed[] = [];
    let words = 0;
    let fillerOnly = true;
    // bars split off: |C / G / |
    for (const m of line.matchAll(/[^\s|]+|\|+/g)) {
        words++;
        if (isChord(m[0])) {
            chords.push({ col: m.index, name: m[0] });
            fillerOnly = false;
        } else if (!isChordLineFiller(m[0])) {
            return {
                text: line,
                chords: [],
                chordOnly: false,
                bare: line,
                bareChords: [],
            };
        }
    }
    const chordOnly = words > 0 && !fillerOnly;
    return {
        text: line,
        chords: chordOnly ? chords : [],
        chordOnly,
        bare: line,
        bareChords: [],
    };
}

/** chords over a lyric line → pieces split at chord columns, grouped into words */
export function pair(lyric: string, chords: Placed[]): Piece[][] {
    // a chord a column or two left of its word belongs to that word
    const snapped = chords.map((c) => {
        let col = c.col;
        while (col - c.col < SNAP && lyric[col] === ' ') col++;
        const taken = chords.some((o) => o !== c && o.col === col);
        return /\S/.test(lyric[col] ?? '') && !taken ? { ...c, col } : c;
    });
    const sorted = snapped.sort((a, b) => a.col - b.col);
    const last = sorted[sorted.length - 1];
    // chords past the end of the words still need somewhere to sit
    const padded =
        last && last.col >= lyric.length ? lyric.padEnd(last.col + 1) : lyric;
    const pieces: Piece[] = [];
    const first = sorted[0]?.col ?? padded.length;
    if (first > 0) pieces.push({ chord: null, text: padded.slice(0, first) });
    sorted.forEach((c, i) => {
        const end = sorted[i + 1]?.col ?? padded.length;
        pieces.push({
            chord: c.name,
            text: padded.slice(c.col, Math.max(c.col, end)),
        });
    });

    // split on spaces; a piece cut mid-word joins the next piece's unit
    const units: Piece[][] = [];
    let unit: Piece[] = [];
    for (const piece of pieces) {
        const parts = piece.text.match(/\S+\s*|\s+/g) ?? [''];
        parts.forEach((part, i) => {
            unit.push({ chord: i === 0 ? piece.chord : null, text: part });
            if (/\s$/.test(part)) {
                units.push(unit);
                unit = [];
            }
        });
    }
    if (unit.length) units.push(unit);
    return units;
}

function chordItems(scan: Scanned): Piece[] {
    const items: Piece[] = [];
    let cursor = 0;
    for (const c of scan.chords) {
        const gap = scan.text.slice(cursor, c.col);
        if (gap.trim()) items.push({ chord: null, text: gap.trim() });
        items.push({ chord: c.name, text: '' });
        cursor = c.col + c.name.length;
    }
    const tail = scan.text.slice(cursor).trim();
    if (tail) items.push({ chord: null, text: tail });
    return items;
}

function scanLine(line: string, marked: boolean): Scanned {
    if (!marked) return scanPlain(line);
    const scan = scanMarked(line);
    if (scan.chords.length) return scan;
    // a plain chord line among marked ones
    const plain = scanPlain(line);
    return plain.chordOnly ? plain : scan;
}

export function parseSheet(source: string): Line[] {
    const marked = source.includes('[ch]');
    const raw = source
        .replace(/\r\n?/g, '\n')
        .replace(/\[\/?tab\]/g, '')
        .split('\n');
    const lines: Line[] = [];

    for (let i = 0; i < raw.length; i++) {
        const line = (raw[i] ?? '').replace(/\t/g, '    ').trimEnd();
        if (!line.trim()) {
            if (lines[lines.length - 1]?.kind !== 'blank')
                lines.push({ kind: 'blank' });
            continue;
        }
        const section = SECTION.exec(line);
        if (section && !line.includes('[ch]')) {
            lines.push({ kind: 'section', label: (section[1] ?? '').trim() });
            continue;
        }
        if (TAB.test(line) && line.includes('-')) {
            const prev = lines[lines.length - 1];
            if (prev?.kind === 'tab') prev.text += `\n${line}`;
            else lines.push({ kind: 'tab', text: line });
            continue;
        }

        const scan = scanLine(line, marked);
        if (scan.chordOnly) {
            const next = (raw[i + 1] ?? '').replace(/\t/g, '    ').trimEnd();
            const nextScan = scanLine(next, marked);
            const lyricNext =
                next.trim() !== '' &&
                !SECTION.test(next) &&
                !nextScan.chordOnly &&
                !(TAB.test(next) && next.includes('-'));
            if (lyricNext) {
                // chords inline in the lyric line too, rare: keep them
                lines.push({
                    kind: 'lyric',
                    units: pair(nextScan.bare, [
                        ...scan.chords,
                        ...nextScan.bareChords,
                    ]),
                    chords: true,
                });
                i++;
            } else {
                lines.push({ kind: 'chords', items: chordItems(scan) });
            }
            continue;
        }

        lines.push({
            kind: 'lyric',
            units: pair(scan.bare, scan.bareChords),
            chords: scan.bareChords.length > 0,
        });
    }

    while (lines[0]?.kind === 'blank') lines.shift();
    while (lines[lines.length - 1]?.kind === 'blank') lines.pop();
    return lines;
}
