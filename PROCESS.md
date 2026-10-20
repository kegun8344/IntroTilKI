# How I used AI to build this (vibe coding log)

**AI tool:** Claude (Anthropic), in the Claude app with access to my project folder. Claude wrote the code, ran the tests and committed to my repo as it went. I chose the idea and the direction, tried the app, reported problems and decided what to keep.

## 1. Brainstorming the idea
- I pasted the assignment text and asked for help. Claude suggested four ideas based on my everyday life (shift tracker, study planner, car rental checklist, group project board).
- I said **no work-related ideas**. The second round (expense splitter, recipe finder, café ordering, habit tracker) didn't excite me either.
- Third round: live departure board (Ruter-style), **movie-night matcher**, beat maker, guess-the-place game. I picked the movie-night matcher. It recreates an existing app idea (swipe to match) and solves a real problem.
- I chose an **English** interface.

## 2. Version 1: a small working app
Claude proposed, and I accepted:
- A static website (HTML/CSS/JS) that can be hosted for free on GitHub Pages, with no API keys or personal data.
- 2–3 core features: swiping, matching plus a draw, and filters plus history.
- Splitting the game rules (`logic.js`) from the UI (`app.js`) so the rules can be tested automatically.
- A visual identity built on cinema tickets: each movie is a coloured raffle ticket, the title is a marquee sign, and the winner gets an "Admit" ticket.

Version 1 had 80 movies and 2 players on one phone.

## 3. My feedback during version 1
- **"Work in the folder I gave you."** Claude first drafted files in its own workspace; I asked it to work directly in my repo folder.
- **"You have to commit along the way."** From then on, every step became its own git commit.
- **"Every time I swipe a card, a horizontal scrollbar appears."** I found this while trying the app (see bug 7 below).
- **"Can it really work with two players, one on each phone?"** Yes. The game travels inside the link. Claude explained the honest limit: it takes turns, not real time, because there is no server.
- **"Shouldn't we have several pages instead of everything in index.html?"** Claude explained why a single-page app suits this (shared state between screens, no reloads, no peeking), and suggested a separate About page instead. That page was added in version 2.

