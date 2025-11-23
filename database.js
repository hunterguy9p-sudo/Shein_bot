const mongoose = require('mongoose');
const { MONGO_URI } = require('../config');

async function connectDB() {
  await mongoose.connect(MONGO_URI, {
    autoIndex: true
  });
  console.log('✅ MongoDB connected');
}

module.exports = { connectDB };
