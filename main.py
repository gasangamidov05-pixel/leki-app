import asyncio
import asyncpg
import json
import aiohttp
import uuid
import urllib.parse
from datetime import datetime, timedelta, timezone
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery, ReplyKeyboardMarkup, KeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
MAIN_ADMIN_ID = 5340841151 

# ❗️ ВСТАВЬ СЮДА СВОИ ДАННЫЕ ИЗ SUPABASE
SUPABASE_URL = "https://dmjwjmpmafaxythyqwoz.supabase.co"
SUPABASE_KEY = "sb_publishable_H3De-9A7ETTo1OHPmU5Ymg_WvJIruEF"

MSK = timezone(timedelta(hours=3))

bot = Bot(token=TOKEN)
dp = Dispatcher()

class AdminStates(StatesGroup):
    waiting_for_price = State(); waiting_for_card = State(); waiting_for_radius = State(); prod_id = State()
    waiting_for_new_name = State(); waiting_for_new_price = State(); waiting_for_new_desc = State(); waiting_for_new_photo = State(); waiting_for_hours = State()
    waiting_for_edit_name = State(); waiting_for_edit_desc = State(); waiting_for_edit_photo = State()
    waiting_for_yookassa_shop_id = State(); waiting_for_yookassa_secret = State(); waiting_for_support_link = State(); waiting_for_modifier = State()
    promo_res_id = State(); promo_type = State(); promo_code = State()
    promo_value = State(); promo_min = State(); promo_limit = State()

class CourierStates(StatesGroup): change_city = State()

# --- КЛАВИАТУРЫ МЕНЮ ---
def get_admin_main_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🏠 Панель управления"), KeyboardButton(text="📦 Текущие заказы")],
            [KeyboardButton(text="🆘 Поддержка")]
        ],
        resize_keyboard=True
    )

def get_courier_main_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🛵 Личный кабинет"), KeyboardButton(text="📱 Открыть карту")],
            [KeyboardButton(text="🆘 Поддержка")]
        ],
        resize_keyboard=True
    )

def get_client_main_kb():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🍔 Заказать еду", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))],
            [KeyboardButton(text="🆘 Поддержка")]
        ],
        resize_keyboard=True
    )

async def get_db_conn(): return await asyncpg.connect(DB_URL, statement_cache_size=0)

async def upload_photo_to_supabase(file_id: str):
    file = await bot.get_file(file_id)
    file_url = f"https://api.telegram.org/file/bot{TOKEN}/{file.file_path}"
    async with aiohttp.ClientSession() as session:
        async with session.get(file_url) as resp:
            if resp.status == 200:
                file_bytes = await resp.read()
                filename = f"prod_{file_id}.jpg"
                upload_url = f"{SUPABASE_URL}/storage/v1/object/receipts/{filename}"
                headers = {"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY, "Content-Type": "image/jpeg"}
                async with session.post(upload_url, headers=headers, data=file_bytes) as up_resp:
                    if up_resp.status in (200, 201): return f"{SUPABASE_URL}/storage/v1/object/public/receipts/{filename}"
    return None

async def notify_restaurant(conn, order_id, status_msg):
    order = await conn.fetchrow("SELECT restaurant_name FROM orders WHERE id = $1", order_id)
    if order:
        admin = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name = $1", order['restaurant_name'])
        target = admin['admin_tg_id'] if admin else MAIN_ADMIN_ID
        try: await bot.send_message(target, f"📦 <b>Заказ №{order_id}</b>\nСтатус: {status_msg}", parse_mode="HTML")
        except: pass

async def notify_client(conn, order_id, status_msg):
    order = await conn.fetchrow("SELECT user_data FROM orders WHERE id = $1", order_id)
    if order and order['user_data']:
        try:
            u = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
            if u.get('id'): await bot.send_message(u['id'], f"🛎 <b>Ваш заказ №{order_id}</b>\n{status_msg}", parse_mode="HTML")
        except: pass

# ==========================================
#           ИНТЕГРАЦИЯ ЮKASSA
# ==========================================
async def create_yookassa_payment(shop_id, secret_key, amount, order_id, bot_link):
    url = "https://api.yookassa.ru/v3/payments"
    auth = aiohttp.BasicAuth(shop_id, secret_key)
    headers = {"Idempotence-Key": str(uuid.uuid4())}
    payload = {"amount": {"value": f"{amount}.00", "currency": "RUB"}, "capture": True, "confirmation": {"type": "redirect", "return_url": bot_link}, "description": f"Оплата заказа №{order_id}"}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, auth=auth, headers=headers, json=payload) as resp:
            if resp.status == 200: return await resp.json()
    return None

async def check_yookassa_payment(shop_id, secret_key, payment_id):
    url = f"https://api.yookassa.ru/v3/payments/{payment_id}"
    auth = aiohttp.BasicAuth(shop_id, secret_key)
    async with aiohttp.ClientSession() as session:
        async with session.get(url, auth=auth) as resp:
            if resp.status == 200: return await resp.json()
    return None

async def refund_yookassa_payment(shop_id, secret_key, payment_id, amount):
    url = "https://api.yookassa.ru/v3/refunds"
    auth = aiohttp.BasicAuth(shop_id, secret_key)
    headers = {"Idempotence-Key": str(uuid.uuid4())}
    payload = {"payment_id": payment_id, "amount": {"value": f"{amount}.00", "currency": "RUB"}}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, auth=auth, headers=headers, json=payload) as resp:
            if resp.status == 200: return True
    return False

async def payment_processor():
    bot_info = await bot.get_me()
    bot_link = f"https://t.me/{bot_info.username}"
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            new_payments = await conn.fetch("SELECT o.*, r.yookassa_shop_id, r.yookassa_secret_key FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.status = 'awaiting_payment' LIMIT 5")
            for order in new_payments:
                if not order['yookassa_shop_id'] or not order['yookassa_secret_key']:
                    await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order['id'])
                    await notify_client(conn, order['id'], "❌ Ошибка оплаты: Ресторан не настроил онлайн-кассу. Заказ отменен.")
                    continue
                pay_data = await create_yookassa_payment(order['yookassa_shop_id'], order['yookassa_secret_key'], order['total_price'], order['id'], bot_link)
                if pay_data and 'confirmation' in pay_data:
                    payment_id = pay_data['id']
                    pay_url = pay_data['confirmation']['confirmation_url']
                    await conn.execute("UPDATE orders SET status = 'payment_pending', payment_id = $1 WHERE id = $2", payment_id, order['id'])
                    u = json.loads(order['user_data'])
                    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="💳 ОПЛАТИТЬ ЗАКАЗ", url=pay_url)]])
                    try: await bot.send_message(u['id'], f"🧾 <b>Счет на оплату заказа №{order['id']}</b>\nСумма: {order['total_price']} ₽\n\n<i>Нажмите кнопку ниже, чтобы оплатить картой (ЮKassa). После успешной оплаты заказ автоматически отправится на кухню!</i>", reply_markup=kb, parse_mode="HTML")
                    except: pass

            pending_payments = await conn.fetch("SELECT o.*, r.yookassa_shop_id, r.yookassa_secret_key FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.status = 'payment_pending' LIMIT 10")
            for order in pending_payments:
                pay_info = await check_yookassa_payment(order['yookassa_shop_id'], order['yookassa_secret_key'], order['payment_id'])
                if pay_info:
                    if pay_info['status'] == 'succeeded':
                        await conn.execute("UPDATE orders SET status = 'new' WHERE id = $1", order['id'])
                        await notify_client(conn, order['id'], "✅ Оплата успешно получена! Ваш заказ передан в ресторан и начал готовиться.")
                    elif pay_info['status'] == 'canceled':
                        await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order['id'])
                        await notify_client(conn, order['id'], "❌ Время ожидания оплаты истекло, или оплата была отменена. Заказ аннулирован.")
        except: pass
        finally:
            if conn: await conn.close()
        await asyncio.sleep(5)

# --- РАДАР КУРЬЕРОВ ---
async def courier_monitor():
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            cities = await conn.fetch("SELECT DISTINCT city FROM restaurants WHERE city IS NOT NULL AND city != '-'")
            for c in cities:
                city_name = c['city']
                count = await conn.fetchval("SELECT COUNT(*) FROM couriers WHERE city = $1 AND is_active = true AND (paid_until > now() OR paid_until IS NULL)", city_name)
                has_couriers = count > 0
                await conn.execute("UPDATE restaurants SET has_active_couriers = $1 WHERE city = $2", has_couriers, city_name)
        except: pass
        finally:
            if conn: await conn.close()
        await asyncio.sleep(15)

