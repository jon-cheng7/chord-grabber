// Style pop-out on the song view: two reharms of the same passage in a style, heard one
// after the other, and you pick. Every pick is kept; scripts/tune.ts fits the weights to
// them. One is made with the current weights, the other with them nudged at random, so
// each pick says which way to move

import './lab.css';
import { popIn, popOut } from '../animate.ts';
import {
    features,
    modelOf,
    poolOf,
    restyle,
    STYLES,
    WEIGHTS,
    type Change,
    type Model,
    type Restyled,
    type Song,
    type Weights,
} from '../engine/index.ts';
import { TABLES } from '../engine/style-data.ts';
import { allPrefs, download, putPref, type Variant } from './takes.ts';

// the passage heard: a little before the first change, this many chords in all
const BEFORE = 2;
const PASSAGE = 8;
// how far the second reharm's weights stray: a log-normal nudge
const NUDGE = 0.6;
const TRIES = 6;

export interface StylePanel {
    remove(): void;
}

interface Side {
    weights: Weights;
    made: Restyled;
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

/** a normal draw, for the nudge */
const gauss = (): number =>
    Math.sqrt(-2 * Math.log(1 - Math.random())) *
    Math.cos(2 * Math.PI * Math.random());

const nudged = (w: Weights): Weights => ({
    style: w.style * Math.exp(gauss() * NUDGE),
    distinct: w.distinct * Math.exp(gauss() * NUDGE),
    melody: w.melody * Math.exp(gauss() * NUDGE),
    faithful: w.faithful * Math.exp(gauss() * NUDGE),
});

export function stylePanel(o: {
    title: string;
    /** the song as the engine sees it, in the written key */
    song: () => Song;
    /** a chord as the reader sees it */
    show: (chord: string) => string;
    /** written chords played one after another */
    hear: (chords: string[]) => void;
    /** written into the sheet as one undoable change */
    apply: (changes: Change[]) => void;
}): StylePanel {
    const usable = STYLES.filter((s) => TABLES[s.id]);
    // every style together: what a style shares with the rest isn't what makes it that style
    const pool = poolOf(usable.map((s) => TABLES[s.id]!));
    const models = new Map<string, Model>();
    const modelFor = (id: string): Model => {
        let m = models.get(id);
        if (!m) models.set(id, (m = modelOf(TABLES[id]!, pool)));
        return m;
    };

    let style = usable[0]?.id ?? '';
    let strength = 0.5;
    let pair: {
        song: Song;
        a: Side;
        b: Side;
        from: number;
        to: number;
    } | null = null;
    let better: 'a' | 'b' | 'same' | null = null;
    let styled: 'a' | 'b' | 'same' | null = null;
    let picks = 0;
    void allPrefs().then((all) => {
        picks = all.length;
        draw();
    });

    const fab = button(
        '◆ STYLE',
        () => openPanel(),
        'cg-btn lab-fab lab-fab-style',
    );
    fab.title = 'Compare style reharms and pick the better';
    const panel = el('div', 'lab-pop lab-pop-style');
    panel.hidden = true;
    const head = el('div', 'cg-chooser-head');
    const titles = el('div', 'cg-chooser-titles');
    const line = el('p', 'cg-chooser-now');
    titles.append(el('p', 'cg-chooser-title', 'Style A/B'), line);
    head.append(
        titles,
        button('×', () => closePanel(), 'cg-icon'),
    );
    const body = el('div', 'lab-pop-body');
    const foot = el('div', 'cg-chooser-foot');
    panel.append(head, body, foot);
    document.body.append(fab, panel);

    const pick = el('select', 'cg-btn lab-review-other');
    for (const s of usable) pick.add(new Option(s.name, s.id));
    pick.addEventListener('change', () => {
        style = pick.value;
        newPair();
    });
    const slider = el('input', 'lab-strength');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.1';
    slider.value = String(strength);
    slider.addEventListener('change', () => {
        strength = Number(slider.value);
        newPair();
    });

    function newPair(): void {
        better = styled = null;
        pair = null;
        const model = style ? modelFor(style) : null;
        if (!model) return draw();
        const song = o.song();
        const a: Side = {
            weights: WEIGHTS,
            made: restyle(song, style, model, { weights: WEIGHTS, strength }),
        };
        let b: Side | null = null;
        for (let i = 0; i < TRIES && !b; i++) {
            const weights = nudged(WEIGHTS);
            const made = restyle(song, style, model, { weights, strength });
            if (made.chords.some((c, k) => c !== a.made.chords[k]))
                b = { weights, made };
        }
        if (b) {
            const differ = a.made.chords.flatMap((c, k) =>
                c !== b.made.chords[k] ? [k] : [],
            );
            const at = differ[Math.floor(Math.random() * differ.length)]!;
            const from = Math.max(0, at - BEFORE);
            const to = Math.min(a.made.chords.length, from + PASSAGE);
            // which is which stays hidden
            const [x, y] = Math.random() < 0.5 ? [a, b] : [b, a];
            pair = { song, a: x, b: y, from, to };
        }
        draw();
    }

    function save(): void {
        if (!pair || !better || !styled) return;
        const { song, from, to } = pair;
        const model = modelFor(style);
        const variant = (s: Side): Variant => ({
            weights: s.weights,
            chords: s.made.chords,
            features: features(song, s.made.chords, style, model, undefined, [
                from,
                to,
            ]),
        });
        void putPref({
            at: new Date().toISOString(),
            song: o.title,
            style,
            strength,
            from,
            to,
            a: variant(pair.a),
            b: variant(pair.b),
            better,
            styled,
        }).then(() => {
            picks++;
            newPair();
        });
    }

    const choice = (
        question: string,
        now: 'a' | 'b' | 'same' | null,
        set: (v: 'a' | 'b' | 'same') => void,
    ): HTMLElement => {
        const row = el('div', 'lab-ab-question');
        row.append(el('span', 'lab-muted', question));
        const chips = el('div', 'cg-chips');
        for (const [v, label] of [
            ['a', 'A'],
            ['b', 'B'],
            ['same', 'SAME'],
        ] as const) {
            const chip = button(
                label,
                () => {
                    set(v);
                    draw();
                    save();
                },
                'cg-chip lab-review-chip',
            );
            if (now === v) chip.classList.add('cg-on');
            chips.append(chip);
        }
        row.append(chips);
        return row;
    };

    function draw(): void {
        line.textContent = `${picks} picks kept`;
        foot.replaceChildren(
            button(
                'EXPORT PICKS',
                () =>
                    void allPrefs().then((all) =>
                        download(
                            JSON.stringify(all),
                            `style-picks-${new Date().toISOString().slice(0, 10)}.json`,
                        ),
                    ),
            ),
        );
        if (!usable.length) {
            body.replaceChildren(
                el(
                    'p',
                    'lab-status',
                    'No style tables yet. Run node scripts/corpus.ts (see TRAINING.md), then reload.',
                ),
            );
            return;
        }
        const controls = el('div', 'lab-row');
        controls.append(
            pick,
            el('span', 'lab-muted', 'close'),
            slider,
            el('span', 'lab-muted', 'free'),
        );
        if (!pair) {
            body.replaceChildren(
                controls,
                el(
                    'p',
                    'lab-status',
                    'Both reharms came out the same here. Move the slider or pick another style.',
                ),
                button('TRY AGAIN', () => newPair()),
            );
            return;
        }
        const { a, b, from, to } = pair;
        const passage = (chords: string[]): string[] => chords.slice(from, to);
        const row = (label: string, chords: string[]): HTMLElement => {
            const r = el('div', 'lab-ab-row');
            r.append(
                button(
                    `▶ ${label}`,
                    () => o.hear(passage(chords)),
                    'cg-btn lab-ab-play',
                ),
                el(
                    'span',
                    'lab-ab-chords',
                    passage(chords).map(o.show).join('  '),
                ),
            );
            return r;
        };
        const use = (s: Side): HTMLButtonElement =>
            button('USE', () => o.apply(s.made.changes), 'cg-btn cg-btn-quiet');
        const rowA = row('A', a.made.chords);
        rowA.append(use(a));
        const rowB = row('B', b.made.chords);
        rowB.append(use(b));
        body.replaceChildren(
            controls,
            row('ORIGINAL', a.made.original),
            rowA,
            rowB,
            choice('Sounds better', better, (v) => (better = v)),
            choice(
                `More ${usable.find((s) => s.id === style)?.name ?? style}`,
                styled,
                (v) => (styled = v),
            ),
            button('SKIP', () => newPair(), 'cg-btn cg-btn-quiet'),
        );
    }

    function openPanel(): void {
        fab.hidden = true;
        panel.hidden = false;
        popIn(panel);
        newPair();
    }

    function closePanel(): void {
        popOut(panel, () => (panel.hidden = true));
        fab.hidden = false;
    }

    return {
        remove() {
            fab.remove();
            panel.remove();
        },
    };
}
