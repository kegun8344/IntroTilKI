# Movie Night Matcher

*Mandatory Assignment 3: Vibe Coding*, DAVE3625. Approach **C: recreate or improve an existing app**.

## Demo link
GitHub Pages: https://kegun8344.github.io/IntroTilKI/

## Source code
This repository: https://github.com/kegun8344/IntroTilKI

## Short description
Movie Night Matcher is a web app for groups who can't agree on what to watch. It takes the swipe-to-match idea from dating apps and uses it on movies. 2–6 people swipe the same stack of movies, on one phone or each on their own phone: right for yes, left to skip, up for "must watch". Only the movies everyone said yes to make it through, and the app then draws tonight's movie or settles it with a head-to-head showdown. With separate phones, the game travels in a link and the results show up live on every phone. No account or download is needed.

**Main features**
1. Swipe to vote on movies (570 to choose from, with filters).
2. See which movies everyone matched on, then draw one or run a showdown.
3. Play on one shared phone, or each on your own phone.

## How AI was used
The whole app was built with Claude (Anthropic) through vibe coding. I described what I wanted in plain language, and Claude brainstormed ideas with me, planned the app, wrote the code, ran the tests and made the changes I asked for. I chose the idea and the direction, tried the app myself and reported problems. The full log is in [PROCESS.md](PROCESS.md).

## How it was tested and improved
- **Unit tests** (`npm test`): 25 tests of the game rules, such as matching, the draw, the showdown and share links.
- **Browser test** (`npm run test:e2e`): 92 checks that play real games in a phone-sized browser, with one phone and with two phones.
- **Data checks** (`npm run build:movies`, `npm run check:facts`): every movie line is validated, and the facts are cross-checked against two open datasets.
- **Improvements:** 17 problems were found through testing, screenshots and my own use of the app, and then fixed. One example is that the results first showed up on only one phone. They are listed in [PROCESS.md](PROCESS.md).

No passwords, API keys or personal data are published. The app is static HTML, CSS and JavaScript. Live updates go through [ntfy.sh](https://ntfy.sh), a free message relay that needs no account or key.
