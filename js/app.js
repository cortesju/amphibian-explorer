/**
 * app.js  —  Colombia Amphibian Explorer
 * Uses ArcGIS JS API 4.x (loaded via CDN in index.html)
 */

require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/FeatureLayer",
  "esri/renderers/ClassBreaksRenderer",
  "esri/renderers/UniqueValueRenderer",
  "esri/symbols/SimpleFillSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/geometry/Extent",
  "esri/core/reactiveUtils",
], function (
  Map, MapView, FeatureLayer,
  ClassBreaksRenderer, UniqueValueRenderer,
  SimpleFillSymbol, SimpleLineSymbol,
  Extent, reactiveUtils
) {

  // ── State ──────────────────────────────────────────────────────────────────
  let speciesList     = [];
  let currentSpecies  = null;
  let currentWeek     = 1;
  let isPlaying       = false;
  let animTimer       = null;
  let hexLayer        = null;
  let rangesLayer     = null;
  let showHex         = true;
  let showRanges      = true;
  let isDragging      = false;

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
  const hexToggle        = document.getElementById("toggle-hex");
  const rangesToggle     = document.getElementById("toggle-ranges");

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
          outline: { color: [0,0,0,0], width: 0 }
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
  });

  // ── Select species → update map ────────────────────────────────────────────
  function selectSpecies(sp) {
    currentSpecies = sp;

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
  const map = new Map({ basemap: CONFIG.basemap });

  const view = new MapView({
    container: "viewDiv",
    map:    map,
    center: CONFIG.initialView.center,
    zoom:   CONFIG.initialView.zoom,
    ui: { components: ["zoom"] },
  });

  // Remove default popup
  view.popup.autoOpenEnabled = false;

  // Seasonal ranges layer (drawn first = bottom)
  rangesLayer = new FeatureLayer({
    url:        CONFIG.services.ranges,
    renderer:   makeRangesRenderer(),
    opacity:    0.65,
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

  map.addMany([rangesLayer, hexLayer]);

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

      // Auto-select most-observed species
      if (speciesList.length > 0) {
        selectSpecies(speciesList[0]);
      }

      setWeek(20);  // Start at week 20 (~mid-May, active season)

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

}); // end require
