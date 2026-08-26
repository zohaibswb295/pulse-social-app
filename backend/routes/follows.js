const express = require("express");
const db = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { publicUser } = require("../publicUser");

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

function parseUserId(raw) {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function userExists(id) {
  return !!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id);
}

function isFollowing(followerId, followingId) {
  if (!followerId) return false;
  return !!db
    .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?")
    .get(followerId, followingId);
}

function followCounts(userId) {
  const followers = db
    .prepare("SELECT COUNT(*) AS n FROM follows WHERE following_id = ?")
    .get(userId).n;
  const following = db
    .prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?")
    .get(userId).n;
  return { followers, following };
}

// Day 7: Check if user A has blocked user B or vice versa
function isBlocked(userIdA, userIdB) {
  if (!userIdA || !userIdB) return false;
  return !!db
    .prepare("SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)")
    .get(userIdA, userIdB, userIdB, userIdA);
}

// Day 7: Get set of user IDs that are blocked by or have blocked the given user
function blockedIds(userId) {
  if (!userId) return new Set();
  const rows = db
    .prepare(
      `SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
       UNION
       SELECT blocker_id AS id FROM blocks WHERE blocked_id = ?`
    )
    .all(userId, userId);
  return new Set(rows.map((r) => r.id));
}

module.exports = { isBlocked, blockedIds };

// ---------- POST /api/follows/:userId — follow a user ----------
router.post("/:userId", requireAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });

  if (targetId === req.userId) {
    return res.status(400).json({ error: "You can't follow yourself." });
  }
  if (!userExists(targetId)) {
    return res.status(404).json({ error: "User not found." });
  }
  if (isBlocked(req.userId, targetId)) {
    return res.status(404).json({ error: "User not found." });
  }
  if (isFollowing(req.userId, targetId)) {
    return res.status(409).json({ error: "You're already following this user." });
  }

  db.prepare("INSERT INTO follows (follower_id, following_id) VALUES (?, ?)").run(
    req.userId,
    targetId
  );

  res.status(201).json({ following: true, counts: followCounts(targetId) });
});

// ---------- DELETE /api/follows/:userId — unfollow a user ----------
router.delete("/:userId", requireAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });

  const info = db
    .prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?")
    .run(req.userId, targetId);

  if (info.changes === 0) {
    return res.status(404).json({ error: "You're not following this user." });
  }

  res.json({ following: false, counts: followCounts(targetId) });
});

// ---------- Day 7: Block / Unblock ----------

// POST /api/follows/:userId/block — block a user (also unfollows)
router.post("/:userId/block", requireAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });
  if (targetId === req.userId) return res.status(400).json({ error: "You can't block yourself." });
  if (!userExists(targetId)) return res.status(404).json({ error: "User not found." });

  const existing = db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(req.userId, targetId);
  if (existing) return res.status(409).json({ error: "Already blocked." });

  db.prepare("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run(req.userId, targetId);
  // Also remove any follow relationship in both directions
  db.prepare("DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)")
    .run(req.userId, targetId, targetId, req.userId);

  res.json({ blocked: true });
});

// DELETE /api/follows/:userId/block — unblock a user
router.delete("/:userId/block", requireAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });

  const info = db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(req.userId, targetId);
  if (info.changes === 0) return res.status(404).json({ error: "User is not blocked." });

  res.json({ blocked: false });
});

// ---------- GET /api/follows/following-ids — ids the current user follows ----------
// Lightweight lookup the frontend uses once after login to render correct
// follow/unfollow button state everywhere without a round trip per card.
router.get("/following-ids", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT following_id FROM follows WHERE follower_id = ?").all(req.userId);
  res.json({ ids: rows.map((r) => r.following_id) });
});

