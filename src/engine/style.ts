// Reharm a whole song in a style: per chord, the candidates; across the song, the
// likeliest path (Viterbi). Each path is scored on four things, weighed by Weights:
//   style     how natural each move is in the style (its table: chord → next chord)
//   distinct  how much likelier each move is in this style than in all of them. Without
//             it the likeliest path is I–IV–V in every style: common to all, so it
//             reads as none
//   melody    how well each chord suits what's sung over it, where that's known
//   faithful  how much of the original each chord keeps
// The weights are what training fits; see scripts/tune.ts

import { chordNotes } from '../music/theory.ts';
import { analyze } from './analysis.ts';
import { melodyFit } from './fit.ts';
import { chordOf, homeOf, STYLES, tokenOf, type StyleTable } from './styles.ts';
import { suggestFor } from './suggest.ts';
import type { Change, Song } from './types.ts';

export interface Weights {
    style: number;
    distinct: number;
    melody: number;
    faithful: number;
}

/** what a reharm scored, each an average per chord */
export type Features = Weights;

export interface Restyled {
    /** a chord per slot, in the song's order */
    chords: string[];
    /** and as it was */
    original: string[];
    changes: Change[];
    features: Features;
}

export interface RestyleOptions {
    weights: Weights;
    /** 0 keeps close to the original, 1 lets the style lead */
    strength: number;
    /** what's sung over each slot, by slot id: pitch-class shares */
    melody?: ReadonlyMap<string, readonly number[]>;
}

// tried at every spot: the style's most played chords, and those most its own
const COMMON_CHORDS = 20;
const OWN_CHORDS = 20;
// a chord is only the style's own once seen this often, not a fluke of a few songs
const OWN_MIN = 50;
// and kept only if they share this many notes with the original
const COMMON = 2;
// smoothing: a move never seen still gets a little chance
const ALPHA = 0.5;
// how many sightings of a chord before its own next moves are trusted over the overall mix
const TRUST = 5;
// tokens a table could hold: 12 steps, about 22 shapes
const SPACE = 12 * 22;

/** every style's counts together: what's common to all */
export function poolOf(tables: readonly StyleTable[]): StyleTable {
    const pool: StyleTable = { songs: 0, uni: {}, bi: {} };
    for (const t of tables) {
        pool.songs += t.songs;
        for (const [k, n] of Object.entries(t.uni))
            pool.uni[k] = (pool.uni[k] ?? 0) + n;
        for (const [k, n] of Object.entries(t.bi))
            pool.bi[k] = (pool.bi[k] ?? 0) + n;
    }
    return pool;
}

/** a table as log chances: of a chord on its own, of b after a */
function chances(table: StyleTable) {
    const total = Object.values(table.uni).reduce((a, b) => a + b, 0);
    const out = new Map<string, number>();
    for (const [pair, n] of Object.entries(table.bi)) {
        const from = pair.slice(0, pair.indexOf('>'));
        out.set(from, (out.get(from) ?? 0) + n);
    }
    const one = (t: string): number =>
        ((table.uni[t] ?? 0) + ALPHA) / (total + ALPHA * SPACE);
    /** log chance of b after a; no a: of b on its own */
    const move = (a: string | null, b: string): number => {
        if (a === null) return Math.log(one(b));
        const seen = out.get(a) ?? 0;
        const trust = seen / (seen + TRUST);
        const own = seen ? (table.bi[`${a}>${b}`] ?? 0) / seen : 0;
        return Math.log(trust * own + (1 - trust) * one(b));
    };
    return { move, one: (t: string): number => Math.log(one(t)) };
}

/** a style's table as probabilities; pool: every style's together, for what's distinctive */
export function modelOf(table: StyleTable, pool?: StyleTable) {
    const own = chances(table);
    const all = pool ? chances(pool) : null;
    /** how much likelier b after a is here than anywhere: what makes it this style */
    const lift = (a: string | null, b: string): number =>
        all ? own.move(a, b) - all.move(a, b) : 0;
    const counts = Object.entries(table.uni);
    const common = [...counts]
        .sort((x, y) => y[1] - x[1])
        .slice(0, COMMON_CHORDS)
        .map(([t]) => t);
    const distinct = all
        ? counts
              .filter(([, n]) => n >= OWN_MIN)
              .map(([t]) => [t, own.one(t) - all.one(t)] as const)
              .sort((x, y) => y[1] - x[1])
              .slice(0, OWN_CHORDS)
              .map(([t]) => t)
        : [];
    return {
        move: own.move,
        lift,
        top: [...new Set([...common, ...distinct])],
    };
}

