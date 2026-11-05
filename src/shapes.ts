// Guitar shapes: a chord name → its fingerings, drawn as diagrams. The shapes are
// chords-db's (MIT), loaded the first time one is asked for

import { parseChord } from './music/chord.ts';
import { mod, pitch } from './music/theory.ts';

export interface Position {
    /** per string, low E first: −1 not played, 0 open, else the fret counted from baseFret */
    frets: number[];
    fingers: number[];
    baseFret: number;
    barres: number[];
    /** the lowest barre covers every string */
    capo?: boolean;
}

export interface Shape {
    /** the chord asked for */
    name: string;
    positions: Position[];
    /** what's shown instead, when there's no exact shape */
    instead?: string;
    /** a slash chord's bass, when the shape doesn't play it */
    bass?: string;
}

interface Db {
    chords: Record<
        string,
        { key: string; suffix: string; positions: Position[] }[]
    >;
}

// chords-db names its keys and slash basses its own way
const KEYS = [
    'C',
    'Csharp',
    'D',
    'Eb',
    'E',
    'F',
    'Fsharp',
    'G',
    'Ab',
    'A',
    'Bb',
    'B',
];
const BASSES = [
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
    'Bb',
    'B',
];

// our spellings → chords-db's suffixes; anything not here falls back
const SUFFIXES: Record<string, string> = {
    '': 'major',
    maj: 'major',
    m: 'minor',
    dim: 'dim',
    '°': 'dim',
    dim7: 'dim7',
    '°7': 'dim7',
    sus2: 'sus2',
    2: 'add9',
    sus: 'sus4',
    sus4: 'sus4',
    '7sus': '7sus4',
    '7sus4': '7sus4',
    aug: 'aug',
    '+': 'aug',
    alt: 'alt',
    '7alt': 'alt',
    6: '6',
    69: '69',
    '6/9': '69',
    7: '7',
    '7b5': '7b5',
    aug7: 'aug7',
    '7#5': 'aug7',
    '+7': 'aug7',
    9: '9',
    '9b5': '9b5',
    aug9: 'aug9',
    '9#5': 'aug9',
    '7b9': '7b9',
    '7#9': '7#9',
    11: '11',
    '9#11': '9#11',
    13: '13',
    maj7: 'maj7',
    maj7b5: 'maj7b5',
    'maj7#5': 'maj7#5',
    maj9: 'maj9',
    maj11: 'maj11',
    maj13: 'maj13',
    m6: 'm6',
    m69: 'm69',
    'm6/9': 'm69',
    m7: 'm7',
    m7b5: 'm7b5',
    ø: 'm7b5',
    ø7: 'm7b5',
    m9: 'm9',
    m11: 'm11',
    mmaj7: 'mmaj7',
    mmaj9: 'mmaj9',
    add9: 'add9',
    add2: 'add9',
    madd9: 'madd9',
    madd2: 'madd9',
};

// the nearest everyday chord, for a suffix with no shape: 7#11 → 7
const NEAREST: [RegExp, string][] = [
    [/^mmaj/, 'mmaj7'],
    [/^m7b5|^ø/, 'm7b5'],
    [/^m(?:9|11|13)/, 'm7'],
    [/^m7/, 'm7'],
    [/^m6/, 'm6'],
    [/^m/, 'minor'],
    [/^maj/, 'maj7'],
    [/^dim/, 'dim'],
    [/^aug|^\+/, 'aug'],
    [/^7?sus/, 'sus4'],
    [/^(?:7|9|11|13)/, '7'],
    [/^6/, '6'],
    [/^5$|^no3/, 'major'],
    [/^add/, 'add9'],
];

let db: Promise<Db> | null = null;
const load = (): Promise<Db> =>
    (db ??= import('@tombatossals/chords-db/lib/guitar.json').then(
        (m) => m.default as Db,
    ));

