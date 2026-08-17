# Chauhaddi

**A property geometry workbench for Indian litigation.** It reads the *Schedule of Property* out of a
deed, reconstructs the plot the words describe, and tells you where the documents contradict each other
— then shows you the answer in 3D, and in VR if you have a headset.

Runs entirely in the browser. **No server, no upload, no analytics.** Client documents are privileged and
land records contain personal data under the DPDP Act 2023, so the only defensible architecture is one
that *cannot* transmit them.

---

## Why

In an Indian property dispute the decisive question is almost always geometric, and every document that
describes it is prose:

> *North: 40 feet, adjoining property of Ram Lal; East: 25 feet, adjoining 20-ft wide municipal road;
> South: 40 feet…  Total admeasuring 1,000 sq. ft., Khasra No. 412/2*

That is a closed polygon written in words — which means it is computable. A single plot gets described
five different ways across seventy years, in a partition deed, a jamabandi entry, an FMB sketch, a later
sale deed and a commissioner's sketch, and **nobody ever lays those five descriptions on top of each
other.** When you do, they disagree. Those disagreements are the case.

The most valuable output of this tool is not the 3D view. It is a boring table saying the 1974 deed and
the 2019 deed disagree by three feet three inches.

## What it does

- **Parses the chauhaddi.** Direction words in English plus Hindi, Marathi, Punjabi and southern-language
  transliterations. Lengths as `40'-6"`, `40 feet 6 inches`, `12.5 m`, `30 gaj`, `22 links`, `5 karam`.
  Areas in sq ft, sq m, gaj, acres, guntha, cents, kanal, marla, ground, ankanam — and it refuses to
  guess at bigha, katha or biswa, because those vary by district.
- **Finds the contradictions.** Opposite sides that don't match. A stated area that doesn't follow from
  the stated dimensions. A boundary recited at a length it geometrically cannot be. For surveyed
  descriptions, a true traverse closure error and precision ratio.
- **Compares outlines.** Overlap, area held by one document and not the other, per-side extents, and the
  total square footage actually in dispute.
- **Models the building.** Floors stacked on a footprint, coloured by allottee — a partition of a
  multi-storey house, or the floor-split in a development agreement.
- **Runs a light-and-air study.** Minutes of direct sunlight at a stated opening, with and without the
  neighbour's mass, on the solstices and equinox. For a s.15 Easements Act claim this is the case.
- **Traces over a plan.** Drop in an FMB sketch or sanctioned plan and fit it by hand.
- **Keeps provenance.** SHA-256 of every file at ingest, a manifest of every assumption, and a drafted
  s.63 BSA certificate with the hashes filled in.
- **VR.** Walk the plot at 1:1 on a Quest, or put the whole matter on a table at 1:50.

## What it is not

**Nothing this tool produces is evidence of a boundary.** It produces *demonstrative* material — an
illustration of evidence, which is a different thing, and the distinction decides whether it helps you or
embarrasses you. Read `docs/evidence.md`.

Every outline carries an **accuracy tier**, shown on screen at all times:

| Tier | Source | Weight |
|---|---|---|
| **A** | Instrument survey — total station, DGPS, CORS | The only tier that may be presented as measurement, and only by the surveyor who took it |
| **B** | Sanctioned plan or FMB sketch, georeferenced | Sub-metre in principle; scanned sheets warp, so report the residual |
| **C** | Cadastral portal parcel (Bhu-Naksha etc.) | Indicative only. The portals disclaim positional accuracy. Never argue a boundary from Tier C |
| **D** | Deed recital reconstruction | Finds contradictions. Says nothing about where a line runs on the ground |
| **E** | Satellite or drone imagery | Good for change over time. Kerala courts have cautioned expressly against treating it as conclusive |

Dashed on screen means inferred. Solid means measured. This is not decoration — it is the thing that keeps
a reconstruction from being overclaimed in cross-examination.

## Live

**https://chauhaddi.netlify.app**

Press **Example** for a worked matter: two deeds for the same plot 45 years apart, plus a survey that
agrees with neither.

## Running it locally

Static files, no build step:

```bash
python3 -m http.server 8123
```

Then visit `http://localhost:8123`.

WebXR needs a secure context, so the VR mode works from the live HTTPS URL or from `localhost`, but
**not** from a plain `http://` LAN address. The failure there is silent: no ENTER VR button and no
error. Use the live URL on the headset.

## Getting a document in, on a headset

**You cannot drop a PDF while wearing the headset.** A file picker is 2D system UI, and an immersive
WebXR session replaces the DOM entirely, so there is nothing for a picker to open into. The WebXR
DOM Overlay module that would allow HTML during a session is an AR feature and Quest Browser does
not offer it for immersive VR. This is a platform limit, not something this app can work around.

So the order is: **ingest flat, then go in.**

1. Open https://chauhaddi.netlify.app in Quest Browser. It starts as an ordinary 2D window.
2. Drop the file or paste the schedule, parse it, verify the calls, add the outline.
3. Tap **ENTER VR**.

