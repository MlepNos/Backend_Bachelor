// server2.mjs
// --- dependencies ---
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import multer from "multer";

import { execSync, spawnSync } from "child_process";
import { initDb, getPool, getDbType } from "./db.js";
 import fs from "fs";
import path from "path";
import { getState, setState, clearState } from "./quiz_state.js"; 
import { getConversationLog, saveMessage, getOrCreateConversation  } from "./db_memory.js";

// --- config ---
dotenv.config();
const app = express();
const port = 3003;
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

await initDb();
const db = getPool();
const isMSSQL = getDbType() === "mssql";

let pdfContext = "";

const audioDir = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/generated";
const audioFilename = "reply.wav";
const audioFullPath = `${audioDir}/${audioFilename}`;

app.use("/audio", express.static(audioDir)); // Serve audio via /audio route


/**
* POST /api/upload-pdf
* Purpose: Accepts a single PDF upload for a given course, extracts text for a quick check,
* and builds a LangChain vector store (FAISS + serialized store) by invoking a
* Python script. Creates a knowledge base folder per course.
* Input (multipart/form-data):
* - file: the uploaded PDF file
* - course: string course identifier (required)
* Side effects:
* - Moves uploaded file into knowledge_base/<course>/source.pdf
* - Runs `langchain_indexer.py` to create FAISS index and vector_store.pkl
* - Updates in-memory pdfContext with parsed text (helpful for quick debug)
* Responses:
* - 200 JSON { message: "✅ PDF parsed and indexed successfully." }
* - 400 if course missing
* - 500 on failures (logged with details)
*/
app.post("/api/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    const course = req.body.course;
    if (!course) return res.status(400).json({ message: "Course name is required." });

    // Create folder for this course
    const baseDir = `knowledge_base/${course}`;
    const filePath = `${baseDir}/source.pdf`;
    const indexDir = `${baseDir}/faiss_index`;
    const storePath = `${baseDir}/vector_store.pkl`;

    fs.mkdirSync(baseDir, { recursive: true });
    fs.renameSync(req.file.path, filePath); // Move uploaded file to course folder

    // Optional: quick check of the PDF content
    const buffer = fs.readFileSync(filePath);
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    pdfContext = data.text;

    // Vectorize using Python script
    const pythonScript = `py -3.10 langchain_indexer.py "${filePath}" "${indexDir}" "${storePath}"`;
    console.log("Vectorizing:", pythonScript);
    execSync(pythonScript, { stdio: "inherit" });

    res.json({ message: "✅ PDF parsed and indexed successfully." });
  } catch (err) {
    console.error("PDF Upload Error:", err);
    res.status(500).json({ message: "Failed to process and index PDF." });
  }
});




