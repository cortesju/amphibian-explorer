/**
 * app.js  —  Colombia Amphibian Explorer
 * Uses ArcGIS JS API 4.x (loaded via CDN in index.html)
 */

// Catch any unhandled JS error and show it in the loading screen
window.onerror = function(msg, src, line) {
  const el = document.querySelector(".loading-text");
  if (el) el.textContent = "JS Error: " + msg + " (line " + line + ")";
  return false;
};

require([
  "esri/Map",
  "esri/Basemap",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/layers/VectorTileLayer",
  "esri/layers/TileLayer",
  "esri/renderers/ClassBreaksRenderer",
  "esri/renderers/UniqueValueRenderer",
  "esri/renderers/SimpleRenderer",
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/geometry/Extent",
  "esri/core/reactiveUtils",
], function (
  Map, Basemap, MapView, FeatureLayer, VectorTileLayer, TileLayer,
  ClassBreaksRenderer, UniqueValueRenderer, SimpleRenderer,
  SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol,
  Extent, reactiveUtils
) { try {

  // ── State ──────────────────────────────────────────────────────────────────
  let speciesList     = [];
  let currentSpecies  = null;
  let currentWeek     = 1;
  let isPlaying       = false;
  let animTimer       = null;
  let hexLayer              = null;
  let rangesLayer           = null;
  let pointsLayer           = null;
  let protectionAreasLayer  = null;
  let climateLayer          = null;
  let showHex               = true;
  let showRanges            = true;
  let showPoints            = true;
  let showProtectionAreas   = true;
  let showClimate           = true;
  let isDragging            = false;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const loadingEl        = document.getElementById("loading");
  const listView         = document.getElementById("species-list-view");
  const detailView       = document.getElementById("species-detail-view");
  const listContainer    = document.getElementById("species-list");
  const searchInput      = document.getElementById("species-search");
  const playBtn          = document.getElementById("play-btn");
  const sliderTrack      = document.getElementById("slider-track");
  const sliderFill       = document.getElementById("slider-fill");
  const sliderThumb      = document.getElementById("slider-thumb");
  const weekLabelEl      = document.getElementById("week-label");
  const mapTooltip       = document.getElementById("map-tooltip");
  const hexToggle              = document.getElementById("toggle-hex");
  const rangesToggle           = document.getElementById("toggle-ranges");
  const pointsToggle           = document.getElementById("toggle-points");
  const protectionAreasToggle  = document.getElementById("toggle-protection-areas");
  const climateToggle          = document.getElementById("toggle-climate");
  const mapHint                = document.getElementById("map-hint");

  // ── Helpers ────────────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r,g,b];
  }

  function weekToDateLabel(week) {
    // Use 2024 (leap year) so Feb 29 is handled
    const jan1   = new Date(2024, 0, 1);
    const start  = new Date(jan1.getTime() + (week - 1) * 7 * 864e5);
    const end    = new Date(start.getTime() + 6 * 864e5);
    const m      = ["JAN","FEB","MAR","APR","MAY","JUN",
                    "JUL","AUG","SEP","OCT","NOV","DEC"];
    return `${m[start.getMonth()]} ${start.getDate()} – ${m[end.getMonth()]} ${end.getDate()}`;
  }

  function weekFraction(week) {
    return (week - 1) / (CONFIG.totalWeeks - 1);
  }

  // ── Build hex bin renderer ─────────────────────────────────────────────────
  function makeHexRenderer() {
    const base   = hexToRgb(CONFIG.hexColors.fillBase);
    const alphas = CONFIG.hexColors.alphas;
    const labels = CONFIG.abundanceClasses.map(c => c.label);

    return new ClassBreaksRenderer({
      field: "abund_iso",
      classBreakInfos: CONFIG.abundanceClasses.map((cls, i) => ({
        minValue: cls.min,
        maxValue: cls.max,
        symbol: new SimpleFillSymbol({
          color: [...base, Math.round(alphas[i] * 255)],
          outline: { color: [92, 200, 168, 150], width: 0.6 }
        }),
        label: labels[i],
      })),
    });
  }

  // ── Build seasonal range renderer ─────────────────────────────────────────
  function makeRangesRenderer() {
    const sc = CONFIG.seasonColors;
    const makeSymbol = (key) => new SimpleFillSymbol({
      color: sc[key].fill,
      outline: {
        color: sc[key].outline,
        width: 1,
      }
    });

    return new UniqueValueRenderer({
      field: "season",
      uniqueValueInfos: Object.keys(sc).map(key => ({
        value: key,
        symbol: makeSymbol(key),
        label: sc[key].label,
      })),
      defaultSymbol: new SimpleFillSymbol({
        color: [200,200,200,60],
        outline: { color: [150,150,150,180], width: 0.5 }
      })
    });
  }

  // ── Update layers for current species + week ───────────────────────────────
  function updateLayers() {
    if (!currentSpecies || !hexLayer || !rangesLayer) return;

    hexLayer.definitionExpression =
      `species_code = '${currentSpecies.id}' AND week = ${currentWeek}`;

    rangesLayer.definitionExpression =
      `species_code = '${currentSpecies.id}'`;

    if (pointsLayer) {
      pointsLayer.definitionExpression =
        `species_code = '${currentSpecies.id}'`;
    }
  }

  // ── Time slider logic ──────────────────────────────────────────────────────
  function setWeek(week) {
    currentWeek = Math.max(1, Math.min(CONFIG.totalWeeks, Math.round(week)));
    const pct   = weekFraction(currentWeek) * 100;

    sliderFill.style.width        = `${pct}%`;
    sliderThumb.style.left        = `${pct}%`;
    weekLabelEl.style.left        = `${pct}%`;
    weekLabelEl.textContent       = weekToDateLabel(currentWeek);

    updateLayers();
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    playBtn.innerHTML = isPlaying ? "⏸" : "▶";
    if (isPlaying) {
      animTimer = setInterval(() => {
        const next = currentWeek >= CONFIG.totalWeeks ? 1 : currentWeek + 1;
        setWeek(next);
      }, 1000 / CONFIG.animationFps);
    } else {
      clearInterval(animTimer);
    }
  }

  // Slider drag
  function sliderPosFromEvent(e) {
    const rect  = sliderTrack.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct   = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * (CONFIG.totalWeeks - 1)) + 1;
  }

  sliderTrack.addEventListener("mousedown",  (e) => { isDragging = true;  setWeek(sliderPosFromEvent(e)); });
  sliderTrack.addEventListener("touchstart", (e) => { isDragging = true;  setWeek(sliderPosFromEvent(e)); }, {passive:true});
  document.addEventListener("mousemove",  (e) => { if (isDragging) setWeek(sliderPosFromEvent(e)); });
  document.addEventListener("touchmove",  (e) => { if (isDragging) setWeek(sliderPosFromEvent(e)); }, {passive:true});
  document.addEventListener("mouseup",    ()  => { isDragging = false; });
  document.addEventListener("touchend",   ()  => { isDragging = false; });
  playBtn.addEventListener("click", togglePlay);

  // ── Layer toggles ──────────────────────────────────────────────────────────
  hexToggle.addEventListener("change", () => {
    showHex = hexToggle.checked;
    if (hexLayer) hexLayer.visible = showHex;
  });
  rangesToggle.addEventListener("change", () => {
    showRanges = rangesToggle.checked;
    if (rangesLayer) rangesLayer.visible = showRanges;
  });
  if (pointsToggle) {
    pointsToggle.addEventListener("change", () => {
      showPoints = pointsToggle.checked;
      if (pointsLayer) pointsLayer.visible = showPoints;
    });
  }
  if (protectionAreasToggle) {
    protectionAreasToggle.addEventListener("change", () => {
      showProtectionAreas = protectionAreasToggle.checked;
      if (protectionAreasLayer) protectionAreasLayer.visible = showProtectionAreas;
    });
  }
  if (climateToggle) {
    climateToggle.addEventListener("change", () => {
      showClimate = climateToggle.checked;
      if (climateLayer) climateLayer.visible = showClimate;
    });
  }

  // ── Overview / hint state ──────────────────────────────────────────────────
  function showOverview() {
    currentSpecies = null;
    document.querySelectorAll(".species-item").forEach(el => el.classList.remove("active"));
    if (hexLayer)    hexLayer.definitionExpression    = "1=0";
    if (rangesLayer) rangesLayer.definitionExpression = "1=0";
    if (pointsLayer) pointsLayer.definitionExpression = "1=0";
    if (mapHint) mapHint.style.display = "flex";
  }

  // ── Species list ───────────────────────────────────────────────────────────
  function renderSpeciesList(list) {
    listContainer.innerHTML = "";
    list.forEach(sp => {
      const item = document.createElement("div");
      item.className = "species-item" + (currentSpecies?.id === sp.id ? " active" : "");
      item.dataset.id = sp.id;

      const thumb = sp.image_url
        ? `<img class="species-thumb" src="${sp.image_url}" loading="lazy" alt="">`
        : `<div class="species-thumb-placeholder">🐸</div>`;

      item.innerHTML = `
        ${thumb}
        <div class="species-item-text">
          <div class="species-item-common">${sp.common_name || sp.scientific_name}</div>
          <div class="species-item-sci">${sp.scientific_name}</div>
        </div>
        <span class="iucn-badge" style="background:${sp.iucn_color}">${sp.iucn_code}</span>
      `;
      item.addEventListener("click", () => selectSpecies(sp));
      listContainer.appendChild(item);
    });
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q
      ? speciesList.filter(s =>
          s.scientific_name.toLowerCase().includes(q) ||
          s.common_name.toLowerCase().includes(q))
      : speciesList;
    renderSpeciesList(filtered);
  });

  // ── Species detail panel ───────────────────────────────────────────────────
  function showDetail(sp) {
    document.getElementById("detail-photo").src = sp.image_url || "";
    document.getElementById("detail-photo").style.display = sp.image_url ? "block" : "none";
    document.getElementById("detail-photo-placeholder").style.display = sp.image_url ? "none" : "flex";
    document.getElementById("detail-common").textContent = sp.common_name || sp.scientific_name;
    document.getElementById("detail-sci").textContent    = sp.scientific_name;
    document.getElementById("detail-iucn-badge").textContent  = `${sp.iucn_code} — ${sp.iucn_label}`;
    document.getElementById("detail-iucn-badge").style.background = sp.iucn_color;
    document.getElementById("detail-description").textContent = sp.description || "";
    document.getElementById("stat-obs").textContent     = sp.obs_count.toLocaleString();
    document.getElementById("stat-research").textContent= sp.quality_research_count.toLocaleString();
    document.getElementById("stat-years").textContent   =
      sp.year_range[0] ? `${sp.year_range[0]}–${sp.year_range[1]}` : "—";
    document.getElementById("detail-inat-link").href    = sp.inat_url;

    listView.style.display   = "none";
    detailView.style.display = "flex";
  }

  document.getElementById("detail-back").addEventListener("click", () => {
    listView.style.display   = "flex";
    detailView.style.display = "none";
    showOverview();
  });

  // ── Select species → update map ────────────────────────────────────────────
  function selectSpecies(sp) {
    currentSpecies = sp;
    if (mapHint) mapHint.style.display = "none";

    // Highlight in list
    document.querySelectorAll(".species-item").forEach(el => {
      el.classList.toggle("active", el.dataset.id === sp.id);
    });

    showDetail(sp);

    // Pan to species centroid
    if (view && sp.centroid) {
      view.goTo({ center: [sp.centroid.lon, sp.centroid.lat], zoom: 7 }, { duration: 800 });
    }

    updateLayers();
  }

  // ── Map tooltip on hover ───────────────────────────────────────────────────
  function showTooltip(x, y, text) {
    mapTooltip.style.left    = `${x + 14}px`;
    mapTooltip.style.top     = `${y - 10}px`;
    mapTooltip.style.display = "block";
    mapTooltip.textContent   = text;
  }
  function hideTooltip() { mapTooltip.style.display = "none"; }

  const ABUND_LABELS = ["", "Very Low","Low","Moderate","High","Very High"];

  // ── Initialize map ─────────────────────────────────────────────────────────
  // Use custom VTPK basemap if an item ID is provided, otherwise use built-in string
  let resolvedBasemap;
  if (CONFIG.basemapItemId) {
    resolvedBasemap = new Basemap({ portalItem: { id: CONFIG.basemapItemId } });
  } else if (CONFIG.basemapUrl) {
    resolvedBasemap = new Basemap({
      baseLayers: [ new VectorTileLayer({ url: CONFIG.basemapUrl }) ]
    });
  } else {
    resolvedBasemap = CONFIG.basemap;
  }

  const map = new Map({ basemap: resolvedBasemap });

  const view = new MapView({
    container: "viewDiv",
    map:    map,
    center: CONFIG.initialView.center,
    zoom:   CONFIG.initialView.zoom,
    ui: { components: ["zoom"] },
  });

  // Popup auto-open stays ON (default) so point clicks show the popup.
  // Hex + ranges layers have popupEnabled:false so they won't interfere.

  // Seasonal ranges layer (drawn first = bottom)
  rangesLayer = new FeatureLayer({
    url:        CONFIG.services.ranges,
    renderer:   makeRangesRenderer(),
    opacity:    0.50,
    visible:    true,
    definitionExpression: "1=0",   // hidden until species selected
    outFields:  ["species_code", "season", "season_label", "obs_count"],
    popupEnabled: false,
  });

  // Hex bin layer (drawn on top)
  hexLayer = new FeatureLayer({
    url:       CONFIG.services.hexBins,
    renderer:  makeHexRenderer(),
    opacity:   1,
    visible:   true,
    definitionExpression: "1=0",  // hidden until species selected
    outFields: ["species_code", "week", "obs_count", "abund_iso"],
    popupEnabled: false,
  });

  // Protection areas layer (always visible — not species-filtered)
  if (CONFIG.services.protectionAreas) {
    protectionAreasLayer = new FeatureLayer({
      url:      CONFIG.services.protectionAreas,
      renderer: new SimpleRenderer({
        symbol: new SimpleFillSymbol({
          color: [200, 180, 30, 40],                          // warm gold fill, very transparent
          outline: { color: [200, 180, 30, 200], width: 1.5 } // gold border
        })
      }),
      opacity:   0.85,
      visible:   true,
      outFields: ["*"],
      popupEnabled: true,
      popupTemplate: {
        title: "{name}",
        content: [{
          type: "fields",
          fieldInfos: [
            { fieldName: "category",     label: "Category"          },
            { fieldName: "area_km2",     label: "Area (km²)"        },
            { fieldName: "species_count",label: "Amphibian Species"  },
          ]
        }],
        overwriteActions: true,
      }
    });
    map.add(protectionAreasLayer, 0);   // drawn below everything else
  }

  // Hillshade layer — free Esri public service, blended below everything
  const hillshadeLayer = new TileLayer({
    url: "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer",
    opacity: 0.28,
    blendMode: "multiply",
  });
  map.add(hillshadeLayer, 0);

  // Climate zones layer (added if URL is configured)
  if (CONFIG.services.climate) {
    climateLayer = new FeatureLayer({
      url:     CONFIG.services.climate,
      opacity: 0.45,
      visible: true,
      popupEnabled: true,
      popupTemplate: {
        title: "{climate_name}",
        content: [{ type: "fields", fieldInfos: [
          { fieldName: "climate_code",  label: "Code"        },
          { fieldName: "climate_name",  label: "Climate Type" },
          { fieldName: "avg_temp_c",    label: "Avg Temp (°C)"},
          { fieldName: "avg_precip_mm", label: "Avg Precip (mm)"},
        ]}],
        overwriteActions: true,
      }
    });
    map.add(climateLayer, 1);
  }

  // Ranges + hex added first so points layer renders on top
  map.addMany([rangesLayer, hexLayer]);

  // Individual observation points — uses published AGOL symbology (frog icon from ArcGIS Pro)
  if (CONFIG.services.points) {
    pointsLayer = new FeatureLayer({
      url:      CONFIG.services.points,
      // No renderer → ArcGIS JS API uses the symbology published from ArcGIS Pro
      opacity:   0.95,
      visible:   true,
      definitionExpression: "1=0",
      outFields: ["scientific_name", "common_name", "observed_on",
                  "quality_grade", "image_url", "obs_url", "inat_id"],
      popupEnabled: true,
      popupTemplate: {
        title: "{common_name}",
        content: [{
          type: "text",
          text: `<div style="margin:-8px -12px 8px;overflow:hidden;border-radius:6px 6px 0 0;">
            <img src="{image_url}" alt=""
              style="width:100%;max-height:180px;object-fit:cover;display:block;"
              onerror="this.style.display='none'">
          </div>`
        }, {
          type: "fields",
          fieldInfos: [
            { fieldName: "scientific_name", label: "Scientific name" },
            { fieldName: "observed_on",     label: "Date observed"   },
            { fieldName: "quality_grade",   label: "Quality grade"   },
          ]
        }, {
          type: "text",
          text: `<div style="margin-top:8px;">
            <a href="{obs_url}" target="_blank" rel="noopener"
               style="color:#5CC8A8;font-weight:700;">
              View on iNaturalist ↗
            </a></div>`
        }],
        overwriteActions: true,
      }
    });
    map.add(pointsLayer);   // added last → drawn on top of everything
  }

  // ── Hover interaction ──────────────────────────────────────────────────────
  view.on("pointer-move", (event) => {
    view.hitTest(event, { include: [hexLayer] }).then((hit) => {
      if (hit.results.length) {
        const attrs = hit.results[0].graphic.attributes;
        const label = ABUND_LABELS[attrs.abund_iso] || "Unknown";
        showTooltip(event.x, event.y,
          `${label} · ${attrs.obs_count} observation${attrs.obs_count !== 1 ? "s" : ""}`);
        view.container.style.cursor = "pointer";
      } else {
        hideTooltip();
        view.container.style.cursor = "";
      }
    });
  });

  view.on("pointer-leave", hideTooltip);

  // ── Load species data and initialize ──────────────────────────────────────
  fetch("data/species.json")
    .then(r => r.json())
    .then(data => {
      speciesList = data.species;
      renderSpeciesList(speciesList);

      setWeek(20);  // Start at week 20 (~mid-May, active season)
      showOverview(); // Start in overview — user picks a species

      loadingEl.classList.add("hidden");
    })
    .catch(err => {
      console.error("Failed to load species.json:", err);
      loadingEl.querySelector(".loading-text").textContent =
        "Error loading species data. Check the console.";
    });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === " ")           { e.preventDefault(); togglePlay(); }
    if (e.key === "ArrowRight")  setWeek(currentWeek + 1);
    if (e.key === "ArrowLeft")   setWeek(currentWeek - 1);
  });

} catch(e) {
    const el = document.querySelector(".loading-text");
    if (el) el.textContent = "Init error: " + e.message;
    console.error(e);
  }
}); // end require