// ---------- GET /api/follows/suggestions?limit=10 ----------
// Mutual-connections first (people followed by people you follow), falling
// back to the newest users on the platform to fill out the list.
// Day 7: excludes blocked users.
router.get("/suggestions", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 20);
  const blockedSet = blockedIds(req.userId);
  const blockedArr = [...blockedSet];

  const mutualRows = blockedArr.length > 0
    ? db
        .prepare(
          `
          SELECT u.*, COUNT(*) AS mutual_count
          FROM follows f1
          JOIN follows f2 ON f2.follower_id = f1.following_id
          JOIN users u ON u.id = f2.following_id
          WHERE f1.follower_id = ?
            AND f2.following_id != ?
            AND f2.following_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
            AND f2.following_id NOT IN (${blockedArr.map(() => "?").join(",")})
          GROUP BY u.id
          ORDER BY mutual_count DESC, u.created_at DESC
          LIMIT ?
          `
        )
        .all(req.userId, req.userId, req.userId, ...blockedArr, limit)
    : db
        .prepare(
          `
          SELECT u.*, COUNT(*) AS mutual_count
          FROM follows f1
          JOIN follows f2 ON f2.follower_id = f1.following_id
          JOIN users u ON u.id = f2.following_id
          WHERE f1.follower_id = ?
            AND f2.following_id != ?
            AND f2.following_id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
          GROUP BY u.id
          ORDER BY mutual_count DESC, u.created_at DESC
          LIMIT ?
          `
        )
        .all(req.userId, req.userId, req.userId, limit);

  const suggestions = mutualRows.map((row) => ({
    ...publicUser(row),
    mutualCount: row.mutual_count,
    reason: "mutual",
  }));

  const remaining = limit - suggestions.length;
  if (remaining > 0) {
    const excludeIds = [req.userId, ...suggestions.map((s) => s.id), ...blockedArr];
    const placeholders = excludeIds.map(() => "?").join(",");

    const fallbackRows = db
      .prepare(
        `
        SELECT u.* FROM users u
        WHERE u.id NOT IN (${placeholders})
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY u.created_at DESC
        LIMIT ?
        `
      )
      .all(...excludeIds, req.userId, remaining);

    fallbackRows.forEach((row) => {
      suggestions.push({ ...publicUser(row), mutualCount: 0, reason: "new" });
    });
  }

  res.json({ suggestions });
});

// ---------- GET /api/follows/:userId/followers — paginated ----------
// Day 7: filters out blocked users from the list
router.get("/:userId/followers", optionalAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });
  if (!userExists(targetId)) return res.status(404).json({ error: "User not found." });

  const { page, limit, offset } = parsePagination(req.query);
  const blockedSet = blockedIds(req.userId);

  let rows;
  if (blockedSet.size > 0) {
    const blockArr = [...blockedSet];
    const blockPh = blockArr.map(() => "?").join(",");
    rows = db
      .prepare(
        `
        SELECT users.* FROM follows
        JOIN users ON users.id = follows.follower_id
        WHERE follows.following_id = ?
          AND users.id NOT IN (${blockPh})
        ORDER BY follows.created_at DESC, users.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(targetId, ...blockArr, limit + 1, offset);
  } else {
    rows = db
      .prepare(
        `
        SELECT users.* FROM follows
        JOIN users ON users.id = follows.follower_id
        WHERE follows.following_id = ?
        ORDER BY follows.created_at DESC, users.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(targetId, limit + 1, offset);
  }

  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit).map((row) => ({
    ...publicUser(row),
    isFollowing: isFollowing(req.userId, row.id),
  }));

  res.json({ users, page, limit, hasMore });
});

// ---------- GET /api/follows/:userId/following — paginated ----------
// Day 7: filters out blocked users from the list
router.get("/:userId/following", optionalAuth, (req, res) => {
  const targetId = parseUserId(req.params.userId);
  if (!targetId) return res.status(400).json({ error: "Invalid user id." });
  if (!userExists(targetId)) return res.status(404).json({ error: "User not found." });

  const { page, limit, offset } = parsePagination(req.query);
  const blockedSet = blockedIds(req.userId);

  let rows;
  if (blockedSet.size > 0) {
    const blockArr = [...blockedSet];
    const blockPh = blockArr.map(() => "?").join(",");
    rows = db
      .prepare(
        `
        SELECT users.* FROM follows
        JOIN users ON users.id = follows.following_id
        WHERE follows.follower_id = ?
          AND users.id NOT IN (${blockPh})
        ORDER BY follows.created_at DESC, users.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(targetId, ...blockArr, limit + 1, offset);
  } else {
    rows = db
      .prepare(
        `
        SELECT users.* FROM follows
        JOIN users ON users.id = follows.following_id
        WHERE follows.follower_id = ?
        ORDER BY follows.created_at DESC, users.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(targetId, limit + 1, offset);
  }

  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit).map((row) => ({
    ...publicUser(row),
    isFollowing: isFollowing(req.userId, row.id),
  }));

  res.json({ users, page, limit, hasMore });
});

module.exports = router;
