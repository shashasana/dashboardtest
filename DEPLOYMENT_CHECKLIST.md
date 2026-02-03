# Deployment Checklist ✅

## Pre-Deployment

- [ ] Read `OPTIMIZATION_COMPLETE.md` to understand changes
- [ ] Review `SETUP_SERVICE_AREAS.md` for quick start
- [ ] Check that Google Sheet is published to web
- [ ] Update `SHEET_ID` in `export-data.js` if needed

## Step 1: Generate Service Areas (Local)

```bash
# Generate the precomputed polygon data
node export-data.js

# Expected output:
# [CLIENT] Client 1
#   [FETCH] Searching: 98101...
#   [SUCCESS] Got polygon for: 98101
# ...
# [SUCCESS] Exported 42 clients to data/service-areas.json
```

**Time estimate:** 5-20 minutes (depends on # of clients)

**What gets created:** `data/service-areas.json` (~100KB - 1MB)

## Step 2: Verify Locally

```bash
# Start your local server
npm start

# Open http://localhost:3000

# Test:
# ✓ Map loads with client markers
# ✓ Hover shows client name/location
# ✓ Click marker shows service area polygon INSTANTLY
# ✓ No lag or delay

# Check DevTools (F12) → Network:
# ✓ data/service-areas.json loads once
# ✓ No network calls on marker click
```

## Step 3: Commit to GitHub

```bash
# Add the generated file
git add data/service-areas.json

# Commit
git commit -m "Feat: Add precomputed service areas for instant rendering"

# Push to main
git push origin main

# Or if you want to review in PR first:
git push origin -u your-branch-name
# Then create PR and merge when ready
```

## Step 4: Vercel Auto-Deploy

- ✅ Vercel detects push
- ✅ Builds new version (~30 seconds)
- ✅ Deploys to production (~10 seconds)
- ✅ CDN caches service-areas.json globally

**Check deployment status:**
1. Go to https://vercel.com
2. Find your project
3. See "Deployments" tab
4. Click latest deployment
5. Verify it says "Ready"

## Step 5: Test in Production

Go to your live URL (e.g., `https://dashboard.example.com`)

Test:
- [ ] Map loads (should be fast)
- [ ] Click marker → service area appears instantly
- [ ] No console errors (F12 → Console)
- [ ] Try different markers - all instant
- [ ] Check DevTools → Network → data/service-areas.json loads from "disk cache" or CDN

## Expected Performance

| Metric | Expected |
|--------|----------|
| **Initial page load** | <2 seconds |
| **Click to show service area** | <100ms (instant) |
| **service-areas.json load** | 100-500ms (CDN cache) |
| **Marker render** | Instant |

## Troubleshooting

### Problem: Export script errors
**Solution:**
- Check Google Sheet is published: File → Share → Publish to web
- Update SHEET_ID in export-data.js
- Delete `data/service-areas.json` and try again

### Problem: Service areas not showing on click
**Solution:**
- Check `data/service-areas.json` exists in repo
- Clear browser cache (Ctrl+Shift+Del)
- Check DevTools → Console for errors
- Verify file is valid JSON: Open it in VS Code

### Problem: Still seeing 2-3 second lag on click
**Solution:**
- Verify you're NOT seeing Apps Script calls in Network tab
- Check that `precomputedServiceAreas` has data (Console: `window.precomputedServiceAreas`)
- If no data, verify export script ran successfully
- Check that latest deployment is live

### Problem: File size too large
**Solution:**
- Edit `export-data.js` to skip certain ZIPs
- Simplify polygons more aggressively in dashboard.js
- See PERFORMANCE_OPTIMIZATION.md → "Polygon Simplification"

## Rollback (If Needed)

If something breaks:

```bash
# Revert the commit
git revert HEAD

# Push
git push origin main

# Or delete the problematic file
git rm data/service-areas.json
git commit -m "Remove precomputed service areas"
git push

# Dashboard falls back to runtime fetching (slower but working)
```

## Maintenance Schedule

- **Weekly** (or as needed):
  ```bash
  # After adding/changing clients
  node export-data.js
  git add data/service-areas.json
  git commit -m "Update service areas"
  git push
  ```

- **Monthly** (optional):
  - Review file size
  - Check if simplification can be improved
  - Monitor performance metrics

## Success Criteria

✅ All checks passed:
- [ ] data/service-areas.json generated successfully
- [ ] Local testing shows instant marker clicks
- [ ] Committed to GitHub
- [ ] Vercel deployed successfully
- [ ] Production shows instant service areas
- [ ] No console errors
- [ ] Network tab shows polygon data from cache

## Next Steps

1. **Performance monitoring** - Use Vercel Analytics or Google Analytics to track:
   - Page load time
   - Click-to-render latency
   - User engagement

2. **Further optimization** (optional) - See PERFORMANCE_OPTIMIZATION.md:
   - Gzip compression
   - Service worker caching
   - Lazy loading by region
   - Delta updates

3. **Scale** - Dashboard now supports:
   - 1000+ clients
   - 100+ ZIPs per client
   - Global distribution

---

**Questions?** Review the documentation:
- `OPTIMIZATION_COMPLETE.md` - Overview
- `SETUP_SERVICE_AREAS.md` - Quick start
- `PERFORMANCE_OPTIMIZATION.md` - Deep dive
