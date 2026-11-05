// Chord sound: a handful of small synths, voice-led from chord to chord

import { chordNotes } from './music/theory.ts';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
// straight to the speakers, no room: previews stay clear chord to chord
let plain: AudioNode | null = null;
let clear = false;
const dest = (): AudioNode => (clear ? plain : out)!;
let wet: GainNode | null = null;

/** decaying noise as a room: cheap reverb without a file */
function hall(c: AudioContext): ConvolverNode {
    const length = Math.floor(c.sampleRate * 1.8);
    const buffer = c.createBuffer(2, length, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++)
            data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    const verb = c.createConvolver();
    verb.buffer = buffer;
    return verb;
}

function audio(): AudioContext {
    if (ctx && out) return ctx;
    const c = new AudioContext();
    const master = c.createDynamicsCompressor();
    master.threshold.value = -18;
    master.ratio.value = 3;
    master.connect(c.destination);
    const verb = hall(c);
    const send = c.createGain();
    send.gain.value = SOUNDS[current].room;
    verb.connect(send).connect(master);
    const dry = c.createGain();
    dry.connect(master);
    dry.connect(verb);
    const bare = c.createGain();
    bare.connect(master);
    plain = bare;
    ctx = c;
    out = dry;
    wet = send;
    return c;
}

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

interface Voice {
    stop(at: number): void;
}

/** let a note go: hold where it is, then fade; Firefox can only cancel */
function fade(gain: GainNode, when: number, time: number): void {
    if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(when);
    else gain.gain.cancelScheduledValues(when);
    gain.gain.setTargetAtTime(0, when, time);
}

/** start them now; they stop at the end of life, or a tail after a let-go */
function run(
    oscs: OscillatorNode[],
    at: number,
    life: number,
): (when: number, tail: number) => void {
    for (const o of oscs) {
        o.start(at);
        o.stop(at + life);
    }
    return (when, tail) => {
        for (const o of oscs) o.stop(Math.min(at + life, when + tail));
    };
}

function osc(
    c: AudioContext,
    type: OscillatorType,
    f: number,
    detune = 0,
): OscillatorNode {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    return o;
}

/** carrier + slow modulator for body, fast modulator for the tine ping */
function ePiano(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const carrier = c.createOscillator();
    carrier.frequency.value = f;

    const body = c.createOscillator();
    body.frequency.value = f;
    const bodyDepth = c.createGain();
    // bright attack mellowing out, less so up high
    const depth = f * (midi > 72 ? 1.2 : 2.2);
    bodyDepth.gain.setValueAtTime(depth, at);
    bodyDepth.gain.exponentialRampToValueAtTime(depth * 0.12, at + 1.2);
    body.connect(bodyDepth).connect(carrier.frequency);

    const tine = c.createOscillator();
    tine.frequency.value = f * 14;
    const tineDepth = c.createGain();
    tineDepth.gain.setValueAtTime(f * 0.9, at);
    tineDepth.gain.exponentialRampToValueAtTime(0.01, at + 0.08);
    tine.connect(tineDepth).connect(carrier.frequency);

    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.006);
    amp.gain.exponentialRampToValueAtTime(level * 0.35, at + 1.5);
    amp.gain.exponentialRampToValueAtTime(level * 0.08, at + 6);
    carrier.connect(amp).connect(dest());

    // a ringing note dies out by itself; stop only fades it sooner
    const end = run([carrier, body, tine], at, 8);
    return {
        stop: (when) => {
            fade(amp, when, 0.08);
            end(when, 1);
        },
    };
}

/** partials that die away faster the higher they are, like a struck string */
function piano(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const amp = c.createGain();
    amp.gain.setValueAtTime(level, at);
    amp.connect(dest());
    const oscs: OscillatorNode[] = [];
    for (let n = 1; n <= 6; n++) {
        const part = c.createGain();
        const peak = 0.55 / n ** 1.4;
        part.gain.setValueAtTime(0, at);
        part.gain.linearRampToValueAtTime(peak, at + 0.004);
        part.gain.exponentialRampToValueAtTime(peak * 0.001, at + 4.5 / n);
        // two strings a hair apart
        for (const cents of [-2, 2]) {
            const o = osc(c, 'sine', f * n, cents);
            o.connect(part);
            oscs.push(o);
        }
        part.connect(amp);
    }
    const end = run(oscs, at, 5);
    return {
        stop: (when) => {
            fade(amp, when, 0.12);
            end(when, 1);
        },
    };
}

