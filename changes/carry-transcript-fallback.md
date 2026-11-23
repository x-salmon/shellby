### Fixed
- **A conversation picked up from another folder moves into its own copy again.** Shellby used to look for Claude Code's record of it only under the folder the tab was in, missed it, and left the conversation working in your checkout. It now finds the record wherever Claude Code wrote it, and when a move still fails, Copy details says which conversation and folders it was.
