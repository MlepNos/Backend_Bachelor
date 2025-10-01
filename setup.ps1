<#
  setup.ps1 - one-time bootstrap for Windows
  Run from repo root:
    PowerShell:
      Set-ExecutionPolicy Bypass -Scope Process -Force; ./setup.ps1
#>

$ErrorActionPreference = 'Stop'

function H($t){ Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function OK($t){ Write-Host "OK  $t" -ForegroundColor Green }
function Warn($t){ Write-Host "WARN $t" -ForegroundColor Yellow }
function Fail($t){ Write-Host "FAIL $t" -ForegroundColor Red }

# 0) Sanity: repo root
if (-not (Test-Path .\server2.mjs)) { Fail "Run from the repo root (server2.mjs not found)."; exit 1 }

# 1) Generate .env (if missing)
H 'env'
$envPath = '.\.env'
if (-not (Test-Path $envPath)) {
  $envText = @'
# Backend environment
# Choose: postgres | mssql
DB_TYPE=postgres

# MSSQL
MSSQL_USER=sa
MSSQL_PASSWORD=Your_Password123
MSSQL_SERVER=localhost
MSSQL_DATABASE=AI

# Postgres
PG_USER=postgres
PG_PASSWORD=211021
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=smartdb
'@
  $envText | Set-Content -Path $envPath -Encoding UTF8
  OK '.env created (edit DB_TYPE / credentials if needed)'
} else {
  OK '.env already exists'
}

# 2) Node deps
H 'Node.js dependencies'
$node = (node -v) 2>$null
if (-not $node) { Fail 'Node not found. Install Node 18+ (https://nodejs.org) and re-run.'; exit 1 }
Write-Host "Node: $node"
if (Test-Path .\package-lock.json) { npm ci } else { npm install }
try { npm audit fix | Out-Null } catch { Warn 'npm audit fix skipped.' }
OK 'Node packages installed'

# 3) Python 3.10 and libraries
H 'Python 3.10 and libraries'
try { & py -3.10 --version | Out-Null } catch { Fail "Python 3.10 (launcher) not found. Install Python 3.10 with 'py' launcher."; exit 1 }
py -3.10 -m pip install --upgrade pip
py -3.10 -m pip install `
  langchain langchain-community sentence-transformers faiss-cpu PyPDF2 pdfminer.six `
  openai-whisper sounddevice scipy pyttsx3
OK 'Python packages installed'

# 4) ffmpeg
H 'ffmpeg'
$ffmpegOK = $true
try { ffmpeg -version | Out-Null } catch { $ffmpegOK = $false }
if (-not $ffmpegOK) {
  Warn 'ffmpeg not found on PATH. Install: winget install --id Gyan.FFmpeg -e'
} else { OK 'ffmpeg present' }

# 5) Ollama
H 'Ollama'
$ollamaOK = $true
try { ollama --version | Out-Null } catch { $ollamaOK = $false }
if (-not $ollamaOK) {
  Warn 'Ollama CLI not found. Install from https://ollama.com/download then run: ollama pull llama3:8b'
} else {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:11434/api/tags' -TimeoutSec 2
    if ($resp.StatusCode -ne 200) { Warn 'Ollama daemon not responding on 11434. Start it via Ollama Desktop or "ollama serve".' }
  } catch { Warn 'Ollama daemon not reachable (ok for now).' }
  Write-Host 'Pulling model llama3:8b if needed...' -ForegroundColor Gray
  try { ollama pull llama3:8b } catch { Warn 'Could not pull model automatically; run "ollama pull llama3:8b" later.' }
  OK 'Ollama ready (once the daemon is running)'
}

# 6) Project folders
H 'Project folders'
$audioDir = 'C:\Users\mehme\Documents\Unreal Projects\Bachelor\generated'
$dirs = @(
  $audioDir,
  '.\knowledge_base',
  '.\uploads',
  '.\sessions',
  '.\quiz_memory'
)
foreach ($d in $dirs) {
  New-Item -Force -ItemType Directory -Path $d | Out-Null
  OK "Created or exists: $((Resolve-Path $d).Path)"
}

# 7) Database schema
H 'Database schema'
$DB_TYPE = (Get-Content $envPath | Where-Object { $_ -match '^DB_TYPE=' }) -replace 'DB_TYPE=',''
$DB_TYPE = $DB_TYPE.Trim()

