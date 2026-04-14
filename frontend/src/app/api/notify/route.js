import { NextResponse } from 'next/server';

// Токен твоего бота
const BOT_TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4";

export async function POST(req) {
    try {
        const { targetId, message } = await req.json();
        
        // Отправляем запрос напрямую в сервер Telegram
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: targetId,
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        const data = await response.json();
        return NextResponse.json({ success: true, data });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}