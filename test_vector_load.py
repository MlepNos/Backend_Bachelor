# test_vector_load.py
# Quick sanity check: can we load a FAISS index and retrieve something?

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

# Use the same embedding model that was used to build the index
embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Load the saved FAISS store for the "expose" course
# (allow_dangerous_deserialization is required by LangChain's loader)
vectorstore = FAISS.load_local(
    "knowledge_base/expose/faiss_index",
    embedding_model,
    allow_dangerous_deserialization=True
)

print("✅ FAISS loaded")

# Run a tiny retrieval test: ask a generic question and fetch top-2 chunks
docs = vectorstore.similarity_search("What is this PDF about?", k=2)

# Print a short preview of the best match
print(f"Top match: {docs[0].page_content[:200]}")
