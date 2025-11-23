const { connectDB } = require('./database/connect');
const { VoucherType } = require('./database/models');

async function seed() {
  await connectDB();
  const existing = await VoucherType.countDocuments();
  if (existing) {
    console.log('VoucherTypes already exist, skipping seed.');
    process.exit(0);
  }

  await VoucherType.insertMany([
    { name: '₹1000 Voucher', faceValue: 1000, price: 40 },
    { name: '₹2000 Voucher', faceValue: 2000, price: 70 },
    { name: '₹4000 Voucher', faceValue: 4000, price: 140 }
  ]);

  console.log('Seeded voucher types.');
  process.exit(0);
}

seed();