/** chords-db's own spelling of a quality */
const tidy = (q: string): string =>
    q
        .replace(/^(?:min|-)(?!aj)/, 'm')
        .replace(/M7|Δ7?/, 'maj7')
        .replace(/mMaj|m\(maj/, 'mmaj')
        .replace(/[()]/g, '');

/** the fingerings for a chord as written; null if it isn't a chord */
export async function shapeOf(name: string): Promise<Shape | null> {
    const c = parseChord(name);
    if (!c) return null;
    const list = (await load()).chords[KEYS[pitch(c.root)]!] ?? [];
    const find = (suffix: string) => list.find((x) => x.suffix === suffix);
    const q = tidy(c.quality);
    const exact = SUFFIXES[q];
    if (c.bass) {
        const bass = BASSES[mod(pitch(c.bass))]!;
        const slash =
            (exact === 'major' && find(`/${bass}`)) ||
            (exact === 'minor' && find(`m/${bass}`));
        if (slash) return { name, positions: slash.positions };
    }
    const own = exact ? find(exact) : undefined;
    const near = own
        ? undefined
        : find(NEAREST.find(([re]) => re.test(q))?.[1] ?? 'major');
    const found = own ?? near;
    if (!found) return null;
    const label = (s: string): string =>
        s === 'major' ? '' : s === 'minor' ? 'm' : s;
    return {
        name,
        positions: found.positions,
        instead: own ? undefined : `${c.root}${label(found.suffix)}`,
        bass: c.bass ?? undefined,
    };
}

// the diagram's grid: six strings, four frets
const STRINGS = 6;
const FRETS = 4;
const GAP = 14;
const LEFT = 14;
const TOP = 24;
const ROW = 18;

/** one fingering as an SVG; lefty mirrors it, low E on the right */
export function diagram(p: Position, lefty = false): string {
    const x = (s: number): number => LEFT + (lefty ? STRINGS - 1 - s : s) * GAP;
    const y = (fret: number): number => TOP + (fret - 0.5) * ROW;
    const right = LEFT + (STRINGS - 1) * GAP;
    const bottom = TOP + FRETS * ROW;
    const parts: string[] = [];
    // the nut is thick only at the top of the neck
    parts.push(
        `<line class="cg-shape-nut" x1="${LEFT}" y1="${TOP}" x2="${right}" y2="${TOP}" stroke-width="${p.baseFret === 1 ? 4 : 1}"/>`,
    );
    for (let f = 1; f <= FRETS; f++)
        parts.push(
            `<line class="cg-shape-line" x1="${LEFT}" y1="${TOP + f * ROW}" x2="${right}" y2="${TOP + f * ROW}"/>`,
        );
    for (let s = 0; s < STRINGS; s++)
        parts.push(
            `<line class="cg-shape-line" x1="${x(s)}" y1="${TOP}" x2="${x(s)}" y2="${bottom}"/>`,
        );
    if (p.baseFret > 1)
        parts.push(
            `<text class="cg-shape-fret" x="${lefty ? LEFT - 6 : right + 6}" y="${y(1) + 4}" text-anchor="${lefty ? 'end' : 'start'}">${p.baseFret}fr</text>`,
        );
    // over the nut: x not played, o open
    p.frets.forEach((f, s) => {
        if (f <= 0)
            parts.push(
                `<text class="cg-shape-open" x="${x(s)}" y="${TOP - 8}" text-anchor="middle">${f < 0 ? '×' : '○'}</text>`,
            );
    });
    const barred = new Set<string>();
    p.barres.forEach((b, k) => {
        const on = p.frets.flatMap((f, s) => (f === b ? [s] : []));
        if (!on.length) return;
        const played = p.frets.flatMap((f, s) => (f >= 0 ? [s] : []));
        // the lowest barre with capo covers every string played, the rest only theirs
        const from = p.capo && k === 0 ? Math.min(...played) : Math.min(...on);
        const to = p.capo && k === 0 ? Math.max(...played) : Math.max(...on);
        const [a, z] = [x(from), x(to)].sort((m, n) => m - n);
        parts.push(
            `<rect class="cg-shape-dot" x="${a! - 6}" y="${y(b) - 6}" width="${z! - a! + 12}" height="12" rx="6"/>`,
        );
        for (let s = from; s <= to; s++)
            if (p.frets[s] === b) barred.add(`${s}`);
        const finger = p.fingers[on[0]!];
        if (finger)
            parts.push(
                `<text class="cg-shape-finger" x="${(a! + z!) / 2}" y="${y(b) + 3.5}" text-anchor="middle">${finger}</text>`,
            );
    });
    p.frets.forEach((f, s) => {
        if (f <= 0 || barred.has(`${s}`)) return;
        parts.push(
            `<circle class="cg-shape-dot" cx="${x(s)}" cy="${y(f)}" r="6"/>`,
        );
        const finger = p.fingers[s];
        if (finger)
            parts.push(
                `<text class="cg-shape-finger" x="${x(s)}" y="${y(f) + 3.5}" text-anchor="middle">${finger}</text>`,
            );
    });
    const width = right + LEFT + 10;
    return `<svg class="cg-shape" viewBox="${lefty ? -10 : 0} 0 ${width} ${bottom + 6}" width="${width}" height="${bottom + 6}" role="img">${parts.join('')}</svg>`;
}
