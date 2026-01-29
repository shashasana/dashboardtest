/**
 * SLACK SLASH COMMAND: /weather <client name>
 *
 * Sheet: Database
 * Columns:
 * A - Client
 * B - Industry
 * C - Location
 * D - Service Area
 * E - Latitude
 * F - Longitude
 * G - Poster
 * H - Slack User ID
 * 
 * SETUP INSTRUCTIONS:
 * 1. Set Script Properties:
 *    - OPENWEATHER_API_KEY (from openweathermap.org)
 *    - SLACK_WEBHOOK_URL (from Slack Incoming Webhooks)
 * 2. Deploy as Web App (for Slack slash command)
 * 3. Set up Slack slash command pointing to your deployment URL
 * 4. Create time-based trigger for sendDailyWeatherReportForAllClients()
 */

/* =========================
   SLACK ENTRY POINT FOR INDIVIDUAL CLIENT
   ========================= */
function doPost(e) {
  // Prevent errors when run manually
  if (!e || !e.parameter) {
    return respond("⚠️ This endpoint is for Slack slash commands only.");
  }

  const text = (e.parameter.text || "").trim();

  if (!text) {
    // Show all available clients
    const clients = getAllClients();
    if (!clients.length) {
      return respond("⚠️ No clients in database");
    }
    const clientList = clients.map(c => `• ${c.name}`).join('\n');
    return respond(`📋 *Available Clients:*\n${clientList}\n\n_Usage: \`/weather <client name>\`_`);
  }

  // Command option: /weather all (send full report to channel)
  if (/^(all|daily|report)$/i.test(text)) {
    // Respond to Slack immediately to avoid timeout
    const response = respond("✅ Fetching weather for all clients and sending to channel...");
    
    // Process in background (Slack already got response)
    try {
      sendDailyWeatherReportForAllClients();
    } catch (err) {
      Logger.log("Daily report error: " + err.toString());
    }
    
    return response;
  }

  // Command option: /weather {Poster Name} (send weather for specific poster)
  const posterResult = findPosterByName(text);
  if (posterResult.posterName) {
    const response = respond("✅ Fetching weather for " + posterResult.posterName + " clients...");
    try {
      sendWeatherByPoster(posterResult.posterName);
    } catch (err) {
      Logger.log("Poster weather error: " + err.toString());
    }
    return response;
  }

  // Try to find client by name (including NA poster clients)
  const result = findClientByName(text);

  // If no matches found
  if (!result.match && result.suggestions.length === 0) {
    const clients = getAllClients();
    const clientList = clients.slice(0, 10).map(c => `• ${c.name}`).join('\n');
    const more = clients.length > 10 ? `\n_...and ${clients.length - 10} more_` : '';
    return respond(`❌ Client *${text}* not found\n\n📋 *Available Clients:*\n${clientList}${more}`);
  }

  // If multiple suggestions found, use the first one
  if (!result.match && result.suggestions.length > 0) {
    if (result.suggestions.length === 1) {
      result.match = result.suggestions[0];
    } else {
      // Multiple matches - show list with exact names to copy
      const suggestionList = result.suggestions.map(c => `• \`${c.name}\``).join('\n');
      return respond(`🔍 Multiple matches for *${text}*:\n${suggestionList}\n\n_Copy exact name and try: \`/weather [exact name]\`_`);
    }
  }

  // Match found
  const client = result.match;

  try {
    const w = getWeather(client.lat, client.lng);
    const summary = summarizeWeather(w);

    const msg =
      `🌤️ *${client.name}*\n` +
      `Temp: ${Math.round(w.min)}–${Math.round(w.max)}°C\n` +
      `${summary}`;

    return respond(msg);

  } catch (err) {
    Logger.log("Weather error: " + err.toString());
    return respond(`⚠️ Weather service timeout for *${client.name}*. The weather service is slow - try again in a moment.`);
  }
}

/* =========================
   DAILY WEATHER REPORT FOR ALL CLIENTS - GROUPED BY POSTER
   ========================= */
