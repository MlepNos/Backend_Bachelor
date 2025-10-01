import os
import sounddevice as sd
from scipy.io.wavfile import write

SAMPLE_RATE = 16000   # 16 kHz mic capture (good for STT)
DURATION = 5          # seconds to record

# where to save the WAV (ensure folder exists)
output_path = r"C:\Users\mehme\Documents\Unreal Projects\Bachelor\Test\voice.wav"
os.makedirs(os.path.dirname(output_path), exist_ok=True)

try:
    print("Speak now...")
    # record mono, 16-bit samples
    recording = sd.rec(
        int(DURATION * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='int16'
    )
    sd.wait()  # block until recording completes

    # write to WAV file
    write(output_path, SAMPLE_RATE, recording)
    print(f"Audio saved to {output_path}")

except Exception as e:
    # catch audio device / permission / path errors
    print(f"Recording error: {e}")
