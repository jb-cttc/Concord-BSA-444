# BSA Troop 444: door hanger map

<img src="brand/logo-600.png" alt="Golden Gate Area Council patch with Troop 444 numerals" width="300">

A small web app for Troop 444's door-hanger days. Each adult opens one link
on their phone and taps **Start door hangers**. Everyone's dot and trail show on
one shared map, and the streets in the assigned area turn from grey to green as
they are walked. At the end, the **Streets left** list shows anything missed.

No App Store, no accounts, no cost. It is a web page that phones open in
Safari or Chrome, and it can be added to the home screen like an app.

> **Temporary home.** This folder lives in the Concord Table Tennis Club repo
> only while the idea is sketched out. It has nothing to do with the club. Move
> it to its own repository before using it (see *Hosting*). **Do not merge it
> into the club's `main` branch.** That branch is the club website, so the app
> would go live at `concordtabletennisclub.com/scout-door-hangers/`.

## How the day works

1. **Night before:** the organizer opens the app, picks **Organizer: start a
   new event**, then on the **Event** tab taps **Set area and get streets**.
   They tap the corners of the neighbourhood on the map. The app fetches every
   residential street inside it from OpenStreetMap.
2. **Share:** the Event tab has a link and a QR code. Text the link to the
   adults, or let them scan the code at the meeting spot. Each adult enters
   their name and picks the group colour.
3. **Go:** everyone taps **Start door hangers** at their starting point. Each
   phone sends its position every few seconds. Every other phone sees the dots
   move and the trails grow in each group's colour.
4. **Coverage:** a street section counts as covered when someone's trail
   passes within about 25 m of it (sidewalk distance plus GPS error). The top
   bar shows the percentage. If GPS missed a street (phone locked, poor
   signal), tap it and choose **Mark this street section done**.
5. **Wrap-up:** **Menu > Streets left** lists the unfinished streets, the
   biggest gaps first. Tap one to zoom to it. Screenshot the final map for the
   troop, then the organizer taps **Delete all event data**.

## The one big limitation: keep the screen on

A web page cannot track location while the phone is locked or another app is
in front. This is true on iPhones and mostly true on Android. Getting around it
is the main thing a real App Store app could do that this can't. The app
handles it this way:

- It asks the phone to keep the screen awake while tracking. Recent iPhones
  (iOS 16.4 and later) and Android Chrome support this. If a phone can't, the
  app says so. Then set **Auto-Lock to Never** for the day (Settings > Display
  & Brightness).
- Trail lines break across gaps rather than drawing a false straight line. The
  app also tells you when your trail paused.
- Any street the GPS missed can be marked done by hand.

In practice: one phone per group tracks, held in hand or in a lanyard pouch with
the screen on. Bring a battery pack: screen and GPS together use roughly
15–25% battery per hour.

If background tracking turns out to matter a lot, the fallback is an existing
free app that already has App Store approval (for example, Google Maps location
sharing for the dots). You lose the street coverage view that way.

## Hosting

**Recommended: GitHub Pages for the page + Firebase Realtime Database for the
live data.** Both are free at this size and need no server to look after.

| Piece | Choice | Why |
| --- | --- | --- |
| Web page | GitHub Pages | Free and HTTPS (phones only give location to HTTPS pages). Deploys on every push. |
| Live data | Firebase Realtime Database, free Spark plan | Pushes changes to every open phone within a second. Queues writes while a phone has no signal. Needs no credit card. |
| Sign-in | Firebase anonymous sign-in | Nobody makes an account. The unguessable event code in the link is the key. |
| Map | Leaflet + OpenStreetMap tiles | Free and needs no API key. Fine for a one-day event with a handful of phones. |
| Streets | OpenStreetMap Overpass API | One query when the organizer sets the area. |

**Does it fit the free tier?** Firebase's free plan allows 100 simultaneous
connections, 1 GB stored and 10 GB downloaded a month. Here is a rough count
for a troop day: 10 adults × 3 hours at a trail point every ~8 m comes to about
15,000 points. That is about 1.5 MB of data. Each phone downloads all of it
once, so about 15 MB in total. That is well under 1% of the free allowance.

**Options considered and not chosen:**

- *Google Apps Script + a Google Sheet:* slow to update (polling, not push),
  with tight daily quotas. Fine for forms, poor for live dots.
- *Supabase:* also good and also free. Free projects pause after a week idle,
  which is awkward for a once-a-season event.
- *Your own server (Cloudflare Workers, a small VPS):* more control, but more
  to build and keep running.
- *Firebase Hosting instead of GitHub Pages:* works equally well. GitHub Pages
  keeps the code and the published page in one place.

