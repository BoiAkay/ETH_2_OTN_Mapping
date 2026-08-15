# Ethernet → OTN Mapper

An interactive, single-page visualization of how Ethernet client signals get mapped into
ITU-T G.709 Optical Transport Network (OTN) frames — with the mapping procedure
(**GFP-F**, **BMP**, or **GMP**) chosen by you, not hard-coded.

Pick a client rate (1GbE / 10GbE LAN / 10GbE WAN / 40GbE / 100GbE) and a mapping procedure,
type a short sample payload, and watch it flow through:

```
Ethernet MAC frame → [GFP-F | BMP | GMP overhead] → OPU payload → ODU → OTU
```

The GFP-F stage is not decorative — the Core Header (PLI, cHEC) and Payload Header
(Type, tHEC) are computed live in the browser using the actual G.7041 CRC-16 polynomial
(`x¹⁶+x¹²+x⁵+1`, init 0) and standard Ethernet CRC-32, from whatever text you type in.
The OTU frame diagram at the bottom is rendered true-to-scale (4 rows × 4080 columns) and
is clickable, region by region.

## Running it

It's a single static HTML file with no build step and no dependencies beyond two Google
Fonts loaded over CDN. Just open `index.html` in a browser, or serve the folder with
anything that serves static files:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Putting it on GitHub

```bash
cd otn-ethernet-mapper
git init
git add .
git commit -m "Ethernet to OTN mapping visualizer"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

To serve it live for free with GitHub Pages: repo **Settings → Pages → Deploy from a
branch → main / (root)**. It'll be live at
`https://<your-username>.github.io/<repo-name>/` a minute or two later.

## What's accurate, and what's illustrative

- **Frame structure & column ranges** (FAS, OTU OH, ODU OH, OPU OH, OPU payload, FEC) —
  per ITU-T G.709.
- **GFP-F header fields** — per ITU-T G.7041, computed with the real CRCs and the
  standard UPI=0x01 codepoint for frame-mapped Ethernet.
- **Container rates** (ODU0, ODU2, ODU2e, ODU3, ODU3e2, ODU4) — published nominal rates
  from ITU-T G.709 and vendor mapping references.
- **BMP and GMP visualizations** are conceptual simplifications of the justification
  process, meant to build intuition. Real BMP/GMP hardware logic (JC/NJO/PJO byte
  positions, the exact per-frame Cm signaling sequence) is more involved than what's
  animated here — this is a teaching tool, not a bit-exact encoder.

## Standards referenced

- ITU-T G.709 — *Interfaces for the optical transport network*
- ITU-T G.7041 / Y.1303 — *Generic framing procedure (GFP)*
- ITU-T G.798 — OTN equipment functional blocks (background reading for JC/PJO/NJO detail)
