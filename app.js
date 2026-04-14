const EARTH_SEARCH_API = "https://earth-search.aws.element84.com/v1/search";
const TITILER_STAC_API = "https://titiler.xyz/stac/bbox";
const DEFAULT_VIEW = {
  center: [52.1326, 5.2913],
  zoom: 7
};

const collectionSelect = document.querySelector("#collectionSelect");
const startDateInput = document.querySelector("#startDateInput");
const endDateInput = document.querySelector("#endDateInput");
const cloudInput = document.querySelector("#cloudInput");
const limitInput = document.querySelector("#limitInput");
const sequenceModeSelect = document.querySelector("#sequenceModeSelect");
const bboxOutput = document.querySelector("#bboxOutput");
const statusText = document.querySelector("#statusText");
const resultCountText = document.querySelector("#resultCountText");
const drawAreaButton = document.querySelector("#drawAreaButton");
const viewAreaButton = document.querySelector("#viewAreaButton");
const clearAreaButton = document.querySelector("#clearAreaButton");
const searchButton = document.querySelector("#searchButton");
const streetsLayerButton = document.querySelector("#streetsLayerButton");
const satelliteLayerButton = document.querySelector("#satelliteLayerButton");
const playButton = document.querySelector("#playButton");
const exportButton = document.querySelector("#exportButton");
const downloadFramesButton = document.querySelector("#downloadFramesButton");
const speedInput = document.querySelector("#speedInput");
const timelineInput = document.querySelector("#timelineInput");
const resultsList = document.querySelector("#resultsList");
const statsGrid = document.querySelector("#statsGrid");
const timelineScale = document.querySelector("#timelineScale");
const timelineTrack = document.querySelector("#timelineTrack");
const playerImage = document.querySelector("#playerImage");
const playerPlaceholder = document.querySelector("#playerPlaceholder");
const playerTitle = document.querySelector("#playerTitle");
const playerSubtitle = document.querySelector("#playerSubtitle");
const downloadLink = document.querySelector("#downloadLink");

const map = L.map("map", {
  zoomControl: true
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

const streetLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
});

const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>',
  maxZoom: 19
});

satelliteLayer.addTo(map);

const aoiLayer = L.featureGroup().addTo(map);
const footprintLayer = L.geoJSON(null, {
  style: () => ({
    color: "#ff7b54",
    weight: 1.4,
    fillColor: "#ff7b54",
    fillOpacity: 0.1
  })
}).addTo(map);

const highlightedLayer = L.geoJSON(null, {
  style: () => ({
    color: "#f3efe7",
    weight: 2.2,
    fillColor: "#f5b13d",
    fillOpacity: 0.14
  })
}).addTo(map);

const state = {
  bbox: null,
  aoiRectangle: null,
  tempRectangle: null,
  anchorLatLng: null,
  drawing: false,
  items: [],
  selectedIndex: -1,
  playing: false,
  playTimer: null,
  exporting: false
};

const exportCanvas = document.createElement("canvas");
const exportContext = exportCanvas.getContext("2d");

function initializeDates() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 1);
  startDateInput.value = toDateInputValue(start);
  endDateInput.value = toDateInputValue(end);
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setResultCount(count) {
  resultCountText.textContent = `${count} scene${count === 1 ? "" : "s"} loaded`;
}

function setActiveMapLayer(layerName) {
  if (layerName === "satellite") {
    map.removeLayer(streetLayer);
    satelliteLayer.addTo(map);
    streetsLayerButton.classList.remove("active");
    satelliteLayerButton.classList.add("active");
    return;
  }

  map.removeLayer(satelliteLayer);
  streetLayer.addTo(map);
  satelliteLayerButton.classList.remove("active");
  streetsLayerButton.classList.add("active");
}

function setExportButtonState() {
  const renderableFrames = state.items.filter((scene) => scene.frameUrl).length;
  exportButton.disabled = state.exporting || renderableFrames < 2;
  downloadFramesButton.disabled = state.exporting || renderableFrames < 1;
  exportButton.textContent = state.exporting ? "Rendering video..." : "Download WebM";
  downloadFramesButton.textContent = state.exporting ? "Preparing ZIP..." : "Download ZIP";
}

