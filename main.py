import asyncio
import asyncpg
import json
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- НАСТРОЙКИ ---
TOKEN = "8512667739:AAGd8qfpTo6w81L0THUubgNp-xkbt9y-KA4"
DB_URL = "postgresql://postgres.dmjwjmpmafaxythyqwoz:828Yb24BKN0JMBiR@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
MAIN_ADMIN_ID = 5340841151 # Твой основной ID

bot = Bot(token=TOKEN)
dp = Dispatcher()

# --- СОСТОЯНИЯ ---
class AdminStates(StatesGroup):
    waiting_for_price = State()
    waiting_for_card = State()
    waiting_for_radius = State()
    prod_id = State()

class CourierStates(StatesGroup):
    change_city = State()

async def get_db_conn():
    return await asyncpg.connect(DB_URL, statement_cache_size=0)

# ==========================================
#           ОБЩИЕ КОМАНДЫ
# ==========================================
@dp.message(Command("start"))
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🍔 Открыть меню", web_app=WebAppInfo(url="https://leki-app.vercel.app/"))
    ]])
    await message.answer("Ассаламу алейкум! Добро пожаловать в сервис доставки LEKI.\n\n🛠 Владельцам: /admin\n🛵 Курьерам: /courier", reply_markup=kb)

@dp.message(Command("my_id"))
async def cmd_my_id(message: types.Message):
    await message.answer(f"Ваш Telegram ID:\n<code>{message.from_user.id}</code>\n\n<i>Нажмите на цифры, чтобы скопировать.</i>", parse_mode="HTML")

# ==========================================
#        УПРАВЛЕНИЕ КУРЬЕРАМИ (СУПЕР-АДМИН)
# ==========================================
@dp.message(Command("add_courier"))
async def admin_add_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split(maxsplit=2)
    if len(args) < 3:
        return await message.answer("⚠️ Формат: /add_courier [ID] [Имя]\nПример: /add_courier 123456789 Магомед")
    
    try:
        c_id = int(args[1])
        c_name = args[2]
        conn = await get_db_conn()
        # Добавляем курьера с дефолтным городом '-', он сам его поменяет
        await conn.execute("INSERT INTO couriers (tg_id, name, city, is_active) VALUES ($1, $2, '-', false) ON CONFLICT (tg_id) DO UPDATE SET name = $2", c_id, c_name)
        await conn.close()
        await message.answer(f"✅ Курьер <b>{c_name}</b> (ID: {c_id}) добавлен в систему!\nТеперь он может зайти через /courier.", parse_mode="HTML")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

@dp.message(Command("del_courier"))
async def admin_del_courier(message: types.Message):
    if message.from_user.id != MAIN_ADMIN_ID: return
    args = message.text.split()
    if len(args) < 2:
        return await message.answer("⚠️ Формат: /del_courier [ID]")
    try:
        c_id = int(args[1])
        conn = await get_db_conn()
        await conn.execute("DELETE FROM couriers WHERE tg_id = $1", c_id)
        await conn.close()
        await message.answer(f"🚫 Курьер (ID: {c_id}) удален и заблокирован.")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

# ==========================================
#           ПАНЕЛЬ КУРЬЕРА (ЗАКРЫТАЯ)
# ==========================================
@dp.message(Command("courier"))
async def cmd_courier(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        c = await conn.fetchrow("SELECT * FROM couriers WHERE tg_id = $1", message.from_user.id)
        if not c:
            return await message.answer("❌ <b>Доступ запрещен.</b>\nВы не добавлены в систему курьеров. Если вы курьер, узнайте свой ID командой /my_id и отправьте его администратору.", parse_mode="HTML")
        
        if c['city'] == '-':
            await message.answer(f"👋 Добро пожаловать, {c['name']}!\nНапишите название <b>города</b>, в котором вы будете принимать заказы:", parse_mode="HTML")
            await state.set_state(CourierStates.change_city)
        else:
            status_text = "🟢 НА ЛИНИИ (Ищем заказы)" if c['is_active'] else "🔴 ПЕРЕРЫВ (Заказы не приходят)"
            toggle_btn = "🔴 Уйти на перерыв" if c['is_active'] else "🟢 Выйти на линию"
            
            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🏙 Изменить город", callback_data="cour_change_city")],
                [InlineKeyboardButton(text=toggle_btn, callback_data="cour_toggle")]
            ])
            text = f"🛵 <b>Личный кабинет курьера</b>\n\n👤 Имя: {c['name']}\n🏙 Город: {c['city']}\n\n📊 Статус: <b>{status_text}</b>"
            await message.answer(text, parse_mode="HTML", reply_markup=kb)
    finally:
        await conn.close()

