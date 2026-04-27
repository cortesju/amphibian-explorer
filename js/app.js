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
  let isTemporalActive = false;   // true only while Play is running
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
  let showRanges            = false;  // off by default
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

    // Hexbins: VectorTileLayer — visible only when density map option is active
    hexLayer.visible = (activeMapOption === "density");

    rangesLayer.definitionExpression =
      `species_code = '${currentSpecies.id}'`;

    // Points: show all for species by default; filter by week only while playing
    if (pointsLayer) {
      pointsLayer.definitionExpression = isTemporalActive
        ? `species_code = '${currentSpecies.id}' AND EXTRACT(WEEK FROM observed_on) = ${currentWeek}`
        : `species_code = '${currentSpecies.id}'`;
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
      isTemporalActive = true;
      animTimer = setInterval(() => {
        const next = currentWeek >= CONFIG.totalWeeks ? 1 : currentWeek + 1;
        setWeek(next);
      }, 1000 / CONFIG.animationFps);
    } else {
      clearInterval(animTimer);
      isTemporalActive = false;
      updateLayers();   // revert points back to showing all observations
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

  const pointsOpacitySlider = document.getElementById("points-opacity");
  const pointsOpacityVal    = document.getElementById("points-opacity-val");

  function updatePointsEffect() {
    if (!pointsLayer) return;
    pointsLayer.opacity = pointsOpacitySlider ? pointsOpacitySlider.value / 100 : 1.0;
    if (pointsOpacityVal) pointsOpacityVal.textContent = pointsOpacitySlider.value + "%";
  }
  if (pointsOpacitySlider) pointsOpacitySlider.addEventListener("input", updatePointsEffect);
  updatePointsEffect(); // apply default opacity on load
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

  // ── Available Maps switcher ───────────────────────────────────────────────
  let activeMapOption = "density";

  // Colors assigned alphabetically by scientific name — matches ArcGIS pie chart
  const SPECIES_DIST_COLORS = {
    "andinobates_bombetes":           "#26C6DA",
    "atelopus_laetissimus":           "#1565C0",
    "atelopus_lozanoi":               "#5C8AE6",
    "bolitoglossa_ramosi":            "#A5D6A7",
    "bolitoglossa_vallecula":         "#E53935",
    "centrolene_savagei":             "#2E7D32",
    "cochranella_granulosa":          "#FF7043",
    "colostethus_inguinalis":         "#FFEE58",
    "dendropsophus_columbianus":      "#F5A623",
    "dendropsophus_ebraccatus":       "#FBC02D",
    "espadarana_prosoblepon":         "#8B6914",
    "hyalinobatrachium_fleischmanni": "#607D8B",
    "hyalinobatrachium_tatayoi":      "#B0BEC5",
    "hyalinobatrachium_viridissimum": "#80DEEA",
    "leptodactylus_insularum":        "#00BCD4",
    "oedipina_savagei":               "#4E342E",
    "oophaga_anchicayensis":          "#CE93D8",
    "oophaga_lehmanni":               "#F48FB1",
    "oophaga_solanensis":             "#FF8A65",
    "pristimantis_erythropleura":     "#90CAF9",
    "pristimantis_mutabilis":         "#6A1B9A",
    "pristimantis_palmeri":           "#8D6E63",
    "rheobates_palmatus":             "#795548",
    "rulyrana_susatamai":             "#7E57C2",
  };

  function buildDistributionLegend() {
    const body = document.getElementById("map-distribution-legend-body");
    if (!body || !speciesList.length) return;
    const total = speciesList.reduce((s, sp) => s + (sp.obs_count || 0), 0);
    const sorted = [...speciesList].sort((a, b) => b.obs_count - a.obs_count);
    body.innerHTML = sorted.map(sp => {
      const pct  = total > 0 ? ((sp.obs_count / total) * 100).toFixed(1) : "0.0";
      const color = SPECIES_DIST_COLORS[sp.id] || "#888888";
      const name  = sp.scientific_name;
      return `<div class="dist-legend-item">
        <div class="dist-legend-swatch" style="background:${color}"></div>
        <div class="dist-legend-name">${name}</div>
        <div class="dist-legend-pct">${pct}%</div>
      </div>`;
    }).join("");
  }

  // Rows exclusive to Species Records — hidden in other map options
  const SPECIES_RECORDS_ROWS = ["row-hex","row-ranges","row-points","row-points-slider","row-protection"];

  function setMapOption(id) {
    activeMapOption = id;
    // Update card UI
    document.querySelectorAll(".map-option-card").forEach(c =>
      c.classList.toggle("active", c.dataset.map === id));

    // Show/hide layer toggle rows that belong only to Species Records
    const isRecords = (id === "density");
    SPECIES_RECORDS_ROWS.forEach(rowId => {
      const el = document.getElementById(rowId);
      if (el) el.style.display = isRecords ? "" : "none";
    });

    // Show/hide actual map layers
    if (hexLayer)          hexLayer.visible          = isRecords && !!currentSpecies;
    if (rangesLayer)       rangesLayer.visible       = isRecords && showRanges && !!currentSpecies;
    if (pointsLayer)       pointsLayer.visible       = isRecords && showPoints;
    if (protectionAreasLayer) protectionAreasLayer.visible = isRecords && showProtectionAreas;
    if (conservationLayer) conservationLayer.visible = (id === "conservation");
    if (biasLayer)         biasLayer.visible         = (id === "bias");

    // Show/hide distribution legend
    const distLegend = document.getElementById("map-distribution-legend");
    if (distLegend) distLegend.style.display = (id === "conservation") ? "block" : "none";
  }

  document.querySelectorAll(".map-option-card").forEach(card => {
    const id = card.dataset.map;
    // Disable cards whose service URL is not yet configured
    const urlMap = { density: true, conservation: !!CONFIG.services.conservation, bias: !!CONFIG.services.bias };
    if (!urlMap[id]) { card.classList.add("disabled"); return; }
    // Hide "Soon" badge if URL is present
    const soon = card.querySelector(".map-option-soon");
    if (soon) soon.style.display = "none";
    card.addEventListener("click", () => setMapOption(id));
  });

  // ── Overview / hint state ──────────────────────────────────────────────────
  function showOverview() {
    currentSpecies = null;
    document.querySelectorAll(".species-item").forEach(el => el.classList.remove("active"));
    if (hexLayer) hexLayer.visible = false;
    if (conservationLayer) conservationLayer.visible = (activeMapOption === "conservation");
    if (biasLayer)         biasLayer.visible         = (activeMapOption === "bias");
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

  // ── Audio player — single shared Audio element ────────────────────────────
  let currentAudio    = null;
  let currentAudioBtn = null;

  function stopAudio() {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    if (currentAudioBtn) { currentAudioBtn.textContent = "🔊"; currentAudioBtn.classList.remove("playing"); }
    currentAudio    = null;
    currentAudioBtn = null;
  }

  function toggleAudio(btn, url) {
    // If same button pressed while playing — stop
    if (currentAudioBtn === btn) { stopAudio(); return; }
    // Stop whatever was playing before
    stopAudio();
    const audio = new Audio(url);
    audio.addEventListener("ended", () => {
      btn.textContent = "🔊"; btn.classList.remove("playing");
      currentAudio = null; currentAudioBtn = null;
    });
    audio.play().then(() => {
      btn.textContent = "⏹"; btn.classList.add("playing");
      currentAudio    = audio;
      currentAudioBtn = btn;
    }).catch(() => { btn.textContent = "🔊"; });
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
        ${sp.sound_url ? `<button class="species-audio-btn" title="Play call">🔊</button>` : ""}
        <span class="iucn-badge" style="background:${sp.iucn_color}">${sp.iucn_code}</span>
        <div class="obs-bar" style="width:${barPct}%"></div>
      `;

      // Wire audio button — stop propagation so it doesn't select the species
      if (sp.sound_url) {
        const audioBtn = item.querySelector(".species-audio-btn");
        audioBtn.addEventListener("click", e => {
          e.stopPropagation();
          toggleAudio(audioBtn, sp.sound_url);
        });
      }

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

    // Species whose points are too scattered — always zoom to full Colombia view.
    const COLOMBIA_ZOOM_IDS = new Set([
      "espadarana_prosoblepon",
      "leptodactylus_insularum",
      "dendropsophus_columbianus",
      "hyalinobatrachium_fleischmanni",
      "cochranella_granulosa",
    ]);

    // Species with custom fixed extents (queryExtent gives wrong results)
    const CUSTOM_EXTENTS = {
      // Full Colombia
      "espadarana_prosoblepon":        { xmin:-79.0, ymin:-4.5,  xmax:-66.5, ymax:13.5 },
      "leptodactylus_insularum":       { xmin:-79.0, ymin:-4.5,  xmax:-66.5, ymax:13.5 },
      "dendropsophus_columbianus":     { xmin:-79.0, ymin:-4.5,  xmax:-66.5, ymax:13.5 },
      "hyalinobatrachium_fleischmanni":{ xmin:-79.0, ymin:-4.5,  xmax:-66.5, ymax:13.5 },
      "cochranella_granulosa":         { xmin:-79.0, ymin:-4.5,  xmax:-66.5, ymax:13.5 },
      // Pacific Colombia (Chocó / Valle del Cauca coast)
      "oophaga_lehmanni":              { xmin:-78.5, ymin:1.0,   xmax:-75.5, ymax:6.5  },
    };

    if (view && CUSTOM_EXTENTS[sp.id]) {
      view.goTo(new Extent({
        ...CUSTOM_EXTENTS[sp.id],
        spatialReference: { wkid: 4326 }
      }), { duration: 800 });
    } else if (view && pointsLayer) {
      // All other species: query the live layer for the real point extent
      pointsLayer.queryExtent({
        where: `species_code = '${sp.id}'`,
        outSpatialReference: { wkid: 4326 }
      }).then(function(result) {
        if (result && result.count > 0 && result.extent) {
          const PAD      = 0.4;
          const MIN_SPAN = 1.5;
          const MAX_SPAN = 6.0;
          let { xmin, ymin, xmax, ymax } = result.extent;
          xmin -= PAD; ymin -= PAD; xmax += PAD; ymax += PAD;
          if ((xmax - xmin) < MIN_SPAN) { const cx=(xmin+xmax)/2; xmin=cx-MIN_SPAN/2; xmax=cx+MIN_SPAN/2; }
          if ((ymax - ymin) < MIN_SPAN) { const cy=(ymin+ymax)/2; ymin=cy-MIN_SPAN/2; ymax=cy+MIN_SPAN/2; }
          if ((xmax - xmin) > MAX_SPAN) { const cx=(xmin+xmax)/2; xmin=cx-MAX_SPAN/2; xmax=cx+MAX_SPAN/2; }
          if ((ymax - ymin) > MAX_SPAN) { const cy=(ymin+ymax)/2; ymin=cy-MAX_SPAN/2; ymax=cy+MAX_SPAN/2; }
          view.goTo(new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } }), { duration: 800 });
        } else if (sp.centroid) {
          view.goTo({ center: [sp.centroid.lon, sp.centroid.lat], zoom: 7 }, { duration: 800 });
        }
      }).catch(function() {
        if (sp.centroid) view.goTo({ center: [sp.centroid.lon, sp.centroid.lat], zoom: 7 }, { duration: 800 });
      });
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

  // Hex bin layer — VectorTileLayer (no definitionExpression; visibility only)
  hexLayer = new VectorTileLayer({
    url:     CONFIG.services.hexBins,
    opacity: 0.85,
    visible: false,   // shown when a species is selected
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

  // Item 13: conservation pressure layer (MapServer → TileLayer)
  if (CONFIG.services.conservation) {
    conservationLayer = new TileLayer({
      url:     CONFIG.services.conservation,
      opacity: 0.80,
      visible: false,   // shown only when Conservation card is active
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
      buildDistributionLegend();   // pre-build the conservation legend

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
