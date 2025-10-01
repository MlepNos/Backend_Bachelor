// server2.mjs
// deps
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
import { getConversationLog, saveMessage, getOrCreateConversation } from "./db_memory.js";

// basic app setup
dotenv.config();
const app = express();
const port = 3003;
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// open DB once at startup
await initDb();
const db = getPool();
const isMSSQL = getDbType() === "mssql";

let pdfContext = "";

// TTS output location (served statically)
const audioDir = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/generated";
const audioFilename = "reply.wav";
const audioFullPath = `${audioDir}/${audioFilename}`;
app.use("/audio", express.static(audioDir));

// upload one PDF for a course → build FAISS index via python
app.post("/api/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    const course = req.body.course;
    if (!course) return res.status(400).json({ message: "Course name is required." });

    // course folder + paths
    const baseDir = `knowledge_base/${course}`;
    const filePath = `${baseDir}/source.pdf`;
    const indexDir = `${baseDir}/faiss_index`;
    const storePath = `${baseDir}/vector_store.pkl`;

    fs.mkdirSync(baseDir, { recursive: true });
    fs.renameSync(req.file.path, filePath); // move upload into course folder

    // quick parse to keep last text in memory (optional debug)
    const buffer = fs.readFileSync(filePath);
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    pdfContext = data.text;

    // call indexer (embeddings + FAISS)
    const pythonScript = `py -3.10 langchain_indexer.py "${filePath}" "${indexDir}" "${storePath}"`;
    console.log("Vectorizing:", pythonScript);
    execSync(pythonScript, { stdio: "inherit" });

    res.json({ message: "✅ PDF parsed and indexed successfully." });
  } catch (err) {
    console.error("PDF Upload Error:", err);
    res.status(500).json({ message: "Failed to process and index PDF." });
  }
});

