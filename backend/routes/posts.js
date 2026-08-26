const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { blockedIds } = require("./follows");

const router = express.Router();

const MAX_CONTENT_LENGTH = 500;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- image upload (multer) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error("INVALID_IMAGE_TYPE"));
    }
    cb(null, true);
  },
});

// Wraps multer so upload errors come back as clean JSON instead of Express's default HTML error page.
function handleImageUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image must be 5MB or smaller." });
    }
    if (err.message === "INVALID_IMAGE_TYPE") {
      return res.status(400).json({ error: "Only JPEG, PNG, GIF or WEBP images are allowed." });
    }
    return res.status(400).json({ error: "Image upload failed." });
  });
}

function cleanupUploadedFile(file) {
  if (file) fs.unlink(file.path, () => {}); // best-effort, ignore errors
}

function deleteImageIfAny(imageUrl) {
  if (!imageUrl) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(imageUrl));
  fs.unlink(filePath, () => {}); // best-effort, ignore errors
}

const SELECT_WITH_AUTHOR = `
  SELECT posts.*, users.username, users.display_name, users.avatar_seed,
    (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
  FROM posts
  JOIN users ON users.id = posts.user_id
`;

// Day 4: likeCount/commentCount come straight off the row (cheap subqueries in
// the SELECT above). likedByMe is passed in separately since it's viewer-specific.
function publicPost(row, likedByMe = false) {
  return {
    id: row.id,
    content: row.content,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarSeed: row.avatar_seed,
    },
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe,
  };
}

