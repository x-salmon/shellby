### New

- A dev server you started in a terminal shows on its project's page too, found by the port it listens on and matched to the clone on its command line. Its card says it's not Shellby's and has no log, with Open, Stop (after Shellby's own confirm window, and only the process it just listed) and "Run it in Shellby instead", which stops it and starts the same script here so the next crash has a log to send.
- A dev server that's still up but whose last build broke (Failed to compile, a Vite internal error, a TypeScript error, a missing module) now says "build error" on its card and in the command palette, in amber, until the next good build. No toast and no sign on the crab: it's still serving.