function sendDailyWeatherReportForAllClients() {
  const clients = getAllClients();
  Logger.log(`Total clients fetched: ${clients.length}`);
  
  if (!clients.length) {
    Logger.log("No clients found in database");
    return;
  }

  // Filter out clients with NA poster
  const activeClients = clients.filter(c => {
    const posterUpper = (c.poster || "").toUpperCase();
    return posterUpper !== "NA" && posterUpper !== "";
  });

  Logger.log(`Active clients (excluding NA): ${activeClients.length}`);

  // Group clients by poster
  const clientsByPoster = {};
  activeClients.forEach(client => {
    const poster = client.poster || "Unassigned";
    if (!clientsByPoster[poster]) {
      clientsByPoster[poster] = {
        slackUserId: client.slackUserId || null,
        clients: []
      };
    }
    clientsByPoster[poster].clients.push(client);
  });

  let message = "🌤️ *Today's Weather Report for All Clients*\n\n";

  // Process each poster group
  Object.keys(clientsByPoster).sort().forEach(posterName => {
    const group = clientsByPoster[posterName];
    
    // Add poster mention
    if (group.slackUserId) {
      message += `<@${group.slackUserId}>\n`;
    } else {
      message += `*${posterName}*\n`;
    }

    // Add weather for each client in this poster's group
    group.clients.forEach(client => {
      Logger.log(`Processing client: ${client.name} (${client.lat}, ${client.lng})`);
      try {
        const w = getWeather(client.lat, client.lng);
        Logger.log(`Weather received for ${client.name}: ${JSON.stringify(w)}`);
        const summary = summarizeWeather(w);

        message += `*${client.name}*\n`;
        message += `Temp: ${Math.round(w.min)}–${Math.round(w.max)}°C\n`;
        message += `${summary}\n\n`;

      } catch (err) {
        Logger.log(`Weather error for ${client.name}: ${err.toString()}`);
        message += `*${client.name}*\n⚠️ Weather unavailable\n\n`;
      }
    });
  });

  Logger.log(`Final message length: ${message.length}`);
  Logger.log(`Message content: ${message}`);
  
  // Only send if we have actual content beyond the header
  if (activeClients.length > 0) {
    sendToSlackChannel(message);
  } else {
    Logger.log("No active clients to report on");
  }
}

/* =========================
   FETCH ALL CLIENTS FROM SHEET
   ========================= */
function getAllClients() {
  const sheetId = "10HaJdMVaqasoR1mrX39iP58hIMvrWV8GTztUX7_rVZM";

  const sheet = SpreadsheetApp.openById(sheetId)
    .getSheetByName("Database");

  if (!sheet) {
    Logger.log("Database sheet not found");
    return [];
  }

  const rows = sheet.getDataRange().getValues();
  rows.shift(); // remove header

  return rows
    .filter(r => {
      // Ensure name is a valid string and lat/lng are valid numbers
      return r[0] && 
             typeof r[0] === 'string' && 
             r[0].trim() !== '' &&
             r[4] && 
             r[5] && 
             !isNaN(parseFloat(r[4])) && 
             !isNaN(parseFloat(r[5]));
    })
    .map(r => ({
      name: String(r[0]).trim(),      // Column A - ensure string
      lat: parseFloat(r[4]),          // Column E
      lng: parseFloat(r[5]),          // Column F
      poster: r[6] ? String(r[6]).trim() : "", // Column G - Poster
      slackUserId: r[7] ? String(r[7]).trim() : "" // Column H - Slack User ID
    }));
}

/* =========================
   FIND POSTER BY NAME (WITH FUZZY MATCHING)
   Returns: { posterName: poster name or null }
   ========================= */
function findPosterByName(name) {
  const clients = getAllClients();
  
  if (!name || typeof name !== 'string') {
    return { posterName: null };
  }
  
  const query = name.toLowerCase().trim();
  
  // Collect unique posters
  const uniquePosters = [...new Set(clients.map(c => c.poster).filter(p => p))];
  
  // Exact match
  for (const poster of uniquePosters) {
    if (poster.toLowerCase() === query) {
      return { posterName: poster };
    }
  }
  
  // Starts with match
  for (const poster of uniquePosters) {
    if (poster.toLowerCase().startsWith(query)) {
      return { posterName: poster };
    }
  }
  
  // Contains match
  for (const poster of uniquePosters) {
    if (poster.toLowerCase().includes(query)) {
      return { posterName: poster };
    }
  }
  
  // No matches
  return { posterName: null };
}