function formatCoordinate(value) {
  return value.toFixed(4);
}

function formatBBox(bbox) {
  if (!bbox) {
    return "No area selected yet.";
  }

  const [west, south, east, north] = bbox;
  return `W ${formatCoordinate(west)}, S ${formatCoordinate(south)}, E ${formatCoordinate(east)}, N ${formatCoordinate(north)}`;
}

function normalizeBounds(bounds) {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return [
    Number(southWest.lng.toFixed(5)),
    Number(southWest.lat.toFixed(5)),
    Number(northEast.lng.toFixed(5)),
    Number(northEast.lat.toFixed(5))
  ];
}

function setBBox(bbox, fitMap = true) {
  state.bbox = bbox;
  bboxOutput.textContent = formatBBox(bbox);

  if (state.aoiRectangle) {
    aoiLayer.removeLayer(state.aoiRectangle);
  }

  if (!bbox) {
    state.aoiRectangle = null;
    return;
  }

  const latLngBounds = L.latLngBounds(
    [bbox[1], bbox[0]],
    [bbox[3], bbox[2]]
  );

  state.aoiRectangle = L.rectangle(latLngBounds, {
    color: "#f5b13d",
    weight: 2,
    dashArray: "8 6",
    fillOpacity: 0.08
  }).addTo(aoiLayer);

  if (fitMap) {
    map.fitBounds(latLngBounds.pad(0.35));
  }
}

function clearTempRectangle() {
  if (state.tempRectangle) {
    aoiLayer.removeLayer(state.tempRectangle);
    state.tempRectangle = null;
  }
}

function stopDrawing() {
  state.drawing = false;
  state.anchorLatLng = null;
  clearTempRectangle();
  drawAreaButton.dataset.active = "false";
  drawAreaButton.textContent = "Draw area on map";
  map.getContainer().classList.remove("drawing-active");
}

function startDrawing() {
  state.drawing = true;
  state.anchorLatLng = null;
  clearTempRectangle();
  drawAreaButton.dataset.active = "true";
  drawAreaButton.textContent = "Finish drawing";
  map.getContainer().classList.add("drawing-active");
  setStatus("Click two opposite corners on the map to define the search area.");
}

function toggleDrawing() {
  if (state.drawing) {
    stopDrawing();
    setStatus("Area drawing cancelled.");
    return;
  }
  startDrawing();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function buildSearchPayload() {
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;

  if (!state.bbox) {
    throw new Error("Select an area on the map before searching.");
  }

  if (!startDate || !endDate) {
    throw new Error("Choose both a start date and end date.");
  }

  if (startDate > endDate) {
    throw new Error("The start date must be before the end date.");
  }

  const maxCloud = clampNumber(cloudInput.value, 0, 100, 25);
  const limit = clampNumber(limitInput.value, 5, 60, 18);

  return {
    collections: [collectionSelect.value],
    bbox: state.bbox,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    limit,
    sortby: [{ field: "properties.datetime", direction: "asc" }],
    query: {
      "eo:cloud_cover": {
        lte: maxCloud
      }
    }
  };
}

function bboxArea(bbox) {
  if (!bbox || bbox.length !== 4) {
    return 0;
  }

  const width = Math.max(0, bbox[2] - bbox[0]);
  const height = Math.max(0, bbox[3] - bbox[1]);
  return width * height;
}

function intersectBBoxes(a, b) {
  if (!a || !b) {
    return null;
  }

  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);

  if (west >= east || south >= north) {
    return null;
  }

  return [west, south, east, north];
}

function computeCoverageScore(sceneBBox, targetBBox) {
  const intersection = intersectBBoxes(sceneBBox, targetBBox);
  const targetArea = bboxArea(targetBBox);

  if (!intersection || targetArea === 0) {
    return 0;
  }

  return bboxArea(intersection) / targetArea;
}

function sceneFullyCoversBBox(sceneBBox, targetBBox) {
  if (!sceneBBox || !targetBBox) {
    return false;
  }

  return sceneBBox[0] <= targetBBox[0]
    && sceneBBox[1] <= targetBBox[1]
    && sceneBBox[2] >= targetBBox[2]
    && sceneBBox[3] >= targetBBox[3];
}

