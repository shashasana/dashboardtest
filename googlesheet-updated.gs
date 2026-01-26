/**
 * CLIENT DASHBOARD - GOOGLE APPS SCRIPT BACKEND
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to your Google Sheet
 * 2. Click Extensions → Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Save the project with name "ClientDashboard"
 * 5. Click Deploy → New deployment
 * 6. Select Type: Web app
 * 7. Execute as: Your email
 * 8. Who has access: Anyone
 * 9. Click Deploy and copy the Deployment URL
 * 10. In client-dashboard.html, set: APPS_SCRIPT_URL = "YOUR_DEPLOYMENT_URL"
 */

const SHEET_ID = "10HaJdMVaqasoR1mrX39iP58hIMvrWV8GTztUX7_rVZM"; // Replace with your Google Sheet ID
const DATABASE_SHEET = "Database";
const TRASH_SHEET = "Trash";

// HANDLE GET REQUESTS (for polygon fetching)
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === "getPolygon") {
      return getPolygonData(e.parameter.entry);
    }
    
    return returnError("Unknown GET action");
  } catch (error) {
    return returnError(error.toString());
  }
}

// FETCH POLYGON FROM NOMINATIM WITH CACHING
function getPolygonData(entry) {
  if (!entry) {
    return returnError("Missing entry parameter");
  }
  
  const cache = CacheService.getScriptCache();
  const cacheKey = 'polygon_' + entry;
  
  // Check cache (6 hour expiration)
  const cached = cache.get(cacheKey);
  if (cached) {
    return ContentService.createTextOutput(cached)
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    const isZip = /^\d{5}$/.test(entry);
    
    // Step 1: Search for the location
    const searchUrl = isZip 
      ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&postalcode=${encodeURIComponent(entry)}`
      : `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(entry + ', United States')}`;
    
    const searchResponse = UrlFetchApp.fetch(searchUrl, {
      headers: { 'User-Agent': 'ClientDashboard/1.0' },
      muteHttpExceptions: true
    });
    
    if (searchResponse.getResponseCode() !== 200) {
      throw new Error('Search failed');
    }
    
    const searchData = JSON.parse(searchResponse.getContentText());
    if (!searchData || searchData.length === 0) {
      return returnError("Not found");
    }
    
    const item = searchData[0];
    
    // Build label
    let label = entry;
    if (isZip && item.display_name) {
      const parts = item.display_name.split(',').map(s => s.trim()).filter(p => p !== entry && !/^\d{5}$/.test(p));
      const city = parts[0] || '';
      const state = parts.find(v => /\b[A-Z]{2}\b/.test(v)) || '';
      if (city && state) {
        label = `${city} ${state} ${entry}`;
      } else if (city) {
        label = `${city} ${entry}`;
      }
    } else if (!isZip && item.display_name) {
      label = item.display_name.split(',')[0].trim();
    }
    
    // Step 2: Fetch detailed polygon using lookup API
    if (item.osm_type && item.osm_id) {
      const osmPrefix = item.osm_type === 'relation' ? 'R' : item.osm_type === 'way' ? 'W' : 'N';
      const lookupUrl = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmPrefix}${item.osm_id}&format=json&polygon_geojson=1`;
      
      Utilities.sleep(250); // Rate limiting
      
      const lookupResponse = UrlFetchApp.fetch(lookupUrl, {
        headers: { 'User-Agent': 'ClientDashboard/1.0' },
        muteHttpExceptions: true
      });
      
      if (lookupResponse.getResponseCode() === 200) {
        const lookupData = JSON.parse(lookupResponse.getContentText());
        if (lookupData && lookupData.length > 0 && lookupData[0].geojson) {
          const geojson = lookupData[0].geojson;
          if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
            const result = {
              feature: {
                type: 'Feature',
                geometry: geojson,
                properties: { label: label }
              },
              label: label
            };
            
            const resultJson = JSON.stringify(result);
            cache.put(cacheKey, resultJson, 21600); // 6 hours
            
            return ContentService.createTextOutput(resultJson)
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }
    
    return returnError("No polygon found");
    
  } catch (err) {
    return returnError(err.toString());
  }
}

// HANDLE POST REQUESTS (for database operations)
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    // Ensure sheets exist
    ensureSheets();
    
    if (action === "addClient") {
      return addClient(payload.data);
    } else if (action === "deleteClient") {
      return deleteClient(payload.data);
    } else if (action === "getTrash") {
      return getTrash();
    } else if (action === "restoreClient") {
      return restoreClient(payload.index);
    } else if (action === "permanentlyDelete") {
      return permanentlyDelete(payload.index);
    } else if (action === "getDatabase") {
      return getDatabase();
    } else if (action === "editClient") {
      return editClient(payload.data);
    }
    
    return returnError("Unknown action");
  } catch (error) {
    return returnError(error.toString());
  }
}

