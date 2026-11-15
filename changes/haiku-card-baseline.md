### Fixed

- The Haiku card shows up in your chats again: it counts only what the chat itself has added, not the instructions and tools every chat starts with.
- The "start fresh" line shows up in long chats: it used to wait until 60% of the context window was full, which a 1M window almost never reaches. It now also comes once the chat itself has added 60,000 tokens.
