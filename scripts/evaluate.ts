// How good the style reharm is, as numbers you can compare run to run:
//   style     does the result read as that style? A judge built from songs the tables
//             never saw (data/heldout.json) names each song's likeliest style. "judge
//             knows" is how often it names a song's own style right: the ceiling to read against
//   distinct  per chord, how much likelier its move is in the style than in all of them
//   faithful  how much of the original each chord keeps
//   changed   share of chords changed
//   melody    how well the chords suit your sung takes (takes/), before → after
//   node scripts/evaluate.ts [--strength 0.5] [--songs 20]
// Each run is saved to data/results/ and compared with the one before

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import {
    features,
    homeOf,
    modelOf,
    poolOf,
    rankKeys,
    restyle,
    STYLES,
    tokenOf,
    WEIGHTS,
    type Model,
    type Slot,
    type Song,
    type StyleTable,
} from '../src/engine/index.ts';
import { TABLES } from '../src/engine/style-data.ts';
import { notes, score, tuning } from '../src/listen/summary.ts';
import { track } from '../src/listen/track.ts';
import { keyOf } from '../src/lab/score.ts';
import { decode, type Take } from '../src/lab/takes.ts';

const arg = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const STRENGTH = arg('strength', 0.5);
const PER_STYLE = arg('songs', 20);

if (!Object.keys(TABLES).length || !existsSync('data/heldout.json')) {
    console.error('No style tables yet: run node scripts/corpus.ts first');
    process.exit(1);
}
const heldout = JSON.parse(readFileSync('data/heldout.json', 'utf8')) as {
    tables: Record<string, StyleTable>;
    songs: Record<string, string[][][]>;
};
const styles = STYLES.filter((s) => TABLES[s.id]);
const pool = poolOf(styles.map((s) => TABLES[s.id]!));
const models = new Map(styles.map((s) => [s.id, modelOf(TABLES[s.id]!, pool)]));
const judges = new Map(
    styles.map((s) => [s.id, modelOf(heldout.tables[s.id]!)]),
);

const songOf = (sections: string[][], key?: string): Song => {
    const slots: Slot[] = sections.flatMap((s, i) =>
        s.map((chord, k) => ({
            id: `${i}:${k}`,
            chord,
            section: String(i),
            label: '',
            starts: k === 0,
            ends: k === s.length - 1,
            held: 0,
            locked: false,
        })),
    );
    return { key: key ?? rankKeys(slots)[0]?.key ?? null, flats: false, slots };
};

/** the style a judge thinks a song is: the likeliest, per chord */
function judge(song: Song, chords: readonly string[]): string {
    const home = homeOf(song.key ?? 'C');
    let best = '';
    let top = -Infinity;
    for (const [id, m] of judges) {
        let sum = 0;
        let prev: string | null = null;
        song.slots.forEach((s, i) => {
            const token = tokenOf(chords[i] ?? s.chord, home);
            if (!token) return;
            sum += m.move(s.starts ? null : prev, token);
            prev = token;
        });
        if (sum > top) {
            top = sum;
            best = id;
        }
    }
    return best;
}

// the same songs for every style and every run: the first few held out of each
const songs = styles.flatMap((s) =>
    (heldout.songs[s.id] ?? [])
        .slice(0, PER_STYLE)
        .map((x) => ({ song: songOf(x), style: s.id })),
);

/** what's sung over each chord of a take, for the melody score */
function takeSongs(): { song: Song; melody: Map<string, number[]> }[] {
    if (!existsSync('takes')) return [];
    const out: { song: Song; melody: Map<string, number[]> }[] = [];
    for (const name of readdirSync('takes')) {
        if (!name.endsWith('.json')) continue;
        const data = JSON.parse(readFileSync(`takes/${name}`, 'utf8')) as
            Take | Take[];
        for (const take of Array.isArray(data) ? data : [data]) {
            const chords = take.chords?.trim().split(/\s+/) ?? [];
            if (!chords.length || !take.taps.length) continue;
            const frames = take.audio
                ? track(decode(take.audio.pcm), take.audio.rate, take.audio.at)
                : take.frames;
            const end = take.stop ?? frames[frames.length - 1]?.t ?? 0;
            const bounds = [...take.taps, end];
            const heard = score(
                notes(frames, tuning(frames), keyOf(take.key)),
                bounds,
            );
            const song = songOf([chords.slice(0, heard.length)], take.key);
            const melody = new Map(
                song.slots.map((s, i) => [s.id, heard[i]?.profile ?? []]),
            );
            out.push({ song, melody });
        }
    }
    return out;
}
const sung = takeSongs();

