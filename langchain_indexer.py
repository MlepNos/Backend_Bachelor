import sys
import pickle
import re
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import CharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.docstore.document import Document

def clean_text(text):
    # Remove PDF metadata artifacts
    text = re.sub(r"com/[\d\.]+/[\w-]+", "", text)  # e.g., com/5.0/en-US
    text = re.sub(r"[\uFFFD\uFEFF\u200B-\u200D]+", "", text)  # Remove weird UTF chars
    text = re.sub(r"[^\x00-\x7F]+", " ", text)  # Non-ASCII fallback
    text = re.sub(r"\s+", " ", text)  # Collapse whitespace
    return text.strip()


# --- CLI arguments ---
if len(sys.argv) != 4:
    print("Usage: python langchain_indexer.py <pdf_path> <index_dir> <store_path>")
    exit(1)

pdf_path = sys.argv[1]
index_dir = sys.argv[2]
store_path = sys.argv[3]

# --- Load and split PDF ---
loader = PyPDFLoader(pdf_path)
documents = loader.load()

# Clean all document content
for doc in documents:
    doc.page_content = clean_text(doc.page_content)

# Split content into manageable chunks
splitter = CharacterTextSplitter(chunk_size=500, chunk_overlap=100)
docs = splitter.split_documents(documents)

# --- Create & inject summary chunk ---
# Extract meaningful content from first 1–2 long-enough pages
text_pages = [p.page_content for p in documents if len(p.page_content.strip()) > 300]
summary_text = "\n".join(text_pages[:2])[:1000]  # Limit to ~1000 chars

summary_doc = Document(
    page_content=summary_text.strip(),
    metadata={"source": "summary", "priority": "high"}
)

docs.append(summary_doc)  # Ensure it's indexed

# --- Embed and index ---
embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = FAISS.from_documents(docs, embedding_model)

# Save vector index
vectorstore.save_local(index_dir)

# Save original chunks (optional backup or debugging)
with open(store_path, "wb") as f:
    pickle.dump(docs, f)

print(f"✅ LangChain vector store created with {len(docs)} chunks.")