/**
* POST /api/semantic-chat
* Purpose: Handles chat queries against a course-specific vector index; supports a "quiz mode"
* that can be activated by certain trigger phrases and maintains simple state between
* turns. Persists conversation history to a database for context.
* Input (JSON):
* - course?: string (defaults to 'vorkurs_chemie')
* - sessionTitle?: string (optional human-friendly title for the conversation)
* - message: string (required user input)
* Behavior:
* - If a quiz trigger is detected, sets quiz mode and returns a short TTS audio.
* - If in quiz mode and an answer is expected, checks correctness, clears state, saves history, returns feedback.
* - Otherwise, loads FAISS index for the course and calls `langchain_query.py` (mode: chat or quiz),
* cleans noisy logs from Python output, saves user/AI messages, infers quiz Q/A to set next quiz turn, and
* synthesizes TTS for a concise spoken reply.
* Responses:
* - 200 JSON { transcript, response, audio_url }
* - If index missing: informs client to upload a PDF first.
* - 500 on semantic query or internal failures.
*/
app.post("/api/semantic-chat", async (req, res) => {
  try {
    const course = req.body.course?.trim() || "vorkurs_chemie";
    console.log("📥 Received course:", course); // ✅ Log the incoming course

const sessionTitle =
  req.body.sessionTitle ||
  `Chat ${course} - ${new Date().toISOString().split("T")[0]}`;
    const message = req.body.message;
    if (!message) return res.status(400).json({ error: "Message is required" });
// Text-based trigger phrases for activating quiz mode
const quizTriggers = ["start quiz", "quiz time", "begin quiz", "let's quiz", "can we quiz"];
const msgLower = message.toLowerCase();
const quizRequested = quizTriggers.some(trigger => msgLower.includes(trigger));

if (quizRequested) {
  setState(course, { mode: "quiz" });

  const reply = "Quiz mode activated! Let's begin.";
  fs.mkdirSync(audioDir, { recursive: true });
  const ttsCmd = `py -3.10 text_to_speech.py "${reply}" "${audioFullPath}"`;
  execSync(ttsCmd);

  return res.json({
    transcript: message,
    response: reply,
    audio_url: `http://localhost:3003/audio/${audioFilename}`
  });
}

    console.log("Creating/fetching conversation for title:", sessionTitle);
const conversationId = await getOrCreateConversation(sessionTitle);
console.log("Got conversationId:", conversationId);


    const indexDir = `knowledge_base/${course}/faiss_index`;
    const storePath = `knowledge_base/${course}/vector_store.pkl`;
    const faissPath = path.join(indexDir, "index.faiss");


console.log("indexDir path:", indexDir);
console.log("storePath path:", storePath);
console.log("faissPath path:", faissPath);


    if (!fs.existsSync(faissPath)) {
      return res.json({ response: "No knowledge base loaded yet. Please upload a PDF first." });
    }

    const quizState = getState(course);

    if (quizState?.mode === "quiz" && quizState?.answer) {
      const studentAnswer = message.toLowerCase().trim();
      const correctAnswer = quizState.answer.toLowerCase().trim();
      let feedback = studentAnswer === correctAnswer
        ? `Correct! The answer is ${quizState.answer}. Nice job!`
        : `Not quite. The correct answer was ${quizState.answer}. But no worries — let's try another!`;

      clearState(course);
      await saveMessage(conversationId, "user", message);
      await saveMessage(conversationId, "ai", feedback);

      return res.json({ response: feedback, audio_url: null });
    }

    const history = await getConversationLog(conversationId);
    const historyText = history.map(e => `${e.role === "user" ? "User" : "Assistant"}: ${e.message}`).join("\n");
    fs.writeFileSync("history.txt", historyText);

const quizMode = quizState?.mode === "quiz";
const result = spawnSync("py", ["-3.10", "langchain_query.py", message, indexDir, quizMode ? "quiz" : "chat"], {
  encoding: "utf-8"
});

    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error("Python script failed:", result.stderr);
      return res.status(500).json({ error: "Semantic query failed.", detail: result.stderr });
    }

    let reply = result.stdout.trim();

// If the model output is prefixed by logs like "Querying with message", strip them
const filteredLines = reply.split("\n").filter(line =>
  !line.toLowerCase().includes("querying with message") &&
  !line.toLowerCase().includes("index loaded from") &&
  !line.toLowerCase().includes("top match snippet") &&
  !line.trim().startsWith("Loading vector store") &&
  !line.trim().startsWith("Mode:") &&
  !line.trim().startsWith("Arguments:")
);

reply = filteredLines.join("\n").trim();


    await saveMessage(conversationId, "user", message);
    await saveMessage(conversationId, "ai", reply);

    const questionMatch = reply.match(/Question:\s*(.+?)(?:\r?\n|$)/i);
    const answerMatch = reply.match(/Answer:\s*([A-D]|.+?)(?:\r?\n|$)/i);
    if (questionMatch && answerMatch) {
      setState(course, {
        mode: "quiz",
        question: questionMatch[1].trim(),
        answer: answerMatch[1].trim().toLowerCase(),
      });
    }

    fs.mkdirSync(audioDir, { recursive: true });
    //const ttsCmd = `py -3.10 text_to_speech.py "${reply}" "${audioFullPath}"`;
    //execSync(ttsCmd);
//Clean replyOnly for any garbage encoding or leftover artifacts
//Extract a clean short sentence for speech
let replyOnly = reply.match(/(Hi there!|Hello!|This article|My article|The document)[^.?!]*[.?!]/i)?.[0];
if (!replyOnly) {
  replyOnly = reply.split(/[.?!]/)[0].trim() + ".";
}


// Clean up for shell and encoding safety

// Final sanitize: remove stray URLs or encoding artifacts
replyOnly = replyOnly
  .replace(/com\/\S+\/[a-zA-Z-]+/g, "")      // remove com/5.0/en-US
  .replace(/[^\x00-\x7F]+/g, "")             // remove � and non-ASCII chars
  .replace(/["']/g, "")                      // remove quotes that break shell
  .trim();

const ttsCmd = `py -3.10 text_to_speech.py "${replyOnly}" "${audioFullPath}"`;
execSync(ttsCmd);


    const questionOnly = reply.match(/Question:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim() || reply;


const finalPayload = {
  transcript: message,         // the original user message
  response: reply,             // ✅ full AI response
  audio_url: `http://localhost:3003/audio/${audioFilename}`
};




res.json(finalPayload); // ✅ This sends the full AI reply, transcript, and audio


  } catch (err) {
    console.error("Semantic Chat Error:", err);
    res.status(500).json({ error: "Failed to process semantic chat." });
  }
});



/* app.post("/api/semantic-chat", async (req, res) => {
  try {
    let { message, course } = req.body;
if (!message) {
  return res.status(400).json({ error: "Message is required" });
}
if (!course || course.trim() === "") {
  console.warn("⚠️ No course provided, defaulting to 'vorkurs_chemie'");
  course = "vorkurs_chemie";  // fallback
}

    const indexDir = `knowledge_base/${course}/faiss_index`;
    const storePath = `knowledge_base/${course}/vector_store.pkl`;



const faissPath = path.join(indexDir, "index.faiss");
if (!fs.existsSync(faissPath)) {
  return res.json({
    response: "🧠 No knowledge base loaded yet. Please upload a PDF first or ask me general questions if supported."
  });
}

const result = spawnSync("py", ["-3.10", "langchain_query.py", message, indexDir, storePath], {
  encoding: "utf-8"
});

    if (result.error) throw result.error;
   if (result.status !== 0) {
  console.error("❌ Python script failed:", result.stderr);
  return res.status(500).json({ error: "Semantic query failed.", detail: result.stderr });
}


    const reply = result.stdout.trim();
    res.json({ response: reply.length > 10 ? reply : "⚠️ I need more relevant content from the PDF." });
  } catch (err) {
    console.error("❌ Semantic Chat Error:", err);
    res.status(500).json({ error: "Failed to process semantic chat." });
  }
});
*/





app.get("/api/debug/courses", (req, res) => {
  try {
    const baseDir = path.join("knowledge_base");
    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ message: "❌ No knowledge_base directory found." });
    }

    const courses = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    res.json({
      message: "✅ Available course folders:",
      courses: courses
    });
  } catch (err) {
    console.error("❌ Error fetching courses:", err);
    res.status(500).json({ message: "Failed to list course folders." });
  }
});



