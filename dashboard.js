// MAP INIT
console.log('[DASHBOARD] Script loaded, waiting for DOMContentLoaded...');
let map; // Global map variable
document.addEventListener("DOMContentLoaded", () => {
console.log('[DASHBOARD] DOMContentLoaded fired, initializing map...');
// USA bounds: [south, west], [north, east]
const usaBounds = [[24.396308, -125.0], [49.384358, -66.93457]];
map = L.map("map", {
  maxBounds: usaBounds,
  maxBoundsViscosity: 1.0,
  minZoom: 4
}).setView([37.8, -96], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ attribution:"&copy; OpenStreetMap" }).addTo(map);
// Create a dedicated pane for service-area layers so markers stay clickable
try {
  map.createPane('serviceAreaPane');
  const p = map.getPane('serviceAreaPane');
  if (p) { p.style.zIndex = 350; }
} catch(_) {}
console.log('[DASHBOARD] Map initialized successfully');

// WEATHER LAYERS
const weatherLayers = {
  precipitation: null,
  clouds: null,
  radar: null,
  wind: null,
  temp: null
};

function initWeatherLayers() {
  console.log('[WEATHER] Initializing weather layers...');
  
  if (!map) {
    console.error('[WEATHER] Map not initialized!');
    return;
  }

  // Create weather tile layers
  weatherLayers.precipitation = L.tileLayer(
    '/api/weather?type=tile&layer=precipitation&z={z}&x={x}&y={y}',
    { opacity: 0.6, attribution: 'OpenWeatherMap' }
  );
  
  weatherLayers.clouds = L.tileLayer(
    '/api/weather?type=tile&layer=clouds&z={z}&x={x}&y={y}',
    { opacity: 0.6, attribution: 'OpenWeatherMap' }
  );
  
  weatherLayers.radar = L.tileLayer(
    '/api/weather?type=tile&layer=precipitation&z={z}&x={x}&y={y}',
    { opacity: 0.7, attribution: 'OpenWeatherMap' }
  );
  
  weatherLayers.wind = L.tileLayer(
    '/api/weather?type=tile&layer=wind&z={z}&x={x}&y={y}',
    { opacity: 0.6, attribution: 'OpenWeatherMap' }
  );
  
  weatherLayers.temp = L.tileLayer(
    '/api/weather?type=tile&layer=temperature&z={z}&x={x}&y={y}',
    { opacity: 0.6, attribution: 'OpenWeatherMap' }
  );

  // Setup toggle event listeners
  document.getElementById("precipToggle")?.addEventListener("change", (e) => {
    e.target.checked ? map.addLayer(weatherLayers.precipitation) : map.removeLayer(weatherLayers.precipitation);
  });

  document.getElementById("cloudsToggle")?.addEventListener("change", (e) => {
    e.target.checked ? map.addLayer(weatherLayers.clouds) : map.removeLayer(weatherLayers.clouds);
  });

  document.getElementById("radarToggle")?.addEventListener("change", (e) => {
    e.target.checked ? map.addLayer(weatherLayers.radar) : map.removeLayer(weatherLayers.radar);
  });

  document.getElementById("windToggle")?.addEventListener("change", (e) => {
    e.target.checked ? map.addLayer(weatherLayers.wind) : map.removeLayer(weatherLayers.wind);
  });

  document.getElementById("tempToggle")?.addEventListener("change", (e) => {
    e.target.checked ? map.addLayer(weatherLayers.temp) : map.removeLayer(weatherLayers.temp);
  });

  console.log('[WEATHER] Weather layers initialized');
}

// STATE
let clients = [];
let filteredClients = []; // Track currently displayed clients
let precomputedServiceAreas = {}; // **PERFORMANCE**: All service areas preloaded on startup

// COLORS
const colors = {
  "Speciality (Niche)":"#e74c3c","Window Treatments & Coverings":"#3498db","Home Organization & Closets":"#2ecc71",
  "Kitchens":"#f39c12","Pools":"#1abc9c","Roofing":"#9b59b6","Construction":"#34495e",
  "Painters":"#ff6f61","Fencing":"#16a085","Floor Coating":"#8e44ad","Landscaping":"#27ae60",
  "Cleaning":"#00bcd4","Pest Control":"#795548","Flooring":"#607d8b","Events Place":"#d35400",
  "Power Washing":"#00acc1","Home Improvement":"#5e35b1"
};

// GOOGLE SHEET CONFIG - UPDATE THIS WITH YOUR SHEET
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTLuqA1azB3yyRdwNLBIV5WLcO7CezuoMD4yEOtk-MF7V8RTq2ehxR5JnFOCGDQ4-v10TVtmpnTaSn2/pub?output=csv";

// APPS SCRIPT ENDPOINT - UPDATE THIS AFTER DEPLOYING
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxrSX96FuF-B7MFG1d458bdgnnVkyh1TWFuQDFnYur5vywe4OqzOoOZJ_DyuegddOic/exec";

// PARSE CSV
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;
  
  for(let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if(char === '"') {
      if(insideQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if(char === ',' && !insideQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if((char === '\n' || char === '\r') && !insideQuotes) {
      if(cell || row.length > 0) {
        row.push(cell.trim());
        if(row.some(c => c)) rows.push(row);
        row = [];
        cell = "";
      }
      if(char === '\r' && nextChar === '\n') i++;
    } else {
      cell += char;
    }
  }
  if(cell || row.length > 0) {
    row.push(cell.trim());
    if(row.some(c => c)) rows.push(row);
  }
  return rows;
}

// GEOCODE
async function geocodeLocation(location) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`);
    const data = await res.json();
    if(data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch(e) {}
  return [39.5, -98.35];
}

// FETCH SHEET
async function fetchClientsFromSheet() {
  try {
    // Fetch directly from Apps Script's Database sheet (real-time, not cached)
    if (!APPS_SCRIPT_URL) {
      console.log("APPS_SCRIPT_URL not configured, falling back to CSV");
      return fetchFromCSV();
    }
    
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ action: "getDatabase" })
      });
      
      const result = await response.json();
      
      if (result.success && result.data) {
        const parsed = [];
        for (let i = 0; i < result.data.length; i++) {
          const cells = result.data[i];
          if (cells.length >= 3 && cells[0]) {
            const name = (cells[0] || "").toString().trim();
            const industry = (cells[1] || "Unknown").toString().trim();
            const location = (cells[2] || "Unknown").toString().trim();
            const serviceArea = (cells[3] || "").toString().trim();
            const lat = cells[4] ? parseFloat(cells[4]) : null;
            const lng = cells[5] ? parseFloat(cells[5]) : null;
            
            let coords = [39.5, -98.35];
            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
              coords = [lat, lng];
            } else {
              coords = await geocodeLocation(location);
            }
            parsed.push([name, industry, location, serviceArea, coords]);
          }
        }
        console.log("Loaded " + parsed.length + " clients from Database sheet");
        return parsed;
      }
    } catch (e) {
      console.log("Apps Script fetch failed, falling back to CSV:", e);
    }
    
    // Fallback to CSV if Apps Script not available
    return fetchFromCSV();
  } catch(e) {
    console.error("Error in fetchClientsFromSheet:", e);
    return [];
  }
}

async function fetchFromCSV() { 
  try {
    let csv = null;
    try {
      // Add timestamp cache-buster to force fresh data
      const cacheBuster = `?t=${Date.now()}`;
      const res = await fetch(CSV_URL + cacheBuster);
      if(res.ok) csv = await res.text();
    } catch(e) {}
    
    if(!csv) return [];
    
    const rows = parseCSV(csv);
    if(rows.length < 2) return [];
    
    const parsed = [];
    for(let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if(cells.length >= 3 && cells[0]) {
        const name = cells[0].replace(/^"|"$/g, '').trim();
        const industry = (cells[1] || "Unknown").replace(/^"|"$/g, '').trim();
        const location = (cells[2] || "Unknown").replace(/^"|"$/g, '').trim();
        const serviceArea = (cells[3] || "").replace(/^"|"$/g, '').trim();
        const lat = cells[4] ? parseFloat(cells[4]) : null;
        const lng = cells[5] ? parseFloat(cells[5]) : null;
        
        let coords = [39.5, -98.35];
        if(lat && lng && !isNaN(lat) && !isNaN(lng)) {
          coords = [lat, lng];
        } else {
          coords = await geocodeLocation(location);
        }
        parsed.push([name, industry, location, serviceArea, coords]);
      }
    }
    return parsed;
}

let clients = [];
let legendStatus = {};
let markers = [], chart=null, currentChartType="bar";

// **PERFORMANCE**: Load all service areas at startup (CDN cached)
async function loadPrecomputedServiceAreas() {
  try {
    console.log('[PERF] Loading precomputed service areas from CDN...');
    const res = await fetch('/service-areas.json');
    console.log('[PERF] Fetch response:', res.status, res.statusText);
    if (!res.ok) {
      console.warn('[PERF] Service areas JSON not found (status ' + res.status + '), falling back to runtime fetch');
      return;
    }
    const data = await res.json();
    console.log('[PERF] JSON loaded, clients:', data.clients ? data.clients.length : 0);
    if (data.clients) {
      data.clients.forEach(client => {
        if (client.polygons && client.polygons.length > 0) {
          precomputedServiceAreas[client.name] = client.polygons;
          console.log('[PERF] Preloaded:', client.name, '(' + client.polygons.length + ' polygons)');
        }
      });
      console.log(`[PERF] ✅ Loaded service areas for ${Object.keys(precomputedServiceAreas).length} clients`);
      console.log('[PERF] Precomputed keys:', Object.keys(precomputedServiceAreas));
    }
  } catch (err) {
    console.warn('[PERF] Error loading precomputed service areas:', err);
  }
}

// **PERFORMANCE**: Batch fetch all service areas in parallel after markers load
async function batchFetchAllServiceAreas(clientsList) {
  console.log('[BATCH-FETCH] Starting parallel fetch for all ' + clientsList.length + ' clients...');
  
  const promises = clientsList.map(async (client) => {
    const [name, industry, location, serviceArea, coords] = client;
    if (!serviceArea || !serviceArea.trim()) return; // Skip clients with no service area
    
    const entries = serviceArea.split(',').map(e => e.trim()).filter(e => e);
    if (entries.length === 0) return;
    
    try {
      const polygons = [];
      // Fetch all ZIP codes for this client in parallel
      const results = await Promise.all(
        entries.map(entry => fetchPolygonForEntry(entry).catch(() => null))
      );
      
      results.forEach(result => {
        if (result && result.feature) {
          polygons.push(result);
        }
      });
      
      if (polygons.length > 0) {
        precomputedServiceAreas[name] = polygons;
        console.log('[BATCH-FETCH] ✅ Cached:', name, '(' + polygons.length + ' polygons)');
      }
    } catch (err) {
      console.warn('[BATCH-FETCH] Error for', name, ':', err);
    }
  });
  
  // Wait for all clients to fetch (with timeout to avoid hanging)
  await Promise.race([
    Promise.all(promises),
    new Promise((_, reject) => setTimeout(() => reject('Batch fetch timeout'), 60000))
  ]).catch(() => {
    console.log('[BATCH-FETCH] Timeout or error, but continuing...');
  });
  
  console.log('[BATCH-FETCH] ✅ Complete. Cached:', Object.keys(precomputedServiceAreas).length, 'clients');
}

// INIT
(async () => {
  const loadingDiv = document.getElementById("loadingStatus");
  loadingDiv.style.display = "block";
  loadingDiv.innerHTML = "⏳ Loading...";
  
  try {
    // Initialize weather layers first
    initWeatherLayers();
    
    // **PERFORMANCE**: Load all service area data at startup (CDN cached)
    await loadPrecomputedServiceAreas();
    
    clients = await fetchClientsFromSheet();
    // Localhost-only demo: inject service areas for preview without sheet changes
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try {
        const demo = "49501, 49503, Grand Rapids, MI";
        clients = clients.map(c => {
          if ((c[0]||"").toLowerCase().includes("north shore brick")) {
            c[3] = c[3] && c[3].trim().length ? c[3] : demo;
          }
          return c;
        });
      } catch(_) {}
    }
    if(clients.length === 0) {
      loadingDiv.innerHTML = "❌ No clients loaded.";
      return;
    }
    setupFilters();
    buildLegend();
    loadMarkers(clients);
    
    // **PERFORMANCE**: Batch fetch all service areas in parallel after markers load
    console.log('[INIT] Starting batch fetch of all service areas in background...');
    batchFetchAllServiceAreas(clients).then(() => {
      console.log('[INIT] ✅ All service areas cached and ready for instant clicks');
    });
    
    loadingDiv.innerHTML = `✅ Loaded ${clients.length} clients`;
    setTimeout(() => loadingDiv.style.display = "none", 3000);
  } catch(e) {
    loadingDiv.innerHTML = `❌ Error: ${e.message}`;
  }
})();

// WEATHER
async function fetchWeather(lat, lng) {
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`); // call serverless API
    if (!res.ok) return { temp:"N/A", tzOffset:0 };
    const d = await res.json();
    return {
      temp: typeof d?.main?.temp === "number" ? d.main.temp.toFixed(1) : "N/A",
      tzOffset: typeof d?.timezone === "number" ? d.timezone : 0
    };
  } catch(e) {
    return { temp:"N/A", tzOffset:0 };
  }
}