export type Model = ReturnType<typeof modelOf>;

/** how much of the original a chord keeps: shared notes, and the same bass */
function kept(original: string, chord: string): number {
    if (chord === original) return 1;
    const a = chordNotes(original);
    const b = chordNotes(chord);
    const shared = b.tones.filter((t) => a.tones.includes(t)).length;
    return (
        (0.8 * shared) / Math.max(a.tones.length, b.tones.length, 1) +
        (a.bass === b.bass ? 0.2 : 0)
    );
}

/** the three scores of one reharm, against the original; range: just those slots */
export function features(
    song: Song,
    chords: readonly string[],
    style: string,
    model: Model,
    melody?: ReadonlyMap<string, readonly number[]>,
    range: readonly [number, number] = [0, Infinity],
): Features {
    const a = analyze(song);
    const tension = STYLES.find((s) => s.id === style)?.tension ?? 0.5;
    let fit = 0;
    let sung = 0;
    let move = 0;
    let lift = 0;
    let keep = 0;
    let prev: string | null = null;
    let n = 0;
    a.readings.forEach((r, i) => {
        const chord = chords[i] ?? r.chord;
        const token = tokenOf(chord, homeOf(r.key));
        const inside = i >= range[0] && i < range[1];
        // the move into the passage counts; what comes before only leads into it
        if (token && inside) {
            move += model.move(prev, token);
            lift += model.lift(prev, token);
        }
        prev = token;
        if (!inside) return;
        n++;
        keep += kept(r.chord, chord);
        const p = melody?.get(r.id);
        if (p) {
            fit += melodyFit(chord, p, tension);
            sung++;
        }
    });
    n = Math.max(1, n);
    return {
        style: move / n,
        distinct: lift / n,
        melody: sung ? fit / sung : 0,
        faithful: keep / n,
    };
}

/** the whole song reharmed in a style */
export function restyle(
    song: Song,
    style: string,
    model: Model,
    o: RestyleOptions,
): Restyled {
    const a = analyze(song);
    const tension = STYLES.find((s) => s.id === style)?.tension ?? 0.5;
    const w = o.weights;
    // strength 0.5 is the weights as trained
    const hold = w.faithful * (1 - o.strength) * 2;

    // per slot: the chords worth trying, each with its token and its own score
    const options = a.readings.map((r) => {
        const home = homeOf(r.key);
        const tones = chordNotes(r.chord).tones;
        const tries = new Set([r.chord]);
        if (!r.locked) {
            for (const g of suggestFor(r.chord, r.key, song.flats))
                for (const x of g.options) tries.add(x.chord);
            for (const t of model.top) {
                const chord = chordOf(t, home, song.flats);
                const shared = chordNotes(chord).tones.filter((x) =>
                    tones.includes(x),
                ).length;
                if (shared >= COMMON) tries.add(chord);
            }
        }
        const p = o.melody?.get(r.id);
        return [...tries].flatMap((chord) => {
            const token = tokenOf(chord, home);
            if (!token) return [];
            const own =
                hold * kept(r.chord, chord) +
                (p ? w.melody * melodyFit(chord, p, tension) : 0);
            return [{ chord, token, own }];
        });
    });

    // Viterbi: best score to reach each option, and where it came from
    let best: number[] = [];
    const back: number[][] = [];
    options.forEach((here, i) => {
        const prev = options[i - 1];
        const next: number[] = [];
        const from: number[] = [];
        for (const c of here) {
            let top = -Infinity;
            let arg = -1;
            const step = (from: string | null): number =>
                w.style * model.move(from, c.token) +
                w.distinct * model.lift(from, c.token);
            if (!prev?.length) top = step(null);
            else
                prev.forEach((p, j) => {
                    const s = best[j]! + step(p.token);
                    if (s > top) {
                        top = s;
                        arg = j;
                    }
                });
            next.push(top + c.own);
            from.push(arg);
        }
        best = next;
        back.push(from);
    });

    const chords = new Array<string>(options.length);
    let at = best.indexOf(Math.max(...best));
    for (let i = options.length - 1; i >= 0; i--) {
        chords[i] = options[i]![at]?.chord ?? a.readings[i]!.chord;
        at = back[i]![at] ?? 0;
    }
    const changes = a.readings.flatMap((r, i) =>
        chords[i] !== r.chord ? [{ id: r.id, chord: chords[i]! }] : [],
    );
    return {
        chords,
        original: a.readings.map((r) => r.chord),
        changes,
        features: features(song, chords, style, model, o.melody),
    };
}