/* =========================
   FIND CLIENT BY NAME (WITH FUZZY MATCHING)
   Returns: { match: client or null, suggestions: array of similar clients }
   ========================= */
function findClientByName(name) {
  const clients = getAllClients();
  
  if (!name || typeof name !== 'string') {
    return { match: null, suggestions: [] };
  }
  
  const query = name.toLowerCase().trim();
  
  let exactMatches = [];
  let startsWithMatches = [];
  let containsMatches = [];
  let wordMatches = [];

  // Single pass through all clients - more efficient
  for (const client of clients) {
    if (!client.name) continue;
    
    const clientNameLower = client.name.toLowerCase();
    
    // Exact match
    if (clientNameLower === query) {
      return { match: client, suggestions: [] };
    }
    
    // Starts with match
    if (clientNameLower.startsWith(query)) {
      startsWithMatches.push(client);
      continue; // Skip other checks if already matched
    }
    
    // Contains match
    if (clientNameLower.includes(query)) {
      containsMatches.push(client);
      continue;
    }
    
    // Word boundary match (matches start of any word)
    const words = clientNameLower.split(/\s+/);
    if (words.some(word => word.startsWith(query))) {
      wordMatches.push(client);
    }
  }

  // Return results in priority order
  if (startsWithMatches.length === 1) {
    return { match: startsWithMatches[0], suggestions: [] };
  }
  if (startsWithMatches.length > 1) {
    return { match: null, suggestions: startsWithMatches };
  }
  
  if (containsMatches.length === 1) {
    return { match: containsMatches[0], suggestions: [] };
  }
  if (containsMatches.length > 1) {
    return { match: null, suggestions: containsMatches };
  }
  
  if (wordMatches.length === 1) {
    return { match: wordMatches[0], suggestions: [] };
  }
  if (wordMatches.length > 1) {
    return { match: null, suggestions: wordMatches };
  }

  // No matches found
  return { match: null, suggestions: [] };
}

/* =========================
   FETCH WEATHER (FREE 5 DAY FORECAST API)
   Uses the FREE OpenWeather Forecast API - 1000 calls/day included
   ========================= */
function getWeather(lat, lng) {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty("OPENWEATHER_API_KEY");

  if (!apiKey) {
    throw new Error("Missing OPENWEATHER_API_KEY in Script Properties");
  }

  // 5 Day Forecast - returns 3-hour intervals (100% FREE)
  const url =
    `https://api.openweathermap.org/data/2.5/forecast` +
    `?lat=${lat}&lon=${lng}&units=metric&appid=${apiKey}`;

  try {
    const res = UrlFetchApp.fetch(url, { 
      muteHttpExceptions: true,
      timeout: 2  // 2 second timeout to avoid Slack timeout
    });
    const code = res.getResponseCode();
    
    if (code === 401) {
      throw new Error("Invalid API key");
    }
    
    if (code !== 200) {
      throw new Error(`Weather API returned status ${code}`);
    }
    
    const data = JSON.parse(res.getContentText());

    if (!data.list || data.list.length === 0) {
      throw new Error("Invalid forecast response");
    }

    // Get today's date
    const today = new Date();
    const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // Filter forecasts for today only
    const todayForecasts = data.list.filter(item => {
      const forecastDate = item.dt_txt.split(' ')[0];
      return forecastDate === todayStr;
    });

    // If no forecasts for today, use next available forecasts
    const forecasts = todayForecasts.length > 0 ? todayForecasts : data.list.slice(0, 8);

    // Calculate min/max from forecast intervals
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    let mainCondition = forecasts[0].weather[0].main;
    let description = forecasts[0].weather[0].description;

    forecasts.forEach(item => {
      if (item.main.temp_min < minTemp) minTemp = item.main.temp_min;
      if (item.main.temp_max > maxTemp) maxTemp = item.main.temp_max;
      
      // Use the most severe weather condition
      const conditions = ['Thunderstorm', 'Snow', 'Rain', 'Drizzle', 'Clouds', 'Clear'];
      const currentIndex = conditions.indexOf(mainCondition);
      const newIndex = conditions.indexOf(item.weather[0].main);
      if (newIndex !== -1 && (currentIndex === -1 || newIndex < currentIndex)) {
        mainCondition = item.weather[0].main;
        description = item.weather[0].description;
      }
    });

    return {
      min: minTemp,
      max: maxTemp,
      main: mainCondition,
      desc: description
    };
  } catch (err) {
    Logger.log(`Weather API Error: ${err.toString()}`);
    throw err;
  }
}

