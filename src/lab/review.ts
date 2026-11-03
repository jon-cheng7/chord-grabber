// Right after a take: each chord's guess, one tap to confirm or correct it, your own
// singing to hear back. Answers save as you go; ? is unanswered, - is skipped.
// The song view's pop-out and the lab's take both show it

import './lab.css';
import { popIn, popOut } from '../animate.ts';
import { chordNotes, noteName, pitch } from '../music/theory.ts';
import { parseChord } from '../music/chord.ts';
import { cardOf, type Card, type Tally } from './score.ts';
import { decode, download, putTake, slugOf, type Take } from './takes.ts';

// heard notes offered per chord, beside the chord's own
const OFFER = 4;
// a little either side, so a pushed note is heard whole
const PAD = 0.2;

type Answer = number | null | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(
    text: string,
    onClick: () => void,
    className = 'cg-btn',
): HTMLButtonElement {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

const name = (pc: number): string => noteName(pc, false);

const answersOf = (expect: string | undefined, n: number): Answer[] => {
    const words = (expect ?? '').trim().split(/\s+/).filter(Boolean);
    return Array.from({ length: n }, (_, i) => {
        const w = words[i];
        if (!w || w === '?') return undefined;
        const c = parseChord(w);
        return c ? pitch(c.root) : null;
    });
};

const sum = (t: Tally): string =>
    t.total
        ? `${t.right} right · ${t.wrong} wrong · ${t.unsure} unsure of ${t.total}`
        : 'no answers yet';

export interface Review {
    /** the right/wrong count so far */
    tally: HTMLElement;
    /** a row per chord */
    list: HTMLElement;
    /** downloads the whole take, answers and audio, for the takes folder */
    save: HTMLButtonElement;
    /** stops your voice playing back */
    stop(): void;
}

export async function review(take: Take): Promise<Review> {
    let card: Card = await cardOf(take, true);
    const answers = answersOf(take.expect, card.rows.length);

    // your own voice, a chord at a time
    let ctx: AudioContext | null = null;
    let voice: AudioBuffer | null = null;
    let playing: AudioBufferSourceNode | null = null;
    const hear = (i: number): void => {
        const audio = take.audio;
        if (!audio) return;
        ctx ??= new AudioContext();
        if (!voice) {
            const pcm = decode(audio.pcm);
            voice = ctx.createBuffer(1, pcm.length, audio.rate);
            voice.copyToChannel(pcm, 0);
        }
        playing?.stop();
        const from = Math.max(0, card.bounds[i]! - audio.at - PAD);
        const to = card.bounds[i + 1]! - audio.at + PAD;
        playing = ctx.createBufferSource();
        playing.buffer = voice;
        playing.connect(ctx.destination);
        playing.start(0, from, to - from);
    };

    const tally = el('p', 'cg-chooser-now');
    const list = el('div', 'cg-chooser-list');

    const keep = async (): Promise<void> => {
        take.expect = answers
            .map((a) => (a === undefined ? '?' : a === null ? '-' : name(a)))
            .join(' ');
        await putTake(take);
        card = await cardOf(take, true);
        const left = answers.filter((a) => a === undefined).length;
        tally.textContent = left
            ? `${left} of ${answers.length} chords still to answer`
            : `All answered · the detector got ${sum(card.ours)}`;
    };

    const draw = (): void => {
        list.replaceChildren(
            el(
                'p',
                'lab-status',
                'Tap the note that matters most over each chord. Dashed: what the detector guessed. ▶ plays your singing back. ? if you can’t tell.',
            ),
        );
        card.rows.forEach((row, i) => {
            const line = el('div', 'lab-review-row');
            const label = el('div', 'lab-review-chord');
            label.append(
                el('span', 'lab-muted', `${i + 1}`),
                el('span', 'lab-review-name', row.chord || '—'),
            );
            if (take.audio)
                label.append(button('▶', () => hear(i), 'cg-icon lab-review-hear'));
            const guess = row.ours.lead;
            const heard = card.heard.ours[i]?.ranked.slice(0, OFFER) ?? [];
            const tones = row.chord ? chordNotes(row.chord).tones : [];
            const offer = [...new Set([...heard.map((c) => c.pc), ...tones])];
            const chips = el('div', 'cg-chips');
            const pick = (a: Answer): void => {
                answers[i] = a;
                draw();
                void keep();
            };
            for (const pc of offer) {
                const chip = button(name(pc), () => pick(pc), 'cg-chip lab-review-chip');
                if (answers[i] === pc) chip.classList.add('cg-on');
                else if (answers[i] === undefined && guess === pc)
                    chip.classList.add('lab-guess');
                if (!heard.some((c) => c.pc === pc))
                    chip.classList.add('lab-unheard');
                chips.append(chip);
            }
            const other = el('select', 'cg-btn lab-review-other');
            other.add(new Option('other', ''));
            for (let pc = 0; pc < 12; pc++)
                if (!offer.includes(pc)) other.add(new Option(name(pc), String(pc)));
            const own = answers[i];
            if (typeof own === 'number' && !offer.includes(own)) {
                other.value = String(own);
                other.classList.add('cg-on');
            }
            other.addEventListener('change', () => {
                if (other.value) pick(Number(other.value));
            });
            const skip = button('?', () => pick(null), 'cg-chip lab-review-chip');
            skip.title = 'Not sure: leave this chord out';
            if (answers[i] === null) skip.classList.add('cg-on');
            chips.append(other, skip);
            line.append(label, chips);
            list.append(line);
        });
    };

    const save = button('EXPORT', () =>
        download(JSON.stringify(take), `${slugOf(take)}.json`),
    );
    save.title = 'The whole take, audio and answers: for the takes folder';

    draw();
    await keep();
    return {
        tally,
        list,
        save,
        stop: () => {
            playing?.stop();
            void ctx?.close();
            ctx = null;
            voice = null;
        },
    };
}

let open: HTMLElement[] = [];

export function closeReview(): void {
    const nodes = open;
    open = [];
    for (const node of nodes) popOut(node, () => node.remove());
}

/** the review on its own, over everything */
export async function openReview(
    take: Take,
    onClose?: () => void,
): Promise<void> {
    closeReview();
    const r = await review(take);
    const shade = el('div', 'cg-shade');
    const box = el('div', 'cg-chooser lab-review');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Melody take');
    const done = (): void => {
        r.stop();
        closeReview();
        onClose?.();
    };
    shade.addEventListener('click', done);
    const head = el('div', 'cg-chooser-head');
    const titles = el('div', 'cg-chooser-titles');
    titles.append(
        el('p', 'cg-chooser-title', `Key note per chord · ${take.song ?? 'take'}`),
        r.tally,
    );
    head.append(titles, button('×', done, 'cg-icon'));
    const foot = el('div', 'cg-chooser-foot');
    foot.append(r.save, button('DONE', done, 'cg-btn cg-btn-primary'));
    box.append(head, r.list, foot);
    document.body.append(shade, box);
    open = [shade, box];
    popIn(shade);
    popIn(box);
}
