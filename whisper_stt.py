import sys
import whisper

if len(sys.argv) < 2:
    print("No input audio path.")
    sys.exit(1)

audio_path = sys.argv[1]
model = whisper.load_model("base")  # Or use 'medium' or 'large' on DACHS
result = model.transcribe(audio_path)
sys.stdout.reconfigure(encoding='utf-8')
print(result["text"])