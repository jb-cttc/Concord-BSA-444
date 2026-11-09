# Working in Concord-BSA-444

Apps for BSA Troop 444. Free and non-commercial, used by the troop's adults
on their own phones. Start with `README.md`, which has the status and the plan.

## How the code is built

- Each app is a folder of plain static files (HTML, CSS, ES modules). There is
  no build step and no npm dependencies at run time. Libraries come from
  cdnjs with an exact version (Leaflet 1.9.4, qrcodejs 1.0.0). Firebase comes
  from gstatic at a pinned version (`store.js`).
- GitHub Pages serves `main` from the repository root, so whatever is merged
  into `main` is live. Work on a branch and open a pull request.
- Keep maths and logic out of browser code where possible (`coverage.js`), so
  it can be tested with Node: `node check-coverage.js`.
- Before calling a change done:
  - Run the checks.
  - Try the app in demo mode in a browser at phone width (390 px) and at a
    wide width, in light and dark mode.
  - With Playwright, block `tile.openstreetmap.org` and fake the Overpass
    response; the walker simulation drives the rest.

## Data and privacy

- Only adults' phones are tracked, under adults' names. Never store scouts'
  names or positions. Never store parcel owner names.
- Never commit real trails, event codes, screenshots of real events, or
  people's contact details. The repository may be public.
- `config.js` holds Firebase web settings. These are not secrets: the rules in
  `firebase-rules.json` protect the data. Any new data path needs a matching
  rule.
- Stay inside free tiers (Firebase Spark, GitHub Pages, OpenStreetMap
  services). When a change adds data or traffic, update the estimate in the
  app's README.
- Use a troop or personal Google account for Firebase. Never use the Concord
  Table Tennis Club's account.

## Writing

Plain, short sentences for nontechnical adults. Write the steps someone takes,
not how the code works.
