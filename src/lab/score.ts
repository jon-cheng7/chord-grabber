// Scorecard: each detector's key melody note per chord against the answer you gave.
// Right and unsure are fine; wrong is the number that matters, it's what would mislead reharm

import {
    notes,
    score,
    tuning,
    type Frame,
    type Heard,
    type Key,
} from '../listen/summary.ts';
import { track } from '../listen/track.ts';
import { parseChord } from '../music/chord.ts';
import { chordNotes, minor, pitch } from '../music/theory.ts';
import { decode, resample, type Take } from './takes.ts';

// what the detector was built for: the same rate it runs at live
const LIVE_RATE = 16000;

export type Mark = 'right' | 'wrong' | 'unsure' | 'skip';

export interface Verdict {
    /** its pick, or for an unsure chord its front-runner */
    lead: number | null;
    mark: Mark;
    /** was the expected note among the notes it heard at all */
    heard: boolean;
}

export interface Row {
    chord: string;
    expect: number | null;
    ours: Verdict;
    bp: Verdict | null;
}

export interface Tally {
    right: number;
    wrong: number;
    unsure: number;
    heard: number;
    /** chords with an answer */
    total: number;
}

export interface Card {
    rows: Row[];
    ours: Tally;
    bp: Tally | null;
    /** where our notes came from: re-run on the audio, or the live frames */
    source: 'audio' | 'live';
}

const words = (text: string | undefined): string[] =>
    (text ?? '').trim().split(/\s+/).filter(Boolean);

export const keyOf = (name: string | undefined): Key | null => {
    const c = name ? parseChord(name) : null;
    return c ? { tonic: pitch(c.root), minor: minor(c.quality) } : null;
};

/** - or ? (or nothing) where you don't know */
const noteOf = (word: string | undefined): number | null => {
    const c = word ? parseChord(word) : null;
    return c ? pitch(c.root) : null;
};

function verdict(h: Heard | undefined, expect: number | null): Verdict {
    const lead = h ? (h.key ?? h.notes[0] ?? null) : null;
    const heard = expect !== null && !!h?.notes.includes(expect);
    if (expect === null) return { lead, mark: 'skip', heard };
    if (!h?.sure) return { lead, mark: 'unsure', heard };
    return { lead, mark: h.key === expect ? 'right' : 'wrong', heard };
}

function tally(rows: Row[], pick: (r: Row) => Verdict | null): Tally {
    const t = { right: 0, wrong: 0, unsure: 0, heard: 0, total: 0 };
    for (const r of rows) {
        const v = pick(r);
        if (!v || v.mark === 'skip') continue;
        t.total++;
        t[v.mark]++;
        if (v.heard) t.heard++;
    }
    return t;
}

// re-running the detector on audio is the slow part: once per take per visit
const rerun = new Map<string, Frame[]>();

/** our frames: from the audio with today's detector if there is audio, else as heard live */
export async function framesOf(
    take: Take,
): Promise<{ frames: Frame[]; source: 'audio' | 'live' }> {
    if (!take.audio) return { frames: take.frames, source: 'live' };
    let frames = rerun.get(take.at);
    if (!frames) {
        const pcm = await resample(
            [decode(take.audio.pcm)],
            take.audio.rate,
            LIVE_RATE,
        );
        frames = track(pcm, LIVE_RATE, take.audio.at);
        rerun.set(take.at, frames);
    }
    return { frames, source: 'audio' };
}

/**
 * the taps, closed by STOP so the last chord counts; takes from before STOP
 * was kept end at the last thing heard
 */
function boundsOf(take: Take, frames: readonly Frame[]): number[] {
    const last = take.taps[take.taps.length - 1];
    const end = take.stop ?? frames[frames.length - 1]?.t;
    return last !== undefined && end !== undefined && end > last
        ? [...take.taps, end]
        : take.taps;
}

export async function cardOf(take: Take, useChords: boolean): Promise<Card> {
    const { frames, source } = await framesOf(take);
    const key = keyOf(take.key);
    const chords = words(take.chords);
    const expect = words(take.expect).map(noteOf);
    const tones = useChords
        ? chords.map((c) => (parseChord(c) ? chordNotes(c).tones : null))
        : [];
    const bounds = boundsOf(take, frames);
    const ours = score(notes(frames, tuning(frames), key), bounds, tones);
    const bp: Heard[] | null = take.bp ? score(take.bp, bounds, tones) : null;
    const rows = ours.map((h, i) => ({
        chord: chords[i] ?? '',
        expect: expect[i] ?? null,
        ours: verdict(h, expect[i] ?? null),
        bp: bp ? verdict(bp[i], expect[i] ?? null) : null,
    }));
    return {
        rows,
        ours: tally(rows, (r) => r.ours),
        bp: bp ? tally(rows, (r) => r.bp) : null,
        source,
    };
}

export function add(a: Tally, b: Tally): Tally {
    return {
        right: a.right + b.right,
        wrong: a.wrong + b.wrong,
        unsure: a.unsure + b.unsure,
        heard: a.heard + b.heard,
        total: a.total + b.total,
    };
}

export const EMPTY: Tally = {
    right: 0,
    wrong: 0,
    unsure: 0,
    heard: 0,
    total: 0,
};