@dp.callback_query(F.data == "cour_change_city")
async def cour_ask_city(callback: CallbackQuery, state: FSMContext):
    await state.set_state(CourierStates.change_city)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="cour_cancel")]])
    await callback.message.edit_text("Напишите название нового города:", reply_markup=kb)
    await callback.answer()

@dp.message(CourierStates.change_city)
async def cour_save_city(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE couriers SET city = $1 WHERE tg_id = $2", message.text, message.from_user.id)
        await message.answer(f"✅ Город успешно установлен на <b>{message.text}</b>!", parse_mode="HTML")
        await state.clear()
        await cmd_courier(message, state)
    finally:
        await conn.close()

@dp.callback_query(F.data == "cour_cancel")
async def cour_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await cmd_courier(callback.message, state)

@dp.callback_query(F.data == "cour_toggle")
async def cour_toggle_status(callback: CallbackQuery, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE couriers SET is_active = NOT COALESCE(is_active, TRUE) WHERE tg_id = $1", callback.from_user.id)
        await cmd_courier(callback.message, state)
    finally:
        await conn.close()
        await callback.answer()

# --- ЛОГИКА ПРИНЯТИЯ ЗАКАЗА КУРЬЕРОМ ---
@dp.callback_query(F.data.startswith("take_"))
async def take_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    tg_id = callback.from_user.id
    
    conn = await get_db_conn()
    try:
        order = await conn.fetchrow("SELECT courier_tg_id, address, phone, restaurant_name FROM orders WHERE id = $1", order_id)
        if not order: return
        
        if order['courier_tg_id'] is not None:
            if order['courier_tg_id'] == tg_id:
                await callback.answer("Вы уже везете этот заказ!", show_alert=True)
            else:
                await callback.answer("Опоздали! Заказ перехвачен 😔", show_alert=True)
                await callback.message.edit_text("❌ <b>Заказ забрал другой курьер.</b>", parse_mode="HTML")
            return
        
        await conn.execute("UPDATE orders SET courier_tg_id = $1, status = 'delivering' WHERE id = $2", tg_id, order_id)
        
        text = (
            f"✅ <b>ВЫ ВЗЯЛИ ЗАКАЗ №{order_id}</b>\n\n"
            f"🏠 Откуда забрать: <b>{order['restaurant_name']}</b>\n"
            f"📍 Куда везти: <b>{order['address']}</b>\n"
            f"📞 Телефон клиента: <b>{order['phone']}</b>\n\n"
            f"<i>Как только отдадите пакет, нажмите кнопку ниже!</i>"
        )
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🏁 Заказ Доставлен", callback_data=f"done_{order_id}")]])
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    finally:
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data.startswith("done_"))
async def done_order(callback: CallbackQuery):
    order_id = int(callback.data.split("_")[1])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE orders SET status = 'completed' WHERE id = $1", order_id)
        await callback.message.edit_text(f"🏁 <b>Заказ №{order_id} успешно доставлен!</b>\nОтличная работа! Ждем новые заказы...", parse_mode="HTML")
        
        o = await conn.fetchrow("SELECT user_data FROM orders WHERE id = $1", order_id)
        if o and o['user_data']:
            u = json.loads(o['user_data']) if isinstance(o['user_data'], str) else o['user_data']
            if u and u.get('id'):
                try:
                    await bot.send_message(u['id'], f"🛎 <b>Ваш заказ №{order_id} доставлен!</b>\nПриятного аппетита и спасибо, что выбрали нас!", parse_mode="HTML")
                except: pass
    finally:
        await conn.close()
        await callback.answer()

# ==========================================
#           АДМИН ПАНЕЛЬ ЗАВЕДЕНИЯ
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    await state.clear()
    conn = await get_db_conn()
    try:
        res = await conn.fetchrow("SELECT id, name, card_number, delivery_radius FROM restaurants WHERE admin_tg_id = $1", message.from_user.id)
        if not res and message.from_user.id == MAIN_ADMIN_ID:
            res = await conn.fetchrow("SELECT id, name, card_number, delivery_radius FROM restaurants LIMIT 1")
        if not res:
            await message.answer("❌ У вас нет прав администратора или привязанного заведения.")
            return

        res_id, res_name, card_number = res['id'], res['name'], res['card_number']
        radius = res['delivery_radius'] or 15 
        
        kb = [
            [InlineKeyboardButton(text="🗺 Управление меню (Стоп-лист/Цены)", callback_data=f"adm_menu_{res_id}")],
            [InlineKeyboardButton(text="💳 Мои реквизиты", callback_data=f"adm_card_{res_id}")],
            [InlineKeyboardButton(text=f"📍 Радиус доставки: {radius} км", callback_data=f"adm_radius_{res_id}")],
        ]
        text = f"🛠 <b>Панель управления: {res_name}</b>\n\nТекущие реквизиты:\n<code>{card_number or 'Не указаны'}</code>\n\nВыберите действие:"
        await message.answer(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_card_"))
async def adm_change_card(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_card)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="adm_cancel")]])
    await callback.message.edit_text("Отправьте новый текст реквизитов:", reply_markup=kb)
    await callback.answer()

