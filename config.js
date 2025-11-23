require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MONGO_URI: process.env.MONGO_URI,
  ADMIN_IDS: (process.env.ADMIN_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean),
  PAY0_API_KEY: process.env.PAY0_API_KEY,
  PAY0_WEBHOOK_SECRET: process.env.PAY0_WEBHOOK_SECRET,
  PORT: process.env.PORT || 3000
};
