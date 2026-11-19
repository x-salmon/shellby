### New

- A local conversation can give its helper crabs and its quick tasks (titles, summaries, small checks) their own models, under Settings → Local model. Left as "Same as main", they run on the main model as before.
- Local model in Settings has a Local mode switch: Off, Coding, Chat or Custom. Coding and Chat pick a model for every job from what's installed, and name any that are missing.
- When a Local mode preset names a model you don't have, Settings offers to get it, with its size, a progress bar and Stop. It checks for free disk space first, and a stopped download picks up where it left off.
- Local model in Settings now helps you get set up: with no Ollama it recommends models for this PC and installs Ollama with winget (after you confirm), starts it if it isn't running, updates one too old for local conversations, and gets the recommended models in one press.
- Each local model in use shows how it suits this PC: fits in the GPU, partly in RAM, or too big. One with a short context (under the 32K tokens Claude Code needs) gets Make a 32K copy, which makes a copy that starts with enough and picks it.
- A local conversation's model menu has Continue on Claude: a new Claude conversation, drafted for you to send, that reads the local one's record and carries on. The local one stays as it was.
- The crab's right-click menu has Local mode: Off, Coding or Chat, without opening Settings.
- A local conversation loads its quick model next to the main one as it starts, so titles and small checks don't push the big model out of memory.
- Each turn of a local conversation says which model did it, in the footer under it.
- Shellby says when a model download starts and when it's in.
- The short-context chip takes OLLAMA_CONTEXT_LENGTH into account for models that don't set their own.