// chat endpoint: supports normal Q&A and a simple quiz mode
app.post("/api/semantic-chat", async (req, res) => {
  try {
    const course = req.body.course?.trim() || "vorkurs_chemie";
    console.log("📥 Received course:", course);

    // conversation title (used as a thread key)
    const sessionTitle =
      req.body.sessionTitle ||
      `Chat ${course} - ${new Date().toISOString().split("T")[0]}`;

    const message = req.body.message;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // look for quiz trigger phrases
    const quizTriggers = ["start quiz", "quiz time", "begin quiz", "let's quiz", "can we quiz"];
    const msgLower = message.toLowerCase();
    const quizRequested = quizTriggers.some(t => msgLower.includes(t));

    // if quiz requested: set mode and speak a short confirmation
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

    // ensure we have a conversation row
    console.log("Creating/fetching conversation for title:", sessionTitle);
    const conversationId = await getOrCreateConversation(sessionTitle);
    console.log("Got conversationId:", conversationId);

    // paths to the vector store
    const indexDir = `knowledge_base/${course}/faiss_index`;
    const storePath = `knowledge_base/${course}/vector_store.pkl`;
    const faissPath = path.join(indexDir, "index.faiss");

    console.log("indexDir path:", indexDir);
    console.log("storePath path:", storePath);
    console.log("faissPath path:", faissPath);

    // guard: index must exist
    if (!fs.existsSync(faissPath)) {
      return res.json({ response: "No knowledge base loaded yet. Please upload a PDF first." });
    }

    const quizState = getState(course);

    // if quiz is active and an answer is expected, grade it and clear state
    if (quizState?.mode === "quiz" && quizState?.answer) {
      const studentAnswer = message.toLowerCase().trim();
      const correctAnswer = quizState.answer.toLowerCase().trim();
      const feedback = studentAnswer === correctAnswer
        ? `Correct! The answer is ${quizState.answer}. Nice job!`
        : `Not quite. The correct answer was ${quizState.answer}. But no worries — let's try another!`;

      clearState(course);
      await saveMessage(conversationId, "user", message);
      await saveMessage(conversationId, "ai", feedback);

      return res.json({ response: feedback, audio_url: null });
    }

    // write conversation history to a txt file for the python chain
    const history = await getConversationLog(conversationId);
    const historyText = history.map(e => `${e.role === "user" ? "User" : "Assistant"}: ${e.message}`).join("\n");
    fs.writeFileSync("history.txt", historyText);

    // call langchain_query.py (quiz/chat mode)
    const quizMode = quizState?.mode === "quiz";
    const result = spawnSync("py", ["-3.10", "langchain_query.py", message, indexDir, quizMode ? "quiz" : "chat"], {
      encoding: "utf-8"
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error("Python script failed:", result.stderr);
      return res.status(500).json({ error: "Semantic query failed.", detail: result.stderr });
    }

    // clean noisy lines printed by the python script
    let reply = result.stdout.trim();
    const filteredLines = reply.split("\n").filter(line =>
      !line.toLowerCase().includes("querying with message") &&
      !line.toLowerCase().includes("index loaded from") &&
      !line.toLowerCase().includes("top match snippet") &&
      !line.trim().startsWith("Loading vector store") &&
      !line.trim().startsWith("Mode:") &&
      !line.trim().startsWith("Arguments:")
    );
    reply = filteredLines.join("\n").trim();

    // persist this turn
    await saveMessage(conversationId, "user", message);
    await saveMessage(conversationId, "ai", reply);

    // if reply contains a "Question/Answer" pair, set quiz state for next turn
    const questionMatch = reply.match(/Question:\s*(.+?)(?:\r?\n|$)/i);
    const answerMatch = reply.match(/Answer:\s*([A-D]|.+?)(?:\r?\n|$)/i);
    if (questionMatch && answerMatch) {
      setState(course, {
        mode: "quiz",
        question: questionMatch[1].trim(),
        answer: answerMatch[1].trim().toLowerCase(),
      });
    }

    // generate short TTS snippet from the reply
    fs.mkdirSync(audioDir, { recursive: true });

    // try to grab a short first sentence, else fallback to the first sentence in reply
    let replyOnly = reply.match(/(Hi there!|Hello!|This article|My article|The document)[^.?!]*[.?!]/i)?.[0];
    if (!replyOnly) {
      replyOnly = reply.split(/[.?!]/)[0].trim() + ".";
    }

    // sanitize for shell / audio engine
    replyOnly = replyOnly
      .replace(/com\/\S+\/[a-zA-Z-]+/g, "")
      .replace(/[^\x00-\x7F]+/g, "")
      .replace(/["']/g, "")
      .trim();

    const ttsCmd = `py -3.10 text_to_speech.py "${replyOnly}" "${audioFullPath}"`;
    execSync(ttsCmd);

    const questionOnly = reply.match(/Question:\s*(.+?)(?:\r?\n|$)/i)?.[1]?.trim() || reply;

    // package response for the client
    const finalPayload = {
      transcript: message,
      response: reply,
      audio_url: `http://localhost:3003/audio/${audioFilename}`
    };

    res.json(finalPayload);
  } catch (err) {
    console.error("Semantic Chat Error:", err);
    res.status(500).json({ error: "Failed to process semantic chat." });
  }
});

// list all course folders under knowledge_base
app.get("/api/debug/courses", (req, res) => {
  try {
    const baseDir = path.join("knowledge_base");
    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ message: "❌ No knowledge_base directory found." });
    }

    const courses = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    res.json({
      message: "✅ Available course folders:",
      courses
    });
  } catch (err) {
    console.error("❌ Error fetching courses:", err);
    res.status(500).json({ message: "Failed to list course folders." });
  }
});

// speech-to-text: accepts an uploaded wav, runs whisper, returns transcript
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

import { exec } from "child_process";

