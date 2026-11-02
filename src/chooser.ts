// Reharm chooser: try chords from the bottom sheet, DONE keeps one

import { popIn, popOut, slideClosed } from './animate.ts';
import { isChord } from './music/chord.ts';

/** a way for the chords around a pick to follow it */
export interface FollowUp {
    label: string;
    why: string;
    /** the chords around it, as shown */
    chords: string;
    hear: () => void;
    /** the pick and its neighbours, as one change */
    apply: () => void;
}

/** options as shown: names in the reader's key, reasons in words */
export interface ChoiceGroup {
    label: string;
    options: { chord: string; why: string }[];
}

export interface ChooserOptions {
    title: string;
    /** what's there now, as shown */
    current: string | null;
    /** how it's read: IV, ♭VII in G */
    reading?: string;
    groups: ChoiceGroup[];
    /** an option in context */
    hear: (chord: string) => void;
    /** the same spot as it is now, to compare against */
    compare?: () => void;
    /** only on DONE */
    choose: (chord: string) => void;
    /** for a pick that changes what the chord does; empty for the rest */
    follow?: (chord: string) => FollowUp[];
    /** back to what the sheet had */
    revert?: () => void;
    remove?: () => void;
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

let open: HTMLElement[] = [];

/** closes without changing anything */
export function closeChooser(): void {
    const nodes = open;
    open = [];
    for (const node of nodes) popOut(node, () => node.remove());
}

const tidy = (text: string): string =>
    text.trim().replace(/♯/g, '#').replace(/♭/g, 'b');

export function openChooser(o: ChooserOptions): void {
    closeChooser();
    // tapping outside is cancel
    const shade = el('div', 'cg-shade');
    shade.addEventListener('click', closeChooser);
    const box = el('div', 'cg-chooser');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', o.title);
    let picked: string | null = null;

    const head = el('div', 'cg-chooser-head');
    const titles = el('div', 'cg-chooser-titles');
    titles.append(el('p', 'cg-chooser-title', o.title));
    const now = o.current
        ? `Now: ${o.current}${o.reading ? ` · ${o.reading}` : ''}`
        : null;
    if (o.compare) {
        const ab = button(
            `▶ ${now ?? 'As written'}`,
            o.compare,
            'cg-chooser-now cg-chooser-ab',
        );
        ab.setAttribute('aria-label', 'Hear it as it is now');
        titles.append(ab);
    } else if (now) titles.append(el('p', 'cg-chooser-now', now));
    head.append(titles, button('×', closeChooser, 'cg-icon'));
    box.append(head);

    let then: FollowUp | null = null;
    const done = button('DONE', () => {
        if (picked && picked !== o.current) {
            if (then) then.apply();
            else o.choose(picked);
        }
        closeChooser();
    }, 'cg-btn cg-btn-primary');

    // a bigger pick: keep the rest as is, or let the chords around it follow
    const follow = el('div', 'cg-follow');
    follow.hidden = true;
    let ways: [FollowUp | null, HTMLButtonElement][] = [];
    const pickWay = (way: FollowUp | null): void => {
        then = way;
        for (const [w, b] of ways) b.classList.toggle('cg-on', w === way);
        if (way) way.hear();
        else if (picked) o.hear(picked);
    };
    const showFollow = (chord: string | null): void => {
        const found = chord && o.follow ? o.follow(chord) : [];
        if (!found.length) {
            slideClosed(follow);
            return;
        }
        const row = el('div', 'cg-chips cg-ways');
        ways = [null, ...found].map((w) => {
            const b = button('', () => pickWay(w), 'cg-chip cg-way');
            b.append(el('span', 'cg-chip-name', w ? w.label : 'As is'));
            if (w) b.append(el('span', 'cg-way-chords', w.chords));
            const why = w ? w.why : 'only this chord changes';
            b.append(el('span', 'cg-chip-why', why));
            row.append(b);
            return [w, b];
        });
        ways[0]![1].classList.add('cg-on');
        follow.replaceChildren(
            el('p', 'cg-pop-label', `MAKE ${chord} WORK`),
            row,
        );
        if (follow.hidden) popIn(follow);
    };

    const chips: HTMLButtonElement[] = [];
    const stage = (chord: string | null): void => {
        picked = chord;
        then = null;
        for (const c of chips)
            c.classList.toggle('cg-on', c.dataset.chord === picked);
        done.disabled = !picked || picked === o.current;
        showFollow(picked && picked !== o.current ? picked : null);
    };

    box.append(follow);
    const list = el('div', 'cg-chooser-list');
    for (const g of o.groups) {
        list.append(el('p', 'cg-pop-label', g.label));
        const row = el('div', 'cg-chips');
        for (const opt of g.options) {
            const chip = button(
                '',
                () => {
                    input.value = '';
                    status.textContent = '';
                    status.className = 'cg-typed-status';
                    stage(opt.chord);
                    o.hear(opt.chord);
                },
                'cg-chip',
            );
            chip.dataset.chord = opt.chord;
            if (opt.chord === o.current) chip.classList.add('cg-chip-current');
            chip.append(
                el('span', 'cg-chip-name', opt.chord),
                el('span', 'cg-chip-why', opt.why),
            );
            chips.push(chip);
            row.append(chip);
        }
        list.append(row);
    }
    box.append(list);

    // any chord, checked as you type
    list.append(el('p', 'cg-pop-label', o.groups.length ? 'YOUR OWN' : 'CHORD'));
    const input = el('input', 'cg-typed-input');
    input.placeholder = 'Type a chord, e.g. F#m7';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.enterKeyHint = 'done';
    const status = el('p', 'cg-typed-status');
    let heard = '';
    input.addEventListener('input', () => {
        const text = tidy(input.value);
        if (!text) {
            status.textContent = '';
            status.className = 'cg-typed-status';
            stage(null);
            return;
        }
        const ok = isChord(text);
        status.className = `cg-typed-status ${ok ? 'cg-ok' : 'cg-bad'}`;
        status.textContent = ok ? `✓ ${text}` : 'Not a chord yet';
        input.classList.toggle('cg-bad', !ok);
        stage(ok ? text : null);
    });
    // hear it once typing settles, not on every letter
    input.addEventListener('change', () => {
        if (picked && picked !== heard) o.hear((heard = picked));
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !done.disabled) done.click();
    });
    list.append(input, status);

    const foot = el('div', 'cg-chooser-foot');
    if (o.revert)
        foot.append(
            button('ORIGINAL', () => {
                o.revert?.();
                closeChooser();
            }),
        );
    if (o.remove)
        foot.append(
            button('REMOVE', () => {
                o.remove?.();
                closeChooser();
            }),
        );
    foot.append(done);
    box.append(foot);

    stage(null);
    document.body.append(shade, box);
    open = [shade, box];
    popIn(shade);
    popIn(box);
    // nothing to pick from: straight to typing
    if (!o.groups.length) input.focus();
}
