# test_vector_load.py
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = FAISS.load_local("knowledge_base/expose/faiss_index", embedding_model, allow_dangerous_deserialization=True)

print("✅ FAISS loaded")
docs = vectorstore.similarity_search("What is this PDF about?", k=2)
print(f"Top match: {docs[0].page_content[:200]}")
