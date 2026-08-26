// Shared shape for sending a users row to the client — keeps auth.js,
// follows.js and users.js all returning identical user objects.
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarSeed: row.avatar_seed,
    createdAt: row.created_at,
  };
}

module.exports = { publicUser };
