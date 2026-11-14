// Every setting in today's Settings (src/renderer/panel/html/settings-*.html, plus
// the lists filled in code: notification events, permission modes, local drafts),
// sorted into the ten things you can point at.
// Fields: kw (other words people search with), preview (shows on him, isn't a
// setting), show (only while that returns true), say (what he says when it's
// turned on), help (fine print), reads (what it reads or sends).
(function (PAH) {
  'use strict';

  PAH.AREAS = Object.freeze({
    shell: { name: 'His shell', what: 'How he looks, here and elsewhere' },
    eyes: { name: 'His eyes', what: 'What he notices around you' },
    body: { name: 'His body', what: 'His mood, voice and mischief' },
    claw: { name: 'His claw', what: 'What Claude may do, and spend' },
    legs: { name: 'His legs', what: 'Where he goes' },
    bucket: { name: 'The bucket and spade', what: 'Your code and projects' },
    bottle: { name: 'The bottle', what: 'Messages to you and your phone' },
    jar: { name: 'The bug jar', what: 'Games and rewards' },
    buoy: { name: 'The buoy', what: 'Accounts and other computers' },
    sign: { name: 'The signpost', what: 'System, updates and about' },
  });

  PAH.GREETINGS = Object.freeze({
    shell: 'Like my shell?', eyes: "I'm watching.", body: "That's me!", claw: 'Snip snip.', legs: 'Six of them. I counted.',
    bucket: 'Dig in.', bottle: 'Messages go in there.', jar: 'My bugs!', buoy: 'Out past the reef…', sign: 'The sensible stuff.',
  });

  const on = id => st => !!st[id];
  const is = (id, v) => st => st[id] === v;
  const not = (id, v) => st => st[id] !== v;
  const both = (...fs) => st => fs.every(f => f(st));

  // The phone's events, from src/main/channels/messages.js (default on or off).
  const EVENTS = [
    ['asking', 'He needs permission', true], ['done', 'A task finished', true],
    ['limit', 'Usage limit reached, and when it resets', true], ['queue', 'A task you queued for the reset finished', true],
    ['health', 'Something is overheating or filling up', false], ['ci', 'A build goes red or green', false],
    ['workflow', 'A workflow sends you a message', true], ['claude', 'Claude asks to let you know something', true],
  ];
  const events = (prefix, show) => EVENTS.map(([id, label, def]) => ({ id: `${prefix}-${id}`, label, type: 'tog', def, show, kw: 'notification event' }));

  PAH.SCHEMA = Object.freeze({
    shell: [
      { title: 'Look', items: [
        { id: 'skin', label: 'Skin', type: 'skins', def: 'classic', kw: 'colour color theme paint look' },
        { id: 'size', label: 'Size', type: 'seg', options: ['Small', 'Medium', 'Large', 'Huge'], def: 'Medium', kw: 'big bigger small smaller scale' },
        { id: 'helpers', label: 'Helpers line up on his', help: 'The crabs that walk out when Claude sends helpers.', type: 'seg', options: ['Left', 'Right'], def: 'Right', kw: 'subagents agents side' },
        { id: 'findHim', label: 'Lost him off the screen?', type: 'button', text: 'Find Shellby', toast: 'He scuttles back to his corner.', kw: 'reset position missing' },
        { id: 'skinsFolder', label: 'Your own skins', help: 'Drop a skin in the folder, or paint one in the Painter.', type: 'actions', buttons: [['Open folder', 'Opened your skins folder.'], ['Reload', 'Skins reloaded.']] },
      ] },
      { title: 'On your Discord profile', items: [
        { id: 'discord', label: 'Show Shellby on my Discord profile', reads: 'his level and what he is up to, to the Discord app on this PC', type: 'tog', def: false, kw: 'discord status presence rich' },
        { id: 'discordTask', label: 'Say what the task is, by its title', help: 'Never in Work mode.', type: 'tog', def: false, show: on('discord') },
      ] },
      { title: 'On a stream', items: [
        { id: 'obs', label: 'Serve the overlay', help: 'A browser source on a clear background, on 127.0.0.1 only.', type: 'tog', def: false, kw: 'stream obs twitch overlay browser source' },
        { id: 'obsUrl', label: 'In OBS: + then Browser, and paste this', type: 'path', text: 'http://127.0.0.1:47811/overlay', button: 'Copy', toast: 'Copied the overlay address.', show: on('obs') },
      ] },
      { title: 'Stream Deck', items: [
        { id: 'deck', label: 'Answer from a Stream Deck', help: 'Keys for Allow, Deny, Stop, Bring it home and Ready to review. Needs Stream Deck 7.1 or newer.', type: 'tog', def: false, kw: 'elgato keys hardware' },
        { id: 'deckAdd', label: 'Then drag the keys you want from Shellby', type: 'button', text: 'Add the keys', toast: 'Stream Deck asks before it installs them.', show: on('deck') },
      ] },
      { title: 'Desk lighting', items: [
        { id: 'rgb', label: 'Follow his mood with my lighting', reads: 'nothing; it sets your lights through OpenRGB on this PC', type: 'tog', def: false, kw: 'openrgb lights keyboard fans rgb' },
        { id: 'rgbSetup', label: 'OpenRGB', type: 'actions', buttons: [['Install it for me', 'This would install OpenRGB.'], ['Find my devices', 'Found a keyboard and two fans.']], show: on('rgb') },
      ] },
    ],
    eyes: [
      { title: 'Listening along', items: [
        { id: 'music', label: "Notice what I'm listening to", reads: "what's playing, from Windows' media controls", type: 'tog', def: false, kw: 'music spotify song headphones audio', say: 'Ooh, good tune.' },
        { id: 'musicPhones', label: 'Put his headphones on while it plays', type: 'tog', def: true, show: on('music') },
        { id: 'musicRemark', label: 'Let him remark on it now and then', type: 'tog', def: false, show: on('music') },
      ] },
      { title: 'Typing along', items: [
        { id: 'typing', label: 'Tap along while I type', reads: "that a key was pressed, never which one", type: 'tog', def: false, kw: 'keyboard keys typing', say: "Type in the search box. I'll keep up." },
        { id: 'typingSpeed', label: 'Tell me how fast a burst was', type: 'tog', def: true, show: on('typing') },
      ] },
      { title: 'The weather outside', items: [
        { id: 'weather', label: 'Dress him for the weather', reads: "your town's rough position, to open-meteo.com every 30 minutes", type: 'tog', def: false, kw: 'rain snow sun forecast town', say: "What's it like out there?" },
        { id: 'town', label: 'Your town', type: 'text', def: '', placeholder: 'Type a town', button: 'Find', toast: 'Found it. He checks every 30 minutes.', show: on('weather') },
        { id: 'weatherRemark', label: 'Let him say so when the weather turns', type: 'tog', def: true, show: on('weather') },
        { id: 'sky', label: 'See it on him', type: 'seg', options: ['Clear', 'Rain', 'Snow', 'Sun'], def: 'Clear', preview: true, show: on('weather') },
      ] },
    ],
    body: [
      { title: 'Work mode', items: [
        { id: 'workMode', label: 'Work mode', help: 'Your tools first on the bar, and a quiet crab: no pals, pranks or climbing. Off, everything is as you left it.', type: 'tog', def: false, kw: 'focus quiet calm serious' },
      ] },
      { title: 'Talking', items: [
        { id: 'talk', label: 'How much he talks', help: 'Quiet: just a mark in his bubble. About work: done, failed or broken. Chatty: talks and plays more.', type: 'seg', options: ['Quiet', 'About work', 'Normal', 'Chatty'], def: 'Normal', kw: 'quiet quieter chatty speak silent bubble shut up' },
      ] },
      { title: 'Sound', items: [
        { id: 'chirp', label: 'Chirp when he speaks', type: 'tog', def: true, kw: 'sound quiet noise audio beep' },
        { id: 'steps', label: 'Footsteps, bumps and ta-das', type: 'tog', def: true, kw: 'sound noise quiet audio walking' },
        { id: 'background', label: 'Background', type: 'seg', options: ['Silence', 'Rolling surf', 'Rock pool'], def: 'Silence', kw: 'sound ambient music waves quiet audio' },
        { id: 'volume', label: 'Volume', help: 'He goes quiet during focus, calls and when the screen is locked.', type: 'seg', options: ['Soft', 'Normal', 'Loud'], def: 'Normal', kw: 'sound loud quiet quieter louder audio' },
      ] },
      { title: 'Mischief', items: [
        { id: 'mischief', label: 'How cheeky', help: "Never while you're clicking, on a call, gaming or presenting, or while a task runs.", type: 'seg', options: ['Off', 'Cheeky', 'Gremlin'], def: 'Off', kw: 'prank pranks goose trouble behave' },
        { id: 'pinch', label: 'Pinch the cursor when it hangs about near him', type: 'tog', def: true, show: not('mischief', 'Off') },
        { id: 'shove', label: "Shove the window he's sitting on, when you're not using it", type: 'tog', def: true, show: not('mischief', 'Off') },
        { id: 'prints', label: 'Leave sandy footprints where he walks', type: 'tog', def: true, show: not('mischief', 'Off') },
        { id: 'notes', label: 'Drag little notes onto your desktop', type: 'tog', def: false, show: not('mischief', 'Off') },
      ] },
    ],
    claw: [
      { title: 'Claude Code', items: [
        { id: 'appMode', label: 'Mode', help: 'Switch any time from here, Ctrl+K, or Mode in his right-click menu.', type: 'seg', options: ['Claude Code', 'Work mode', 'Just the crab'], def: 'Claude Code', kw: 'mode crab only' },
        { id: 'account', label: 'Signed in to Claude', help: 'Max plan', type: 'actions', buttons: [['Switch account', 'This would sign you out, then in again.'], ['Sign out', 'This would sign you out.']], kw: 'account login plan subscription' },
        { id: 'planOnly', label: 'Always use my Claude plan', help: 'If an API key or another provider is set on this PC, Claude Code bills that per token instead. This leaves them out.', type: 'tog', def: true, kw: 'billing api key bedrock vertex cost money' },
      ] },
      { title: 'How much can Shellby do', items: [
        { id: 'power', label: 'How much can Shellby do', type: 'choice', def: 'Ask first', kw: 'permission permissions autonomous allow ask yolo bypass auto plan smart', choices: [
          ['Ask first', 'Reads freely. Asks before editing files or running commands.'],
          ['Smart', "Claude Code's auto mode: a safety check approves routine steps and stops risky ones."],
          ['Auto-edit', 'Edits files on its own. Still asks before running commands.'],
          ['Plan only', 'Looks around and proposes a plan. Nothing changes until you approve it.'],
          ['Autonomous', 'Never asks. Can change or delete anything your Windows account can.'],
        ] },
      ] },
      { title: 'What Claude knows', items: [
        { id: 'selfAware', label: "Tell Claude it's running in Shellby", type: 'tog', def: true, kw: 'prompt context' },
        { id: 'suggest', label: 'Let Claude offer Shellby features', help: 'Offers show up as cards. Nothing happens unless you tap them.', type: 'tog', def: true, kw: 'suggestions offers cards' },
        { id: 'plainCards', label: 'Say what Claude is doing in plain words', help: 'Permission cards say what a step does and point out deletes, installs and anything that goes online.', type: 'tog', def: true, kw: 'explain permission cards' },
        { id: 'idleCompact', label: "Compact long conversations while they're idle", help: 'So your next message doesn\'t resend the whole conversation at full price.', type: 'tog', def: true, kw: 'compact cache tokens context' },
      ] },
      { title: 'Model', items: [
        { id: 'model', label: 'Model', help: 'Applies to new conversations.', type: 'select', options: ['Claude Code default', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.2'], def: 'Claude Code default', kw: 'opus sonnet haiku fable claude' },
        { id: 'fallback', label: "When it's busy", type: 'select', options: ['Wait and retry', 'Sonnet 5.5', 'Haiku 5.5'], def: 'Wait and retry', kw: 'overloaded fallback unavailable' },
        { id: 'helperModel', label: 'Helpers', help: 'Sonnet does helpers\' searching and reading for much less of your plan.', type: 'select', options: ['Same as the conversation', 'Sonnet 5.5', 'Haiku 5.5'], def: 'Same as the conversation', kw: 'subagents agents cheaper' },
        { id: 'style', label: 'Output style', type: 'select', options: ['Default', 'Explanatory', 'Learning'], def: 'Default', kw: 'explain teach' },
        { id: 'chrome', label: 'Let Claude use Chrome', reads: 'pages in your own Chrome, signed in as you', type: 'tog', def: false, kw: 'browser web extension' },
      ] },
      { title: 'Local model', items: [
        { id: 'local', label: 'Write small drafts with a local model first', reads: 'what a draft is about, to Ollama or LM Studio on this PC', type: 'tog', def: false, kw: 'ollama lm studio offline free local llm' },
        { id: 'localServer', label: 'Server', type: 'text', def: 'http://127.0.0.1:11434', placeholder: 'http://127.0.0.1:11434', button: 'Find models', toast: 'Found 3 models.', show: on('local') },
        { id: 'localModel', label: 'Model', type: 'select', options: ['qwen3-coder:30b', 'llama3.2:3b', 'gemma3:12b'], def: 'qwen3-coder:30b', show: on('local') },
        { id: 'local-rules', label: 'Wording of the rules Shellby learns', type: 'tog', def: true, show: on('local') },
        { id: 'local-routines', label: 'Routine drafts', type: 'tog', def: true, show: on('local') },
        { id: 'local-hooks', label: 'Hook drafts', type: 'tog', def: true, show: on('local') },
        { id: 'local-workflows', label: 'Workflow drafts', type: 'tog', def: true, show: on('local') },
        { id: 'local-quiz', label: 'Quiz me questions', type: 'tog', def: false, show: on('local') },
        { id: 'localAnswers', label: "Ask a local model when Claude won't answer", help: 'Only your question goes, only when you press the button.', type: 'tog', def: false, show: on('local') },
        { id: 'localAnswersModel', label: 'Ask this model', type: 'select', options: ['qwen3-coder:30b', 'llama3.2:3b', 'gemma3:12b'], def: 'llama3.2:3b', show: both(on('local'), on('localAnswers')) },
        { id: 'localAgent', label: 'Run new conversations on a local model', help: 'Every tool as usual, nothing spent from your plan. Smaller models make more mistakes.', type: 'tog', def: false, show: on('local') },
        { id: 'localAgentModel', label: 'Run them on', type: 'select', options: ['qwen3-coder:30b', 'llama3.2:3b', 'gemma3:12b'], def: 'qwen3-coder:30b', show: both(on('local'), on('localAgent')) },
        { id: 'localTry', label: 'Try it', type: 'text', def: '', placeholder: 'Ask it anything', button: 'Ask', toast: 'Answered on this PC, without your plan.', show: on('local') },
      ] },
      { title: 'Your 5-hour limit', items: [
        { id: 'forecast', label: "Warn me when I'm on pace to hit it before it resets", type: 'tog', def: true, kw: 'usage limit plan quota' },
        { id: 'spendGuard', label: 'Stop routines and workflows before they use it up', type: 'tog', def: true, kw: 'usage limit routines' },
        { id: 'reserve', label: 'Keep for me', type: 'seg', options: ['10%', '25%', '50%'], def: '25%', show: on('spendGuard'), kw: 'usage limit reserve' },
        { id: 'routineMax', label: 'Stop a routine after', type: 'seg', options: ['15m', '30m', '1h', '2h', '4h'], def: '1h', show: on('spendGuard'), kw: 'routine time' },
        { id: 'holdBig', label: "Hold big tasks for the reset when I'm close", type: 'tog', def: true, kw: 'usage limit queue wait' },
      ] },
    ],
    legs: [
      { title: 'Moving around', items: [
        { id: 'stroll', label: "Let him stroll around when he's idle", type: 'tog', def: true, kw: 'walk move idle still stay', say: 'Stretching my legs.' },
        { id: 'climbWin', label: 'Climbing onto your windows', type: 'seg', options: ['Never', 'Sometimes', 'Often'], def: 'Sometimes', kw: 'climb climbing windows perch' },
        { id: 'climbEdge', label: 'Climbing the edges of the screen', type: 'seg', options: ['Never', 'Sometimes', 'Often'], def: 'Never', kw: 'climb climbing edges' },
        { id: 'onTop', label: 'Keep him on top of your apps', type: 'tog', def: false, kw: 'always on top front desktop', say: "I'll stay over your apps." },
      ] },
      { title: 'Company', items: [
        { id: 'pals', label: 'Pals on the floor', help: 'Rub the mouse over him to pet him. Right-click him for more.', type: 'seg', options: ['Just him', '1', '2', '3', '4', '5'], def: 'Just him', kw: 'friends crabs pals company colony' },
      ] },
    ],
    bucket: [
      { title: 'Working folder', items: [
        { id: 'folder', label: 'New conversations start here', help: 'And load any CLAUDE.md they find.', type: 'path', text: '~\\Documents\\GitHub', button: 'Change', toast: 'This would open a folder picker.', kw: 'directory cwd project start' },
      ] },
      { title: 'Copies of a project', items: [
        { id: 'copies', label: 'Give a conversation its own copy when it changes things', help: '"Bring it home" on the branch chip merges it back.', type: 'tog', def: true, kw: 'git worktree branch copy repo' },
        { id: 'clash', label: 'Warn me when two copies change the same file', type: 'tog', def: true, show: on('copies'), kw: 'git conflict clash' },
        { id: 'signCommits', label: "Sign Shellby's bring-home commits", help: 'Adds "Shipped-with: Shellby (Lv 12 Abyssal Admin)".', type: 'tog', def: false, kw: 'git commit trailer' },
      ] },
      { title: "Checking Claude's work", items: [
        { id: 'tests', label: 'Run the tests after a turn that changed files', help: "Runs the project's own scripts on this PC. He asks once per project first.", type: 'tog', def: false, kw: 'test tests check verify typecheck build', say: "I'll run them after each turn." },
        { id: 'testTime', label: 'Give up after', type: 'seg', options: ['2 min', '5 min', '10 min', '20 min'], def: '5 min', show: on('tests'), kw: 'test timeout' },
        { id: 'flaky', label: 'Spot flaky tests', reads: 'test names only, never their output', type: 'tog', def: true, kw: 'test flake' },
      ] },
      { title: 'Dev servers', items: [
        { id: 'onQuit', label: 'When Shellby quits', type: 'seg', options: ['Leave them running', 'Stop them'], def: 'Leave them running', kw: 'server dev quit close' },
        { id: 'srvCrab', label: 'Show running servers on the crab (":5173")', type: 'tog', def: true, kw: 'server port' },
        { id: 'srvSign', label: 'Hold up a sign when one crashes', type: 'tog', def: true, kw: 'server crash' },
        { id: 'srvToast', label: 'Notify me when one crashes', type: 'tog', def: false, kw: 'server crash notification' },
        { id: 'turnShots', label: 'Before and after pictures of your dev server', help: 'The last 50 per conversation, kept for two weeks on this PC.', type: 'tog', def: true, kw: 'screenshot server preview' },
      ] },
      { title: 'Editor', items: [
        { id: 'editor', label: 'Open file links in', type: 'select', options: ['Automatic', 'VS Code', 'Cursor', 'Windsurf', 'VS Code Insiders', "Windows' default app"], def: 'Automatic', kw: 'vscode cursor ide open files' },
      ] },
      { title: 'Claude Code in your terminal', items: [
        { id: 'plugin', label: 'Shellby plugin', help: 'He works while Claude works in your terminal or editor.', type: 'button', text: 'Install the plugin', toast: 'This would install the plugin in Claude Code.', kw: 'plugin terminal vscode' },
        { id: 'external', label: 'React to Claude Code sessions outside Shellby', type: 'tog', def: true, kw: 'plugin terminal vscode external' },
        { id: 'statusLine', label: 'Status line', help: "His mood, level and XP under Claude Code's prompt.", type: 'button', text: 'Add to Claude Code', toast: 'This would add his status line.', kw: 'statusline terminal' },
        { id: 'cli', label: 'The shellby command', help: 'shellby do "tidy my Downloads" from any terminal.', type: 'button', text: 'Add to my PATH', toast: 'This would add shellby to your PATH.', kw: 'cli terminal path command' },
        { id: 'bgSessions', label: 'Background sessions', help: 'Claude Code working on its own: claude --bg, or /fork.', type: 'button', text: 'Refresh', toast: 'No background sessions right now.', kw: 'background fork bg' },
      ] },
    ],
    bottle: [
      { title: 'On this PC', items: [
        { id: 'notify', label: 'Notify me when a task finishes, needs approval, or he learns a trick', type: 'tog', def: true, kw: 'notification notifications toast alert' },
        { id: 'recap', label: "When I'm back after an hour away, sum up what happened", type: 'tog', def: true, kw: 'recap summary away' },
        { id: 'ccNews', label: 'When Claude Code updates, show me what it can do now', type: 'tog', def: true, kw: 'changelog update news tricks' },
        { id: 'askedBefore', label: "Tell me when I've asked something like this before", type: 'tog', def: true, kw: 'history duplicate similar' },
        { id: 'justSaw', label: 'Show an "Attach what I just saw" button by the chat box', type: 'tog', def: true, kw: 'clipboard error screenshot attach' },
      ] },
      { title: "Tell me when I'm away", items: [
        { id: 'away', label: "Send me these when I'm not at the desk", reads: 'a short line to the service you pick, nothing else', type: 'tog', def: false, kw: 'phone mobile ntfy push notification away telegram pushover slack' },
        { id: 'awayVia', label: 'Where', type: 'select', options: ['ntfy', 'Pushover', 'Telegram', 'Discord', 'Slack', 'My own endpoint'], def: 'ntfy', show: on('away'), kw: 'ntfy pushover telegram slack webhook' },
        { id: 'awayTarget', label: 'Topic', type: 'text', def: '', placeholder: 'shellby-your-topic', show: on('away') },
        { id: 'awayToken', label: 'Token', type: 'text', input: 'password', def: '', placeholder: 'unchanged', show: both(on('away'), not('awayVia', 'ntfy')) },
        ...events('ev', on('away')),
        { id: 'awayFocus', label: "Send them even while he's guarding my focus", type: 'tog', def: false, show: on('away') },
        { id: 'awayReplies', label: 'Let me answer Allow or Deny from my phone', type: 'tog', def: false, show: on('away'), kw: 'phone permission' },
        { id: 'phoneTasks', label: 'Let my phone start tasks', type: 'tog', def: false, show: on('away'), kw: 'phone remote task start' },
        { id: 'phoneFolder', label: 'Phone tasks go to', type: 'path', text: 'nowhere yet', button: 'Choose', toast: 'This would open a folder picker.', show: both(on('away'), on('phoneTasks')) },
        { id: 'passphrase', label: 'Passphrase', type: 'button', text: 'New passphrase', toast: 'Shown once: keep it somewhere safe.', show: both(on('away'), on('phoneTasks')) },
        { id: 'sendTest', label: 'Try it', type: 'button', text: 'Send a test', toast: 'Test sent to your phone.', bob: 'bottle', show: on('away') },
      ] },
      { title: 'Shellby on your phone', items: [
        { id: 'pocket', label: 'Put Shellby on my phone', reads: 'your conversations, over your own tailnet only', type: 'tog', def: false, kw: 'phone mobile tailscale tailnet app pwa pocket' },
        { id: 'pair', label: 'Scan the code, add it to your home screen, then pair', type: 'button', text: 'Pair a phone', toast: 'Type 482 913 on your phone.', show: on('pocket') },
        ...events('pev', on('pocket')),
        { id: 'pocketFocus', label: "Send them even while he's guarding my focus", type: 'tog', def: false, show: on('pocket') },
        { id: 'pocketWorking', label: 'A quiet "working on it" notification while a phone task runs', type: 'tog', def: true, show: on('pocket') },
        { id: 'pocketQuiet', label: 'Quiet hours: hold them back overnight', help: 'A permission prompt still arrives, quietly.', type: 'tog', def: false, show: on('pocket'), kw: 'night sleep quiet hours dnd' },
        { id: 'quietFrom', label: 'From', type: 'text', input: 'time', def: '22:00', show: both(on('pocket'), on('pocketQuiet')) },
        { id: 'quietTo', label: 'To', type: 'text', input: 'time', def: '07:00', show: both(on('pocket'), on('pocketQuiet')) },
        { id: 'allowFiles', label: "Let it read a conversation's files (read-only)", type: 'tog', def: false, show: on('pocket') },
        { id: 'allowPush', label: 'Let it push after bringing a copy home', type: 'tog', def: false, show: on('pocket') },
        { id: 'allowNotify', label: 'Allow and Deny on Android notifications', type: 'tog', def: false, show: on('pocket') },
        { id: 'pocketTest', label: 'Try it', type: 'button', text: 'Send a test', toast: 'Test sent to your paired phone.', bob: 'bottle', show: on('pocket') },
      ] },
    ],
    jar: [
      { title: 'Bugdex', items: [
        { id: 'bugdex', label: 'Catch bugs for the Bugdex', reads: 'which kind of bug and the project, never the error', type: 'tog', def: true, kw: 'bugs catch jar game' },
        { id: 'battles', label: "Bug battles: watch Claude take on each bug while it's loose", type: 'tog', def: true, show: on('bugdex'), kw: 'game fight' },
        { id: 'follower', label: 'His favourite catch follows him round the desk', type: 'tog', def: true, show: on('bugdex'), kw: 'pet companion' },
        { id: 'shareDex', label: 'Share my Bugdex with friends', help: 'Needs Visiting crabs, on the buoy.', type: 'tog', def: false, show: on('bugdex') },
      ] },
      { title: 'Events', items: [
        { id: 'tides', label: 'Tide events: a week with its own bug, finds and medal', help: 'Six times a year, with a countdown on the Us page.', type: 'tog', def: true, kw: 'event halloween season medal' },
        { id: 'news', label: 'Community news: crab contests, winners and events', reads: 'one small file a day, nothing about you', type: 'tog', def: false, kw: 'contest community' },
      ] },
      { title: 'Rewards', items: [
        { id: 'earned', label: 'Show what a task earned at the end of it in Chat', type: 'tog', def: true, kw: 'xp reward trophy level card' },
        { id: 'surprises', label: 'Small surprises for real wins: a critical hit, a clean landing', type: 'tog', def: true, kw: 'celebrate critical' },
        { id: 'shareBtns', label: 'Share buttons on celebrations', type: 'tog', def: true, kw: 'share post screenshot' },
      ] },
    ],
    buoy: [
      { title: 'GitHub', items: [
        { id: 'github', label: 'GitHub', help: 'Signed in as you. One sign-in asks for everything you tick below.', type: 'actions', buttons: [['Sign out', 'This would sign you out of GitHub.']], kw: 'git account login' },
        { id: 'sync', label: 'Sync trophies, XP, outfit, Bugdex and settings between PCs', reads: 'your progress, to a private gist', type: 'tog', def: true, kw: 'gist backup sync' },
        { id: 'syncHistory', label: 'Sync my newest conversations to my other PCs', reads: 'conversations, to a private gist', type: 'tog', def: false, kw: 'history gist sync' },
        { id: 'syncNow', label: 'Last synced 4 minutes ago', type: 'button', text: 'Sync now', toast: 'Synced.', show: on('sync') },
      ] },
      { title: 'Show off your crab', items: [
        { id: 'friends', label: "Visiting crabs: friends' crabs drop by and leave souvenirs", reads: 'your crab, to a public gist', type: 'tog', def: false, kw: 'friends social visit guestbook swaps waves' },
        { id: 'addFriend', label: 'Add a friend', type: 'text', def: '', placeholder: "Friend's GitHub username", button: 'Add friend', toast: 'Friend added. Their crab drops by soon.', show: on('friends') },
        { id: 'profileCard', label: 'Profile card on your GitHub profile', reads: 'crab, level, streak and stickers, to a public gist', type: 'tog', def: false, kw: 'readme profile card' },
        { id: 'profileSetup', label: 'Put him on your profile in four steps', type: 'button', text: 'Start', toast: 'Step 1: create your profile repository.', show: on('profileCard') },
        { id: 'prBadge', label: 'Built with Shellby: your crab at the bottom of pull requests', type: 'tog', def: false, kw: 'pull request badge' },
        { id: 'publishPacks', label: 'Publish my Wardrobe packs to the community gallery', type: 'tog', def: false, kw: 'wardrobe gallery packs' },
      ] },
      { title: 'Work with your code', items: [
        { id: 'ci', label: "Watch CI on my pull requests: he worries when a build goes red", type: 'tog', def: true, kw: 'build github actions ci' },
        { id: 'issues', label: 'Offer to take on issues assigned to me or labelled shellby', type: 'tog', def: false, kw: 'issues tasks' },
        { id: 'repos', label: 'Show my repositories on the Projects page', type: 'tog', def: true, kw: 'repositories projects' },
        { id: 'push', label: 'Let Claude tasks push code and open pull requests', type: 'tog', def: false, kw: 'git github push pr pull request' },
        { id: 'pushWorkflows', label: '…including changes to CI workflows', type: 'tog', def: false, show: on('push') },
      ] },
      { title: 'GitLab', items: [
        { id: 'gitlab', label: 'Watch my merge requests: he worries when a pipeline goes red', help: 'Through the glab CLI, so Shellby never sees a GitLab token.', type: 'tog', def: false, kw: 'gitlab merge pipeline glab' },
        { id: 'gitlabHosts', label: 'Self-managed hosts', type: 'text', def: '', placeholder: 'gitlab.example.org', button: 'Save', toast: 'Saved.', show: on('gitlab') },
      ] },
      { title: 'Other computers', items: [
        { id: 'remotes', label: 'Run Claude Code on another computer over ssh', help: 'Add a folder there, and conversations in it run over there.', type: 'actions', buttons: [['Add', 'Added homebox from your ssh settings.'], ['A new computer', 'This would open the ssh form.']], kw: 'ssh server remote vps' },
        { id: 'sshAgent', label: "Windows' ssh agent", help: 'Running, with 1 key.', type: 'status', text: 'Running', kw: 'ssh agent keys' },
      ] },
    ],
    sign: [
      { title: 'System', items: [
        { id: 'startWin', label: 'Start with Windows', type: 'tog', def: true, kw: 'startup boot launch login' },
        { id: 'leaveGuard', label: 'Hold up a shutdown while work is unpushed or Claude is mid-task', type: 'tog', def: true, kw: 'shutdown restart safe sign out' },
      ] },
      { title: 'Shortcuts', items: [
        { id: 'hotkey', label: 'Open Shellby', type: 'path', text: 'Ctrl+Alt+Space', button: 'Change', toast: 'Press a new shortcut.', kw: 'shortcut hotkey keyboard' },
        { id: 'pushToTalk', label: 'Hold it to dictate a task', help: "Windows' own speech recognition listens, on this PC.", type: 'tog', def: true, kw: 'voice dictate speech microphone' },
        { id: 'panelKeys', label: 'Shortcuts in the panel', type: 'button', text: 'Change them', toast: 'This would open the shortcut list.', kw: 'keyboard shortcuts keys' },
      ] },
      { title: 'Screens', items: [
        { id: 'screens', label: 'Some screens join the bar as you two work together', type: 'actions', buttons: [['Show everything now', 'Every screen is on the bar now.'], ['Bring back First steps', 'First steps is back.']], kw: 'tabs bar hidden onboarding' },
        { id: 'uses', label: 'What you use', help: 'Which screens you open, counted on this PC.', type: 'button', text: 'See it', toast: 'You use Chat most, then Projects.', kw: 'usage stats' },
      ] },
      { title: 'Updates', items: [
        { id: 'checkNow', label: 'Shellby 0.98.1', type: 'button', text: 'Check for updates', toast: "You're on the newest version.", kw: 'update upgrade version' },
        { id: 'ccUpdate', label: 'When Claude Code has a new version', type: 'seg', options: ['Tell me', 'Update it', 'Leave it'], def: 'Tell me', kw: 'update upgrade claude code' },
        { id: 'crash', label: 'Crash reports', help: 'With your home folder and anything token-shaped removed.', type: 'seg', options: ['Ask', 'Always', 'Never'], def: 'Ask', kw: 'crash report error bug sentry' },
      ] },
      { title: 'About', items: [
        { id: 'feedback', label: 'Tell us', type: 'actions', buttons: [['Report a problem', 'This would open a problem report.'], ['Suggest an idea', 'This would open an idea form.']], kw: 'bug report feedback idea' },
        { id: 'links', label: 'Shellby', type: 'actions', buttons: [['GitHub', 'Opened GitHub.'], ['Sponsor', 'Opened Sponsors.'], ['Made by', 'Everyone who has made Shellby.']], kw: 'sponsor credits github' },
        { id: 'dataFolder', label: 'Your data', type: 'button', text: 'Data folder', toast: 'Opened the data folder.', kw: 'data folder files appdata' },
      ] },
    ],
  });

  PAH.ITEMS = Object.freeze(Object.entries(PAH.SCHEMA).flatMap(([area, groups]) =>
    groups.flatMap(g => g.items.map(item => ({ ...item, area, group: g.title })))));
  PAH.DEFAULTS = Object.freeze(Object.fromEntries(PAH.ITEMS.filter(i => 'def' in i).map(i => [i.id, i.def])));
})(window.PAH);
