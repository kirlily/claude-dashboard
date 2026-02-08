const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const CREDENTIALS_JSON = path.join(CLAUDE_DIR, '.credentials.json');
const STATS_CACHE = path.join(__dirname, 'stats-cache.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

app.use(express.static(path.join(__dirname, 'public')));

// Helper: safely read JSON file
function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Helper: parse a JSONL file and return array of JSON objects
function parseJSONL(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const results = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return results;
  } catch {
    return [];
  }
}

// Helper: find all session JSONL files (exclude subagents)
function findSessionFiles() {
  const sessionFiles = [];
  try {
    const projectDirs = fs.readdirSync(PROJECTS_DIR);
    for (const projDir of projectDirs) {
      const projPath = path.join(PROJECTS_DIR, projDir);
      if (!fs.statSync(projPath).isDirectory()) continue;
      const files = fs.readdirSync(projPath);
      for (const file of files) {
        if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
          sessionFiles.push(path.join(projPath, file));
        }
      }
    }
  } catch {
    // projects dir may not exist
  }
  return sessionFiles;
}

// Helper: extract session info from JSONL entries
function parseSessionData(filePath) {
  const entries = parseJSONL(filePath);
  const sessionId = path.basename(filePath, '.jsonl');

  let startTime = null;
  let endTime = null;
  let messageCount = 0;
  let displayName = null;
  const usageByModel = {};
  const toolCalls = [];
  let cwd = null;

  for (const entry of entries) {
    // Track timestamps
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!startTime || ts < startTime) startTime = ts;
      if (!endTime || ts > endTime) endTime = ts;
    }

    // Get session display name (slug)
    if (entry.slug && !displayName) {
      displayName = entry.slug;
    }

    // Get working directory
    if (entry.cwd && !cwd) {
      cwd = entry.cwd;
    }

    // Count user messages
    if (entry.type === 'user' && entry.message && entry.message.role === 'user') {
      // Only count external user messages, not tool results
      if (entry.userType === 'external' && typeof entry.message.content === 'string') {
        messageCount++;
      }
    }

    // Extract token usage from assistant messages
    if (entry.type === 'assistant' && entry.message && entry.message.usage) {
      const usage = entry.message.usage;
      const model = entry.message.model || 'unknown';

      if (!usageByModel[model]) {
        usageByModel[model] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        };
      }

      usageByModel[model].inputTokens += usage.input_tokens || 0;
      usageByModel[model].outputTokens += usage.output_tokens || 0;
      usageByModel[model].cacheCreationTokens += usage.cache_creation_input_tokens || 0;
      usageByModel[model].cacheReadTokens += usage.cache_read_input_tokens || 0;
    }

    // Track tool calls
    if (entry.type === 'assistant' && entry.message && entry.message.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolCalls.push(block.name);
          }
        }
      }
    }
  }

  // Calculate totals
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;

  for (const model of Object.keys(usageByModel)) {
    totalInputTokens += usageByModel[model].inputTokens;
    totalOutputTokens += usageByModel[model].outputTokens;
    totalCacheCreation += usageByModel[model].cacheCreationTokens;
    totalCacheRead += usageByModel[model].cacheReadTokens;
  }

  const totalTokens = totalInputTokens + totalOutputTokens + totalCacheCreation + totalCacheRead;

  return {
    sessionId,
    displayName,
    cwd,
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    durationMs: startTime && endTime ? endTime - startTime : 0,
    messageCount,
    toolCallCount: toolCalls.length,
    toolCalls: countOccurrences(toolCalls),
    usageByModel,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreation,
    totalCacheRead,
  };
}

function countOccurrences(arr) {
  const counts = {};
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
  }
  return counts;
}

// API: stats-cache.json data
app.get('/api/stats', (req, res) => {
  const stats = readJSON(STATS_CACHE);
  if (!stats) {
    return res.status(404).json({ error: 'stats-cache.json not found' });
  }
  res.json(stats);
});

// API: account info
app.get('/api/account', (req, res) => {
  const claudeJson = readJSON(CLAUDE_JSON);
  const credentials = readJSON(CREDENTIALS_JSON);

  const account = {};

  if (claudeJson) {
    if (claudeJson.oauthAccount) {
      account.displayName = claudeJson.oauthAccount.displayName || null;
      account.email = claudeJson.oauthAccount.emailAddress || null;
      account.accountCreatedAt = claudeJson.oauthAccount.accountCreatedAt || null;
      account.subscriptionCreatedAt = claudeJson.oauthAccount.subscriptionCreatedAt || null;
      account.organizationName = claudeJson.oauthAccount.organizationName || null;
      account.billingType = claudeJson.oauthAccount.billingType || null;
    }
    account.firstStartTime = claudeJson.firstStartTime || null;
    account.installMethod = claudeJson.installMethod || null;
  }

  if (credentials && credentials.claudeAiOauth) {
    account.subscriptionType = credentials.claudeAiOauth.subscriptionType || null;
    account.rateLimitTier = credentials.claudeAiOauth.rateLimitTier || null;
  }

  res.json(account);
});

// API: sessions data
app.get('/api/sessions', (req, res) => {
  const sessionFiles = findSessionFiles();
  const sessions = [];

  for (const file of sessionFiles) {
    try {
      const session = parseSessionData(file);
      if (session.startTime) {
        sessions.push(session);
      }
    } catch {
      // skip files that can't be parsed
    }
  }

  // Sort by start time, most recent first
  sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

  res.json(sessions);
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