function resolveFrameSource(item) {
  const assets = item.assets ?? {};

  if (assets.red?.href && assets.green?.href && assets.blue?.href) {
    return { type: "rgb-bands", assetKeys: ["red", "green", "blue"] };
  }

  if (assets.B04?.href && assets.B03?.href && assets.B02?.href) {
    return { type: "rgb-bands", assetKeys: ["B04", "B03", "B02"] };
  }

  if (assets.visual?.href) {
    return { type: "single-asset", assetKeys: ["visual"] };
  }

  if (assets.image?.href) {
    return { type: "single-asset", assetKeys: ["image"] };
  }

  if (assets.rendered_preview?.href) {
    return { type: "preview-image", href: assets.rendered_preview.href };
  }

  if (assets.overview?.href) {
    return { type: "preview-image", href: assets.overview.href };
  }

  if (assets.preview?.href) {
    return { type: "preview-image", href: assets.preview.href };
  }

  if (assets.thumbnail?.href) {
    return { type: "preview-image", href: assets.thumbnail.href };
  }

  return null;
}

function buildTitilerPreviewUrl(itemUrl, source, bbox) {
  const bboxPath = bbox.map((value) => Number(value).toFixed(5)).join(",");
  const params = new URLSearchParams({
    url: itemUrl,
    width: "900",
    height: "900",
    rescale: "0,4000",
    coord_crs: "epsg:4326",
    dst_crs: "epsg:4326"
  });

  source.assetKeys.forEach((assetKey) => {
    params.append("assets", assetKey);
  });

  if (source.type === "rgb-bands") {
    params.set("asset_as_band", "true");
    params.append("rescale", "0,4000");
    params.append("rescale", "0,4000");
    params.append("rescale", "0,4000");
  }

  return `${TITILER_STAC_API}/${bboxPath}/900x900.png?${params.toString()}`;
}

function resolveFrameUrl(item) {
  const frameSource = resolveFrameSource(item);

  if (!frameSource) {
    return "";
  }

  const itemUrl = item.links?.find((link) => link.rel === "self")?.href ?? "";

  if (
    state.bbox
    && itemUrl
    && (frameSource.type === "rgb-bands" || frameSource.type === "single-asset")
  ) {
    return buildTitilerPreviewUrl(itemUrl, frameSource, state.bbox);
  }

  if (frameSource.type === "preview-image") {
    const lowerHref = frameSource.href.toLowerCase();
    if (lowerHref.endsWith(".jpg") || lowerHref.endsWith(".jpeg") || lowerHref.endsWith(".png") || lowerHref.endsWith(".webp")) {
      return frameSource.href;
    }
  }

  return "";
}

function mapFeatureToScene(feature) {
  const item = feature;
  const properties = item.properties ?? {};
  const sceneDate = properties.datetime ?? properties["start_datetime"] ?? "";
  const cloudCover = Number(properties["eo:cloud_cover"]);
  const collection = item.collection ?? collectionSelect.value;
  const provider = properties.platform ?? properties.constellation ?? "Satellite scene";
  const frameUrl = resolveFrameUrl(item);
  const coverageScore = computeCoverageScore(item.bbox ?? null, state.bbox);
  const fullCoverage = sceneFullyCoversBBox(item.bbox ?? null, state.bbox);
  const tileId = properties["s2:tile_id"] ?? properties["mgrs:tile"] ?? "";

  return {
    id: item.id,
    collection,
    provider,
    datetime: sceneDate,
    cloudCover: Number.isFinite(cloudCover) ? cloudCover : null,
    geometry: item.geometry ?? null,
    bbox: item.bbox ?? null,
    coverageScore,
    fullCoverage,
    tileId,
    frameUrl,
    browserUrl: item.links?.find((link) => link.rel === "self")?.href ?? "",
    item
  };
}

