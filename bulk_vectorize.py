import os
import subprocess

BASE_DIR = "knowledge_base"

for course in os.listdir(BASE_DIR):
    course_path = os.path.join(BASE_DIR, course)
    if not os.path.isdir(course_path):
        continue

    pdf_path = os.path.join(course_path, "source.pdf")
    index_path = os.path.join(course_path, "faiss_index")
    store_path = os.path.join(course_path, "vector_store.pkl")

    if not os.path.exists(pdf_path):
        # Fall back to any .pdf file in the folder
        for file in os.listdir(course_path):
            if file.endswith(".pdf"):
                pdf_path = os.path.join(course_path, file)
                break

    if not os.path.exists(index_path) or not os.path.exists(store_path):
        print(f"📚 Generating vector store for: {course}")
        cmd = [
            "py", "-3.10", "langchain_indexer.py",
            pdf_path,
            index_path,
            store_path
        ]
        subprocess.run(cmd, check=True)
    else:
        print(f"✅ Already exists for: {course}")
