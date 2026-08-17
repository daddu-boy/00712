# How this gets into a record — and how it gets excluded

Read this before using any output of this tool in a proceeding.

## The distinction that decides everything

A model you construct is **demonstrative**, not substantive. It illustrates evidence about land; it is not
evidence of the land. Nothing this tool produces will ever be exhibited as proof of a boundary standing on
its own, and designing as though it might is how these tools get excluded and embarrass the people who
brought them.

What you *can* prove with it, without any survey at all, is that **a document contradicts itself**. A
schedule reciting dimensions that do not compute to the area recited in the same schedule is a defect on
the face of the title deed. That finding is not demonstrative — it is an arithmetical fact about the
document, and the document is already exhibited.

## The four routes in

**1 — As a visual aid to expert testimony.**
A licensed surveyor or architect deposes; the model illustrates their opinion. Expert opinion is relevant
under **BSA 2023 s.39** (formerly Evidence Act s.45). The witness is the evidence. You are the exhibit.

**2 — Annexed to a commissioner's report.**
Where a commissioner is appointed under **O.26 r.9 CPC** (local investigation) or **O.26 rr.13–14 CPC**
(commission to make a partition), the report and the evidence taken become part of the record under
**O.26 r.10(2)**. If the commissioner or the court-appointed surveyor adopts your outputs, they enter the
record with the report.

This is by some distance the cleanest path, and it should shape what you export: give the commissioner
something they would be willing to sign — a plate set with dimensions, a stated method, and a disclosed
assumption list. Not a render.

**3 — Riding on government source layers.**
**BSA 2023 s.30** (formerly s.36) makes statements in published maps or charts generally offered for public
sale, and in maps or plans made under the authority of the Central or a State Government, relevant facts in
themselves. So Bhu-Naksha parcels, FMB sketches, Survey of India sheets and Bhuvan imagery carry relevance
independently.

Your derived model does not inherit that relevance. It inherits *credibility* — and only if it cites those
sources precisely enough that the citation can be checked.

**4 — Through the court's own powers.**
**O.18 r.18 CPC** lets the court inspect the property. **BSA s.168** (formerly s.165) lets the judge ask
anything. A model is most useful as preparation for a site inspection, not as a substitute for one.

## Electronic-record compliance got stricter, not looser

**BSA 2023 s.63** replaced Evidence Act s.65B with effect from **1 July 2024**, and tightened the
requirements. The certificate must now be signed by **both** the person in charge of the device **and** an
expert, and it must state the **hash value** of the record.

This tool therefore:

- hashes every input file with SHA-256 at ingest, in the browser;
- records which document, page and quoted line produced which figure;
- exports a manifest and a **draft** s.63 certificate with the hashes filled in.

The draft is a draft. Two signatures cannot be supplied by software, and the blanks are left visible so
nobody files it without reading it.

## The four attacks, and the answer to each

**"It is a simulation. It is prejudicial."**
Answer with aesthetic restraint held as a discipline. Flat grey masses, hairline edges, no textures, no
sky, no furniture, no dramatic lighting, no camera swoops. Every element labelled with its dimension and
its source. Anything that looks like an architect's marketing render is a liability, and the plainness is
the argument.

**"You chose the assumptions."**
A chauhaddi states the length of each boundary and no angles. Four side lengths do not determine a
quadrilateral, so *some* assumption is unavoidable. The answer is not to hide it: the assumption list is
part of every export, and the honest position is that a different assumption produces a different figure of
the same area.

Build the opponent's version in the same tool and show both. Being able to render your opponent's case from
the same data is the single largest credibility unlock available to you.

**"It is not authenticated."**
Hash manifest, s.63 certificate, surveyor's affidavit. Exported as a bundle rather than assembled after the
fact.

**"The imagery is unreliable."**
Already litigated, and the position is settled enough to design to. The Karnataka High Court accepted state
remote-sensing imagery as prima facie evidence of forest encroachment in *M/s V.S. Lad & Sons v. State of
Karnataka* (2009). Kerala courts have cautioned expressly — in *Pappinisseri Eco Tourism Society* and
*Ansari Kannoth* — that Google Earth gives only satellite imagery, does not account for cloud cover, and
need not present a clear picture of the area.

Corroborative, never conclusive. So: imagery for change over time, never for boundaries. That is why
Tier E exists and why it sits at the bottom.

## The failure mode that kills the project

One model presented with more confidence than its accuracy tier supports, taken apart in
cross-examination, and the firm never touches the tool again.

The tier labels are not decoration. A Tier D reconstruction is a statement about what a document's words
imply. It is not a statement about where a line runs on the ground, and the moment it is offered as one,
everything else you have built loses its value too.

## Two things to settle with the firm before real use

**Confidentiality and DPDP.** Deeds carry owner names, addresses and family structures — personal data
under the Digital Personal Data Protection Act 2023 — and the underlying files are privileged. This tool
makes no network calls, which is the point. Do not add any. Do not route client documents through a
third-party model API without confirming the firm's position and its engagement terms.

**Scope of practice.** The tool reconciles documents and illustrates positions. It does not measure land,
and it must never output anything resembling a survey certificate. Only a licensed surveyor certifies a
measurement.
