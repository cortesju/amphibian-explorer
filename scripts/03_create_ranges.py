"""
SCRIPT 03 — Create Seasonal Range Polygons
Produces convex-hull range polygons per species × season.

Colombia has two rainy seasons:
  wet_1  = March–May   (first rainy season / amphibian breeding peak 1)
  dry_1  = June–August (dry season)
  wet_2  = Sept–Nov    (second rainy season / breeding peak 2)
  dry_2  = Dec–Feb     (dry season)

OUTPUT: "amphibians_ranges"  in AmphibianMap.gdb
        → Publish to ArcGIS Online as a Feature Layer

NOTE: This script reads amphibians_points as read-only (no schema changes)
      so it works even if the layer is open in ArcGIS Pro.
"""

import arcpy
import os
from collections import defaultdict

# ─── USER SETTINGS ────────────────────────────────────────────────────────────
GDB_PATH      = r"D:\websites\WebMap589\AmphibianMap.gdb"
POINTS_FC     = "amphibians_points"
RANGES_OUTPUT = "amphibians_ranges"

# Land polygon for clipping — removes ocean/straight-edge artifacts.
# Use "World_Countries" if it is loaded in your ArcGIS Pro map (just the layer name).
# Or set to a full path like r"C:\...\World_Countries.shp"
# Set to None to skip clipping.
CLIP_LAYER    = None   # set to "World_Countries" only when running inside ArcGIS Pro Python window
# ──────────────────────────────────────────────────────────────────────────────

arcpy.env.workspace       = GDB_PATH
arcpy.env.overwriteOutput = True

sr_wgs = arcpy.SpatialReference(4326)

def month_to_season(month):
    if   month in (3, 4, 5):   return "wet_season_1"
    elif month in (6, 7, 8):   return "dry_season_1"
    elif month in (9, 10, 11): return "wet_season_2"
    else:                      return "dry_season_2"

SEASON_LABELS = {
    "wet_season_1": "Rainy Season 1 (Mar-May)",
    "dry_season_1": "Dry Season 1 (Jun-Aug)",
    "wet_season_2": "Rainy Season 2 (Sep-Nov)",
    "dry_season_2": "Dry Season 2 (Dec-Feb)",
}

points_path = os.path.join(GDB_PATH, POINTS_FC)
ranges_path = os.path.join(GDB_PATH, RANGES_OUTPUT)

# Colombia bounding box — excludes observations clearly outside Colombia
# (misidentified records, captive animals in zoos, data entry errors)
# Covers all Colombian territory including Pacific islands and Amazonia
COL_XMIN, COL_XMAX = -79.0, -66.5
COL_YMIN, COL_YMAX =  -4.5,  13.5

def in_colombia(x, y):
    return COL_XMIN <= x <= COL_XMAX and COL_YMIN <= y <= COL_YMAX

# ── 1. Read all points into memory (read-only — no lock needed) ───────────────
print("Reading points into memory ...")

seasonal_groups = defaultdict(lambda: {"pts": [], "sci": "", "com": ""})
all_groups      = defaultdict(lambda: {"pts": [], "sci": "", "com": ""})
skipped_outliers = 0

with arcpy.da.SearchCursor(
        points_path,
        ["species_code", "observed_on", "SHAPE@XY",
         "scientific_name", "common_name"]) as cur:
    for sp_code, obs_date, xy, sci, com in cur:
        if not obs_date or not xy:
            continue
        # Skip observations outside Colombia
        if not in_colombia(xy[0], xy[1]):
            skipped_outliers += 1
            continue
        season = month_to_season(obs_date.month)
        key    = (sp_code, season)
        seasonal_groups[key]["pts"].append(xy)
        seasonal_groups[key]["sci"] = sci
        seasonal_groups[key]["com"] = com

        all_groups[sp_code]["pts"].append(xy)
        all_groups[sp_code]["sci"] = sci
        all_groups[sp_code]["com"] = com

