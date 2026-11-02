// Melody per chord: the notes sung over each span, and its key melody note (KMN), the one
// the chord has to suit. Note names only: octaves don't matter

export interface Frame {
    /** seconds, on the same clock as the taps */
    t: number;
    hz: number;
    clarity: number;
    /** loudness of the newest moment; missing from early takes */
    level?: number;
}

/** the song's key, so an off-pitch note can be read as the scale note it meant */
export interface Key {
    /** pitch class of home, 0 is C */
    tonic: number;
    minor: boolean;
}

/** one sung note: frames held on one pitch */
export interface Note {
    /** pitch class, 0 is C */
    pc: number;
    start: number;
    end: number;
}

export interface Heard {
    /** the key melody note, or null when it isn't clear which */
    key: number | null;
    /** every pitch class sung, best KMN candidate first */
    notes: number[];
    /** seconds clearly sung */
    voiced: number;
    /** the span's length in seconds */
    length: number;
    /** a clear winner over enough singing; otherwise the chord's melody is unknown */
    sure: boolean;
}

// a frame this periodic is a sung note, not breath or noise
const CLEAR = 0.8;
// a jump bigger than this (semitones) is a new note
const NEW_NOTE = 0.8;
// an unclear frame or two inside a held note doesn't end it
const GAP = 2;
// the same pitch sung again: loudness falls under half and climbs back
const DIP = 0.5;
const RISE = 1.8;
const BACK = 0.6;
// the voice scoops into a note: its pitch is read after this
const SCOOP = 0.06;
// shorter than this is a slip or an ornament, not a note
const MIN_NOTE = 0.06;
// off a scale note by this much (semitones), toward it: read as that note
const SNAP = 0.2;
// a note pushed this early, carrying over the change, belongs to the next chord
const PUSH = 0.15;
// sung within this of the change: on the beat
const DOWNBEAT = 0.25;
// voiced seconds needed before the singer's own tuning is trusted
const LONG_TAKE = 4;
// sure: this much clear singing, and the winner this far ahead
const MIN_VOICED = 0.3;
const MARGIN = 0.15;

// what makes a key melody note, out of 1. Where the phrase lands counts most:
// quick, wordy melodies hold their last note longest, but it isn't the one
const SCORE = {
    longest: 0.25,
    held: 0.2,
    repeats: 0.1,
    first: 0.15,
    downbeat: 0.3,
};
// a note of the chord being played is a little likelier to be the one that matters
const CHORD_TONE = 0.1;

// the key's own notes; minor keeps its raised seventh, the V chord's
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11];

const scaleOf = (key: Key): Set<number> =>
    new Set(
        (key.minor ? MINOR_SCALE : MAJOR_SCALE).map(
            (s) => (key.tonic + s) % 12,
        ),
    );

const midi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const pcOf = (m: number): number => ((Math.round(m) % 12) + 12) % 12;
const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? NaN;

/** seconds between frames: the median gap */
function hopOf(frames: readonly Frame[]): number {
    const gaps = frames
        .slice(1)
        .map((f, i) => f.t - frames[i]!.t)
        .filter((g) => g > 0);
    return median(gaps) || 0.032;
}

/**
 * how far the singer sits from A440, in cents; 0 unless the take is long enough
 * to tell. A circular mean, so 45 cents sharp and 55 flat don't cancel out
 */
export function tuning(frames: readonly Frame[]): number {
    const clear = frames.filter((f) => f.clarity >= CLEAR && f.hz > 0);
    if (clear.length * hopOf(frames) < LONG_TAKE) return 0;
    let x = 0;
    let y = 0;
    for (const f of clear) {
        const off = midi(f.hz) - Math.round(midi(f.hz));
        x += Math.cos(off * 2 * Math.PI);
        y += Math.sin(off * 2 * Math.PI);
    }
    return (Math.atan2(y, x) / (2 * Math.PI)) * 100;
}

/** a note between two pitches, leaning toward one in the key: that one */
function snap(m: number, scale: Set<number> | null): number {
    const near = Math.round(m);
    const lean = m - near;
    if (!scale || scale.has(pcOf(near)) || Math.abs(lean) < SNAP) return near;
    const other = near + Math.sign(lean);
    return scale.has(pcOf(other)) ? other : near;
}

/**
 * frames grouped into sung notes: a new note on a change of pitch, or the same
 * pitch sung again. Slips, breaths and scoops left out
 */