/* =========================
   ALTERNATIVE: ONE CALL API 3.0 (PAID)
   Premium option with more accurate data - requires subscription
   To use this instead, rename this function to getWeather() and rename the above to getWeatherForecast()
   ========================= */
function getWeatherOneCall(lat, lng) {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty("OPENWEATHER_API_KEY");

  if (!apiKey) {
    throw new Error("Missing OPENWEATHER_API_KEY in Script Properties");
  }

  // One Call API 3.0 - requires subscription
  const url =
    `https://api.openweathermap.org/data/3.0/onecall` +
    `?lat=${lat}&lon=${lng}&units=metric&exclude=minutely,hourly,alerts&appid=${apiKey}`;

  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    
    if (code === 401) {
      throw new Error("Invalid API key or One Call API not available. Check your OpenWeather subscription.");
    }
    
    if (code !== 200) {
      throw new Error(`Weather API returned status ${code}`);
    }
    
    const data = JSON.parse(res.getContentText());

    if (!data.daily || !data.daily[0]) {
      throw new Error("Invalid weather response - no daily data");
    }

    const today = data.daily[0];

    return {
      min: today.temp.min,
      max: today.temp.max,
      main: today.weather[0].main,
      desc: today.weather[0].description
    };
  } catch (err) {
    Logger.log(`Weather API Error: ${err.toString()}`);
    throw err;
  }
}

/* =========================
   WEATHER SUMMARY LOGIC
   ========================= */
function summarizeWeather(w) {
  switch (w.main) {
    case "Clear":
      return "☀️ Sunny, generally good weather";
    case "Clouds":
      return "☁️ Cloudy but workable conditions";
    case "Rain":
    case "Drizzle":
      return "🌧️ Rainy, expect delays";
    case "Thunderstorm":
      return "⛈️ Stormy, not ideal for outdoor work";
    case "Snow":
      return "❄️ Snowy, high-risk conditions";
    case "Mist":
    case "Fog":
      return "🌫️ Low visibility conditions";
    default:
      return w.desc;
  }
}

/* =========================
   SLACK RESPONSE FORMAT
   ========================= */
