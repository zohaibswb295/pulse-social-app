# Pulse — Social Feed App

7-din ka project: posts, follows, likes, aur ek ranked feed algorithm.
Ye repo **Day 7: Polish, Testing & Deploy** tak complete hai.

## Stack

- **Backend:** Node.js, Express, SQLite (`better-sqlite3`), JWT auth, bcrypt, image upload (`multer`)
- **Frontend:** Vanilla HTML/CSS/JS (no build step — sirf browser mein kholo)

## Day 1 mein kya bana

- Poore app ka database schema (`users`, `posts`, `follows`, `likes`, `comments`, `blocks`) — taake Day 2–7 mein migrations na karni pade
- Signup / Login / "who am I" (`/api/auth/me`) APIs, JWT session tokens ke saath
- Password hashing (bcrypt), input validation, duplicate username/email check
- GenZ-style split-screen auth UI — animated gradient orb + floating post cards, login/signup toggle, error/success states, "logged in" welcome screen

## Day 2 mein kya bana

- **Posts CRUD API:** create (text + optional image), get single post, edit (owner-only), delete (owner-only, image file bhi disk se cleanup hoti hai)
- **Validation:** empty post reject, 500-character limit, image type whitelist (JPEG/PNG/GIF/WEBP), 5MB image size limit — sab client aur server dono taraf check hota hai
- **Pagination:** `GET /api/posts?page=&limit=` — `hasMore` flag ke saath, bina extra COUNT query ke
- **Image uploads:** `multer` disk storage, `backend/uploads/` mein save hoti hain, `/uploads/...` route se serve hoti hain
- **Frontend feed page:** login ke baad "View your feed →" — post composer (textarea + character counter + image preview + loading state) aur post cards list (avatar, name, timestamp, content, image)
- **UX polish:** skeleton loading state feed load hote waqt, empty state jab koi post na ho, error banner agar create/upload fail ho, inline edit/delete apne hi posts par, "Load more" button pagination ke liye

## Day 3 mein kya bana

- **Follow/unfollow API:** self-follow block, already-following check (409), unfollow jo follow nahi kiya usko 404
- **Followers/Following list API:** dono paginated (`page`, `limit`, `hasMore`), agar caller signed-in hai to har user ke saath `isFollowing` bhi milta hai
- **Follow suggestions API:** pehle mutual-connections wale users (jo tumhare followed logon ne follow kiye hain), fir kami newest-users se fill hoti hai
- **Discover directory API:** `GET /api/users` — sab users ki paginated list (khud ko chhod kar), har user ke saath `isFollowing`. Ye "Suggested for you" se alag hai — suggestions limited/curated hai, Discover mein hamesha sab log milte hain, chahe koi bhi suggest karne ko na ho
- **Profile counts API:** `GET /api/users/:id` — followers/following count + `isFollowing` ek hi call mein
- **Frontend:** har post card par (apne posts chhodkar) Follow/Following toggle button, feed ke upar "Suggested for you" horizontal strip, header mein "🔍 Discover" button jo sab users ki list kholta hai, header mein clickable followers/following count jo slide-over panel kholta hai (3 tabs: Discover / Followers / Following — teeno se seedha follow/unfollow ho sakta hai)
- **UX:** optimistic UI — button turant switch hota hai, background mein API call jaati hai, fail hone par revert + alert; empty states ("No followers yet.", "Not following anyone yet.", suggestions panel khud hide ho jata hai agar kuch suggest karne ko na ho)

## Day 4 mein kya bana

- **Like/unlike API:** `POST/DELETE /api/posts/:id/like` — duplicate like 409 se reject hota hai, jo like nahi kiya usko unlike karne par 404
- **Comments API:** add comment (`POST`), paginated list oldest-first (`GET`), apna comment delete (`DELETE`, owner-only, 403 doosron ke comments par) — 300-character limit
- **Engagement metrics:** har post ke response mein `likeCount`, `commentCount`, aur (agar signed-in ho) `likedByMe` — ek hi query se, N+1 nahi (Day 6 ranking isi data par banega)
- **Frontend — like button:** heart icon 🤍 ↔ ❤️ toggle, optimistic update (turant flip, background mein API call, fail hone par revert), click par bounce/scale micro-interaction
- **Frontend — comments:** har post ke neeche collapsible comment section, pehli baar kholte hi lazy-load hota hai, "Load more comments" pagination, apna comment delete karne ka button, reply box mein live character counter aur auto-resize textarea
- **UX:** empty state "Be the first to comment 👋", sign-in na hone par like button disabled + comment box ki jagah "Sign in to join the conversation.", comment submit ke dauran button "…" dikhata hai aur disable rehta hai