export function notes(
    frames: readonly Frame[],
    cents = 0,
    key: Key | null = null,
): Note[] {
    const hop = hopOf(frames);
    const scale = key ? scaleOf(key) : null;
    const out: Note[] = [];
    let run: { t: number; m: number }[] = [];
    let missed = 0;
    let peak = 0;
    let dip = Infinity;
    const close = (): void => {
        const start = run[0]?.t;
        const end = run[run.length - 1]?.t;
        if (start !== undefined && end !== undefined) {
            const settled = run.filter((r) => r.t - start >= SCOOP);
            const m = median((settled.length ? settled : run).map((r) => r.m));
            if (end + hop - start >= MIN_NOTE)
                out.push({ pc: pcOf(snap(m, scale)), start, end: end + hop });
        }
        run = [];
        missed = 0;
        peak = 0;
        dip = Infinity;
    };
    for (const f of frames) {
        const level = f.level;
        if (f.clarity < CLEAR || f.hz <= 0) {
            if (!run.length) continue;
            if (level !== undefined) dip = Math.min(dip, level);
            if (++missed > GAP) close();
            continue;
        }
        const m = midi(f.hz) - cents / 100;
        const held = median(run.slice(-5).map((r) => r.m));
        const again =
            level !== undefined &&
            dip < peak * DIP &&
            level > dip * RISE &&
            level >= peak * BACK;
        if (run.length && (again || !(Math.abs(m - held) <= NEW_NOTE))) close();
        missed = 0;
        run.push({ t: f.t, m });
        if (level === undefined) continue;
        if (level > peak) peak = dip = level;
        else dip = Math.min(dip, level);
    }
    close();
    return out;
}

/**
 * bounds are the tap times: span i runs from bounds[i] to bounds[i + 1].
 * The last chord needs an end too: when recording stopped
 */
export function summarize(
    frames: readonly Frame[],
    bounds: readonly number[],
    key: Key | null = null,
    cents = tuning(frames),
): Heard[] {
    return score(notes(frames, cents, key), bounds);
}

/**
 * the key melody note of each span, from notes found any way (ours or a model's).
 * tones: each span's chord notes, when the chords are known
 */
export function score(
    all: readonly Note[],
    bounds: readonly number[],
    tones: readonly (readonly number[] | null)[] = [],
): Heard[] {
    return bounds.slice(1).map((end, i) => {
        const start = bounds[i]!;
        // a note belongs to the chord it starts in, unless it's pushed into the next
        const pushed = (n: Note, at: number): boolean =>
            n.start >= at - PUSH && n.start < at && n.end > at;
        const mine = all.filter(
            (n) =>
                ((n.start >= start && n.start < end) || pushed(n, start)) &&
                !pushed(n, end),
        );
        const length = end - start;
        // held up to the next change; a pushed note counts from when it starts
        const heldFor = (n: Note): number => Math.min(n.end, end) - n.start;
        const voiced = mine.reduce((s, n) => s + heldFor(n), 0);

        const by = new Map<
            number,
            {
                held: number;
                longest: number;
                count: number;
                first: boolean;
                beat: boolean;
            }
        >();
        mine.forEach((n, k) => {
            const len = heldFor(n);
            const c = by.get(n.pc) ?? {
                held: 0,
                longest: 0,
                count: 0,
                first: false,
                beat: false,
            };
            c.held += len;
            c.longest = Math.max(c.longest, len);
            c.count++;
            if (k === 0) c.first = true;
            if (n.start - start <= DOWNBEAT) c.beat = true;
            by.set(n.pc, c);
        });
        const top = (
            pick: (c: {
                held: number;
                longest: number;
                count: number;
            }) => number,
        ): number => Math.max(1e-9, ...[...by.values()].map(pick));
        const most = {
            held: top((c) => c.held),
            longest: top((c) => c.longest),
            count: top((c) => c.count),
        };
        const ranked = [...by.entries()]
            .map(([pc, c]) => ({
                pc,
                score:
                    SCORE.longest * (c.longest / most.longest) +
                    SCORE.held * (c.held / most.held) +
                    SCORE.repeats * (c.count / most.count) +
                    SCORE.first * Number(c.first) +
                    SCORE.downbeat * Number(c.beat) +
                    CHORD_TONE * Number(!!tones[i]?.includes(pc)),
            }))
            .sort((a, b) => b.score - a.score);
        const [best, runner] = ranked;
        const sure =
            !!best &&
            voiced >= MIN_VOICED &&
            (!runner || best.score - runner.score >= MARGIN);
        return {
            key: sure ? best!.pc : null,
            notes: ranked.map((r) => r.pc),
            voiced,
            length,
            sure,
        };
    });
}
