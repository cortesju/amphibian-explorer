"""
SCRIPT 04 — Generate data/species.json from the iNaturalist CSV.
Run with: python 04_generate_species_json.py
(Does NOT need ArcGIS Pro — plain Python 3 is enough.)

This file is loaded by the web app to populate the species list
and sidebar info panel.
"""

import csv
import json
import os
import re
from datetime import datetime

CSV_PATH  = r"D:\websites\WebMap589\18 rare Frog joinTableCSV.csv"
OUT_PATH  = r"D:\websites\WebMap589\data\species.json"

IUCN_STATUS = {
    # Fill in manually — iNaturalist doesn't export IUCN status.
    # Use: https://www.iucnredlist.org/search?query=<scientific_name>
    # Values: "LC","NT","VU","EN","CR","EW","EX","DD"
    "Espadarana prosoblepon":              "LC",
    "Leptodactylus insularum":             "LC",
    "Dendropsophus columbianus":           "LC",
    "Hyalinobatrachium fleischmanni":      "LC",
    "Cochranella granulosa":               "LC",
    "Pristimantis palmeri":                "VU",
    "Andinobates bombetes":                "EN",
    "Rheobates palmatus":                  "LC",
    "Pristimantis erythropleura":          "EN",
    "Atelopus laetissimus":                "CR",
    "Centrolene savagei":                  "EN",
    "Rulyrana susatamai":                  "LC",
    "Colostethus inguinalis":              "LC",
    "Oophaga lehmanni":                    "CR",
    "Bolitoglossa ramosi":                 "EN",
    "Bolitoglossa vallecula":              "VU",
    "Pristimantis mutabilis":              "VU",
    "Hyalinobatrachium tatayoi":           "EN",
    "Atelopus lozanoi":                    "CR",
    "Dendropsophus ebraccatus":            "LC",
    "Oophaga solanensis":                  "CR",
    "Oophaga anchicayensis":               "CR",
    "Hyalinobatrachium viridissimum":      "LC",
    "Oedipina savagei":                    "DD",
}

IUCN_LABELS = {
    "LC": "Least Concern",   "NT": "Near Threatened",
    "VU": "Vulnerable",      "EN": "Endangered",
    "CR": "Critically Endangered",  "EW": "Extinct in Wild",
    "EX": "Extinct",         "DD": "Data Deficient",
    "NE": "Not Evaluated",
}

IUCN_COLORS = {
    "LC": "#60AA00", "NT": "#CCE226", "VU": "#F9A800",
    "EN": "#FC7F3F", "CR": "#D81E05", "EW": "#542344",
    "EX": "#000000", "DD": "#D1D1C6", "NE": "#AAAAAA",
}

def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

def parse_date(raw):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw.split()[0], fmt)
        except (ValueError, IndexError):
            pass
    return None

# ── Read CSV ──────────────────────────────────────────────────────────────────
species = {}
with open(CSV_PATH, encoding="latin-1") as f:
    for row in csv.DictReader(f):
        sp = row.get("scientific_name", "").strip()
        if not sp or " " not in sp:
            continue
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (ValueError, KeyError):
            continue
        sid = slug(sp)
        if sid not in species:
            species[sid] = {
                "id":              sid,
                "taxon_id":        int(row.get("taxon_id", 0) or 0),
                "scientific_name": sp,
                "common_name":     row.get("common_name", "").strip(),
                "group":           row.get("iconic_taxon_name", "Amphibia").strip(),
                "image_url":       "",
                "inat_url":        f"https://www.inaturalist.org/taxa/{row.get('taxon_id','').strip()}",
                "obs_count":       0,
                "lats":            [],
                "lons":            [],
                "years":           set(),
                "quality_research": 0,
            }
        d = species[sid]
        d["obs_count"] += 1
        d["lats"].append(lat)
        d["lons"].append(lon)
        if not d["image_url"] and row.get("image_url", "").strip():
            d["image_url"] = row["image_url"].strip()
        obs_date = parse_date(row.get("observed_on", ""))
        if obs_date:
            d["years"].add(obs_date.year)
        if row.get("quality_grade", "").strip() == "research":
            d["quality_research"] += 1

# ── Build output list ─────────────────────────────────────────────────────────
output_species = []
for sid, d in sorted(species.items(), key=lambda x: -x[1]["obs_count"]):
    lats = d.pop("lats")
    lons = d.pop("lons")
    yrs  = d.pop("years")

    iucn_code = IUCN_STATUS.get(d["scientific_name"], "NE")

    output_species.append({
        "id":              d["id"],
        "taxon_id":        d["taxon_id"],
        "scientific_name": d["scientific_name"],
        "common_name":     d["common_name"],
        "group":           d["group"],
        "image_url":       d["image_url"],
        "inat_url":        d["inat_url"],
        "obs_count":       d["obs_count"],
        "quality_research_count": d["quality_research"],
        "year_range":      [min(yrs), max(yrs)] if yrs else [None, None],
        "iucn_code":       iucn_code,
        "iucn_label":      IUCN_LABELS.get(iucn_code, "Unknown"),
        "iucn_color":      IUCN_COLORS.get(iucn_code, "#AAAAAA"),
        "iucn_severity":   {"CR":6,"EN":5,"VU":4,"NT":3,"LC":2,"DD":1,"NE":0}.get(iucn_code, 0),
        "centroid":        {
            "lat": round(sum(lats) / len(lats), 4),
            "lon": round(sum(lons) / len(lons), 4),
        },
        "bbox": {
            "xmin": round(min(lons), 4),
            "ymin": round(min(lats), 4),
            "xmax": round(max(lons), 4),
            "ymax": round(max(lats), 4),
        },
        "sound_url":       "",
        "description":     "",
    })

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump({"species": output_species}, f, indent=2, ensure_ascii=False)

print(f"✓ Written {len(output_species)} species to {OUT_PATH}")
for s in output_species:
    print(f"  [{s['iucn_code']:2s}] {s['scientific_name']:<40s} n={s['obs_count']}")