## Day 5 mein kya bana

- **Following Feed API:** `GET /api/posts/feed` — sirf followed users ke posts, newest-first, cursor-based pagination (delete se page shift nahi hota)
- **Infinite scroll:** IntersectionObserver bottom sentinel par, `rootMargin: 400px` se提前load hota hai, "Load more" button fallback
- **Empty states:** brand new user (no follows) → "follow someone" + inline suggestions; follows hai par koi post nahi → "check back later" + suggestions
- **Edge case:** followed user ne post delete kar diya to feed mein nahi dikhta

## Day 6 mein kya bana

- **Ranking algorithm:** `score = (1 × likes) + (1.5 × comments) + (40 × recencyDecay) + followBoost + socialSignal`
- **Recency decay:** exponential — 30-hour half-life (brand new = 1.0, 30h old = 0.5, 60h = 0.25)
- **Collaborative filtering:** "similar users" = people who liked the same posts as you — their likes boost posts you haven't seen
- **Two feed modes:** "Following" (chronological, cursor-paginated) + "For You" (ranked, page-paginated)
- **"Why am I seeing this" badges:** "Popular in your network" / "People with similar taste liked this" / "Trending right now"

## Day 7 mein kya bana (Production Ready)

### Edge Cases
- **Block/Unblock system:** `POST/DELETE /api/follows/:userId/block` — blocks table, bidirectional blocking, auto-unfollow on block
- **Blocked users filtered:** all feeds (following, for-you, discover), suggestions, followers/following lists, user directory — blocked users ka content kahin nahi dikhta
- **Deleted posts/users:** CASCADE delete handles orphaned data automatically

### Performance
- **New database indexes:** `idx_comments_post`, `idx_comments_user`, `idx_blocks_blocker`, `idx_blocks_blocked`
- **Existing indexes maintained:** `idx_posts_user`, `idx_posts_created`, `idx_follows_follower`, `idx_follows_following`, `idx_likes_post`

### Accessibility (WCAG basics)
- **Skip-to-content link:** keyboard users can bypass navigation
- **ARIA labels:** all interactive elements (buttons, forms, panels, feed sections)
- **Roles:** `role="tablist"`, `role="tab"`, `role="dialog"`, `role="alert"`, `role="status"`, `role="list"`, `role="listitem"`, `role="region"`
- **`aria-live` regions:** char counter, posts list, comments — screen readers announce changes
- **`aria-expanded`:** comment toggle buttons track open/closed state
- **`aria-required`:** all auth form inputs marked required
- **Alt text:** all post images have descriptive alt text, decorative avatars marked `aria-hidden`
- **Focus-visible:** consistent 2px iris outline on all focusable elements
- **`prefers-reduced-motion`:** animations disabled for users who prefer reduced motion

### UI Polish
- **Responsive breakpoints:** mobile (≤600px), tablet (601–900px), desktop (>900px)
- **Mobile-specific:** smaller padding, reduced font sizes, full-width people panel, hidden composer avatar, hidden comment avatars
- **Consistent states:** all loading/empty/error states use `role="status"` or `role="alert"`, consistent padding and styling
- **Error styling:** feed errors now have subtle red background/border for visibility

### Deployment Configs
- **Render:** `backend/render.yaml` — free tier, auto-generates JWT_SECRET, Node.js runtime
- **Vercel:** `vercel.json` — serves frontend as static files
- **Netlify:** `netlify.toml` — SPA redirect config, static file serving
- **Production mode:** `NODE_ENV=production` serves frontend from Express (single deployment)
- **Dynamic API_BASE:** frontend auto-detects production vs development backend URL

## Setup

