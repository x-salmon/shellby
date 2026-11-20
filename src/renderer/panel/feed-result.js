/* Shellby panel — a turn's end. Part of Tab (feed.js): the steps still pending
   are closed, each helper's cost lands on its lane, the footer goes under it
   (feed-foot.js), then what the turn was refused by a rule or a hook, with Try
   again (counting down to pressing itself when none of your rules blocked it)
   and Show rule, and the notes under the cost with their one-tap buttons. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const F = window.ShellbyFeedLogic;

  class TurnResult {
    renderResult(item, replay = false) {
      const tab = /** @type {any} */ (this);
      for (const el of tab.tools.values()) if (el.classList.contains('pending')) el.classList.replace('pending', item.ok ? 'ok' : 'err');
      // Each helper's part goes on its own lane (turncost.js helperCosts).
      for (const c of item.cost?.helpers || []) tab.lanes.get(c.id)?.setCost(c);
      tab.append(tab.turnFoot(item, replay));
      // What the turn was refused by a rule or a hook (feed-logic.js denialsLine): one quiet line.
      // Live, it carries what to do about it (deniedStrip); a reopened conversation keeps just the words.
      if (item.denials?.length) tab.append(replay ? tab.deniedLine(item.denials) : tab.deniedStrip(item.denials));
      // A warm cache it missed, helpers that outspent it, pictures piling up (turncost.js turnNotes).
      // A reopened conversation's old notes keep their words but not their buttons:
      // a fresh start offered before an earlier one would throw away this one.
      for (const n of item.cost?.notes || []) tab.append(h('div', { class: `turn-note is-${n.kind}`, role: 'note' }, h('span', { text: n.text }), replay ? null : tab.noteAction(n.action, n)));
      // A turn whose process went (main's session/index.js ended()): its error block is just above.
      if (!item.ok && !item.interrupted && item.error && !item.crashed) tab.append(tab.troubleBlock(item.trouble, item.error));
      // ...and its helpers went with it.
      if (item.interrupted || item.crashed) for (const lane of tab.lanes.values()) if (lane.status === 'running') lane.finish({ ok: false, stopped: true });
    }

    deniedLine(denials) {
      return h('div', { class: 'turn-denials', role: 'note', title: 'Tool calls Claude Code refused this turn: a permission rule or a hook.', text: F.denialsLine(denials) });
    }

    // What the turn was refused, with Try again (a hook that's since let go,
    // like the move into a copy), Show rule (when one of your deny rules did it:
    // trying again would only be refused again) and Fine (back to the quiet line).
    deniedStrip(denials) {
      const tab = /** @type {any} */ (this);
      const retry = () => {
        if (tab.busy) return SB.toast('Let him finish first.');
        SB.activate(tab.id);
        SB.send(F.retryPrompt(denials));
        strip.replaceWith(tab.deniedLine(denials));
      };
      const tryBtn = h('button', { class: 'btn slim-btn denied-try', type: 'button', title: 'Ask Claude to try the blocked step again', onclick: retry },
        h('span', { text: 'Try again' }));
      const fine = h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: () => strip.replaceWith(tab.deniedLine(denials)) }, 'Fine');
      const acts = h('span', { class: 'denied-acts' }, tryBtn, fine);
      const strip = h('div', { class: 'turn-denied', role: 'note' },
        h('span', { class: 'denied-text', text: F.denialsLine(denials) }), acts);
      // Your rules are read for the project on screen, so only this tab's own can be checked.
      if (tab.isActive) tab.findBlockingRule(denials).then(found => {
        if (!strip.isConnected) return;
        // Nothing of yours blocked it, so it may well go through now: count down to trying again.
        if (!found) return tab.retryCountdown(strip, tryBtn, fine, retry, F.retryPrompt(denials));
        // Every one a rule blocked: trying again would just be refused again.
        if (found.all) tryBtn.remove();
        acts.prepend(h('button', { class: 'btn slim-btn', type: 'button', title: found.rule.rule, onclick: () => SB.showRule?.(found.rule) }, 'Show rule'));
      });
      return strip;
    }

    // Try again fills with coral and presses itself (RETRY_COUNTDOWN_MS). Hover, focus or a
    // hidden panel holds it; Cancel restores the quiet line; busy or another tab stops it.
    // The same block twice running is a hook that means it: no second countdown (a loop).
    retryCountdown(strip, tryBtn, fine, retry, prompt) {
      const tab = /** @type {any} */ (this);
      if (tab.busy || tab.autoRetried === prompt) return;
      const fill = h('span', { class: 'denied-fill', 'aria-hidden': 'true' });
      const secs = h('span', { class: 'denied-secs', 'aria-hidden': 'true' });
      let left = F.RETRY_COUNTDOWN_MS, last = performance.now();
      const show = () => { secs.textContent = `${F.countdownSecs(left)}s`; };
      const stop = () => {
        clearInterval(timer);
        fill.remove();
        secs.remove();
        strip.classList.remove('counting', 'held');
        fine.textContent = 'Fine';
        tryBtn.title = 'Ask Claude to try the blocked step again';
      };
      const timer = setInterval(() => {
        const now = performance.now();
        const step = now - last; last = now;
        if (!strip.isConnected) return clearInterval(timer);
        if (tab.busy || !tab.isActive) return stop();
        const held = document.hidden || strip.matches(':hover, :focus-within');
        strip.classList.toggle('held', held);
        if (held) return;
        left -= step;
        show();
        if (left <= 0) {
          clearInterval(timer);
          tab.autoRetried = prompt;
          retry();
        }
      }, 250);
      tryBtn.prepend(fill); tryBtn.append(secs);
      tryBtn.title = 'Claude tries the blocked step again by itself when this fills up. Point at it to hold.';
      fine.textContent = 'Cancel';
      strip.style.setProperty('--retry-ms', `${F.RETRY_COUNTDOWN_MS}ms`);
      strip.classList.add('counting');
      show();
    }

    // The first of your deny rules that blocked one of these, and whether rules blocked them all.
    async findBlockingRule(denials) {
      const setup = await api.getClaudeSetup().catch(() => null);
      const perms = setup?.permissions;
      if (!perms?.rules?.length) return null;
      const dir = scope => perms.files.find(f => f.scope === scope)?.path.replace(/[\\/]\.claude[\\/][^\\/]+$/, '') || '';
      const where = { home: dir('user'), cwd: dir('project') };
      const hits = denials.map(d => F.blockingRule(d, perms.rules, where));
      const rule = hits.find(Boolean);
      return rule ? { rule, all: hits.every(Boolean) } : null;
    }

    // The button on a note under a turn's cost, or null: helpers on Sonnet until
    // a helpers' model is chosen (Settings → Claude Code → Model), a fresh start, or a compact.
    noteAction(action, note = {}) {
      const tab = /** @type {any} */ (this);
      if (action === 'helper-model' && !state.settings?.helperModel) {
        return h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'Helpers that name no model of their own run on Sonnet in new conversations. Change it in Settings → Claude Code → Model.',
          onclick: async e => {
            const r = await api.setSettings({ helperModel: 'sonnet' }).catch(() => null);
            if (!r?.settings) return SB.toast("Couldn't change that.");
            state.settings = r.settings;
            e.target.remove();
            SB.toast('New conversations run their helpers on Sonnet.');
          } }, 'Run helpers on Sonnet');
      }
      if (action === 'fresh') return h('button', { class: 'btn ghost slim-btn', type: 'button', onclick: () => SB.startFresh(tab) }, 'Start fresh with a summary');
      if (action === 'default-style' && state.settings?.outputStyle) {
        return h('button', { class: 'btn ghost slim-btn', type: 'button', title: 'New conversations use the Default output style. Change it in Settings → Claude Code.',
          onclick: async e => {
            const r = await api.setSettings({ outputStyle: '' }).catch(() => null);
            if (!r?.settings) return SB.toast("Couldn't change that.");
            state.settings = r.settings;
            e.target.remove();
            SB.toast('New conversations use the Default style.');
          } }, 'Use the Default style');
      }
      if (action === 'compact') return h('button', { class: 'btn ghost slim-btn', type: 'button', title: note.focus ? `Sends /compact ${note.focus}` : null, onclick: () => SB.compactTab(tab, note.focus || '') }, 'Compact now');
      return null;
    }
  }
  SB.extendTab(TurnResult);
})();
