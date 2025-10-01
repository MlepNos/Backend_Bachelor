import sys
from sentence_transformers import SentenceTransformer
import faiss
import PyPDF2
import pickle
import os

# ==== Get file paths from command-line arguments ====
if len(sys.argv) != 4:
    print("Usage: python vector_store.py <pdf_path> <index_path> <store_path>")
    sys.exit(1)

pdf_path = sys.argv[1]
index_path = sys.argv[2]
store_path = sys.argv[3]

# 1. Extract text
def extract_text_from_pdf(pdf_file):
    reader = PyPDF2.PdfReader(pdf_file)
    return "\n".join(page.extract_text() for page in reader.pages)

# 2. Split into chunks
def chunk_text(text, chunk_size=500, overlap=100):
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        start += chunk_size - overlap
    return chunks

# 3. Embeddings
def embed_chunks(chunks):
    model = SentenceTransformer("all-MiniLM-L6-v2")
    vectors = model.encode(chunks)
    return vectors, model

# 4. Build FAISS index
def build_index(embeddings):
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)
    faiss.write_index(index, index_path)
    return index

# 5. Save chunk texts
def save_chunks(chunks):
    with open(store_path, "wb") as f:
        pickle.dump(chunks, f)

# Run all
if __name__ == "__main__":
    text = extract_text_from_pdf(pdf_path)
    chunks = chunk_text(text)
    embeddings, _ = embed_chunks(chunks)
    build_index(embeddings)
    save_chunks(chunks)
    print(f"✅ Vector store created with {len(chunks)} chunks.")