/** detuned saws, softly filtered, slow to swell and slow to leave */
function pad(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.4;
    filter.frequency.setValueAtTime(f * 1.5, at);
    filter.frequency.linearRampToValueAtTime(f * 4, at + 2);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level * 0.3, at + 0.8);
    filter.connect(amp).connect(dest());
    const oscs = [-9, 0, 9].map((cents) => osc(c, 'sawtooth', f, cents));
    for (const o of oscs) o.connect(filter);
    const end = run(oscs, at, 120);
    return {
        stop: (when) => {
            fade(amp, when, 0.5);
            end(when, 4);
        },
    };
}

/** drawbars: sine stops at the octaves and fifth, with a little vibrato */
function organ(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level * 0.5, at + 0.03);
    amp.connect(dest());
    const wobble = osc(c, 'sine', 5.6);
    const depth = c.createGain();
    depth.gain.value = 7;
    wobble.connect(depth);
    const oscs = [wobble];
    const stops: [number, number][] = [
        [0.5, 0.5],
        [1, 0.8],
        [2, 0.45],
        [3, 0.3],
        [4, 0.2],
    ];
    for (const [ratio, mix] of stops) {
        const o = osc(c, 'sine', f * ratio);
        depth.connect(o.detune);
        const g = c.createGain();
        g.gain.value = mix;
        o.connect(g).connect(amp);
        oscs.push(o);
    }
    const end = run(oscs, at, 120);
    return {
        stop: (when) => {
            fade(amp, when, 0.06);
            end(when, 0.6);
        },
    };
}

/** a bright pluck that darkens fast */
function guitar(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(f * 9, at);
    filter.frequency.exponentialRampToValueAtTime(f * 1.4, at + 0.6);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level * 0.7, at + 0.003);
    amp.gain.exponentialRampToValueAtTime(level * 0.001, at + 3);
    filter.connect(amp).connect(dest());
    const oscs = [osc(c, 'sawtooth', f), osc(c, 'triangle', f, 4)];
    for (const o of oscs) o.connect(filter);
    const end = run(oscs, at, 3.2);
    return {
        stop: (when) => {
            fade(amp, when, 0.1);
            end(when, 0.8);
        },
    };
}

/** FM at an odd ratio: glassy, bell-like, a long shimmer */
function bells(midi: number, at: number, level: number): Voice {
    const c = audio();
    const f = hz(midi);
    const carrier = osc(c, 'sine', f);
    const mod = osc(c, 'sine', f * 3.5);
    const depth = c.createGain();
    depth.gain.setValueAtTime(f * 1.6, at);
    depth.gain.exponentialRampToValueAtTime(f * 0.05, at + 2.5);
    mod.connect(depth).connect(carrier.frequency);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(level * 0.8, at + 0.004);
    amp.gain.exponentialRampToValueAtTime(level * 0.001, at + 6);
    carrier.connect(amp).connect(dest());
    const end = run([carrier, mod], at, 6.2);
    return {
        stop: (when) => {
            fade(amp, when, 0.4);
            end(when, 2.5);
        },
    };
}

interface Preset {
    label: string;
    mood: string;
    note: (midi: number, at: number, level: number) => Voice;
    /** reverb send */
    room: number;
    /** seconds between notes, low to high */
    strum: number;
    /** upper notes moved by this many semitones */
    lift: number;
}

