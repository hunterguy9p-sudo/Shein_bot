const axios = require('axios');
const { PAY0_API_KEY } = require('../config');

// TODO: Pay0 docs se correct base URL lo agar alag ho
const PAY0_BASE_URL = 'https://app.pay0.shop';

const client = axios.create({
  baseURL: PAY0_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAY0_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function createPaymentLink(order) {
  // 👉 Yahan Pay0 ki real API spec ke hisaab se payload banao.
  // Neeche example structure hai – docs ke fields se replace karna:

  /*
  const payload = {
    amount: order.total,
    currency: 'INR',
    reference_id: String(order._id),
    notes: { orderId: String(order._id) },
    callback_url: 'https://YOUR_DOMAIN/webhook/pay0'
  };

  const res = await client.post('/api/payment-link', payload);
  return {
    link: res.data.short_url,
    gatewayId: res.data.id
  };
  */

  // 🔧 Abhi ke liye dummy (testing only):
  return {
    link: `${PAY0_BASE_URL}/demo-pay/${order._id}`,
    gatewayId: `demo-${order._id}`
  };
}

// Webhook signature verify – Pay0 docs ke hisaab se implement karo
async function verifyWebhookSignature(req) {
  // Example:
  // const signature = req.headers['x-pay0-signature'];
  // const rawBody = JSON.stringify(req.body);
  // HMAC compare with PAY0_WEBHOOK_SECRET, etc.

  // Testing ke liye direct true:
  return true;
}

module.exports = {
  createPaymentLink,
  verifyWebhookSignature
};
