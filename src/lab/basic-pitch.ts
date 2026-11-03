// Basic Pitch on a take: Spotify's note model (Apache-2.0), cut down to the one voice singing.
// Loaded only when asked: TensorFlow.js is big and the app never needs it

import modelUrl from '@spotify/basic-pitch/model/model.json?url';
import type { Note } from '../listen/summary.ts';

// a voice, low bass to soprano: anything outside is an overtone or noise
const MIN_HZ = 50;
const MAX_HZ = 1000;
// the model's own defaults for sung lines, a little more willing to start notes
const ONSET = 0.25;
const FRAME = 0.25;
const MIN_FRAMES = 5;

interface Event {
    start: number;
    end: number;
    midi: number;
    amplitude: number;
}

/**
 * the model hears overtones as notes of their own: keep the loudest at any
 * moment, and drop whatever mostly overlaps it
 */
function oneVoice(events: Event[]): Event[] {
    const kept: Event[] = [];
    for (const e of [...events].sort((a, b) => b.amplitude - a.amplitude)) {
        const length = e.end - e.start;
        const hidden = kept.some(
            (k) =>
                Math.min(k.end, e.end) - Math.max(k.start, e.start) >
                length / 2,
        );
        if (!hidden) kept.push(e);
    }
    return kept.sort((a, b) => a.start - b.start);
}

/** pcm at 22.05 kHz; at is when it starts, on the taps' clock */
export async function transcribe(
    pcm: Float32Array,
    at: number,
    progress: (done: number) => void,
): Promise<Note[]> {
    const bp = await import('@spotify/basic-pitch');
    const model = new bp.BasicPitch(modelUrl);
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];
    await model.evaluateModel(
        pcm,
        (f, o, c) => {
            frames.push(...f);
            onsets.push(...o);
            contours.push(...c);
        },
        progress,
    );
    const events = bp.noteFramesToTime(
        bp.addPitchBendsToNoteEvents(
            contours,
            bp.outputToNotesPoly(
                frames,
                onsets,
                ONSET,
                FRAME,
                MIN_FRAMES,
                true,
                MAX_HZ,
                MIN_HZ,
            ),
        ),
    );
    return oneVoice(
        events.map((e) => ({
            start: e.startTimeSeconds,
            end: e.startTimeSeconds + e.durationSeconds,
            midi: e.pitchMidi,
            amplitude: e.amplitude,
        })),
    ).map((e) => ({
        pc: ((Math.round(e.midi) % 12) + 12) % 12,
        start: at + e.start,
        end: at + e.end,
    }));
}
