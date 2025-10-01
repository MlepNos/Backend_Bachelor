
##
##from pydub import AudioSegment

# Load original audio
##audio = AudioSegment.from_file("/mnt/c/Users/mehme/AI/ReactAI/backend_V2/audio/speech.wav")

# Re-encode: PCM 16-bit WAV, 16kHz mono
##audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)

# Export with WSL-compatible path
##audio.export("/mnt/c/Users/mehme/AI/ReactAI/backend_V2/audio/speech_fixed.wav", format="wav")

##print("WAV file re-encoded successfully.")



##########################################

from pydub import AudioSegment
import sys

if len(sys.argv) != 3:
    print("Usage: encode.py <input_path> <output_path>")
    exit(1)

input_path = sys.argv[1]
output_path = sys.argv[2]

audio = AudioSegment.from_file(input_path)
audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
audio.export(output_path, format="wav")
print("WAV file re-encoded successfully.")
