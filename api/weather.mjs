export default async function handler(req, res) {
  try {
    const { lat, lng } = req.query;
    
    const allEnvKeys = Object.keys(process.env);
    console.log("All ENV vars:", allEnvKeys);
    console.log("OPENWEATHER_API_KEY value:", process.env.OPENWEATHER_API_KEY ? "SET" : "NOT SET");
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng parameter' });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'API key not configured',
        availableEnvVars: allEnvKeys
      });
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
    );
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ error: 'Failed to fetch weather', details: error.message });
  }
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

if (!apiKey) {
  return res.status(500).json({ error: 'API key not configured', env: Object.keys(process.env) });
}