const mean = (xs: number[]): number =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

interface Row {
    style: string;
    knows: number;
    hitBefore: number;
    hitAfter: number;
    faithful: number;
    distinct: number;
    changed: number;
    melodyBefore: number;
    melodyAfter: number;
}

const rows: Row[] = styles.map((s) => {
    const model = models.get(s.id)! as Model;
    const before: number[] = [];
    const after: number[] = [];
    const knows: number[] = [];
    const faithful: number[] = [];
    const distinct: number[] = [];
    const changed: number[] = [];
    for (const { song, style } of songs) {
        const original = song.slots.map((x) => x.chord);
        const r = restyle(song, s.id, model, {
            weights: WEIGHTS,
            strength: STRENGTH,
        });
        const named = judge(song, original);
        if (style === s.id) knows.push(Number(named === s.id));
        before.push(Number(named === s.id));
        after.push(Number(judge(song, r.chords) === s.id));
        faithful.push(r.features.faithful);
        distinct.push(r.features.distinct);
        changed.push(r.changes.length / Math.max(1, original.length));
    }
    const melodyBefore: number[] = [];
    const melodyAfter: number[] = [];
    for (const { song, melody } of sung) {
        const original = song.slots.map((x) => x.chord);
        const r = restyle(song, s.id, model, {
            weights: WEIGHTS,
            strength: STRENGTH,
            melody,
        });
        melodyBefore.push(features(song, original, s.id, model, melody).melody);
        melodyAfter.push(r.features.melody);
    }
    return {
        style: s.id,
        knows: mean(knows),
        hitBefore: mean(before),
        hitAfter: mean(after),
        faithful: mean(faithful),
        distinct: mean(distinct),
        changed: mean(changed),
        melodyBefore: mean(melodyBefore),
        melodyAfter: mean(melodyAfter),
    };
});

const pct = (x: number): string =>
    Number.isNaN(x) ? '  —' : `${Math.round(x * 100)}%`.padStart(4);
const num = (x: number): string =>
    Number.isNaN(x) ? '   —' : x.toFixed(2).padStart(5);

mkdirSync('data/results', { recursive: true });
const earlier = readdirSync('data/results')
    .filter((f) => f.endsWith('.json'))
    .sort();
const last = earlier.length
    ? (JSON.parse(
          readFileSync(`data/results/${earlier[earlier.length - 1]}`, 'utf8'),
      ) as {
          rows: Row[];
      })
    : null;
const was = (style: string, key: keyof Row): number | null => {
    const v = last?.rows.find((r) => r.style === style)?.[key];
    return typeof v === 'number' && !Number.isNaN(v) ? v : null;
};
const delta = (now: number, before: number | null): string =>
    before === null || Number.isNaN(now)
        ? ''
        : ` (${now - before >= 0 ? '+' : ''}${(now - before).toFixed(2)})`;

console.log(
    `${songs.length} songs, ${sung.length} sung takes, strength ${STRENGTH}, weights ${JSON.stringify(WEIGHTS)}\n`,
);
console.log(
    'style    judge knows  reads as style   faithful  distinct  changed  melody fit',
);
for (const r of rows)
    console.log(
        `${r.style.padEnd(9)} ${pct(r.knows)}       ${pct(r.hitBefore)} → ${pct(r.hitAfter)}${delta(r.hitAfter, was(r.style, 'hitAfter')).padEnd(8)}` +
            ` ${num(r.faithful)}${delta(r.faithful, was(r.style, 'faithful')).padEnd(8)}` +
            ` ${num(r.distinct)}${delta(r.distinct, was(r.style, 'distinct')).padEnd(8)}` +
            ` ${pct(r.changed)}` +
            `   ${num(r.melodyBefore)} → ${num(r.melodyAfter)}${delta(r.melodyAfter, was(r.style, 'melodyAfter'))}`,
    );

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(
    `data/results/${stamp}.json`,
    JSON.stringify(
        { at: stamp, strength: STRENGTH, weights: WEIGHTS, rows },
        null,
        1,
    ),
);
console.log(`\nSaved data/results/${stamp}.json`);