# ==========================================
#           ПАНЕЛЬ СУПЕР-АДМИНА
# ==========================================
@dp.message(Command("superadmin"))
async def cmd_superadmin(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    text = (
        "👑 <b>ПАНЕЛЬ СУПЕР-АДМИНА LEKI</b>\n\n"
        "<b>📦 Курьеры:</b>\n"
        "• <code>/add_courier ID Имя</code> | <code>/del_courier ID</code> | <code>/courier_stats</code>\n\n"
        "<b>💳 Биллинг:</b>\n"
        "• <code>/set_paid res ID Дни</code> | <code>/set_paid cour ID Дни</code>\n\n"
        "<b>🌍 Логистика:</b>\n"
        "• <code>/pin_res ID</code> — Закрепить ТОП 🔥\n"
        "• <code>/set_buffer Секунды</code> — Задержка выхода\n"
        "• <code>/set_timeout Минуты</code> — Таймер Своей доставки ⏳\n"
        "• <code>/set_alert Минуты</code> — Аварийный таймер 🚨\n"
        "• <code>/stats</code> — СТАТИСТИКА 📊\n\n"
        "<b>💰 УМНЫЕ ТАРИФЫ ДОСТАВКИ:</b>\n"
        "• <code>/set_city_price Город База Км</code>\n"
        "• <code>/set_surge Город 1.5</code> — Час пик (множитель)\n"
        "• <code>/set_weather Город 50</code> — Надбавка за погоду\n"
        "• <code>/set_free_km Город 2</code> — Бесплатные КМ в базе"
    )
    await message.answer(text, parse_mode="HTML")

@dp.message(Command("set_surge"))
async def admin_set_surge(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 3: return await message.answer("Формат: /set_surge Город 1.5")
    city, surge = args[1], float(args[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE city_pricing SET surge_multiplier = $1 WHERE city_name = $2", surge, city)
        await conn.execute("UPDATE restaurants SET surge_multiplier = $1 WHERE city = $2", surge, city)
        await message.answer(f"✅ Коэффициент спроса для г. {city} установлен на {surge}x")
    finally: await conn.close()

@dp.message(Command("set_weather"))
async def admin_set_weather(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 3: return await message.answer("Формат: /set_weather Город 50")
    city, bonus = args[1], int(args[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE city_pricing SET weather_bonus = $1 WHERE city_name = $2", bonus, city)
        await conn.execute("UPDATE restaurants SET weather_bonus = $1 WHERE city = $2", bonus, city)
        await message.answer(f"✅ Погодный бонус для г. {city} установлен на +{bonus}₽")
    finally: await conn.close()

@dp.message(Command("set_free_km"))
async def admin_set_free_km(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 3: return await message.answer("Формат: /set_free_km Город 2")
    city, km = args[1], float(args[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE city_pricing SET free_base_km = $1 WHERE city_name = $2", km, city)
        await conn.execute("UPDATE restaurants SET free_base_km = $1 WHERE city = $2", km, city)
        await message.answer(f"✅ Бесплатные километры для г. {city} установлены на {km} км")
    finally: await conn.close()

@dp.message(Command("set_city_price"))
async def admin_set_city_price(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 4: return await message.answer("Формат: /set_city_price Город База Км")
    city, base, km = args[1], int(args[2]), int(args[3])
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO city_pricing (city_name, base_price, km_price) VALUES ($1, $2, $3) ON CONFLICT (city_name) DO UPDATE SET base_price = $2, km_price = $3", city, base, km)
        await conn.execute("UPDATE restaurants SET base_delivery_price = $1, km_delivery_price = $2 WHERE city = $3", base, km, city)
        await message.answer(f"✅ Цены для г. {city} обновлены: База {base}₽, Км {km}₽")
    finally: await conn.close()

@dp.message(Command("set_buffer"))
async def admin_set_buffer(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2 or not args[1].isdigit(): return await message.answer("Формат: /set_buffer 60", parse_mode="HTML")
    seconds = int(args[1])
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO settings (key, value) VALUES ('courier_buffer_sec', $1) ON CONFLICT (key) DO UPDATE SET value = $1", str(seconds))
        await message.answer(f"✅ Буферное время выхода курьера: <b>{seconds} сек</b>.", parse_mode="HTML")
    finally: await conn.close()

@dp.message(Command("set_timeout"))
async def admin_set_timeout(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2 or not args[1].isdigit(): return await message.answer("Формат: /set_timeout 5 (в минутах)", parse_mode="HTML")
    mins = int(args[1])
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO settings (key, value) VALUES ('self_delivery_timeout_min', $1) ON CONFLICT (key) DO UPDATE SET value = $1", str(mins))
        await message.answer(f"✅ Время ожидания курьера до тревоги ресторану: <b>{mins} мин</b>.", parse_mode="HTML")
    finally: await conn.close()

@dp.message(Command("set_alert"))
async def admin_set_alert(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2 or not args[1].isdigit(): return await message.answer("Формат: /set_alert 3 (в минутах)", parse_mode="HTML")
    mins = int(args[1])
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO settings (key, value) VALUES ('superadmin_alert_min', $1) ON CONFLICT (key) DO UPDATE SET value = $1", str(mins))
        await message.answer(f"✅ Аварийный таймер для забытых заказов установлен на: <b>{mins} мин</b>.", parse_mode="HTML")
    finally: await conn.close()

@dp.message(Command("stats"))
async def superadmin_stats(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    conn = await get_db_conn()
    try:
        if len(args) < 2:
            res_list = await conn.fetch("SELECT id, name, city FROM restaurants ORDER BY id")
            text = "📊 <b>Система аналитики LEKI</b>\n\nОтправьте <code>/stats ID</code>\n\n<b>Заведения:</b>\n"
            for r in res_list: text += f"ID: {r['id']} — <b>{r['name']}</b> ({r['city']})\n"
            return await message.answer(text, parse_mode="HTML")
        res_id = int(args[1])
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE id = $1", res_id)
        if not res: return await message.answer("❌ Ресторан не найден.")
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📅 За сегодня", callback_data=f"adm_statcalc_{res_id}_1")],
            [InlineKeyboardButton(text="🗓 За 7 дней", callback_data=f"adm_statcalc_{res_id}_7")],
            [InlineKeyboardButton(text="📆 За 30 дней", callback_data=f"adm_statcalc_{res_id}_30")],
            [InlineKeyboardButton(text="♾ За всё время", callback_data=f"adm_statcalc_{res_id}_all")]
        ])
        await message.answer(f"📊 <b>Статистика: {res['name']}</b>\nВыберите период:", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

@dp.message(Command("pin_res"))
async def admin_pin_res(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2: return await message.answer("Формат: /pin_res [ID]")
    res_id = int(args[1])
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name, is_pinned FROM restaurants WHERE id = $1", res_id)
        if not res: return await message.answer("❌ Не найден!")
        new_status = not res['is_pinned']
        await conn.execute("UPDATE restaurants SET is_pinned = $1 WHERE id = $2", new_status, res_id)
        status_text = "🔥 ЗАКРЕПЛЕН В ТОПЕ" if new_status else "🧊 Откреплен"
        await message.answer(f"✅ <b>{res['name']}</b> теперь {status_text}!", parse_mode="HTML")
    finally: await conn.close()

@dp.message(Command("set_paid"))
async def admin_set_paid(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 4: return
    target_type, target_id, days = args[1], int(args[2]), int(args[3])
    table = "restaurants" if target_type == "res" else "couriers"
    id_col = "id" if target_type == "res" else "tg_id"
    conn = await get_db_conn()
    try:
        new_date = datetime.now(timezone.utc) + timedelta(days=days)
        await conn.execute(f"UPDATE {table} SET paid_until = $1 WHERE {id_col} = $2", new_date, target_id)
        await message.answer(f"✅ Доступ продлен до {new_date.strftime('%d.%m.%Y')}")
    finally: await conn.close()

@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        is_courier = await conn.fetchrow("SELECT tg_id FROM couriers WHERE tg_id = $1", message.from_user.id)
        is_res_admin = await conn.fetchrow("SELECT id FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        
        if message.from_user.id == MAIN_ADMIN_ID or is_res_admin:
            await message.answer("👑 Добро пожаловать, Администратор! Ваши инструменты управления в меню ниже.", reply_markup=get_admin_main_kb())
        elif is_courier:
            await message.answer("🛵 Салам, коллега! Твои заказы и карта ждут тебя в меню.", reply_markup=get_courier_main_kb())
        else:
            await message.answer("Ассаламу алейкум! Добро пожаловать в LEKI.\nИспользуйте меню внизу, чтобы заказать вкусную еду!", reply_markup=get_client_main_kb())
    finally:
        await conn.close()

@dp.message(Command("my_id"))
async def cmd_my_id(message: types.Message):
    await message.answer(f"Ваш ID: <code>{message.from_user.id}</code>", parse_mode="HTML")

@dp.message(Command("add_courier"))
async def admin_add_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split(maxsplit=2)
    if len(args) < 3: return
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO couriers (tg_id, name, city, is_active) VALUES ($1, $2, '-', false) ON CONFLICT (tg_id) DO UPDATE SET name = $2", int(args[1]), args[2])
        await message.answer(f"✅ Курьер добавлен!")
    finally: await conn.close()

@dp.message(Command("del_courier"))
async def admin_del_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2: return
    conn = await get_db_conn()
    try:
        c_id = int(args[1])
        await conn.execute("UPDATE orders SET courier_tg_id = NULL WHERE courier_tg_id = $1", c_id)
        await conn.execute("DELETE FROM courier_reviews WHERE courier_tg_id = $1", c_id)
        await conn.execute("DELETE FROM couriers WHERE tg_id = $1", c_id)
        await message.answer(f"🚫 Курьер удален.")
    finally: await conn.close()

@dp.message(Command("courier_stats"))
async def courier_stats(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    conn = await get_db_conn()
    try:
        rows = await conn.fetch("SELECT c.name, c.tg_id, ROUND(AVG(r.rating), 1) as rating, COUNT(r.id) as jobs, c.paid_until FROM couriers c LEFT JOIN courier_reviews r ON c.tg_id = r.courier_tg_id GROUP BY c.tg_id, c.name, c.paid_until ORDER BY rating DESC NULLS LAST")
        text = "📊 <b>Рейтинг и подписки курьеров:</b>\n\n"
        for r in rows:
            rate = r['rating'] or 0
            paid = r.get('paid_until')
            is_paid = True if not paid else paid > datetime.now(timezone.utc)
            status = "✅" if is_paid else "❌"
            paid_str = paid.strftime('%d.%m') if paid else "Безлимит"
            text += f"{status} <b>{r['name']}</b>: {rate}⭐ ({r['jobs']} зак.)\nДо: {paid_str}\nID: <code>{r['tg_id']}</code>\n\n"
        await message.answer(text, parse_mode="HTML")
    finally: await conn.close()

# ==========================================
#           ПАНЕЛЬ КУРЬЕРА
# ==========================================
async def get_courier_panel_text(conn, tg_id):
    c = await conn.fetchrow("SELECT * FROM couriers WHERE tg_id = $1", tg_id)
    if not c: return None, None
    paid = c.get('paid_until')
    is_paid = True if not paid else paid > datetime.now(timezone.utc)
    status_text = "🟢 НА ЛИНИИ" if c['is_active'] and is_paid else "🔴 ПЕРЕРЫВ" if is_paid else "❌ ПОДПИСКА ИСТЕКЛА"
    paid_str = paid.strftime('%d.%m.%Y') if paid else "Безлимит"
    
    today_earned, today_count = 0, 0
    try:
        rows = await conn.fetch("SELECT items, total_price FROM orders WHERE courier_tg_id = $1 AND status = 'completed' AND DATE(created_at) = CURRENT_DATE", tg_id)
        today_count = len(rows)
        for r in rows:
            items_data = json.loads(r['items'])
            if isinstance(items_data, str): items_data = json.loads(items_data)
            items_sum = sum([i['price'] * i['count'] for i in items_data])
            today_earned += (r['total_price'] - items_sum)
    except: pass
    
    text = (f"🛵 <b>Кабинет курьера</b>\n\n👤 {c['name']}\n🏙 Город: {c['city']}\n💳 Оплачено до: {paid_str}\n\n💸 <b>Заработано сегодня: {today_earned} ₽ ({today_count} зак.)</b>\n\nСтатус: <b>{status_text}</b>")
    kb = []
    
    kb.append([InlineKeyboardButton(text="📱 ОТКРЫТЬ КАРТУ (Приложение)", web_app=WebAppInfo(url="https://leki-app.vercel.app/courier"))])
    
    active_order = await conn.fetchrow("SELECT id FROM orders WHERE courier_tg_id = $1 AND status IN ('taken', 'delivering', 'arrived') LIMIT 1", tg_id)
    if active_order: kb.append([InlineKeyboardButton(text="📦 Мой текущий заказ", callback_data=f"cour_active_{active_order['id']}")])
    kb.append([InlineKeyboardButton(text="🏙 Изменить город", callback_data="cour_change_city")])
    kb.append([InlineKeyboardButton(text="🔴 Уйти на перерыв" if c['is_active'] else "🟢 Выйти на линию", callback_data="cour_toggle")])
    return text, InlineKeyboardMarkup(inline_keyboard=kb)

@dp.message(Command("courier"))
async def cmd_courier(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        text, kb = await get_courier_panel_text(conn, message.from_user.id)
        if not text:
            apply_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📝 Стать курьером", url="https://t.me/gasangamidov")]])
            return await message.answer("❌ <b>Доступ запрещен.</b>\nВы не числитесь в системе.", reply_markup=apply_kb, parse_mode="HTML")
        
        c = await conn.fetchrow("SELECT city FROM couriers WHERE tg_id = $1", message.from_user.id)
        if c['city'] == '-':
            cities = await conn.fetch("SELECT DISTINCT city AS city_name FROM restaurants WHERE city IS NOT NULL AND city != '-'")
            if not cities: return await message.answer("❌ В системе еще нет активных ресторанов с городами!")
            city_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=city['city_name'], callback_data=f"setcity_{city['city_name']}")] for city in cities])
            await message.answer("📍 Выберите ваш город для работы:", reply_markup=city_kb)
        else: 
            await message.answer(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

@dp.callback_query(F.data == "cour_change_city")
async def cour_change_city_handler(callback: CallbackQuery):
    conn = await get_db_conn()
    try:
        cities = await conn.fetch("SELECT DISTINCT city AS city_name FROM restaurants WHERE city IS NOT NULL AND city != '-'")
        if not cities: return await callback.answer("Города не найдены!", show_alert=True)
        city_kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=city['city_name'], callback_data=f"setcity_{city['city_name']}")] for city in cities])
        await callback.message.edit_text("📍 Выберите ваш город:", reply_markup=city_kb)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("setcity_"))
async def cour_set_city_handler(callback: CallbackQuery):
    city_name = callback.data.split("_")[1]
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE couriers SET city = $1 WHERE tg_id = $2", city_name, callback.from_user.id)
        text, kb = await get_courier_panel_text(conn, callback.from_user.id)
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close()

async def delayed_offline(tg_id, chat_id, message_id, buffer_sec):
    await asyncio.sleep(buffer_sec)
    conn = await get_db_conn()
    try:
        c = await conn.fetchrow("SELECT is_active FROM couriers WHERE tg_id = $1", tg_id)
        if c and c['is_active']:
            await conn.execute("UPDATE couriers SET is_active = false WHERE tg_id = $1", tg_id)
            try:
                text, kb = await get_courier_panel_text(conn, tg_id)
                await bot.edit_message_text(text=text, chat_id=chat_id, message_id=message_id, reply_markup=kb, parse_mode="HTML")
                await bot.send_message(tg_id, "🔴 Смена завершена. Вы успешно ушли на перерыв.", parse_mode="HTML")
            except: pass
    except: pass
    finally: await conn.close()

@dp.callback_query(F.data == "cour_toggle")
async def cour_toggle_status(callback: CallbackQuery):
    conn = await get_db_conn()
    try:
        c = await conn.fetchrow("SELECT city, is_active, paid_until FROM couriers WHERE tg_id = $1", callback.from_user.id)
        paid = c.get('paid_until')
        if paid and paid < datetime.now(timezone.utc): return await callback.answer("❌ Срок оплаты истек!", show_alert=True)
        
        if not c['is_active']:
            await conn.execute("UPDATE couriers SET is_active = true WHERE tg_id = $1", callback.from_user.id)
            text, kb = await get_courier_panel_text(conn, callback.from_user.id)
            await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
            pending_orders = await conn.fetch("SELECT o.id, o.restaurant_name, o.address, r.city FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.status = 'accepted' AND o.courier_tg_id IS NULL AND r.city = $1", c['city'])
            for p_order in pending_orders:
                kb_c = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{p_order['id']}")]])
                try: await bot.send_message(callback.from_user.id, f"🚨 <b>Свободный заказ №{p_order['id']}</b>\nИз: {p_order['restaurant_name']}\nКуда: {p_order['address']}", reply_markup=kb_c, parse_mode="HTML")
                except: pass
        else:
            buffer_sec = 60
            try:
                val = await conn.fetchval("SELECT value FROM settings WHERE key = 'courier_buffer_sec'")
                if val: buffer_sec = int(val)
            except: pass

            if buffer_sec > 0:
                await callback.answer(f"🕒 Завершение смены через {buffer_sec} сек.", show_alert=True)
                kb = callback.message.reply_markup
                if kb and kb.inline_keyboard:
                    new_kb = []
                    for row in kb.inline_keyboard:
                        new_row = []
                        for btn in row:
                            if btn.callback_data == "cour_toggle": new_row.append(InlineKeyboardButton(text=f"⏳ Отключение ({buffer_sec} сек)...", callback_data="ignore"))
                            else: new_row.append(btn)
                        new_kb.append(new_row)
                    await callback.message.edit_reply_markup(reply_markup=InlineKeyboardMarkup(inline_keyboard=new_kb))
                asyncio.create_task(delayed_offline(callback.from_user.id, callback.message.chat.id, callback.message.message_id, buffer_sec))
            else:
                await conn.execute("UPDATE couriers SET is_active = false WHERE tg_id = $1", callback.from_user.id)
                text, kb = await get_courier_panel_text(conn, callback.from_user.id)
                await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")

    finally: await conn.close()

@dp.callback_query(F.data == "ignore")
async def ignore_callback(callback: CallbackQuery): await callback.answer("⏳ Пожалуйста, подождите...")

@dp.callback_query(F.data.startswith("cour_active_"))
async def show_active_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        if not order: return await callback.answer("Заказ не найден", show_alert=True)
        items = json.loads(order['items'])
        if isinstance(items, str): items = json.loads(items)
        delivery_fee = order['total_price'] - sum([i['price'] * i['count'] for i in items])
        kb_arr = []
        text = ""
        if order['status'] == 'taken':
            res_coords = await conn.fetchrow("SELECT lat, lon FROM restaurants WHERE name = $1", order['restaurant_name'])
            if res_coords and res_coords['lat']: nav_url = f"https://yandex.ru/maps/?pt={res_coords['lon']},{res_coords['lat']}&z=18&l=map"
            else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['restaurant_name'])
            kb_arr.append([InlineKeyboardButton(text="🗺 Маршрут в ресторан", url=nav_url)])
            kb_arr.append([InlineKeyboardButton(text="🏃‍♂️ Забрал заказ", callback_data=f"picked_{order_id}")])
            text = f"✅ <b>Заказ №{order_id} принят!</b>\n\nЗабрать в: {order['restaurant_name']}\nАдрес доставки: {order['address']}\n💵 <b>Не забудьте получить {delivery_fee} ₽ за доставку в ресторане!</b>"
        elif order['status'] == 'delivering':
            if order['lat'] and order['lon']: nav_url = f"https://yandex.ru/maps/?pt={order['lon']},{order['lat']}&z=18&l=map"
            else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['address'].split(', кв/офис')[0])
            kb_arr.append([InlineKeyboardButton(text="🗺 Маршрут к клиенту", url=nav_url)])
            kb_arr.append([InlineKeyboardButton(text="📍 Я на адресе", callback_data=f"arrived_{order_id}")])
            text = f"🚴‍♂️ <b>Заказ №{order_id} в пути!</b>\nАдрес: {order['address']}"
        elif order['status'] == 'arrived':
            u = json.loads(order['user_data'])
            if isinstance(u, str): u = json.loads(u)
            if u.get('id'): kb_arr.append([InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={u.get('id')}")])
            kb_arr.append([InlineKeyboardButton(text="🏁 Доставлено", callback_data=f"done_{order_id}")])
            text = f"📍 <b>Заказ №{order_id}</b>\nВы на месте.\n📱 Тел: <code>{order['phone']}</code>"
        else: return await callback.answer("Этот заказ уже завершен или отменен.", show_alert=True)
            
        kb_arr.append([InlineKeyboardButton(text="🆘 Проблема с заказом", callback_data=f"sos_{order_id}")])
        if callback.message.photo: 
            await callback.message.edit_caption(caption=text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_arr), parse_mode="HTML")
        else: 
            await callback.message.edit_text(text=text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_arr), parse_mode="HTML")
        await callback.answer()
    finally: await conn.close()

@dp.callback_query(F.data.startswith("sos_"))
async def courier_sos(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT restaurant_name FROM orders WHERE id = $1", order_id)
        if order:
            res = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name = $1", order['restaurant_name'])
            target = res['admin_tg_id'] if res and res['admin_tg_id'] else MAIN_ADMIN_ID
            cour = await conn.fetchrow("SELECT name FROM couriers WHERE tg_id = $1", callback.from_user.id)
            cour_name = cour['name'] if cour else "Неизвестный"
            msg = f"🆘 <b>АЛЕРТ ОТ КУРЬЕРА!</b>\n\nКурьер <b>{cour_name}</b> (ID: <code>{callback.from_user.id}</code>) сообщил о проблеме с <b>Заказом №{order_id}</b>!\n\nСвяжитесь с ним: @{callback.from_user.username or callback.from_user.id}"
            try: await bot.send_message(target, msg, parse_mode="HTML")
            except: pass
        await callback.answer("🚨 Отправлено!", show_alert=True)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("take_"))
async def take_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        active_count = await conn.fetchval("SELECT COUNT(*) FROM orders WHERE courier_tg_id = $1 AND status IN ('taken', 'delivering', 'arrived')", callback.from_user.id)
        if active_count >= 2:
            return await callback.answer("🛑 ЛИМИТ! Вы не можете взять больше 2-х заказов одновременно.", show_alert=True)

        order = await conn.fetchrow("SELECT courier_tg_id, address, restaurant_name, items, total_price FROM orders WHERE id = $1", order_id)
        if not order: return await callback.answer("Заказ не найден!", show_alert=True)
        if order['courier_tg_id']: return await callback.answer("Уже занят другим курьером!", show_alert=True)
        
        await conn.execute("UPDATE orders SET courier_tg_id = $1, status = 'taken' WHERE id = $2", callback.from_user.id, order_id)
        await notify_restaurant(conn, order_id, "Курьер принял заказ и едет в ресторан 🏃‍♂️")
        await notify_client(conn, order_id, "Мы нашли курьера! Он уже спешит в ресторан. 🏃‍♂️")
        
        items = json.loads(order['items'])
        if isinstance(items, str): items = json.loads(items)
        delivery_fee = order['total_price'] - sum([i['price'] * i['count'] for i in items])
        res_coords = await conn.fetchrow("SELECT lat, lon FROM restaurants WHERE name = $1", order['restaurant_name'])
        
        if res_coords and res_coords['lat']: nav_url = f"https://yandex.ru/maps/?pt={res_coords['lon']},{res_coords['lat']}&z=18&l=map"
        else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['restaurant_name'])
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Маршрут в ресторан", url=nav_url)],
            [InlineKeyboardButton(text="🏃‍♂️ Забрал заказ", callback_data=f"picked_{order_id}")],
            [InlineKeyboardButton(text="🆘 Проблема", callback_data=f"sos_{order_id}")]
        ])
        
        text = f"✅ <b>Заказ №{order_id} принят!</b>\n\nЗабрать в: {order['restaurant_name']}\nАдрес: {order['address']}\n💵 <b>Заберите {delivery_fee} ₽ в ресторане!</b>"
        if callback.message.photo: await callback.message.edit_caption(caption=text, reply_markup=kb, parse_mode="HTML")
        else: await callback.message.edit_text(text=text, reply_markup=kb, parse_mode="HTML")
    finally: 
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data.startswith("picked_"))
async def picked_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'delivering' WHERE id = $1", order_id)
        order = await conn.fetchrow("SELECT address, lat, lon FROM orders WHERE id = $1", order_id)
        await notify_restaurant(conn, order_id, "Курьер выехал к клиенту 🚴‍♂️")
        await notify_client(conn, order_id, "Курьер уже в пути! 🚴‍♂️💨")
        
        if order['lat'] and order['lon']: nav_url = f"https://yandex.ru/maps/?pt={order['lon']},{order['lat']}&z=18&l=map"
        else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['address'].split(', кв/офис')[0])
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Маршрут к клиенту", url=nav_url)],
            [InlineKeyboardButton(text="📍 Я на адресе", callback_data=f"arrived_{order_id}")]
        ])
        
        text = f"🚴‍♂️ <b>Заказ №{order_id} в пути!</b>\nАдрес: {order['address']}"
        if callback.message.photo: await callback.message.edit_caption(caption=text, reply_markup=kb, parse_mode="HTML")
        else: await callback.message.edit_text(text=text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("arrived_"))
async def arrived_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'arrived' WHERE id = $1", order_id)
        await notify_client(conn, order_id, "Курьер уже у ваших дверей! 📍")
        order = await conn.fetchrow("SELECT phone, user_data FROM orders WHERE id = $1", order_id)
        u = json.loads(order['user_data'])
        if isinstance(u, str): u = json.loads(u)
        client_id = u.get('id')
        kb_arr = []
        if client_id: kb_arr.append([InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={client_id}")])
        kb_arr.append([InlineKeyboardButton(text="🏁 Доставлено", callback_data=f"done_{order_id}")])
        
        text = f"📍 <b>Заказ №{order_id}</b>\nВы на месте.\n📱 Тел: <code>{order['phone']}</code>"
        if callback.message.photo: await callback.message.edit_caption(caption=text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_arr), parse_mode="HTML")
        else: await callback.message.edit_text(text=text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_arr), parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("done_"))
async def done_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'completed' WHERE id = $1", order_id)
        
        order_data = await conn.fetchrow("SELECT user_data, restaurant_name, courier_tg_id FROM orders WHERE id = $1", order_id)
        
        if order_data['courier_tg_id'] == -1:
            await notify_restaurant(conn, order_id, "Заказ успешно доставлен силами вашего ресторана! ✅")
        else:
            await notify_restaurant(conn, order_id, "Заказ успешно доставлен курьером платформы! ✅")
        
        if order_data:
            res = await conn.fetchrow("SELECT id FROM restaurants WHERE name = $1", order_data['restaurant_name'])
            u = json.loads(order_data['user_data'])
            if isinstance(u, str): u = json.loads(u)
            kb_res = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{i} ⭐", callback_data=f"rres_{order_id}_{res['id']}_{i}") for i in range(1, 6)]])
            try: await bot.send_message(u['id'], f"😋 <b>Оцените блюда от {order_data['restaurant_name']}:</b>", reply_markup=kb_res, parse_mode="HTML")
            except: pass
            
        caption = f"🏁 <b>Заказ №{order_id} завершен!</b>"
        if callback.message.photo: await callback.message.edit_caption(caption=caption, parse_mode="HTML")
        else: await callback.message.edit_text(text=caption, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("rres_"))
async def handle_rate_res(callback: CallbackQuery):
    _, order_id, res_id, stars = callback.data.split("_")
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO restaurant_reviews (restaurant_id, order_id, rating) VALUES ($1, $2, $3)", int(res_id), int(order_id), int(stars))
        order = await conn.fetchrow("SELECT courier_tg_id FROM orders WHERE id = $1", int(order_id))
        
        if order['courier_tg_id'] == -1:
            await callback.message.edit_text("✅ Оценка еды сохранена!\nСпасибо за заказ!", parse_mode="HTML")
        else:
            kb_cour = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"{i} ⭐", callback_data=f"rcour_{order_id}_{order['courier_tg_id']}_{i}") for i in range(1, 6)]])
            await callback.message.edit_text(f"✅ Оценка еды сохранена!\n\n🛵 <b>А как вам работа курьера?</b>", reply_markup=kb_cour, parse_mode="HTML")
    except: await callback.answer("Уже оценено!")
    finally: await conn.close()

