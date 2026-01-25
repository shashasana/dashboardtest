// MAP INIT
const map = L.map("map").setView([39.5,-98.35],4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ attribution:"&copy; OpenStreetMap" }).addTo(map);

// STATE
let clients = [];
let filteredClients = []; // Track currently displayed clients

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
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyqMgpk3yhk3-9O-x9qjw7IlafGdm8ZI-Wznch0sY8MWH_mii_Y7MxtsM-lS-Wfv2S3/exec";

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
            const lat = cells[4] ? parseFloat(cells[4]) : null;
            const lng = cells[5] ? parseFloat(cells[5]) : null;
            
            let coords = [39.5, -98.35];
            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
              coords = [lat, lng];
            } else {
              coords = await geocodeLocation(location);
            }
            parsed.push([name, industry, location, coords]);
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
        const lat = cells[4] ? parseFloat(cells[4]) : null;
        const lng = cells[5] ? parseFloat(cells[5]) : null;
        
        let coords = [39.5, -98.35];
        if(lat && lng && !isNaN(lat) && !isNaN(lng)) {
          coords = [lat, lng];
        } else {
          coords = await geocodeLocation(location);
        }
        parsed.push([name, industry, location, coords]);
      }
    }
    return parsed;
}

let clients = [];
let legendStatus = {};
let markers = [], chart=null, currentChartType="bar";

// INIT
(async () => {
  const loadingDiv = document.getElementById("loadingStatus");
  loadingDiv.style.display = "block";
  loadingDiv.innerHTML = "⏳ Loading...";
  
  try {
    clients = await fetchClientsFromSheet();
    if(clients.length === 0) {
      loadingDiv.innerHTML = "❌ No clients loaded.";
      return;
    }
    setupFilters();
    buildLegend();
    loadMarkers(clients);
    loadingDiv.innerHTML = `✅ Loaded ${clients.length} clients`;
    setTimeout(() => loadingDiv.style.display = "none", 3000);
  } catch(e) {
    loadingDiv.innerHTML = `❌ Error: ${e.message}`;
  }
})();

// WEATHER
async function fetchWeather(lat, lng) {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`);
    const d = await res.json();
    return {
      temp: d?.main?.temp !== undefined ? d.main.temp.toFixed(1) : "N/A",
      tzOffset: typeof d?.timezone === "number" ? d.timezone : 0
    };
  } catch(e){
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
  const [name, inds, loc, coords] = client;
  marker.bindPopup(`<b>${name}</b><br>Loading…`);
  const update = async () => {
    const {temp, tzOffset} = await fetchWeather(coords[0], coords[1]);
    const timeStr = formatLocalTime(tzOffset);
    marker.getPopup().setContent(
      `<b>${name}</b><br>Industry: ${inds}<br>Location: ${loc}<br>Time: ${timeStr}<br>Temp: ${temp}°C`
    );
  };
  await update();
  setInterval(update, 10*60*1000);
}

// MARKERS
function loadMarkers(data) {
  markers.forEach(m=>map.removeLayer(m));
  markers=[];
  filteredClients = data; // Track filtered data for chart
  data.forEach(item=>{
    const [_, inds, __, coords] = item;
    const mk = L.circleMarker(coords,{
      radius:8, fillColor: colors[inds.split(",")[0].trim()]||"#666",
      color:"#000", weight:1, fillOpacity:0.9
    }).addTo(map);
    mk.industries = inds.split(",").map(i=>i.trim());
    if(mk.industries.some(i=>legendStatus[i])) map.removeLayer(mk);
    setupPopup(mk, item);
    markers.push(mk);
  });
  updateChart(data);
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
    return !s || txt.includes(s);
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

document.getElementById("saveClientBtn").addEventListener("click", async () => {
  const name = document.getElementById("newClientName").value.trim();
  const industry = document.getElementById("newClientIndustry").value.trim();
  const location = document.getElementById("newClientLocation").value.trim();
  const serviceArea = document.getElementById("newClientServiceArea").value.trim();
  
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
        data: { name, industry, location, serviceArea, lat: coords[0], lng: coords[1] }
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
  clients.forEach((c, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = c[0];
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

document.querySelectorAll(".closeForm").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const formId = e.target.dataset.form;
    document.getElementById(formId).style.display = "none";
  });
});