export const SOUNDS = {
    keys: {
        label: 'Keys',
        mood: 'warm',
        note: ePiano,
        room: 0.18,
        strum: 0,
        lift: 0,
    },
    piano: {
        label: 'Piano',
        mood: 'bright',
        note: piano,
        room: 0.22,
        strum: 0.008,
        lift: 0,
    },
    pad: {
        label: 'Pad',
        mood: 'ambient',
        note: pad,
        room: 0.45,
        strum: 0,
        lift: 0,
    },
    organ: {
        label: 'Organ',
        mood: 'church',
        note: organ,
        room: 0.32,
        strum: 0,
        lift: 0,
    },
    guitar: {
        label: 'Guitar',
        mood: 'strummed',
        note: guitar,
        room: 0.14,
        strum: 0.022,
        lift: 0,
    },
    bells: {
        label: 'Bells',
        mood: 'dreamy',
        note: bells,
        room: 0.5,
        strum: 0.04,
        lift: 12,
    },
} satisfies Record<string, Preset>;

export type Sound = keyof typeof SOUNDS;

let current: Sound = 'keys';

export function setSound(next: Sound): void {
    current = next;
    if (ctx && wet)
        wet.gain.setTargetAtTime(SOUNDS[next].room, ctx.currentTime, 0.1);
}

// voicing: bass in the second octave, chord around middle C
const BASS_LOW = 36;
const UPPER_LOW = 52;
const UPPER_HIGH = 72;

/** every inversion of the chord that sits in the upper range */
function inversions(tones: number[]): number[][] {
    const pcs = [...new Set(tones)].sort((a, b) => a - b);
    const out: number[][] = [];
    for (let i = 0; i < pcs.length; i++) {
        const order = [...pcs.slice(i), ...pcs.slice(0, i)];
        for (let base = UPPER_LOW; base < UPPER_LOW + 12; base++) {
            if (base % 12 !== order[0]) continue;
            const notes: number[] = [];
            let last = base - 1;
            for (const pc of order) {
                let n = last + 1;
                while (n % 12 !== pc) n++;
                notes.push(n);
                last = n;
            }
            if (notes[notes.length - 1]! <= UPPER_HIGH) out.push(notes);
        }
    }
    return out;
}

/** how far each finger has to move */
function distance(from: number[], to: number[]): number {
    return to.reduce(
        (sum, n) => sum + Math.min(...from.map((m) => Math.abs(m - n))),
        0,
    );
}

/** nearest voicing to the last one; the first sits around middle C */
export function voice(name: string, prev: number[] | null): number[] {
    const { bass, tones } = chordNotes(name);
    if (!tones.length) return [];
    const options = inversions(tones);
    const target = prev?.length ? prev : [60, 64, 67];
    const upper =
        options.sort((a, b) => distance(target, a) - distance(target, b))[0] ??
        [];
    return [BASS_LOW + bass, ...upper];
}

function sound(notes: number[], at: number): Voice[] {
    const { note, strum, lift } = SOUNDS[current];
    const [bass, ...upper] = notes;
    const voices = upper.map((n, i) =>
        note(n + lift, at + (i + 1) * strum, 0.16),
    );
    if (bass !== undefined) voices.push(note(bass, at, 0.22));
    return voices;
}

// a preview chord lets go this long before the next, so it has faded when that one starts
const LET_GO = 0.25;

/** preview: one after another, voice-led, each heard on its own */
export function playChords(names: readonly string[], each = 1.2): void {
    const c = audio();
    void c.resume();
    stopHeld();
    const start = c.currentTime + 0.05;
    let prev: number[] | null = null;
    clear = true;
    names.forEach((name, i) => {
        const notes = voice(name, prev);
        if (!notes.length) return;
        const at = start + i * each;
        const last = i === names.length - 1;
        for (const v of sound(notes, at))
            v.stop(at + (last ? 2.5 : each - LET_GO));
        prev = notes.slice(1);
    });
    clear = false;
}

// step mode: one chord rings until the next
let held: Voice[] = [];
let heldNotes: number[] | null = null;

export function holdChord(name: string): void {
    const c = audio();
    void c.resume();
    const at = c.currentTime + 0.01;
    for (const v of held) v.stop(at);
    const notes = voice(name, heldNotes);
    held = notes.length ? sound(notes, at) : [];
    if (notes.length) heldNotes = notes.slice(1);
}

export function stopHeld(): void {
    if (!ctx) return;
    for (const v of held) v.stop(ctx.currentTime);
    held = [];
}

/** a fresh start voices the next chord around middle C again */
export function resetVoicing(): void {
    heldNotes = null;
}
