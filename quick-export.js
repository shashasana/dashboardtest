/**
 * EXPORT UTILITY - Generate service-areas.json from Google Sheet CSV
 * 
 * Run: node quick-export.js "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/pub?output=csv"
 * 
 * Or set the CSV_URL below
 */

const fs = require('fs');
const path = require('path');

// UPDATE THIS with your published CSV URL
// You can also pass it as command line argument: node quick-export.js "URL_HERE"
let CSV_URL = process.argv[2] || "https://docs.google.com/spreadsheets/d/e/2PACX-1vTLuqA1azB3yyRdwNLBIV5WLcO7CezuoMD4yEOtk-MF7V8RTq2ehxR5JnFOCGDQ4-v10TVtmpnTaSn2/pub?output=csv";

console.log('[CSV] URL:', CSV_URL);

// Helper: Create square fallback geometry when polygon not found
function createSquareFeature(lon, lat, kmRadius = 5) {
  const lonNum = parseFloat(lon);
  const latNum = parseFloat(lat);
  if (!Number.isFinite(lonNum) || !Number.isFinite(latNum)) {
    return null;
  }
  const dLat = kmRadius / 111;
  const dLon = kmRadius / (111 * Math.cos(latNum * Math.PI / 180) || 1);
  const coords = [
    [lonNum - dLon, latNum - dLat],
    [lonNum + dLon, latNum - dLat],
    [lonNum + dLon, latNum + dLat],
    [lonNum - dLon, latNum + dLat],
    [lonNum - dLon, latNum - dLat]
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {}
  };
}

function ensureFeature(geo) {
  if (!geo) return null;
  if (geo.type === 'Feature') return geo;
  if (geo.type === 'Polygon' || geo.type === 'MultiPolygon') {
    return { type: 'Feature', geometry: geo, properties: {} };
  }
  return null;
}

