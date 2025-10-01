from pydub import AudioSegment
import sys
# Re-encode audio to WAV PCM (16 kHz, mono, 16-bit) for STT/TTS compatibility.
# expect exactly two CLI args: input and output paths
if len(sys.argv) != 3:
    print("Usage: encode.py <input_path> <output_path>")
    exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]

# load any audio format pydub/ffmpeg can read
audio = AudioSegment.from_file(input_path)

# normalize to WAV PCM 16 kHz, mono, 16-bit (2 bytes/sample)
audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)

# write the re-encoded file as WAV
audio.export(output_path, format="wav")

print("WAV file re-encoded successfully.")
