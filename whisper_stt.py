import sys
import whisper

# Tiny CLI wrapper around OpenAI Whisper: transcribe an audio file to text.
# Usage: python whisper_stt.py path/to/audio.wav

if len(sys.argv) < 2:
    print("No input audio path.")
    sys.exit(1)

audio_path = sys.argv[1]

# Load a Whisper model. "base" is a good default.
# (You can swap to "small", "medium", or "large" if you have a stronger GPU.)
model = whisper.load_model("base")

# Run transcription. Whisper auto-detects language and handles most audio formats.
result = model.transcribe(audio_path)

# Ensure we print UTF-8 cleanly (for non-ASCII transcripts)
sys.stdout.reconfigure(encoding='utf-8')

# Output only the plain transcript text
print(result["text"])