async function fetchCensusZipPolygon(entry) {
  if (!/^\d{5}$/.test(entry)) return null;
  try {
    const censusUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?where=ZCTA5='${entry}'&outFields=*&outSR=4326&f=geojson`;
    const res = await fetch(censusUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.find(f => f?.geometry?.type === 'Polygon' || f?.geometry?.type === 'MultiPolygon');
    if (!feature) return null;
    return { label: entry, feature: ensureFeature(feature) || feature };
  } catch (_) {
    return null;
  }
}

// Helper: Fetch polygon from Nominatim
async function fetchNominatimPolygon(entry) {
  const isZip = /^\d{5}$/.test(entry);
  
  try {
    // Wait 500ms for rate limiting
    await new Promise(r => setTimeout(r, 500));
    
    const searchUrl = isZip 
      ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&postalcode=${encodeURIComponent(entry)}`
      : `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(entry + ', United States')}`;
    
    console.log(`    [FETCH] Searching: ${entry}`);
    const searchRes = await fetch(searchUrl);
    
    if (!searchRes.ok) {
      console.log(`      [WARN] Search HTTP ${searchRes.status}`);
      return null;
    }
    
    const searchData = await searchRes.json();
    if (!searchData || searchData.length === 0) {
      console.log(`      [WARN] No results found`);
      return null;
    }
    
    const item = searchData[0];
    
    // Build label
    let label = entry;
    if (isZip && item.display_name) {
      const parts = item.display_name.split(',').map(s => s.trim()).filter(p => p !== entry && !/^\d{5}$/.test(p));
      const city = parts[0] || '';
      const state = parts.find(v => /\b[A-Z]{2}\b/.test(v)) || '';
      if (city && state) {
        label = `${city} ${state} ${entry}`;
      } else if (city) {
        label = `${city} ${entry}`;
      }
    }
    
    // Try to fetch polygon using lookup API
    if (item.osm_type && item.osm_id) {
      const osmPrefix = item.osm_type === 'relation' ? 'R' : item.osm_type === 'way' ? 'W' : 'N';
      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmPrefix}${item.osm_id}&format=json&polygon_geojson=1`;
      
      await new Promise(r => setTimeout(r, 500));
      
      const lookupRes = await fetch(lookupUrl);
      
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        if (lookupData[0] && lookupData[0].geojson) {
          console.log(`      ✓ Got polygon: ${label}`);
          const feature = ensureFeature(lookupData[0].geojson) || lookupData[0].geojson;
          return { label, feature };
        }
      }
    }
    
    // Fallback: Try Census ZIP polygon (real boundary)
    if (isZip) {
      const census = await fetchCensusZipPolygon(entry);
      if (census?.feature) {
        console.log(`      ✓ Census polygon: ${label}`);
        return { label, feature: census.feature };
      }
    }

    // Final fallback: Create simple square around the point
    const square = createSquareFeature(item.lon, item.lat, 5);
    if (square) {
      console.log(`      ✓ Fallback geometry: ${label}`);
      return { label, feature: square };
    }
    return null;
    
  } catch (err) {
    console.log(`      [ERROR] ${err.message}`);
    return null;
  }
}

// Helper: Normalize service area input
function normalizeServiceAreaInput(str) {
  if (!str) return [];
  const lines = str.split('\n').map(s => s.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const tokens = line.split(',').map(t => t.trim()).filter(Boolean);
    const zips = tokens.filter(t => /^\d{5}$/.test(t));
    const nonZipTokens = tokens.filter(t => !/^\d{5}$/.test(t));
    if (zips.length > 0) entries.push(...zips);
    if (nonZipTokens.length > 0) entries.push(nonZipTokens.join(', '));
    if (tokens.length === 0) entries.push(line);
  }
  return [...new Set(entries)];
}

// Helper: Parse CSV
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (cell || row.length > 0) {
        row.push(cell.trim());
        if (row.some(c => c)) rows.push(row);
        row = [];
        cell = '';
      }
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c)) rows.push(row);
  }
  return rows;
}

// Main export
async function exportServiceAreas() {
  console.log('[EXPORT] Starting service areas export from CSV...\n');
  
  try {
    // Fetch CSV
    console.log('[CSV] Fetching from Google Sheets...');
    const csvRes = await fetch(CSV_URL);
    
    if (!csvRes.ok) {
      console.error(`[ERROR] CSV fetch failed: HTTP ${csvRes.status}`);
      console.error('Make sure your Google Sheet is published to the web!');
      console.error('File → Share → "Publish to web" → Copy the CSV URL');
      return;
    }
    
    const csvText = await csvRes.text();
    const rows = parseCSV(csvText);
    
    if (rows.length < 2) {
      console.error('[ERROR] CSV has no data');
      return;
    }
    
    console.log(`[CSV] Got ${rows.length} rows\n`);
    
    // Process clients
    const clients = [];
    const header = rows[0];
    
    // Find column indices
    const nameIdx = header.findIndex(h => /name|client/i.test(h));
    const industryIdx = header.findIndex(h => /industry/i.test(h));
    const locationIdx = header.findIndex(h => /location/i.test(h));
    const serviceAreaIdx = header.findIndex(h => /service.area|area/i.test(h));
    const latIdx = header.findIndex(h => /lat/i.test(h));
    const lngIdx = header.findIndex(h => /lng|lon/i.test(h));
    
    console.log(`[COLUMNS] name=${nameIdx}, industry=${industryIdx}, location=${locationIdx}, serviceArea=${serviceAreaIdx}\n`);
    
    // Process each row
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells[nameIdx]) continue;
      
      const name = cells[nameIdx].replace(/^"|"$/g, '').trim();
      const industry = (cells[industryIdx] || "Unknown").replace(/^"|"$/g, '').trim();
      const location = (cells[locationIdx] || "Unknown").replace(/^"|"$/g, '').trim();
      const serviceArea = (cells[serviceAreaIdx] || "").replace(/^"|"$/g, '').trim();
      const lat = cells[latIdx] ? parseFloat(cells[latIdx]) : null;
      const lng = cells[lngIdx] ? parseFloat(cells[lngIdx]) : null;
      
      console.log(`[CLIENT] ${name}`);
      console.log(`  Industry: ${industry}`);
      console.log(`  Location: ${location}`);
      
      const entries = normalizeServiceAreaInput(serviceArea);
      console.log(`  Service Areas: ${entries.length > 0 ? entries.join(', ') : 'none'}`);
      
      // Fetch polygons
      const polygons = [];
      for (const entry of entries) {
        const poly = await fetchNominatimPolygon(entry);
        if (poly) {
          polygons.push({
            entry,
            label: poly.label,
            feature: poly.feature
          });
        }
      }
      
      clients.push({
        name,
        industry,
        location,
        lat: lat || 39.5,
        lng: lng || -98.35,
        serviceArea,
        polygons
      });
      
      console.log(`  Polygons: ${polygons.length}/${entries.length}\n`);
    }
    
    // Write output
    const output = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      clientCount: clients.length,
      clients,
      metadata: {
        note: 'Precomputed service areas',
        updateInstructions: 'Run export script when you add/update clients'
      }
    };
    
    const outputPath = path.join(__dirname, 'data', 'service-areas.json');
    const outputDir = path.dirname(outputPath);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    const rootOutputPath = path.join(__dirname, 'service-areas.json');
    fs.writeFileSync(rootOutputPath, JSON.stringify(output, null, 2));
    
    console.log(`\n[SUCCESS] Exported ${clients.length} clients to data/service-areas.json and service-areas.json`);
    console.log('[NEXT] Deploy to GitHub:');
    console.log('  git add data/service-areas.json');
    console.log('  git commit -m "Update precomputed service areas"');
    console.log('  git push origin main');
    console.log('\nVercel will auto-deploy! Dashboard will show instant polygons! 🚀');
    
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
}

// Run
exportServiceAreas();
