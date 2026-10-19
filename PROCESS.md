# How I used AI to build this (vibe coding log)

**AI tool:** Claude (Anthropic), in the Claude app with access to my project folder. Claude wrote the code and ran the tests. I chose the idea and the direction, reviewed the results and decided what to keep.

## 1. Brainstorming the idea
- I pasted the assignment text and asked for help. Claude suggested four ideas based on my everyday life (shift tracker, study planner, car rental checklist, group project board).
- I said **no work-related ideas**. The second round (expense splitter, recipe finder, café ordering, habit tracker) didn't excite me either.
- Third round: live departure board (Ruter-style), **movie-night matcher**, beat maker, guess-the-place game. I picked the movie-night matcher. It recreates an existing app idea (swipe to match) and solves a real problem: two people who can't agree on a movie.
- I chose an **English** interface.

## 2. Planning
Claude proposed, and I accepted:
- A static website (HTML/CSS/JS) so it can be hosted for free on GitHub Pages, with no API keys or personal data.
- 2–3 core features: swiping, matching plus a draw, and filters plus history.
- Splitting the game rules (`logic.js`) from the UI (`app.js`) so the rules can be tested automatically.
- A visual identity built on cinema tickets: each movie is a coloured raffle ticket (colour = genre), the title is a marquee sign, and the winner gets an "Admit two" ticket.

## 3. Building
Claude generated the movie list, the logic, the four screens and the swipe gestures (pointer events, so they work with both touch and mouse). I asked Claude to work directly in my repo folder.

## 4. Testing and improving
| # | How it was found | Problem | Fix |
|---|---|---|---|
| 1 | Unit tests (11) | All passed on the first run | Kept as a safety net for later changes |
| 2 | End-to-end browser test | After the last swipe, the flown-away card stayed hidden in the page, so code that looked for "the current card" still found one | Clear the stack and fill the progress bar when a turn ends |
| 3 | Reviewing screenshots | An empty notification pill was peeking out at the bottom of the screen | Hide the notification completely (`visibility: hidden`) when it isn't showing |
| 4 | Reviewing screenshots | Fonts were loaded from Google Fonts, so the app depended on an external service and looked plain offline | Bundled the font files in `fonts/` (open licence) |
| 5 | Running the test with the file opened from disk | A font "preload" line caused a browser security (CORS) error when opening `index.html` by double-clicking | Removed the preload line, now 0 errors both from disk and from a web server |
| 6 | Reviewing screenshots | Ticket cards had a large empty area | Added the release year as a big, faint "printed" number on the ticket |
| 7 | **Me, trying the app** | Every time a card was swiped to the right, a horizontal scrollbar flashed at the bottom of the page and the animation looked stuttery | Claude reproduced it with a test (the page became 397 px wider mid-swipe), clipped sideways overflow on the page, and added a "no horizontal scrollbar while swiping" check to the browser test |

Final result: **11/11 unit tests and 19/19 browser checks pass**, with no JavaScript errors, at phone size (390×844).

## 5. My reflection
<!-- Write a few sentences in your own words, for example:
- What surprised you about building with AI?
- What did the AI do well, and where did you have to step in or steer?
- What would you add next (e.g. a remote mode where two phones join the same session, or real movie data from an API)?
-->
