const { Telegraf, Markup } = require('telegraf');
const {
  User,
  VoucherType,
  VoucherCode,
  Order,
  Complaint,
  AdminLog
} = require('../database/models');
const { ADMIN_IDS } = require('../config');
const { createPaymentLink } = require('../payment/pay0');

const userState = new Map(); // per-user in-memory state

function isAdminTg(tgId) {
  return ADMIN_IDS.includes(String(tgId));
}

async function getOrCreateUser(ctx) {
  const tgUser = ctx.from;
  let user = await User.findOne({ tgId: tgUser.id });
  if (!user) {
    user = await User.create({
      tgId: tgUser.id,
      username: tgUser.username,
      firstName: tgUser.first_name,
      isAdmin: isAdminTg(tgUser.id)
    });
  } else if (isAdminTg(tgUser.id) && !user.isAdmin) {
    user.isAdmin = true;
    await user.save();
  }
  return user;
}

function mainMenuKeyboard(isAdmin) {
  const buttons = [
    [Markup.button.callback('🛒 Buy Vouchers', 'BUY')],
    [Markup.button.callback('📦 Available Stock', 'STOCK')],
    [Markup.button.callback('❓ Raise Ticket', 'TICKET')]
  ];
  if (isAdmin) {
    buttons.push([Markup.button.callback('🛠 Admin Panel', 'ADMIN_PANEL')]);
  }
  return Markup.inlineKeyboard(buttons);
}

function adminMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📥 Add Stock', 'ADMIN_ADD_STOCK'),
      Markup.button.callback('📤 Remove Stock', 'ADMIN_REMOVE_STOCK')
    ],
    [
      Markup.button.callback('💰 Change Prices', 'ADMIN_CHANGE_PRICE')
    ],
    [
      Markup.button.callback('📜 Order History', 'ADMIN_ORDERS'),
      Markup.button.callback('🐞 Complaints', 'ADMIN_COMPLAINTS')
    ],
    [
      Markup.button.callback('➕ Add Admin', 'ADMIN_ADD_ADMIN')
    ]
  ]);
}

function setState(userId, state, data = {}) {
  userState.set(userId, { state, data });
}

function getState(userId) {
  return userState.get(userId) || { state: null, data: {} };
}

function clearState(userId) {
  userState.delete(userId);
}

