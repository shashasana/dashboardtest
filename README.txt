# PROJECT BASIC - Client Dashboard

## For Hostinger Upload

Just upload these 2 files to your Hostinger account:
- `index.html` - Main dashboard page
- `dashboard.js` - Dashboard logic

## Setup

1. **Update CSV_URL** in `dashboard.js` (line 15)
   - Replace with your Google Sheet's published CSV URL

2. **Deploy Google Apps Script**
   - Copy `GoogleAppsScript.gs` code
   - Deploy on Google's Apps Script platform
   - Get the Deployment URL

3. **Update APPS_SCRIPT_URL** in `dashboard.js` (line 18)
   - Paste your Apps Script deployment URL

4. **Upload to Hostinger**
   - Create folder: `/client-dashboard/`
   - Upload both files
   - Access at: `https://yoursite.com/client-dashboard/`

## That's It!

No backend setup needed. Everything else runs on:
- Google Sheets (your data)
- Google Apps Script (add/delete/trash)
- External APIs (maps, weather, geocoding)
