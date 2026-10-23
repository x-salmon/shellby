### New

- When the API is busy or rate limited and Claude Code tries a request again, the working line says so, with the attempt and how long until the next try, instead of sitting on "Working…".
- A hook that fails or is cancelled leaves a note in the conversation naming it, with its exit code and what it printed, so Claude changing course has a reason you can see.
- That covers every hook, including the ones that check a tool before it runs: Shellby now asks Claude Code to report how each hook went.