function formatLocalTime(offsetSeconds) {
  const utc = new Date().getTime() + new Date().getTimezoneOffset()*60000;
  const local = new Date(utc + offsetSeconds*1000);
  let hours = local.getHours();
  const mins = String(local.getMinutes()).padStart(2,'0');
  const ampm = hours>=12?"PM":"AM";
  const hr12 = hours%12||12;
  return `${hr12}:${mins} ${ampm}`;
}

// POPUP
async function setupPopup(marker, client) {
  try {
    const [name, inds, loc, serviceArea, coords] = client;
    console.log(`[POPUP-SETUP] Setting up popup for: ${name}`);
    marker.bindPopup(`<b>${name}</b><br>Industry: ${inds}<br>Location: ${loc}<br>Loading…`);
    const update = async () => {
      try {
        const {temp, tzOffset} = await fetchWeather(coords[0], coords[1]);
        const timeStr = formatLocalTime(tzOffset);
        marker.getPopup().setContent(
          `<b>${name}</b><br>Industry: ${inds}<br>Location: ${loc}<br>Time: ${timeStr}<br>Temp: ${temp}°C`
        );
      } catch(weatherErr) {
        console.error(`[POPUP] Weather fetch error for ${name}:`, weatherErr);
        marker.getPopup().setContent(
          `<b>${name}</b><br>Industry: ${inds}<br>Location: ${loc}<br>Time: N/A<br>Temp: N/A`
        );
      }
    };
    await update();
    setInterval(update, 10*60*1000);

    // Show popup on hover; click will toggle service-area polygons
    marker.on('mouseover', () => {
      try { 
        console.log(`[POPUP-HOVER] Mouse over: ${name}`);
        marker.openPopup(); 
      } catch(hoverErr) {
        console.error(`[POPUP-HOVER] Error:`, hoverErr);
      }
    });
    marker.on('mouseout', () => {
      try { 
        console.log(`[POPUP-HOVER] Mouse out: ${name}`);
        marker.closePopup(); 
      } catch(outErr) {
        console.error(`[POPUP-HOVER] Error on mouseout:`, outErr);
      }
    });
  } catch(setupErr) {
    console.error(`[POPUP-SETUP] Error setting up popup for ${client[0]}:`, setupErr);
    console.error(setupErr.stack);
  }
}