1. Zip extract karo, poora `pulse-social-app` folder VS Code mein `File → Open Folder` se kholo.
2. VS Code niche-right corner mein recommended extensions (Live Server, ESLint, Prettier, REST Client) install karne ka prompt dega — "Install All" daba do.
3. Terminal kholo (`` Ctrl+` ``) aur neeche diye steps follow karo.

## Chalane ka tareeqa

**1. Backend start karo:**

```bash
cd backend
npm install
npm start
```

Server `http://localhost:5000` par chalega. Test: `http://localhost:5000/api/health`

Debugger se chalana ho to VS Code ke **Run and Debug** panel (`Ctrl+Shift+D`) mein "Run Backend (server.js)" select karke ▶️ dabao — breakpoints lag sakte hain.

**2. Frontend kholo:**

`frontend/index.html` par right-click → **"Open with Live Server"** (ya seedha double-click karke browser mein kholo). Ye `http://localhost:5000/api/...` par calls karega — backend chalu hona chahiye.

Login/signup ke baad welcome screen par **"View your feed →"** dabao — feed page khulega jahan post bana sakte ho, feed dekh sakte ho, apne posts edit/delete kar sakte ho.

**3. APIs test karne ke liye:**

`backend/requests.http` file kholo (REST Client extension ke saath) — har request ke upar "Send Request" link dikhega, seedha VS Code se hi signup/login/posts test kar sakte ho. (Image upload multipart hone ki wajah se REST Client se theek se test nahi hota — curl ka example `requests.http` ke end mein hai, ya seedha frontend se try karo.)

## Deploy (Production)

**Option A: Single deployment (backend serves frontend)**
1. Push repo to GitHub
2. Deploy backend on Render (uses `render.yaml`)
3. Set `NODE_ENV=production` in Render environment
4. Frontend is served by Express automatically

**Option B: Separate deployments**
1. Deploy backend on Render/Railway
2. Deploy frontend on Vercel/Netlify (uses `vercel.json` or `netlify.toml`)
3. Set `API_BASE` in frontend to your backend URL (currently auto-detected)

## API endpoints

| Method | Route                | Kaam                                        |
|--------|-----------------------|----------------------------------------------|
| POST   | `/api/auth/signup`    | Naya account banao                          |
| POST   | `/api/auth/login`     | Login (username ya email se)                |
| GET    | `/api/auth/me`        | Current logged-in user check                |
| GET    | `/api/health`         | Server zinda hai ya nahi                    |
| GET    | `/api/posts`          | Posts list, paginated (`page`, `limit`)     |
| GET    | `/api/posts/feed`     | Following feed (cursor-paginated)           |
| GET    | `/api/posts/for-you`  | Ranked feed (page-paginated)                |
| GET    | `/api/posts/:id`      | Ek post ki detail                            |
| POST   | `/api/posts`          | Naya post banao (text + optional image)     |
| PUT    | `/api/posts/:id`      | Apna post edit karo                          |
| DELETE | `/api/posts/:id`      | Apna post delete karo (image bhi cleanup)   |
| POST   | `/api/follows/:userId`          | Kisi user ko follow karo                          |
| DELETE | `/api/follows/:userId`          | Unfollow karo                                     |
| POST   | `/api/follows/:userId/block`    | Kisi user ko block karo (auto-unfollow)           |
| DELETE | `/api/follows/:userId/block`    | Block hatao                                        |
| GET    | `/api/follows/:userId/followers`| Followers list, paginated                         |
| GET    | `/api/follows/:userId/following`| Following list, paginated                         |
| GET    | `/api/follows/following-ids`    | Current user jinko follow karta hai unki ids     |
| GET    | `/api/follows/suggestions`      | Follow suggestions (mutual → newest fallback)    |
| GET    | `/api/users`                    | Sab users ki directory, paginated (Discover)     |
| GET    | `/api/users/:id`                | Public profile + followers/following count      |
| POST   | `/api/posts/:id/like`           | Post like karo (already-liked par 409)           |
| DELETE | `/api/posts/:id/like`           | Post unlike karo (na-liked par 404)              |
| GET    | `/api/posts/:id/comments`       | Comments list, paginated, oldest first           |
| POST   | `/api/posts/:id/comments`       | Comment add karo (max 300 chars)                 |
| DELETE | `/api/posts/:id/comments/:cid`  | Apna comment delete karo (owner-only)            |

## 7-Day Roadmap

1. ✅ **Setup & Auth** — schema, signup/login, auth UI
2. ✅ **Posts Module** — create/edit/delete post, image upload, feed list UI
3. ✅ **Follow System** — follow/unfollow, followers/following list, suggestions
4. ✅ **Likes & Engagement** — like/unlike, comments, engagement tracking
5. ✅ **Basic Feed** — chronological feed from followed users, infinite scroll
6. ✅ **Ranking Algorithm** — score-based feed (likes + recency + engagement decay), collaborative filtering
7. ✅ **Polish, Testing & Deploy** — blocks, accessibility, responsive, deployment configs

## Notes

- `app.db` khud ban jayegi jab pehli baar server start hoga — koi manual DB setup nahi chahiye.
- Uploaded images `backend/uploads/` mein save hoti hain — ye folder bhi khud ban jata hai, aur `.gitignore` mein hai (commit nahi hogi).
- `JWT_SECRET` production mein `.env` file se set karo (`backend/.env` → `JWT_SECRET=your_secret_here`), abhi ek dev default set hai.
