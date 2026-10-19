### Fixed
- **A message sent right after Stop runs.** Sending one within a few seconds of pressing Stop could end it with "Claude Code stopped partway through that turn", and you had to send it again. Stop now only ever ends the turn you stopped.
