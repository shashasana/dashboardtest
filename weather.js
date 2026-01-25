export default async function handler(req, res) {
  const { lat, lng } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng parameter' });
  }

  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      console.error("OPENWEATHER_API_KEY not configured");
      return res.status(500).json({ error: 'API key not configured' });
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`;
    console.log("Fetching weather from:", url.replace(apiKey, "***"));
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error("Weather API error:", response.status, response.statusText);
      return res.status(response.status).json({ error: `Weather API error: ${response.statusText}` });
    }
    
    const data = await response.json();
    console.log("Weather data received:", data);
    res.status(200).json(data);
  } catch (error) {
    console.error("Weather fetch error:", error);
    res.status(500).json({ error: 'Failed to fetch weather', details: error.message });
  }
}