// MARKERS
function loadMarkers(data) {
  console.log(`[MARKERS] loadMarkers called with ${data.length} clients`);
  markers.forEach(m=>map.removeLayer(m));
  markers=[];
  filteredClients = data; // Track filtered data for chart
  // Clear any previously rendered service area layers
  if (window.__serviceAreaLayers) {
    Object.values(window.__serviceAreaLayers).forEach(lg => { try { lg.remove(); } catch(_){} });
    window.__serviceAreaLayers = {};
  }
  
  // Group clients by coordinates to detect duplicates
  const coordMap = {};
  data.forEach(item => {
    const [name, inds, __, ___, coords] = item;
    const key = `${coords[0]},${coords[1]}`;
    if (!coordMap[key]) coordMap[key] = [];
    coordMap[key].push(item);
  });
  
  // Create markers with offset for clients at same location
  data.forEach(item=>{
    const [name, inds, __, ___, coords] = item;
    console.log(`[MARKERS] Setting up marker for: ${name}`);
    
    // Get all clients at this location
    const key = `${coords[0]},${coords[1]}`;
    const clientsAtLocation = coordMap[key];
    const indexAtLocation = clientsAtLocation.findIndex(c => c[0] === name);
    const totalAtLocation = clientsAtLocation.length;
    
    // Calculate offset if multiple clients at same location
    let offsetCoords = coords;
    if (totalAtLocation > 1) {
      const angle = (indexAtLocation / totalAtLocation) * (2 * Math.PI);
      const radius = 0.003; // Approx 300m offset
      const offsetLat = coords[0] + radius * Math.cos(angle);
      const offsetLng = coords[1] + radius * Math.sin(angle);
      offsetCoords = [offsetLat, offsetLng];
    }
    
    const mk = L.circleMarker(offsetCoords,{
      radius:8, fillColor: colors[inds.split(",")[0].trim()]||"#666",
      color:"#000", weight:1, fillOpacity:0.9
    }).addTo(map);
    mk.industries = inds.split(",").map(i=>i.trim());
    if(mk.industries.some(i=>legendStatus[i])) map.removeLayer(mk);
    setupPopup(mk, item);
    setupServiceAreaOnClick(mk, item);
    markers.push(mk);
  });
  updateChart(data);
}

