import sys
import traceback

from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain.chains import LLMChain
from langchain_community.llms import Ollama
from langchain.prompts import PromptTemplate

print("Arguments:", sys.argv, file=sys.stderr)

if len(sys.argv) < 3:
    print("Usage: python langchain_query.py <message> <index_dir> [mode]", file=sys.stderr)
    sys.exit(1)

message = sys.argv[1]
index_dir = sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "chat"
print(f"Mode: {mode}", file=sys.stderr)

# Load previous conversation history
history = ""
try:
    with open("history.txt", "r", encoding="utf-8") as f:
        history = f.read()
except FileNotFoundError:
    print("No history.txt found. Starting fresh.", file=sys.stderr)

# Load vector store
embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

try:
    print("Loading vector store from:", index_dir, file=sys.stderr)
    vectorstore = FAISS.load_local(index_dir, embedding_model, allow_dangerous_deserialization=True)

    print("Searching similar documents...", file=sys.stderr)
    docs = vectorstore.similarity_search(message, k=4)

    print(" Querying with message:", message)
    print(" Index loaded from:", index_dir)
    print(" Top match snippet:", docs[0].page_content[:200] if docs else "No results found")

    context = "\n\n".join(doc.page_content for doc in docs)
    print("Context length:", len(context), file=sys.stderr)

    # LLM setup
    llm = Ollama(model="llama3:3b", base_url="http://localhost:11434")
    print("LLM loaded", file=sys.stderr)

    if mode == "quiz":
        prompt_template = PromptTemplate(
            input_variables=["history", "context", "question"],
            template="""
You are a helpful tutor. Keep track of the ongoing conversation and be aware of whether you asked a question.

If the last thing you said was a question, expect the student to reply with an answer.
If the student gives an answer, evaluate if it is correct and explain why.
If not, continue the conversation helpfully or ask a new question.

Use this format when asking:
Question: <question text>
Answer: <correct answer>

Conversation:
{history}

Student's latest message:
{question}

Reply:
"""
        )
    else:
       prompt_template = PromptTemplate(
    input_variables=["history", "context", "question"],
    template="""
You are a helpful tutor. You are answering based on the following course material:

{context}

Respond clearly and naturally to the student's question using only the information above.
If the question is broad (e.g. "What is the document about?"), provide a concise summary based on the beginning or title of the document.
Avoid copying exact text. Rephrase naturally like a human would.

If the answer cannot be found, say: "I'm not sure based on the document."

Conversation history:
{history}

Student asks:
{question}

Your response:
"""
)





    chain = LLMChain(llm=llm, prompt=prompt_template)
    print("Generating response...", file=sys.stderr)
    response = chain.run(history=history, context=context, question=message)

    # Save updated history
    try:
        with open("history.txt", "a", encoding="utf-8") as f:
            f.write(f"\nStudent: {message}\nAI: {response.strip()}\n")
    except Exception:
        print("Warning: could not update history.", file=sys.stderr)
        traceback.print_exc()

    # ✅ FINAL CLEAN OUTPUT ONLY
    print(response.strip(), file=sys.stdout)


except Exception as e:
    print("Vector load failed. Falling back to direct model response.", file=sys.stderr)
    traceback.print_exc()
    try:
        llm = Ollama(model="llama2:13b")
        response = llm.invoke(message)
        print(response.strip())
    except Exception:
        print("Unable to respond at the moment.", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
