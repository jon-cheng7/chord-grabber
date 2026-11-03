// Pitch of one frame of a single voice: YIN (de Cheveigné & Kawahara, 2002)

export interface Pitch {
    hz: number;
    /** 0–1: how cleanly periodic the frame is; singing sits well above 0.8 */
    clarity: number;
}

// a sung or hummed voice, low bass (G1) to high soprano; any lower and a
// 64 ms frame holds too few periods to trust
export const MIN_HZ = 50;
export const MAX_HZ = 1000;
// quieter than this is breath or room, not a note
const SILENCE_RMS = 0.01;
// the dip a period has to reach to count; lower is stricter
const THRESHOLD = 0.15;

/** null for silence or anything without a clear period */
export function yin(
    frame: Float32Array,
    rate: number,
    scratch: Float32Array = new Float32Array(frame.length >> 1),
): Pitch | null {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i]! * frame[i]!;
    if (Math.sqrt(energy / frame.length) < SILENCE_RMS) return null;

    const half = frame.length >> 1;
    const lo = Math.max(2, Math.floor(rate / MAX_HZ));
    const hi = Math.min(half - 1, Math.ceil(rate / MIN_HZ));
    const d = scratch;

    // how unlike itself the frame is, shifted by tau
    for (let tau = 1; tau <= hi; tau++) {
        let sum = 0;
        for (let i = 0; i < half; i++) {
            const delta = frame[i]! - frame[i + tau]!;
            sum += delta * delta;
        }
        d[tau] = sum;
    }
    // normalised by the running mean, so short shifts don't win by default
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= hi; tau++) {
        running += d[tau]!;
        d[tau] = running ? (d[tau]! * tau) / running : 1;
    }

    // the first dip under the threshold, followed to the bottom of its valley
    let tau = -1;
    for (let t = lo; t <= hi; t++) {
        if (d[t]! < THRESHOLD) {
            while (t + 1 <= hi && d[t + 1]! < d[t]!) t++;
            tau = t;
            break;
        }
    }
    if (tau < 0) return null;

    // between samples: fit a parabola through the dip and its neighbours
    const a = d[tau - 1] ?? d[tau]!;
    const b = d[tau]!;
    const c = d[tau + 1] ?? d[tau]!;
    const bend = a - 2 * b + c;
    const exact = bend ? tau + (a - c) / (2 * bend) : tau;
    return { hz: rate / exact, clarity: Math.max(0, Math.min(1, 1 - b)) };
}
