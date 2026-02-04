/**
 * EXPORT UTILITY - Generate service-areas.json from Your Database
 * 
 * This script:
 * 1. Fetches all clients from your Apps Script
 * 2. Gets polygon data for each ZIP code
 * 3. Saves to data/service-areas.json
 * 4. You commit to GitHub → Vercel deploys → Instant polygons!
 * 
 * Run: node simple-export.js
 */

const fs = require('fs');
const path = require('path');

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxrSX96FuF-B7MFG1d458bdgnnVkyh1TWFuQDFnYur5vywe4OqzOoOZJ_DyuegddOic/exec";

// Helper: Fetch from Apps Script
async function fetchFromAppsScript(action, params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, v);
  });

  try {
    const response = await fetch(url.toString());
    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`[ERROR] Fetch failed for action=${action}:`, err.message);
    return null;
  }
}

// Helper: Normalize service area input (same as dashboard.js)
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
  return [...new Set(entries)]; // Remove duplicates
}

// Main export function
async function exportServiceAreas() {
  console.log('[EXPORT] Starting service areas export...\n');
  
  try {
    // Step 1: Get all clients from Apps Script
    console.log('[CLIENTS] Fetching clients from Apps Script...');
    const clientsResponse = await fetchFromAppsScript('getDatabase');
    
    if (!clientsResponse || !clientsResponse.success || !clientsResponse.data) {
      console.error('[ERROR] Failed to fetch clients. Make sure Apps Script is deployed.');
      return;
    }

    const rawData = clientsResponse.data;
    console.log(`[CLIENTS] Found ${rawData.length} clients\n`);

    // Step 2: Process each client
    const clients = [];
    for (let i = 0; i < rawData.length; i++) {
      const cells = rawData[i];
      if (!cells[0]) continue; // Skip empty rows

      const name = cells[0].toString().trim();
      const industry = (cells[1] || "Unknown").toString().trim();
      const location = (cells[2] || "Unknown").toString().trim();
      const serviceArea = (cells[3] || "").toString().trim();
      const lat = cells[4] ? parseFloat(cells[4]) : null;
      const lng = cells[5] ? parseFloat(cells[5]) : null;

      console.log(`[CLIENT ${i + 1}] ${name}`);
      console.log(`  Industry: ${industry}`);
      console.log(`  Location: ${location}`);
      console.log(`  Service Area: ${serviceArea || 'none'}`);

      const entries = normalizeServiceAreaInput(serviceArea);
      console.log(`  ZIPs/Areas: ${entries.length > 0 ? entries.join(', ') : 'none'}`);

      // Step 3: Fetch polygon for each ZIP/area
      const polygons = [];
      for (const entry of entries) {
        console.log(`    [POLYGON] Fetching: ${entry}...`);
        const polyResponse = await fetchFromAppsScript('getPolygon', { entry });

        if (polyResponse && polyResponse.feature && polyResponse.label) {
          polygons.push({
            entry,
            label: polyResponse.label,
            feature: polyResponse.feature
          });
          console.log(`      ✓ Success: ${polyResponse.label}`);
        } else if (polyResponse && polyResponse.error) {
          console.log(`      ✗ Error: ${polyResponse.error}`);
        } else {
          console.log(`      ✗ No data returned`);
        }

        // Rate limit: wait 500ms between requests
        await new Promise(r => setTimeout(r, 500));
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

    // Step 4: Write output file
    const output = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      clientCount: clients.length,
      clients,
      metadata: {
        note: 'Precomputed service areas for instant dashboard rendering',
        generated: 'node simple-export.js',
        updateInstructions: 'Run export script weekly as you add/update clients'
      }
    };

    const outputPath = path.join(__dirname, 'data', 'service-areas.json');
    const outputDir = path.dirname(outputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n[SUCCESS] Exported ${clients.length} clients to ${outputPath}`);
    console.log('[NEXT] Run:');
    console.log('  git add data/service-areas.json');
    console.log('  git commit -m "Update precomputed service areas"');
    console.log('  git push origin main');
    console.log('\nVercel will auto-deploy in ~30 seconds!');

  } catch (err) {
    console.error('[ERROR]', err);
  }
}

// Run
exportServiceAreas().catch(console.error);
