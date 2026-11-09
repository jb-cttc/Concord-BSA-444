# Concord-BSA-444

<img src="door-hanger-map/brand/logo-600.png" alt="Golden Gate Area Council patch with Troop 444 numerals" width="260">

Sandbox for Scouts-related apps for BSA Troop 444 (Golden Gate Area Council).
Free, non-commercial and built for the troop's own use. Each app lives in its
own folder and runs as a plain web page, with no App Store and no build step.

| App | What it is | Status |
| --- | --- | --- |
| [`door-hanger-map/`](door-hanger-map/) | Live shared map for door-hanger days: everyone's dot and trail, with streets turning green as they are covered | Working prototype in demo mode. Not yet connected to a live database or tried on real phones. |

## Door hanger map: where it stands

**Built and tested** (details in [`door-hanger-map/README.md`](door-hanger-map/README.md)):

- **Joining an event:** one link or QR code, no accounts. Each adult enters a
  name and picks a group colour.
- **Tracking:** **Start door hangers** follows GPS and keeps the screen awake.
  Each phone shares its dot and trail with every other phone.
- **Area and streets:** the organizer draws the event area, and the app pulls
  its residential streets from OpenStreetMap.
- **Coverage:** streets turn green when a trail passes within ~25 m. The app
  shows a percentage covered and a **Streets left** list, and any street can
  be marked done by hand.
- **Organizer tools:** share link and QR code, delete all event data, and a
  three-walker simulation for demos.
- **Troop 444 branding:** a logo digitized from the uniform patches, plus
  home-screen icons.
- **Tests:** checks for the coverage maths (`node check-coverage.js`), plus
  end-to-end runs in a headless browser with simulated GPS and two tabs.

**Before the first real use** (owner steps, about 20 minutes; see
[Setting it up](door-hanger-map/README.md#setting-it-up-about-20-minutes-once)):

1. Turn on GitHub Pages for this repository (`main`, root). The app is then at
   `https://jb-cttc.github.io/Concord-BSA-444/door-hanger-map/`. Pages needs a
   public repository on a free account.
2. Create a Firebase project on a troop or personal Google account. Turn on
   anonymous sign-in, create a Realtime Database, paste in
   `door-hanger-map/firebase-rules.json`, and put the web config into
   `door-hanger-map/config.js`.
3. Do a two-phone walk around the block to check live updates, the screen
   staying awake, and battery use.

**Known limits:**

- A web page stops tracking when the phone locks or switches apps. The app
  keeps the screen on, flags gaps, and allows marking streets done by hand.
- GPS is accurate to roughly 5–15 m.

## Plan

### 1. Group assignments (next)

**Goal:** before the day, the organizer splits the area between groups. Each
group sees its own share in its colour, its own **Streets left** list and its
own progress. Groups can be rebalanced during the day.

- **How the organizer assigns:**
  - Draw one zone per group on the map, the same way the event area is drawn.
    Every street piece inside a zone goes to that group, which is quick for
    ~1,000 houses.
  - Then tap any street to move it to another group.
  - Unassigned streets stay grey, and the top bar warns about them.
- **Map:** before the start, assigned streets show in a light tint of the
  group colour. They turn solid once walked. A street walked by a different
  group still counts as covered, and shows who walked it.
- **Lists:**
  - **Streets left** gets a group filter, defaulting to your own group.
  - The top bar shows your group's percentage next to the overall one.
  - The People tab adds per-group totals.
- **Data:**
  - `events/{code}/zones/{group}`: an encoded polygon.
  - `events/{code}/assign/{wayId}`: a group, for streets moved by hand.
    It overrides the zone.
  - Only the organizer writes these. Add matching rules to
    `firebase-rules.json`.
- **Code:**
  - Assign pieces to zones in `coverage.js`, using its point-in-polygon
    helper on each piece's midpoint.
  - Add per-group statistics to `Coverage.stats()`.
  - Add checks for both to `check-coverage.js`.
- **Done when:** two simulated groups in demo mode each see only their own
  streets left, and their percentages add up to the overall percentage.

### 2. Parcels touched per person (after assignments)

**Goal:** an automatic count of the houses each adult has reached, as a
progress measure across the group: "412 of 1,000 houses, Mr. Lee 63". No one
has to tap anything.

- **Parcel data, imported once when the organizer sets the area:**
  - Store only the outline, an id and the street address. Never store owner
    names.
  - The source still has to be chosen, so this is the first job of the next
    session. Check each candidate against the troop's real neighbourhood:
    - **County assessor parcels:** Concord is in Contra Costa County. The
      County Assessor's parcels are republished by other agencies, for
      example on a
      [San Ramon city GIS service](https://gis.sanramon.ca.gov/server/rest/services/enCodePlus/Parcels/MapServer).
      Find an official county endpoint, then check its licence, whether a
      browser page may call it (CORS), and its page size (often 1,000 records
      per request, so it will need paging).
    - **OpenStreetMap addresses and buildings:** same Overpass query style as
      the streets. Coverage varies street by street, so count what exists for
      the area.
    - **Fallback:** if neither works from the browser, a one-off script in
      this repo prepares the parcels as a file that the organizer loads.
- **What counts as "touched":**
  - Hanging a door hanger means walking to the front door. So the starting
    rule is: a trail point lands inside the parcel outline grown by ~5 m, from
    a fix with accuracy of 20 m or better.
  - The first person to touch a parcel gets the credit, and so does their
    group. Later visits don't count twice.
  - Tapping a parcel marks or unmarks it by hand (for GPS gaps), recording who
    did it and when.
- **Accuracy:**
  - Lots are often only 15–20 m wide, close to GPS error, so a neighbour's
    lot can be credited by mistake.
  - Tune the rule on a real test walk: walk known houses, compare, and adjust
    the margin.
  - Show the count as "about" until it has been checked against a real walk.
- **How it's computed:**
  - On each phone from the shared trails, like street coverage. Every phone
    reaches the same answer, and nothing extra is written to the database.
  - A grid index keeps it fast: 1,000 parcels against ~15,000 trail points is
    trivial.
- **Storage:** parcels are stored with the event, as encoded outlines. About
  100 KB for 1,000 parcels, downloaded once per phone. That is well within
  the Firebase free tier; recheck the totals in `door-hanger-map/README.md`.
- **On screen:**
  - Parcel outlines appear when zoomed in, filled in the toucher's group
    colour.
  - The top bar shows houses reached out of the total.
  - The People tab shows each person's count and a group table.
- **Tests:** a `check-parcels.js` alongside `check-coverage.js`, covering the
  inside / grown-by-5 m / too-inaccurate cases, first-toucher credit, and
  manual marks.

### Later

- **End-of-day summary:** an image or GPX file of the final map, plus
  per-person and per-group counts for the troop's records.
- **Clean-up:** event data deletes itself after a set number of days.
- **Both sides of a wide street:** mostly solved once parcels are counted.

## Picking this up in a new session

1. Read this file, then [`door-hanger-map/README.md`](door-hanger-map/README.md)
   and [`CLAUDE.md`](CLAUDE.md) (the working rules).
2. Try the app in demo mode:
   `cd door-hanger-map && python3 -m http.server 8080`, open
   `http://localhost:8080`, create an event, then Event tab > **Simulate 3
   walkers**.
3. Run the checks: `cd door-hanger-map && node check-coverage.js`.
4. Start on **Plan 1, group assignments**, on a new branch, with a pull
   request into `main`.

## History

The app was sketched on a branch of the table tennis club's repository and
moved here in November 2026, history included. That club repository has no
part in running it.