app.post("/api/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No audio file uploaded." });

    const audioPath = req.file.path;
    const whisperScript = `py -3.10 whisper_stt.py "${audioPath}"`;

    console.log("🧠 Running Whisper STT:", whisperScript);
    const result = execSync(whisperScript, { encoding: "utf-8" });

    res.json({ transcript: result.trim() });
  } catch (err) {
    console.error("❌ STT Error:", err);
    res.status(500).json({ error: "STT failed", detail: err.message });
  }
});

import { exec} from "child_process";



app.post("/api/record-and-process", async (req, res) => {
  try {
    const { course } = req.body;

    if (!course) {
      res.write(JSON.stringify({ error: "Course not provided." }));
      return res.end();
    }

    res.setHeader("Connection", "keep-alive");
    res.setHeader("Content-Type", "application/json");
    res.flushHeaders();

    const sessionTitle =
      req.body.sessionTitle ||
      `Chat ${course} - ${new Date().toISOString().split("T")[0]}`;
    const conversationId = await getOrCreateConversation(sessionTitle);

    // 🧠 Get conversation history
    const history = await getConversationLog(conversationId);
    const historyText = history
      .map(entry => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.message}`)
      .join("\n");
    fs.writeFileSync("history.txt", historyText);  // Write to file for Python

    const audioDir = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/generated";
    const audioFilename = "reply.wav";
    const audioFullPath = `${audioDir}/${audioFilename}`;

    // Step 1: Record audio
    const record = spawnSync("py", ["-3.10", "record_audio.py"], { encoding: "utf-8" });
    if (record.error || record.status !== 0) {
      console.error("❌ Recording failed:", record.stderr || record.error?.message);
      res.write(JSON.stringify({ error: "Recording failed.", detail: record.stderr || record.error?.message }));
      return res.end();
    }
    console.log("🎙️ Recording completed");

    const audioPath = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/Test/voice.wav";

    // Step 2: Transcribe
    const whisper = spawnSync("py", ["-3.10", "whisper_stt.py", audioPath], { encoding: "utf-8" });
    if (whisper.error || whisper.status !== 0) {
      console.error("❌ Whisper STT failed:", whisper.stderr || whisper.error?.message);
      res.write(JSON.stringify({ error: "Transcription failed.", detail: whisper.stderr || whisper.error?.message }));
      return res.end();
    }
   const transcript = whisper.stdout.trim();
console.log("✅ Transcript:", transcript);
// 🧪 Voice-triggered quiz activation (supports multiple phrases)
const quizTriggers = ["start quiz", "quiz time", "begin quiz", "let's quiz", "can we quiz"];
const transcriptLower = transcript.toLowerCase();
const quizRequested = quizTriggers.some(trigger => transcriptLower.includes(trigger));

if (quizRequested) {
  setState(course, { mode: "quiz" });

  const reply = "🧠 Quiz mode activated! Let's begin.";
  const tts = spawnSync("py", ["-3.10", "text_to_speech.py", reply, audioFullPath], { encoding: "utf-8" });

  return res.end(JSON.stringify({
    transcript,
    response: reply,
    audio_url: `http://localhost:3003/audio/${audioFilename}`
  }));
}