@dp.callback_query(F.data.startswith("rcour_"))
async def handle_rate_cour(callback: CallbackQuery):
    _, order_id, courier_id, stars = callback.data.split("_")
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO courier_reviews (courier_tg_id, order_id, rating) VALUES ($1, $2, $3)", int(courier_id), int(order_id), int(stars))
        await callback.message.edit_text("🙏 Спасибо!")
    except: await callback.answer("Уже оценено!")
    finally: await conn.close()

# ==========================================
#           АДМИН РЕСТОРАНА И МЕНЮ БЛЮД
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT * FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        if not res and message.from_user.id == MAIN_ADMIN_ID:
            res = await conn.fetchrow("SELECT * FROM restaurants LIMIT 1")
        if not res: return await message.answer("❌ Нет доступа.")
        
        paid = res.get('paid_until')
        is_paid = True if not paid else paid > datetime.now(timezone.utc)
        if not is_paid: status = "❌ Подписка истекла"
        elif res.get('is_open'): status = f"🟢 Открыто ({res.get('working_hours', '10:00-22:00')})"
        else: status = "🔴 ВРЕМЕННО ЗАКРЫТО"
            
        paid_str = paid.strftime('%d.%m') if paid else "Безлимит"
        can_sd = res.get('can_self_deliver') if res.get('can_self_deliver') is not None else True
        sd_text = "🟢 Вкл" if can_sd else "🔴 Выкл"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔴 Закрыть" if res.get('is_open') else "🟢 Открыть", callback_data=f"adm_toggle_open_{res['id']}")],
            [InlineKeyboardButton(text=f"🚗 Своя доставка: {sd_text}", callback_data=f"adm_sd_{res['id']}")],
            [InlineKeyboardButton(text="⏰ Часы работы", callback_data=f"adm_hours_{res['id']}")],
            [InlineKeyboardButton(text="🗺 Меню", callback_data=f"adm_menu_{res['id']}")],
            [InlineKeyboardButton(text="🎁 Акции и Промокоды", callback_data=f"adm_promo_{res['id']}")],
            [InlineKeyboardButton(text="📊 Статистика", callback_data=f"adm_stats_{res['id']}")],
            [InlineKeyboardButton(text="💳 Оплата", callback_data=f"adm_payment_{res['id']}")],
            [
                InlineKeyboardButton(text=f"📍 Радиус: {res.get('delivery_radius') or 15} км", callback_data=f"adm_radius_{res['id']}"),
                InlineKeyboardButton(text="📞 Поддержка", callback_data=f"adm_support_{res['id']}")
            ]
        ])
        await message.answer(f"🛠 <b>Управление: {res['name']}</b>\n💳 Оплачено до: {paid_str}\n\nСтатус: {status}", parse_mode="HTML", reply_markup=kb)
    finally: await conn.close()

