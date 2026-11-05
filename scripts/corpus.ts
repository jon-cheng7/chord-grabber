// Songs → style tables. Reads Chordonomicon's CSV, finds each song's key, counts every
// chord and every move between chords per style, relative to home.
//   node scripts/corpus.ts data/chordonomicon_v2.csv
// Writes src/engine/style-data.ts (what the app ships) and data/heldout.json (a fifth of
// the songs, kept out of the tables, for scripts/evaluate.ts to judge with)

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
    homeOf,
    rankKeys,
    STYLES,
    tokenOf,
    type StyleTable,
} from '../src/engine/index.ts';
import { isChord } from '../src/music/chord.ts';

// what the app ships: moves seen at least this often, at most this many per style
const MIN_COUNT = 3;
const MAX_MOVES = 3000;
// held-out songs kept per style for evaluation
const EVAL_SONGS = 150;

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/corpus.ts data/chordonomicon_v2.csv');
    process.exit(1);
}

/** a CSV line into fields; quotes may wrap a field */
function fields(line: string): string[] {
    const out: string[] = [];
    let at = 0;
    while (at <= line.length) {
        if (line[at] === '"') {
            let text = '';
            at++;
            while (at < line.length) {
                if (line[at] === '"' && line[at + 1] === '"') {
                    text += '"';
                    at += 2;
                } else if (line[at] === '"') {
                    at++;
                    break;
                } else text += line[at++];
            }
            out.push(text);
            at++;
        } else {
            const end = line.indexOf(',', at);
            const stop = end < 0 ? line.length : end;
            out.push(line.slice(at, stop));
            at = stop + 1;
        }
    }
    return out;
}

/** Chordonomicon writes Fs7, Amin, Gno3d, A/Cs: into Charts' own spelling */
function chordOf(token: string): string | null {
    const m = /^([A-G])(s|b)?([^/]*)(?:\/([A-G])(s|b)?)?$/.exec(token);
    if (!m) return null;
    const sign = (x: string | undefined): string =>
        x === 's' ? '#' : (x ?? '');
    const quality = (m[3] ?? '').replace(/^min/, 'm').replace(/no3d/, '5');
    const bass = m[4] ? `/${m[4]}${sign(m[5])}` : '';
    const chord = `${m[1]}${sign(m[2])}${quality}${bass}`;
    return isChord(chord) ? chord : null;
}

/** sections of chords, a held chord counted once */
function sectionsOf(text: string): string[][] {
    const out: string[][] = [];
    let now: string[] = [];
    for (const t of text.trim().split(/\s+/)) {
        if (/^<.*>$/.test(t)) {
            if (now.length) out.push(now);
            now = [];
            continue;
        }
        const chord = chordOf(t);
        if (chord && chord !== now[now.length - 1]) now.push(chord);
    }
    if (now.length) out.push(now);
    return out;
}

const styleOf = (tags: string[]): string[] =>
    STYLES.filter((s) =>
        tags.some((t) => s.tags.some((x) => t.includes(x))),
    ).map((s) => s.id);

const empty = (): StyleTable => ({ songs: 0, uni: {}, bi: {} });
const kept: Record<string, StyleTable> = {};
const held: Record<string, StyleTable> = {};
const evalSongs: Record<string, string[][][]> = {};
for (const s of STYLES) {
    kept[s.id] = empty();
    held[s.id] = empty();
    evalSongs[s.id] = [];
}

function count(table: StyleTable, sections: string[][], home: number): void {
    table.songs++;
    for (const section of sections) {
        let prev: string | null = null;
        for (const chord of section) {
            const token = tokenOf(chord, home);
            if (!token) continue;
            table.uni[token] = (table.uni[token] ?? 0) + 1;
            if (prev)
                table.bi[`${prev}>${token}`] =
                    (table.bi[`${prev}>${token}`] ?? 0) + 1;
            prev = token;
        }
    }
}

let head: string[] | null = null;
let rows = 0;
let used = 0;
const lines = createInterface({ input: createReadStream(file) });
for await (const line of lines) {
    if (!head) {
        head = fields(line);
        continue;
    }
    if (++rows % 50000 === 0)
        console.log(`${rows} songs read, ${used} counted`);
    const f = fields(line);
    const get = (name: string): string => f[head!.indexOf(name)] ?? '';
    const tags = [
        ...[...get('genres').matchAll(/'([^']+)'/g)].map((m) => m[1]!),
        get('main_genre'),
        get('rock_genre'),
    ]
        .map((t) => t.toLowerCase())
        .filter(Boolean);
    const styles = styleOf(tags);
    if (!styles.length) continue;
    const sections = sectionsOf(get('chords'));
    const slots = sections.flatMap((s, i) =>
        s.map((chord, k) => ({ chord, section: String(i), starts: k === 0 })),
    );
    const key = rankKeys(slots)[0]?.key;
    if (!key || slots.length < 4) continue;
    used++;
    const home = homeOf(key);
    // a fifth kept out, by id, so every run splits alike
    const out = Number(get('id')) % 5 === 0;
    for (const id of styles) {
        count((out ? held : kept)[id]!, sections, home);
        if (out && evalSongs[id]!.length < EVAL_SONGS)
            evalSongs[id]!.push(sections);
    }
}

/** the commonest moves, enough to ship */
function trim(t: StyleTable): StyleTable {
    const uni = Object.fromEntries(
        Object.entries(t.uni).filter(([, n]) => n >= MIN_COUNT),
    );
    const bi = Object.fromEntries(
        Object.entries(t.bi)
            .filter(([, n]) => n >= MIN_COUNT)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_MOVES),
    );
    return { songs: t.songs, uni, bi };
}

const shipped = Object.fromEntries(
    Object.entries(kept)
        .filter(([, t]) => t.songs > 0)
        .map(([id, t]) => [id, trim(t)]),
);
writeFileSync(
    'src/engine/style-data.ts',
    `// Written by scripts/corpus.ts. Counts from Chordonomicon (Kantarelis et al., 2024), CC BY-NC 4.0\n\n` +
        `import type { StyleTable } from './styles.ts';\n\n` +
        `export const TABLES: Record<string, StyleTable> = ${JSON.stringify(shipped)};\n`,
);
mkdirSync('data', { recursive: true });
writeFileSync(
    'data/heldout.json',
    JSON.stringify({ tables: held, songs: evalSongs }),
);

console.log(`\n${rows} songs read, ${used} counted`);
for (const s of STYLES)
    console.log(
        `${s.name.padEnd(8)} ${String(kept[s.id]!.songs).padStart(7)} songs  ` +
            `${Object.keys(shipped[s.id]?.bi ?? {}).length} moves shipped  ` +
            `${held[s.id]!.songs} held out`,
    );
