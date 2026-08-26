const express = require("express");
const db = require("../db");
const { optionalAuth } = require("../middleware/auth");
const { publicUser } = require("../publicUser");
const { blockedIds } = require("./follows");

const router = express.Router();

// GET /api/users?page=&limit= — directory of all users (excluding self and blocked), paginated.
// This is the "browse everyone" list the frontend uses so there's always a way
// to find people to follow, independent of posts/suggestions being empty.
router.get("/", optionalAuth, (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = (page - 1) * limit;
  const selfId = req.userId || 0;

  // Day 7: exclude blocked users
  const blockedSet = blockedIds(req.userId);
  const excludeIds = [selfId, ...blockedSet];

  const placeholders = excludeIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT * FROM users
      WHERE id NOT IN (${placeholders})
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...excludeIds, limit + 1, offset);

  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit).map((row) => ({
    ...publicUser(row),
    isFollowing: req.userId
      ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?").get(req.userId, row.id)
      : false,
  }));

  res.json({ users, page, limit, hasMore });
});

// GET /api/users/:id — public profile + follow counts (+ isFollowing if signed in)
// Day 7: returns 404 for blocked users
router.get("/:id", optionalAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid user id." });

  // Day 7: hide blocked users' profiles
  if (req.userId) {
    const blockedSet = blockedIds(req.userId);
    if (blockedSet.has(id)) return res.status(404).json({ error: "User not found." });
  }

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "User not found." });

  const followers = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE following_id = ?").get(id).n;
  const following = db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?").get(id).n;
  const isFollowing = req.userId
    ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?").get(req.userId, id)
    : false;

  res.json({
    user: publicUser(row),
    followersCount: followers,
    followingCount: following,
    isFollowing,
  });
});

module.exports = router;
