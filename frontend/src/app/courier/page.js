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

function getDeliveryFee(order) {
    try {
        const itemsArr = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        const itemsTotal = itemsArr.reduce((sum, item) => sum + (item.price * item.count), 0);
        return order.total_price - itemsTotal;
    } catch(e) { return 0; }
}

export default function CourierApp() {
  const [courier, setCourier] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState(null)
  const [availableOrders, setAvailableOrders] = useState([])
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [offlineTimer, setOfflineTimer] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('поиск...')
  const locRef = useRef(null);

  const [currentTab, setCurrentTab] = useState('radar')
  const [stats, setStats] = useState({ todayEarned: 0, todayCount: 0, totalEarned: 0, totalCount: 0 })

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
      (pos) => { 
        locRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsStatus('OK');
      },
      (err) => { setGpsStatus('Ошибка'); },
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [courier]);

  const fetchAll = async () => {
    if (!courier) return;

    // --- ИСПРАВЛЕНИЕ: БЕЗОПАСНЫЙ ЗАПРОС АКТИВНОГО ЗАКАЗА ---
    const { data: active } = await supabase.from('orders').select('*').eq('courier_tg_id', courier.tg_id).in('status', ['taken', 'delivering', 'arrived']).maybeSingle();
    
    if (active) {
        // Подтягиваем координаты ресторана отдельно, чтобы не ломать запрос
        const { data: resInfo } = await supabase.from('restaurants').select('lat, lon').eq('name', active.restaurant_name).maybeSingle();
        setActiveOrder({ ...active, res_data: resInfo });
    } else {
        setActiveOrder(null);
    }

    // РАДАР
    if (!active && courier.is_active) {
      const { data: orders } = await supabase.from('orders').select('*').eq('status', 'accepted').is('courier_tg_id', null);
      const { data: restaurants } = await supabase.from('restaurants').select('*').eq('city', courier.city);

      if (orders && restaurants) {
        const currentLoc = locRef.current;
        const filtered = orders.map(order => {
            const resInfo = restaurants.find(r => r.name === order.restaurant_name);
            if (!resInfo) return null;
            return { ...order, res_data: resInfo };
        }).filter(item => {
            if (!item) return false;
            if (!currentLoc) return true; 

            const dist = getDistance(currentLoc.lat, currentLoc.lon, item.res_data.lat, item.res_data.lon);
            const minutesPassed = (new Date() - new Date(item.created_at)) / 60000;

            if (minutesPassed < 5) return dist <= 3.5;
            if (minutesPassed < 10) return dist <= 7.0;
            return true;
        });
        setAvailableOrders(filtered);
      }
    } else {
      setAvailableOrders([]);
    }

    // СТАТИСТИКА
    if (currentTab === 'stats') {
        const { data: completed } = await supabase.from('orders').select('*').eq('courier_tg_id', courier.tg_id).eq('status', 'completed');
        if (completed) {
            const today = new Date().setHours(0,0,0,0);
            let tEarned = 0, tCount = 0, allEarned = 0, allCount = completed.length;
            
            completed.forEach(o => {
                const fee = getDeliveryFee(o);
                allEarned += fee;
                if (new Date(o.created_at).getTime() >= today) { tEarned += fee; tCount++; }
            });
            setStats({ todayEarned: tEarned, todayCount: tCount, totalEarned: allEarned, totalCount: allCount });
        }
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [courier?.is_active, courier?.tg_id, currentTab]);

  useEffect(() => {
    let timer;
    if (offlineTimer !== null && offlineTimer > 0) timer = setTimeout(() => setOfflineTimer(offlineTimer - 1), 1000);
    else if (offlineTimer === 0) { finishToggleStatus(false); setOfflineTimer(null); }
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
    if (val) setTimeout(fetchAll, 500);
  };

  const notify = async (order, type) => {
    try {
      const uData = typeof order.user_data === 'string' ? JSON.parse(order.user_data) : order.user_data;
      const { data: res } = await supabase.from('restaurants').select('id, admin_tg_id').eq('name', order.restaurant_name).single();
      
      let clientMsg = type === 'taken' ? 'Курьер найден и спешит в ресторан! 🏃‍♂️' : type === 'delivering' ? 'Курьер забрал заказ и уже в пути! 🚴‍♂️' : type === 'arrived' ? 'Курьер у дверей! 📍' : '';
      if (clientMsg && uData?.id) await fetch('/api/notify', { method: 'POST', body: JSON.stringify({ targetId: uData.id, message: `🛎 <b>Заказ №${order.id}</b>\n${clientMsg}` }) });
      
      if (type === 'completed' && uData?.id) {
         const kb = { 
             inline_keyboard: [[
                 { text: "1 ⭐", callback_data: `rres_${order.id}_${res.id}_1` },
                 { text: "2 ⭐", callback_data: `rres_${order.id}_${res.id}_2` },
                 { text: "3 ⭐", callback_data: `rres_${order.id}_${res.id}_3` },
                 { text: "4 ⭐", callback_data: `rres_${order.id}_${res.id}_4` },
                 { text: "5 ⭐", callback_data: `rres_${order.id}_${res.id}_5` }
             ]] 
         };
         await fetch('/api/notify', { 
             method: 'POST', 
             body: JSON.stringify({ 
                 targetId: uData.id, 
                 message: `😋 <b>Оцените блюда от ${order.restaurant_name}:</b>`, 
                 reply_markup: kb 
             }) 
         });
      }
    } catch(e) {}
  }

  const handleTake = async (order) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ courier_tg_id: courier.tg_id, status: 'taken' }).eq('id', order.id);
    await notify(order, 'taken');
    
    // Принудительно ставим локальный статус, чтобы интерфейс мгновенно перерисовался
    setActiveOrder({ ...order, status: 'taken' });
    
    fetchAll(); // Запускаем синхронизацию
    setIsActionLoading(false);
  };

  const handleUpdate = async (status) => {
    setIsActionLoading(true);
    await supabase.from('orders').update({ status }).eq('id', activeOrder.id);
    await notify(activeOrder, status);
    
    if (status === 'completed') setActiveOrder(null);
    else setActiveOrder({...activeOrder, status});
    
    fetchAll();
    setIsActionLoading(false);
  };

  const getRouteToRes = () => {
      const cLat = locRef.current?.lat || '';
      const cLon = locRef.current?.lon || '';
      const rLat = activeOrder.res_data?.lat || '';
      const rLon = activeOrder.res_data?.lon || '';
      return `https://yandex.ru/maps/?rtext=${cLat},${cLon}~${rLat},${rLon}&rtt=auto`;
  }
  
  const getRouteToClient = () => {
      const cLat = locRef.current?.lat || '';
      const cLon = locRef.current?.lon || '';
      if (activeOrder.lat && activeOrder.lon) {
          return `https://yandex.ru/maps/?rtext=${cLat},${cLon}~${activeOrder.lat},${activeOrder.lon}&rtt=auto`;
      } else {
          return `https://yandex.ru/maps/?rtext=${cLat},${cLon}~&rtt=auto&text=${encodeURIComponent(activeOrder.address.split(',')[0])}`;
      }
  }

  if (isAuthLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white font-black tracking-tighter">LEKI PRO...</div>;
  if (!courier) return <div className="p-10 text-center font-bold text-red-500">Доступ ограничен</div>;

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col fixed inset-0 font-sans pb-20">
      
      {/* HEADER */}
      <div className="bg-white p-5 shadow-sm z-20 flex justify-between items-center relative">
        <div>
          <h1 className="font-black text-xl text-gray-900 leading-none">LEKI <span className="text-blue-600">PRO</span></h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">GPS: {gpsStatus} • {courier.city}</p>
        </div>
        <button onClick={offlineTimer ? () => setOfflineTimer(null) : startToggleStatus} className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-md ${courier.is_active ? (offlineTimer ? 'bg-orange-500 text-white animate-pulse' : 'bg-green-500 text-white') : 'bg-gray-200 text-gray-500'}`}>
            {offlineTimer ? `ОТМЕНА (${offlineTimer}с)` : (courier.is_active ? '🟢 В СЕТИ' : '🔴 ОФФЛАЙН')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {currentTab === 'stats' ? (
            <div className="p-4 space-y-4">
                <h2 className="font-black text-2xl px-2 text-gray-800">Статистика</h2>
                <div className="bg-blue-600 rounded-3xl p-6 text-white shadow-lg">
                    <p className="font-bold text-blue-200 text-sm uppercase mb-1">Заработано сегодня</p>
                    <p className="font-black text-4xl mb-4">{stats.todayEarned} ₽</p>
                    <div className="bg-blue-700/50 rounded-xl p-3 inline-block">
                        <span className="font-bold text-sm">📦 Доставлено: {stats.todayCount}</span>
                    </div>
                </div>
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                    <p className="font-bold text-gray-400 text-sm uppercase mb-1">За всё время</p>
                    <p className="font-black text-3xl text-gray-800 mb-4">{stats.totalEarned} ₽</p>
                    <p className="font-bold text-sm text-gray-500">Всего заказов: {stats.totalCount}</p>
                </div>
            </div>
        ) : (
            <div className="p-4 h-full">
                {activeOrder ? (
                    <div className="bg-white rounded-3xl p-6 shadow-md border border-gray-100 flex flex-col h-full relative overflow-hidden">
                        <div className="flex justify-between items-center mb-6 border-b border-gray-50 pb-4">
                            <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-black uppercase">ЗАКАЗ #{activeOrder.id}</span>
                            <div className="text-right">
                                <span className="text-2xl font-black text-blue-600">{getDeliveryFee(activeOrder)} ₽</span>
                                <span className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mt-1">ОПЛАТА ВАМ</span>
                            </div>
                        </div>
                        <div className="flex-1 space-y-6">
                            <div className="relative pl-6 border-l-2 border-dashed border-gray-200 ml-2 space-y-8">
                                <div className="relative">
                                    <div className="absolute -left-[31px] top-1 w-4 h-4 bg-gray-200 border-2 border-white rounded-full"></div>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">ЗАБРАТЬ ИЗ:</p>
                                    <p className="font-black text-lg leading-tight mb-3">{activeOrder.restaurant_name}</p>
                                    <button onClick={() => window.open(getRouteToRes(), '_blank')} className="text-blue-600 font-bold text-xs bg-blue-50 px-4 py-2 rounded-xl active:scale-95 shadow-sm">🗺 МАРШРУТ В РЕСТОРАН</button>
                                </div>
                                <div className="relative">
                                    <div className="absolute -left-[31px] top-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-sm"></div>
                                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">ОТВЕЗТИ КЛИЕНТУ:</p>
                                    <p className="font-black text-lg text-gray-900 leading-tight mb-4">{activeOrder.address}</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => window.open(getRouteToClient(), '_blank')} className="flex-1 text-blue-600 font-bold text-xs bg-blue-50 px-4 py-2.5 rounded-xl text-center active:scale-95 shadow-sm">🗺 МАРШРУТ</button>
                                        <a href={`tel:${activeOrder.phone}`} className="flex-1 text-green-600 font-bold text-xs bg-green-50 px-4 py-2.5 rounded-xl text-center active:scale-95 shadow-sm">📞 ПОЗВОНИТЬ</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-8 pt-4">
                            {activeOrder.status === 'taken' && <button disabled={isActionLoading} onClick={() => handleUpdate('delivering')} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-blue-200 shadow-xl active:scale-95 transition-all disabled:opacity-50">🏃‍♂️ ЗАБРАЛ ЗАКАЗ</button>}
                            {activeOrder.status === 'delivering' && <button disabled={isActionLoading} onClick={() => handleUpdate('arrived')} className="w-full bg-orange-500 text-white py-5 rounded-2xl font-black text-lg shadow-orange-200 shadow-xl active:scale-95 transition-all disabled:opacity-50">📍 Я НА МЕСТЕ</button>}
                            {activeOrder.status === 'arrived' && <button disabled={isActionLoading} onClick={() => handleUpdate('completed')} className="w-full bg-green-500 text-white py-5 rounded-2xl font-black text-lg shadow-green-200 shadow-xl active:scale-95 transition-all disabled:opacity-50">🏁 ДОСТАВИЛ</button>}
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
                            </div>
                        ) : (
                            <div className="space-y-4 pb-6">
                                {availableOrders.map(order => {
                                     const deliveryFee = getDeliveryFee(order);
                                     const distance = getDistance(locRef.current?.lat, locRef.current?.lon, order.res_data.lat, order.res_data.lon);
                                     return (
                                        <div key={order.id} className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 relative">
                                            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 rounded-l-3xl"></div>
                                            <div className="flex justify-between items-start mb-4 pl-2">
                                                <div>
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">ОТКУДА</span>
                                                    <span className="font-black text-lg leading-none text-gray-800 block mb-1">{order.restaurant_name}</span>
                                                    <span className="text-[11px] font-bold text-blue-500">📍 ~{distance ? distance.toFixed(1) : '?'} км</span>
                                                </div>
                                                <div className="text-right bg-blue-50 p-2.5 rounded-xl border border-blue-100">
                                                    <span className="font-black text-blue-700 block text-xl leading-none">{deliveryFee} ₽</span>
                                                    <span className="text-[9px] text-blue-500 font-black uppercase tracking-widest mt-1 block">ВЫПЛАТА</span>
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
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around p-2 pb-6 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-30">
          <button onClick={() => setCurrentTab('radar')} className={`flex-1 py-3 mx-1 rounded-2xl flex flex-col items-center gap-1 transition-all ${currentTab === 'radar' ? 'bg-blue-50 text-blue-600' : 'text-gray-400'}`}>
              <span className="text-xl leading-none">🛵</span>
              <span className="text-[10px] font-black uppercase tracking-widest">Заказы</span>
          </button>
          <button onClick={() => setCurrentTab('stats')} className={`flex-1 py-3 mx-1 rounded-2xl flex flex-col items-center gap-1 transition-all ${currentTab === 'stats' ? 'bg-blue-50 text-blue-600' : 'text-gray-400'}`}>
              <span className="text-xl leading-none">📊</span>
              <span className="text-[10px] font-black uppercase tracking-widest">Профиль</span>
          </button>
      </div>
    </main>
  )
}