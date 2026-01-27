module.exports = async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      console.error("OPENWEATHER_API_KEY not configured");
      return res.status(500).json({ 
        error: 'API key not configured'
      });
    }

    const { lat, lng, type, layer, z, x, y } = req.query;
    
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    // Handle tile requests
    if (type === 'tile') {
      if (!layer || !z || !x || !y) {
        return res.status(400).json({ error: 'Missing tile parameters: layer, z, x, y' });
      }

      console.log(`[WEATHER-TILE] Fetching ${layer} tile: z=${z}, x=${x}, y=${y}`);
      
      // Map layer names to OpenWeatherMap layer names
      const layerMap = {
        'precipitation': 'precipitation_new',
        'clouds': 'clouds_new',
        'radar': 'precipitation_new',
        'wind': 'wind_new',
        'temp': 'temp_new',
        'snow': 'snow_new'
      };
      const layerName = layerMap[layer] || (layer.includes('_new') ? layer : `${layer}_new`);
      
      // Custom color palettes for better visibility
      const palettes = {
        'snow_new': '0:00000000;0.1:E3F2FD;0.5:90CAF9;1:42A5F5;2:1E88E5;5:1565C0;10:0D47A1;50:001F3F',
        'clouds_new': '0:00000000;10:E0E0E0;30:BDBDBD;50:9E9E9E;70:757575;90:616161;100:424242'
      };
      
      let tileUrl = `https://tile.openweathermap.org/map/${layerName}/${z}/${x}/${y}.png?appid=${apiKey}`;
      
      // Add custom palette if available
      if (palettes[layerName]) {
        tileUrl += `&palette=${encodeURIComponent(palettes[layerName])}`;
      }
      
      console.log(`[WEATHER-TILE] Using layer: ${layerName}. URL: ${tileUrl}`);
      
      try {
        const tileResponse = await fetch(tileUrl);
        
        if (!tileResponse.ok) {
          console.error(`[WEATHER-TILE] HTTP Error ${tileResponse.status}: ${tileResponse.statusText}`);
          console.error(`[WEATHER-TILE] Response headers:`, Object.fromEntries(tileResponse.headers));
          
          // Log response body to understand the error
          const text = await tileResponse.text();
          console.error(`[WEATHER-TILE] Response body:`, text);
          
          // Return a transparent 1x1 PNG on error
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