// 🔍 Check if we are in quiz mode and user gave an answer
const quizState = getState(course);
if (quizState?.mode === "quiz" && quizState?.answer) {
  const studentAnswer = transcript.toLowerCase().trim();
  const correctAnswer = quizState.answer;

  let feedback = studentAnswer === correctAnswer
    ? `✅ Correct! The answer is "${correctAnswer}". Well done!`
    : `❌ Incorrect. The correct answer was "${correctAnswer}". Let's try another one!`;

  clearState(course);
  await saveMessage(conversationId, "user", transcript);
  await saveMessage(conversationId, "ai", feedback);

  // TTS
  fs.mkdirSync(audioDir, { recursive: true });
  //const tts = spawnSync("py", ["-3.10", "text_to_speech.py", aiReply, audioFullPath]);
// Try to extract just the Reply: ... line
//const replyOnly = aiReply.match(/Reply:\s*(.+?)(?=\n|$)/is)?.[1]?.trim() || aiReply;

//const tts = spawnSync("py", ["-3.10", "text_to_speech.py", replyOnly, audioFullPath], { encoding: "utf-8" });

  //const tts = spawnSync("py", ["-3.10", "text_to_speech.py", feedback, audioFullPath], { encoding: "utf-8" });
const tts = spawnSync("py", ["-3.10", "text_to_speech.py", feedback, audioFullPath], { encoding: "utf-8" });

  return res.end(JSON.stringify({
    transcript,
    response: feedback,
    audio_url: `http://localhost:3003/audio/${audioFilename}`
  }));
}


    // Step 3: Semantic query (Python reads history.txt internally)
    const indexDir = `knowledge_base/${course}/faiss_index`;
    const storePath = `knowledge_base/${course}/vector_store.pkl`;
    const quizMode = quizState?.mode === "quiz";
