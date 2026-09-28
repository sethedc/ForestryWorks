const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = () => LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// Cloud Logging picks up severity and message from structured JSON on stdout.
function write(severity, message, fields = {}) {
  if (LEVELS[severity.toLowerCase()] < threshold()) return;
  const entry = { severity: severity.toUpperCase(), message, ...fields };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields)
};
