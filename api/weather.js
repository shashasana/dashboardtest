// Track API calls per session (resets on serverless cold start/redeploy)
// Note: Vercel serverless functions are stateless, so this counter resets frequently
let apiCallCount = 0;
let sessionStart = new Date().toLocaleString();

// Log to Google Sheet Apps Script
async function logToGoogleSheet(sessionCount) {
  try {
    const appsScriptUrl = process.env.APPS_SCRIPT_URL;
    if (!appsScriptUrl) {
      console.log('[GOOGLE-SHEET] APPS_SCRIPT_URL not configured, skipping log');
      return;
    }

    // First, fetch the current total from Google Sheet
    let currentTotal = 0;
    try {
      const getTotalResponse = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getTotalApiCalls' })
      });

      if (getTotalResponse.ok) {
        const totalData = await getTotalResponse.json();
        currentTotal = totalData.data?.total || 0;
        console.log(`[GOOGLE-SHEET] Current total from sheet: ${currentTotal}`);
      }
    } catch (error) {
      console.error('[GOOGLE-SHEET] Error fetching total:', error.message);
      currentTotal = 0;
    }

    // Calculate new total: previous total + current session count
    let newTotal = currentTotal + sessionCount;
    
    // Cap at 1000
    if (newTotal > 1000) {
      newTotal = 1000;
      console.log('[GOOGLE-SHEET] Capped at 1000 API calls');
    }

    // Send the new total to Google Sheet
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'logApiCall',
        apiCalls: newTotal,
        sessionStart: sessionStart
      })
    });

    if (!response.ok) {
      console.error(`[GOOGLE-SHEET] Failed to log: ${response.status}`);
    } else {
      console.log(`[GOOGLE-SHEET] Logged accumulated total: ${newTotal} (session: ${sessionCount})`);
    }
  } catch (error) {
    console.error('[GOOGLE-SHEET] Error logging:', error.message);
  }
}

module.exports = async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      console.error("OPENWEATHER_API_KEY not configured");
      return res.status(500).json({ 
        error: 'API key not configured'
      });
    }
    
    // Handle stats request
    if (req.query.type === 'stats') {
      return res.status(200).json({ 
        apiCalls: apiCallCount,
        sessionStart: sessionStart
      });
    }

    const { lat, lng, type, layer, z, x, y } = req.query;
    
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    // Handle tile requests
    if (type === 'tile') {
      apiCallCount++; // Increment counter for this session
      
      if (!layer || !z || !x || !y) {
        return res.status(400).json({ error: 'Missing tile parameters: layer, z, x, y' });
      }

      // Get current total from Google Sheet and increment it
      if (apiCallCount % 5 === 0) {
        // Log to Google Sheet every 5 tiles to avoid rate limiting
        logToGoogleSheet(apiCallCount);
      }

      console.log(`[WEATHER-TILE] Fetching ${layer} tile: z=${z}, x=${x}, y=${y} (session count: ${apiCallCount})`);
      
      // Use the classic tile API with colored layer names
      const layerMap = {
        'precipitation': 'precipitation_new',
        'clouds': 'clouds_new', 
        'radar': 'precipitation_new',
        'wind': 'wind_new',
        'temp': 'temp_new',
        'snow': 'snow_new'
      };
      const layerName = layerMap[layer] || layer;
      
      let tileUrl = `https://tile.openweathermap.org/map/${layerName}/${z}/${x}/${y}.png?appid=${apiKey}`;
      
      console.log(`[WEATHER-TILE] Using classic API: ${layerName}. URL: ${tileUrl.substring(0, 150)}...`);
      
      console.log(`[WEATHER-TILE] Using layer: ${layerName}. URL: ${tileUrl}`);
      
      try {
        const tileResponse = await fetch(tileUrl);
        
        if (!tileResponse.ok) {
          console.error(`[WEATHER-TILE] HTTP Error ${tileResponse.status}: ${tileResponse.statusText}`);
          
          // Log response body to understand the error
          const text = await tileResponse.text();
          console.error(`[WEATHER-TILE] Response body:`, text);
          
          // Send error response instead of silent transparent PNG for debugging
          return res.status(500).json({ 
            error: `Tile API failed: ${tileResponse.status}`,
            details: text 
          });
        }

        // Set proper headers for image response
        const contentType = tileResponse.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        const buffer = await tileResponse.arrayBuffer();
        console.log(`[WEATHER-TILE] Sent tile: ${buffer.byteLength} bytes`);
        return res.status(200).send(Buffer.from(buffer));
      } catch (tileError) {
        console.error("[WEATHER-TILE] Fetch error:", tileError.message);
        // Return transparent PNG on error
        const transparentPng = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
        ]);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(transparentPng);
      }
    }
    
    // Handle weather data requests (original functionality)
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng parameter' });
    }

    console.log(`[WEATHER-DATA] Fetching weather for lat=${lat}, lng=${lng}`);
    
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    );
    
    if (!response.ok) {
      console.error(`[WEATHER-DATA] API error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ error: `Weather API error: ${response.statusText}` });
    }
    
    const data = await response.json();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json(data);
  } catch (error) {
    console.error("[WEATHER] Handler error:", error);
    return res.status(500).json({ error: 'Failed to fetch weather', details: error.message });
  }
};
