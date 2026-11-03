// A take's report: everything behind each pick, small enough to read through.
// No audio: EXPORT ALL keeps that, for re-running the detectors

import { smooth } from '../listen/smooth.ts';
import type { Heard } from '../listen/summary.ts';
import { noteName } from '../music/theory.ts';
import type { Card, Verdict } from './score.ts';
import type { Take } from './takes.ts';

// frames this long before the first tap: the pickup into the first chord
const LEAD = 0.5;

const r2 = (x: number): number => Math.round(x * 100) / 100;
const pc = (n: number | null): string | null =>
    n === null ? null : noteName(n, false);
const midi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

function detector(h: Heard | undefined, v: Verdict | null, t0: number) {
    if (!h || !v) return null;
    return {
        pick: pc(v.lead),
        mark: v.mark,
        sure: h.sure,
        voiced: r2(h.voiced),
        // note, start, end, off (semitones), what it was heard as if the chord moved it
        sung: h.sung.map((n) => [
            pc(n.pc),
            r2(n.start - t0),
            r2(n.end - t0),
            n.off === undefined ? null : r2(n.off),
            ...(n.from === undefined ? [] : [pc(n.from)]),
        ]),
        ranked: h.ranked.map((c) => ({
            note: pc(c.pc),
            score: r2(c.score),
            longest: r2(c.longest),
            held: r2(c.held),
            count: c.count,
            first: r2(c.first),
            beat: r2(c.beat),
            tone: c.tone,
        })),
    };
}

export function reportOf(take: Take, card: Card, useChords: boolean) {
    const t0 = card.bounds[0] ?? 0;
    const end = card.bounds[card.bounds.length - 1] ?? t0;
    const line = smooth(card.frames);
    return {
        report: 'melody-lab',
        version: 3,
        take: take.at,
        song: take.song ?? null,
        key: take.key ?? null,
        device: take.device,
        source: card.source,
        useChords,
        bp: !!take.bp,
        tuningCents: Math.round(card.cents),
        ours: card.ours,
        basicPitch: card.bp,
        // seconds from the first tap from here on
        chords: card.rows.map((row, i) => ({
            n: i + 1,
            chord: row.chord || null,
            tones: card.tones[i]?.map((t) => pc(t)) ?? null,
            expect: pc(row.expect),
            span: [r2(card.bounds[i]! - t0), r2(card.bounds[i + 1]! - t0)],
            ours: detector(card.heard.ours[i], row.ours, t0),
            basicPitch: detector(card.heard.bp?.[i], row.bp, t0),
        })),
        // line: the settled pitch; cands: midi, probability, midi, probability…
        frames: {
            fields: ['t', 'midi', 'clarity', 'level', 'line', 'cands'],
            rows: card.frames.flatMap((f, i) =>
                f.t >= t0 - LEAD && f.t <= end
                    ? [
                          [
                              r2(f.t - t0),
                              f.hz > 0 ? r2(midi(f.hz)) : null,
                              r2(f.clarity),
                              f.level === undefined
                                  ? null
                                  : Math.round(f.level * 1e4) / 1e4,
                              line[i]!.hz > 0 ? r2(midi(line[i]!.hz)) : null,
                              (f.cands ?? []).map((x, k) =>
                                  k % 2 ? r2(x) : r2(midi(x)),
                              ),
                          ],
                      ]
                    : [],
            ),
        },
    };
}

// a list of plain values, or of lists already on one line
const PLAIN = /\[(?:[^[\]{}]|\[[^[\]{}\s]*\])*\]/g;
const oneLine = (text: string): string =>
    text.replace(PLAIN, (list) => list.replace(/\s+/g, ''));

/** indented, but each list of plain values kept to one line: a frame per line */
export const pretty = (data: unknown): string =>
    oneLine(oneLine(JSON.stringify(data, null, 1)));