From inside VR, **Y** (left controller) or **B** (right) ends the session and returns you to this
page with the ingest panel open and the drop zone highlighted. Add the outline, then tap ENTER VR
again. That round trip is the closest thing to adding a document from inside VR, and it is
deliberate rather than a workaround: the session has to end for the picker to exist at all.

Two things worth knowing before you rely on the headset for ingest:

- **Quest Browser will not always hand the bytes to the page.** It has a long-standing quirk where
  `<input type="file">` accepts a file of certain extensions and then refuses JavaScript access to
  its contents. If a file reads as zero bytes the app says so explicitly rather than failing
  quietly. Paste the schedule text instead, which always works.
- **Most registered Indian deeds are scans**, with no text layer to extract, so on a headset you
  would be retyping into a virtual keyboard. Prepare the matter on a laptop, **Save** the project
  JSON, and open it on the headset. Better still, treat VR as a viewer: it is for scale intuition,
  client conferences, witness preparation and mediation, none of which need a document ingested
  while you are wearing it.

## Deploying

```bash
./deploy.sh
```

Zips the site and posts it to Netlify. The auth token is read from the Netlify CLI's own config on
your machine, so nothing secret lives in this repository. If you have never logged in here, run
`npx netlify-cli login` once first.

## Prepare on a laptop, view on the headset

Everything lives in the browser it was prepared in, so a matter built on your Mac is not on your
headset. Move it across like this, without any of it touching a cloud:

```bash
./share-matter.sh          # serves the newest saved matter over your own wifi
```

Press **Save** in the app first. The script prints a short URL. Then on the headset, in Quest Browser:

1. open `http://<your-mac>:8777/m.txt` — downloads the matter
2. open `https://chauhaddi.netlify.app` — the app itself, on a real certificate, so VR works
3. tap **Open** and pick the file you just downloaded
4. tap **ENTER VR**

The app has to come from the live HTTPS URL rather than from your Mac, because WebXR needs a secure
context and a self-signed LAN certificate makes that fragile. The *matter* comes from your Mac. So
the geometry never leaves your network and the headset still gets a certificate it trusts.

**If step 3 fails**, and it may — Quest Browser has a habit of accepting a file and then refusing the
page its contents — open the same URL again, select all, copy, and paste it into **Export → Project
text** instead. Same result, no file picker involved. That box also has a **Copy this matter** button
for going the other way.

## Using it on a real matter

1. **Provenance first.** Drop the source PDFs on the *Provenance* tab so they are hashed before anything
   is derived from them.
2. **Parse, then verify every call.** The quoted source line sits under each row. Nothing is trusted until
   you confirm it — an unverified extraction in a legal tool is worse than no extraction.
3. **Set the tier honestly.** A reconstruction from words is Tier D no matter how confident it looks.
4. **Add a second outline.** One outline tells you almost nothing. The tool exists for the disagreement.
5. **Commission a survey for anything that matters.** A licensed surveyor with a total station on one plot
   runs roughly ₹10,000–40,000, and it is the only route to Tier A.
6. **Export the discrepancy schedule** and print it to PDF. That is what goes in the file.

## Caveats worth knowing before you rely on it

- **A scanned PDF has no text layer**, and most registered Indian deeds are scans. Retype the schedule.
- **A chauhaddi states no angles.** Four side lengths do not determine a quadrilateral. The tool takes the
  least-assumption reading — north and south parallel and centred, separated by the mean of east and west
  — and discloses that assumption in every export. A different assumption gives a different figure.
- **Overlap depends on alignment,** which is a choice. Whichever you use must be stated.
- **Datum shift is a real and silent source of apparent encroachment.** Indian cadastral records sit on
  legacy local grids and Everest-datum references; modern survey output is WGS84/UTM 43–44N. This tool
  works in a local plane and does not reproject. Do not overlay a georeferenced source onto a local-grid
  survey without a surveyor reducing them to a common datum first.
- **Symmetric-difference area is exact only for convex outlines.** Non-convex ones are flagged.
- **Everything is held in your browser.** Clearing site data loses the matter. Use **Save** for anything
  real.

## Do not

- Present any output as a survey. Only a licensed surveyor certifies a measurement.
- Pipe client documents through a third-party model API. This tool has no network calls by design; keep
  it that way.
- Market this externally without checking the Bar Council rules on advertising. Internal use is fine.

## Layout

```
index.html          shell
css/app.css         a survey drawing office, not a SaaS dashboard
js/units.js         canonical metres; Indian length and area units
js/parse.js         Schedule of Property -> structured boundary calls
js/geom.js          reconstruction, closure, area reconciliation, overlap
js/sun.js           solar position for light-and-air claims
js/scene3d.js       three.js viewport, WebXR
js/report.js        the discrepancy schedule
js/store.js         project state, file hashing, s.63 certificate draft
docs/evidence.md    how this gets into a record, and how it gets excluded
deploy.sh           redeploy to Netlify
share-matter.sh     hand a saved matter to a headset over your own wifi
```

Dependencies are loaded from a CDN at runtime: three.js r169 and pdf.js 4.6. Nothing else.

## Licence

MIT. See `LICENSE`.
