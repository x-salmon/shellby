### New

- **Flaky tests spotted outside Shellby too.** With the Shellby plugin, a test Claude Code runs in a terminal or VS Code counts the same as one in Shellby's tabs: a fail and then a pass on the same code is a flake, and lands on the Projects page. The hook hands over test names and a hash of the command, never the output.
- **A workflow can start when a test flakes.** The new **When a test flakes** trigger, for one project or any, gives the steps the test's name, its project and folder, and how often it flaked this week.