@dp.message(AdminStates.waiting_for_card)
async def process_new_card(message: types.Message, state: FSMContext):
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET card_number = $1 WHERE admin_tg_id = $2", message.text, message.from_user.id)
        await message.answer("✅ Реквизиты успешно обновлены!")
        await state.clear()
        await cmd_admin(message, state) 
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_radius_"))
async def adm_change_radius(callback: CallbackQuery, state: FSMContext):
    await state.set_state(AdminStates.waiting_for_radius)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="adm_cancel")]])
    await callback.message.edit_text("Отправьте максимальный радиус доставки (число):", reply_markup=kb)
    await callback.answer()

@dp.message(AdminStates.waiting_for_radius)
async def process_new_radius(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return await message.answer("Только число!")
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE restaurants SET delivery_radius = $1 WHERE admin_tg_id = $2", int(message.text), message.from_user.id)
        await message.answer("✅ Радиус обновлен!")
        await state.clear()
        await cmd_admin(message, state)
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_menu_"))
async def adm_show_menu(callback: CallbackQuery):
    res_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        products = await conn.fetch("SELECT id, name, is_active FROM products WHERE restaurant_id = $1 ORDER BY id", res_id)
        kb = [[InlineKeyboardButton(text=f"{'✅' if p['is_active'] else '🚫'} {p['name']}", callback_data=f"adm_p_{p['id']}")] for p in products]
        kb.append([InlineKeyboardButton(text="🔙 Назад", callback_data="adm_cancel")])
        await callback.message.edit_text("Выберите блюдо для настройки:", reply_markup=InlineKeyboardMarkup(inline_keyboard=kb))
    finally:
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data.startswith("adm_p_"))
async def admin_product_menu(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        p = await conn.fetchrow("SELECT * FROM products WHERE id = $1", prod_id)
        is_active = p['is_active'] if p['is_active'] is not None else True
        text = f"🍔 <b>{p['name']}</b>\n💰 Цена: {p['price']} ₽\n📊 Статус: <b>{'🟢 В меню' if is_active else '🔴 В СТОП-ЛИСТЕ'}</b>"
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💵 Изменить цену", callback_data=f"adm_price_{p['id']}")],
            [InlineKeyboardButton(text="🚫 Убрать в стоп-лист" if is_active else "✅ Вернуть в меню", callback_data=f"adm_toggle_{p['id']}")],
            [InlineKeyboardButton(text="🔙 К списку", callback_data=f"adm_menu_{p['restaurant_id']}")]
        ])
        await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    finally:
        await conn.close()
        await callback.answer()

