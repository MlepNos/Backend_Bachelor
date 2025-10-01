import sys
import pickle
import faiss
from sentence_transformers import SentenceTransformer

# === Read args ===
query = sys.argv[1]
index_path = "fais_vector/faiss_index.index"
store_path = "fais_vector/vector_store.pkl"

# === Load ===
model = SentenceTransformer("all-MiniLM-L6-v2")
index = faiss.read_index(index_path)

with open(store_path, "rb") as f:
    chunks = pickle.load(f)

# === Clean helper ===
def clean(text):
    return text.encode("utf-8", errors="ignore").decode("utf-8").replace("\n", " ").strip()

# === Embed and search ===
query_vector = model.encode([query], normalize_embeddings=True)
top_k = 5
D, I = index.search(query_vector, top_k)

# === Collect results ===
results = [f"Chunk {i+1}:\n{clean(chunks[i][:1000])}" for i in I[0]]
context = "\n\n".join(results)

print(context)
