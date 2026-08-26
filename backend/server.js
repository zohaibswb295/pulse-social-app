require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const postsRoutes = require("./routes/posts");
const engagementRoutes = require("./routes/engagement");
const followsRoutes = require("./routes/follows");
const usersRoutes = require("./routes/users");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serves uploaded post images, e.g. GET /uploads/172839-abc123.jpg
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", day: 7, feature: "production-ready with blocks, accessibility, deployment" });
});

app.use("/api/auth", authRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/posts", engagementRoutes);
app.use("/api/follows", followsRoutes);
app.use("/api/users", usersRoutes);

// Day 7: In production, serve the frontend as static files
if (process.env.NODE_ENV === "production") {
  const frontendPath = path.join(__dirname, "..", "frontend");
  app.use(express.static(frontendPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });
} else {
  app.use((req, res) => {
    res.status(404).json({ error: "Route not found." });
  });
}

app.listen(PORT, () => {
  console.log(`Pulse backend running on port ${PORT}`);
});
