const express = require('express');
const bodyParser = require('body-parser');
const { connectDB } = require('./database/connect');
const { createBot } = require('./bot/bot');
const { BOT_TOKEN, PORT } = require('./config');
const { Order, VoucherCode } = require('./database/models');
const { verifyWebhookSignature } = require('./payment/pay0');

async function start() {
  await connectDB();

  const bot = createBot(BOT_TOKEN);
  await bot.launch();
  console.log('🤖 Telegram bot launched');

  const app = express();
  app.use(bodyParser.json());

  // Pay0 webhook
  app.post('/webhook/pay0', async (req, res) => {
    try {
      const ok = await verifyWebhookSignature(req);
      if (!ok) {
        console.log('Invalid Pay0 signature');
        return res.status(401).send('Invalid signature');
      }

      // TODO: Pay0 payload ke hisaab se fields update karo
      const { reference_id, status } = req.body; // example

      if (status !== 'paid') {
        return res.status(200).send('ignored');
      }

      const orderId = reference_id;
      const order = await Order.findById(orderId).populate('user voucherType');
      if (!order) {
        return res.status(404).send('order not found');
      }
      if (order.status === 'PAID') {
        return res.status(200).send('already processed');
      }

      const reservedCodes = await VoucherCode.find({
        order: order._id,
        status: 'RESERVED'
      });

      if (reservedCodes.length < order.quantity) {
        return res.status(500).send('not enough reserved codes');
      }

      const ids = reservedCodes.map(c => c._id);
      await VoucherCode.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'ASSIGNED' } }
      );

      order.status = 'PAID';
      await order.save();

      const codesList = reservedCodes.map(c => `- \`${c.code}\``).join('\n');

      await bot.telegram.sendMessage(
        order.user.tgId,
        '✅ Payment received!\nHere are your voucher codes:\n\n' + codesList,
        { parse_mode: 'Markdown' }
      );

      return res.status(200).send('ok');
    } catch (err) {
      console.error('Pay0 webhook error:', err);
      return res.status(500).send('error');
    }
  });

  app.get('/', (req, res) => {
    res.send('Shein Voucher Bot running.');
  });

  app.listen(PORT, () => {
    console.log(`🌐 Express server listening on port ${PORT}`);
  });

  // Expiry checker – every minute release expired reservations
  setInterval(async () => {
    const now = new Date();
    const expiredOrders = await Order.find({
      status: 'AWAITING_PAYMENT',
      expiresAt: { $lt: now }
    });
    for (const order of expiredOrders) {
      await VoucherCode.updateMany(
        { order: order._id, status: 'RESERVED' },
        { $set: { status: 'UNUSED', order: null, reservedUntil: null } }
      );
      order.status = 'EXPIRED';
      await order.save();
      try {
        await bot.telegram.sendMessage(
          order.user.tgId,
          '⌛ Your voucher reservation has expired. Please create a new order if you still want vouchers.'
        );
      } catch (e) {
        console.log('Could not notify user about expiry:', e.message);
      }
    }
  }, 60 * 1000);
}

start().catch(err => {
  console.error(err);
  process.exit(1);
});
