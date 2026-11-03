// Melody pop-out on the song view: open it and the next play records, pausing ends the
// take, then each chord's key note is confirmed right there and the take exported

import './lab.css';
import { popIn, popOut } from '../animate.ts';
import { noteName } from '../music/theory.ts';
import { recordTake, type Recording } from './recorder.ts';
import { review, type Review } from './review.ts';

// clear enough to show as the note you're singing
const CLEAR = 0.8;

type State = 'closed' | 'armed' | 'recording' | 'saving' | 'review';

export interface MelodyPanel {
    /** the next play records */
    armed(): boolean;
    /** recording from now; false if the mic isn't available */
    begin(): Promise<boolean>;
    /** a chord change, as it sounds */
    tap(chord: string): void;
    /** the take ends and its review opens */
    end(): void;
    remove(): void;
}

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

/** about: the song and the key it sounds in, read when a take starts */
export function melodyPanel(
    about: () => { song: string; key?: string },
): MelodyPanel {
    let state: State = 'closed';
    let rec: Recording | null = null;
    let shown: Review | null = null;
    let chords = 0;
    let last = '';

    const fab = button('● MELODY', () => arm(), 'cg-btn lab-fab');
    fab.title = 'Record a melody take with playback';
    const panel = el('div', 'lab-pop');
    panel.hidden = true;
    const title = el('p', 'cg-chooser-title', 'Melody take');
    const line = el('p', 'cg-chooser-now');
    const titles = el('div', 'cg-chooser-titles');
    titles.append(title, line);
    const head = el('div', 'cg-chooser-head');
    head.append(titles, button('×', () => close(), 'cg-icon'));
    const body = el('div', 'lab-pop-body');
    const foot = el('div', 'cg-chooser-foot');
    panel.append(head, body, foot);
    document.body.append(fab, panel);

    const note = el('p', 'lab-pop-note', '—');
    const singing = (hz: number, clarity: number): void => {
        note.textContent =
            hz > 0 && clarity >= CLEAR
                ? noteName(Math.round(69 + 12 * Math.log2(hz / 440)), false)
                : '—';
    };

    const draw = (): void => {
        fab.hidden = state !== 'closed';
        if (state === 'closed') {
            if (!panel.hidden) popOut(panel, () => (panel.hidden = true));
            return;
        }
        if (panel.hidden) {
            panel.hidden = false;
            popIn(panel);
        }
        foot.replaceChildren();
        if (state === 'armed') {
            title.textContent = 'Melody take';
            line.textContent = 'Ready: press play to start';
            body.replaceChildren(
                el(
                    'p',
                    'lab-status',
                    'Recording starts with play and ends with pause. Each chord you step to is marked. Headphones keep the chords out of the mic.',
                ),
            );
        } else if (state === 'recording') {
            title.textContent = '● Recording';
            line.textContent = chords
                ? `Chord ${chords} · ${last} · pause to finish`
                : 'Pause to finish';
            body.replaceChildren(note);
        } else if (state === 'saving') {
            title.textContent = 'Melody take';
            line.textContent = 'Saving…';
            body.replaceChildren();
        } else if (shown) {
            title.textContent = 'Confirm each key note';
            line.replaceWith(shown.tally);
            body.replaceChildren(shown.list, shown.status);
            foot.append(
                ...shown.tools,
                button('NEW TAKE', () => arm(), 'cg-btn cg-btn-primary'),
            );
        }
    };

    /** the review's tally takes the line's place; put it back */
    const restoreLine = (): void => {
        if (shown && shown.tally.isConnected) shown.tally.replaceWith(line);
        shown?.stop();
        shown = null;
    };

    const arm = (): void => {
        restoreLine();
        state = 'armed';
        draw();
    };

    const close = (): void => {
        if (rec) {
            // closed mid-take: kept, not reviewed
            void rec.finish();
            rec = null;
        }
        restoreLine();
        state = 'closed';
        draw();
    };

    return {
        armed: () => state === 'armed',
        async begin() {
            const got = await recordTake(about(), (f) =>
                singing(f.hz, f.clarity),
            );
            if (typeof got === 'string') {
                line.textContent =
                    got === 'denied'
                        ? 'Microphone blocked: allow it and press play again'
                        : 'No microphone here';
                return false;
            }
            rec = got;
            chords = 0;
            last = '';
            state = 'recording';
            draw();
            return true;
        },
        tap(chord) {
            if (!rec) return;
            rec.tap(chord);
            chords++;
            last = chord;
            draw();
        },
        end() {
            if (!rec) return;
            const r = rec;
            rec = null;
            state = 'saving';
            draw();
            void r
                .finish()
                .then(review)
                .then((made) => {
                    if (state !== 'saving') {
                        made.stop();
                        return;
                    }
                    shown = made;
                    state = 'review';
                    draw();
                });
        },
        remove() {
            close();
            fab.remove();
            panel.remove();
        },
    };
}
