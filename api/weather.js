module.exports = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    console.log("Available env vars:", Object.keys(process.env));
    console.log("OPENWEATHER_API_KEY:", process.env.OPENWEATHER_API_KEY ? "EXISTS" : "MISSING");
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng parameter' });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'API key not configured',
        envVars: Object.keys(process.env)
      });
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
