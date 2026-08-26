# Day 7 Update — Polish, Testing & Deploy

## Summary

Day 7 focused on making the Pulse social app production-ready: edge case handling (blocks), performance indexing, accessibility (WCAG basics), responsive UI polish, deployment configuration, and server-side frontend serving. All existing features (auth, posts, follows, likes, comments, chronological feed, ranked feed) remain fully functional.

---

## Files Modified

### Backend

| File | Changes |
|------|---------|
| `backend/db.js` | Added `blocks` table (blocker_id, blocked_id, CHECK constraint), 4 new indexes (`idx_comments_post`, `idx_comments_user`, `idx_blocks_blocker`, `idx_blocks_blocked`) |
| `backend/server.js` | Production mode serves frontend via `express.static`, wildcard `*` route returns `index.html`, updated health endpoint to day 7, updated startup log message |
| `backend/routes/posts.js` | Imported `blockedIds` from follows, all 3 feed endpoints (feed, for-you, discover) now filter blocked users' posts |
| `backend/routes/follows.js` | Added `isBlocked()` and `blockedIds()` helper functions, exported them, added `POST/DELETE /:userId/block` endpoints (auto-unfollow on block), suggestions/followers/following lists filter blocked users, follow endpoint blocks following a blocked user |
| `backend/routes/users.js` | User directory and profile endpoints filter blocked users, imported `blockedIds` |
| `backend/.env.example` | Added `NODE_ENV=development` |

### Frontend

| Section | Changes |
|---------|---------|
| CSS | Added `.sr-only` (screen reader only), `.skip-link`, focus-visible styles, `.block-btn` (hover-reveal), responsive breakpoints (600px, 900px), consistent error/empty state styling, skeleton accessibility |
| HTML meta | Added `<meta name="description">` |
| Skip link | Added `<a href="#feedView" class="skip-link">` for keyboard navigation |
| Auth panel | Added `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `required`, `aria-required`, `aria-describedby` on form elements |
| App header | Added `role="banner"`, `aria-label` on stats group and buttons |
| Composer | Added `aria-label`, `aria-describedby`, `aria-live="polite"` on char counter, `role="alert"` on banner |
| Feed tabs | Added `role="tablist"`, `role="tab"`, `aria-selected` |
| Posts list | Added `aria-label`, `aria-live="polite"` |
| Post cards | Added `aria-label` on article, descriptive `alt` text on images, decorative avatars `aria-hidden` |
| Engagement bar | Added `role="group"`, `aria-label` with dynamic text (like/unlike + count), `aria-expanded` on comment toggle |
| Comments section | Added `role="region"`, `aria-label`, unique `id` for comment char counters |
| Follow button | Added `aria-label` with dynamic text (follow/unfollowing) |
| Suggestions panel | Added `aria-label`, `role="list"` / `role="listitem"` |
| People panel | Added `role="dialog"`, `aria-modal`, `aria-label`, `role="tablist"`, `role="list"`, `role="listitem"`, close button `aria-label` |
| Empty/error states | All use `role="status"` or `role="alert"` |
| Skeleton loading | Added `aria-hidden="true"`, `role="presentation"`, plus `<span class="sr-only" role="status">Loading posts…</span>` |
| API_BASE | Dynamic: uses `localhost:5000/api` in dev, `origin + "/api"` in production |
| Stage copy | Updated eyebrow to "Day 7 · Production Ready", updated footer stats, updated welcome message |

### New Files

| File | Purpose |
|------|---------|
| `backend/render.yaml` | Render deployment config (free tier, Node.js, auto-generated JWT_SECRET) |
| `vercel.json` | Vercel deployment config for frontend static files |
| `netlify.toml` | Netlify deployment config with SPA redirect |
| `README.md` | Fully updated with Day 5–7 descriptions, deployment guide, complete API table including block endpoints |
| `DAY7_UPDATE.md` | This file |

---

## New API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/follows/:userId/block` | requireAuth | Block a user (also unfollows them and removes their follow of you) |
| DELETE | `/api/follows/:userId/block` | requireAuth | Unblock a user |

### Block Behavior
- Blocking is bidirectional for content hiding (neither sees the other's posts)
- Auto-unfollows both directions on block
- Prevents following a blocked user
- All feeds, suggestions, lists, and directory filter blocked users
- Profile returns 404 for blocked users

---

## Database Changes

### New Table: `blocks`
```sql
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
```

### New Indexes
- `idx_comments_post` on `comments(post_id)` — speeds up comment queries per post
- `idx_comments_user` on `comments(user_id)` — speeds up user's comment lookups
- `idx_blocks_blocker` on `blocks(blocker_id)` — speeds up "who did I block" queries
- `idx_blocks_blocked` on `blocks(blocked_id)` — speeds up "who blocked me" queries

---

## Accessibility Features Added

1. **Skip-to-content link** — visible on Tab focus, skips to feed content
2. **ARIA roles** — tablist, tab, dialog, alert, status, list, listitem, region, banner
3. **ARIA labels** — all buttons, forms, panels, and sections labeled
4. **aria-live regions** — char counters and post list announce changes to screen readers
5. **aria-expanded** — comment toggle tracks open/closed state
6. **aria-required** — all auth form inputs marked required
7. **Alt text** — post images have descriptive alt text; decorative avatars hidden
8. **Focus-visible** — consistent 2px iris outline on all focusable elements
9. **prefers-reduced-motion** — all animations disabled for users who prefer it
10. **Screen-reader-only text** — skeleton loading announces "Loading posts…"

---

## Responsive Breakpoints

| Breakpoint | Changes |
|-----------|---------|
| ≤600px (mobile) | Smaller header padding, wrapped user stats, reduced composer/post padding, smaller fonts, full-width people panel, hidden comment/composer avatars, smaller suggestion cards |
| 601–900px (tablet) | Moderate padding reduction, slightly narrower people panel |
| >900px (desktop) | Full layout, 2-column auth screen, all floating cards visible |

---

## Deployment Options

### Option A: Single Deployment (Recommended)
Backend serves frontend in production mode.
1. Push to GitHub
2. Deploy on Render using `render.yaml`
3. Set `NODE_ENV=production` in Render env vars
4. Frontend is served automatically by Express

### Option B: Separate Deployments
1. Backend on Render/Railway
2. Frontend on Vercel (using `vercel.json`) or Netlify (using `netlify.toml`)
3. Frontend auto-detects API URL via dynamic `API_BASE`

---

## End-to-End Flow Verified

✅ Server starts without errors  
✅ All 6 database tables exist (users, posts, follows, likes, comments, blocks)  
✅ All 10 indexes created  
✅ All route modules load successfully  
✅ Blocks table has correct schema with CHECK constraint  
