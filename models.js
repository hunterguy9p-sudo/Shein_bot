const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// USER
const userSchema = new Schema({
  tgId: { type: Number, unique: true, index: true },
  username: String,
  firstName: String,
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = model('User', userSchema);

// VOUCHER TYPE
const voucherTypeSchema = new Schema({
  name: String,        // "₹2000 Voucher"
  faceValue: Number,   // 2000
  price: Number,       // 70.0
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const VoucherType = model('VoucherType', voucherTypeSchema);

// VOUCHER CODES
const voucherCodeSchema = new Schema({
  voucherType: { type: Schema.Types.ObjectId, ref: 'VoucherType' },
  code: { type: String, unique: true },
  status: {
    type: String,
    enum: ['UNUSED', 'RESERVED', 'ASSIGNED', 'REDEEMED', 'REMOVED'],
    default: 'UNUSED'
  },
  order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  reservedUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const VoucherCode = model('VoucherCode', voucherCodeSchema);

// ORDER
const orderSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  voucherType: { type: Schema.Types.ObjectId, ref: 'VoucherType' },
  quantity: Number,
  unitPrice: Number,
  total: Number,
  status: {
    type: String,
    enum: [
      'PENDING_TERMS',
      'TERMS_ACCEPTED',
      'AWAITING_PAYMENT',
      'PAID',
      'CANCELLED',
      'EXPIRED'
    ],
    default: 'PENDING_TERMS'
  },
  paymentLink: String,
  paymentGatewayId: String,
  expiresAt: Date,
  createdAt: { type: Date, default: Date.now }
});

const Order = model('Order', orderSchema);

// COMPLAINT
const complaintSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  text: String,
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'CLOSED'],
    default: 'OPEN'
  },
  createdAt: { type: Date, default: Date.now }
});

const Complaint = model('Complaint', complaintSchema);

// ADMIN LOG
const adminLogSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User' },
  action: String,
  details: String,
  createdAt: { type: Date, default: Date.now }
});

const AdminLog = model('AdminLog', adminLogSchema);

module.exports = {
  User,
  VoucherType,
  VoucherCode,
  Order,
  Complaint,
  AdminLog
};