function dedupeScenesByDay(scenes) {
  const bestByDay = new Map();

  scenes.forEach((scene) => {
    const dayKey = scene.datetime ? scene.datetime.slice(0, 10) : scene.id;
    const existing = bestByDay.get(dayKey);

    if (!existing) {
      bestByDay.set(dayKey, scene);
      return;
    }

    const sceneCloud = scene.cloudCover ?? Number.POSITIVE_INFINITY;
    const existingCloud = existing.cloudCover ?? Number.POSITIVE_INFINITY;

    if (scene.coverageScore > existing.coverageScore || (scene.coverageScore === existing.coverageScore && sceneCloud < existingCloud)) {
      bestByDay.set(dayKey, scene);
    }
  });

  return Array.from(bestByDay.values()).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function refineSceneSequence(scenes) {
  if (!scenes.length) {
    return [];
  }

  const mode = sequenceModeSelect.value;
  const frameReadyScenes = scenes.filter((scene) => scene.frameUrl);
  const usableScenes = frameReadyScenes.length ? frameReadyScenes : scenes;

  let filteredScenes = usableScenes;

  if (mode === "strict") {
    const fullCoverageScenes = usableScenes.filter((scene) => scene.fullCoverage);
    const coveragePool = fullCoverageScenes.length ? fullCoverageScenes : usableScenes.filter((scene) => scene.coverageScore > 0.92);
    filteredScenes = coveragePool.length ? coveragePool : usableScenes.filter((scene) => scene.coverageScore > 0);
  } else if (mode === "balanced") {
    const nearFullCoverageScenes = usableScenes.filter((scene) => scene.coverageScore > 0.72);
    filteredScenes = nearFullCoverageScenes.length ? nearFullCoverageScenes : usableScenes.filter((scene) => scene.coverageScore > 0);
  } else {
    filteredScenes = usableScenes.filter((scene) => scene.coverageScore > 0);
  }

  const dedupedScenes = mode === "dense" ? filteredScenes : dedupeScenesByDay(filteredScenes.length ? filteredScenes : usableScenes);

  const dominantTileCounts = new Map();
  dedupedScenes.forEach((scene) => {
    if (!scene.tileId) {
      return;
    }
    dominantTileCounts.set(scene.tileId, (dominantTileCounts.get(scene.tileId) ?? 0) + 1);
  });

  const dominantTile = Array.from(dominantTileCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const tileFilteredScenes = mode === "strict" && dominantTile
    ? dedupedScenes.filter((scene) => !scene.tileId || scene.tileId === dominantTile)
    : dedupedScenes;

  return tileFilteredScenes.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function formatSceneDate(datetime) {
  if (!datetime) {
    return "Unknown acquisition time";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(datetime));
}

function formatDateOnly(datetime) {
  if (!datetime) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(datetime));
}

function differenceInDays(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 86400000));
}

