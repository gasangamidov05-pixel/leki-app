'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

export default function Home() {
  const [restaurants, setRestaurants] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  
  const [selectedCity, setSelectedCity] = useState(null)
  const [availableCities, setAvailableCities] = useState([])

  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  useEffect(() => {
    const savedCity = localStorage.getItem('user_city')
    if (savedCity) setSelectedCity(savedCity)

    async function fetchData() {
      const now = new Date().toISOString();

      // Получаем рестораны (только оплаченные)
      const { data: resData } = await supabase
        .from('restaurants')
        .select('*, restaurant_ratings(avg_rating)')
        .eq('is_active', true)
        .gt('paid_until', now);

      if (resData) {
        const formattedRestaurants = resData.map(r => ({
           ...r,
           rating: r.restaurant_ratings?.[0]?.avg_rating || '5.0'
        }));
        setRestaurants(formattedRestaurants)
        
        const cities = ['Все', ...new Set(formattedRestaurants.map(r => r.city).filter(Boolean))]
        setAvailableCities(cities)
      }
      
      setIsLoading(false)
    }
    fetchData()
  }, [])

  const selectCity = (city) => {
    setSelectedCity(city)
    if (city === 'Все') {
      localStorage.removeItem('user_city')
    } else {
      localStorage.setItem('user_city', city)
    }
  }

  const filteredRestaurants = !selectedCity || selectedCity === 'Все' 
    ? restaurants 
    : restaurants.filter(r => r.city === selectedCity)

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
    } catch (err) {
      console.error("Ошибка загрузки заказов", err);
    }
  };

  const getStatusBadge = (status) => {
    if (status === 'new') return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🕒 Ожидает</span>;
    if (status === 'processing' || status === 'accepted') return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🔥 Готовится</span>;
    if (status === 'cancelled') return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">❌ Отменен</span>;
    return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">{status}</span>;
  };

  // Функция для проверки, открыт ли ресторан по часам работы
  const isRestaurantOpenByHours = (hoursString) => {
     if (!hoursString) return true; // Если не указано, считаем открытым
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
           // Работает через полночь
           return currentTotal >= startTotal || currentTotal <= endTotal;
       } else {
           // Обычный график
           return currentTotal >= startTotal && currentTotal <= endTotal;
       }
     } catch (e) {
         return true; // В случае ошибки формата считаем открытым
     }
  };

  return (
    <main className="min-h-screen p-4 bg-gray-50 text-black">
      <div className="max-w-md mx-auto">
        
        <div className="flex justify-between items-start mb-8 pt-6">
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

        {!selectedCity && !isLoading && (
          <div className="bg-blue-600 p-6 rounded-[24px] text-white mb-8 shadow-lg shadow-blue-100 animate-pulse">
            <h2 className="text-xl font-black mb-1">Ассаламу Алейкум!</h2>
            <p className="text-sm font-bold opacity-90">Укажите город сверху, чтобы увидеть меню ресторанов рядом с вами.</p>
          </div>
        )}
        
        <div className="space-y-4">
          {isLoading ? (
            <p className="text-center text-gray-400 font-bold mt-10">Загрузка заведений...</p>
          ) : filteredRestaurants.length > 0 ? (
            filteredRestaurants.map((restaurant) => {
              
              const isOpenNow = restaurant.is_open && isRestaurantOpenByHours(restaurant.working_hours);

              return (
                <div key={restaurant.id} className={`p-6 bg-white rounded-[32px] shadow-sm border border-gray-100 transition-all ${!isOpenNow ? 'opacity-60 grayscale' : 'hover:shadow-md'}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-xl font-black mb-1">{restaurant.name}</h2>
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
                  
                  {!isOpenNow ? (
                     <div className="w-full bg-red-50 text-red-600 font-black text-center py-4 rounded-2xl border-2 border-red-100">
                        {restaurant.is_open ? 'СЕЙЧАС ЗАКРЫТО' : 'ВРЕМЕННО ЗАКРЫТО'}
                     </div>
                  ) : (
                    <Link href={`/restaurant/${restaurant.id}`} className="w-full">
                      <button className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl active:scale-95 transition-all shadow-lg shadow-blue-100 text-lg">
                        Перейти к меню
                      </button>
                    </Link>
                  )}
                </div>
              )
            })
          ) : (
            <div className="text-center py-10">
               <p className="text-gray-400 font-bold">В городе {selectedCity} пока нет заведений.</p>
               <button onClick={() => selectCity('Все')} className="text-blue-500 font-bold mt-2 text-sm underline">Показать все города</button>
            </div>
          )}
        </div>

        {/* МОДАЛКА ИСТОРИИ ЗАКАЗОВ */}
        {isOrdersOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 max-w-md mx-auto w-full animate-slide-up pb-10 max-h-[85vh] flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Мои заказы</h2>
                <button onClick={() => setIsOrdersOpen(false)} className="bg-gray-100 text-gray-400 w-10 h-10 rounded-full flex items-center justify-center font-bold">✕</button>
              </div>
              
              <div className="overflow-y-auto space-y-4 pr-2 pb-6">
                {myOrders.length === 0 ? (
                  <div className="text-center py-10">
                    <span className="text-5xl block mb-4">🛒</span>
                    <p className="text-gray-400 font-bold">Вы еще ничего не заказывали</p>
                  </div>
                ) : (
                  myOrders.map(o => {
                    const itemsList = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                    return (
                      <div key={o.id} className="border-2 border-gray-50 rounded-3xl p-5 shadow-sm bg-white">
                        <div className="flex justify-between items-center mb-4">
                          <span className="font-black text-xl">Заказ #{o.id}</span>
                          {getStatusBadge(o.status)}
                        </div>
                        <p className="text-sm font-bold text-gray-800 mb-4 bg-gray-50 p-2 rounded-xl inline-block">
                          🏠 {o.restaurant_name}
                        </p>
                        
                        <div className="text-sm text-gray-500 mb-5 space-y-2 border-l-2 border-gray-100 pl-3">
                          {itemsList.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center">
                              <span className="font-medium">{item.name}</span>
                              <span className="font-black text-gray-400">x{item.count}</span>
                            </div>
                          ))}
                        </div>
                        
                        <div className="border-t-2 border-dashed border-gray-100 pt-4 flex justify-between items-center font-black">
                          <span className="text-gray-400">Итого:</span>
                          <span className="text-blue-600 text-xl">{o.total_price} ₽</span>
                        </div>
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