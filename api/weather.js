module.exports = async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'API key not configured'
      });
    }

    const { lat, lng, type } = req.query;
    
    // Handle weather tile layer requests (for map overlays)
    if (type === 'tile') {
      const { layer, z, x, y } = req.query;
      
      if (!layer || !z || !x || !y) {
        return res.status(400).json({ error: 'Missing tile parameters: layer, z, x, y' });
      }

      const tileUrl = `https://tile.openweathermap.org/${layer}_new/${z}/${x}/${y}.png?appid=${apiKey}`;
      
      try {
        const tileResponse = await fetch(tileUrl);
        
        if (!tileResponse.ok) {
          return res.status(tileResponse.status).json({ error: `Tile fetch failed: ${tileResponse.statusText}` });
        }

        // Set proper headers for image response
        res.setHeader('Content-Type', tileResponse.headers.get('content-type') || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        const buffer = await tileResponse.arrayBuffer();
        return res.status(200).send(Buffer.from(buffer));
      } catch (tileError) {
        console.error("Tile fetch error:", tileError);
        return res.status(500).json({ error: 'Failed to fetch tile', details: tileError.message });
      }
    }
    
    // Handle weather data requests (original functionality)
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng parameter' });
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    );
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Weather API error: ${response.statusText}` });
    }
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ error: 'Failed to fetch weather', details: error.message });
  }
};
