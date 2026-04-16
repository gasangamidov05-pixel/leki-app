'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// ❗️❗️❗️ ВПИШИ СЮДА ССЫЛКУ НА СВОЕ МИНИ-ПРИЛОЖЕНИЕ ТЕЛЕГРАМ
const BOT_APP_URL = "https://t.me/Probnayaaa_bot/app" 

export default function Home() {
  const router = useRouter()
  const [isTelegram, setIsTelegram] = useState(true) 

  const [restaurants, setRestaurants] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  
  const [selectedCity, setSelectedCity] = useState(null)
  const [availableCities, setAvailableCities] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  useEffect(() => {
    // --- ПРОВЕРКА TELEGRAM И DEEP LINK ---
    const timer = setTimeout(() => {
      const tg = window.Telegram?.WebApp;
      if (!tg || !tg.initData) {
        setIsTelegram(false); // Блокируем
        window.location.href = BOT_APP_URL; // Авто-редирект в бота
        return;
      }
      
      const startParam = tg.initDataUnsafe?.start_param;
      if (startParam && startParam.startsWith('res_')) {
        const resId = startParam.replace('res_', '');
        router.push(`/restaurant/${resId}`); 
      }
    }, 500);

    const savedCity = localStorage.getItem('user_city')
    if (savedCity) setSelectedCity(savedCity)

    async function fetchData() {
      const now = new Date().toISOString()
      const nowMs = new Date().getTime()

      const { data: resData } = await supabase
        .from('restaurants')
        .select('*, restaurant_ratings(avg_rating)')
        .eq('is_active', true)
        .gt('paid_until', now)

      const { data: promoData } = await supabase
        .from('promotions')
        .select('*')
        .eq('is_active', true)
        .eq('is_secret', false)

      if (resData) {
        const validPromos = (promoData || []).filter(p => !p.expires_at || new Date(p.expires_at).getTime() > nowMs)

        const formattedRestaurants = resData.map(r => {
           const rPromos = validPromos.filter(p => p.restaurant_name === r.name)
           return {
             ...r,
             rating: r.restaurant_ratings?.[0]?.avg_rating || '5.0',
             promotions: rPromos
           }
        });
        setRestaurants(formattedRestaurants)
        
        const cities = ['🌍 Все города', ...new Set(formattedRestaurants.map(r => r.city).filter(Boolean))]
        setAvailableCities(cities)
      }
      
      setIsLoading(false)
    }
    fetchData()

    return () => clearTimeout(timer);
  }, [router])

  const selectCity = (city) => {
    setSelectedCity(city)
    if (city === '🌍 Все города' || city === 'Все') {
      localStorage.removeItem('user_city')
    } else {
      localStorage.setItem('user_city', city)
    }
  }

  const isRestaurantOpenByHours = (hoursString) => {
     if (!hoursString) return true; 
     try {
       const [startStr, endStr] = hoursString.split('-');
       const [startH, startM] = startStr.split(':').map(Number);
       const [endH, endM] = endStr.split(':').map(Number);
       
       const now = new Date();
       const currentH = now.getHours();
       const currentM = now.getMinutes();
       
       const currentTotal = currentH * 60 + currentM;
       const startTotal = startH * 60 + startM;
       const endTotal = endH * 60 + endM;

       if (endTotal < startTotal) {
           return currentTotal >= startTotal || currentTotal <= endTotal;
       } else {
           return currentTotal >= startTotal && currentTotal <= endTotal;
       }
     } catch (e) {
         return true; 
     }
  };

  const isSpecificCitySelected = selectedCity !== null && selectedCity !== '🌍 Все города' && selectedCity !== 'Все';

  const processedRestaurants = restaurants
    .filter(r => {
      const matchCity = !isSpecificCitySelected || r.city === selectedCity;
      const matchSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCity && matchSearch;
    })
    .sort((a, b) => {
      if (isSpecificCitySelected) {
          if (a.is_pinned && !b.is_pinned) return -1;
          if (!a.is_pinned && b.is_pinned) return 1;
      }

      const aOpenHours = a.is_open && isRestaurantOpenByHours(a.working_hours);
      const aCanDeliver = (a.can_self_deliver !== false) || (a.has_active_couriers !== false);
      const aFullyOpen = aOpenHours && aCanDeliver;

      const bOpenHours = b.is_open && isRestaurantOpenByHours(b.working_hours);
      const bCanDeliver = (b.can_self_deliver !== false) || (b.has_active_couriers !== false);
      const bFullyOpen = bOpenHours && bCanDeliver;

      if (aFullyOpen && !bFullyOpen) return -1;
      if (!aFullyOpen && bFullyOpen) return 1;

      return parseFloat(b.rating) - parseFloat(a.rating);
    });

  const openMyOrders = async () => {
    setIsOrdersOpen(true);
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    try {
      const { data, error } = await supabase.from('orders').select('*').order('id', { ascending: false }).limit(20);
      if (error) throw error;
      let userOrders = [];
      if (tgUser?.id) {
        userOrders = data.filter(o => {
          const uData = typeof o.user_data === 'string' ? JSON.parse(o.user_data) : o.user_data;
          return uData?.id === tgUser.id;
        });
      } else {
        userOrders = data.slice(0, 5);
      }
      setMyOrders(userOrders);
    } catch (err) {}
  };

  const getStatusBadge = (status) => {
    if (status === 'new') return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🕒 Ожидает</span>;
    if (status === 'processing' || status === 'accepted') return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🔥 Готовится</span>;
    if (status === 'cancelled') return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">❌ Отменен</span>;
    return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">{status}</span>;
  };

  // ЗАГЛУШКА ДЛЯ БРАУЗЕРА С КНОПКОЙ
  if (!isTelegram) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
        <span className="text-6xl mb-4">📱</span>
        <h1 className="text-white text-2xl font-black mb-2">Откройте в Telegram</h1>
        <p className="text-gray-400 mb-8">Для оформления заказа необходимо запустить приложение внутри Telegram.</p>
        <a href={BOT_APP_URL} className="bg-blue-600 text-white font-bold py-4 px-8 rounded-2xl shadow-lg shadow-blue-500/30 active:scale-95 transition-all">
          🚀 Открыть приложение
        </a>
      </div>
    )
  }

  return (
    <main className="min-h-screen p-4 bg-gray-50 text-black">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-start mb-6 pt-6">
          <div>
            <h1 className="text-3xl font-black text-blue-600 leading-none mb-2">LEKI</h1>
            <div className="flex flex-col">
               <span className="text-[10px] text-gray-400 uppercase font-black tracking-tighter">Ваш город:</span>
               <select 
                 value={selectedCity || ''} 
                 onChange={(e) => selectCity(e.target.value)}
                 className="bg-transparent font-black text-sm outline-none border-b-2 border-blue-200 cursor-pointer text-gray-700"
               >
                 {!selectedCity && <option value="">Выбрать...</option>}
                 {availableCities.map(city => <option key={city} value={city}>{city}</option>)}
               </select>
            </div>
          </div>
          <button onClick={openMyOrders} className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all flex items-center gap-2">
            <span>📜</span> Заказы
          </button>
        </div>

        <div className="mb-6 relative">
          <span className="absolute left-4 top-3.5 text-gray-400">🔍</span>
          <input 
            type="text" 
            placeholder="Найти заведение..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-200 p-3 pl-11 rounded-2xl outline-none focus:border-blue-500 font-medium text-sm shadow-sm transition-all"
          />
        </div>

        {!selectedCity && !isLoading && (
          <div className="bg-blue-600 p-6 rounded-[24px] text-white mb-8 shadow-lg shadow-blue-100 animate-pulse">
            <h2 className="text-xl font-black mb-1">Ассаламу Алейкум!</h2>
            <p className="text-sm font-bold opacity-90">Укажите город сверху, чтобы увидеть меню ресторанов рядом с вами.</p>
          </div>
        )}
        
        <div className="space-y-4">
          {isLoading ? (
            <p className="text-center text-gray-400 font-bold mt-10">Загрузка заведений...</p>
          ) : processedRestaurants.length > 0 ? (
            processedRestaurants.map((restaurant) => {
              const isOpenNow = restaurant.is_open && isRestaurantOpenByHours(restaurant.working_hours);
              const canSelfDeliver = restaurant.can_self_deliver !== false;
              const hasCouriers = restaurant.has_active_couriers !== false;
              const isDeliverable = canSelfDeliver || hasCouriers;
              const isFullyOpen = isOpenNow && isDeliverable;
              
              const showPin = isSpecificCitySelected && restaurant.is_pinned;

              return (
                <div key={restaurant.id} className={`p-6 bg-white rounded-[32px] shadow-sm border ${showPin ? 'border-orange-300 ring-4 ring-orange-50' : 'border-gray-100'} transition-all flex flex-col ${!isFullyOpen ? 'opacity-60 grayscale' : 'hover:shadow-md'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-black">{restaurant.name}</h2>
                        {showPin && <span className="text-[10px] bg-gradient-to-r from-orange-400 to-red-500 text-white px-2 py-0.5 rounded-md font-black shadow-sm uppercase tracking-wider">🔥 Топ</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg font-black uppercase">{restaurant.city}</span>
                        <span className="text-xs font-bold text-yellow-500">⭐ {restaurant.rating}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold text-gray-400">📍 {restaurant.delivery_radius} км</span>
                      {restaurant.working_hours && (
                          <span className="text-[10px] font-bold text-gray-400 mt-1 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                              🕒 {restaurant.working_hours}
                          </span>
                      )}
                    </div>
                  </div>

                  {restaurant.promotions?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                          {restaurant.promotions.map(p => {
                              const isDiscount = p.reward_type === 'discount';
                              const isFreeDelivery = p.reward_type === 'free_delivery';
                              let text = isDiscount ? `🎟 -${p.discount_rub}₽` : `🎁 ${p.gift_name}`;
                              if (isFreeDelivery) text = '🚚 БЕСПЛ. ДОСТАВКА';
                              const minText = p.min_cart_total > 0 ? ` (от ${p.min_cart_total}₽)` : '';
                              
                              return (
                                  <div key={p.id} className={`text-[10px] flex items-center px-2.5 py-1.5 rounded-xl shadow-sm uppercase tracking-wider ${isDiscount || isFreeDelivery ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'bg-purple-50 text-purple-600 border border-purple-200'}`}>
                                      <span className="font-black">{text}{minText}</span>
                                      <span className="mx-1.5 opacity-40">|</span>
                                      <span className="font-bold mr-1">КОД:</span>
                                      <span className="font-black select-all cursor-pointer bg-white/60 px-1.5 py-0.5 rounded-md border border-white">{p.code}</span>
                                  </div>
                              )
                          })}
                      </div>
                  )}
                  
                  <div className="mt-auto">
                    {!isFullyOpen ? (
                        <div className="w-full bg-red-50 text-red-600 font-black text-center py-4 rounded-2xl border-2 border-red-100">
                          {!isOpenNow ? (restaurant.is_open ? 'СЕЙЧАС ЗАКРЫТО' : 'ВРЕМЕННО ЗАКРЫТО') : 'НЕТ СВОБОДНЫХ КУРЬЕРОВ'}
                        </div>
                    ) : (
                      <Link href={`/restaurant/${restaurant.id}`} className="w-full">
                        <button className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl active:scale-95 transition-all shadow-lg shadow-blue-100 text-lg">
                          Перейти к меню
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="text-center py-10">
               <p className="text-gray-400 font-bold">Ничего не найдено.</p>
               {selectedCity !== '🌍 Все города' && selectedCity !== 'Все' && (
                 <button onClick={() => selectCity('🌍 Все города')} className="text-blue-500 font-bold mt-2 text-sm underline">Показать все города</button>
               )}
            </div>
          )}
        </div>

        {isOrdersOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 max-w-md mx-auto w-full animate-slide-up pb-10 max-h-[85vh] flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Мои заказы</h2>
                <button onClick={() => setIsOrdersOpen(false)} className="bg-gray-100 text-gray-400 w-10 h-10 rounded-full flex items-center justify-center font-bold">✕</button>
              </div>
              <div className="overflow-y-auto space-y-4 pr-2 pb-6">
                {myOrders.length === 0 ? (
                  <div className="text-center py-10"><span className="text-5xl block mb-4">🛒</span><p className="text-gray-400 font-bold">Вы еще ничего не заказывали</p></div>
                ) : (
                  myOrders.map(o => {
                    const itemsList = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                    return (
                      <div key={o.id} className="border-2 border-gray-50 rounded-3xl p-5 shadow-sm bg-white">
                        <div className="flex justify-between items-center mb-4"><span className="font-black text-xl">Заказ #{o.id}</span>{getStatusBadge(o.status)}</div>
                        <p className="text-sm font-bold text-gray-800 mb-4 bg-gray-50 p-2 rounded-xl inline-block">🏠 {o.restaurant_name}</p>
                        <div className="text-sm text-gray-500 mb-5 space-y-2 border-l-2 border-gray-100 pl-3">
                          {itemsList.map((item, idx) => (<div key={idx} className="flex justify-between items-center"><span className="font-medium">{item.name}</span><span className="font-black text-gray-400">x{item.count}</span></div>))}
                        </div>
                        <div className="border-t-2 border-dashed border-gray-100 pt-4 flex justify-between items-center font-black"><span className="text-gray-400">Итого:</span><span className="text-blue-600 text-xl">{o.total_price} ₽</span></div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}