// end-to-end voice flow: record → transcribe → RAG → TTS
app.post("/api/record-and-process", async (req, res) => {
  try {
    const { course } = req.body;
    if (!course) {
      res.write(JSON.stringify({ error: "Course not provided." }));
      return res.end();
    }

    // keep HTTP connection open while steps run
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Content-Type", "application/json");
    res.flushHeaders();

    // get or create a conversation thread for this course
    const sessionTitle =
      req.body.sessionTitle ||
      `Chat ${course} - ${new Date().toISOString().split("T")[0]}`;
    const conversationId = await getOrCreateConversation(sessionTitle);

    // dump history for python chain
    const history = await getConversationLog(conversationId);
    const historyText = history
      .map(e => `${e.role === "user" ? "User" : "Assistant"}: ${e.message}`)
      .join("\n");
    fs.writeFileSync("history.txt", historyText);

    const audioDir = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/generated";
    const audioFilename = "reply.wav";
    const audioFullPath = `${audioDir}/${audioFilename}`;

    // 1) record mic input (python helper writes a wav to a known path)
    const record = spawnSync("py", ["-3.10", "record_audio.py"], { encoding: "utf-8" });
    if (record.error || record.status !== 0) {
      console.error("❌ Recording failed:", record.stderr || record.error?.message);
      res.write(JSON.stringify({ error: "Recording failed.", detail: record.stderr || record.error?.message }));
      return res.end();
    }
    console.log("🎙️ Recording completed");

    const audioPath = "C:/Users/mehme/Documents/Unreal Projects/Bachelor/Test/voice.wav";

    // 2) transcribe with Whisper
    const whisper = spawnSync("py", ["-3.10", "whisper_stt.py", audioPath], { encoding: "utf-8" });
    if (whisper.error || whisper.status !== 0) {
      console.error("❌ Whisper STT failed:", whisper.stderr || whisper.error?.message);
      res.write(JSON.stringify({ error: "Transcription failed.", detail: whisper.stderr || whisper.error?.message }));
      return res.end();
    }
    const transcript = whisper.stdout.trim();
    console.log("✅ Transcript:", transcript);

    // quick voice-trigger for quiz mode
    const quizTriggers = ["start quiz", "quiz time", "begin quiz", "let's quiz", "can we quiz"];
    const transcriptLower = transcript.toLowerCase();
    const quizRequested = quizTriggers.some(t => transcriptLower.includes(t));

    if (quizRequested) {
      setState(course, { mode: "quiz" });
      const reply = "🧠 Quiz mode activated! Let's begin.";
      spawnSync("py", ["-3.10", "text_to_speech.py", reply, audioFullPath], { encoding: "utf-8" });

      return res.end(JSON.stringify({
        transcript,
        response: reply,
        audio_url: `http://localhost:3003/audio/${audioFilename}`
      }));
    }

    // if in quiz mode and expecting an answer, grade and reply
    const quizState = getState(course);
    if (quizState?.mode === "quiz" && quizState?.answer) {
      const studentAnswer = transcript.toLowerCase().trim();
      const correctAnswer = quizState.answer;

      const feedback = studentAnswer === correctAnswer
        ? `✅ Correct! The answer is "${correctAnswer}". Well done!`
        : `❌ Incorrect. The correct answer was "${correctAnswer}". Let's try another one!`;

      clearState(course);
      await saveMessage(conversationId, "user", transcript);
      await saveMessage(conversationId, "ai", feedback);

      fs.mkdirSync(audioDir, { recursive: true });
      spawnSync("py", ["-3.10", "text_to_speech.py", feedback, audioFullPath], { encoding: "utf-8" });

      return res.end(JSON.stringify({
        transcript,
        response: feedback,
        audio_url: `http://localhost:3003/audio/${audioFilename}`
      }));
    }

    // 3) run RAG against the course index (chat or quiz prompt)
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

    // filter python debug chatter
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

    // store messages
    await saveMessage(conversationId, "user", transcript);
    await saveMessage(conversationId, "ai", aiReply);

    // synthesize audio for the reply (sanitized)
    fs.mkdirSync(audioDir, { recursive: true });
    const safeReply = aiReply
      .replace(/com\/\S+\/[a-zA-Z-]+/g, "")
      .replace(/[^\x00-\x7F]+/g, "")
      .replace(/["']/g, "")
      .trim();

    const tts = spawnSync("py", ["-3.10", "text_to_speech.py", safeReply, audioFullPath], { encoding: "utf-8" });
    if (tts.error || tts.status !== 0) {
      console.error("❌ TTS failed:", tts.stderr || tts.error?.message);
      res.write(JSON.stringify({ error: "TTS failed.", detail: tts.stderr || tts.error?.message }));
      return res.end();
    }

    // payload back to caller
    const finalPayload = {
      transcript,
      response: aiReply,
      audio_url: `http://localhost:3003/audio/${audioFilename}`
    };

    console.log("✅ Sending response to Unreal:", finalPayload);
    res.write(JSON.stringify(finalPayload));
    res.end();

  } catch (err) {
    // ensure we finish the chunked response even if something blows up
    console.error("❌ Internal error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal error", detail: err.message });
    } else {
      res.write(JSON.stringify({ error: "Internal error (post-flush)", detail: err.message }));
      res.end();
    }
  }
});

// start HTTP server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