## 4. Version 2: "cook as hard as you can, and at least 500 movies"
I asked for a much bigger app. Claude's plan, which I let it carry out:
1. A catalogue of 500+ movies from around the world, with director, cast and country, and automatic fact-checking.
2. 2–6 players.
3. Each person on their own phone, using share links and no server.
4. More filters (vibe, origin, decade, length, hide movies you've seen).
5. Flip cards with details, trailer and streaming links.
6. Must-watch limited to 3 per person.
7. A head-to-head showdown as an alternative to the random draw.
8. Installable, works offline, with sound, vibration and confetti.
9. An About page.
10. Many more tests.

### How the 570 movies were made and checked
- Claude wrote the list as a plain text file (`data/movies.txt`), one movie per line, with its own one-line pitches (no copied plot summaries or posters).
- `tools/build-movies.mjs` checks every line (fields, year, runtime, known genres and countries, pitch length, duplicates) and generates `js/movies.js`.
- The live movie database (Wikidata) was blocked from Claude's environment, so it found two open datasets on GitHub instead: Wikipedia movie data (year and cast) and vega-datasets (runtime and director). `tools/check-facts.mjs` compares our list with them.
- Result: 428 movies matched against Wikipedia and 232 against vega. It found **1 real error** (the wrong lead actor for *Cool Runnings*, now fixed). It also showed that **the reference data itself was wrong** in several places (for example *The Big Lebowski* listed as 127 min instead of 117, and *The Matrix* credited to an old name). Those 11 flags were reviewed and written down with reasons in `data/reviewed-flags.txt`, so the checker only warns about new problems. Lesson: test data needs human judgment too.

## 5. Testing and improving (all versions)
| # | Found by | Problem | Fix |
|---|---|---|---|
| 1 | Unit tests | All passed on the first run | Kept as a safety net for later changes |
| 2 | Browser test | After the last swipe, the card that flew away stayed hidden in the page | Clear the stack when a turn ends |
| 3 | Screenshot review | An empty notification pill peeked out at the bottom of the screen | Hide it completely when not showing |
| 4 | Screenshot review | Fonts loaded from Google Fonts, so the app depended on an outside service | Bundled the fonts in `fonts/` |
| 5 | Opening the file from disk | A font "preload" line caused a browser security (CORS) error | Removed the preload line |
| 6 | Screenshot review | Ticket cards had a large empty area | Added the year as a big, faint "printed" number |
| 7 | **Me, trying the app** | A horizontal scrollbar flashed every time a card was swiped right | Reproduced with a test (the page got 397 px wider), clipped sideways overflow, added a permanent check |
| 8 | Fact checker | Wrong lead actor for one movie | Fixed in the data file |
| 9 | Fact checker | False alarms from Norwegian and Korean films whose titles match American remakes | Only compare years for American films (the dataset only has American films) |
| 10 | Screenshot review (v2) | Confetti from a draw kept falling into the showdown screen | Stop the confetti on every screen change, with a test |
| 11 | Screenshot review (v2) | The must-watch badge said a cryptic "★ ×1" | It now names who picked it ("★ Kevin's must watch") |
| 12 | Screenshot review (v2) | On computers without a share menu, "Copy link" looked like a secondary button | It becomes the main button there |
| 13 | **Me, testing with two phones** | Only the last person saw the results, and each phone could draw a different movie | A "Send results to Kåre" step at the top of the results. The link now includes the drawn movie, so both phones show the same pick (tested with two browser profiles) |
| 14 | **Me** | The "Admit all" text on the winner ticket was upside down | It now reads top to bottom, with a test |
| 15 | Code review | In link mode, reloading the page on the results screen went back to "Your turn", so the last person had to swipe everything again | The results are kept in the address bar, the reload doesn't add a second history entry, and it still offers to send the results back. Reproduced first, then covered by browser checks |
| 16 | Code review | Pressing "New stack" while the draw was still spinning let the old movie land later, with confetti over the next screen | Leaving the results screen cancels a running draw, with a browser check |
| 17 | **Me** | "So after person 2 swipes, the results are only on person 2's phone?" Everyone else had to wait for a link | Live updates through a message relay (see section 6) |
| 18 | Test against the real relay | While connecting, the live badge said "Offline" for a moment | A separate "Connecting…" state, and the test waits for the connection |

Final result: **25/25 unit tests, 92/92 browser checks** (91/91 against the real ntfy.sh too), 570/570 movie lines valid, 0 unreviewed fact-check flags, and no JavaScript errors.

## 6. Version 3: live results on every phone
I asked if we could add "a server kind of thing" so the results show up on everyone's phone. My one rule: **players must not have to download anything, it has to just work in the web page, and the link stays as a fallback.**

- Claude compared two options: a real database (Firebase/Supabase) or **ntfy.sh**, a free, open-source message relay. A database needs an account and config keys in the code, and the assignment says never to publish API keys, so we chose ntfy.sh: no account, no key.
- How it works: the host's phone makes a random room id that travels in the link. When someone finishes swiping, their phone posts its answers to that room; every phone with the game open listens and shows the results when everyone is done. A drawn movie is shared the same way.
- Anyone who knows the room name could post to it, so every message is checked against the game (right player numbers, the right number of answers, only movies in the deck) before it is used. This is unit tested.
- If the relay can't be reached, nothing changes: the links still carry everything, exactly like version 2. The old browser checks now run with an unreachable relay to prove that.
- Claude also built a tiny fake relay into the browser test, so two phones can be tested live without the internet, and ran the same test once against the real ntfy.sh.
- Side quest that didn't make it: I asked for 1,000 more movies. Writing them by hand was slow, and data pulled automatically from Wikipedia/Wikidata had wrong lead actors, countries and genres, so I dropped it. Lesson: more data isn't better if it's wrong.
