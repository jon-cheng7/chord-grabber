// Styles, and chords as style tables count them: a step from home and a shape,
// so C–Am–F–G in C and D–Bm–G–A in D count as one progression

import { parseChord } from '../music/chord.ts';
import { minor, mod, noteName, pitch } from '../music/theory.ts';

export interface Style {
    id: string;
    name: string;
    /** genre tags that put a corpus song in this style */
    tags: string[];
    /** how far melody colours (9ths, 13ths…) are welcome, 0–1 */
    tension: number;
}

export const STYLES: Style[] = [
    { id: 'pop', name: 'Pop', tags: ['pop'], tension: 0.3 },
    { id: 'rock', name: 'Rock', tags: ['rock'], tension: 0.2 },
    {
        id: 'country',
        name: 'Country',
        tags: ['country', 'americana', 'bluegrass'],
        tension: 0.2,
    },
    {
        id: 'jazz',
        name: 'Jazz',
        tags: ['jazz', 'bossa nova', 'swing', 'bebop'],
        tension: 1,
    },
    {
        id: 'soul',
        name: 'Soul',
        tags: ['soul', 'r&b', 'gospel', 'motown'],
        tension: 0.8,
    },
    { id: 'funk', name: 'Funk', tags: ['funk', 'disco'], tension: 0.7 },
    { id: 'blues', name: 'Blues', tags: ['blues'], tension: 0.6 },
];

/** a style's counts, as the corpus script writes them */
export interface StyleTable {
    songs: number;
    /** token → how often it's played */
    uni: Record<string, number>;
    /** "a>b" → how often b follows a */
    bi: Record<string, number>;
}

/** the shapes counted; anything else is read as the nearest of these */
export function shapeOf(quality: string): string {
    const q = quality
        .replace(/^(?:min|-)/, 'm')
        .replace(/M7|Δ/, 'maj7')
        .replace(/[()]/g, '');
    if (/^(?:m7b5|ø)/.test(q)) return 'm7b5';
    if (/^(?:dim7|°7)/.test(q)) return 'dim7';
    if (/^(?:dim|°)/.test(q)) return 'dim';
    if (/^(?:aug|\+)/.test(q)) return 'aug';
    if (/^5$|no3/.test(q)) return '5';
    if (minor(q)) {
        const rest = q.slice(1);
        if (/11/.test(rest)) return 'm11';
        if (/9|13/.test(rest) && !/add/.test(rest)) return 'm9';
        if (/7/.test(rest)) return 'm7';
        if (/6/.test(rest)) return 'm6';
        return 'm';
    }
    if (/^maj(?:9|11|13)/.test(q)) return 'maj9';
    if (/^maj7/.test(q)) return 'maj7';
    if (/^(?:7|9|13)sus|^sus.*7/.test(q)) return '7sus4';
    if (/^sus2/.test(q)) return 'sus2';
    if (/^sus/.test(q)) return 'sus4';
    if (/^13/.test(q)) return '13';
    if (/^11/.test(q)) return '11';
    if (/^9/.test(q)) return '9';
    if (/^7/.test(q)) return '7';
    if (/^6/.test(q)) return '6';
    if (/^(?:add9|add2|2$)/.test(q)) return 'add9';
    return '';
}

/** the tonic tables count from: a minor key's relative major, so modes don't split the counts */
export function homeOf(key: string): number {
    const c = parseChord(key);
    if (!c) return 0;
    return mod(pitch(c.root) + (minor(c.quality) ? 3 : 0));
}

/** "7|7" is V7 from home; the bass is left out */
export function tokenOf(chord: string, home: number): string | null {
    const c = parseChord(chord);
    return c ? `${mod(pitch(c.root) - home)}|${shapeOf(c.quality)}` : null;
}

export function chordOf(token: string, home: number, flats: boolean): string {
    const [step = '0', shape = ''] = token.split('|');
    return `${noteName(home + Number(step), flats)}${shape}`;
}
