# text_to_speech.py
# Tiny CLI helper: turn a text string into a spoken WAV file using pyttsx3 (offline TTS).

import sys
import pyttsx3
import textwrap

def synthesize(text, output_path):
    # Initialize the offline TTS engine (works without internet)
    engine = pyttsx3.init()
    engine.setProperty('rate', 160)  # speaking speed (tweak to taste)

    # Very long strings can cause issues; wrap and re-join to keep it manageable
    chunks = textwrap.wrap(text, width=200)
    safe_text = " ".join(chunks)

    # Synthesize directly to a WAV file, then block until done
    engine.save_to_file(safe_text, output_path)
    engine.runAndWait()

if __name__ == "__main__":
    # Expect: text_to_speech.py "some text" output.wav
    if len(sys.argv) < 3:
        print('Usage: python text_to_speech.py "text" output.wav')
        sys.exit(1)

    synthesize(sys.argv[1], sys.argv[2])
    #print(f"WAV file saved to: {sys.argv[2]}")