@dp.callback_query(F.data.startswith("adm_toggle_"))
async def admin_toggle(callback: CallbackQuery):
    prod_id = int(callback.data.split("_")[2])
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET is_active = NOT COALESCE(is_active, TRUE) WHERE id = $1", prod_id)
        await admin_product_menu(callback) 
    finally:
        await conn.close()

@dp.callback_query(F.data.startswith("adm_price_"))
async def admin_price(callback: CallbackQuery, state: FSMContext):
    prod_id = int(callback.data.split("_")[2])
    await state.update_data(prod_id=prod_id)
    await state.set_state(AdminStates.waiting_for_price)
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="❌ Отмена", callback_data="adm_cancel")]])
    await callback.message.edit_text("Отправьте новую цену цифрами:", reply_markup=kb)
    await callback.answer()

@dp.message(AdminStates.waiting_for_price)
async def process_new_price(message: types.Message, state: FSMContext):
    if not message.text.isdigit(): return
    data = await state.get_data()
    conn = await get_db_conn()
    try:
        await conn.execute("UPDATE products SET price = $1 WHERE id = $2", int(message.text), data['prod_id'])
        await message.answer("✅ Цена обновлена!")
        await state.clear()
    finally:
        await conn.close()

@dp.callback_query(F.data == "adm_cancel")
async def admin_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.delete()
    await cmd_admin(callback.message, state)


# ==========================================
#           РАДАР ЗАКАЗОВ
# ==========================================
async def order_checker():
    while True:
        conn = None
        try:
            conn = await get_db_conn()
            new_orders = await conn.fetch("SELECT * FROM orders WHERE status = 'new' AND is_notified = false LIMIT 5")
            
            for order in new_orders:
                try:
                    res_info = await conn.fetchrow("SELECT city FROM restaurants WHERE name ILIKE $1", order['restaurant_name'])
                    city_name = res_info['city'] if res_info else "Не указан"

                    user = json.loads(order['user_data']) if isinstance(order['user_data'], str) else order['user_data']
                    items = json.loads(order['items']) if isinstance(order['items'], str) else order['items']
                    
                    items_text = "".join([f"▫️ {i['name']} x {i['count']}\n" for i in items])
                    raw_address = order.get('address', 'Не указан')
                    
                    res_admin = await conn.fetchrow("SELECT admin_tg_id FROM restaurants WHERE name ILIKE $1", order['restaurant_name'])
                    target_id = res_admin['admin_tg_id'] if res_admin and res_admin['admin_tg_id'] else MAIN_ADMIN_ID

                    text = (
                        f"🚨 <b>НОВЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ №{order['id']}</b>\n"
                        f"🏙 Город: <b>{city_name}</b>\n" 
                        f"🏠 Заведение: <b>{order['restaurant_name']}</b>\n\n" 
                        f"📍 Адрес: {raw_address}\n\n"
                        f"{items_text}\n"
                        f"💰 <b>ИТОГО: {order['total_price']} ₽</b>"
                    )

                    kb = InlineKeyboardMarkup(inline_keyboard=[[
                        InlineKeyboardButton(text="✅ Принять (Оплачено)", callback_data=f"ok_{order['id']}_{user.get('id', 0)}"),
                        InlineKeyboardButton(text="❌ Отмена", callback_data=f"no_{order['id']}_{user.get('id', 0)}")
                    ]])

                    receipt_url = order.get('receipt_url')
                    if receipt_url:
                        try:
                            await bot.send_photo(chat_id=target_id, photo=receipt_url, caption=text, parse_mode="HTML", reply_markup=kb)
                        except:
                            await bot.send_message(chat_id=target_id, text=text + f"\n\n📎 <a href='{receipt_url}'>ОТКРЫТЬ ЧЕК</a>", parse_mode="HTML", reply_markup=kb)
                    else:
                        await bot.send_message(chat_id=target_id, text=text, parse_mode="HTML", reply_markup=kb)
                    
                    await conn.execute("UPDATE orders SET is_notified = true WHERE id = $1", order['id'])

                except Exception as order_err:
                    print(f"❌ Ошибка в цикле заказа: {order_err}")

        except: pass
        finally:
            if conn: await conn.close()
        await asyncio.sleep(15)

