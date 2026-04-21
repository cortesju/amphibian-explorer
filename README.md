# Colombia Amphibian Explorer

A web map replicating the Audubon Bird Migration Explorer but for 24 endemic/threatened Colombian amphibian species using iNaturalist observation data.

---

## Project Structure

```
WebMap589/
├── index.html                  ← The web app (open this in a browser)
├── css/style.css               ← All styling
├── js/
│   ├── config.js               ← ⚠ YOU EDIT THIS — paste your service URLs here
│   └── app.js                  ← Main map logic (ArcGIS JS API 4.29)
├── data/
│   └── species.json            ← Auto-generated species metadata
├── scripts/
│   ├── 01_process_csv.py       ← ArcGIS Pro: CSV → Point feature class
│   ├── 02_create_hexbins.py    ← ArcGIS Pro: Points → Time-enabled hex bins
│   ├── 03_create_ranges.py     ← ArcGIS Pro: Points → Seasonal range polygons
│   └── 04_generate_species_json.py  ← Standalone: regenerate species.json
└── 18 rare Frog joinTableCSV.csv   ← Your source data
```

---

## Step-by-Step Workflow

### Phase 1 — ArcGIS Pro Data Preparation

Run these scripts **in order** from the ArcGIS Pro Python window  
(`Analysis` → `Python` → paste the script path and run):

#### Step 1 — Process the CSV into a Feature Class
```
scripts/01_process_csv.py
```
- Reads `18 rare Frog joinTableCSV.csv`
- Creates `AmphibianMap.gdb` in your project folder
- Outputs: `amphibians_points` feature class
- Adds: `species_code`, `week` (1–52), `week_date` (year-1000 synthetic date)

#### Step 2 — Create Time-Enabled Hex Bins
```
scripts/02_create_hexbins.py
```
- Generates a 50 km² hexagonal tessellation over Colombia
- Spatially joins observations → counts per (hex × species × week)
- Outputs: `amphibians_hexbins` feature class
- Fields: `hex_id`, `species_code`, `obs_count`, `week`, `week_date`, `abund_iso` (1–5)

#### Step 3 — Create Seasonal Range Polygons
```
scripts/03_create_ranges.py
```
- Groups observations by species + Colombia season (wet/dry)
- Computes convex hull polygon per group
- Outputs: `amphibians_ranges` feature class
- Season values: `wet_season_1`, `dry_season_1`, `wet_season_2`, `dry_season_2`, `year_round`

---

### Phase 2 — Publish to ArcGIS Online

Do this **twice** — once per feature class:

1. Open ArcGIS Pro → add the feature class to a Map
2. **For `amphibians_hexbins` only**: Right-click layer → Properties → **Time** tab
   - Enable time ✓
   - Start Time Field: `week_date`
   - Time Step Interval: `1 Week`
3. Right-click layer → **Share** → **Web Layer** → Publish
4. Settings:
   - Layer Type: **Feature Layer**
   - Enable capabilities: **Feature Access** ✓ and **Query** ✓
   - Make the layer **Public** (Everyone can view)
5. After publishing, go to **ArcGIS Online** → **Content** → click the layer
6. Scroll down to the **URL** field → copy it (ends in `/FeatureServer/0`)
7. Open `js/config.js` and paste both URLs:
   ```js
   hexBins: "https://services.arcgis.com/PASTE_ORG_HASH/.../FeatureServer/0",
   ranges:  "https://services.arcgis.com/PASTE_ORG_HASH/.../FeatureServer/0",
   ```

---

### Phase 3 — Deploy to GitHub Pages

#### First time setup:
```bash
# 1. Create a new repo on github.com named:  amphibian-explorer
#    Go to github.com/new → name it "amphibian-explorer" → Public → Create

# 2. In your WebMap589 folder, open PowerShell or Git Bash and run:
git init
git add .
git commit -m "Initial commit — Colombia Amphibian Explorer"
git branch -M main
git remote add origin https://github.com/cortesju/amphibian-explorer.git
git push -u origin main

# 3. On GitHub.com → your repo → Settings → Pages
#    Source: "Deploy from branch"
#    Branch: main  /  Folder: / (root) → Save

# Your site will be live at:
# https://cortesju.github.io/amphibian-explorer/
```

#### Every time you update the data:
```bash
git add .
git commit -m "Update species data / fix"
git push
# GitHub Pages automatically rebuilds in ~1 minute
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause animation |
| `→` | Next week |
| `←` | Previous week |

---

## ArcGIS Pro Checklist

- [ ] Script 01 ran successfully → `amphibians_points` exists in GDB
- [ ] Script 02 ran successfully → `amphibians_hexbins` exists in GDB
- [ ] Script 03 ran successfully → `amphibians_ranges` exists in GDB
- [ ] `amphibians_hexbins` published to AGOL with time enabled
- [ ] `amphibians_ranges` published to AGOL as public feature layer
- [ ] Both service URLs pasted into `js/config.js`
- [ ] `PASTE_YOUR_ORG_HASH_HERE` in `js/config.js` replaced with real service URLs
- [ ] GitHub repo created and site deployed

---

## Customization

### Change hex bin size
In `scripts/02_create_hexbins.py`:
```python
HEX_AREA_KM2 = 50   # increase for faster loading, decrease for more detail
```

### Change IUCN status colors
In `scripts/04_generate_species_json.py`:
```python
IUCN_STATUS = { "Espadarana prosoblepon": "LC", ... }
```
Update any status codes, then re-run the script and `git push`.

### Change basemap
In `js/config.js`:
```js
basemap: "gray-vector",   // try: "topo-vector", "dark-gray-vector", "oceans"
```

### Change animation speed
```js
animationFps: 8,   // frames per second
```

---

## Data Sources

- **Observations**: [iNaturalist](https://www.inaturalist.org) (CC-BY-NC)
- **Basemap**: Esri / ArcGIS Online
- **Hex bins + ranges**: Derived from iNaturalist CSV using ArcGIS Pro
- **IUCN status**: [IUCN Red List](https://www.iucnredlist.org)