print(f"  {len(seasonal_groups)} (species x season) groups, {len(all_groups)} species total")
if skipped_outliers:
    print(f"  Skipped {skipped_outliers} observations outside Colombia bounding box")

# ── 2. Create output feature class ────────────────────────────────────────────
print("Creating output feature class ...")

if arcpy.Exists(ranges_path):
    arcpy.management.Delete(ranges_path)

arcpy.management.CreateFeatureclass(GDB_PATH, RANGES_OUTPUT, "POLYGON",
                                    spatial_reference=sr_wgs)

for fname, ftype, falias, flen in [
    ("species_code",    "TEXT",  "Species Code",      80),
    ("scientific_name", "TEXT",  "Scientific Name",  100),
    ("common_name",     "TEXT",  "Common Name",      100),
    ("season",          "TEXT",  "Season",            20),
    ("season_label",    "TEXT",  "Season Label",      60),
    ("obs_count",       "SHORT", "Observation Count", None),
]:
    if ftype == "TEXT":
        arcpy.management.AddField(ranges_path, fname, ftype,
                                  field_alias=falias, field_length=flen)
    else:
        arcpy.management.AddField(ranges_path, fname, ftype, field_alias=falias)

# ── 3. Insert seasonal convex hulls ───────────────────────────────────────────
print("Computing convex hull polygons ...")

insert_fields = ["SHAPE@", "species_code", "scientific_name",
                 "common_name", "season", "season_label", "obs_count"]

skipped = 0
with arcpy.da.InsertCursor(ranges_path, insert_fields) as cur:
    for (sp_code, season), data in sorted(seasonal_groups.items()):
        pts = data["pts"]
        if len(pts) < 3:
            skipped += 1
            continue
        array = arcpy.Array([arcpy.Point(x, y) for x, y in pts])
        hull  = arcpy.Multipoint(array, sr_wgs).convexHull()
        cur.insertRow([hull, sp_code, data["sci"], data["com"],
                       season, SEASON_LABELS.get(season, season), len(pts)])

    # year-round polygons
    for sp_code, data in sorted(all_groups.items()):
        pts = data["pts"]
        if len(pts) < 3:
            continue
        array = arcpy.Array([arcpy.Point(x, y) for x, y in pts])
        hull  = arcpy.Multipoint(array, sr_wgs).convexHull()
        cur.insertRow([hull, sp_code, data["sci"], data["com"],
                       "year_round", "Year-round Known Range", len(pts)])

if skipped:
    print(f"  Skipped {skipped} groups with fewer than 3 points")

final_count = int(arcpy.management.GetCount(ranges_path)[0])
print(f"\nCreated '{RANGES_OUTPUT}' with {final_count} range polygons")

# ── 4. Clip to land polygons ───────────────────────────────────────────────────
if CLIP_LAYER:
    print(f"Clipping to land boundaries using '{CLIP_LAYER}' ...")
    clipped_path = os.path.join(GDB_PATH, RANGES_OUTPUT + "_clipped")
    if arcpy.Exists(clipped_path):
        arcpy.management.Delete(clipped_path)
    arcpy.analysis.PairwiseClip(ranges_path, CLIP_LAYER, clipped_path)
    clipped_count = int(arcpy.management.GetCount(clipped_path)[0])
    print(f"  Clipped result: {clipped_count} polygons -> '{RANGES_OUTPUT}_clipped'")
    print("  Use 'amphibians_ranges_clipped' for publishing (not amphibians_ranges)")
else:
    print("  Skipping clip (CLIP_LAYER is None)")

print("""
NEXT STEPS IN ARCGIS PRO:
  1. Add 'amphibians_hexbins' and 'amphibians_ranges' to a map
  2. For amphibians_hexbins: Properties -> Time tab
       Start Time Field: week_date  |  Step: 1 Week
  3. Share -> Web Layer -> Publish both layers to ArcGIS Online
       Name: amphibian_hexbins  /  amphibian_ranges
       Enable: Feature Access + Query, set to Public
  4. Copy each service URL and paste into js/config.js
""")
