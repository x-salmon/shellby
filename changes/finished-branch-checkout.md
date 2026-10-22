### Fixed

- A checkout left on a branch that's already all in main no longer pulls every new conversation onto it. When the next one moves into its own copy, Shellby switches your checkout to main first (the old branch stays), so the copy starts from main and comes home there. If your checkout has uncommitted changes, or main is open in another copy, it stays where it is, and the conversation says why.