function createBot(token) {
  const bot = new Telegraf(token);

  // /start
  bot.start(async ctx => {
    const user = await getOrCreateUser(ctx);

    const text =
      '🎁 *Welcome to Shein Verse Voucher Bot!*\n\n' +
      'Pricing examples (you can change in admin panel):\n' +
      '• ₹1000 Voucher\n' +
      '• ₹2000 Voucher\n' +
      '• ₹4000 Voucher\n\n' +
      'Use the buttons below to get started! 🚀\n\n' +
      '🚨 _DISCLAIMER: Vouchers are only applicable on eligible products._';

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(user.isAdmin)
    });
  });

  // Main menu buttons
  bot.action('BUY', async ctx => {
    await ctx.answerCbQuery();
    const vTypes = await VoucherType.find({ active: true }).sort('faceValue');

    if (!vTypes.length) {
      return ctx.reply('No voucher types configured yet.');
    }

    const buttons = vTypes.map(vt => [
      Markup.button.callback(`💸 ₹${vt.faceValue} Voucher`, `BUY_DENOM_${vt._id}`)
    ]);
    buttons.push([Markup.button.callback('❌ Cancel', 'CANCEL_FLOW')]);

    await ctx.reply(
      'Please select the voucher denomination you wish to buy:',
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action('STOCK', async ctx => {
    await ctx.answerCbQuery();
    const vTypes = await VoucherType.find({ active: true });

    const lines = ['📦 *Current Stock*'];
    for (const vt of vTypes) {
      const available = await VoucherCode.countDocuments({
        voucherType: vt._id,
        status: 'UNUSED'
      });
      const reserved = await VoucherCode.countDocuments({
        voucherType: vt._id,
        status: 'RESERVED'
      });
      lines.push(
        `• ₹${vt.faceValue}: ${available} available, ${reserved} reserved`
      );
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.action('TICKET', async ctx => {
    await ctx.answerCbQuery();
    const u = await getOrCreateUser(ctx);
    setState(u.tgId, 'TYPING_TICKET', {});
    await ctx.reply(
      'Please describe your issue clearly (e.g. "Voucher not working", "Payment error, UTR 1234").\n\nSend your message now. /cancel to abort.'
    );
  });

  bot.command('cancel', async ctx => {
    clearState(ctx.from.id);
    await ctx.reply(
      '❌ Operation cancelled. Back to main menu.',
      mainMenuKeyboard(isAdminTg(ctx.from.id))
    );
  });

  // BUY – choose denomination
  bot.action(/BUY_DENOM_(.+)/, async ctx => {
    await ctx.answerCbQuery();
    const vtId = ctx.match[1];
    const vt = await VoucherType.findById(vtId);
    if (!vt) return ctx.reply('Voucher type not found.');

    const available = await VoucherCode.countDocuments({
      voucherType: vt._id,
      status: 'UNUSED'
    });

    const u = await getOrCreateUser(ctx);
    setState(u.tgId, 'ENTER_QTY', { voucherTypeId: vt._id.toString() });

    await ctx.replyWithMarkdown(
      `💸 *₹${vt.faceValue} Voucher*\n` +
        `Available: ${available}\n\n` +
        `Pricing:\n• All quantities: \`₹${vt.price}\` each\n\n` +
        '🔢 Enter quantity (min 1, max 20):'
    );
  });

  // Text messages -> depends on state
  bot.on('text', async ctx => {
    const u = await getOrCreateUser(ctx);
    const current = getState(u.tgId);
    const text = ctx.message.text.trim();

    if (!current.state) {
      return;
    }

    // Complaint
    if (current.state === 'TYPING_TICKET') {
      const comp = await Complaint.create({
        user: u._id,
        text
      });
      clearState(u.tgId);
      await ctx.reply(
        `✅ Your complaint has been recorded. Ticket ID: #${comp._id.toString().slice(-5)}`
      );
      return;
    }

    // Enter quantity
    if (current.state === 'ENTER_QTY') {
      if (!/^\d+$/.test(text)) {
        return ctx.reply('Please send a valid number (1–20).');
      }
      const qty = parseInt(text, 10);
      if (qty < 1 || qty > 20) {
        return ctx.reply('Quantity must be between 1 and 20.');
      }

      const vt = await VoucherType.findById(current.data.voucherTypeId);
      if (!vt) {
        clearState(u.tgId);
        return ctx.reply('Voucher type not found.');
      }

      const available = await VoucherCode.countDocuments({
        voucherType: vt._id,
        status: 'UNUSED'
      });
      if (available < qty) {
        clearState(u.tgId);
        return ctx.reply(
          `Sorry, only ${available} voucher(s) available right now.`
        );
      }

      const total = qty * vt.price;
      const order = await Order.create({
        user: u._id,
        voucherType: vt._id,
        quantity: qty,
        unitPrice: vt.price,
        total,
        status: 'PENDING_TERMS'
      });

      setState(u.tgId, 'AWAIT_TERMS', { orderId: order._id.toString() });

      const terms =
        '📜 *TERMS AND CONDITIONS*\n' +
        '1. This service is provided for educational purposes only.\n' +
        '2. We are not liable for any issues that may arise from using these vouchers.\n' +
        '3. No refunds or replacements will be provided under any circumstances.\n' +
        '4. By proceeding you agree to these terms.\n';

      await ctx.replyWithMarkdown(
        `🛒 *Order Summary (₹${vt.faceValue})*\n` +
          `Quantity: ${qty}\n` +
          `Price each: ₹${vt.price.toFixed(2)}\n` +
          `*TOTAL: ₹${total.toFixed(2)}*\n\n` +
          '⏱ Vouchers will be reserved for you for 5 minutes after you agree to the terms.\n\n' +
          terms +
          '\nDo you agree to the terms?',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ I Agree', 'TERMS_AGREE'),
            Markup.button.callback('❌ I Disagree', 'TERMS_DISAGREE')
          ]
        ])
      );
      return;
    }

    // Admin: add stock (codes input)
    if (current.state === 'ADMIN_ADD_CODES') {
      const vtId = current.data.voucherTypeId;
      const vt = await VoucherType.findById(vtId);
      if (!vt) {
        clearState(u.tgId);
        return ctx.reply('Voucher type not found.');
      }

      const codes = text
        .split('\n')
        .map(c => c.trim())
        .filter(Boolean);

      const docs = codes.map(code => ({
        voucherType: vt._id,
        code
      }));

      await VoucherCode.insertMany(docs, { ordered: false }).catch(() => {});

      await AdminLog.create({
        admin: u._id,
        action: 'ADD_STOCK',
        details: `Voucher ₹${vt.faceValue}, +${codes.length} codes`
      });

      clearState(u.tgId);
      return ctx.reply(
        `✅ Added ${codes.length} codes to stock for ₹${vt.faceValue} vouchers.`
      );
    }

    // Admin: remove stock quantity
    if (current.state === 'ADMIN_REMOVE_QTY') {
      if (!/^\d+$/.test(text)) {
        return ctx.reply('Send a valid number.');
      }
      const qty = parseInt(text, 10);
      const vt = await VoucherType.findById(current.data.voucherTypeId);
      if (!vt) {
        clearState(u.tgId);
        return ctx.reply('Voucher type not found.');
      }
      const unused = await VoucherCode.find({
        voucherType: vt._id,
        status: 'UNUSED'
      })
        .limit(qty)
        .exec();

      if (unused.length < qty) {
        clearState(u.tgId);
        return ctx.reply(
          `Only ${unused.length} unused codes available for removal.`
        );
      }

      const ids = unused.map(c => c._id);
      await VoucherCode.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'REMOVED' } }
      );

      await AdminLog.create({
        admin: u._id,
        action: 'REMOVE_STOCK',
        details: `Voucher ₹${vt.faceValue}, -${qty} codes (marked REMOVED)`
      });

      clearState(u.tgId);
      return ctx.reply(
        `✅ Marked ${qty} codes as removed for ₹${vt.faceValue} vouchers.`
      );
    }

    // Admin: change price
    if (current.state === 'ADMIN_CHANGE_PRICE') {
      const val = Number(text);
      if (Number.isNaN(val) || val <= 0) {
        return ctx.reply('Send a valid positive number.');
      }
      const vt = await VoucherType.findById(current.data.voucherTypeId);
      if (!vt) {
        clearState(u.tgId);
        return ctx.reply('Voucher type not found.');
      }
      const old = vt.price;
      vt.price = val;
      await vt.save();

      await AdminLog.create({
        admin: u._id,
        action: 'CHANGE_PRICE',
        details: `Voucher ₹${vt.faceValue}: ${old} -> ${val}`
      });

      clearState(u.tgId);
      return ctx.reply(
        `✅ Price updated for ₹${vt.faceValue}: ₹${old} → ₹${val}`
      );
    }

    // Admin: add admin
    if (current.state === 'ADMIN_ADD_ADMIN') {
      if (!/^\d+$/.test(text)) {
        return ctx.reply('Send numeric Telegram user ID.');
      }
      const tgId = Number(text);
      let user = await User.findOne({ tgId });
      if (!user) {
        user = await User.create({ tgId, isAdmin: true });
      } else {
        user.isAdmin = true;
        await user.save();
      }
      await AdminLog.create({
        admin: u._id,
        action: 'ADD_ADMIN',
        details: `Added admin tgId=${tgId}`
      });
      clearState(u.tgId);
      return ctx.reply(`✅ User ${tgId} is now an admin.`);
    }
  });

  // Terms buttons
  bot.action('TERMS_DISAGREE', async ctx => {
    await ctx.answerCbQuery();
    const uId = ctx.from.id;
    const s = getState(uId);
    if (!s.data.orderId) return ctx.reply('Order not found.');
    await Order.findByIdAndUpdate(s.data.orderId, { status: 'CANCELLED' });
    clearState(uId);
    await ctx.reply('Order cancelled because you disagreed with the terms.');
  });

  bot.action('TERMS_AGREE', async ctx => {
    await ctx.answerCbQuery();
    const uId = ctx.from.id;
    const s = getState(uId);
    if (!s.data.orderId) return ctx.reply('Order not found.');

    const order = await Order.findById(s.data.orderId).populate('voucherType');
    if (!order) {
      clearState(uId);
      return ctx.reply('Order not found.');
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 5 * 60 * 1000);

    const availableCodes = await VoucherCode.find({
      voucherType: order.voucherType._id,
      status: 'UNUSED'
    })
      .limit(order.quantity)
      .exec();

    if (availableCodes.length < order.quantity) {
      order.status = 'CANCELLED';
      await order.save();
      clearState(uId);
      return ctx.reply('Stock ran out while you were reading the terms.');
    }

    const ids = availableCodes.map(c => c._id);
    await VoucherCode.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'RESERVED', order: order._id, reservedUntil: expires } }
    );

    order.status = 'AWAITING_PAYMENT';
    order.expiresAt = expires;
    await order.save();

    await ctx.replyWithMarkdown(
      '✅ I Agree\n\n' +
        '🔒 Your vouchers are reserved for *5 minutes*.\n' +
        'Please confirm your order:',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Confirm Order', 'CONFIRM_ORDER'),
          Markup.button.callback('❌ Cancel', 'CANCEL_ORDER')
        ]
      ])
    );
  });

  bot.action('CANCEL_ORDER', async ctx => {
    await ctx.answerCbQuery();
    const uId = ctx.from.id;
    const s = getState(uId);
    if (!s.data.orderId) return ctx.reply('Order not found.');

    const order = await Order.findById(s.data.orderId);
    if (order) {
      await VoucherCode.updateMany(
        { order: order._id, status: 'RESERVED' },
        { $set: { status: 'UNUSED', order: null, reservedUntil: null } }
      );
      order.status = 'CANCELLED';
      await order.save();
    }
    clearState(uId);
    await ctx.reply('❌ Order cancelled.');
  });

  bot.action('CONFIRM_ORDER', async ctx => {
    await ctx.answerCbQuery();
    const uId = ctx.from.id;
    const s = getState(uId);
    if (!s.data.orderId) return ctx.reply('Order not found.');

    const order = await Order.findById(s.data.orderId).populate('voucherType');
    if (!order) {
      clearState(uId);
      return ctx.reply('Order not found.');
    }

    const { link, gatewayId } = await createPaymentLink(order);
    order.paymentLink = link;
    order.paymentGatewayId = gatewayId;
    await order.save();

    await ctx.replyWithMarkdown(
      '✅ *Order Confirmed*\n' +
        `*TOTAL: ₹${order.total.toFixed(2)}*\n\n` +
        '🔗 Click the link to complete payment:\n' +
        `${link}\n\n` +
        'You will receive your voucher codes automatically after payment is confirmed.\n' +
        '_Reservation valid for 5 minutes._'
    );

    clearState(uId);
  });

  // Admin panel entry
  bot.action('ADMIN_PANEL', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) {
      return ctx.reply('⛔ You are not an admin.');
    }
    await ctx.replyWithMarkdown('🛠 *Admin Panel*', adminMenuKeyboard());
  });

  // Admin actions (choose voucher type etc.)
  bot.action('ADMIN_ADD_STOCK', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vTypes = await VoucherType.find({ active: true }).sort('faceValue');
    const buttons = vTypes.map(vt => [
      Markup.button.callback(`₹${vt.faceValue}`, `ADMIN_ADD_STOCK_${vt._id}`)
    ]);
    await ctx.reply(
      'Select voucher type to *add* stock (paste codes next):',
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action(/ADMIN_ADD_STOCK_(.+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vtId = ctx.match[1];
    const user = await getOrCreateUser(ctx);
    setState(user.tgId, 'ADMIN_ADD_CODES', { voucherTypeId: vtId });
    await ctx.reply(
      'Send voucher codes to add.\nEach code on a new line:\n\nCODE1\nCODE2\nCODE3'
    );
  });

  bot.action('ADMIN_REMOVE_STOCK', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vTypes = await VoucherType.find({ active: true }).sort('faceValue');
    const buttons = vTypes.map(vt => [
      Markup.button.callback(`₹${vt.faceValue}`, `ADMIN_REMOVE_STOCK_${vt._id}`)
    ]);
    await ctx.reply(
      'Select voucher type to *remove* stock:',
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action(/ADMIN_REMOVE_STOCK_(.+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vtId = ctx.match[1];
    const user = await getOrCreateUser(ctx);
    setState(user.tgId, 'ADMIN_REMOVE_QTY', { voucherTypeId: vtId });
    await ctx.reply('Send quantity of codes to remove (mark as REMOVED).');
  });

  bot.action('ADMIN_CHANGE_PRICE', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vTypes = await VoucherType.find({ active: true }).sort('faceValue');
    const buttons = vTypes.map(vt => [
      Markup.button.callback(`₹${vt.faceValue}`, `ADMIN_CHANGE_PRICE_${vt._id}`)
    ]);
    await ctx.reply(
      'Select voucher type to change price:',
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action(/ADMIN_CHANGE_PRICE_(.+)/, async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const vtId = ctx.match[1];
    const vt = await VoucherType.findById(vtId);
    const user = await getOrCreateUser(ctx);
    setState(user.tgId, 'ADMIN_CHANGE_PRICE', { voucherTypeId: vtId });
    await ctx.reply(
      `Current price for ₹${vt.faceValue}: ₹${vt.price}\nSend new price (number).`
    );
  });

  bot.action('ADMIN_ORDERS', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user voucherType');
    if (!orders.length) return ctx.reply('No orders yet.');
    const lines = ['📜 *Last 10 Orders*'];
    for (const o of orders) {
      lines.push(
        `#${String(o._id).slice(-5)} | tg ${o.user.tgId} | ₹${o.total} | ${o.status} | ₹${o.voucherType.faceValue}`
      );
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.action('ADMIN_COMPLAINTS', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const comps = await Complaint.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user');
    if (!comps.length) return ctx.reply('No complaints.');
    const lines = ['🐞 *Complaints*'];
    for (const c of comps) {
      lines.push(
        `#${String(c._id).slice(-5)} | tg ${c.user.tgId} | ${c.status}\n${c.text}`
      );
    }
    await ctx.reply(lines.join('\n\n'), { parse_mode: 'Markdown' });
  });

  bot.action('ADMIN_ADD_ADMIN', async ctx => {
    await ctx.answerCbQuery();
    if (!isAdminTg(ctx.from.id)) return;
    const user = await getOrCreateUser(ctx);
    setState(user.tgId, 'ADMIN_ADD_ADMIN', {});
    await ctx.reply(
      'Send Telegram numeric user ID of new admin (you can get it from /userinfobot etc).'
    );
  });

  bot.action('CANCEL_FLOW', async ctx => {
    await ctx.answerCbQuery();
    clearState(ctx.from.id);
    await ctx.reply(
      '❌ Operation cancelled.',
      mainMenuKeyboard(isAdminTg(ctx.from.id))
    );
  });

  return bot;
}

module.exports = { createBot };
