/**
 * config.js  —  Edit this file after publishing your ArcGIS layers.
 *
 * HOW TO GET YOUR SERVICE URLS (do this after publishing from ArcGIS Pro):
 *   1. Go to ArcGIS Online (cortesju_USCSSI.maps.arcgis.com) → Content
 *   2. Click the published layer → scroll down to the "URL" field
 *   3. Copy the URL — it ends in /FeatureServer/0
 *   4. Paste it into the services block below.
 *
 * NOTE: The long hash in the URL (e.g. "abc123def456...") is your internal
 * org ID — it differs from your login name. Always copy the full URL from
 * the AGOL Content page; do not guess it.
 */

const CONFIG = {

  // ── ArcGIS Online ───────────────────────────────────────────────────────────
  orgId: "cortesju_USCSSI",

  // ⚠ Paste your real FeatureServer URLs here after publishing in ArcGIS Pro.
  // Both layers must be set to Public (Everyone can view).
  services: {

    // Output of script 02_create_hexbins.py  →  published as "amphibian_hexbins"
    hexBins: "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibian_hexbins/FeatureServer",

    // Output of script 03_create_ranges.py   →  published as "amphibian_ranges"
    ranges:  "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibians_ranges/FeatureServer",
  },

  // ── Map view ────────────────────────────────────────────────────────────────
  initialView: {
    center: [-75.5, 4.5],   // Colombia centroid [lon, lat]
    zoom: 6,
  },

  // Basemap name — ArcGIS Online built-in basemaps:
  // "topo-vector" | "gray-vector" | "dark-gray-vector" | "oceans"
  // "streets-night-vector" | "terrain" | "human-geography-dark"
  basemap: "gray-vector",

  // ── Hex bin renderer ────────────────────────────────────────────────────────
  // abund_iso field values 1–5 map to these display classes
  hexColors: {
    fillBase:   "#996D5C",     // base brown — same as Audubon
    // Fill alpha per class (1=Very Low … 5=Very High)
    alphas:     [0.20, 0.40, 0.60, 0.80, 1.00],
    outlineColor: [0, 0, 0, 0],  // no outline for clean look
  },

  abundanceClasses: [
    { label: "Very Low",  min: 1, max: 1 },
    { label: "Low",       min: 2, max: 2 },
    { label: "Moderate",  min: 3, max: 3 },
    { label: "High",      min: 4, max: 4 },
    { label: "Very High", min: 5, max: 5 },
  ],

  // ── Seasonal range renderer ─────────────────────────────────────────────────
  seasonColors: {
    wet_season_1: { fill: [168, 210, 120, 0.40], outline: [100, 140, 60, 0.8],  label: "Rainy Season 1 (Mar–May)" },
    dry_season_1: { fill: [220, 185, 105, 0.35], outline: [160, 130, 50, 0.8],  label: "Dry Season 1 (Jun–Aug)"   },
    wet_season_2: { fill: [120, 190, 175, 0.40], outline: [ 60, 130, 115, 0.8], label: "Rainy Season 2 (Sep–Nov)" },
    dry_season_2: { fill: [210, 175,  75, 0.35], outline: [150, 120,  40, 0.8], label: "Dry Season 2 (Dec–Feb)"   },
    year_round:   { fill: [173, 208, 225, 0.30], outline: [ 80, 130, 160, 0.8], label: "Year-round Range"          },
  },

  // ── Time slider ─────────────────────────────────────────────────────────────
  // Weeks 1–52.  The slider animates through ISO weeks.
  totalWeeks:    52,
  animationFps:  8,   // frames per second when playing

  // Synthetic year used for week_date field (must match script 01/02)
  syntheticYear: 1000,

  // ── UI strings ──────────────────────────────────────────────────────────────
  appTitle:    "Colombia Amphibian Explorer",
  appSubtitle: "Temporal distribution of endemic & threatened amphibians",
};
