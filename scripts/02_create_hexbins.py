"""
SCRIPT 02 — Create Time-Enabled Hex Bin Feature Class
Requires: 01_process_csv.py to have been run first.

Produces one row per (hex_id × species_code × week) containing the
observation count — exactly the data model Audubon uses.

OUTPUT: "amphibians_hexbins"  in AmphibianMap.gdb
        → Publish this to ArcGIS Online as a Feature Layer (time-enabled)
"""

import arcpy
import os
from datetime import datetime, timedelta

# ─── USER SETTINGS ────────────────────────────────────────────────────────────
GDB_PATH       = r"D:\websites\WebMap589\AmphibianMap.gdb"
POINTS_FC      = "amphibians_points"       # output of script 01
HEX_OUTPUT_FC  = "amphibians_hexbins"

# Hex size — area in square kilometers.  50 km² ≈ 8 km across, good for Colombia.
# Increase to 150 km² for a sparser, faster-loading layer at global zoom.
HEX_AREA_KM2 = 50

# Colombia + buffer bounding box  (WGS 84)
EXTENT_XY = "-82 -5 -66 13"   # xmin ymin xmax ymax
# ──────────────────────────────────────────────────────────────────────────────

arcpy.env.workspace        = GDB_PATH
arcpy.env.overwriteOutput  = True

def week_to_synthetic_date(week_num):
    base = datetime(1000, 1, 1)
    return base + timedelta(weeks=week_num - 1)

points_path = os.path.join(GDB_PATH, POINTS_FC)
hex_path    = os.path.join(GDB_PATH, HEX_OUTPUT_FC)

# ── 1. Generate hexagonal tessellation ────────────────────────────────────────
print("Generating hexagonal tessellation …")
hex_grid = os.path.join(GDB_PATH, "hex_grid_temp")

sr_eq  = arcpy.SpatialReference(54030)  # World Robinson — equal-area for Colombia
sr_wgs = arcpy.SpatialReference(4326)

arcpy.management.GenerateTessellation(
    hex_grid,
    EXTENT_XY,
    "HEXAGON",
    f"{HEX_AREA_KM2} SquareKilometers",
    sr_wgs
)

hex_count = int(arcpy.management.GetCount(hex_grid)[0])
print(f"  Generated {hex_count} hexagons")

# Add a permanent hex_id field
arcpy.management.AddField(hex_grid, "hex_id", "LONG", field_alias="Hex ID")
with arcpy.da.UpdateCursor(hex_grid, ["OID@", "hex_id"]) as cur:
    for row in cur:
        row[1] = row[0]
        cur.updateRow(row)

# ── 2. Spatial join: assign hex_id to every point ─────────────────────────────
print("Spatial join: assigning hex_id to points …")
points_joined = os.path.join(GDB_PATH, "points_with_hexid")
arcpy.analysis.SpatialJoin(
    points_path, hex_grid, points_joined,
    join_operation="JOIN_ONE_TO_ONE",
    match_option="WITHIN",
    field_mapping=(
        f'hex_id "hex_id" true true false 8 Long 0 0, First, #, {hex_grid}, hex_id, -1, -1;'
        f'species_code "species_code" true true false 80 Text 0 0, First, #, {points_path}, species_code, -1, -1;'
        f'week "week" true true false 2 Short 0 0, First, #, {points_path}, week, -1, -1'
    )
)

# ── 3. Summarize: count observations per (hex × species × week) ───────────────
print("Summarizing observation counts …")
summary = os.path.join(GDB_PATH, "hex_summary_temp")
arcpy.analysis.Statistics(
    points_joined, summary,
    statistics_fields=[["hex_id", "FIRST"]],
    case_field=["hex_id", "species_code", "week"]
)

# ── 4. Build the final time-enabled hex FC ────────────────────────────────────
print("Building final hex bin feature class …")

if arcpy.Exists(hex_path):
    arcpy.management.Delete(hex_path)

