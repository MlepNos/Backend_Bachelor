// record.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mic = require('mic');
import fs from 'fs';

console.log("🎙️ Recording... Speak now! (Recording will stop in 5 seconds)");

// configure mic input → 16 kHz, mono, 16-bit PCM, WAV container
const micInstance = mic({
  rate: '16000',
  channels: '1',
  bitwidth: '16',
  encoding: 'signed-integer',
  fileType: 'wav',
});

// pipe raw mic audio to a file on disk
const micInputStream = micInstance.getAudioStream();
const outputFileStream = fs.createWriteStream('speech.wav');
micInputStream.pipe(outputFileStream);

// start capture
micInstance.start();

// stop after 5 seconds and close the file
setTimeout(() => {
  micInstance.stop();
  console.log("✅ Recording finished. Saved as 'speech.wav'");
}, 5000);
