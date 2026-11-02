### New
- **Wrapped names your biggest reef improvement.** The reef slide now says which signal moved furthest for its size that year, in which project ("Line coverage 61.5% → 78% in shellby"). Only the last 60 readings of each signal are kept, so it reads the end of the year.
- **Wrapped counts your tide-out days.** The "tide-out days used, and the streak held" line was always missing. It's there now, past days included, and each one counts in the year it held your streak.
- **The Time page says when other PCs' hours run out.** Each PC sends only its newest hours, up to 24 KB. If the period you're looking at starts before those do, the page says what's left out, so a timesheet for an older month doesn't come up short without a word.

### Fixed
- **Syncing your hours no longer overwrites a client's rate.** Two projects on one PC with the same folder name (`acme\api` and `beta\api`) could end up with one project's name, client, rate and "don't track" setting on both. Each now keeps its own. A rate already overwritten needs setting again on the Time page.
- **Shipping again keeps the pull request honest.** Shipping new work from the same copy left the old commits, files and checks in the description, so it could still say the checks passed after you shipped past failing ones. They now update each time. The title, your summary and anything you added stay as they are, and if GitHub won't take the change the conversation says so.
- **Both PCs' notes reach the timesheet.** When two PCs left a note on the same project and day, only one showed. Now both do, each once.
- **"You've asked this before" sees past a long paste.** A log pasted into a conversation's first message could use up everything it read, hiding what you asked after it. Each message now gets its own share.