# ==========================================
#           ПРОМОКОДЫ И АКЦИИ
# ==========================================
@dp.callback_query(F.data.startswith("adm_promo_"))
async def adm_promo_menu(callback: CallbackQuery):
    data = callback.data.split("_")
    res_id = int(data[2])
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE id = $1", res_id)
        promos = await conn.fetch("SELECT * FROM promotions WHERE restaurant_name = $1 ORDER BY id DESC", res['name'])
        
        kb = [[InlineKeyboardButton(text="➕ СОЗДАТЬ АКЦИЮ", callback_data=f"adm_promoadd_{res_id}")]]
        for p in promos:
            status = "✅" if p['is_active'] else "🚫"
            secret = " 🤫" if p['is_secret'] else ""
            val = f"-{p['discount_rub']}₽" if p['reward_type'] == 'discount' else f"🎁 {p['gift_name'][:10]}.."
            kb.append([InlineKeyboardButton(text=f"{status} {p['code']} | {val}{secret}", callback_data=f"adm_pedit_{p['id']}_{res_id}")])
            
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text(f"🎁 <b>Акции и Промокоды: {res['name']}</b>\nУправление скидками и подарками.", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_promoadd_"))
async def adm_promo_add(callback: CallbackQuery, state: FSMContext):
    data = callback.data.split("_")
    res_id = int(data[2])
    await state.update_data(promo_res_id=res_id)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="💵 Скидка (в рублях)", callback_data="ptype_discount")],
        [InlineKeyboardButton(text="🎁 Блюдо в подарок", callback_data="ptype_gift")]
    ])
    await callback.message.edit_text("Выберите тип акции:", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("ptype_"))