function renderAnalytics() {
  if (!statsGrid || !timelineScale || !timelineTrack) {
    return;
  }

  const scenes = state.items;
  statsGrid.innerHTML = "";
  timelineScale.innerHTML = "";
  timelineTrack.innerHTML = "";

  if (!scenes.length) {
    statsGrid.innerHTML = `
      <article class="stat-card">
        <span class="status-label">Scenes</span>
        <strong>0</strong>
        <p>No search yet</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Range</span>
        <strong>--</strong>
        <p>Waiting for results</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Cadence</span>
        <strong>--</strong>
        <p>Average revisit</p>
      </article>
      <article class="stat-card">
        <span class="status-label">Cloud</span>
        <strong>--</strong>
        <p>Average cloud cover</p>
      </article>
    `;
    timelineTrack.innerHTML = '<div class="empty-state">Timeline will appear after a search.</div>';
    return;
  }

  const datedScenes = scenes.filter((scene) => scene.datetime).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const firstScene = datedScenes[0] ?? scenes[0];
  const lastScene = datedScenes[datedScenes.length - 1] ?? scenes[scenes.length - 1];
  const dateSpanDays = datedScenes.length > 1 ? differenceInDays(firstScene.datetime, lastScene.datetime) : 0;
  const cloudValues = scenes.map((scene) => scene.cloudCover).filter((value) => Number.isFinite(value));
  const averageCloud = cloudValues.length
    ? `${(cloudValues.reduce((sum, value) => sum + value, 0) / cloudValues.length).toFixed(1)}%`
    : "--";

  let averageCadence = "--";
  if (datedScenes.length > 1) {
    const intervals = [];
    for (let index = 1; index < datedScenes.length; index += 1) {
      intervals.push(differenceInDays(datedScenes[index - 1].datetime, datedScenes[index].datetime));
    }
    const meanInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    averageCadence = `${meanInterval.toFixed(1)} d`;
  }

  statsGrid.innerHTML = `
    <article class="stat-card">
      <span class="status-label">Scenes</span>
      <strong>${scenes.length}</strong>
      <p>Current results</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Range</span>
      <strong>${dateSpanDays} d</strong>
      <p>${formatDateOnly(firstScene.datetime)} to ${formatDateOnly(lastScene.datetime)}</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Cadence</span>
      <strong>${averageCadence}</strong>
      <p>Average revisit</p>
    </article>
    <article class="stat-card">
      <span class="status-label">Cloud</span>
      <strong>${averageCloud}</strong>
      <p>Average cloud cover</p>
    </article>
  `;

  timelineScale.innerHTML = `
    <span>${formatDateOnly(firstScene.datetime)}</span>
    <span>${formatDateOnly(lastScene.datetime)}</span>
  `;

  if (datedScenes.length === 1) {
    const onlyIndex = scenes.findIndex((scene) => scene.id === datedScenes[0].id);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "timeline-dot active";
    dot.style.left = "50%";
    dot.dataset.label = formatDateOnly(datedScenes[0].datetime);
    dot.title = datedScenes[0].id;
    dot.addEventListener("click", () => selectScene(onlyIndex, true));
    timelineTrack.append(dot);
    return;
  }

  const spanMs = Math.max(1, new Date(lastScene.datetime) - new Date(firstScene.datetime));
  datedScenes.forEach((scene) => {
    const sceneIndex = scenes.findIndex((item) => item.id === scene.id);
    const offset = ((new Date(scene.datetime) - new Date(firstScene.datetime)) / spanMs) * 100;
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `timeline-dot${sceneIndex === state.selectedIndex ? " active" : ""}`;
    dot.style.left = `calc(1rem + (${offset} * (100% - 2rem) / 100))`;
    dot.dataset.label = formatDateOnly(scene.datetime);
    dot.title = scene.id;
    dot.addEventListener("click", () => selectScene(sceneIndex, true));
    timelineTrack.append(dot);
  });
}

function renderResults() {
  resultsList.innerHTML = "";
  footprintLayer.clearLayers();
  highlightedLayer.clearLayers();
  setResultCount(state.items.length);
  renderAnalytics();

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No scenes matched this search yet. Try widening the date range or increasing the cloud threshold.";
    resultsList.append(empty);
    renderPlayer();
    return;
  }

  state.items.forEach((scene, index) => {
    if (scene.geometry) {
      footprintLayer.addData(scene.geometry);
    }

    const card = document.createElement("article");
    card.className = `result-card${index === state.selectedIndex ? " active" : ""}`;

    const cloudText = scene.cloudCover === null ? "Cloud cover unavailable" : `${scene.cloudCover.toFixed(1)}% cloud cover`;
    const coverageText = scene.fullCoverage
      ? "Full AOI coverage"
      : `${(scene.coverageScore * 100).toFixed(0)}% AOI coverage`;
    const imageMarkup = scene.frameUrl
      ? `<img class="result-thumb" src="${scene.frameUrl}" alt="Preview for ${scene.id}" loading="lazy">`
      : `<div class="result-thumb result-thumb-placeholder">Preview unavailable</div>`;

    card.innerHTML = `
      ${imageMarkup}
      <div class="result-content">
        <div class="result-topline">
          <span class="pill">${scene.provider}</span>
          <span class="pill pill-muted">${scene.collection}</span>
        </div>
        <h3>${scene.id}</h3>
        <p>${formatSceneDate(scene.datetime)}</p>
        <p>${cloudText}</p>
        <p>${coverageText}</p>
        <button type="button" class="button button-inline" data-scene-index="${index}">Focus scene</button>
      </div>
    `;

    resultsList.append(card);
  });

  resultsList.querySelectorAll("[data-scene-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.sceneIndex);
      selectScene(index, true);
    });
  });

  if (state.selectedIndex === -1 && state.items.length) {
    selectScene(0, false);
  } else {
    renderPlayer();
  }
}

