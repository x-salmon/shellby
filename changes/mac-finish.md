### Fixed

- On an Apple silicon Mac, Local model setup counts the memory its GPU shares, so a 16 GB or bigger Mac is offered a coding model instead of being told it runs on the CPU.
- On a Mac, a dev server whose port is taken names the program holding it and offers to stop it, as on Windows. AirPlay Receiver, the usual holder of :5000, is never offered.