@dp.callback_query(F.data.startswith(("ok_", "no_")))
async def handle_buttons(callback: CallbackQuery):
    data = callback.data.split("_")
    action, order_id, client_id = data[0], int(data[1]), int(data[2])
    
    conn = await get_db_conn()
    try:
        if action == "ok":
            await conn.execute("UPDATE orders SET status = 'accepted' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, f"🎉 <b>Отличные новости!</b>\nВаш заказ <b>№{order_id}</b> успешно оплачен и принят. Скоро мы найдем курьера!", parse_mode="HTML")
            
            # --- РАССЫЛКА КУРЬЕРАМ ---
            order_info = await conn.fetchrow("SELECT o.restaurant_name, o.address, r.city FROM orders o JOIN restaurants r ON o.restaurant_name = r.name WHERE o.id = $1", order_id)
            if order_info and order_info['city']:
                couriers = await conn.fetch("SELECT tg_id FROM couriers WHERE city ILIKE $1 AND is_active = true", order_info['city'])
                
                raw_address = order_info['address'] or 'Не указан'
                address_part, delivery_part = raw_address.split("\n🚚", 1) if "\n🚚" in raw_address else (raw_address, "")

                text_for_couriers = (
                    f"🚨 <b>СВОБОДНЫЙ ЗАКАЗ №{order_id}</b>\n\n"
                    f"🏠 Из: <b>{order_info['restaurant_name']}</b>\n"
                    f"📍 Куда: {address_part}\n\n"
                    f"💰 <b>🚚 {delivery_part.strip()}</b>\n\n"
                    f"<i>Кто первый нажмет, тот и забирает!</i>"
                )
                kb_courier = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="🛵 Взять заказ", callback_data=f"take_{order_id}")]])
                
                for c in couriers:
                    try: await bot.send_message(c['tg_id'], text_for_couriers, parse_mode="HTML", reply_markup=kb_courier)
                    except: pass
            # ---------------------------

            new_caption = (callback.message.caption or callback.message.text) + "\n\n🟢 СТАТУС: ПРИНЯТ (ИЩЕМ КУРЬЕРА)"
            if callback.message.photo: await callback.message.edit_caption(caption=new_caption)
            else: await callback.message.edit_text(text=new_caption)

        else:
            await conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = $1", order_id)
            if client_id:
                await bot.send_message(client_id, f"😔 <b>К сожалению, отмена...</b>\nЗаведение не смогло принять ваш заказ <b>№{order_id}</b>.", parse_mode="HTML")
            
            new_caption = (callback.message.caption or callback.message.text) + "\n\n🔴 СТАТУС: ОТМЕНЕН"
            if callback.message.photo: await callback.message.edit_caption(caption=new_caption)
            else: await callback.message.edit_text(text=new_caption)
    finally:
        await conn.close()
        await callback.answer()

async def main():
    asyncio.create_task(order_checker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())