### Fixed
- **Bugs in the Bugdex get caught now.** A bug that failed in one test file is caught when your whole test suite passes on the fix, and a script that failed is caught when it runs clean again with different arguments. Before, only the exact same command passing again counted, and Claude almost never runs that.
- **No more bugs stuck on the loose.** Claude's own scratch commands (`node -e`, `python -c`, temp scripts) no longer turn up as bugs. A bug that passes on the very same code, or whose conversation you close, now goes at once instead of waiting a day.