if ($DB_TYPE -eq 'postgres') {
  $PG_USER     = (Select-String -Path $envPath -Pattern '^PG_USER=').Line.Split('=')[1].Trim()
  $PG_PASSWORD = (Select-String -Path $envPath -Pattern '^PG_PASSWORD=').Line.Split('=')[1].Trim()
  $PG_HOST     = (Select-String -Path $envPath -Pattern '^PG_HOST=').Line.Split('=')[1].Trim()
  $PG_PORT     = (Select-String -Path $envPath -Pattern '^PG_PORT=').Line.Split('=')[1].Trim()
  $PG_DATABASE = (Select-String -Path $envPath -Pattern '^PG_DATABASE=').Line.Split('=')[1].Trim()

  $schemaPg = @'
CREATE TABLE IF NOT EXISTS conversations(
  id SERIAL PRIMARY KEY,
  title TEXT,
  createdat TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS messages(
  id SERIAL PRIMARY KEY,
  conversationid INTEGER REFERENCES conversations(id),
  role TEXT,
  content TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS files(
  id SERIAL PRIMARY KEY,
  filename TEXT,
  original_name TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);
'@
  $pgFile = Join-Path (Get-Location) 'db_schema_postgres.sql'
  $schemaPg | Set-Content -Path $pgFile -Encoding UTF8

  $env:PGPASSWORD = $PG_PASSWORD
  $psqlArgs = @(
    '-h', $PG_HOST, '-p', $PG_PORT, '-U', $PG_USER,
    '-d', $PG_DATABASE, '-v', 'ON_ERROR_STOP=1',
    '-f', $pgFile
  )
  try {
    & psql @psqlArgs | Out-Null
    OK 'Postgres schema applied'
  } catch {
    Warn 'Postgres schema apply failed. Ensure psql is installed and credentials are correct.'
  }

} elseif ($DB_TYPE -eq 'mssql') {

  $MSSQL_USER     = (Select-String -Path $envPath -Pattern '^MSSQL_USER=').Line.Split('=')[1].Trim()
  $MSSQL_PASSWORD = (Select-String -Path $envPath -Pattern '^MSSQL_PASSWORD=').Line.Split('=')[1].Trim()
  $MSSQL_SERVER   = (Select-String -Path $envPath -Pattern '^MSSQL_SERVER=').Line.Split('=')[1].Trim()
  $MSSQL_DATABASE = (Select-String -Path $envPath -Pattern '^MSSQL_DATABASE=').Line.Split('=')[1].Trim()

  $schemaMs = @'
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N''[dbo].[Conversations]'') AND type in (N''U''))
CREATE TABLE Conversations(
  Id INT IDENTITY(1,1) PRIMARY KEY,
  Title NVARCHAR(MAX),
  CreatedAt DATETIME DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N''[dbo].[Messages]'') AND type in (N''U''))
CREATE TABLE Messages(
  Id INT IDENTITY(1,1) PRIMARY KEY,
  ConversationId INT FOREIGN KEY REFERENCES Conversations(Id),
  Role NVARCHAR(50),
  Content NVARCHAR(MAX),
  Timestamp DATETIME DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N''[dbo].[Files]'') AND type in (N''U''))
CREATE TABLE Files(
  Id INT IDENTITY(1,1) PRIMARY KEY,
  filename NVARCHAR(MAX),
  original_name NVARCHAR(MAX),
  uploaded_at DATETIME DEFAULT GETDATE()
);
'@
  $msFile = Join-Path (Get-Location) 'db_schema_mssql.sql'
  $schemaMs | Set-Content -Path $msFile -Encoding UTF8

  try {
    sqlcmd -S $MSSQL_SERVER -d $MSSQL_DATABASE -U $MSSQL_USER -P $MSSQL_PASSWORD -b -i $msFile | Out-Null
    OK 'MSSQL schema applied'
  } catch {
    Warn 'MSSQL schema apply failed. Ensure SQLCMD utilities are installed and credentials are correct.'
  }

} else {
  Warn "Unsupported DB_TYPE '$DB_TYPE' in .env. Edit .env and set DB_TYPE=postgres or mssql."
}

# 8) Finish
H 'Setup complete'
Write-Host 'Start backend:' -ForegroundColor White
Write-Host '  node server2.mjs' -ForegroundColor Green

Write-Host ''
Write-Host 'Then upload a PDF to build an index:' -ForegroundColor White
Write-Host '  curl -X POST http://localhost:3003/api/upload-pdf -F "course=vorkurs_chemie" -F "file=@C:\path\to\file.pdf"' -ForegroundColor Gray

Write-Host ''
Write-Host 'Ask a question:' -ForegroundColor White
Write-Host '  curl -X POST http://localhost:3003/api/semantic-chat -H "Content-Type: application/json" -d "{\"course\":\"vorkurs_chemie\",\"message\":\"What is a buffer?\"}"' -ForegroundColor Gray