function getDatabase() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(DATABASE_SHEET);
    
    if (!sheet) {
      return returnSuccess("No database", []);
    }
    
    const values = sheet.getDataRange().getValues();
    const data = [];
    
    for (let i = 1; i < values.length; i++) {
      data.push(values[i]);
    }
    
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, data: data })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return returnError("Failed to get database: " + error.toString());
  }
}

function ensureSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  if (!ss.getSheetByName(DATABASE_SHEET)) {
    ss.insertSheet(DATABASE_SHEET);
    const sheet = ss.getSheetByName(DATABASE_SHEET);
    sheet.appendRow(["Client", "Industry", "Location", "Service Area", "Latitude", "Longitude"]);
  }
  
  if (!ss.getSheetByName(TRASH_SHEET)) {
    ss.insertSheet(TRASH_SHEET);
    const sheet = ss.getSheetByName(TRASH_SHEET);
    sheet.appendRow(["Client", "Industry", "Location", "Service Area", "Latitude", "Longitude", "Deleted Date"]);
  }
}

function addClient(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(DATABASE_SHEET);
    
    sheet.appendRow([
      data.name,
      data.industry,
      data.location,
      data.serviceArea,
      data.lat,
      data.lng
    ]);
    
    return returnSuccess("Client added successfully");
  } catch (error) {
    return returnError("Failed to add client: " + error.toString());
  }
}

function deleteClient(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const dbSheet = ss.getSheetByName(DATABASE_SHEET);
    const trashSheet = ss.getSheetByName(TRASH_SHEET);
    
    // Find and move to trash
    const values = dbSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.clientName) {
        const row = values[i];
        trashSheet.appendRow([
          row[0], row[1], row[2], row[3], row[4], row[5],
          new Date().toLocaleString()
        ]);
        dbSheet.deleteRow(i + 1);
        return returnSuccess("Client moved to trash");
      }
    }
    
    return returnError("Client not found");
  } catch (error) {
    return returnError("Failed to delete client: " + error.toString());
  }
}

function getTrash() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const trashSheet = ss.getSheetByName(TRASH_SHEET);
    
    if (!trashSheet) {
      return returnSuccess("Trash is empty", []);
    }
    
    const values = trashSheet.getDataRange().getValues();
    const trash = [];
    
    for (let i = 1; i < values.length; i++) {
      trash.push([values[i][0], values[i][1], values[i][2], values[i][3], values[i][4], values[i][5]]);
    }
    
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, trash: trash })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return returnError("Failed to load trash: " + error.toString());
  }
}

function restoreClient(index) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const trashSheet = ss.getSheetByName(TRASH_SHEET);
    const dbSheet = ss.getSheetByName(DATABASE_SHEET);
    
    const values = trashSheet.getDataRange().getValues();
    if (index + 1 < values.length) {
      const row = values[index + 1];
      dbSheet.appendRow([row[0], row[1], row[2], row[3], row[4], row[5]]);
      trashSheet.deleteRow(index + 2);
      return returnSuccess("Client restored");
    }
    
    return returnError("Item not found in trash");
  } catch (error) {
    return returnError("Failed to restore: " + error.toString());
  }
}

function permanentlyDelete(index) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const trashSheet = ss.getSheetByName(TRASH_SHEET);
    
    trashSheet.deleteRow(index + 2);
    return returnSuccess("Permanently deleted");
  } catch (error) {
    return returnError("Failed to delete: " + error.toString());
  }
}

function editClient(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(DATABASE_SHEET);
    
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.originalName) {
        sheet.getRange(i + 1, 1, 1, 6).setValues([[
          data.name,
          data.industry,
          data.location,
          data.serviceArea,
          data.lat,
          data.lng
        ]]);
        return returnSuccess("Client updated successfully");
      }
    }
    
    return returnError("Client not found");
  } catch (error) {
    return returnError("Failed to update client: " + error.toString());
  }
}

function returnSuccess(message, data = null) {
  return ContentService.createTextOutput(
    JSON.stringify({ success: true, message: message, trash: data })
  ).setMimeType(ContentService.MimeType.JSON);
}

function returnError(message) {
  return ContentService.createTextOutput(
    JSON.stringify({ success: false, error: message })
  ).setMimeType(ContentService.MimeType.JSON);
}