// --- Service Area (ZIP/Location) Polygons ---
const SERVICE_AREA_STYLE = {
  color: '#e74c3c',
  weight: 2,
  fillColor: '#e74c3c',
  fillOpacity: 0.25
};
const OVERLAP_STYLE = {
  color: '#e74c3c',
  weight: 2,
  dashArray: '4 4',
  fillColor: '#e74c3c',
  fillOpacity: 0.25
};

function getServiceAreaCache() {
  try { return JSON.parse(localStorage.getItem('serviceAreaCache')||'{}'); } catch(_) { return {}; }
}
function setServiceAreaCache(cache) {
  try { localStorage.setItem('serviceAreaCache', JSON.stringify(cache)); } catch(_) {}
}

// --- Service area preview helpers ---
let previewLayer = null;
const lastPreviewEntry = { add: null, edit: null };

function clearPreviewLayer() {
  if (previewLayer) {
    try { map.removeLayer(previewLayer); } catch(_) {}
    previewLayer = null;
  }
}

function appendEntryToInput(inputEl, entry, statusEl) {
  const parts = inputEl.value.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.includes(entry)) {
    if (statusEl) setPreviewStatus(statusEl, `"${entry}" already exists in Service Area`);
    return false; // duplicate
  }
  parts.push(entry);
  inputEl.value = parts.join(', ');
  return true; // added successfully
}

function setPreviewStatus(el, msg) {
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
}

async function previewServiceAreaEntry(entry, statusEl, contextKey) {
  if (!entry) {
    setPreviewStatus(statusEl, 'Enter a ZIP or place');
    return null;
  }
  const attempts = normalizeServiceAreaInput(entry).slice(0, 10);
  if (attempts.length === 0) {
    setPreviewStatus(statusEl, 'Enter a ZIP or place');
    return null;
  }
  setPreviewStatus(statusEl, 'Searching…');
  clearPreviewLayer();
  for (const attempt of attempts) {
    try {
      const result = await fetchPolygonForEntry(attempt);
      if (!result || !result.feature) continue;
      previewLayer = L.geoJSON(result.feature, { style: SERVICE_AREA_STYLE }).addTo(map);
      try { map.fitBounds(previewLayer.getBounds(), { padding: [20, 20] }); } catch(_) {}
      setPreviewStatus(statusEl, `Previewing: ${result.label || attempt}`);
      lastPreviewEntry[contextKey] = attempt;
      return result;
    } catch(err) {
      console.error('[PREVIEW] Error for', attempt, err);
    }
  }
  setPreviewStatus(statusEl, 'No polygon found');
  return null;
}

function normalizeServiceAreaInput(str) {
  if (!str) return [];
  const lines = str.split('\n').map(s=>s.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const tokens = line.split(',').map(t=>t.trim()).filter(Boolean);
    const zips = tokens.filter(isZip);
    const nonZipTokens = tokens.filter(t=>!isZip(t));
    if (zips.length > 0) {
      entries.push(...zips);
    }
    if (nonZipTokens.length > 0) {
      entries.push(nonZipTokens.join(', '));
    }
    if (tokens.length === 0) {
      entries.push(line);
    }
  }
  return entries;
}
function createSquareFeature(lon, lat, kmRadius=5) {
  // Approximate a square around the point; 1 deg lat ≈ 111 km
  const dLat = kmRadius / 111;
  const dLon = kmRadius / (111 * Math.cos(lat * Math.PI/180) || 1);
  const coords = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat]
  ];
  return { type:'Feature', geometry:{ type:'Polygon', coordinates:[coords] }, properties:{} };
}
function isZip(s) { return /^\d{5}$/.test(s); }

