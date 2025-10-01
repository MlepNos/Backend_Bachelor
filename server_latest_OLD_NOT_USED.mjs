// --- dependencies ---
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import { execSync } from "child_process";
import { initDb, getPool, getDbType } from "./db.js";

// --- config ---
dotenv.config();
const app = express();
const port = 3003;
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());


const startServer = async () => {
await initDb();
const db = getPool();
const isMSSQL = getDbType() === "mssql";

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

// --- Voice Transcription ---
app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const fixedPath = `${inputPath}_fixed.wav`;
    const resultPath = `${fixedPath}.txt`;

    // Step 1: Re-encode WAV using encode.py
    execSync(`py -3.10 encode.py ${inputPath} ${fixedPath}`);

    // Step 2: Run Whisper CLI
    //execSync(`whisper-cli.exe -m backend_V2/models/ggml-base.en.bin -f ${fixedPath} --output-txt`);
    execSync(`"C:/Users/mehme/AI/ReactAI/Whisper/whisper.cpp/build/bin/whisper-cli.exe" -m C:/Users/mehme/AI/ReactAI/Whisper/whisper.cpp/models/for-tests-ggml-base.en.bin -f ${fixedPath} --output-txt`);

    // Step 3: Read and return the transcription
    const transcript = fs.readFileSync(resultPath, "utf8");

    // Optional cleanup
    fs.unlinkSync(inputPath);
    fs.unlinkSync(fixedPath);
    fs.unlinkSync(resultPath);

    res.json({ transcription: transcript });
  } catch (err) {
    console.error("❌ Transcription Error:", err);
    res.status(500).json({ message: "Transcription failed." });
  }
});

// --- Chat Route ---
app.post("/api/chat", async (req, res) => {
  const messages = req.body.messages;

  try {
    const memoryResult = isMSSQL
      ? await db.request().query("SELECT [Key], Value FROM Memory")
      : await db.query("SELECT Key, Value FROM Memory");

      const memoryData = isMSSQL ? memoryResult?.recordset || [] : memoryResult?.rows || [];
      console.log("🧠 Memory result:", memoryResult);
      const memoryInstructions = memoryData.map((item) => {
        const k = item.Key || item.key;
        const v = item.Value || item.value;
        return `Memory: ${k.replace(/_/g, " ")} is ${v}`;
      });
      
      
      



    const prompt = [
      {
        role: "system",
        content: `
You are a helpful and conversational assistant. When the user shares factual information about themselves (e.g. "I live in Berlin", "My favorite color is blue"), you should:
1. Respond naturally.
2. Quietly add new facts inside <!--memory--> and <!--end--> like this:
<!--memory-->
Key: Value
<!--end-->
Do not show this section to the user.`,
      },
      { role: "system", content: memoryInstructions.join("\n") },
      { role: "system", content: pdfContext.slice(0, 1500) || "No PDF uploaded yet." },
      ...messages,
    ];

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3:8b", messages: prompt, stream: false }),
    });

    const data = await response.json();
    const reply = data.message.content;

    // Save conversation + messages
    let conversationId;
    if (isMSSQL) {
      const result = await db
        .request()
        .input("Title", "PDF Chat Session")
        .input("CreatedAt", new Date())
        .query("INSERT INTO Conversations (Title, CreatedAt) OUTPUT INSERTED.Id VALUES (@Title, @CreatedAt)");
      conversationId = result.recordset[0].Id;
    } else {
      const result = await db.query(
        "INSERT INTO Conversations (Title, CreatedAt) VALUES ($1, $2) RETURNING Id",
        ["PDF Chat Session", new Date()]
      );
      conversationId = result.rows[0].id;
    }

    for (const msg of messages) {
      if (isMSSQL) {
        await db
          .request()
          .input("ConversationId", conversationId)
          .input("Role", msg.role)
          .input("Content", msg.content)
          .input("Timestamp", new Date())
          .query("INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES (@ConversationId, @Role, @Content, @Timestamp)");
      } else {
        await db.query(
          "INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES ($1, $2, $3, $4)",
          [conversationId, msg.role, msg.content, new Date()]
        );
      }
    }

    const memBlock = reply.match(/<!--memory-->([\s\S]*?)<!--end-->/);
    if (memBlock) {
      const lines = memBlock[1].split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const [key, value] = line.split(":").map(s => s.trim());
        if (key && value) {
          if (isMSSQL) {
            await db
              .request()
              .input("Key", key)
              .input("Value", value)
              .query("INSERT INTO Memory ([Key], Value) VALUES (@Key, @Value)");
          } else {
            await db.query("INSERT INTO Memory (Key, Value) VALUES ($1, $2)", [key, value]);
          }
        }
      }
    }

    // Save assistant message
    if (isMSSQL) {
      await db
        .request()
        .input("ConversationId", conversationId)
        .input("Role", "assistant")
        .input("Content", reply)
        .input("Timestamp", new Date())
        .query("INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES (@ConversationId, @Role, @Content, @Timestamp)");
    } else {
      await db.query(
        "INSERT INTO Messages (ConversationId, Role, Content, Timestamp) VALUES ($1, $2, $3, $4)",
        [conversationId, "assistant", reply, new Date()]
      );
    }

    res.json({ response: reply });
  } catch (err) {
    console.error("❌ Error in chat:", err);
    res.status(500).json({ response: "Failed to process chat." });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});


};

startServer();