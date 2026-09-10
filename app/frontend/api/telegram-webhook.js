export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Bot Telegram non configuré.' });

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      const valid = query.currency === 'XTR' && Number(query.total_amount) > 0;
      await telegram(token, 'answerPreCheckoutQuery', {
        pre_checkout_query_id: query.id,
        ok: valid,
        ...(valid ? {} : { error_message: 'Cette facture n’est plus disponible.' })
      });
    }

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      console.log(JSON.stringify({
        event: 'successful_payment',
        userId: update.message.from?.id,
        amount: payment.total_amount,
        currency: payment.currency,
        chargeId: payment.telegram_payment_charge_id,
        payload: payment.invoice_payload,
        receivedAt: new Date().toISOString()
      }));
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erreur du webhook Telegram.' });
  }
}

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Telegram ${method} a échoué.`);
  return response.json();
}
