const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function handleWeather(requestUrl, res) {
  const lat = requestUrl.searchParams.get('lat');
  const lng = requestUrl.searchParams.get('lng');
  if (!lat || !lng) {
    return sendJson(res, 400, { error: 'Missing lat or lng parameter' });
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    // Gracefully return placeholder data when the API key is not set so local testing keeps working.
    return sendJson(res, 200, { main: { temp: null }, timezone: 0, note: 'OPENWEATHER_API_KEY not configured; returning placeholder' });
  }

  try {
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&appid=${apiKey}&units=metric`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return sendJson(res, response.status, { error: `Weather API error: ${response.statusText}` });
    }
    const data = await response.json();
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 500, { error: 'Failed to fetch weather', details: err.message });
  }
}

async function handleRefreshServiceAreas(res) {
  try {
    return new Promise((resolve) => {
      const process_child = spawn('node', ['quick-export.js'], { cwd: ROOT });
      let stdout = '';
      let stderr = '';

      process_child.stdout.on('data', (data) => { stdout += data.toString(); });
      process_child.stderr.on('data', (data) => { stderr += data.toString(); });

      process_child.on('close', (code) => {
        if (code === 0) {
          sendJson(res, 200, { 
            success: true, 
            message: 'Service areas refreshed successfully',
            details: stdout
          });
        } else {
          sendJson(res, 500, { 
            success: false, 
            error: 'Export script failed',
            details: stderr || stdout
          });
        }
        resolve();
      });
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'Failed to trigger refresh', details: err.message });
  }
}

async function handleStatic(requestUrl, res) {
  const decodedPath = decodeURIComponent(requestUrl.pathname || '/');
  const safePath = path.normalize(decodedPath).replace(/^([.][.][/\\])+/, '');
  const target = safePath === '/' ? 'index.html' : safePath;
  const filePath = path.join(ROOT, target);

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    
    if (requestUrl.pathname === '/api/refresh-service-areas') {
      return await handleRefreshServiceAreas(res);
    }
    
    if (requestUrl.pathname === '/api/weather') {
      return handleWeather(requestUrl, res);
    }
    
    // Add Cache-Control for service-areas.json to allow CDN caching
    if (requestUrl.pathname === '/data/service-areas.json') {
      return handleStatic(requestUrl, res);
    }
    
    return handleStatic(requestUrl, res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unexpected server error');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
