// record.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const mic = require('mic');
import fs from 'fs';

console.log("🎙️ Recording... Speak now! (Recording will stop in 5 seconds)");

const micInstance = mic({
  rate: '16000',
  channels: '1',
  bitwidth: '16',
  encoding: 'signed-integer',
  fileType: 'wav',
});

const micInputStream = micInstance.getAudioStream();
const outputFileStream = fs.createWriteStream('speech.wav');

micInputStream.pipe(outputFileStream);

micInstance.start();

setTimeout(() => {
  micInstance.stop();
  console.log("✅ Recording finished. Saved as 'speech.wav'");
}, 5000);
