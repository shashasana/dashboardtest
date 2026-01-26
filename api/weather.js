export default async function handler(req, res) {
  const { lat, lng } = req.query;
  
  console.log("ENV vars available:", Object.keys(process.env).filter(k => k.includes('OPEN') || k.includes('WEATHER')));
  console.log("OPENWEATHER_API_KEY value:", process.env.OPENWEATHER_API_KEY ? "SET" : "NOT SET");
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Missing lat or lng parameter' });
  }

  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    );
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
}
