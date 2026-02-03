# Quick Start: Generate & Deploy Service Areas

## 📋 Prerequisites
- Node.js installed
- Your Google Sheet shared publicly (published to web)
- GitHub repository with Vercel connected

## 🚀 5-Minute Setup

### 1. Prepare Your Google Sheet
- Ensure your sheet has columns: `Client`, `Industry`, `Location`, `Service Area`, `Latitude`, `Longitude`
- **Publish to the web**: File → Share → Publish to web (CSV format)
- Copy the Sheet ID from the URL

### 2. Update Configuration
Edit `export-data.js` line 16:
```javascript
const SHEET_ID = "YOUR_SHEET_ID_HERE"; // Replace
```

### 3. Generate Service Areas
```bash
# Run the export script
node export-data.js

# This will:
# ✓ Read clients from your Sheet
# ✓ Fetch polygon for each ZIP/city from Nominatim
# ✓ Generate data/service-areas.json
```

### 4. Commit to GitHub
```bash
git add data/service-areas.json
git commit -m "Generate precomputed service areas"
git push origin main
```

### 5. Done! 🎉
- Vercel auto-deploys
- CDN caches the file globally
- Dashboard now loads **service areas instantly** on click

## 📊 What Gets Generated

`data/service-areas.json` contains:
```json
{
  "version": "1.0",
  "generatedAt": "2026-02-04T12:00:00Z",
  "clientCount": 42,
  "clients": [
    {
      "name": "North Shore Brick",
      "industry": "Roofing",
      "location": "Seattle, WA",
      "lat": 47.6062,
      "lng": -122.3321,
      "serviceArea": "98101, 98102, 98103",
      "polygons": [
        {
          "entry": "98101",
          "label": "Seattle WA 98101",
          "feature": { /* GeoJSON polygon */ }
        }
        // ... more polygons
      ]
    }
    // ... more clients
  ]
}
```

## ⏱️ Performance Impact

**Before export-based approach:**
- Click marker → Wait 2-5 seconds for polygon fetch → See result ❌

**After export-based approach:**
- Page loads → All polygons cached in memory ✓
- Click marker → Instant rendering ✨

## 📝 Maintenance

**Every time you add a client or change service areas:**

```bash
# 1. Update Google Sheet
# 2. Run export
node export-data.js

# 3. Commit
git add data/service-areas.json
git commit -m "Add Client XYZ service areas"
git push origin main

# Done! Vercel deploys automatically
```

**Frequency:** Weekly or as-needed

## 🔧 Troubleshooting

**Export fails with "HTTP 404"?**
- Your Google Sheet isn't published
- Go to File → Share → Publish to web → Copy Sheet ID again

**Nominatim errors (rate limiting)?**
- Script pauses between requests (built-in throttling)
- Just let it run, may take 10-20 minutes for large datasets

**service-areas.json file too large?**
- Default maximum ~1MB (contains all ZIP polygons)
- If needed, edit export-data.js to simplify polygons with Turf.js

## 📚 Learn More

See [PERFORMANCE_OPTIMIZATION.md](./PERFORMANCE_OPTIMIZATION.md) for deep dive into architecture and optimization strategies.

---

**Questions?** The dashboard falls back gracefully if service-areas.json is missing. You can always deploy and test safely!