async def adm_promo_type(callback: CallbackQuery, state: FSMContext):
    ptype = callback.data.split("_")[1]
    await state.update_data(promo_type=ptype)
    await state.set_state(AdminStates.promo_code)
    await callback.message.edit_text("Отправьте слово-промокод (на английском, без пробелов).\nПример: <code>LUCKY2026</code> или <code>MINUS300</code>", parse_mode="HTML")
    await callback.answer()

@dp.message(AdminStates.promo_code)
async def adm_promo_code(message: types.Message, state: FSMContext):
    code = message.text.strip().upper()
    await state.update_data(promo_code=code)
    data = await state.get_data()
    
    await state.set_state(AdminStates.promo_value)
    if data['promo_type'] == 'discount':
        await message.answer("Введите сумму скидки <b>в рублях</b> (только цифры):\nПример: <code>300</code>", parse_mode="HTML")
    else:
        await message.answer("Введите <b>название блюда</b>, которое пойдет в подарок:\nПример: <code>Пицца Пепперони 25см</code>", parse_mode="HTML")

@dp.message(AdminStates.promo_value)
async def adm_promo_value(message: types.Message, state: FSMContext):
    data = await state.get_data()
    if data['promo_type'] == 'discount':
        if not message.text.isdigit(): return await message.answer("Только цифры!")
        await state.update_data(promo_value=int(message.text))
    else:
        await state.update_data(promo_value=message.text)
        
    await state.set_state(AdminStates.promo_min)
    await message.answer("Введите <b>минимальную сумму заказа</b> для срабатывания (0 если без минималки):\nПример: <code>1500</code>", parse_mode="HTML")

@dp.message(AdminStates.promo_min)
async def adm_promo_min(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return await message.answer("Только цифры!")
    await state.update_data(promo_min=int(message.text))
    
    await state.set_state(AdminStates.promo_limit)
    await message.answer("Сколько раз можно использовать этот код? Введите число (или <code>-</code> если безлимит):", parse_mode="HTML")

@dp.message(AdminStates.promo_limit)
async def adm_promo_limit(message: types.Message, state: FSMContext):
    limit = None if message.text == "-" else (int(message.text) if message.text.isdigit() else None)
    await state.update_data(promo_limit=limit)
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📢 Публичная (На главном экране)", callback_data="psec_0")],
        [InlineKeyboardButton(text="🤫 Секретная (Только кто знает код)", callback_data="psec_1")]
    ])
    await message.answer("Сделать акцию публичной или секретной?", reply_markup=kb)

@dp.callback_query(F.data.startswith("psec_"))
async def adm_promo_finish(callback: CallbackQuery, state: FSMContext):
    is_secret = callback.data.split("_")[1] == "1"
    data = await state.get_data()
    
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE id = $1", data['promo_res_id'])
        
        d_rub = data['promo_value'] if data['promo_type'] == 'discount' else 0
        g_name = data['promo_value'] if data['promo_type'] == 'gift' else None
        
        await conn.execute(
            "INSERT INTO promotions (restaurant_name, code, reward_type, discount_rub, gift_name, min_cart_total, usage_limit, is_secret) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            res['name'], data['promo_code'], data['promo_type'], d_rub, g_name, data['promo_min'], data['promo_limit'], is_secret
        )
        await callback.message.edit_text(f"✅ Промокод <b>{data['promo_code']}</b> успешно создан!", parse_mode="HTML")
        await state.clear()
        
        # Возвращаем в меню
        callback.data = f"adm_promo_{data['promo_res_id']}"
        await adm_promo_menu(callback)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_pedit_"))
async def adm_promo_edit(callback: CallbackQuery):
    data = callback.data.split("_")
    p_id = int(data[2])
    res_id = int(data[3])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM promotions WHERE id = $1", p_id)
        
        val = f"Скидка {p['discount_rub']}₽" if p['reward_type'] == 'discount' else f"Подарок: {p['gift_name']}"
        lim = f"{p['used_count']} / {p['usage_limit']}" if p['usage_limit'] else f"{p['used_count']} (безлимит)"
        sec = "Да 🤫" if p['is_secret'] else "Нет 📢"
        
        text = f"🎟 <b>Промокод: {p['code']}</b>\n\nТип: {val}\nМин. чек: {p['min_cart_total']}₽\nИспользований: {lim}\nСекретный: {sec}"
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔴 Выключить" if p['is_active'] else "🟢 Включить", callback_data=f"adm_ptgl_{p['id']}_{res_id}")],
            [InlineKeyboardButton(text="🗑 Удалить полностью", callback_data=f"adm_pdel_{p['id']}_{res_id}")],
            [InlineKeyboardButton(text="🔙 К списку акций", callback_data=f"adm_promo_{res_id}")]
        ])
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_ptgl_"))
async def adm_promo_tgl(callback: CallbackQuery):
    data = callback.data.split("_")
    p_id = int(data[2])
    res_id = int(data[3])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE promotions SET is_active = NOT is_active WHERE id = $1", p_id)
        callback.data = f"adm_pedit_{p_id}_{res_id}"
        await adm_promo_edit(callback)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_pdel_"))
async def adm_promo_del(callback: CallbackQuery):
    data = callback.data.split("_")
    p_id = int(data[2])
    res_id = int(data[3])
    conn = await get_db_conn()
    try:
        await conn.execute("DELETE FROM promotions WHERE id = $1", p_id)
        callback.data = f"adm_promo_{res_id}"
        await adm_promo_menu(callback)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_sd_"))
async def adm_sd_toggle(callback: CallbackQuery, state: FSMContext):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET can_self_deliver = NOT COALESCE(can_self_deliver, true) WHERE id = $1", res_id)
        await callback.message.delete()
        await cmd_admin(callback.message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_stats_"))
async def adm_stats_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE id = $1", res_id)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📅 За сегодня", callback_data=f"adm_statcalc_{res_id}_1")],
            [InlineKeyboardButton(text="🗓 За 7 дней", callback_data=f"adm_statcalc_{res_id}_7")],
            [InlineKeyboardButton(text="📆 За 30 дней", callback_data=f"adm_statcalc_{res_id}_30")],
            [InlineKeyboardButton(text="♾ За всё время", callback_data=f"adm_statcalc_{res_id}_all")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")]
        ])
        await callback.message.edit_text(f"📊 <b>Статистика: {res['name']}</b>\nВыберите период:", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_statcalc_"))
async def adm_stat_calc(callback: CallbackQuery):
    data = callback.data.split("_")
    res_id = int(data[2])
    period = data[3]
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE id = $1", res_id)
        if not res: return await callback.answer("Ошибка", show_alert=True)
        res_name = res['name']
        date_filter = ""
        period_text = "за всё время"
        if period == "1":
            date_filter = "AND DATE(created_at) = CURRENT_DATE"
            period_text = "за сегодня"
        elif period == "7":
            date_filter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'"
            period_text = "за 7 дней"
        elif period == "30":
            date_filter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'"
            period_text = "за 30 дней"

        query = f"""SELECT COUNT(*) as total_orders, COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_orders, COUNT(*) FILTER (WHERE status = 'completed') as completed_orders, SUM(total_price) FILTER (WHERE status = 'completed') as total_revenue, COUNT(*) FILTER (WHERE payment_id IS NOT NULL) as online_payments, COUNT(*) FILTER (WHERE payment_id IS NULL) as manual_payments FROM orders WHERE restaurant_name = $1 AND status NOT IN ('new', 'awaiting_payment') {date_filter}"""
        stats = await conn.fetchrow(query, res_name)
        text = (f"📊 <b>Статистика: {res_name}</b> ({period_text})\n\n"
                f"📦 Всего заказов: <b>{stats['total_orders'] or 0}</b>\n✅ Успешно: <b>{stats['completed_orders'] or 0}</b>\n❌ Отменено: <b>{stats['cancelled_orders'] or 0}</b>\n\n"
                f"💵 Выручка (с доставкой): <b>{stats['total_revenue'] or 0} ₽</b>\n\n💳 ЮKassa: <b>{stats['online_payments'] or 0}</b> | Перевод: <b>{stats['manual_payments'] or 0}</b>")
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔙 Назад", callback_data=f"adm_stats_{res_id}")],
            [InlineKeyboardButton(text="🏠 В главное меню", callback_data="adm_cancel")]
        ])
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_support_"))
async def adm_support_start(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_support_link)
    await callback.message.answer("Отправьте ссылку на поддержку (http/https):", parse_mode="HTML")
    await callback.answer()