const ai = spawnSync("py", ["-3.10", "langchain_query.py", transcript, indexDir, quizMode ? "quiz" : "chat"], {
  encoding: "utf-8"
});


    if (ai.error || ai.status !== 0) {
      console.error("❌ LangChain query failed:", ai.stderr || ai.error?.message);
      res.write(JSON.stringify({ error: "Semantic query failed.", detail: ai.stderr || ai.error?.message }));
      return res.end();
    }

    if (ai.stderr) {
  console.warn("🐍 Python stderr:\n", ai.stderr);
}
let aiReply = ai.stdout.trim();

// Remove debug logs from Python script
const cleanLines = aiReply.split("\n").filter(line =>
  !line.toLowerCase().includes("querying with message") &&
  !line.toLowerCase().includes("index loaded from") &&
  !line.toLowerCase().includes("top match snippet") &&
  !line.trim().startsWith("loading vector store") &&
  !line.trim().startsWith("mode:") &&
  !line.trim().startsWith("arguments:")
);

aiReply = cleanLines.join("\n").trim();
console.log("🤖 AI Response:", aiReply);

// 💾 Save full message for history
await saveMessage(conversationId, "user", transcript);
await saveMessage(conversationId, "ai", aiReply);

// 🧠 Strip to only question for speaking
const questionOnly = aiReply.match(/Question:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim() || aiReply;

// Step 4: TTS
fs.mkdirSync(audioDir, { recursive: true });
//const tts = spawnSync("py", ["-3.10", "text_to_speech.py", questionOnly, audioFullPath], { encoding: "utf-8" });
//const tts = spawnSync("py", ["-3.10", "text_to_speech.py", aiReply, audioFullPath], { encoding: "utf-8" });
// Try to extract just the Reply: ... line
// 🎯 Extract a clean short sentence for speech



// ✅ Speak the full AI reply (not just first sentence)
const safeReply = aiReply
  .replace(/com\/\S+\/[a-zA-Z-]+/g, "")   // remove 'com/5.0/en-US'
  .replace(/[^\x00-\x7F]+/g, "")          // remove non-ASCII like �
  .replace(/["']/g, "")                   // remove shell-breaking quotes
  .trim();

const tts = spawnSync("py", ["-3.10", "text_to_speech.py", safeReply, audioFullPath], { encoding: "utf-8" });


    if (tts.error || tts.status !== 0) {
      console.error("❌ TTS failed:", tts.stderr || tts.error?.message);
      res.write(JSON.stringify({ error: "TTS failed.", detail: tts.stderr || tts.error?.message }));
      return res.end();
    }


const finalPayload = {
  transcript,
response: aiReply,
  audio_url: `http://localhost:3003/audio/${audioFilename}`
};


    console.log("✅ Sending response to Unreal:", finalPayload);
    res.write(JSON.stringify(finalPayload));
    res.end();

  } catch (err) {
    console.error("❌ Internal error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal error", detail: err.message });
    } else {
      res.write(JSON.stringify({ error: "Internal error (post-flush)", detail: err.message }));
      res.end();
    }
  }
});







// --- Start Server ---
app.listen(port, () => {
  console.log(`\u{1F680} Server running at http://localhost:${port}`);
});