import winston from 'winston';

function formatExtraArgs(extraArgs) {
  if (!extraArgs || extraArgs.length === 0) return '';

  const parts = extraArgs.map((value) => {
    if (!value) return String(value);

    // Handle Error-like objects
    if (typeof value === 'object' && typeof value.message === 'string' && typeof value.stack === 'string') {
      return value.stack || value.message;
    }

    if (typeof value === 'string') return value;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });

  return ` ${parts.join(' ')}`;
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => {
      const { timestamp, level, message } = info;
      const extraArgs = info[Symbol.for('splat')];
      const extras = formatExtraArgs(extraArgs);
      return `[${timestamp}] ${level.toUpperCase()}: ${message}${extras}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default logger;