async function fetchPolygonForEntry(entry) {
  const cache = getServiceAreaCache();
  if (cache[entry]) {
    const c = cache[entry];
    console.log(`[POLY-FETCH] Using cached entry: ${entry}`);
    if (c.feature) {
      return { feature: c.feature, label: c.label || entry };
    }
  }
  
  // Fetch from backend (Google Apps Script handles Nominatim lookup)
  const url = `${APPS_SCRIPT_URL}?action=getPolygon&entry=${encodeURIComponent(entry)}`;
  console.log(`[POLY-FETCH] Backend URL for ${entry}: ${url}`);
  
  try {
    await new Promise(r=>setTimeout(r, 100)); // Small delay
    const res = await fetch(url);
    const data = await res.json();
    console.log(`[POLY-FETCH] Backend response for ${entry}:`, data);
    
    if (data.feature && data.label) {
      cache[entry] = { feature: data.feature, label: data.label };
      setServiceAreaCache(cache);
      return { feature: data.feature, label: data.label };
    } else if (data.error) {
      console.error(`[POLY-FETCH] Backend error for ${entry}:`, data.error);
    }
  } catch(err) {
    console.error(`[POLY-FETCH] Fetch error for ${entry}:`, err);
  }

  // Fallback: Overpass API for postal_code boundaries
  if (isZip(entry)) {
    console.log(`[POLY-FETCH] Trying Overpass for ZIP: ${entry}`);
    await new Promise(r=>setTimeout(r, 500));
    try {
      const overpassQuery = `[out:json][timeout:10];(relation["postal_code"="${entry}"]["boundary"="postal_code"];way["postal_code"="${entry}"]["boundary"="postal_code"];);out geom;`;
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
      const overpassRes = await fetch(overpassUrl);
      const overpassData = await overpassRes.json();
      if (overpassData.elements && overpassData.elements.length > 0 && typeof osmtogeojson !== 'undefined') {
        const geoJSON = osmtogeojson(overpassData);
        if (geoJSON.features && geoJSON.features.length > 0) {
          const feature = geoJSON.features[0];
          const cityName = overpassData.elements[0]?.tags?.name || overpassData.elements[0]?.tags?.['addr:city'] || '';
          const label = cityName ? `${cityName} ${entry}` : entry;
          cache[entry] = { feature, label };
          setServiceAreaCache(cache);
          console.log(`[POLY-FETCH] Cached Overpass polygon for: ${entry}`);
          return { feature, label };
        }
      }
    } catch(err) {
      console.error(`[POLY-FETCH] Overpass error for ${entry}:`, err);
    }
  }

  // Final fallback: US Census TIGER for ZCTA polygons
  if (isZip(entry)) {
    console.log(`[POLY-FETCH] Trying Census TIGER for ZIP: ${entry}`);
    await new Promise(r=>setTimeout(r, 500));
    try {
      const censusUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?where=ZCTA5='${entry}'&outFields=*&outSR=4326&f=geojson`;
      console.log(`[POLY-FETCH] Census URL: ${censusUrl}`);
      const censusRes = await fetch(censusUrl);
      console.log(`[POLY-FETCH] Census HTTP status: ${censusRes.status}`);
      const censusData = await censusRes.json();
      console.log(`[POLY-FETCH] Census response:`, censusData);
      if (censusData.features && censusData.features.length > 0) {
        const feature = censusData.features[0];
        const label = entry; // Use ZIP as label for Census data
        cache[entry] = { feature, label };
        setServiceAreaCache(cache);
        console.log(`[POLY-FETCH] Cached Census TIGER polygon for: ${entry}`);
        return { feature, label };
      }
    } catch(err) {
      console.error(`[POLY-FETCH] Census TIGER error for ${entry}:`, err);
    }
  }

  console.log(`[POLY-FETCH] No polygon found for: ${entry}`);
  return null;
}

function buildLabel(entry, item) {
  // Format: "City ST ZIP" or just "ZIP" if no city found
  try {
    if (isZip(entry)) {
      const disp = (item?.display_name||'').split(',').map(s=>s.trim());
      // Filter out the ZIP itself from display_name parts
      const parts = disp.filter(p => p !== entry && !/^\d{5}$/.test(p));
      const city = parts[0] || '';
      const state = parts.find(v=>/\b[A-Z]{2}\b/.test(v)) || '';
      // Build clean label without duplicating ZIP
      if (city && state) {
        return `${city} ${state} ${entry}`;
      } else if (city) {
        return `${city} ${entry}`;
      } else {
        return entry; // Just ZIP if no city found
      }
    } else {
      return entry; // keep user-provided for locations
    }
  } catch(_) { return entry; }
}

async function setupServiceAreaOnClick(marker, client) {
  try {
    const [name, inds, loc, serviceArea, coords] = client;
    console.log(`[SA-SETUP] Attaching for: ${name}, serviceArea: "${serviceArea}"`);
    const entries = [...new Set(normalizeServiceAreaInput(serviceArea))].slice(0, 12);
    console.log(`[SA-SETUP] Normalized to:`, entries);
    if (entries.length === 0) {
      console.log(`[SA-SETUP] No entries, skipping click handler for ${name}`);
      return;
    }
    if (!window.__serviceAreaLayers) window.__serviceAreaLayers = {};
    
    marker.on('click', async () => {
      try {
        console.log(`[SA-CLICK] Marker clicked: ${name}`);
        const existing = window.__serviceAreaLayers[name];
        if (existing) {
          // Toggle off: remove the layer group
          try { map.removeLayer(existing); } catch(_) {}
          try { existing.clearLayers(); } catch(_) {}
          delete window.__serviceAreaLayers[name];
          return;
        }

        const group = L.layerGroup().addTo(map);
        
        // **PERFORMANCE**: Use precomputed polygons instead of fetching on click
        // This is instant - zero network calls
        const results = precomputedServiceAreas[name] || [];
        console.log('[SA-CLICK] Looking for precomputed data:', name);
        console.log('[SA-CLICK] Available keys:', Object.keys(precomputedServiceAreas));
        console.log('[SA-CLICK] Found polygons:', results.length);
        
        // If no precomputed data, fall back to fetching (but cache it)
        let finalResults = results;
        if (results.length === 0) {
          console.log(`[SA-CLICK] ❌ No precomputed data for ${name}, FETCHING...`);
          const fetchedResults = [];
          for (const e of entries) {
            const result = await fetchPolygonForEntry(e);
            if (!result || !result.feature) continue;
            fetchedResults.push(result);
          }
          finalResults = fetchedResults;
        }

        if (finalResults.length === 0) {
          // Fallback: render a small area around the client's location
          try {
            const lat = coords[0], lon = coords[1];
            let feature = null;
            if (typeof turf !== 'undefined' && turf.circle) {
              feature = turf.circle([lon, lat], 5, { steps:64, units:'kilometers' });
            } else {
              feature = createSquareFeature(lon, lat, 5);
            }
            L.geoJSON(feature, { style: SERVICE_AREA_STYLE }).addTo(group).bindTooltip('Location area', { permanent:false, direction:'center' });
          } catch(_) {}
          window.__serviceAreaLayers[name] = group;
          return;
        }

        // Union all features for a clean solid polygon
        let unionFeature = finalResults[0].feature || finalResults[0];
        if (typeof turf !== 'undefined' && turf.union) {
          for (let i=1;i<finalResults.length;i++) {
            const featureToUnion = finalResults[i].feature || finalResults[i];
            try {
              const u = turf.union(unionFeature, featureToUnion);
              if (u) unionFeature = u;
            } catch(_) {}
          }
        }
        
        // **PERFORMANCE**: Simplify polygon to reduce render time
        if (typeof turf !== 'undefined' && turf.simplify) {
          try {
            unionFeature = turf.simplify(unionFeature, { 
              tolerance: 0.0005,  // ~50 meters
              highQuality: true 
            });
            console.log('[SA-SIMPLIFY] Polygon simplified for faster render');
          } catch(_) {}
        }
        
        try {
          L.geoJSON(unionFeature, { style: SERVICE_AREA_STYLE, interactive:false, pane:'serviceAreaPane' }).addTo(group);
          console.log('[SA-RENDER] Union polygon added to map');
        } catch(err) { console.error('[SA-RENDER] Error adding union:', err); }
        
        // Add blue pin icons with shadow at each entry center
        const pinIcon = L.icon({
          iconUrl: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="0" dy="2" result="offsetblur"/><feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 18 9 18s9-11.25 9-18c0-4.97-4.03-9-9-9z" fill="#3498db" filter="url(#shadow)"/><circle cx="12" cy="9" r="3" fill="white"/></svg>`),
          iconSize: [24, 36],
          iconAnchor: [12, 36],
          popupAnchor: [0, -36]
        });
        for (const item of finalResults) {
          const feature = item.feature || item;
          const label = item.label || '';
          if (typeof turf !== 'undefined' && turf.center) {
            const center = turf.center(feature);
            const [lng, lat] = center.geometry.coordinates;
            L.marker([lat, lng], { icon: pinIcon }).addTo(group);
          }
        }
        
        // Invisible interactive layers per entry for hover tooltips
        for (const item of finalResults) {
          const feature = item.feature || item;
          const label = item.label || '';
          const invisible = L.geoJSON(feature, { style: { opacity:0, fillOpacity:0 }, interactive:true, pane:'serviceAreaPane' });
          invisible.addTo(group).bindTooltip(label, { permanent:false, direction:'center' });
        }
        // Dashed overlaps between entries only where they intersect
        if (typeof turf !== 'undefined' && turf.intersect) {
          for (let i=0;i<finalResults.length;i++) {
            for (let j=i+1;j<finalResults.length;j++) {
              try {
                const f1 = finalResults[i].feature || finalResults[i];
                const f2 = finalResults[j].feature || finalResults[j];
                const overlap = turf.intersect(f1, f2);
                if (overlap) {
                  L.geoJSON(overlap, { style: OVERLAP_STYLE }).addTo(group);
                }
              } catch(_) {}
            }
          }
        }

        // Add dashed boundary lines for each ZIP
        try {
          for (const item of finalResults) {
            const feature = item.feature || item;
            const label = item.label || '';
            // Render dashed outline for each ZIP boundary in dedicated pane
            L.geoJSON(feature, { 
              style: { color:'#333', weight:2, dashArray:'5 5', fillOpacity:0, interactive:true },
              interactive: true,
              pane: 'serviceAreaPane'
            }).addTo(group).bindTooltip(label, { permanent:false, direction:'center' });
          }
        } catch(err) { console.error('[SA-BOUNDARIES] Error:', err); }

        window.__serviceAreaLayers[name] = group;
        console.log('[SA-COMPLETE] Service area rendered and cached for', name);
      } catch(clickErr) {
        console.error(`[SA-CLICK] Error in click handler for ${name}:`, clickErr);
        console.error(clickErr.stack);
      }
    });
  } catch(setupErr) {
    console.error(`[SA-SETUP] Error setting up service area click for ${name}:`, setupErr);
    console.error(setupErr.stack);
  }
}

