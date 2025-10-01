import os
import subprocess
import shutil

BASE_DIR = "knowledge_base"

for course in os.listdir(BASE_DIR):
    course_path = os.path.join(BASE_DIR, course)
    if not os.path.isdir(course_path):
        continue

    print(f"🔍 Processing course: {course}")

    # Determine paths
    pdf_path = os.path.join(course_path, "source.pdf")
    index_path = os.path.join(course_path, "faiss_index")
    store_path = os.path.join(course_path, "vector_store.pkl")

    # Fall back to any .pdf file if source.pdf is missing
    if not os.path.exists(pdf_path):
        for file in os.listdir(course_path):
            if file.lower().endswith(".pdf"):
                pdf_path = os.path.join(course_path, file)
                print(f"⚠️ No source.pdf, using: {pdf_path}")
                break
        else:
            print(f"⛔ No PDF found in {course_path}, skipping...")
            continue

    # 🔁 Always clean old data
    if os.path.exists(index_path):
        shutil.rmtree(index_path)
        print(f"🧹 Deleted old FAISS index: {index_path}")
    if os.path.exists(store_path):
        os.remove(store_path)
        print(f"🧹 Deleted old vector store: {store_path}")

    # 🧠 Run indexer
    print(f"📚 Regenerating vector store for: {course}")
    cmd = [
        "py", "-3.10", "langchain_indexer.py",
        pdf_path,
        index_path,
        store_path
    ]

    try:
        subprocess.run(cmd, check=True)
        print(f"✅ Success for {course}\n")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed for {course}: {e}\n")
