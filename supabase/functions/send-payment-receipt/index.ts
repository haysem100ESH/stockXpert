const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const ADMIN_CHAT_IDS = ['1447176624', '1447176623'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Telegram API error: ${JSON.stringify(err)}`);
  }
}

async function sendTelegramPhoto(chatId: string, photoBase64: string, caption: string, fileName: string): Promise<void> {
  const binaryString = atob(photoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption);
  formData.append('parse_mode', 'Markdown');
  formData.append('photo', new Blob([bytes], { type: 'image/jpeg' }), fileName);

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Telegram sendPhoto error: ${JSON.stringify(err)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }

    const { amount, ownerName, ownerEmail, receiptBase64, fileName } = await req.json();

    if (!amount || !receiptBase64) {
      return new Response(
        JSON.stringify({ error: 'Missing amount or receipt image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const caption = `💰 *Payment Receipt Received*\n\n👤 *Owner:* ${ownerName || 'N/A'}\n📧 *Email:* ${ownerEmail || 'N/A'}\n💵 *Amount:* ${amount} ETB\n📅 *Date:* ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}\n\n_Please verify and activate the subscription._`;

    // Send to all admin chat IDs
    for (const chatId of ADMIN_CHAT_IDS) {
      await sendTelegramPhoto(chatId, receiptBase64, caption, fileName || 'receipt.jpg');
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Payment receipt sent to admin' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-payment-receipt:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
