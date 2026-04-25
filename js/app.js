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
  "esri/symbols/PictureMarkerSymbol",
  "esri/geometry/Extent",
  "esri/geometry/Point",
  "esri/Graphic",
  "esri/layers/GraphicsLayer",
  "esri/core/reactiveUtils",
], function (
  Map, Basemap, MapView, FeatureLayer, VectorTileLayer, TileLayer,
  ClassBreaksRenderer, UniqueValueRenderer, SimpleRenderer,
  SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol, PictureMarkerSymbol,
  Extent, Point, Graphic, GraphicsLayer, reactiveUtils
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
  let hillshadeLayer        = null;
  let biasLayer             = null;
  let conservationLayer     = null;
  let showHex               = true;
  let showRanges            = true;
  let showPoints            = true;
  let showProtectionAreas   = true;
  let showClimate           = true;
  let isDragging            = false;
  // Item 2 — filter/sort state
  let activeIUCN  = "all";
  let currentSort = "obs";

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
  const hillshadeToggle        = document.getElementById("toggle-hillshade");
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

    // Points show ALL weeks for the species — not filtered by slider
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

  const pointsOpacitySlider    = document.getElementById("points-opacity");
  const pointsOpacityVal       = document.getElementById("points-opacity-val");
  const pointsSaturationSlider = document.getElementById("points-saturation");
  const pointsSaturationVal    = document.getElementById("points-saturation-val");
  const pointsBrightnessSlider = document.getElementById("points-brightness");
  const pointsBrightnessVal    = document.getElementById("points-brightness-val");
  const pointsContrastSlider   = document.getElementById("points-contrast");
  const pointsContrastVal      = document.getElementById("points-contrast-val");

  function updatePointsEffect() {
    if (!pointsLayer) return;
    pointsLayer.opacity = pointsOpacitySlider.value / 100;
    pointsLayer.effect  = `saturate(${pointsSaturationSlider.value}%) brightness(${pointsBrightnessSlider.value}%) contrast(${pointsContrastSlider.value}%)`;
    pointsOpacityVal.textContent    = pointsOpacitySlider.value + "%";
    pointsSaturationVal.textContent = pointsSaturationSlider.value + "%";
    pointsBrightnessVal.textContent = pointsBrightnessSlider.value + "%";
    pointsContrastVal.textContent   = pointsContrastSlider.value + "%";
  }
  if (pointsOpacitySlider)    pointsOpacitySlider.addEventListener("input",    updatePointsEffect);
  if (pointsSaturationSlider) pointsSaturationSlider.addEventListener("input", updatePointsEffect);
  if (pointsBrightnessSlider) pointsBrightnessSlider.addEventListener("input", updatePointsEffect);
  if (pointsContrastSlider)   pointsContrastSlider.addEventListener("input",   updatePointsEffect);
  updatePointsEffect(); // apply defaults on load
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
  if (hillshadeToggle) {
    hillshadeToggle.addEventListener("change", () => {
      if (hillshadeLayer) hillshadeLayer.visible = hillshadeToggle.checked;
    });
  }

  // Item 12 & 13: bias and conservation toggles
  const biasToggle = document.getElementById("toggle-bias");
  if (biasToggle) {
    biasToggle.addEventListener("change", () => {
      if (biasLayer) biasLayer.visible = biasToggle.checked;
    });
  }
  const conservationToggle = document.getElementById("toggle-conservation");
  if (conservationToggle) {
    conservationToggle.addEventListener("change", () => {
      if (conservationLayer) conservationLayer.visible = conservationToggle.checked;
    });
  }

  // ── Basemap switcher ───────────────────────────────────────────────────────
  function applyBasemap(id) {
    document.querySelectorAll(".basemap-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.bm === id));
    if (id === "custom" && CONFIG.basemapUrl) {
      map.basemap = new Basemap({
        baseLayers: [ new VectorTileLayer({ url: CONFIG.basemapUrl }) ]
      });
    } else {
      map.basemap = id;
    }
  }
  document.querySelectorAll(".basemap-btn").forEach(btn => {
    btn.addEventListener("click", () => applyBasemap(btn.dataset.bm));
  });
  // Highlight the initially active basemap button (map already set — just update UI)
  const initialBm = CONFIG.basemapUrl ? "custom" : "gray-vector";
  document.querySelectorAll(".basemap-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.bm === initialBm));

  // ── Overview / hint state ──────────────────────────────────────────────────
  function showOverview() {
    currentSpecies = null;
    document.querySelectorAll(".species-item").forEach(el => el.classList.remove("active"));
    if (hexLayer)    hexLayer.definitionExpression    = "1=0";
    if (rangesLayer) rangesLayer.definitionExpression = "1=0";
    if (pointsLayer) pointsLayer.definitionExpression = "1=0";
    if (mapHint) mapHint.style.display = "flex";
  }

  // ── Item 2: getFilteredSorted ──────────────────────────────────────────────
  function getFilteredSorted() {
    const q = searchInput.value.trim().toLowerCase();
    let list = speciesList.slice();

    // IUCN filter
    if (activeIUCN !== "all") {
      list = list.filter(s => s.iucn_code === activeIUCN);
    }

    // Search filter
    if (q) {
      list = list.filter(s =>
        s.scientific_name.toLowerCase().includes(q) ||
        s.common_name.toLowerCase().includes(q));
    }

    // Sort
    if (currentSort === "obs") {
      list.sort((a, b) => b.obs_count - a.obs_count);
    } else if (currentSort === "threat") {
      list.sort((a, b) => (b.iucn_severity || 0) - (a.iucn_severity || 0));
    } else if (currentSort === "az") {
      list.sort((a, b) => (a.common_name || a.scientific_name)
        .localeCompare(b.common_name || b.scientific_name));
    }

    return list;
  }

  // ── Species list ───────────────────────────────────────────────────────────
  function renderSpeciesList(list) {
    listContainer.innerHTML = "";
    // Item 7: maxObs for bar width calculation
    const maxObs = speciesList.length ? speciesList[0].obs_count : 1;
    list.forEach(sp => {
      const item = document.createElement("div");
      item.className = "species-item" + (currentSpecies?.id === sp.id ? " active" : "");
      item.dataset.id = sp.id;

      const thumb = sp.image_url
        ? `<img class="species-thumb" src="${sp.image_url}" loading="lazy" alt="">`
        : `<div class="species-thumb-placeholder">🐸</div>`;

      // Item 7: obs count bar
      const barPct = Math.round((sp.obs_count / maxObs) * 100);

      item.innerHTML = `
        ${thumb}
        <div class="species-item-text">
          <div class="species-item-common">${sp.common_name || sp.scientific_name}</div>
          <div class="species-item-sci">${sp.scientific_name}</div>
        </div>
        <span class="iucn-badge" style="background:${sp.iucn_color}">${sp.iucn_code}</span>
        <div class="obs-bar" style="width:${barPct}%"></div>
      `;
      item.addEventListener("click", () => selectSpecies(sp));
      listContainer.appendChild(item);
    });
  }

  // Item 2: wire search, chips, and sort
  searchInput.addEventListener("input", () => renderSpeciesList(getFilteredSorted()));

  document.querySelectorAll(".iucn-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      activeIUCN = chip.dataset.iucn;
      document.querySelectorAll(".iucn-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      renderSpeciesList(getFilteredSorted());
    });
  });

  const sortSelect = document.getElementById("species-sort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      currentSort = sortSelect.value;
      renderSpeciesList(getFilteredSorted());
    });
  }

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

    // Item 9: sound button
    const soundDiv = document.getElementById("detail-sound");
    const audio    = document.getElementById("frog-audio");
    if (sp.sound_url) {
      audio.src = sp.sound_url;
      soundDiv.style.display = "block";
    } else {
      soundDiv.style.display = "none";
    }

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

    // Zoom to species point extent — padded so points are never at the edge,
    // and enforced to a minimum span so the map doesn't zoom in too tightly.
    if (view && sp.bbox) {
      const PAD = 0.8;          // degrees of padding around the bbox
      const MIN_SPAN = 2.0;     // never zoom tighter than ~2° wide or tall
      let xmin = sp.bbox.xmin - PAD;
      let ymin = sp.bbox.ymin - PAD;
      let xmax = sp.bbox.xmax + PAD;
      let ymax = sp.bbox.ymax + PAD;
      // Enforce minimum span so a single-location species isn't zoomed to street level
      if ((xmax - xmin) < MIN_SPAN) { const cx = (xmin+xmax)/2; xmin=cx-MIN_SPAN/2; xmax=cx+MIN_SPAN/2; }
      if ((ymax - ymin) < MIN_SPAN) { const cy = (ymin+ymax)/2; ymin=cy-MIN_SPAN/2; ymax=cy+MIN_SPAN/2; }
      const ext = new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } });
      view.goTo(ext, { duration: 800 });
    } else if (view && sp.centroid) {
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
  hillshadeLayer = new TileLayer({
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

  // Item 12: bias layer (under-surveyed areas)
  if (CONFIG.services.bias) {
    biasLayer = new FeatureLayer({
      url: CONFIG.services.bias,
      opacity: 0.55,
      visible: true,
      popupEnabled: true,
      popupTemplate: {
        title: "Under-surveyed Area",
        content: [{ type: "fields", fieldInfos: [
          { fieldName: "species_name", label: "Species"   },
          { fieldName: "habitat_type", label: "Habitat"   },
        ]}]
      }
    });
    map.add(biasLayer, 1);
  }

  // Item 13: conservation pressure layer
  if (CONFIG.services.conservation) {
    conservationLayer = new FeatureLayer({
      url: CONFIG.services.conservation,
      opacity: 0.60,
      visible: true,
      popupEnabled: true,
      popupTemplate: {
        title: "Conservation Pressure",
        content: [{ type: "fields", fieldInfos: [
          { fieldName: "pressure_level",       label: "Pressure Level"       },
          { fieldName: "urban_proximity_km",   label: "Urban Distance (km)"  },
        ]}]
      }
    });
    map.add(conservationLayer, 2);
  }

  // Ranges + hex added first so points layer renders on top
  map.addMany([rangesLayer, hexLayer]);

  // Individual observation points — uses published AGOL symbology (frog icon from ArcGIS Pro)
  if (CONFIG.services.points) {
    pointsLayer = new FeatureLayer({
      url:      CONFIG.services.points,
      // Renderer comes from AGOL published symbology — change it there to update the map
      opacity: 1.0,
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
              style="width:100%;max-height:200px;min-height:120px;object-fit:contain;background:#020A04;display:block;"
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
