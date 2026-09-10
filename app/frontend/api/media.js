export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  const fileId = typeof req.query?.file_id === 'string' ? req.query.file_id : '';
  if (!token || !fileId || fileId.length > 512) {
    return res.status(400).json({ message: 'Fichier Telegram invalide.' });
  }

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const telegramData = await telegramResponse.json();
    if (!telegramResponse.ok || !telegramData.ok || !telegramData.result?.file_path) {
      return res.status(404).json({ message: 'Média Telegram introuvable.' });
    }

    const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${telegramData.result.file_path}`);
    if (!fileResponse.ok) return res.status(502).json({ message: 'Média Telegram indisponible.' });

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    res.setHeader('Content-Type', fileResponse.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Impossible de récupérer le média Telegram.' });
  }
}