@dp.message(AdminStates.waiting_for_support_link)
async def process_support_link(message: types.Message, state: FSMContext):
    if not message.text.startswith("http"): return await message.answer("❌ Ссылка должна начинаться с 'http'.")
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET support_link = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Сохранено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_payment_"))
async def adm_payment_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT * FROM restaurants WHERE id = $1", res_id)
        method = res.get('payment_method') or 'manual'
        method_text = "Банковский перевод" if method == 'manual' else "ЮKassa"
        text = f"⚙️ <b>Настройки платежей</b>\nМетод: <b>{method_text}</b>\n\n"
        if method == 'manual': text += f"💳 Карта: <code>{res.get('card_number') or 'Не указана'}</code>"
        else: text += f"🛒 Shop ID: <code>{res.get('yookassa_shop_id') or 'Не указан'}</code>\n🔑 Secret Key: <code>{'Установлен' if res.get('yookassa_secret_key') else 'Не указан'}</code>"
        kb = [[InlineKeyboardButton(text="🔄 Сменить метод", callback_data=f"adm_toggle_pay_{res['id']}")]]
        if method == 'manual': kb.append([InlineKeyboardButton(text="💳 Изменить карту", callback_data=f"adm_card_{res['id']}")])
        else:
            kb.append([InlineKeyboardButton(text="🛒 Shop ID", callback_data=f"adm_shopid_{res['id']}")])
            kb.append([InlineKeyboardButton(text="🔑 Secret Key", callback_data=f"adm_secret_{res['id']}")])
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_toggle_pay_"))
async def adm_toggle_pay(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[3])
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT payment_method FROM restaurants WHERE id = $1", res_id)
        new_method = 'yookassa' if (res.get('payment_method') or 'manual') == 'manual' else 'manual'
        await conn.execute("UPDATE restaurants SET payment_method = $1 WHERE id = $2", new_method, res_id)
        callback.data = f"adm_payment_{res_id}"
        await adm_payment_menu(callback)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_shopid_"))
async def adm_shopid(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_yookassa_shop_id)
    await callback.message.answer("Отправьте Shop ID:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_yookassa_shop_id)
async def process_shopid(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET yookassa_shop_id = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Сохранено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_secret_"))
async def adm_secret(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_yookassa_secret)
    await callback.message.answer("Отправьте Secret Key:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_yookassa_secret)
async def process_secret(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET yookassa_secret_key = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Сохранено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_toggle_open_"))
async def adm_toggle_open(callback: CallbackQuery, state: FSMContext):
    res_id = int(callback.data.split("_")[3])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET is_open = NOT COALESCE(is_open, true) WHERE id = $1", res_id)
        await callback.message.delete()
        await cmd_admin(callback.message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_hours_"))
async def adm_hours_start(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_hours)
    await callback.message.answer("Укажите часы работы (например: <b>10:00-23:00</b>):", parse_mode="HTML")
    await callback.answer()

@dp.message(AdminStates.waiting_for_hours)
async def process_hours(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET working_hours = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_add_new_"))
async def adm_start_add(callback: CallbackQuery, state: FSMContext):
    res_id = int(callback.data.split("_")[3])
    await state.update_data(res_id=res_id)
    await state.set_state(AdminStates.waiting_for_new_name)
    await callback.message.answer("Название блюда:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_new_name)
async def adm_new_name(message: types.Message, state: FSMContext):
    await state.update_data(name=message.text)
    await message.answer("Цена:")
    await state.set_state(AdminStates.waiting_for_new_price)

@dp.message(AdminStates.waiting_for_new_price)
async def adm_new_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return await message.answer("Только цифры!")
    await state.update_data(price=int(message.text))
    await message.answer("Описание (или '-'):")
    await state.set_state(AdminStates.waiting_for_new_desc)

@dp.message(AdminStates.waiting_for_new_desc)
async def adm_new_desc(message: types.Message, state: FSMContext):
    desc = "" if message.text == "-" else message.text
    await state.update_data(desc=desc)
    await message.answer("Фото (или '-'):")
    await state.set_state(AdminStates.waiting_for_new_photo)

@dp.message(AdminStates.waiting_for_new_photo, F.photo | F.text)
async def adm_new_photo(message: types.Message, state: FSMContext):
    data = await state.get_data()
    image_url = None
    if message.photo:
        msg = await message.answer("⏳ Загружаю фото...")
        image_url = await upload_photo_to_supabase(message.photo[-1].file_id)
        await msg.delete()
    elif message.text and message.text != "-": image_url = message.text
    conn = await get_db_conn()
    try:
        await conn.execute("INSERT INTO products (restaurant_id, name, price, description, image_url, is_active) VALUES ($1, $2, $3, $4, $5, true)", 
                           data['res_id'], data['name'], data['price'], data['desc'], image_url)
        await message.answer("✅ Добавлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_menu_"))
async def adm_show_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        products = await conn.fetch("SELECT id, name, is_active FROM products WHERE restaurant_id = $1 ORDER BY id DESC", res_id)
        kb = [[InlineKeyboardButton(text="➕ ДОБАВИТЬ БЛЮДО", callback_data=f"adm_add_new_{res_id}")]]
        for p in products: kb.append([InlineKeyboardButton(text=f"{'✅' if p['is_active'] else '🚫'} {p['name']}", callback_data=f"adm_p_{p['id']}")])
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text("Меню:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_p_"))
async def admin_product_menu(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM products WHERE id = $1", prod_id)
        mods_raw = p.get('modifiers')
        mods = json.loads(mods_raw) if mods_raw and isinstance(mods_raw, str) else (mods_raw if mods_raw else [])
        if isinstance(mods, str): mods = json.loads(mods)
        mods_text = "\n\n📋 <b>Опции/Добавки:</b>\n" + "\n".join([f"▫️ {m['name']} (+{m['price']}₽)" for m in mods]) if mods else ""
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📝 Название", callback_data=f"adm_ename_{p['id']}"), InlineKeyboardButton(text="📝 Описание", callback_data=f"adm_edesc_{p['id']}")],
            [InlineKeyboardButton(text="💵 Цена", callback_data=f"adm_price_{p['id']}"), InlineKeyboardButton(text="🖼 Фото", callback_data=f"adm_ephoto_{p['id']}")],
            [InlineKeyboardButton(text="➕ Добавить опцию", callback_data=f"adm_modadd_{p['id']}")],
            [InlineKeyboardButton(text="🧹 Очистить опции", callback_data=f"adm_modclr_{p['id']}")],
            [InlineKeyboardButton(text="🚫 Стоп-лист" if p['is_active'] else "✅ В Меню", callback_data=f"adm_toggle_{p['id']}")],
            [InlineKeyboardButton(text="🔙 Назад к списку", callback_data=f"adm_menu_{p['restaurant_id']}")]
        ])
        await callback.message.edit_text(f"🍔 <b>{p['name']}</b>\nЦена: {p['price']}₽{mods_text}", reply_markup=kb, parse_mode="HTML")
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_modadd_"))
async def adm_mod_add_start(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_modifier)
    await callback.message.answer("Отправьте название добавки и цену <b>через пробел</b>.\nПример: <code>Сырный борт 150</code>", parse_mode="HTML")
    await callback.answer()

@dp.message(AdminStates.waiting_for_modifier)
async def process_modifier(message: types.Message, state: FSMContext):
    parts = message.text.rsplit(' ', 1)
    if len(parts) < 2 or not parts[1].replace('+','').isdigit(): 
        return await message.answer("❌ Ошибка формата! Напишите название и цену через пробел (Пример: <code>Халапеньо 50</code>)", parse_mode="HTML")
    name = parts[0]
    price = int(parts[1].replace('+',''))
    data = await state.get_data()
    prod_id = data['prod_id']
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT modifiers FROM products WHERE id = $1", prod_id)
        mods_raw = p.get('modifiers')
        mods = json.loads(mods_raw) if mods_raw and isinstance(mods_raw, str) else (mods_raw if mods_raw else [])
        if isinstance(mods, str): mods = json.loads(mods)
        mods.append({"name": name, "price": price})
        await conn.execute("UPDATE products SET modifiers = $1::jsonb WHERE id = $2", json.dumps(mods, ensure_ascii=False), prod_id)
        await message.answer(f"✅ Добавка «{name}» (+{price}₽) успешно сохранена!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_modclr_"))
async def adm_mod_clear(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET modifiers = '[]'::jsonb WHERE id = $1", prod_id)
        callback.data = f"adm_p_{prod_id}"
        await admin_product_menu(callback)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_ename_"))
async def adm_edit_name_start(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_edit_name)
    await callback.message.answer("Новое название:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_edit_name)
async def adm_edit_name(message: types.Message, state: FSMContext):
    data = await state.get_data()
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET name = $1 WHERE id = $2", message.text, data['prod_id'])
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()
    
@dp.callback_query(F.data.startswith("adm_edesc_"))
async def adm_edit_desc_start(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_edit_desc)
    await callback.message.answer("Новое описание (или '-'):")
    await callback.answer()

@dp.message(AdminStates.waiting_for_edit_desc)
async def adm_edit_desc(message: types.Message, state: FSMContext):
    data = await state.get_data()
    desc = "" if message.text == "-" else message.text
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET description = $1 WHERE id = $2", desc, data['prod_id'])
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_ephoto_"))
async def adm_edit_photo_start(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_edit_photo)
    await callback.message.answer("Новое фото (или ссылку):")
    await callback.answer()

@dp.message(AdminStates.waiting_for_edit_photo, F.photo | F.text)
async def adm_edit_photo(message: types.Message, state: FSMContext):
    data = await state.get_data()
    image_url = None
    if message.photo:
        msg = await message.answer("⏳ Загружаю фото...")
        image_url = await upload_photo_to_supabase(message.photo[-1].file_id)
        await msg.delete()
    else: image_url = message.text
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET image_url = $1 WHERE id = $2", image_url, data['prod_id'])
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_toggle_"))
async def admin_toggle(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET is_active = NOT COALESCE(is_active, TRUE) WHERE id = $1", prod_id)
        await admin_product_menu(callback)
    finally: await conn.close(); await callback.answer()

@dp.callback_query(F.data.startswith("adm_price_"))
async def admin_price(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_price)
    await callback.message.answer("Новая цена:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_price)
async def process_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    data = await state.get_data()
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET price = $1 WHERE id = $2", int(message.text), data['prod_id'])
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_card_"))
async def adm_card(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_card)
    await callback.message.answer("Новые реквизиты:")
    await callback.answer()

@dp.message(AdminStates.waiting_for_card)
async def process_card(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET card_number = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data.startswith("adm_radius_"))
async def adm_radius(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_radius)
    await callback.message.answer("Новый радиус (км):")
    await callback.answer()

@dp.message(AdminStates.waiting_for_radius)
async def process_radius(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET delivery_radius = $1 WHERE admin_tg_id = $2", int(message.text), message.from_user.id)
        await message.answer("✅ Обновлено!")
        await state.clear()
        await cmd_admin(message, state)
    finally: await conn.close()

@dp.callback_query(F.data == "adm_cancel")
async def admin_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await cmd_admin(callback.message, state)

# ==========================================
#           РАДАР ЗАКАЗОВ И ОТМЕНА
# ==========================================
async def order_checker():
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' AND is_notified = false LIMIT 5")
            for order in new_orders:
                res_info = await conn.fetchrow("SELECT city, admin_tg_id, paid_until FROM restaurants WHERE name = $1", order['restaurant_name'])
                paid = res_info.get('paid_until') if res_info else None
                if paid and paid < datetime.now(timezone.utc): continue
                
                target = res_info['admin_tg_id'] if res_info and res_info['admin_tg_id'] else MAIN_ADMIN_ID
                
                u = json.loads(order['user_data'])
                if isinstance(u, str): u = json.loads(u)
                client_id = u.get('id', 0) if u.get('id') else 0
                
                items = json.loads(order['items'])
                if isinstance(items, str): items = json.loads(items)
                items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])
                city_name = res_info['city'] if res_info else '-'
                
                items_sum = sum([i['price'] * i['count'] for i in items])
                delivery_fee = order['total_price'] - items_sum
                
                active_couriers = await conn.fetchval("SELECT COUNT(*) FROM couriers WHERE city = $1 AND is_active = true AND (paid_until > now() OR paid_until IS NULL)", city_name)
                if active_couriers == 0: courier_warning = f"🔴 <b>ВНИМАНИЕ! На линии 0 курьеров!</b>\nБудьте готовы доставить этот заказ своими силами!"
                else: courier_warning = f"🟢 Курьеров на линии: {active_couriers}"
                
                text = (f"🚨 <b>НОВЫЙ ЗАКАЗ №{order['id']}</b>\n\n🏙 Город: {city_name}\n👤 {u.get('first_name', 'Клиент')}\n📞 Тел: <code>{order['phone']}</code>\n📍 {order['address']}\n\n{items_text}\n💰 <b>ИТОГО: {order['total_price']} ₽</b>\n\n❗️ <b>ОПЛАТА КУРЬЕРУ: Выдайте курьеру {delivery_fee} ₽ при передаче заказа.</b>\n\n{courier_warning}")
                
                kb_buttons = [
                    [InlineKeyboardButton(text="✅ Принять (Выбрать время)", callback_data=f"time_{order['id']}_{client_id}")]
                ]
                if client_id != 0:
                    kb_buttons.append([InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={client_id}")])
                kb_buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{client_id}")])
                
                kb = InlineKeyboardMarkup(inline_keyboard=kb_buttons)
                
                try:
                    if order['receipt_url']: await bot.send_photo(target, order['receipt_url'], caption=text, reply_markup=kb, parse_mode="HTML")
                    else: await bot.send_message(target, text, reply_markup=kb, parse_mode="HTML")
                    
                    await conn.execute("UPDATE orders SET is_notified = true WHERE id = $1", order['id'])
                except Exception as e:
                    print(f"Ошибка отправки заказа {order['id']}: {e}")

            alert_min = 3
            try:
                val = await conn.fetchval("SELECT value FROM settings WHERE key = 'superadmin_alert_min'")
                if val: alert_min = int(val)
            except: pass
            
            lost_orders = await conn.fetch(f"SELECT id, restaurant_name FROM orders WHERE status = 'new' AND created_at < NOW() - INTERVAL '{alert_min} minutes' AND superadmin_notified = false")
            for lost in lost_orders:
                try:
                    await bot.send_message(MAIN_ADMIN_ID, f"🚨 <b>АВАРИЯ! Заказ №{lost['id']} ({lost['restaurant_name']}) висит без ответа уже более {alert_min} минут!</b>\n\nСвяжитесь с рестораном или проверьте вкладку 'Текущие заказы'.", parse_mode="HTML")
                    await conn.execute("UPDATE orders SET superadmin_notified = true WHERE id = $1", lost['id'])
                except: pass

        except Exception as e: 
            print(f"Глобальная ошибка чекера: {e}")
        finally: 
            if conn: await conn.close()
        await asyncio.sleep(15)

async def stuck_order_checker():
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            timeout_min = 5
            try:
                val = await conn.fetchval("SELECT value FROM settings WHERE key = 'self_delivery_timeout_min'")
                if val: timeout_min = int(val)
            except: pass
            
            stuck_orders = await conn.fetch(f"SELECT id, restaurant_name FROM orders WHERE status = 'accepted' AND courier_tg_id IS NULL AND self_delivery_notified = false AND created_at < NOW() - INTERVAL '{timeout_min} minutes'")
            for o in stuck_orders:
                res = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name = $1", o['restaurant_name'])
                target = res['admin_tg_id'] if res and res['admin_tg_id'] else MAIN_ADMIN_ID
                kb = InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🚗 Доставим своими силами", callback_data=f"selfdeliv_{o['id']}")],
                    [InlineKeyboardButton(text="❌ Отменить заказ", callback_data=f"no_{o['id']}_0")]
                ])
                try:
                    await bot.send_message(target, f"⚠️ <b>Заказ №{o['id']} висит уже {timeout_min} минут!</b>\nКурьеры так и не забрали его. Вы доставите его сами или отменим заказ?", reply_markup=kb, parse_mode="HTML")
                    await conn.execute("UPDATE orders SET self_delivery_notified = true WHERE id = $1", o['id'])
                except: pass
        except: pass
        finally:
            if conn: await conn.close()
        await asyncio.sleep(30)

@dp.callback_query(F.data.startswith("selfdeliv_"))
async def handle_self_delivery(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT courier_tg_id, address, phone, lat, lon, user_data FROM orders WHERE id = $1", order_id)
        if not order: 
            return await callback.answer("Заказ не найден!", show_alert=True)
            
        if order['courier_tg_id'] is not None:
            await callback.message.edit_text(f"✅ <b>Заказ №{order_id} уже перехвачен курьером платформы!</b>\nОтменять или везти самим не нужно.", parse_mode="HTML")
            return await callback.answer("Курьер уже забрал этот заказ!", show_alert=True)
            
        await conn.execute("UPDATE orders SET courier_tg_id = -1, status = 'delivering' WHERE id = $1", order_id)
        
        u = json.loads(order['user_data'])
        if u.get('id'):
            try: await bot.send_message(u['id'], f"🚗 <b>Ресторан взял доставку Заказа №{order_id} на себя!</b>\nОжидайте курьера от заведения.", parse_mode="HTML")
            except: pass
            
        if order['lat'] and order['lon']: nav_url = f"https://yandex.ru/maps/?pt={order['lon']},{order['lat']}&z=18&l=map"
        else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['address'].split(', кв/офис')[0])
        
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🗺 Открыть маршрут", url=nav_url)],
            [InlineKeyboardButton(text="🏁 Заказ доставлен клиенту", callback_data=f"done_{order_id}")]
        ])
        text = (f"🚗 <b>Вы доставляете Заказ №{order_id} своими силами!</b>\n\n📍 Адрес: {order['address']}\n📞 Тел: <code>{order['phone']}</code>\n\n<i>Скопируйте этот текст и отправьте своему курьеру, или нажмите кнопку маршрута ниже.</i>")
        if callback.message.photo: await callback.message.edit_caption(caption=text, reply_markup=kb, parse_mode="HTML")
        else: await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    finally: 
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data.startswith("time_"))
async def ask_prep_time(callback: CallbackQuery):
    data = callback.data.split("_")
    order_id = data[1]
    client_id = data[2] if len(data) > 2 and data[2] != "None" else "0"
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="15 мин", callback_data=f"ok_{order_id}_{client_id}_15"), InlineKeyboardButton(text="30 мин", callback_data=f"ok_{order_id}_{client_id}_30")],
        [InlineKeyboardButton(text="45 мин", callback_data=f"ok_{order_id}_{client_id}_45"), InlineKeyboardButton(text="1 час", callback_data=f"ok_{order_id}_{client_id}_60")],
        [InlineKeyboardButton(text="1.5 часа", callback_data=f"ok_{order_id}_{client_id}_90"), InlineKeyboardButton(text="2 часа", callback_data=f"ok_{order_id}_{client_id}_120")]
    ])
    await callback.message.edit_reply_markup(reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("ok_") | F.data.startswith("no_"))