arcpy.management.CreateFeatureclass(GDB_PATH, HEX_OUTPUT_FC, "POLYGON",
                                    spatial_reference=sr_wgs)

fields_to_add = [
    ("hex_id",       "LONG",  "Hex ID",              None),
    ("species_code", "TEXT",  "Species Code",         80),
    ("obs_count",    "SHORT", "Observation Count",    None),
    ("week",         "SHORT", "Week of Year (1–52)",  None),
    ("week_date",    "DATE",  "Synthetic Week Date",  None),
]
for fname, ftype, falias, flen in fields_to_add:
    if ftype == "TEXT":
        arcpy.management.AddField(hex_path, fname, ftype,
                                  field_alias=falias, field_length=flen)
    else:
        arcpy.management.AddField(hex_path, fname, ftype, field_alias=falias)

# Build lookup: hex_id → polygon geometry
print("  Building hex geometry lookup …")
hex_geom = {}
with arcpy.da.SearchCursor(hex_grid, ["hex_id", "SHAPE@"]) as cur:
    for row in cur:
        hex_geom[row[0]] = row[1]

# Build summary lookup: (hex_id, species_code, week) → count
print("  Reading summary table …")
summary_data = {}
with arcpy.da.SearchCursor(summary,
                            ["hex_id", "species_code", "week", "FREQUENCY"]) as cur:
    for row in cur:
        key = (row[0], row[1], row[2])
        summary_data[key] = row[3]

print(f"  Total (hex×species×week) combinations: {len(summary_data)}")

# Insert rows
insert_fields = ["SHAPE@", "hex_id", "species_code", "obs_count",
                 "week", "week_date"]

inserted = 0
with arcpy.da.InsertCursor(hex_path, insert_fields) as cur:
    for (hex_id, sp_code, week), count in summary_data.items():
        geom = hex_geom.get(hex_id)
        if geom is None:
            continue
        syn_date = week_to_synthetic_date(week)
        cur.insertRow([geom, hex_id, sp_code, count, week, syn_date])
        inserted += 1

print(f"✓ Inserted {inserted} rows into '{HEX_OUTPUT_FC}'")

# ── 5. Set time properties on the layer ───────────────────────────────────────
# Do this in ArcGIS Pro: right-click layer → Properties → Time tab
# Start field : week_date
# Time step   : 1 Week
# Field format: Date

# ── 6. Normalize obs_count → abund_iso (1–5 scale, matching Audubon) ──────────
print("Adding abund_iso normalized field …")
arcpy.management.AddField(hex_path, "abund_iso", "SHORT",
                          field_alias="Abundance Class (1-5)")

with arcpy.da.UpdateCursor(hex_path, ["obs_count", "abund_iso"]) as cur:
    for row in cur:
        n = row[0]
        if   n <= 2:  row[1] = 1     # Very Low
        elif n <= 7:  row[1] = 2     # Low
        elif n <= 20: row[1] = 3     # Moderate
        elif n <= 60: row[1] = 4     # High
        else:         row[1] = 5     # Very High
        cur.updateRow(row)

# ── 7. Clean up temp files ─────────────────────────────────────────────────────
for tmp in [hex_grid, points_joined, summary]:
    if arcpy.Exists(tmp):
        arcpy.management.Delete(tmp)

print(f"""
✓ Done!  '{HEX_OUTPUT_FC}' is ready in {GDB_PATH}

NEXT STEPS IN ARCGIS PRO:
  1. Open AmphibianMap.gdb → add '{HEX_OUTPUT_FC}' to a map
  2. Layer Properties → Time → Enable → Start field = week_date
                                      → Time step  = 1 Week
  3. Share → Web Layer → Publish to ArcGIS Online
     • Name the service: amphibian_hexbins
     • Enable: Feature Access  ✓  Query  ✓  Time  ✓
  4. Copy the service URL and paste into  js/config.js

Next script: run  03_create_ranges.py
""")
