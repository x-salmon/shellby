# Local mode: the right local model for each part of the work

Not built. Mockups: [local-mode-mockups.html](local-mode-mockups.html) (open it
in a browser; it uses Shellby's own tokens).

## Why

Settings → Local model already sends small drafts, declined questions and whole
conversations to Ollama or LM Studio. Each of those takes one model, and a
local conversation maps every name Claude Code asks for (main, opus, sonnet,
haiku, subagents) to that one model (`local/agent.js`, `ALIAS_VARS`). So a
title or a one-line check runs on the 30B coder, and the user wires five
pickers by hand, installs models in a terminal, and finds out the context is
too short only when the conversation goes wrong.

Local mode makes running locally something you switch on, not assemble:

1. **Roles**: main work, helper crabs and quick tasks each get a model.
2. **Presets**: Off / Coding / Chat / Custom fill every picker at once.
3. **Get models**: missing models download from Settings, with progress, after a size and disk check.
4. **Fit check**: each model is shown against this PC's GPU (all in VRAM, partly in RAM, too big) and its context length.
5. **Switch to Claude**: a local conversation can continue on Claude in one press.

Not in scope, on purpose: a router that picks a model for each step (12 GB of
VRAM holds one big model, so every switch costs a 5–15 s load; see the
discussion in the session that wrote this), several models running in
parallel, and remote or cloud "local" servers (loopback only stays the rule).

## 0. Getting set up (no Ollama, or no models yet)

Most users open Local model with nothing installed. Today they get a Server
field, Detect, and a hidden "Let Claude set it up" that spends their plan on
an install. Local mode replaces that with a short guided path, driven by what
the PC actually has.

**What Shellby checks when the section opens** (`local/setup.js`, all read-only):

| Check | How |
|---|---|
| Ollama installed? | `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, then `where ollama` |
| Running? | `GET 127.0.0.1:11434/api/version` (also gives the version: roles need 0.14+) |
| LM Studio? | `127.0.0.1:1234/v1/models` (Detect does this today) |
| Models | `/api/tags` |
| Hardware | GPU name and VRAM, RAM, free disk (the fit check's reader, section 4) |

**The four states**, each one card at the top of the section:

1. **Nothing installed.** "Run models on this PC, free and private." It shows a
   recommendation for this PC (below) and **Install Ollama**. That runs
   `winget install --id Ollama.Ollama -e --accept-source-agreements`
   after a confirm dialog that names the publisher and size. With no winget
   (old Windows 10), the button opens `ollama.com/download` instead. Shellby
   never downloads or runs an installer itself: winget checks the hash and the
   signature. The progress shows on the card and on the crab. "Let Claude set it
   up" stays as a fallback link, labelled as using your plan.
2. **Installed, not running.** **Start Ollama** launches `ollama.exe` (the
   tray app, which starts the server), then polls `/api/version` for up to 20 s.
3. **Running, no suitable models.** The recommendation card with **Get these**
   (section 3's pull, for two models in a row: quick first so something works
   in minutes, then main).
4. **Ready.** The card goes away and the preset control takes over. A bad
   version (< 0.14) shows "Update Ollama" (the same winget, `upgrade`).

LM Studio users skip 1–3: if it answers, Shellby uses it and the pull buttons
link to its model page instead.

**Recommendations** are a pure function, `recommend(hw)` in `presets.js`, of
VRAM, RAM and disk. It returns a main and a quick model with sizes and a
one-line reason:

| This PC | Main | Quick | Note |
|---|---|---|---|
| No usable GPU, < 16 GB RAM | — | `qwen3:4b` | Drafts only; conversations not offered |
| No GPU or < 6 GB VRAM, ≥ 16 GB RAM | `qwen3:30b-a3b` | `qwen3:4b` | Slow but usable: MoE on the CPU |
| 6–10 GB VRAM | `qwen3-coder:30b` (≥ 32 GB RAM) else `qwen2.5-coder:7b` | `qwen3:4b` | |
| 12–16 GB VRAM | `qwen3-coder:30b` | `qwen3:4b` | This PC (3080 Ti, 32 GB) |
| 24 GB+ VRAM | `qwen3-coder:30b`, fully on GPU | `qwen3:4b` | Mentions room for a bigger one |
| Disk < size + 10 GB | the next smaller pick | | Says why |

- AMD and Intel GPUs: VRAM from WMI is capped at 4 GB, so for them the table
  uses RAM tiers and says "your GPU may manage more". This is honest guessing, not
  a promise.
- The table lives in one data file with a `checked` date. Model releases
  change it, and a test fails when the date is over 6 months old, so it gets
  looked at.
- Users who already have models: anything installed that's on the table is
  marked "Good pick". Anything that fails the fit check gets its chip. Shellby
  never removes models.

**First-run nudge:** none in the feed. The only way in is the local model
section, plus one line in onboarding's "save your plan" step that links there.
Installing 18 GB is the user's decision, never a default.

## 1. Roles

Claude Code already splits a conversation's calls by name, so a role is just
which model a name maps to:

| Role | Env vars | Default |
|---|---|---|
| Main work | `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` | the agent model |
| Helper crabs | `CLAUDE_CODE_SUBAGENT_MODEL` | same as main |
| Quick tasks | `ANTHROPIC_DEFAULT_HAIKU_MODEL` (titles, summaries, small checks) | same as main |

- Settings: `localModel.agent` grows from `{ on, model }` to
  `{ on, model, helpers, quick, keepQuick }`. `cleanAgent` cleans every field
  with `modelName`; an empty role means "same as main", so saved settings from
  today read exactly as before.
- `agentTarget` returns `{ url, model, helpers, quick }`; `envFor` maps each
  variable from its role. `cleanTarget` (History) takes the same shape and
  still accepts the old `{ url, model }`, so a reopened conversation keeps
  every model it started with.
- **Keep the quick model loaded** (on by default when quick ≠ main): when a
  local conversation starts, main sends Ollama one empty
  `/api/generate { model, keep_alive: '30m' }` for the quick model, so its
  calls don't evict the big one. It only works with `OLLAMA_MAX_LOADED_MODELS`
  ≥ 2, which Ollama's default allows on a GPU with room; the fit check (4)
  says when there isn't room for both, and the toggle is disabled then.
  LM Studio: skipped (it manages loading itself); the toggle is hidden.
- The feed shows the role in each local turn's footer (`qwen3-coder:30b`;
  helper crabs show their own), so the user sees which model did what.

## 2. Presets

One segmented control at the top of Local model: **Off / Coding / Chat / Custom**.

- A preset is data in `src/main/local/presets.js`: for each role and each
  draft job, an ordered list of acceptable models
  (`['qwen3-coder:30b', 'devstral', 'gpt-oss:20b']`). Applying it picks the
  first one installed for each slot and marks the slots with nothing installed.
- Coding: main `qwen3-coder:30b`, helpers same, quick `qwen3:4b`, drafts on
  the quick model, quiz on main. Chat: `gpt-oss:20b` everywhere, quick
  `qwen3:4b`. The lists are short and ordered by fit for 8–16 GB GPUs; bigger
  GPUs get the same picks (the fit check shows when something larger would fit).
- Changing any picker by hand switches the control to Custom; nothing is lost.
  Off turns off drafts, answers and agent together (each keeps its models).
- The crab's right-click menu gets **Local mode ›** with the same four, for
  switching without opening Settings. New conversations only, as now.
- Presets are versioned (`PRESETS_VERSION`) so a later release can change the
  lists without touching a user's Custom setup.

## 3. Get models

When a preset names a model that isn't installed, its row says
**Get qwen3-coder:30b · 18 GB** instead of a picker.

- Ollama only: `POST /api/pull { model, stream: true }` from main, read as
  NDJSON (`status`, `completed`, `total`), shown as a bar in the row and on
  the crab (he carries a box, like other long jobs). Cancel aborts the fetch;
  Ollama keeps partial layers and resumes next time.
- Before it starts: the size comes from a table in `presets.js` (Ollama has
  no size query before pulling) and the free space from the drive Ollama
  stores models on (`OLLAMA_MODELS`, or `%USERPROFILE%\.ollama\models`). Too
  little space: the button says so and doesn't start.
- Only names from the preset table can be pulled from this button (the IPC
  handler checks), so the renderer can't make main download arbitrary models.
  Other models: "Let Claude set it up", which already exists.
- LM Studio: the row links to LM Studio's model page instead (`lms get` exists,
  but its CLI isn't always on PATH; not worth guessing).
- One pull at a time; closing Shellby cancels it.

## 4. Fit check

Next to each picked model: a small chip, with details on hover/focus.

- **Fits in GPU** (glass): the model's size is under free VRAM.
- **Partly in RAM** (sand): under VRAM + half of RAM; slower but fine for MoE models.
- **Too big** (coral): more than that; "expect 2–5 words a second".
- **Short context** (coral, separate): its context is under 32K tokens,
  which Claude Code needs. One press: **Make a 32K copy**, which creates
  `<model>-32k` with Ollama's `/api/create` (`from` + `parameters: { num_ctx: 32768 }`)
  and picks it. Today this is only a sentence in the help text.
- Sizes: Ollama's `/api/tags` (size) and `/api/show` (`model_info.*.context_length`,
  `parameters` for `num_ctx`). VRAM: `nvidia-smi --query-gpu=memory.total,memory.used`
  when present, else WMI's `AdapterRAM` (capped at 4 GB by Windows, so shown as
  "at least"). Health already reads the GPU (`docs/HEALTH.md`); reuse that reader.
- Read when Settings opens and after a pull, cached for the session. Never
  blocks saving: a chip is advice.

## 5. Switch to Claude

A local conversation's header gets **Continue on Claude**.

- It branches the conversation (the existing branch path) onto Claude with a
  first message summarising where it was; the local one stays in History as it
  was. Not automatic: deciding a local model is "stuck" is unreliable, and
  spending the plan is the user's call.
- Shown only when the plan isn't at its limit; at the limit it says so.

## Files

| Where | What |
|---|---|
| `src/main/local/agent.js` | roles in `cleanAgent`, `agentTarget`, `cleanTarget`, `envFor` |
| `src/main/local/presets.js` (new) | preset tables, sizes, `applyPreset(settings, installed)` (pure) |
| `src/main/local/ollama.js` (new) | pull (streamed, capped, abortable), create 32K copy, show, keep-alive; loopback only, reusing `baseUrl` |
| `src/main/local/fit.js` (new) | pure: sizes + VRAM/RAM → chip |
| `src/main/ipc/settings.js` | `local:preset`, `local:pull`, `local:pull-cancel`, `local:fit`, `local:ctx-copy`, each with a schema in `ipc-args.js` |
| `src/main/config.js` | new `localModel.agent` fields and `localModel.preset` defaults |
| `src/renderer/panel/html/settings-claude.html` | the preset control and role rows; then `npm run panel:html` |
| `src/renderer/panel/settings-local.js` (305 lines) | split: `settings-local-roles.js` for roles, presets and pulls |
| crab menu, conversation header, turn footer | Local mode menu, Continue on Claude, model name |
| `changes/local-mode.md` | the note for the CHANGELOG |
| `docs/LOCAL.md` (new) | what each role does, which models, the fit chips |

## Security and privacy

- Every request still goes through `baseUrl` (loopback only) and the proxy
  check; pulls are the only new outbound traffic and Ollama does those, not
  Shellby.
- Installing Ollama runs one fixed winget command (no user text in it) through
  `execFile`, never a shell, and only after the confirm dialog. Starting it runs
  only the fixed path checked above.
- Pull names: preset table only. Create: name is `modelName(base) + '-32k'`.
- Replies stay capped (`MAX_REPLY_BYTES`); the pull stream is read line by
  line with a cap per line, and stops on a malformed line.
- Run the security-reviewer agent over the IPC handlers and `ollama.js`.

## Tests

- **Unit (node:test)**: `cleanAgent`/`cleanTarget` with old and new shapes;
  `envFor` per role and with roles empty; `applyPreset` with all/some/none
  installed; fit chips at the edges; pull stream parsing (progress, error
  line, oversized line, abort); IPC schemas reject unknown names.
- **Fake server**: extend the test Ollama stub with `/api/pull` (streams
  progress), `/api/show`, `/api/create`, `/api/ps`.
- **e2e** (`e2e-local-mode`): pick Coding with one model missing → the row
  offers Get → pull against the stub → the picker fills → start a conversation
  → the fake CLI sees the three env vars. Counts come from `presets.js`.
- Layout checked at 460×700 and 2560×1440.

## Order

0. Setup states and recommendations (`setup.js`, `recommend()`), with Install/Start Ollama.
1. Roles (backend + three pickers). Useful alone; smallest change.
2. Fit check and the 32K copy: fixes the commonest local failure.
3. Presets and Get models.
4. Continue on Claude, the crab menu, the turn footer.

Each step is its own branch and `changes/` note.