async def handle_decision(callback: CallbackQuery):
    data = callback.data.split("_")
    action = data[0]
    order_id = int(data[1])
    
    client_id_str = data[2]
    client_id = int(client_id_str) if client_id_str.isdigit() else 0
    
    conn = await get_db_conn()
    try:
        if client_id == 0:
            o_info = await conn.fetchrow("SELECT user_data FROM orders WHERE id = $1", order_id)
            if o_info and o_info['user_data']:
                u_data = json.loads(o_info['user_data'])
                if isinstance(u_data, str): u_data = json.loads(u_data)
                client_id = int(u_data.get('id', 0))
                
        if action == "ok":
            prep_time = int(data[3])
            ready_time = (datetime.now(MSK) + timedelta(minutes=prep_time)).strftime('%H:%M')
            
            await conn.execute("UPDATE orders SET status = 'accepted', ready_time = $2 WHERE id = $1", order_id, ready_time)
            
            if client_id: 
                try: await bot.send_message(client_id, f"🎉 Заказ №{order_id} принят! Еда будет готова примерно к {ready_time}. Ищем курьера.")
                except: pass
                
            order_info = await conn.fetchrow("SELECT o.address, o.items, o.total_price, r.city, o.restaurant_name FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.id = $1", order_id)
            
            items = json.loads(order_info['items'])
            if isinstance(items, str): items = json.loads(items)
            
            delivery_fee = order_info['total_price'] - sum([i['price'] * i['count'] for i in items])
            
            all_couriers = await conn.fetch("SELECT tg_id, is_active FROM couriers WHERE city = $1 AND (paid_until > now() OR paid_until IS NULL)", order_info['city'])
            active_couriers = [c for c in all_couriers if c['is_active']]
            target_couriers = active_couriers if active_couriers else all_couriers
            kb_c = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{order_id}")]])
            
            for c in target_couriers:
                prefix = "🚨 Новый заказ" if c['is_active'] else "🆘 ГОРЯЩИЙ ЗАКАЗ! На линии никого нет, выручай!"
                try: await bot.send_message(c['tg_id'], f"{prefix} №{order_id}\nИз: {order_info['restaurant_name']}\nКуда: 📍 [Скрыт до принятия заказа]\n💵 <b>Оплата за доставку: {delivery_fee} ₽ (заберете в ресторане)</b>\n\n⏳ <b>Будет готово к {ready_time} (через {prep_time} мин)</b>", reply_markup=kb_c, parse_mode="HTML")
                except: pass
            
            caption = (callback.message.caption or callback.message.text).split('\n\n🔴')[0].split('\n\n🟢')[0]
            caption += f"\n\n🟢 ПРИНЯТ (Готовность: к {ready_time})"
            if callback.message.photo: await callback.message.edit_caption(caption=caption, parse_mode="HTML")
            else: await callback.message.edit_text(text=caption, parse_mode="HTML")
            
        else:
            order = await conn.fetchrow("SELECT o.total_price, o.payment_id, o.receipt_url, o.phone, r.payment_method, r.yookassa_shop_id, r.yookassa_secret_key, r.support_link FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.id = $1", order_id)
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            
            caption = (callback.message.caption or callback.message.text).split('\n\n🔴')[0].split('\n\n🟢')[0]
            caption += "\n\n🔴 ОТМЕНЕН"
            if callback.message.photo: await callback.message.edit_caption(caption=caption, parse_mode="HTML")
            else: await callback.message.edit_text(text=caption, parse_mode="HTML")

            if order:
                support_kb = []
                if order.get('support_link') and order['support_link'].startswith("http"): support_kb.append([InlineKeyboardButton(text="📞 Написать в ресторан", url=order['support_link'])])
                markup = InlineKeyboardMarkup(inline_keyboard=support_kb) if support_kb else None

                if order['payment_method'] == 'yookassa' and order['payment_id']:
                    refund_ok = await refund_yookassa_payment(order['yookassa_shop_id'], order['yookassa_secret_key'], order['payment_id'], order['total_price'])
                    if client_id:
                        if refund_ok: await bot.send_message(client_id, f"❌ Заказ №{order_id} отменен заведением.\n💸 <b>Деньги ({order['total_price']} ₽) автоматически возвращены</b> на вашу карту!", parse_mode="HTML", reply_markup=markup)
                        else: await bot.send_message(client_id, f"❌ Заказ №{order_id} отменен.\n⚠️ Ошибка возврата. Свяжитесь с администратором.", parse_mode="HTML", reply_markup=markup)
                elif order['payment_method'] == 'manual' and order['receipt_url']:
                    if client_id: await bot.send_message(client_id, f"❌ Заказ №{order_id} отменен заведением.\n📞 Администратор свяжется с вами для возврата.", parse_mode="HTML", reply_markup=markup)
                    await callback.message.answer(f"⚠️ <b>Возврат средств!</b>\nВы отменили заказ №{order_id}.\n📞 <b>Свяжитесь с клиентом:</b> <code>{order['phone']}</code>\nСумма: <b>{order['total_price']} ₽</b>", parse_mode="HTML")
                else:
                    if client_id: await bot.send_message(client_id, f"❌ Заказ №{order_id} отменен заведением.", reply_markup=markup)
    finally: 
        await conn.close()
        await callback.answer()


