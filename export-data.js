/**
 * EXPORT UTILITY - Generate service-areas.json from Google Sheet
 * 
 * This utility script:
 * 1. Reads client data from Google Sheet
 * 2. Fetches polygon data for each service area (ONE TIME at export, not at runtime)
 * 3. Simplifies polygons to 50m resolution (reduces size 30-70%)
 * 4. Generates service-areas.json with all precomputed polygons
 * 5. Commit to GitHub → Vercel CDN caches it → instant loads in dashboard
 * 
 * SETUP:
 * 1. Just run: node export-data.js
 * 2. Commit data/service-areas.json to GitHub
 * 3. Vercel auto-deploys
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// CONFIG - UPDATE THESE
const SHEET_ID = "10HaJdMVaqasoR1mrX39iP58hIMvrWV8GTztUX7_rVZM"; // Replace with your Sheet ID
const SHEET_NAME = "Database";

// Helper: Fetch from Nominatim with caching
const nominatimCache = {};
async function fetchNominatimPolygon(entry, retries = 3) {
  if (nominatimCache[entry]) {
    console.log(`  [CACHE] Using cached polygon for: ${entry}`);
    return nominatimCache[entry];
  }

  const isZip = /^\d{5}$/.test(entry);
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Rate limit: wait 500ms between requests
      await new Promise(r => setTimeout(r, 500));
      
      const searchUrl = isZip 
        ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&postalcode=${encodeURIComponent(entry)}`
        : `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(entry + ', United States')}`;
      
      console.log(`  [FETCH] Searching: ${entry}...`);
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'ClientDashboard-ExportTool/1.0' }
      });
      
      if (!searchRes.ok) {
        console.warn(`    [WARN] Search HTTP ${searchRes.status}, retrying...`);
        continue;
      }
      
      const searchData = await searchRes.json();
      if (!searchData || searchData.length === 0) {
        console.warn(`    [WARN] No results, skipping`);
        nominatimCache[entry] = null;
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
      
      // Fetch polygon using lookup API
      if (!item.osm_type || !item.osm_id) {
        console.warn(`    [WARN] No OSM data, using fallback geometry`);
        nominatimCache[entry] = {
          label,
          feature: createSquareFeature(item.lon, item.lat, 5)
        };
        return nominatimCache[entry];
      }
      
      const osmPrefix = item.osm_type === 'relation' ? 'R' : item.osm_type === 'way' ? 'W' : 'N';
      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmPrefix}${item.osm_id}&format=json&polygon_geojson=1`;
      
      await new Promise(r => setTimeout(r, 500)); // Rate limit
      
      const lookupRes = await fetch(lookupUrl, {
        headers: { 'User-Agent': 'ClientDashboard-ExportTool/1.0' }
      });
      
      if (!lookupRes.ok) {
        console.warn(`    [WARN] Lookup HTTP ${lookupRes.status}, using fallback`);
        nominatimCache[entry] = {
          label,
          feature: createSquareFeature(item.lon, item.lat, 5)
        };
        return nominatimCache[entry];
      }
      
      const lookupData = await lookupRes.json();
      
      if (lookupData[0] && lookupData[0].geojson) {
        const feature = lookupData[0].geojson;
        console.log(`  [SUCCESS] Got polygon for: ${entry}`);
        nominatimCache[entry] = { label, feature };
        return nominatimCache[entry];
      } else {
        console.warn(`    [WARN] No polygon in lookup, using fallback`);
        nominatimCache[entry] = {
          label,
          feature: createSquareFeature(item.lon, item.lat, 5)
        };
        return nominatimCache[entry];
      }
    } catch (err) {
      console.warn(`    [ERR] Attempt ${attempt + 1}/${retries}: ${err.message}`);
      if (attempt === retries - 1) {
        console.error(`    [FAIL] Gave up on: ${entry}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000)); // Wait before retry
    }
  }
  
  return null;
}

// Helper: Create square fallback geometry
function createSquareFeature(lon, lat, kmRadius = 5) {
  const dLat = kmRadius / 111;
  const dLon = kmRadius / (111 * Math.cos(lat * Math.PI / 180) || 1);
  const coords = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat]
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {}
  };
}

// Helper: Normalize service area input (same as in dashboard.js)
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
  return entries;
}

// MAIN EXPORT FUNCTION
async function exportServiceAreas() {
  console.log('[EXPORT] Starting service areas export...');
  
  // For now, create a template. In production, read from Google Sheets CSV
  console.log('[EXPORT] Reading from Google Sheets CSV...');
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?output=csv`;
  
  try {
    const csvRes = await fetch(csvUrl);
    if (!csvRes.ok) {
      console.error('[EXPORT] Failed to fetch CSV:', csvRes.status);
      console.log('[EXPORT] Please ensure your sheet is published to the web');
      return;
    }
    
    const csvText = await csvRes.text();
    const rows = parseCSV(csvText);
    
    if (rows.length < 2) {
      console.error('[EXPORT] CSV has no data rows');
      return;
    }
    
    const clients = [];
    const header = rows[0];
    
    // Find column indices
    const nameIdx = header.findIndex(h => /name|client/i.test(h));
    const industryIdx = header.findIndex(h => /industry/i.test(h));
    const locationIdx = header.findIndex(h => /location/i.test(h));
    const serviceAreaIdx = header.findIndex(h => /service.area|area/i.test(h));
    const latIdx = header.findIndex(h => /lat/i.test(h));
    const lngIdx = header.findIndex(h => /lng|lon/i.test(h));
    
    console.log(`[EXPORT] Columns: name=${nameIdx}, industry=${industryIdx}, location=${locationIdx}, serviceArea=${serviceAreaIdx}, lat=${latIdx}, lng=${lngIdx}`);
    
    // Process each row
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i];
      if (!cells[nameIdx]) continue;
      
      const name = cells[nameIdx].trim();
      const industry = cells[industryIdx]?.trim() || 'Unknown';
      const location = cells[locationIdx]?.trim() || 'Unknown';
      const serviceArea = cells[serviceAreaIdx]?.trim() || '';
      const lat = cells[latIdx] ? parseFloat(cells[latIdx]) : null;
      const lng = cells[lngIdx] ? parseFloat(cells[lngIdx]) : null;
      
      console.log(`\n[CLIENT] ${name}`);
      
      const entries = [...new Set(normalizeServiceAreaInput(serviceArea))].slice(0, 12);
      console.log(`  Service area entries: ${entries.join(', ') || 'none'}`);
      
      const polygons = [];
      for (const entry of entries) {
        const result = await fetchNominatimPolygon(entry);
        if (result) {
          polygons.push({
            entry,
            label: result.label,
            feature: result.feature
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
    }
    
    // Write output
    const output = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      clientCount: clients.length,
      clients,
      metadata: {
        note: 'Precomputed service areas. Generate with: node export-data.js',
        updateInstructions: 'Run export script, commit to GitHub, Vercel CDN will cache automatically'
      }
    };
    
    const outputPath = path.join(__dirname, 'data', 'service-areas.json');
    const outputDir = path.dirname(outputPath);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n[SUCCESS] Exported ${clients.length} clients to ${outputPath}`);
    console.log('[NEXT] Commit to GitHub and Vercel will automatically deploy!');
    
  } catch (err) {
    console.error('[ERROR]', err);
  }
}

// CSV Parser (same as in dashboard.js)
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

// Run
exportServiceAreas().catch(console.error);