function focusSceneOnMap(scene) {
  highlightedLayer.clearLayers();
  if (scene.geometry) {
    highlightedLayer.addData(scene.geometry);
    const bounds = highlightedLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2));
    }
    return;
  }

  if (scene.bbox) {
    const bounds = L.latLngBounds(
      [scene.bbox[1], scene.bbox[0]],
      [scene.bbox[3], scene.bbox[2]]
    );
    map.fitBounds(bounds.pad(0.2));
  }
}

function renderPlayer() {
  const hasItems = state.items.length > 0;
  const selectedScene = state.items[state.selectedIndex] ?? null;
  timelineInput.disabled = !hasItems;
  playButton.disabled = !hasItems;
  setExportButtonState();
  timelineInput.max = String(Math.max(0, state.items.length - 1));
  timelineInput.value = String(Math.max(0, state.selectedIndex));

  if (!selectedScene) {
    playerImage.removeAttribute("src");
    playerImage.hidden = true;
    playerPlaceholder.hidden = false;
    playerPlaceholder.textContent = "Search an area to populate the timelapse frames.";
    playerTitle.textContent = "No frame selected";
    playerSubtitle.textContent = "Awaiting overpass search";
    downloadLink.hidden = true;
    playButton.textContent = "Play";
    return;
  }

  if (selectedScene.frameUrl) {
    playerImage.src = selectedScene.frameUrl;
    playerImage.hidden = false;
    playerPlaceholder.hidden = true;
    downloadLink.href = selectedScene.frameUrl;
    downloadLink.hidden = false;
  } else {
    playerImage.removeAttribute("src");
    playerImage.hidden = true;
    playerPlaceholder.hidden = false;
    playerPlaceholder.textContent = "This scene is missing a directly usable preview asset.";
    downloadLink.hidden = true;
  }

  playerTitle.textContent = `${state.selectedIndex + 1} / ${state.items.length} · ${formatSceneDate(selectedScene.datetime)}`;
  playerSubtitle.textContent = selectedScene.cloudCover === null
    ? `${selectedScene.id} · ${(selectedScene.coverageScore * 100).toFixed(0)}% AOI coverage`
    : `${selectedScene.id} · ${selectedScene.cloudCover.toFixed(1)}% cloud cover · ${(selectedScene.coverageScore * 100).toFixed(0)}% AOI coverage`;
}

function selectScene(index, focusMap) {
  state.selectedIndex = index;

  const cards = resultsList.querySelectorAll(".result-card");
  cards.forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === index);
  });

  if (focusMap) {
    focusSceneOnMap(state.items[index]);
  } else {
    highlightedLayer.clearLayers();
    if (state.items[index]?.geometry) {
      highlightedLayer.addData(state.items[index].geometry);
    }
  }

  renderAnalytics();
  renderPlayer();
}

function stopPlayback() {
  state.playing = false;
  clearInterval(state.playTimer);
  state.playTimer = null;
  playButton.textContent = "Play";
  setExportButtonState();
}

function startPlayback() {
  if (state.items.length < 2) {
    return;
  }

  state.playing = true;
  playButton.textContent = "Pause";
  setExportButtonState();

  const framesPerSecond = clampNumber(speedInput.value, 1, 6, 2);
  const interval = Math.round(1000 / framesPerSecond);

  clearInterval(state.playTimer);
  state.playTimer = setInterval(() => {
    const nextIndex = (state.selectedIndex + 1) % state.items.length;
    selectScene(nextIndex, false);
  }, interval);
}

