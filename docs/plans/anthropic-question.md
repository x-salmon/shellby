# Asking Anthropic about plan use

Not sent. Send it as yourself, through the
[contact form](https://www.anthropic.com/contact-sales?utm_source=claude_code&utm_medium=docs&utm_content=legal_compliance_contact_sales)
the Claude Code legal page names for questions about permitted authentication. Put
the answer, dated, in "Is it allowed?" in `docs/WHY-SHELLBY.md`.

> I make Shellby (https://github.com/x-salmon/shellby), a free, open-source Windows
> desktop app. It starts the unmodified Claude Code CLI that the user installed
> themselves, on their own PC, and talks to it over stream-json (`claude -p`). Sign-in
> is Claude Code's own (`claude auth login`); Shellby never sees, stores or relays
> Claude.ai credentials. Users can use an Anthropic API key instead. It isn't hosted, resells
> nothing and has no accounts.
>
> 1. May an individual use their own Pro or Max sign-in with Claude Code when a local
>    app like this starts it?
> 2. Shellby has a Sign in button that starts `claude auth login`, which opens
>    Anthropic's page in the browser. Is that acceptable, or should users run it
>    in a terminal themselves?
> 3. It can queue tasks to start after the user's own limit resets, run scheduled
>    tasks, and, when the user presses a button, send one short message an hour for up to
>    three hours to keep a conversation's prompt cache warm. Is any of that outside
>    "ordinary, individual usage"?
> 4. Is there wording you'd like used, or avoided, when describing this to users?
