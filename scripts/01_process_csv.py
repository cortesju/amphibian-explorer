"""
SCRIPT 01 — Process iNaturalist CSV → Point Feature Class
Run this inside ArcGIS Pro (Analysis > Python window) or as a standalone script
with the ArcGIS Pro Python environment active.

INPUT : "18 rare Frog joinTableCSV.csv"  (in your project folder)
OUTPUT: Geodatabase feature class  "amphibians_points"  +  a copy on disk
"""

import arcpy
import csv
import os
import re
from datetime import datetime, timedelta

# ─── USER SETTINGS ────────────────────────────────────────────────────────────
CSV_PATH   = r"D:\websites\WebMap589\18 rare Frog joinTableCSV.csv"
GDB_PATH   = r"D:\websites\WebMap589\AmphibianMap.gdb"   # will be created
OUT_FC     = "amphibians_points"
# ──────────────────────────────────────────────────────────────────────────────

def slug(name):
    """Convert scientific name to a safe field/filter value."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

def week_to_synthetic_date(week_num):
    """
    Encode the week-of-year as a date in year 1000 CE.
    This is the same trick Audubon uses so ArcGIS time animation
    cycles correctly across a single annual loop.
    Week 1 = 1000-01-01, week 52 = 1000-12-28
    """
    base = datetime(1000, 1, 1)
    return base + timedelta(weeks=week_num - 1)

def parse_observed_on(raw):
    """Try several date formats present in the iNaturalist export."""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y/%m/%d",
                "%m/%d/%Y %I:%M %p %z", "%m/%d/%Y %I:%M %p"):
        try:
            return datetime.strptime(raw.split()[0], fmt.split()[0])
        except (ValueError, IndexError):
            pass
    return None

# ── 1. Create (or open) geodatabase ───────────────────────────────────────────
if not arcpy.Exists(GDB_PATH):
    arcpy.management.CreateFileGDB(os.path.dirname(GDB_PATH),
                                   os.path.basename(GDB_PATH))
    print("Created GDB:", GDB_PATH)

arcpy.env.workspace = GDB_PATH
arcpy.env.overwriteOutput = True

# ── 2. Read CSV ────────────────────────────────────────────────────────────────
rows = []
with open(CSV_PATH, encoding="latin-1") as f:
    for row in csv.DictReader(f):
        sp = row.get("scientific_name", "").strip()
        if not sp or " " not in sp:          # skip genus-only rows
            continue
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (ValueError, KeyError):
            continue
        obs_date = parse_observed_on(row.get("observed_on", ""))
        if obs_date is None:
            continue
        week_num  = int(obs_date.strftime("%W")) or 1    # ISO week 0→1
        syn_date  = week_to_synthetic_date(week_num)
        rows.append({
            "lat":           lat,
            "lon":           lon,
            "scientific_name": sp,
            "common_name":   row.get("common_name", "").strip(),
            "species_code":  slug(sp),
            "taxon_id":      row.get("taxon_id", "").strip(),
            "observed_on":   obs_date,
            "week":          week_num,
            "week_date":     syn_date,
            "quality_grade": row.get("quality_grade", "").strip(),
            "image_url":     row.get("image_url", "").strip(),
            "obs_url":       row.get("url", "").strip(),
            "inat_id":       row.get("id", "").strip(),
        })

print(f"Parsed {len(rows)} valid observations from CSV")

# ── 3. Build Feature Class ─────────────────────────────────────────────────────
sr = arcpy.SpatialReference(4326)   # WGS 84
fc_path = os.path.join(GDB_PATH, OUT_FC)

if arcpy.Exists(fc_path):
    arcpy.management.Delete(fc_path)

arcpy.management.CreateFeatureclass(GDB_PATH, OUT_FC, "POINT",
                                    spatial_reference=sr)

# Add fields
fields_def = [
    ("scientific_name", "TEXT",   "Scientific Name",  100),
    ("common_name",     "TEXT",   "Common Name",      100),
    ("species_code",    "TEXT",   "Species Code",      80),
    ("taxon_id",        "TEXT",   "iNaturalist Taxon ID", 20),
    ("observed_on",     "DATE",   "Observed On",        None),
    ("week",            "SHORT",  "Week of Year",       None),
    ("week_date",       "DATE",   "Synthetic Week Date (yr1000)", None),
    ("quality_grade",   "TEXT",   "Quality Grade",      20),
    ("image_url",       "TEXT",   "Photo URL",         500),
    ("obs_url",         "TEXT",   "iNaturalist URL",   300),
    ("inat_id",         "TEXT",   "iNaturalist ID",     30),
]

for fname, ftype, falias, flength in fields_def:
    if ftype == "TEXT":
        arcpy.management.AddField(fc_path, fname, ftype, field_alias=falias,
                                  field_length=flength)
    else:
        arcpy.management.AddField(fc_path, fname, ftype, field_alias=falias)

# ── 4. Insert rows ─────────────────────────────────────────────────────────────
insert_fields = ["SHAPE@XY", "scientific_name", "common_name", "species_code",
                 "taxon_id", "observed_on", "week", "week_date",
                 "quality_grade", "image_url", "obs_url", "inat_id"]

with arcpy.da.InsertCursor(fc_path, insert_fields) as cur:
    for r in rows:
        cur.insertRow([
            (r["lon"], r["lat"]),
            r["scientific_name"], r["common_name"],  r["species_code"],
            r["taxon_id"],        r["observed_on"],   r["week"],
            r["week_date"],       r["quality_grade"], r["image_url"],
            r["obs_url"],         r["inat_id"],
        ])

count = int(arcpy.management.GetCount(fc_path)[0])
print(f"✓ Created '{OUT_FC}' with {count} features in {GDB_PATH}")

print("\nNext step: run  02_create_hexbins.py")
