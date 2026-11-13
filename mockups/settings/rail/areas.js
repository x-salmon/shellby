// The nine areas down the rail. The settings themselves come from
// ../point-at-him/settings-data.js, so both prototypes hold the same 170; this
// file only says which of its groups each rail area shows, and in what order.
(function (PAH) {
  'use strict';

  // [where the group lives in settings-data.js, its title there, its title here]
  const g = (from, title, as = title) => ({ from, title, as });

  const AREAS = [
    { key: 'look', name: 'Look', title: 'How he looks and acts', what: 'Skin and size, moving about, talking, sound and mischief', groups: [
      g('shell', 'Look', 'His look'), g('legs', 'Moving around'), g('legs', 'Company'), g('body', 'Talking'), g('body', 'Sound'),
      g('body', 'Mischief'), g('eyes', 'Listening along'), g('eyes', 'Typing along'), g('eyes', 'The weather outside'),
    ] },
    { key: 'games', name: 'Games', title: 'Games and rewards', what: 'Bugdex, battles, tide events and what you earn', groups: [
      g('jar', 'Bugdex'), g('jar', 'Events'), g('jar', 'Rewards'),
    ] },
    { key: 'claude', name: 'Claude', title: 'Claude', what: 'Account, mode, what it may do and which model', groups: [
      g('claw', 'Claude Code', 'Account and mode'), g('body', 'Work mode'), g('claw', 'How much can Shellby do'),
      g('claw', 'What Claude knows'), g('claw', 'Model'), g('claw', 'Local model'),
    ] },
    { key: 'code', name: 'Code', title: 'Your code', what: 'Folders, copies, tests, dev servers and pull requests', groups: [
      g('bucket', 'Working folder'), g('bucket', 'Copies of a project'), g('bucket', "Checking Claude's work"),
      g('bucket', 'Dev servers'), g('bucket', 'Editor'), g('buoy', 'Work with your code', 'On GitHub'),
    ] },
    { key: 'limits', name: 'Limits', title: 'Your limits', what: 'The 5-hour window and what Shellby may spend of it', groups: [
      g('claw', 'Your 5-hour limit'),
    ] },
    { key: 'alerts', name: 'Alerts', title: 'Alerts', what: 'On this PC, on your phone, and while you are away', groups: [
      g('bottle', 'On this PC'), g('bottle', "Tell me when I'm away"), g('bottle', 'Shellby on your phone'),
    ] },
    { key: 'apps', name: 'Apps', title: 'Other apps', what: 'Discord, OBS, Stream Deck, lights and your terminal', groups: [
      g('shell', 'On your Discord profile', 'Discord'), g('shell', 'On a stream', 'OBS'), g('shell', 'Stream Deck'),
      g('shell', 'Desk lighting'), g('bucket', 'Claude Code in your terminal'),
    ] },
    { key: 'accounts', name: 'Accounts', title: 'Accounts', what: 'GitHub, friends, GitLab and other computers', groups: [
      g('buoy', 'GitHub'), g('buoy', 'Show off your crab'), g('buoy', 'GitLab'), g('buoy', 'Other computers'),
    ] },
    { key: 'system', name: 'System', title: 'System', what: 'Startup, shortcuts, screens, updates and about', groups: [
      g('sign', 'System', 'Startup'), g('sign', 'Shortcuts'), g('sign', 'Screens'), g('sign', 'Updates'), g('sign', 'About'),
    ] },
  ];

  // Fail loudly if a group is missing, misspelt or shown twice: every setting
  // has to be somewhere on the rail.
  const used = new Map();
  for (const a of AREAS) {
    for (const grp of a.groups) {
      const src = PAH.SCHEMA[grp.from]?.find(s => s.title === grp.title);
      if (!src) throw new Error(`Rail: no group "${grp.title}" in ${grp.from}`);
      const k = `${grp.from}/${grp.title}`;
      if (used.has(k)) throw new Error(`Rail: "${k}" is in ${used.get(k)} and ${a.key}`);
      used.set(k, a.key);
      grp.items = src.items.filter(it => !it.preview); // previews only make sense on the beach
    }
  }
  const missing = Object.entries(PAH.SCHEMA).flatMap(([from, gs]) => gs.map(s => `${from}/${s.title}`)).filter(k => !used.has(k));
  if (missing.length) throw new Error(`Rail: groups on no area: ${missing.join(', ')}`);

  // Pixel icons: # is the line colour, o the accent. "him" is drawn from his skin instead.
  const ICONS = {
    look: 'him',
    games: ['..#####..', '..#...#..', '.#######.', '.#.....#.', '.#..o..#.', '.#.ooo.#.', '.#..o..#.', '.#.....#.', '.#######.'],
    claude: ['....#....', '....#....', '.#..#..#.', '..#.#.#..', '####o####', '..#.#.#..', '.#..#..#.', '....#....', '....#....'],
    code: ['......o....', '..#...o.#..', '.#...o...#.', '#....o....#', '.#...o...#.', '..#.o...#..', '....o......'],
    limits: ['#########', '.#.....#.', '..#ooo#..', '...#o#...', '....#....', '...#.#...', '..#...#..', '.#.ooo.#.', '#########'],
    alerts: ['....#....', '...###...', '..#...#..', '..#...#..', '..#...#..', '.#.....#.', '#########', '.........', '....o....'],
    apps: ['####.oooo', '#..#.o..o', '#..#.o..o', '####.oooo', '.........', '####.####', '#..#.#..#', '#..#.#..#', '####.####'],
    accounts: ['...###...', '..#...#..', '..#...#..', '...###...', '.........', '..#####..', '.#.....#.', '#.......#', '#########'],
    system: ['....#....', '.#.###.#.', '..#...#..', '.#..o..#.', '##.ooo.##', '.#..o..#.', '..#...#..', '.#.###.#.', '....#....'],
  };

  PAH.RAIL = Object.freeze(AREAS);
  PAH.RAIL_ICONS = Object.freeze(ICONS);
  PAH.RAIL_ITEMS = Object.freeze(AREAS.flatMap(a => a.groups.flatMap(grp => grp.items.map(it => ({ ...it, rail: a.key, group: grp.as })))));
})(window.PAH);
