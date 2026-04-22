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

  // ── ArcGIS Online Feature Service URLs ────────────────────────────────────
  // All layers must be set to Public (Everyone can view).
  services: {
    hexBins: "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibians_hexbins2/FeatureServer",
    ranges:  "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibians_ranges2/FeatureServer",

    // ⚠ Paste your published amphibians_points FeatureServer URL here:
    points: "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibians_points/FeatureServer",

    // ⚠ Paste your published amphibians_protectionAreas FeatureServer URL here:
    // protectionAreas: "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/amphibians_protectionAreas/FeatureServer",

    // ⚠ Paste your published Colombia climate zones FeatureServer URL here:
    // climate: "https://services1.arcgis.com/ZIL9uO234SBBPGL7/arcgis/rest/services/colombia_climate_zones/FeatureServer",
  },

  // ── Map view ────────────────────────────────────────────────────────────────
  initialView: {
    center: [-75.5, 4.5],   // Colombia centroid [lon, lat]
    zoom: 6,
  },

  // ── Basemap ─────────────────────────────────────────────────────────────────
  // OPTION A — Built-in ArcGIS basemap string (used when basemapItemId is null):
  //   "gray-vector" | "topo-vector" | "dark-gray-vector" | "oceans" | "terrain"
  basemap: "gray-vector",

  // OPTION B — Your own custom basemap (VectorTileServer URL).
  //   Set basemapUrl to your VectorTileServer URL and it overrides the basemap string above.
  //   e.g. "https://tiles.arcgis.com/tiles/ZIL9uO234SBBPGL7/arcgis/rest/services/VectorBasemapAmphi/VectorTileServer"
  basemapItemId: null,
  basemapUrl: "https://tiles.arcgis.com/tiles/ZIL9uO234SBBPGL7/arcgis/rest/services/VectorBasemapAmphi/VectorTileServer",

  // ── Hex bin renderer ────────────────────────────────────────────────────────
  // Aqua-teal — matches glass frog translucent body color
  hexColors: {
    fillBase:   "#5CC8A8",     // glass frog aqua-teal body
    alphas:     [0.18, 0.35, 0.52, 0.72, 0.92],
    outlineColor: [80, 200, 165, 160],
  },

  abundanceClasses: [
    { label: "Very Low",  min: 1, max: 1 },
    { label: "Low",       min: 2, max: 2 },
    { label: "Moderate",  min: 3, max: 3 },
    { label: "High",      min: 4, max: 4 },
    { label: "Very High", min: 5, max: 5 },
  ],

  // ── Seasonal range renderer — glass frog palette ───────────────────────────
  seasonColors: {
    // Rainy seasons: aqua-teal (frog body color) — semi-transparent
    wet_season_1: { fill: [80, 200, 165, 0.22],  outline: [60, 185, 148, 0.80],  label: "Rainy Season 1 (Mar–May)" },
    // Dry seasons: warm gold (toe pad yellow) — semi-transparent
    dry_season_1: { fill: [200, 180, 30, 0.22],  outline: [175, 155, 20, 0.80],  label: "Dry Season 1 (Jun–Aug)"   },
    wet_season_2: { fill: [60, 185, 155, 0.22],  outline: [45, 165, 135, 0.80],  label: "Rainy Season 2 (Sep–Nov)" },
    dry_season_2: { fill: [195, 170, 25, 0.22],  outline: [168, 145, 15, 0.80],  label: "Dry Season 2 (Dec–Feb)"   },
    // Year-round: very pale glass — like the frog's near-invisible belly skin
    year_round:   { fill: [160, 230, 210, 0.15], outline: [100, 200, 175, 0.65], label: "Year-round Range"         },
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
