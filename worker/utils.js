import crypto from 'node:crypto';

export const generateClientId = () => {
  try {
    return (crypto.randomBytes(8).toString('hex'));
  } catch (error) {
    logEvent('generateClientId', error, 'error');
    return (null);
  }
};

export const encryptMessage = (message, key) => {

  let encrypted = '';

  try {

    const messageBuffer = Buffer.from(JSON.stringify(message), 'utf8');
    
    // Match server.js padding logic exactly
    const paddedBuffer = (messageBuffer.length % 16) !== 0 ?
      Buffer.concat([messageBuffer, Buffer.alloc(16 - (messageBuffer.length % 16))]) :
      messageBuffer;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);

    encrypted = iv.toString('base64') + '|' + cipher.update(paddedBuffer, '', 'base64') + cipher.final('base64');

  } catch (error) {
    logEvent('encryptMessage', error, 'error');
  }

  return (encrypted);

};

export const decryptMessage = (message, key) => {

  let decrypted = {};

  try {

    const parts = message.split('|');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      key,
      Buffer.from(parts[0], 'base64')
    );

    decipher.setAutoPadding(false);

    const decryptedText = decipher.update(parts[1], 'base64', 'utf8') + decipher.final('utf8');
    decrypted = JSON.parse(decryptedText.replace(/\0+$/, ''));

  } catch (error) {
    logEvent('decryptMessage', error, 'error');
  }

  return (decrypted);

};

// 日志级别开关：默认只输出 warn 及以上，避免 debug/trace 把消息内容带进日志
const LOG_LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

let currentLogLevel = 'warn';

export const setLogLevel = (level) => {
  if (Object.prototype.hasOwnProperty.call(LOG_LEVELS, level)) {
    currentLogLevel = level;
  }
};

export const logEvent = (source, message, level) => {
  const messageLevel = level && Object.prototype.hasOwnProperty.call(LOG_LEVELS, level) ? level : 'info';

  if (LOG_LEVELS[messageLevel] < LOG_LEVELS[currentLogLevel]) {
    return;
  }

  const date = new Date(),
    dateString = date.getFullYear() + '-' +
    ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
    ('0' + date.getDate()).slice(-2) + ' ' +
    ('0' + date.getHours()).slice(-2) + ':' +
    ('0' + date.getMinutes()).slice(-2) + ':' +
    ('0' + date.getSeconds()).slice(-2);

  console.log('[' + dateString + ']', messageLevel.toUpperCase(), source + (message ? ':' : ''), (message ? message : ''));
};

export const getTime = () => {
  return (new Date().getTime());
};

export const isString = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object String]' ?
    true :
    false
  );
};

export const isArray = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object Array]' ?
    true :
    false
  );
};

export const isObject = (value) => {
  return (
    value &&
    Object.prototype.toString.call(value) === '[object Object]' ?
    true :
    false
  );
};

// Note: Since Cloudflare Workers don't have access to global.gc,
// we're not including the garbage collection interval that's in server.js
// setInterval(() => {
//   if (global.gc) {
//     global.gc();
//   }
// }, 30000);