### Setting it up (about 20 minutes, once)

Use a Google account that belongs to the troop (or to you), **not** the table
tennis club's account.

1. **Own repository:** make a new GitHub repository (e.g. `troop-door-hangers`).
   Copy this folder's files to its root. Under Settings > Pages, choose
   *Deploy from a branch*, `main`, `/ (root)`. The site appears at
   `https://<you>.github.io/troop-door-hangers/`.
2. **Firebase project:** at <https://console.firebase.google.com> create a
   project (Google Analytics not needed).
3. **Anonymous sign-in:** Build > Authentication > Get started > Sign-in method
   > **Anonymous** > Enable.
4. **Database:** Build > Realtime Database > Create database (choose the US
   location) > start in *locked mode*. Then on the **Rules** tab, paste the
   contents of [`firebase-rules.json`](firebase-rules.json) and Publish.
5. **Connect the page:** Project settings > General > Your apps > add a **Web**
   app. Copy the `firebaseConfig` values into [`config.js`](config.js) and
   push. These values are not secret; the rules protect the data. Optionally,
   in Google Cloud console > APIs & Services > Credentials, restrict the API
   key to your Pages address.
6. **Try it:** open the site on two phones, create an event on one and join
   from the other with the link.

### Who can see what

- The database can't list events. You can only read an event if you have its
  code (8 random characters, about a trillion possibilities).
- Each phone can write only its own position and trail.
- Only the phone that created the event can change the area or delete the
  event. Anyone in the event can mark streets done.
- Track only adults' phones and use adults' names. Scouts' names and positions
  never go in. Delete the event when the day is done.

## Trying it without Firebase (demo mode)

With `FIREBASE_CONFIG = null` in `config.js`, the app runs in demo mode. Data
stays in that one browser, though it is shared between its tabs.

```sh
cd scout-door-hangers
python3 -m http.server 8080     # then open http://localhost:8080
node check-coverage.js          # coverage math checks
```

Create an event, then on the Event tab tap **Simulate 3 walkers (demo)**. If no
area is set, it draws a pretend 5×5 street grid around the map centre. Three
fake adults then walk it. Open the event link in a second tab and press
**Start door hangers** to join as another adult.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | The page: map, top and bottom bars, join screen, menu |
| `app.js` | Joining, GPS tracking, drawing people, trails and streets, organizer tools |
| `coverage.js` | Street pieces and coverage maths (no browser code; tested by `check-coverage.js`) |
| `store.js` | Shared data: `FirebaseStore` (live) and `LocalStore` (demo) |
| `config.js` | Firebase settings, or `null` for demo mode |
| `firebase-rules.json` | Database security rules to paste into Firebase |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Add to Home Screen name and icons |
| `brand/` | The troop logo (see below) |

## The logo

`brand/logo.svg` is the troop's uniform patches, digitized from a photo of a
sleeve: the Golden Gate Area Council shoulder patch with the red 444 unit
numerals below it. It is a vector drawing, so it stays sharp at any size.

| File | Use |
| --- | --- |
| `brand/logo.svg` | Master copy, transparent background, any size |
| `brand/logo-2400.png`, `brand/logo-600.png` | Ready-made PNGs (transparent) for print, slides, chat |
| `brand/icon.svg` | Square app icon on uniform blue |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Home-screen icons (iPhones need the PNG) |

To change it, edit `brand/make-logo.py` (colours are at the top), then rebuild:

```sh
pip install fonttools
# Nunito Black: from github.com/google/fonts (ofl/nunito), set to weight 900:
python3 -m fontTools.varLib.instancer 'Nunito[wght].ttf' wght=900 -o nunito900.ttf
python3 brand/make-logo.py nunito900.ttf brand
node brand/render-png.cjs        # needs Playwright
```

The lettering is Nunito Black (SIL Open Font License), converted to outlines.
The council patch design and the Scouting fleur-de-lis belong to the Golden
Gate Area Council and Scouting America. Using them inside the troop's own app
is ordinary unit use. Check with the council before putting the logo on
anything sold or published more widely.

## Not built yet (ideas)

- **Assign streets to groups before the day,** shown in each group's colour, so
  each group can see its own list.
- **Both sides of the street:** a wide street may need one pass per side. Right
  now one pass counts for both.
- **House-level view:** OpenStreetMap has address points for some
  neighbourhoods. Where it does, the app could show houses rather than streets.
- **End-of-day export:** a picture or GPX file of the final map for the troop's
  records, and automatic deletion of event data after a set time.
- **Tested on real phones with Firebase:** demo mode and the coverage maths are
  tested. The Firebase connection is written but has not yet run against a real
  project.
