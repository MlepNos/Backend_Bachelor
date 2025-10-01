CREATE TABLE IF NOT EXISTS Memory (
  Key TEXT PRIMARY KEY,
  Value TEXT
);

CREATE TABLE IF NOT EXISTS Conversations (
  Id SERIAL PRIMARY KEY,
  Title TEXT,
  CreatedAt TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Messages (
  Id SERIAL PRIMARY KEY,
  ConversationId INTEGER REFERENCES Conversations(Id),
  Role TEXT,
  Content TEXT,
  Timestamp TIMESTAMP
);


CREATE TABLE Files (
  id SERIAL PRIMARY KEY,
  filename TEXT,
  original_name TEXT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);