async function searchScenes() {
  let payload;

  try {
    payload = buildSearchPayload();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  stopPlayback();
  searchButton.disabled = true;
  setExportButtonState();
  setStatus("Searching public STAC scenes for overpasses that intersect the selected area...");

  try {
    const response = await fetch(EARTH_SEARCH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Search failed with HTTP ${response.status}.`);
    }

    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const rawScenes = features.map(mapFeatureToScene);
    state.items = refineSceneSequence(rawScenes);
    state.selectedIndex = state.items.length ? 0 : -1;

    renderResults();

    if (state.items.length) {
      const modeLabel = sequenceModeSelect.options[sequenceModeSelect.selectedIndex]?.text ?? "Balanced";
      setStatus(`Loaded ${state.items.length} overpasses in ${modeLabel.toLowerCase()} mode using the same AOI crop for each frame.`);
    } else {
      setStatus("The search completed, but no scenes matched the current date and cloud filters.");
    }
  } catch (error) {
    state.items = [];
    state.selectedIndex = -1;
    renderResults();
    setStatus(`Search error: ${error.message} Check your connection or try a smaller date range.`);
  } finally {
    searchButton.disabled = false;
  }
}

function sanitizeFilenamePart(value) {
  return String(value).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "timelapse";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadImageForExport(url) {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if ("createImageBitmap" in window) {
      return await createImageBitmap(blob);
    }

    const objectUrl = URL.createObjectURL(blob);
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not decode frame: ${url}`));
      };
      image.src = objectUrl;
    });
  } catch (error) {
    throw new Error(`Could not load frame for export: ${error.message}`);
  }
}

