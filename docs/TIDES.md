# Tide events, sparklies, eggs and swaps

Things to show someone: a medal with a year on it, a sparkly find, an egg you laid for a friend, a find you swapped for the last piece of a set. None of it can be bought, and nothing is ever taken away.

## Tide events

Six times a year, for a week or so, something's going on at sea. While one's on, a banner at the top of the **Us** page counts down the days and lists its four goals. A smaller one sits on the Bugdex and the shelf.

| Event | When | Its bug comes along with... | The twist |
|---|---|---|---|
| 🌾 **Harvest Moon** | Oct 1 – 9 | a fix that works first try | every catch pays half again in XP |
| 🎃 **The Haunting** | Oct 24 – Nov 1 | any fix between 9 pm and 5 am | ghosts in the Wreck are twice as likely to sparkle |
| ❄️ **Frostbite** | Dec 18 – Jan 1 | your third catch in a day | snow piles up on his shell a little with every catch (the banner's line only: no boost) |
| 💌 **Pen Pal Week** | Feb 9 – 15 | a bug beaten with a helper crab in the fight | swaps count double toward the trophies |
| 🌸 **Spring Clean** | Mar 22 – Apr 2 | a fix that deletes more lines than it adds | something lives in the code you delete (the banner's line only: no boost) |
| 🌊 **Low Tide** | Jul 10 – 21 | any catch in the Shallows | he digs twice as often, and finds and bugs sparkle twice as often |

South of the equator (the town you picked for the weather), Harvest Moon, Spring Clean and Low Tide move six months, like their seasons. The holidays keep their dates.

- **The goals** count what you already do: bugs Claude fixed, tasks finished, finds he dug up, a wave to a friend. Nothing counts from before the event started.
- **Its bug** only ever comes along with a real catch, made its way: there's no catching one any other way. It goes in the Bugdex under **🧭 Tide events**. Missed it? Its card says when it's back.
- **Its two finds** only turn up while it's on. They go in the *Tide chest* set, which takes a year to fill.
- **Finish every goal while it's on** and you get that year's medal (on the Us page, your calling card and your friends' lists of you), the event's trophy, and a piece for his tank. The trophy and the piece come back next year. The medal for a year never does. **📸 Share** on the banner makes a picture of it.
- He mentions the event now and then, says so on its first day, and reminds you on its last day if goals are left.
- Your goals and medals follow you between PCs with Sync on.

Switch: **Settings → Shellby → Games → Tide events**.

### 🎂 Molt Day

Shellby's birthday is **September 30th**, the day his first version came out in 2026. On the day he says so on the desktop, throws some confetti, and a banner on the Us page says how old he is. Anyone who opens Shellby that day keeps that year's **party hat**, with his age on it. There are no goals and no medal: being there is the point. Each year's hat only turns up on its own Molt Day, so a missed one stays missed. It follows the Tide events switch.

Molt Day isn't a tide event. It sits beside them, so south of the equator, where Spring Clean runs over September 30th, both are on at once and Spring Clean's goals keep counting.

### One-offs and event-limited packs

An event in `src/main/events.js` may have `year: 2027`: it only runs that year, never comes back, and its bug's card doesn't say when it's back. One-offs mustn't overlap another event in their year, north or south (`test/events.test.js` checks).

A pack item can be **event-limited** with `"unlock": { "event": "haunting" }`: it turns up while that event is on and is yours to keep after, the way seasonal items are. Any built-in event id works (`molt-day` too). `"year": 2027` beside it narrows it to that year's run. See [ADDONS.md](ADDONS.md).

### Adding an event

1. **`src/main/events.js`**: an `EVENTS` entry with its id, name, emoji, `colour` (`#rrggbb`, its banner's tint), season, dates, four lines, blurb, twist, four goals (one of them `event-bug`), its bug, two finds, trophy, boosts and a 7×7 medal. A one-off gets `year`. Then a `case` in `bugComesAlong` for how its bug comes along.
2. **`src/main/bugdex/species.js`**: its bug, with `event: '<id>'` and no habitat.
3. **`src/main/gifts/index.js`**: its two finds, `set: 'tides'` and `event: '<id>'`, and its name in `EVENT_NAMES`.
4. **`src/main/wardrobe/achievements.js`**: its trophy (`stat: 'events<Name>'`), the stat in `COUNTERS`, and `'event-done-<id>'` in `INCREMENTS`.
5. **`src/wardrobe/tide-chest.json`**: the trophy's reward, a tank piece with `unlock: { achievement }`.
6. **`docs/addon.schema.json`**: the id in the `unlock.event` enum (a test checks it matches `KNOWN_EVENTS`).
7. **This page**: a row in the table.

The panel reads every event's name, emoji and colour from main, so nothing in `src/renderer` changes (a test fails if an event id turns up there).

## Sparklies

Now and then a find he digs up comes up **sparkly**: the same find, in colours you'll rarely see. It's 1 in 128 (1 in 64 at Low Tide). Bugs have always had a 1 in 64 shiny form (1 in 32 at Low Tide, and for the Wreck's ghosts at The Haunting), and they get the same moment now.

When one turns up, the panel stops for it. A card flips over to show it big, with the odds, how many came before it, and the day, and **📸 Share this** saves it as a picture and copies it. On the shelf, a sparkly find shows both ways, with a ✨ and how many you have.

Trophies: ✨ *Glimmer* (your first, for a Glitter Jar in the tank), 🌟 *Shiny Hunter* (five, for a Sparkle Trail), and a secret one.

## Crab eggs

From level 5, with **Visiting crabs** on (Settings → Connections → GitHub), he can lay an egg a week for someone who doesn't have Shellby yet, with up to three waiting at once. On the Us page, under **Eggs and the clutch**:

1. **Lay an egg**, then **Copy invite**. That copies the download link and the egg's code (`EGG-yourname-…`). Send it however you like. **📸 Card** makes a picture of the egg with its code on.
2. They install Shellby, turn on Visiting crabs, and paste the code on their Us page. If they paste it first, it waits and hatches once they've signed in.
3. It hatches into a baby crab that you both keep, worked out from the egg so it's the same baby on both desktops. You become friends. They also get your favourite find.

Your calling card only carries a scrambled form of each egg, so nobody can hatch one from your card. Only someone with the code can, and only once. A `shellby://hatch` link opens the Us page with the code filled in, and nothing happens until they press **Hatch it**.

Any baby in your clutch can follow him round the desk instead of your favourite catch (**Follow him**).

Trophies: 🥚 *Proud Parent* (your first egg hatched, for a Crab Nest), 🐣 *Big Clutch* (five), and 🍼 *Hatchling* (for whoever hatched one, with a Baby Bib).

## Swaps

Friends can swap **finds**, sparkly ones too. Bugs never change hands, because a catch comes from a fix Claude made.

- **Swap…** on a friend's row in Settings → Connections → GitHub → Visiting crabs shows what they'd swap and what you could give. Anything that would **finish one of your sets** says so, and anything they're after is marked.
- You always keep one of everything. Only a second copy can go.
- Your copy is set aside while you wait. If they say no, call it off, or a week passes, it comes back.
- Offers to you wait under **Swaps** with **Swap** and **No thanks**. Saying yes makes the swap at once.
- At most three of yours waiting at once, one per friend, and ten a week.

Swaps travel as short notes on each other's calling cards, with only the finds' names in them. Only offers from friends are read.

Trophies: 🤝 *Fair Trade* (your first swap) and 🧩 *Missing Piece* (a swap that finishes a set).

## The friends' board

With **Share my Bugdex with friends** on (Settings → Shellby → Games), the Bugdex page shows **This month**: you and the friends who share theirs, ranked by the bugs Claude fixed for each of you since the 1st. There's a tab for every habitat someone caught in, and one for sparklies. A friend whose card is from last month counts as nothing until they're back.

**📸 Share the board** makes a picture of the podium. When a month ends, where you finished goes in the journal on the Us page, and topping it earns 🥇 *Top Crab*.

Your card only shares counts: how many bugs this month, how many sparkly, and in which habitats. It never shares projects or errors.

## On pull requests and commits

If you've turned on the **pull request badge** (Settings → Connections → GitHub), its line now reads like *🦀 Built with Shellby · Lv 12 Abyssal Admin · Tester · 3 bugs jarred this week · 🎃*.

**Sign Shellby's bring-home commits** (Settings → Claude → Copies of a project) adds one line to the commits Shellby makes bringing a copy home: `Shipped-with: Shellby (Lv 12 Abyssal Admin)`. Claude Code's own commits keep their own sign-off.
