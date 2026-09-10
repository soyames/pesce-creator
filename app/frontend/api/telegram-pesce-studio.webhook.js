export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET;
  if (!token) return res.status(503).json({ message: 'Bot Telegram de Pesce Studio non configuré.' });

  if (webhookSecret) {
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== webhookSecret) {
      return res.status(401).json({ message: 'Secret du webhook invalide.' });
    }
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = update.message;

    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      const valid = query.currency === 'XTR' && Number(query.total_amount) > 0;
      await telegram(token, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: query.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Cette facture n’est plus disponible.' })
      });
    }

    if (message?.successful_payment) {
      const payment = message.successful_payment;
      console.log(JSON.stringify({
        event: 'successful_payment',
        userId: message.from?.id,
        amount: payment.total_amount,
        currency: payment.currency,
        chargeId: payment.telegram_payment_charge_id,
        payload: payment.invoice_payload,
        receivedAt: new Date().toISOString()
      }));

      await telegram(token, 'sendMessage', {
        chat_id: message.chat.id,
        text: `Merci beaucoup ⭐\n\nVotre soutien de ${payment.total_amount} Étoiles à Pesce a bien été reçu. Votre geste contribue directement à son travail journalistique.`
      });
    }

    if (message?.text) {
      const command = message.text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
      if (command === '/start') {
        await telegram(token, 'sendMessage', {
          chat_id: message.chat.id,
          text: 'Bienvenue dans Pesce Studio ⭐\n\nRetrouvez les publications, vidéos, audios et contenus de Pesce Hounyo, et soutenez directement son travail journalistique.',
          reply_markup: {
            inline_keyboard: [[{ text: 'Ouvrir Pesce Studio', web_app: { url: 'https://pesce-creator.vercel.app/' } }]]
          }
        });
      } else if (command === '/paysupport') {
        await telegram(token, 'sendMessage', {
          chat_id: message.chat.id,
          text: 'Support paiement Pesce Studio\n\nPour toute question concernant un paiement ou un problème avec vos Étoiles, envoyez un message à ce bot en précisant, si possible, la date, le montant et le problème rencontré. Nous vous répondrons dès que possible.'
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erreur du webhook Telegram de Pesce Studio.' });
  }
}

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} a échoué: ${data.description || response.status}`);
  return data;
}
