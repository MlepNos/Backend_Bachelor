import { getPool } from "./db.js";

// find the latest conversation with this title or create a new one
export async function getOrCreateConversation(sessionTitle = "Untitled") {
  const db = getPool();
  console.log("🔍 Checking for existing conversation:", sessionTitle);

  // Try to find an existing one
  const res = await db.query(
    `SELECT Id FROM Conversations WHERE Title = $1 ORDER BY CreatedAt DESC LIMIT 1`,
    [sessionTitle]
  );
  if (res.rows.length > 0) {
    console.log("🟢 Found existing conversation:", res.rows[0].id);
    return res.rows[0].id;
  }

  console.log("🆕 Creating new conversation...");

  // Create new conversation
  const newConv = await db.query(
    `INSERT INTO Conversations (Title, CreatedAt) VALUES ($1, NOW()) RETURNING Id`,
    [sessionTitle]
  );
    console.log("✅ Created conversation ID:", newConv.rows[0].id);

  return newConv.rows[0].id;
}
// fetch chat history (oldest first), normalized for LLMs
export async function getConversationLog(conversationId) {
  const db = getPool();
  const res = await db.query(
    `SELECT Role, Content FROM Messages
     WHERE ConversationId = $1
     ORDER BY Timestamp ASC`,
    [conversationId]
  );
  return res.rows.map(r => ({ role: r.role.toLowerCase(), message: r.content }));
}
// append one message to a conversation
export async function saveMessage(conversationId, role, message) {
  const db = getPool();
  await db.query(
    `INSERT INTO Messages (ConversationId, Role, Content, Timestamp)
     VALUES ($1, $2, $3, NOW())`,
    [conversationId, role, message]
  );
}
