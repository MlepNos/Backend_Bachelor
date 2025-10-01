# text_to_speech.py
import sys
import pyttsx3
import textwrap

def synthesize(text, output_path):
    engine = pyttsx3.init()
    engine.setProperty('rate', 160)  # Adjust speed if needed

    # To avoid overflow, cut long text into parts and join it back
    chunks = textwrap.wrap(text, width=200)
    safe_text = " ".join(chunks)

    engine.save_to_file(safe_text, output_path)
    engine.runAndWait()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python text_to_speech.py \"text\" output.wav")
        sys.exit(1)

    synthesize(sys.argv[1], sys.argv[2])