// CHART
function updateChart(data){
  console.log("updateChart called with", data.length, "clients");
  const counts={}, colorArr={};
  data.forEach(c=>{
    c[1].split(",").map(i=>i.trim()).forEach(i=>{
      counts[i]=(counts[i]||0)+1;
      colorArr[i]=colors[i]||"#666";
    });
  });
  let labels=Object.keys(counts).sort();
  console.log("Chart labels:", labels);
  const values=labels.map(l=>counts[l]);
  const bg=labels.map(l=>colorArr[l]);
  if(chart) chart.destroy();
  chart=new Chart(document.getElementById("industryChart"),{
    type: currentChartType,
    data:{ labels, datasets:[{ data:values, backgroundColor:bg, borderWidth:0 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }},
      scales: currentChartType==="bar"?{y:{beginAtZero:true},x:{display:false}}:{}
    }
  });
}

// FILTERS
function applyFilters(){
  const s=document.getElementById("searchBox").value.toLowerCase().trim();
  const filtered = clients.filter(c=>{
    const txt=(c[0]+" "+c[1]+" "+c[2]).toLowerCase();
    if(s && !txt.includes(s)) return false; // Search filter
    const industries = c[1].split(",").map(i=>i.trim());
    return !industries.some(ind=>legendStatus[ind]); // Exclude if any industry is hidden
  });
  console.log("applyFilters: search term=", s, "filtered count=", filtered.length);
  loadMarkers(filtered);
}

function setupFilters(){}

