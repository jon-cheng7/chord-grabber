// Right after a take: what was heard over each chord and how well it suits it, your own
// singing to hear back. The song view's pop-out and the lab's take both show it

import './lab.css';
import { popIn, popOut } from '../animate.ts';
import { noteName } from '../music/theory.ts';
import { cardOf, type Card } from './score.ts';
import { decode, download, slugOf, type Take } from './takes.ts';

// shares smaller than this aren't worth showing
const SHOWN = 0.1;
// a little either side, so a pushed note is heard whole
const PAD = 0.2;

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

const fitText = (f: number | null): string =>
    f === null ? 'nothing heard' : `fit ${f.toFixed(2)}`;

export interface Review {
    /** the take's chord fit */
    tally: HTMLElement;
    /** a row per chord */
    list: HTMLElement;
    /** downloads the whole take, audio and all, for the takes folder */
    save: HTMLButtonElement;
    /** stops your voice playing back */
    stop(): void;
}

export async function review(take: Take): Promise<Review> {
    const card: Card = await cardOf(take, false);

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

    const tally = el(
        'p',
        'cg-chooser-now',
        card.fit.ours === null
            ? 'No singing heard'
            : `Melody fits the chords ${card.fit.ours.toFixed(2)} (1 is perfect)`,
    );
    const list = el('div', 'cg-chooser-list');
    list.append(
        el(
            'p',
            'lab-status',
            'What was heard over each chord, biggest share first. ▶ plays your singing back. Nothing to answer: the take is saved.',
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
        const profile = card.heard.ours[i]?.profile ?? [];
        const shares = el('div', 'lab-review-heard');
        profile
            .map((w, pc) => ({ w, pc }))
            .filter((x) => x.w >= SHOWN)
            .sort((a, b) => b.w - a.w)
            .forEach(({ w, pc }) => {
                const note = el('span', 'lab-review-note', name(pc));
                note.style.opacity = String(0.35 + 0.65 * w);
                note.title = `${Math.round(w * 100)}% of the singing`;
                shares.append(note);
            });
        shares.append(el('span', 'lab-muted', fitText(row.fit.ours)));
        line.append(label, shares);
        list.append(line);
    });

    const save = button('EXPORT', () =>
        download(JSON.stringify(take), `${slugOf(take)}.json`),
    );
    save.title = 'The whole take, audio and all: for the takes folder';

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
        el('p', 'cg-chooser-title', `Heard · ${take.song ?? 'take'}`),
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
