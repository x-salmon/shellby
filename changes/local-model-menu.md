### New
- **Local models have their own place in the model menu.** Under "On this PC", pick any model your local server has for a new conversation, without turning on "Run new conversations on a local model" in Settings. Picking a Claude model there puts a new conversation back on Claude.

### Fixed
- **Turning local conversations off works for tabs already open.** An empty conversation opened while the setting was on still started on the local model. It now checks the setting when you send its first message.
- **"Default" names a Claude model again.** After a local conversation, the menu's Default could read "Default (qwen3…)". It now only ever shows the Claude model your plan picks.