// LEGEND
function buildLegend(){
  const box=document.getElementById("legendBox");
  box.innerHTML="<button id='resetLegend'>Reset All</button><b>Industry Legend</b><br><br>";
  const set=new Set();
  clients.forEach(c=>c[1].split(",").forEach(i=>set.add(i.trim())));
  [...set].sort().forEach(ind=>{
    legendStatus[ind]=legendStatus[ind]||false;
    const div=document.createElement("div");
    div.className="legend-item";
    div.innerHTML=`<div class="legend-color" style="background:${colors[ind]||"#666"}"></div>${ind}`;
    div.style.textDecoration=legendStatus[ind]?'line-through':'none';
    div.onclick=()=>{
      legendStatus[ind]=!legendStatus[ind];
      div.style.textDecoration=legendStatus[ind]?'line-through':'none';
      applyFilters();
    };
    box.appendChild(div);
  });

  document.getElementById("resetLegend").onclick = () => {
    Object.keys(legendStatus).forEach(k=>legendStatus[k]=false);
    document.querySelectorAll(".legend-item").forEach(d=>d.style.textDecoration="none");
    applyFilters();
  }
}

// EVENTS
document.getElementById("searchBox").addEventListener("input",applyFilters);
document.getElementById("toggleChartType").addEventListener("click",()=>{
  currentChartType=currentChartType==="bar"?"pie":"bar";
  document.getElementById("toggleChartType").innerText=currentChartType==="bar"?"Switch to Pie Chart":"Switch to Bar Chart";
  updateChart(filteredClients); // Use filtered clients, not all clients
});

