'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default function CourierApp() {
  const [courier, setCourier] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState(null)
  const [availableOrders, setAvailableOrders] = useState([])
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [offlineTimer, setOfflineTimer] = useState(null)
  const locRef = useRef(null);

  useEffect(() => {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    async function auth() {
      if (!tgUser?.id) return setIsAuthLoading(false);
      const { data } = await supabase.from('couriers').select('*').eq('tg_id', tgUser.id).single();
      if (data) setCourier(data);
      setIsAuthLoading(false);
    }
    auth();
  }, []);

  useEffect(() => {
    if (!courier) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { locRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }; },
      (err) => { console.error("GPS Error", err); },
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [courier]);

  useEffect(() => {
    if (!courier) return;
    const fetchOrders = async () => {
      const { data: active } = await supabase.from('orders').select('*').eq('courier_tg_id', courier.tg_id).in('status', ['taken', 'delivering', 'arrived']).maybeSingle();
      setActiveOrder(active || null);

      if (!active && courier.is_active) {
        const { data: available } = await supabase.from('orders').select('*, restaurants!inner(id, lat, lon, city)').eq('status', 'accepted').is('courier_tg_id', null).eq('restaurants.city', courier.city);
        if (available) {
            const currentLoc = locRef.current;
            const filtered = available.filter(order => {
                if (!currentLoc) return true; 
                const dist = getDistance(currentLoc.lat, currentLoc.lon, order.restaurants.lat, order.restaurants.lon);
                const minutesPassed = (new Date() - new Date(order.created_at)) / 60000;
                if (minutesPassed < 5) return dist <= 3.5; 
                if (minutesPassed < 10) return dist <= 7.0;
                return true; 
            });
            setAvailableOrders(filtered);
        }
      } else { setAvailableOrders([]); }
    };
    fetchOrders();
    const interval = setInterval(fetchOrders, 8000);
    return () => clearInterval(interval);
  }, [courier, courier?.is_active]);

  useEffect(() => {
    let timer;
    if (offlineTimer !== null && offlineTimer > 0) {
      timer = setTimeout(() => setOfflineTimer(offlineTimer - 1), 1000);
    } else if (offlineTimer === 0) {
      finishToggleStatus(false);
      setOfflineTimer(null);
    }
    return () => clearTimeout(timer);
  }, [offlineTimer]);

  const startToggleStatus = async () => {
    if (courier.is_active) {
      const { data } = await supabase.from('settings').select('value').eq('key', 'courier_buffer_sec').single();
      setOfflineTimer(data ? parseInt(data.value) : 60);
    } else { finishToggleStatus(true); }
  };

  const finishToggleStatus = async (val) => {
    await supabase.from('couriers').update({ is_active: val }).eq('tg_id', courier.tg_id);
    setCourier({ ...courier, is_active: val });
  };

  const notifyTelegram = async (order, type) => {
      try {
          const uData = typeof order.user_data === 'string' ? JSON.parse(order.user_data) : order.user_data;
          const { data: resData } = await supabase.from('restaurants').select('id, admin_tg_id').eq('name', order.restaurant_name).single();

          let clientMsg = type === 'taken' ? 'Курьер найден и спешит в ресторан! 🏃‍♂️' : type === 'delivering' ? 'Курьер забрал заказ и уже в пути! 🚴‍♂️💨' : type === 'arrived' ? 'Курьер уже у ваших дверей! 📍' : '';
          let resMsg = type === 'taken' ? 'Курьер платформы принял заказ и едет к вам 🏃‍♂️' : type === 'delivering' ? 'Курьер забрал заказ и выехал к клиенту 🚴‍♂️' : type === 'completed' ? 'Заказ успешно доставлен курьером платформы! ✅' : '';

          if (clientMsg && uData?.id) {
              await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `🛎 <b>Ваш заказ №${order.id}</b>\n${clientMsg}` }) });
          }
          if (resMsg && resData?.admin_tg_id) {
              await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: resData.admin_tg_id, message: `📦 <b>Заказ №${order.id}</b>\nСтатус: ${resMsg}` }) });
          }

          if (type === 'completed' && uData?.id && resData?.id) {
              const starsKb = {
                  inline_keyboard: [[
                      { text: "1 ⭐", callback_data: `rres_${order.id}_${resData.id}_1` },
                      { text: "2 ⭐", callback_data: `rres_${order.id}_${resData.id}_2` },
                      { text: "3 ⭐", callback_data: `rres_${order.id}_${resData.id}_3` },
                      { text: "4 ⭐", callback_data: `rres_${order.id}_${resData.id}_4` },
                      { text: "5 ⭐", callback_data: `rres_${order.id}_${resData.id}_5` }
                  ]]
              };
              await fetch('/api/notify', { 
                  method: 'POST', 
                  body: JSON.stringify({ 
                      targetId: uData.id, 
                      message: `😋 <b>Оцените блюда от ${order.restaurant_name}:</b>`, 
                      reply_markup: starsKb 
                  }) 
              });
          }
      } catch(e) { console.error(e) }
  }

  const handleTake = async (order) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', order.id);
    await notifyTelegram(order, 'taken');
    setActiveOrder({...order, status: 'taken'});
    setIsActionLoading(false);
  };

  const handleUpdate = async (status) => {
    if (!activeOrder) return;
    setIsActionLoading(true);
    await supabase.from('orders').update({ status }).eq('id', activeOrder.id);
    await notifyTelegram(activeOrder, status);
    if (status === 'completed') setActiveOrder(null);
    else setActiveOrder({...activeOrder, status});
    setIsActionLoading(false);
  };

  if (isAuthLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white font-black tracking-tighter">LEKI PRO...</div>;
  if (!courier) return <div className="p-10 text-center font-bold text-red-500">Доступ ограничен</div>;

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col fixed inset-0 font-sans">
      <div className="bg-white p-5 shadow-sm z-20 flex justify-between items-center">
        <div>
          <h1 className="font-black text-xl text-gray-900 leading-none">LEKI <span className="text-blue-600">PRO</span></h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">{courier.city} • {courier.name}</p>
        </div>
        <button onClick={offlineTimer ? () => setOfflineTimer(null) : startToggleStatus} className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-md ${courier.is_active ? (offlineTimer ? 'bg-orange-500 text-white animate-pulse' : 'bg-green-500 text-white') : 'bg-gray-200 text-gray-500'}`}>
            {offlineTimer ? `ОТМЕНА (${offlineTimer}с)` : (courier.is_active ? '🟢 В СЕТИ' : '🔴 ОФФЛАЙН')}
        </button>
      </div>

      <div className="flex-1 bg-gray-50 overflow-y-auto p-4">
        {activeOrder ? (
            <div className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100 flex flex-col h-full">
                <div className="flex justify-between items-center mb-6 border-b border-gray-50 pb-4">
                    <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide">ЗАКАЗ #{activeOrder.id}</span>
                    <span className="text-2xl font-black text-gray-800">{activeOrder.total_price} ₽</span>
                </div>
                <div className="flex-1 space-y-6">
                    <div className="relative pl-6 border-l-2 border-dashed border-gray-200 ml-2 space-y-8">
                        <div className="relative">
                            <div className="absolute -left-[31px] top-1 w-4 h-4 bg-gray-200 border-2 border-white rounded-full"></div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-1">ЗАБРАТЬ ИЗ:</p>
                            <p className="font-black text-lg text-gray-800 leading-tight mb-2">{activeOrder.restaurant_name}</p>
                            <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.restaurant_name)}`, '_blank')} className="text-blue-600 font-bold text-xs bg-blue-50 px-3 py-1.5 rounded-lg">🗺 МАРШРУТ</button>
                        </div>
                        <div className="relative">
                            <div className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-sm"></div>
                            <p className="text-[10px] font-black text-blue-400 uppercase tracking-wide mb-1">ОТВЕЗТИ:</p>
                            <p className="font-black text-lg text-blue-900 leading-tight mb-3">{activeOrder.address}</p>
                            <div className="flex gap-2">
                                <button onClick={() => window.open(`https://yandex.ru/maps/?text=${encodeURIComponent(activeOrder.address.split(', кв')[0])}`, '_blank')} className="text-blue-600 font-bold text-xs bg-blue-50 px-3 py-1.5 rounded-lg">🗺 МАРШРУТ</button>
                                <a href={`tel:${activeOrder.phone}`} className="text-green-600 font-bold text-xs bg-green-50 px-3 py-1.5 rounded-lg">📞 ПОЗВОНИТЬ</a>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="mt-8">
                    {activeOrder.status === 'taken' && <button disabled={isActionLoading} onClick={() => handleUpdate('delivering')} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>}
                    {activeOrder.status === 'delivering' && <button disabled={isActionLoading} onClick={() => handleUpdate('arrived')} className="w-full bg-orange-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">📍 Я НА МЕСТЕ</button>}
                    {activeOrder.status === 'arrived' && <button disabled={isActionLoading} onClick={() => handleUpdate('completed')} className="w-full bg-green-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all">🏁 ВРУЧИЛ КЛИЕНТУ</button>}
                </div>
            </div>
        ) : (
            <div className="h-full flex flex-col">
                <h2 className="font-black text-xl text-gray-800 mb-4 px-1 flex items-center gap-2">Радар {locRef.current ? '🛰' : '📡'}</h2>
                {!courier.is_active ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-gray-400">
                        <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center text-4xl mb-4 opacity-50">☕</div>
                        <h3 className="font-black text-xl text-gray-800 mb-2">Вы на перерыве</h3>
                        <p className="font-medium text-sm">Выйдите на линию для получения заказов</p>
                    </div>
                ) : availableOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-gray-400">
                        <div className="relative w-16 h-16 mb-4"><div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div><div className="absolute inset-2 bg-blue-500 rounded-full flex items-center justify-center shadow-lg"><span className="text-white text-xl">📡</span></div></div>
                        <h3 className="font-black text-lg text-gray-800 mb-1">Поиск заказов...</h3>
                        <p className="font-medium text-[10px] opacity-70 uppercase tracking-widest">Зона поиска расширяется автоматически</p>
                    </div>
                ) : (
                    <div className="space-y-3 pb-6">
                        {availableOrders.map(order => {
                             let itemsTotal = 0;
                             try { const itemsArr = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; itemsTotal = itemsArr.reduce((sum, item) => sum + (item.price * item.count), 0); } catch(e) {}
                             const deliveryFee = order.total_price - itemsTotal;
                             const distance = getDistance(locRef.current?.lat, locRef.current?.lon, order.restaurants.lat, order.restaurants.lon);
                             return (
                                <div key={order.id} className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 relative">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">ОТКУДА</span>
                                            <span className="font-black text-lg leading-none text-gray-800 block mb-1">{order.restaurant_name}</span>
                                            <span className="text-[11px] font-bold text-blue-500">📍 ~{distance ? distance.toFixed(1) : '?'} км</span>
                                        </div>
                                        <div className="text-right bg-blue-50 p-2.5 rounded-xl border border-blue-100">
                                            <span className="font-black text-blue-700 block text-xl leading-none">{deliveryFee} ₽</span>
                                            <span className="text-[9px] text-blue-500 font-black uppercase">Выплата</span>
                                        </div>
                                    </div>
                                    <button disabled={isActionLoading} onClick={() => handleTake(order)} className="w-full bg-gray-900 text-white py-4 rounded-xl font-black text-sm active:scale-95 transition-all shadow-md disabled:opacity-50">ВЗЯТЬ ЗАКАЗ</button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )}
      </div>
    </main>
  )
}