# ==========================================
#           ОБРАБОТКА НИЖНЕГО МЕНЮ И RESEND
# ==========================================

@dp.message(F.text == "🏠 Панель управления")
async def btn_admin_panel(message: types.Message, state: FSMContext):
    await cmd_admin(message, state)

@dp.message(F.text == "🛵 Личный кабинет")
async def btn_courier_panel(message: types.Message, state: FSMContext):
    await cmd_courier(message, state)

@dp.message(F.text == "📱 Открыть карту")
async def btn_courier_map(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ", web_app=WebAppInfo(url="https://leki-app.vercel.app/courier"))]
    ])
    await message.answer("Твоя карта заказов:", reply_markup=kb)

@dp.message(F.text == "🆘 Поддержка")
async def btn_support(message: types.Message):
    await message.answer("🆘 Возникли трудности? Пишите нам: @gasangamidov\nМы поможем!")

# --- ПАГИНАЦИЯ АКТИВНЫХ ЗАКАЗОВ ---
async def render_active_orders(tg_id, page=0):
    PAGE_SIZE = 5 
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT name FROM restaurants WHERE admin_tg_id = $1", tg_id)
        if not res and tg_id != MAIN_ADMIN_ID:
            return "У вас нет доступа.", None
            
        query = "SELECT id, status, total_price, address FROM orders WHERE status NOT IN ('completed', 'cancelled', 'awaiting_payment', 'payment_pending')"
        args = []
        
        if tg_id != MAIN_ADMIN_ID:
            query += " AND restaurant_name = $1"
            args.append(res['name'])
            
        query += " ORDER BY id DESC"
        
        orders = await conn.fetch(query, *args)
        
        if not orders:
            return "Сейчас активных заказов нет. Отдыхаем! ☕️", None
            
        total_orders = len(orders)
        total_pages = (total_orders + PAGE_SIZE - 1) // PAGE_SIZE
        
        if page >= total_pages: page = total_pages - 1
        if page < 0: page = 0
        
        start_idx = page * PAGE_SIZE
        end_idx = start_idx + PAGE_SIZE
        page_orders = orders[start_idx:end_idx]
        
        text = f"📋 <b>АКТИВНЫЕ ЗАКАЗЫ (Стр. {page+1} из {total_pages}):</b>\n<i>Всего в работе: {total_orders} шт.</i>\n\n"
        kb_buttons = []
        
        for o in page_orders:
            status_emoji = "🆕" if o['status'] == 'new' else "👨‍🍳" if o['status'] == 'accepted' else "🛵"
            addr = o['address'] if o['address'] else "Адрес не указан"
            addr_short = addr[:30] + "..." if len(addr) > 30 else addr
            text += f"{status_emoji} <b>Заказ №{o['id']}</b> | {o['total_price']}₽\n📍 {addr_short}\n\n"
            kb_buttons.append([InlineKeyboardButton(text=f"{status_emoji} Управление заказом №{o['id']}", callback_data=f"resend_{o['id']}")])
        
        nav_buttons = []
        if page > 0:
            nav_buttons.append(InlineKeyboardButton(text="⬅️ Назад", callback_data=f"actpg_{page-1}"))
        if page < total_pages - 1:
            nav_buttons.append(InlineKeyboardButton(text="Вперед ➡️", callback_data=f"actpg_{page+1}"))
            
        if nav_buttons:
            kb_buttons.append(nav_buttons)
            
        return text, InlineKeyboardMarkup(inline_keyboard=kb_buttons)
    finally:
        await conn.close()

@dp.message(F.text == "📦 Текущие заказы")
async def btn_active_orders(message: types.Message):
    text, kb = await render_active_orders(message.from_user.id, 0)
    if kb:
        await message.answer(text, reply_markup=kb, parse_mode="HTML")
    else:
        await message.answer(text, parse_mode="HTML")

@dp.callback_query(F.data.startswith("actpg_"))
async def paginate_active_orders(callback: CallbackQuery):
    page = int(callback.data.split("_")[1])
    text, kb = await render_active_orders(callback.from_user.id, page)
    if kb:
        await callback.message.edit_text(text, reply_markup=kb, parse_mode="HTML")
    else:
        await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()

@dp.callback_query(F.data.startswith("resend_"))
async def resend_order_card(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        if not order: return await callback.answer("Заказ не найден", show_alert=True)
        
        u = json.loads(order['user_data'])
        if isinstance(u, str): u = json.loads(u)
        client_id = u.get('id', 0)
        
        items = json.loads(order['items'])
        if isinstance(items, str): items = json.loads(items)
        items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])
        
        items_sum = sum([i['price'] * i['count'] for i in items])
        delivery_fee = order['total_price'] - items_sum
        
        if order['status'] == 'new':
            text = f"🚨 <b>ПОВТОР: НОВЫЙ ЗАКАЗ №{order['id']}</b>\n\n👤 {u.get('first_name', 'Клиент')}\n📞 Тел: <code>{order['phone']}</code>\n📍 {order['address']}\n\n{items_text}\n💰 <b>ИТОГО: {order['total_price']} ₽</b>\n\n❗️ ОПЛАТА КУРЬЕРУ: {delivery_fee} ₽"
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="✅ Принять (Выбрать время)", callback_data=f"time_{order['id']}_{client_id}")],
                [InlineKeyboardButton(text="💬 Написать клиенту", url=f"tg://user?id={client_id}")],
                [InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{client_id}")]
            ])
            
        elif order['status'] == 'accepted':
            text = f"⏳ <b>ПОВТОР: ЗАКАЗ №{order['id']} (ГОТОВИТСЯ)</b>\n\n📍 {order['address']}\n📞 <code>{order['phone']}</code>\n\n{items_text}"
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🚗 Доставим своими силами", callback_data=f"selfdeliv_{order['id']}")],
                [InlineKeyboardButton(text="❌ Отменить заказ", callback_data=f"no_{order['id']}_{client_id}")]
            ])
            
        elif order['status'] == 'delivering' and order['courier_tg_id'] == -1:
            if order['lat'] and order['lon']: nav_url = f"https://yandex.ru/maps/?pt={order['lon']},{order['lat']}&z=18&l=map"
            else: nav_url = "https://yandex.ru/maps/?text=" + urllib.parse.quote(order['address'].split(', кв/офис')[0])
            text = f"🚗 <b>ПОВТОР: СВОЯ ДОСТАВКА №{order['id']}</b>\n\n📍 {order['address']}\n📞 <code>{order['phone']}</code>"
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🗺 Открыть маршрут", url=nav_url)],
                [InlineKeyboardButton(text="🏁 Заказ доставлен клиенту", callback_data=f"done_{order['id']}")]
            ])
        else:
            text = f"ℹ️ <b>Инфо о заказе №{order['id']}</b>\nСтатус: {order['status']}\n📍 {order['address']}\nКурьер ID: {order['courier_tg_id']}"
            kb = None

        if order['receipt_url']: await callback.message.answer_photo(order['receipt_url'], caption=text, reply_markup=kb, parse_mode="HTML")
        else: await callback.message.answer(text, reply_markup=kb, parse_mode="HTML")
        await callback.answer()
    finally: await conn.close()

async def main():
    asyncio.create_task(order_checker())
    asyncio.create_task(stuck_order_checker())
    asyncio.create_task(payment_processor())
    asyncio.create_task(courier_monitor())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())