// ADD CLIENT
async function geocodeAndValidate(location) {
  const statusDiv = document.getElementById("geocodeStatus");
  statusDiv.innerHTML = "🔍 Geocoding...";
  statusDiv.style.display = "block";
  
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=3`);
    const data = await res.json();
    
    if(data.length === 0) {
      statusDiv.innerHTML = "❌ Location not found.";
      return null;
    }
    
    const top = data[0];
    const confirmed = confirm(`Is this correct?\n\n${top.display_name}\n\nLat: ${top.lat}, Lon: ${top.lon}`);
    
    if(!confirmed) {
      statusDiv.innerHTML = "⚠️ Try again.";
      return null;
    }
    
    statusDiv.innerHTML = `✓ Confirmed`;
    return [parseFloat(top.lat), parseFloat(top.lon)];
  } catch(e) {
    statusDiv.innerHTML = "⚠️ Error: " + e.message;
    return null;
  }
}

// Preview/add service area on Add Client form
const previewNewBtn = document.getElementById("previewNewAreaBtn");
const addNewBtn = document.getElementById("addNewAreaBtn");
if (previewNewBtn && addNewBtn) {
  previewNewBtn.addEventListener("click", async () => {
    const entry = document.getElementById("newClientServiceArea").value.trim();
    await previewServiceAreaEntry(entry, document.getElementById("previewNewStatus"), 'add');
  });
  addNewBtn.addEventListener("click", () => {
    const input = document.getElementById("newClientServiceArea");
    const statusEl = document.getElementById("previewNewStatus");
    const entry = (lastPreviewEntry.add || input.value.trim());
    if (!entry) { setPreviewStatus(statusEl, 'Nothing to add'); return; }
    appendEntryToInput(input, entry);
    setPreviewStatus(statusEl, `Added ${entry} to Service Area`);
  });
}

document.getElementById("saveClientBtn").addEventListener("click", async () => {
  const name = document.getElementById("newClientName").value.trim();
  const industry = document.getElementById("newClientIndustry").value.trim();
  const location = document.getElementById("newClientLocation").value.trim();
  const serviceArea = document.getElementById("newClientServiceArea").value.trim();
  const poster = document.getElementById("newClientPoster").value.trim();
  const slackUserId = document.getElementById("newClientSlackUserId").value.trim();
  
  if(!name || !industry || !location) {
    alert("Fill in all required fields");
    return;
  }
  
  if(!APPS_SCRIPT_URL) {
    alert("Apps Script endpoint not configured. Deploy first.");
    return;
  }
  
  const statusDiv = document.getElementById("geocodeStatus");
  const coords = await geocodeAndValidate(location);
  if(!coords) return;
  
  statusDiv.innerHTML = "💾 Saving...";
  
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "addClient",
        data: { name, industry, location, serviceArea, poster, slackUserId, lat: coords[0], lng: coords[1] }
      })
    });
    
    const result = await response.json();
    if(result.success) {
      statusDiv.innerHTML = "✅ Added!";
      setTimeout(() => location.reload(), 1500);
    } else {
      statusDiv.innerHTML = "❌ " + result.error;
    }
  } catch(e) {
    statusDiv.innerHTML = "❌ " + e.message;
  }
});

// DELETE
function populateDeleteDropdown() {
  const select = document.getElementById("clientToDelete");
  select.innerHTML = "<option value=''>Select client...</option>";
  // Create array with indices and sort by client name
  const clientsWithIdx = clients.map((c, idx) => ({ name: c[0], idx: idx }));
  clientsWithIdx.sort((a, b) => a.name.localeCompare(b.name));
  clientsWithIdx.forEach(({ name, idx }) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

document.getElementById("clientToDelete").addEventListener("change", (e) => {
  document.getElementById("confirmDeleteBtn").disabled = e.target.value === "";
});

document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
  const idx = parseInt(document.getElementById("clientToDelete").value);
  if(isNaN(idx)) return;
  
  const client = clients[idx];
  if(!confirm(`Delete "${client[0]}"?`)) return;
  
  const statusDiv = document.getElementById("deleteStatus");
  statusDiv.innerHTML = "⏳ Deleting...";
  statusDiv.style.display = "block";
  
  if(!APPS_SCRIPT_URL) {
    statusDiv.innerHTML = "Apps Script not configured.";
    return;
  }
  
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "deleteClient",
        data: { clientName: client[0] }
      })
    });
    
    const result = await response.json();
    if(result.success) {
      statusDiv.innerHTML = "✅ Deleted!";
      setTimeout(() => location.reload(), 1500);
    } else {
      statusDiv.innerHTML = "❌ " + result.error;
    }
  } catch(e) {
    statusDiv.innerHTML = "❌ " + e.message;
  }
});

// TRASH
document.getElementById("trashBtn").addEventListener("click", async () => {
  const trashView = document.getElementById("trashView");
  trashView.style.display = trashView.style.display === "none" ? "block" : "none";
  
  if(trashView.style.display === "block") {
    const trashList = document.getElementById("trashList");
    trashList.innerHTML = "Loading...";
    
    if(!APPS_SCRIPT_URL) {
      trashList.innerHTML = "Apps Script not configured.";
      return;
    }
    
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ action: "getTrash" })
      });
      
      const result = await response.json();
      
      if(result.success && result.trash && result.trash.length > 0) {
        trashList.innerHTML = result.trash.map((item, idx) => `
          <div style="padding:8px; border-bottom:1px solid #eee;">
            <b>${item[0]}</b><br><small>${item[1]} | ${item[2]}</small>
            <div style="margin-top:5px;">
              <button class="restoreBtn" data-idx="${idx}" style="padding:3px 6px; background:#27ae60; color:white; border:none; border-radius:2px; cursor:pointer; font-size:10px; margin-right:3px;">Restore</button>
              <button class="deletePermBtn" data-idx="${idx}" style="padding:3px 6px; background:#c0392b; color:white; border:none; border-radius:2px; cursor:pointer; font-size:10px;">Delete</button>
            </div>
          </div>
        `).join("");
        
        document.querySelectorAll(".restoreBtn").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if(confirm("Restore?")) {
              await restoreClient(idx);
            }
          });
        });
        
        document.querySelectorAll(".deletePermBtn").forEach(btn => {
          btn.addEventListener("click", async (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if(confirm("Permanently delete?")) {
              await permanentlyDeleteClient(idx);
            }
          });
        });
      } else {
        trashList.innerHTML = "Trash is empty";
      }
    } catch(e) {
      trashList.innerHTML = "Error: " + e.message;
    }
  }
});

async function restoreClient(idx) {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "restoreClient", index: idx })
    });
    
    const result = await response.json();
    if(result.success) {
      setTimeout(() => location.reload(), 500);
    }
  } catch(e) {
    alert("Error: " + e.message);
  }
}

async function permanentlyDeleteClient(idx) {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "permanentlyDelete", index: idx })
    });
    
    const result = await response.json();
    if(result.success) {
      setTimeout(() => location.reload(), 500);
    }
  } catch(e) {
    alert("Error: " + e.message);
  }
}

// BUTTONS
document.getElementById("addClientBtn").addEventListener("click", () => {
  const form = document.getElementById("addClientForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
});

document.getElementById("deleteClientBtn").addEventListener("click", () => {
  const form = document.getElementById("deleteClientForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
  if(form.style.display === "block") populateDeleteDropdown();
});

// REFRESH SERVICE AREAS BUTTON (localhost only - Vercel doesn't support process spawning)
const isProduction = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

if (isProduction) {
  // Hide refresh button on production (batch-fetch handles it automatically)
  const refreshBtn = document.getElementById("refreshServiceAreasBtn");
  if (refreshBtn) {
    refreshBtn.style.display = "none";
  }
  const refreshStatus = document.getElementById("refreshStatus");
  if (refreshStatus) {
    refreshStatus.innerHTML = "💡 Service areas auto-loaded via batch fetch on page load";
    refreshStatus.style.display = "block";
    refreshStatus.style.background = "#e3f2fd";
    refreshStatus.style.color = "#1565c0";
  }
} else {
  // Show refresh button on localhost
  document.getElementById("refreshServiceAreasBtn").addEventListener("click", async () => {
    const btn = document.getElementById("refreshServiceAreasBtn");
    const statusDiv = document.getElementById("refreshStatus");
    
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.textContent = "⏳ Refreshing...";
    
    statusDiv.style.display = "block";
    statusDiv.innerHTML = "🔄 Fetching service areas from Google Sheet...";
    statusDiv.style.background = "#e8f4f8";
    statusDiv.style.color = "#2c3e50";
    
    try {
      const response = await fetch("/api/refresh-service-areas");
      const data = await response.json();
      
      if (data.success) {
        statusDiv.style.background = "#d4edda";
        statusDiv.style.color = "#155724";
        statusDiv.innerHTML = "✅ Service areas refreshed! Reloading page...";
        
        // Reload precomputed data
        await new Promise(r => setTimeout(r, 1500));
        window.location.reload();
      } else {
        statusDiv.style.background = "#f8d7da";
        statusDiv.style.color = "#721c24";
        statusDiv.innerHTML = "❌ Refresh failed: " + (data.error || "Unknown error");
        
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.textContent = originalText;
      }
    } catch (err) {
      statusDiv.style.background = "#f8d7da";
      statusDiv.style.color = "#721c24";
      statusDiv.innerHTML = "❌ Error: " + err.message;
      
      btn.disabled = false;
    btn.style.opacity = "1";
    btn.textContent = originalText;
  }
});

document.querySelectorAll(".closeForm").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const formId = e.target.dataset.form;
    document.getElementById(formId).style.display = "none";
    
    // Clear preview layers and status when closing forms
    if (formId === "editClientForm" || formId === "addClientForm") {
      clearPreviewLayer();
      const previewStatus = document.getElementById(formId === "addClientForm" ? "previewNewStatus" : "previewEditStatus");
      if (previewStatus) {
        previewStatus.style.display = "none";
        previewStatus.textContent = "";
      }
    }
  });
});
});