function respond(text) {
  return ContentService
    .createTextOutput(
      JSON.stringify({
        response_type: "ephemeral", // change to "in_channel" to show publicly
        text: text
      })
    )
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================
   SEND MESSAGE TO SLACK CHANNEL
   ========================= */
function sendToSlackChannel(message) {
  const webhookUrl = PropertiesService.getScriptProperties()
    .getProperty("SLACK_WEBHOOK_URL");

  if (!webhookUrl) {
    Logger.log("Error: Missing SLACK_WEBHOOK_URL in Script Properties");
    throw new Error("Missing SLACK_WEBHOOK_URL");
  }

  if (!message) {
    Logger.log("Warning: Empty message received");
    message = "No weather data available";
  }

  Logger.log(`Sending message to Slack. Message preview: ${message.substring(0, Math.min(100, message.length))}...`);

  // Use proper Slack message format with mrkdwn enabled
  const payload = {
    text: message,
    mrkdwn: true
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(webhookUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    Logger.log(`Slack webhook response code: ${responseCode}`);

    if (responseCode !== 200) {
      Logger.log(`Slack response error: ${responseCode} - ${responseBody}`);
      Logger.log(`Payload sent: ${JSON.stringify(payload)}`);
      throw new Error(`Slack webhook failed: ${responseCode}`);
    } else {
      Logger.log("✅ Full message sent to Slack successfully");
      Logger.log(`Message length: ${message.length} characters`);
    }
  } catch (error) {
    Logger.log(`Error sending to Slack: ${error.toString()}`);
    throw error;
  }
}

/* =========================
   SEND WEATHER FOR SPECIFIC POSTER
   ========================= */
function sendWeatherByPoster(posterName) {
  const clients = getAllClients();
  Logger.log(`Fetching weather for poster: ${posterName}`);
  
  // Filter clients by poster and exclude NA
  const posterClients = clients.filter(c => {
    const posterUpper = (c.poster || "").toUpperCase();
    return c.poster === posterName && posterUpper !== "NA";
  });
  
  if (!posterClients.length) {
    Logger.log(`No clients found for poster: ${posterName}`);
    return;
  }

  let message = `🌤️ *Weather Report for ${posterName}*\n\n`;

  posterClients.forEach(client => {
    Logger.log(`Processing client: ${client.name} (${client.lat}, ${client.lng})`);
    try {
      const w = getWeather(client.lat, client.lng);
      Logger.log(`Weather received for ${client.name}: ${JSON.stringify(w)}`);
      const summary = summarizeWeather(w);

      message += `*${client.name}*\n`;
      message += `Temp: ${Math.round(w.min)}–${Math.round(w.max)}°C\n`;
      message += `${summary}\n\n`;

    } catch (err) {
      Logger.log(`Weather error for ${client.name}: ${err.toString()}`);
      message += `*${client.name}*\n⚠️ Weather unavailable\n\n`;
    }
  });

  Logger.log(`Final message length: ${message.length}`);
  Logger.log(`Message content: ${message}`);
  
  sendToSlackChannel(message);
}

/* =========================
   TESTING FUNCTIONS
   ========================= */

// Test individual client weather lookup
function testGetWeather() {
  const testLat = 40.7128;  // NYC
  const testLng = -74.0060;
  
  try {
    const weather = getWeather(testLat, testLng);
    Logger.log("Weather result: " + JSON.stringify(weather));
  } catch (err) {
    Logger.log("Test failed: " + err.toString());
  }
}

// Test Slack message format
function testSlackMessage() {
  const testMessage = "🌤️ *Test Weather Report*\n\nThis is a test message.";
  
  try {
    sendToSlackChannel(testMessage);
    Logger.log("Test message sent successfully");
  } catch (err) {
    Logger.log("Test failed: " + err.toString());
  }
}

// Test full workflow
function testFullWorkflow() {
  const clients = getAllClients();
  Logger.log(`Found ${clients.length} clients`);
  
  if (clients.length > 0) {
    const testClient = clients[0];
    Logger.log(`Testing with client: ${testClient.name}`);
    
    try {
      const weather = getWeather(testClient.lat, testClient.lng);
      Logger.log(`Weather: ${JSON.stringify(weather)}`);
      
      const summary = summarizeWeather(weather);
      Logger.log(`Summary: ${summary}`);
    } catch (err) {
      Logger.log(`Test failed: ${err.toString()}`);
    }
  }
}

// Test client search function
function testClientSearch() {
  // Test with various search terms
  const testQueries = [
    "window foundry",
    "Window Foundry",
    "WINDOW",
    "foundry",
    "wind"
  ];

  Logger.log("=== Testing Client Search ===");

  testQueries.forEach(query => {
    Logger.log(`\nSearching for: "${query}"`);
    const result = findClientByName(query);

    if (result.match) {
      Logger.log(`✓ Found exact match: ${result.match.name}`);
    } else if (result.suggestions.length > 0) {
      Logger.log(`⚠ Multiple matches (${result.suggestions.length}):`);
      result.suggestions.forEach(s => Logger.log(`  - ${s.name}`));
    } else {
      Logger.log(`✗ No matches found`);
    }
  });

  // List all clients
  const allClients = getAllClients();
  Logger.log(`\n=== All Clients (${allClients.length}) ===`);
  allClients.forEach(c => Logger.log(`- ${c.name}`));
}
