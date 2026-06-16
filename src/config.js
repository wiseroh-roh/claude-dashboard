const os = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR: path.join(CLAUDE_DIR, 'projects'),
  SESSION_STATS: path.join(CLAUDE_DIR, '.session-stats.json'),
  CLAUDE_JSON: process.env.CLAUDE_JSON || path.join(os.homedir(), '.claude.json'),
  MCP_AUTH_CACHE: path.join(CLAUDE_DIR, 'mcp-needs-auth-cache.json'),
  INSTALLED_PLUGINS: path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'),
  MARKETPLACES: path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json'),
  LAST_UPDATE_RESULT: path.join(CLAUDE_DIR, '.last-update-result.json'),
  SETTINGS: path.join(CLAUDE_DIR, 'settings.json'),
  TASKS_DIR: path.join(CLAUDE_DIR, 'tasks'),
  TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'sessions'),
  MEMORY_TRASH_DIR: path.join(CLAUDE_DIR, '.trash', 'memory'),
  PORT: Number(process.env.PORT) || 7878,
  POLL_MS: Number(process.env.POLL_MS) || 5000,
  RUNNING_THRESHOLD_MS: 60 * 1000,
  IDLE_THRESHOLD_MS: 30 * 60 * 1000,
};
