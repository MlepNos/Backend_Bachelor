// --- dependencies ---
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import sql from "mssql";
import multer from "multer";
import fs from "fs";
import { initDb, getPool, getDbType } from "./db.js";

// --- config ---
dotenv.config();
const app = express();
const port = 3003;
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// --- MSSQL ---
const config = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  server: process.env.MSSQL_SERVER,
  database: process.env.MSSQL_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

let pool;
sql.connect(config)
  .then((connectedPool) => {
    pool = connectedPool;
    console.log("✅ Connected to MSSQL");
  })
  .catch((err) => console.error("❌ DB Connection Error:", err));

let pdfContext = "";

// --- PDF Upload ---
app.post("/api/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    pdfContext = data.text;
    fs.unlinkSync(filePath);
    res.json({ message: "PDF uploaded and parsed successfully." });
  } catch (err) {
    console.error("❌ PDF Upload Error:", err);
    res.status(500).json({ message: "Failed to parse PDF." });
  }
});

// --- Chat with Ollama ---
app.post("/api/chat", async (req, res) => {
  const messages = req.body.messages;

  try {
    const memoryResult = await pool.request().query("SELECT [Key], Value FROM Memory");
    const memoryInstructions = memoryResult.recordset.map(
      (item) => `Memory: ${item.Key.replace(/_/g, " ")} is ${item.Value}`
    );

    const fullPrompt = [
  { role: "system", content: "." },
  { role: "system", content: memoryInstructions.join("\n") },
  { role: "system", content: pdfContext.slice(0, 1500) || "No PDF uploaded yet." },
  ...messages,
];

    const prompt = [
      {
        role: "system",
        content: `
        You are a helpful and conversational assistant. When the user shares factual information about themselves (e.g. "I live in Berlin", "My favorite color is blue"), you should:
        
        1. Respond naturally, like a real person would.
        2. Quietly add the new facts (if any) inside a hidden section marked by <!--memory--> and <!--end-->.
        
        🧠 The memory section should contain only new facts in this format:
        
        Key: Value
        
        Example:
        Name: Kaan
        Location: Berlin
        Occupation: Engineer
        
        NEVER show or mention this memory section to the user. It’s only for the system to parse.
        `
        
        
,
      },
      { role: "system", content: memoryInstructions.join("\n") },
      { role: "system", content: pdfContext.slice(0, 1500) || "No PDF uploaded yet." },
      ...messages,
    ];

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3:8b",
        messages: prompt,
        stream: false,
      }),
    });

    const text = await response.text();
    const data = JSON.parse(text);
    const reply = data.message.content;

    const result = await pool
      .request()
      .input("Title", sql.NVarChar, "PDF Chat Session")
      .input("CreatedAt", sql.DateTime, new Date())
      .query("INSERT INTO Conversations (Title, CreatedAt) OUTPUT INSERTED.Id VALUES (@Title, @CreatedAt)");

    const conversationId = result.recordset[0].Id;

    // Save user messages
    for (const msg of messages) {
      await pool
        .request()
        .input("ConversationId", sql.Int, conversationId)
        .input("Role", sql.NVarChar, msg.role)
        .input("Content", sql.NVarChar(sql.MAX), msg.content)
        .input("Timestamp", sql.DateTime, new Date())
        .query("INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES (@ConversationId, @Role, @Content, @Timestamp)");
    }

    // Auto-memory extraction from assistant reply (Key: Value lines)
    const memoryLines = reply
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes(":"));

    for (const line of memoryLines) {
      const [key, value] = line.split(":").map((s) => s.trim());
      if (key && value && key.length < 100 && value.length < 1000) {
        await pool
          .request()
          .input("Key", sql.NVarChar, key.replace(/\s+/g, "_").toLowerCase())
          .input("Value", sql.NVarChar(sql.MAX), value)
          .query("INSERT INTO Memory ([Key], Value) VALUES (@Key, @Value)");
        console.log(`🧠 Memory Saved: ${key} → ${value}`);
      }
    }





    /* REPLACE WITH THE MEMORYLines above 
    
    // Auto-memory extraction ONLY inside <!--memory--> ... <!--end-->
const memoryBlock = reply.match(/<!--memory-->([\s\S]*?)<!--end-->/);
if (memoryBlock) {
  const memoryLines = memoryBlock[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(":"));

  for (const line of memoryLines) {
    const [key, value] = line.split(":").map((s) => s.trim());
    if (key && value && key.length < 100 && value.length < 1000) {
      await pool
        .request()
        .input("Key", sql.NVarChar, key.replace(/\s+/g, "_").toLowerCase())
        .input("Value", sql.NVarChar(sql.MAX), value)
        .query("INSERT INTO Memory ([Key], Value) VALUES (@Key, @Value)");
      console.log(`🧠 Memory Saved: ${key} → ${value}`);
    }
  }
} else {
  console.log("⚠️ No memory block found in response.");
}

*/
    // Save assistant reply
    await pool
      .request()
      .input("ConversationId", sql.Int, conversationId)
      .input("Role", sql.NVarChar, "assistant")
      .input("Content", sql.NVarChar(sql.MAX), reply)
      .input("Timestamp", sql.DateTime, new Date())
      .query("INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES (@ConversationId, @Role, @Content, @Timestamp)");

    res.json({ response: reply });
  } catch (err) {
    console.error("❌ Error in chat:", err);
    res.status(500).json({ response: "Error processing your request." });
  }
});

// --- Conversations ---
app.get("/api/conversations", async (req, res) => {
  try {
    const result = await pool
      .request()
      .query("SELECT Id, Title, CreatedAt FROM Conversations ORDER BY CreatedAt DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Messages ---
app.get("/api/messages/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  try {
    const result = await pool
      .request()
      .input("ConversationId", sql.Int, conversationId)
      .query("SELECT Role, Content, Timestamp FROM Messages WHERE ConversationId = @ConversationId ORDER BY Timestamp");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Manual Memory ---
app.post("/api/memory", async (req, res) => {
  const { key, value } = req.body;
  if (!key || !value) {
    return res.status(400).json({ message: "Key and value are required." });
  }

  try {
    await pool
      .request()
      .input("Key", sql.NVarChar, key)
      .input("Value", sql.NVarChar(sql.MAX), value)
      .query("INSERT INTO Memory ([Key], Value) VALUES (@Key, @Value)");
    res.json({ message: "Memory saved." });
  } catch (err) {
    res.status(500).json({ message: "Failed to save memory." });
  }
});

// --- Get Memory ---
app.get("/api/memory", async (req, res) => {
  try {
    const result = await pool.request().query("SELECT [Key], Value FROM Memory");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch memory." });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
