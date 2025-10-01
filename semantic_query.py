import sys
import pickle
import faiss
from sentence_transformers import SentenceTransformer

# read the query text from CLI (arg 1)
query = sys.argv[1]

# paths to the FAISS index and the pickled text chunks
# NOTE: make sure your folder name matches these strings ("fais_vector" here)
index_path = "fais_vector/faiss_index.index"
store_path = "fais_vector/vector_store.pkl"

# load the same embedding model used to build the index
model = SentenceTransformer("all-MiniLM-L6-v2")

# open the FAISS index from disk
index = faiss.read_index(index_path)

# load the original chunk texts (parallel array to vectors)
with open(store_path, "rb") as f:
    chunks = pickle.load(f)

# helper: normalize and trim text for display
def clean(text):
    return (
        text.encode("utf-8", errors="ignore")
            .decode("utf-8")
            .replace("\n", " ")
            .strip()
    )

# embed the query (normalized embeddings to match index build settings)
query_vector = model.encode([query], normalize_embeddings=True)

# search top-k nearest neighbors in the vector space
top_k = 5
D, I = index.search(query_vector, top_k)

# build a small text context from the top hits
results = [f"Chunk {i+1}:\n{clean(chunks[i][:1000])}" for i in I[0]]
context = "\n\n".join(results)

# print to stdout (caller can consume this as context)
print(context)