// Given a list of post rows and the viewer's id, returns a Set of post ids
// the viewer has liked — one query instead of one-per-post.
function likedPostIdSet(rows, viewerId) {
  if (!viewerId || rows.length === 0) return new Set();
  const placeholders = rows.map(() => "?").join(",");
  const liked = db
    .prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})`)
    .all(viewerId, ...rows.map((r) => r.id));
  return new Set(liked.map((r) => r.post_id));
}

// ---------- Day 5: cursor helpers for the following-feed ----------
// Cursor encodes the last row seen: "<created_at>|<id>". Using (created_at, id)
// instead of an OFFSET means deleting a post that was already scrolled past
// can never shift a later page and cause a skipped/duplicated post.
function encodeCursor(row) {
  return Buffer.from(`${row.created_at}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep === -1) return null;
    const createdAt = decoded.slice(0, sep);
    const id = parseInt(decoded.slice(sep + 1), 10);
    if (!createdAt || !Number.isInteger(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

const FEED_SELECT = `
  SELECT posts.*, users.username, users.display_name, users.avatar_seed,
    (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count
  FROM posts
  JOIN users ON users.id = posts.user_id
  WHERE posts.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
`;

// GET /api/posts/feed?cursor=&limit= — posts from people the caller follows,
// newest first, cursor-paginated. Empty result is disambiguated for the
// frontend via followingCount (0 => "follow someone" empty state, >0 =>
// "no posts yet from people you follow" empty state).
// Day 7: also filters out posts from blocked users.
router.get("/feed", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  let cursor = null;
  if (req.query.cursor) {
    cursor = decodeCursor(req.query.cursor);
    if (!cursor) return res.status(400).json({ error: "Invalid cursor." });
  }

  const blockedSet = blockedIds(req.userId);
  const blockedArr = [...blockedSet];

  let rows;
  if (blockedArr.length > 0) {
    const blockPh = blockedArr.map(() => "?").join(",");
    const feedBlockedSelect = `
      ${FEED_SELECT}
      AND posts.user_id NOT IN (${blockPh})
    `;
    rows = cursor
      ? db
          .prepare(
            `${feedBlockedSelect} AND (posts.created_at < ? OR (posts.created_at = ? AND posts.id < ?))
             ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`
          )
          .all(req.userId, ...blockedArr, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : db
          .prepare(`${feedBlockedSelect} ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`)
          .all(req.userId, ...blockedArr, limit + 1);
  } else {
    rows = cursor
      ? db
          .prepare(
            `${FEED_SELECT} AND (posts.created_at < ? OR (posts.created_at = ? AND posts.id < ?))
             ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`
          )
          .all(req.userId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : db
          .prepare(`${FEED_SELECT} ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`)
          .all(req.userId, limit + 1);
  }

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const likedSet = likedPostIdSet(pageRows, req.userId);
  const posts = pageRows.map((row) => publicPost(row, likedSet.has(row.id)));
  const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  const followingCount = db
    .prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?")
    .get(req.userId).n;

  res.json({ posts, hasMore, nextCursor, followingCount });
});

// ---------- Day 6: "For You" ranked feed ----------
// score = likes_weight*likes + comments_weight*comments + recency_weight*recencyScore
// (+ a follow boost and a collaborative-filtering "social signal" boost, see below)
const RANK_WEIGHTS = { likes: 1, comments: 1.5, recency: 40 };
const RECENCY_HALF_LIFE_HOURS = 30; // recency contribution halves every 30h (exponential decay)
const FOLLOW_BOOST = 15; // nudges posts from people you follow above similarly-scored strangers
const SOCIAL_SIGNAL_WEIGHT = 3; // per "similar user" who also liked this post
const CANDIDATE_POOL_SIZE = 300; // rank among the N newest platform posts, not the whole table —
// posts past this age have decayed toward ~0 anyway, so this bounds the ranking cost cheaply

// Exponential decay: brand-new post -> 1.0, one half-life old -> 0.5, two -> 0.25, etc.
function recencyScore(createdAtSqlite) {
  const createdMs = new Date(createdAtSqlite.replace(" ", "T") + "Z").getTime();
  const hoursAgo = Math.max(0, (Date.now() - createdMs) / 3600000);
  return Math.pow(0.5, hoursAgo / RECENCY_HALF_LIFE_HOURS);
}

function baseRankScore(row) {
  return (
    RANK_WEIGHTS.likes * row.like_count +
    RANK_WEIGHTS.comments * row.comment_count +
    RANK_WEIGHTS.recency * recencyScore(row.created_at)
  );
}

// Basic collaborative filtering: "similar users" are people who've liked at
// least one post the viewer has also liked. Posts they like get a boost even
// if the viewer doesn't follow the author — this is what surfaces
// "posts you might like" from outside the viewer's network.
function similarUserIds(viewerId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT l2.user_id AS id
       FROM likes l1
       JOIN likes l2 ON l2.post_id = l1.post_id AND l2.user_id != l1.user_id
       WHERE l1.user_id = ?`
    )
    .all(viewerId);
  return rows.map((r) => r.id);
}

// How many "similar users" liked each candidate post — one grouped query
// instead of one query per post.
function socialSignalByPostId(postIds, similarIds) {
  const map = new Map();
  if (postIds.length === 0 || similarIds.length === 0) return map;
  const postPh = postIds.map(() => "?").join(",");
  const userPh = similarIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT post_id, COUNT(*) AS n FROM likes
       WHERE post_id IN (${postPh}) AND user_id IN (${userPh})
       GROUP BY post_id`
    )
    .all(...postIds, ...similarIds);
  rows.forEach((r) => map.set(r.post_id, r.n));
  return map;
}

// Subtle "why am I seeing this" indicator for the frontend.
function reasonFor(isFollowing, socialSignal) {
  if (isFollowing) return { code: "in_network", label: "Popular in your network" };
  if (socialSignal > 0) return { code: "similar_likes", label: "People with similar taste liked this" };
  return { code: "trending", label: "Trending right now" };
}

// GET /api/posts/for-you?page=&limit= — ranked feed (not just who you
// follow). Offset/page-paginated rather than cursor-paginated like the
// chronological feed: score is a moving target as posts age, so a stable
// cursor doesn't make sense here the way (created_at, id) does above.
router.get("/for-you", requireAuth, (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const followingIds = new Set(
    db
      .prepare("SELECT following_id FROM follows WHERE follower_id = ?")
      .all(req.userId)
      .map((r) => r.following_id)
  );
  const similarIds = similarUserIds(req.userId);

  // Day 7: filter out blocked users' posts
  const blockedSet = blockedIds(req.userId);
  let candidates;
  if (blockedSet.size > 0) {
    const blockArr = [...blockedSet];
    const blockPh = blockArr.map(() => "?").join(",");
    candidates = db
      .prepare(
        `${SELECT_WITH_AUTHOR} WHERE posts.user_id != ? AND posts.user_id NOT IN (${blockPh})
         ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`
      )
      .all(req.userId, ...blockArr, CANDIDATE_POOL_SIZE);
  } else {
    candidates = db
      .prepare(
        `${SELECT_WITH_AUTHOR} WHERE posts.user_id != ?
         ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`
      )
      .all(req.userId, CANDIDATE_POOL_SIZE);
  }

  const signalMap = socialSignalByPostId(candidates.map((c) => c.id), similarIds);

  const ranked = candidates
    .map((row) => {
      const isFollowing = followingIds.has(row.user_id);
      const socialSignal = signalMap.get(row.id) || 0;
      const score =
        baseRankScore(row) +
        (isFollowing ? FOLLOW_BOOST : 0) +
        socialSignal * SOCIAL_SIGNAL_WEIGHT;
      return { row, isFollowing, socialSignal, score };
    })
    .sort((a, b) => b.score - a.score || b.row.id - a.row.id);

  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);
  const likedSet = likedPostIdSet(pageItems.map((item) => item.row), req.userId);

  const posts = pageItems.map(({ row, isFollowing, socialSignal }) => {
    const post = publicPost(row, likedSet.has(row.id));
    post.reason = reasonFor(isFollowing, socialSignal);
    return post;
  });

  const hasMore = start + limit < ranked.length;
  res.json({ posts, hasMore, nextPage: hasMore ? page + 1 : null, mode: "for-you" });
});

// GET /api/posts?page=1&limit=10 — paginated list, newest first (all posts;
// used for the Discover panel, not the home feed)
// Day 7: filters out blocked users' posts
router.get("/", optionalAuth, (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = (page - 1) * limit;

  const blockedSet = blockedIds(req.userId);
  let rows;

  if (blockedSet.size > 0) {
    const blockArr = [...blockedSet];
    const blockPh = blockArr.map(() => "?").join(",");
    rows = db
      .prepare(
        `${SELECT_WITH_AUTHOR} WHERE posts.user_id NOT IN (${blockPh})
         ORDER BY posts.created_at DESC, posts.id DESC LIMIT ? OFFSET ?`
      )
      .all(...blockArr, limit + 1, offset);
  } else {
    rows = db
      .prepare(`${SELECT_WITH_AUTHOR} ORDER BY posts.created_at DESC, posts.id DESC LIMIT ? OFFSET ?`)
      .all(limit + 1, offset);
  }

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const likedSet = likedPostIdSet(pageRows, req.userId);
  const posts = pageRows.map((row) => publicPost(row, likedSet.has(row.id)));

  res.json({ posts, page, limit, hasMore });
});

// GET /api/posts/:id — single post detail
router.get("/:id", optionalAuth, (req, res) => {
  const row = db.prepare(`${SELECT_WITH_AUTHOR} WHERE posts.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Post not found." });

  const likedByMe = req.userId
    ? !!db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(row.id, req.userId)
    : false;

  res.json({ post: publicPost(row, likedByMe) });
});

// POST /api/posts — create (text + optional image)
router.post("/", requireAuth, handleImageUpload, (req, res) => {
  const content = (req.body?.content || "").trim();

  if (!content) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: "Post can't be empty." });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: `Posts can't be longer than ${MAX_CONTENT_LENGTH} characters.` });
  }

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const info = db
    .prepare("INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)")
    .run(req.userId, content, imageUrl);

  const row = db.prepare(`${SELECT_WITH_AUTHOR} WHERE posts.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ post: publicPost(row, false) });
});

// PUT /api/posts/:id — edit (owner only, content only)
router.put("/:id", requireAuth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  if (post.user_id !== req.userId) {
    return res.status(403).json({ error: "You can only edit your own posts." });
  }

  const content = (req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "Post can't be empty." });
  if (content.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `Posts can't be longer than ${MAX_CONTENT_LENGTH} characters.` });
  }

  db.prepare("UPDATE posts SET content = ? WHERE id = ?").run(content, post.id);

  const updated = db.prepare(`${SELECT_WITH_AUTHOR} WHERE posts.id = ?`).get(post.id);
  const likedByMe = !!db.prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?").get(post.id, req.userId);
  res.json({ post: publicPost(updated, likedByMe) });
});

// DELETE /api/posts/:id — delete (owner only, cleans up image file)
router.delete("/:id", requireAuth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  if (post.user_id !== req.userId) {
    return res.status(403).json({ error: "You can only delete your own posts." });
  }

  db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
  deleteImageIfAny(post.image_url);

  res.json({ success: true });
});

module.exports = router;
