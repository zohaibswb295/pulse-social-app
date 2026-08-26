const express = require("express");
const db = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");

const router = express.Router();

const MAX_COMMENT_LENGTH = 300;

function assertPostExists(postId, res) {
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) {
    res.status(404).json({ error: "This post doesn't exist anymore." });
    return false;
  }
  return true;
}

function likeCountFor(postId) {
  return db.prepare("SELECT COUNT(*) AS n FROM likes WHERE post_id = ?").get(postId).n;
}

function commentCountFor(postId) {
  return db.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ?").get(postId).n;
}

// ---------- Likes ----------

// POST /api/posts/:id/like — like a post (duplicate likes rejected with 409)
router.post("/:id/like", requireAuth, (req, res) => {
  if (!assertPostExists(req.params.id, res)) return;

  const already = db
    .prepare("SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  if (already) return res.status(409).json({ error: "You already liked this post." });

  db.prepare("INSERT INTO likes (post_id, user_id) VALUES (?, ?)").run(req.params.id, req.userId);
  res.status(201).json({ liked: true, likeCount: likeCountFor(req.params.id) });
});

// DELETE /api/posts/:id/like — unlike a post
router.delete("/:id/like", requireAuth, (req, res) => {
  if (!assertPostExists(req.params.id, res)) return;

  const info = db
    .prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: "You haven't liked this post." });

  res.json({ liked: false, likeCount: likeCountFor(req.params.id) });
});

// ---------- Comments ----------

// GET /api/posts/:id/comments?page=&limit= — oldest first (thread order), paginated
router.get("/:id/comments", optionalAuth, (req, res) => {
  if (!assertPostExists(req.params.id, res)) return;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = (page - 1) * limit;

  // Fetch one extra row to know if another page exists, same trick as posts.js.
  const rows = db
    .prepare(
      `SELECT comments.*, users.username, users.display_name, users.avatar_seed
       FROM comments
       JOIN users ON users.id = comments.user_id
       WHERE comments.post_id = ?
       ORDER BY comments.created_at ASC, comments.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(req.params.id, limit + 1, offset);

  const hasMore = rows.length > limit;
  const comments = rows.slice(0, limit).map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.created_at,
    isOwner: req.userId === r.user_id,
    author: {
      id: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarSeed: r.avatar_seed,
    },
  }));

  res.json({ comments, page, limit, hasMore, commentCount: commentCountFor(req.params.id) });
});

// POST /api/posts/:id/comments — add a comment
router.post("/:id/comments", requireAuth, (req, res) => {
  if (!assertPostExists(req.params.id, res)) return;

  const content = (req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "Comment can't be empty." });
  if (content.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Comments can't be longer than ${MAX_COMMENT_LENGTH} characters.` });
  }

  const info = db
    .prepare("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)")
    .run(req.params.id, req.userId, content);

  const row = db
    .prepare(
      `SELECT comments.*, users.username, users.display_name, users.avatar_seed
       FROM comments
       JOIN users ON users.id = comments.user_id
       WHERE comments.id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json({
    comment: {
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      isOwner: true,
      author: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarSeed: row.avatar_seed,
      },
    },
    commentCount: commentCountFor(req.params.id),
  });
});

// DELETE /api/posts/:postId/comments/:commentId — owner only
router.delete("/:postId/comments/:commentId", requireAuth, (req, res) => {
  const comment = db
    .prepare("SELECT * FROM comments WHERE id = ? AND post_id = ?")
    .get(req.params.commentId, req.params.postId);
  if (!comment) return res.status(404).json({ error: "Comment not found." });
  if (comment.user_id !== req.userId) {
    return res.status(403).json({ error: "You can only delete your own comments." });
  }

  db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.commentId);
  res.json({ success: true, commentCount: commentCountFor(req.params.postId) });
});

module.exports = router;
