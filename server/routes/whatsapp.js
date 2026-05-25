const express = require('express');
const axios = require('axios');
const { handleMessage } = require('../bot/commands');

const router = express.Router();

const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'fleet-tracker-verify';
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from;
    const text = message.text.body;
    const reply = handleMessage(from, text);

    if (WA_TOKEN && WA_PHONE_ID) {
      await axios.post(
        `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: from,
          type: 'text',
          text: { body: reply }
        },
        { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      );
    } else {
      console.log(`[WhatsApp Bot] To: ${from}\n${reply}`);
    }
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
  }
});

module.exports = router;