async function fetchFrameBlob(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

function triggerDownload(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
}

function drawExportFrame(image, width, height, labelScene) {
  exportContext.clearRect(0, 0, width, height);
  exportContext.fillStyle = "#08111f";
  exportContext.fillRect(0, 0, width, height);
  exportContext.drawImage(image, 0, 0, width, height);

  exportContext.fillStyle = "rgba(6, 12, 22, 0.62)";
  exportContext.fillRect(20, height - 78, Math.min(width - 40, 420), 58);
  exportContext.fillStyle = "#edf5ff";
  exportContext.font = '600 24px "Inter", sans-serif';
  exportContext.fillText(formatSceneDate(labelScene.datetime), 34, height - 42);
  exportContext.font = '400 16px "Inter", sans-serif';
  exportContext.fillText(labelScene.id, 34, height - 18);
}

async function exportAnimation() {
  if (state.exporting || state.items.length < 2) {
    return;
  }

  const frameScenes = state.items.filter((scene) => scene.frameUrl);
  if (frameScenes.length < 2) {
    setStatus("At least two renderable frames are needed before an animation can be downloaded.");
    return;
  }

  if (typeof MediaRecorder === "undefined") {
    setStatus("This browser does not support animation export through MediaRecorder.");
    return;
  }

  state.exporting = true;
  stopPlayback();
  setExportButtonState();
  setStatus(`Rendering ${frameScenes.length} frames into a downloadable WebM video...`);

  const previousIndex = state.selectedIndex;

  try {
    const loadedFrames = await Promise.all(frameScenes.map((scene) => loadImageForExport(scene.frameUrl)));
    const width = loadedFrames[0].naturalWidth || loadedFrames[0].width || 900;
    const height = loadedFrames[0].naturalHeight || loadedFrames[0].height || 900;
    exportCanvas.width = width;
    exportCanvas.height = height;

    const fps = clampNumber(speedInput.value, 1, 12, 2);
    const frameDuration = Math.max(120, Math.round(1000 / fps));
    const stream = exportCanvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";

    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support WebM export.");
    }

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    const renderedBlob = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => reject(new Error("WebM recording failed."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.start(250);

    for (let index = 0; index < loadedFrames.length; index += 1) {
      const image = loadedFrames[index];
      const labelScene = frameScenes[index];
      drawExportFrame(image, width, height, labelScene);

      const liveIndex = state.items.findIndex((scene) => scene.id === labelScene.id);
      if (liveIndex >= 0) {
        selectScene(liveIndex, false);
      }

      await wait(frameDuration);
    }

    await wait(frameDuration);
    recorder.stop();
    const blob = await renderedBlob;
    const fileName = `${sanitizeFilenamePart(collectionSelect.value)}-${sanitizeFilenamePart(startDateInput.value)}-${sanitizeFilenamePart(endDateInput.value)}.webm`;
    triggerDownload(blob, fileName);
    setStatus(`Downloaded WebM animation with ${frameScenes.length} frames as ${fileName}.`);
  } catch (error) {
    setStatus(`Animation export failed: ${error.message}`);
  } finally {
    state.exporting = false;
    setExportButtonState();
    if (previousIndex >= 0 && previousIndex < state.items.length) {
      selectScene(previousIndex, false);
    } else {
      renderPlayer();
    }
  }
}

async function downloadAllFrames() {
  if (state.exporting) {
    return;
  }

  const frameScenes = state.items.filter((scene) => scene.frameUrl);
  if (!frameScenes.length) {
    setStatus("There are no downloadable frames in the current result set.");
    return;
  }

  state.exporting = true;
  setExportButtonState();
  setStatus(`Packaging ${frameScenes.length} frames into a ZIP file...`);

  try {
    if (typeof JSZip === "undefined") {
      throw new Error("ZIP export library did not load.");
    }

    const zip = new JSZip();
    const folder = zip.folder("frames");

    for (let index = 0; index < frameScenes.length; index += 1) {
      const scene = frameScenes[index];
      const blob = await fetchFrameBlob(scene.frameUrl);
      const extension = blob.type.includes("png") ? "png" : blob.type.includes("jpeg") ? "jpg" : "png";
      const fileName = `${String(index + 1).padStart(3, "0")}-${sanitizeFilenamePart(scene.id)}.${extension}`;
      folder.file(fileName, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const zipName = `${sanitizeFilenamePart(collectionSelect.value)}-${sanitizeFilenamePart(startDateInput.value)}-${sanitizeFilenamePart(endDateInput.value)}-frames.zip`;
    triggerDownload(zipBlob, zipName);
    setStatus(`Downloaded ${frameScenes.length} frames as ${zipName}.`);
  } catch (error) {
    setStatus(`Frame download failed: ${error.message}`);
  } finally {
    state.exporting = false;
    setExportButtonState();
  }
}

drawAreaButton.addEventListener("click", toggleDrawing);

viewAreaButton.addEventListener("click", () => {
  stopDrawing();
  setBBox(normalizeBounds(map.getBounds()), false);
  setStatus("Using the current map view as the search area.");
});

clearAreaButton.addEventListener("click", () => {
  stopDrawing();
  setBBox(null);
  state.items = [];
  state.selectedIndex = -1;
  stopPlayback();
  renderResults();
  setStatus("Area cleared. Draw a new box to search again.");
});

searchButton.addEventListener("click", searchScenes);
streetsLayerButton.addEventListener("click", () => setActiveMapLayer("streets"));
satelliteLayerButton.addEventListener("click", () => setActiveMapLayer("satellite"));

timelineInput.addEventListener("input", () => {
  stopPlayback();
  selectScene(Number(timelineInput.value), false);
});

playButton.addEventListener("click", () => {
  if (state.playing) {
    stopPlayback();
    return;
  }
  startPlayback();
});

exportButton.addEventListener("click", exportAnimation);
downloadFramesButton.addEventListener("click", downloadAllFrames);

speedInput.addEventListener("input", () => {
  if (state.playing) {
    startPlayback();
  }
});

map.on("click", (event) => {
  if (!state.drawing) {
    return;
  }

  if (!state.anchorLatLng) {
    state.anchorLatLng = event.latlng;
    clearTempRectangle();
    state.tempRectangle = L.rectangle(L.latLngBounds(event.latlng, event.latlng), {
      color: "#8be9fd",
      weight: 2,
      dashArray: "6 6",
      fillOpacity: 0.08
    }).addTo(aoiLayer);
    setStatus("First corner placed. Click the opposite corner to finish the area.");
    return;
  }

  const bounds = L.latLngBounds(state.anchorLatLng, event.latlng);
  const bbox = normalizeBounds(bounds);
  stopDrawing();
  setBBox(bbox);
  setStatus("Area selected. You can now search for overpasses.");
});

map.on("mousemove", (event) => {
  if (!state.drawing || !state.anchorLatLng || !state.tempRectangle) {
    return;
  }

  state.tempRectangle.setBounds(L.latLngBounds(state.anchorLatLng, event.latlng));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.drawing) {
    stopDrawing();
    setStatus("Area drawing cancelled.");
  }
});

initializeDates();
setBBox([4.6, 51.85, 5.95, 52.55], true);
setStatus("Default area loaded. Search immediately or draw a different box on the map.");
renderResults();
setExportButtonState();
