# Usage savers: five features, three concepts each

Static mockups of five ways Shellby could save the user's Claude usage, drawn
in the panel's own tokens and fonts at a full-screen 4K size (2560x1440 CSS px
at 150%, the same as `mockups/time/`). Each HTML has a one-line note at the top
saying what the concept is and what it trades off. The three concepts for a
feature differ in placement or interaction, not colour.

`shared.css` is the base; `kit.js` draws the panel chrome (tab strip, subbar,
turn footer, composer, and the conversation every chat concept sits in) from
data, so all fifteen show the same Shellby. `sh render.sh` renders every HTML to
a PNG with headless Edge; `sh render.sh 1-1-chip-under-composer.html` renders one.

## 1. A model suggestion that asks first

When a first message looks small (a rename, a quick question), offer Sonnet,
Haiku or the local model with the saving, and never switch without the user.

- `1-1-chip-under-composer.html`: a chip under the box while the small message sits there; Enter still sends on Opus.
- `1-2-card-after-sending.html`: the message goes out as usual and a card asks once before Claude starts, with "always for questions like this"; doing nothing keeps Opus.
- `1-3-model-pill-badge.html`: the subbar's model pill grows a "Haiku?" badge, and its menu holds the offer, the costs per model, and the local model.

## 2. The fixed cost of every turn

The setup sent on every call (Claude Code's prompt, MCP schemas, skill
descriptions, CLAUDE.md and rules, output style, plugin hooks): tokens per part,
its share of a turn, and a drafted cut.

- `2-1-lean-stacked-bar.html`: one stacked bar in the Lean tab, a row per part with its cut, and the total you'd get back.
- `2-2-receipt-in-footer.html`: each turn footer says how much of the turn was setup; opened, it itemises the parts with the cuts beside them.
- `2-3-checklist-wizard.html`: "Trim the setup" walks the six parts one at a time with a choice, the diff and a running total.

## 4. A cost estimate before expensive runs

Before an Ultracode run, a workflow or a fan-out: how much of the 5-hour window
it would take, where the window would end, and when it resets.

- `4-1-estimate-on-button.html`: the send button and a workflow's Run button carry the number; the hint line says where the window would end.
- `4-2-confirm-sheet.html`: a sheet steps in with the range, the landing point, the reset, and a cheaper (Sonnet helpers) and a smaller way.
- `4-3-live-meter.html`: the subbar's 5-hour meter grows a hatched projection as you type; hover for the range and the cheaper way.

## 5. One-tap fixes for repeated big reads

Files Claude keeps re-reading (`usage/hotfiles.js`) and commands with loud
output (`usage/loud.js`), each with a drafted deny rule or CLAUDE.md line, a
diff preview and Apply.

- `5-1-lean-rows-inline-fix.html`: rows in the Lean tab with how often, what it costs and the fix; a row opens to the diff and Apply.
- `5-2-weekly-digest-card.html`: a card on a new tab once a week with the week's re-reads and one-tap fixes.
- `5-3-nudge-after-read.html`: a card lands under the repeated read in the chat, mid-turn, with the rule drafted.

## 6. Start fresh with a summary

When a conversation is well filled and the topic changes, offer a fresh tab that
carries an editable summary instead of the whole thread, with the tokens saved
per message.

- `6-1-banner-above-composer.html`: a banner in the slot above the box with the numbers and a small editable summary.
- `6-2-divider-at-topic-change.html`: a dashed line in the feed where the subject turned, carrying the offer and the summary; the new message goes with it.
- `6-3-tab-action-side-sheet.html`: a "fresh" action on the full tab opens a side sheet with the whole summary to edit, what goes with it, and what stays.
