'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// !!! ВСТАВЬ СВОЙ КЛЮЧ ЯНДЕКСА ТУТ !!!
const YANDEX_API_KEY = "b9336a86-41c5-4a5a-a3b1-9a1ef4057197"; 

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function RestaurantMenu() {
  const params = useParams()
  const [restaurant, setRestaurant] = useState(null)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState({})
  
  const [activeCategory, setActiveCategory] = useState('Все')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [deliveryPrice, setDeliveryPrice] = useState(150)
  const [isCalculating, setIsCalculating] = useState(false)
  
  // НОВЫЕ СОСТОЯНИЯ ДЛЯ СТРОГОЙ ПРОВЕРКИ
  const [isAddressValid, setIsAddressValid] = useState(false)
  const [addressError, setAddressError] = useState('')

  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id).order('id')
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id]);

  // ВОЗВРАЩАЕМ КРАСИВЫЙ ФОРМАТ ТЕЛЕФОНА
  const handlePhoneInput = (e) => {
    let input = e.target.value.replace(/\D/g, ''); 
    input = input.substring(0, 11); 
    if (!input) { setPhone(''); return; }
    if (input[0] === '9') input = '7' + input;
    let formatted = '';
    if (['7', '8'].includes(input[0])) {
      let first = input[0] === '8' ? '8' : '+7';
      formatted = first + ' ';
      if (input.length > 1) formatted += '(' + input.substring(1, 4);
      if (input.length >= 5) formatted += ') ' + input.substring(4, 7);
      if (input.length >= 8) formatted += '-' + input.substring(7, 9);
      if (input.length >= 10) formatted += '-' + input.substring(9, 11);
    } else { formatted = '+' + input; }
    setPhone(formatted);
  };

  // МАГИЯ ЯНДЕКСА С ПРОВЕРКОЙ НА АБРАКАДАБРУ
  const calculateByText = async (text) => {
    if (text.trim().length < 5) {
      setIsAddressValid(false);
      setAddressError('Введите более точный адрес');
      return;
    }
    if (!restaurant?.lat) return;
    
    setIsCalculating(true);
    setAddressError(''); // Очищаем старые ошибки
    
    try {
      const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${YANDEX_API_KEY}&geocode=${encodeURIComponent(text)}&format=json`;
      const res = await fetch(url);
      const json = await res.json();
      
      const members = json.response.GeoObjectCollection.featureMember;
      
      if (members && members.length > 0) {
        // Яндекс нашел адрес!
        const pos = members[0].GeoObject.Point.pos.split(' ');
        const lon = parseFloat(pos[0]);
        const lat = parseFloat(pos[1]);

        const distance = getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, lat, lon);
        const calculatedPrice = 150 + (distance * 22);
        
        setDeliveryPrice(Math.round(calculatedPrice));
        setIsAddressValid(true); // Разрешаем заказ
      } else {
        // Яндекс не знает такого места (ввели абракадабру)
        setIsAddressValid(false);
        setAddressError('Адрес не найден на карте. Пожалуйста, уточните его.');
      }
    } catch (e) {
      console.error("Ошибка геокодинга", e);
      setIsAddressValid(false);
      setAddressError('Ошибка проверки адреса. Попробуйте еще раз.');
    }
    setIsCalculating(false);
  };

  const getLocation = () => {
    setAddressError('');
    setIsCalculating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const link = `https://yandex.ru/maps/?pt=${pos.coords.longitude},${pos.coords.latitude}&z=18&l=map`;
        setAddress(`📍 Гео: ${link}`);
        if (restaurant?.lat) {
          const distance = getDistanceFromLatLonInKm(restaurant.lat, restaurant.lon, pos.coords.latitude, pos.coords.longitude);
          setDeliveryPrice(Math.round(150 + (distance * 22)));
        }
        setIsAddressValid(true); // По GPS всегда разрешаем
        setIsCalculating(false);
      },
      () => {
        alert("Включите GPS в настройках телефона!");
        setIsCalculating(false);
      }
    );
  };

  const addToCart = (id) => setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }))
  const removeFromCart = (id) => {
    setCart(prev => {
      const currentCount = prev[id] || 0;
      if (currentCount <= 1) {
        const newCart = { ...prev };
        delete newCart[id];
        if (Object.keys(newCart).length === 0) setIsCartOpen(false);
        return newCart;
      }
      return { ...prev, [id]: currentCount - 1 };
    });
  }

  const totalSum = products.reduce((sum, item) => sum + (item.price * (cart[item.id] || 0)), 0)
  const cartItems = products.filter(p => cart[p.id] > 0);

  const sendOrder = async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 11 || !isAddressValid) return; // Двойная защита

    const orderData = {
      restaurant_name: restaurant?.name,
      items: cartItems.map(p => ({ name: p.name, count: cart[p.id], price: p.price })),
      total_price: totalSum + deliveryPrice,
      status: 'new',
      user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
      phone: phone,
      address: address + `\n🚚 Доставка: ${deliveryPrice} ₽`
    };
    await supabase.from('orders').insert([orderData]);
    setCart({}); setIsCheckoutOpen(false); setPhone(''); setAddress(''); setIsAddressValid(false);
    window.Telegram?.WebApp?.close();
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' ? products : products.filter(p => (p.category || 'Основное') === activeCategory)

  // Проверка готовности к заказу
  const isReadyToOrder = phone.replace(/\D/g, '').length === 11 && isAddressValid && !isCalculating;

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-4">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <button onClick={() => setIsOrdersOpen(true)} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm">📜 Мои заказы</button>
        </div>

        <h1 className="text-3xl font-bold mb-6">{restaurant?.name || 'Загрузка...'}</h1>
        
        <div className="flex overflow-x-auto gap-2 mb-6" style={{ scrollbarWidth: 'none' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-2 rounded-xl whitespace-nowrap font-bold ${activeCategory === cat ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>{cat}</button>
          ))}
        </div>

        <div className="grid gap-3">
          {filteredProducts.map((item) => (
            <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm flex items-center gap-4 ${item.is_active === false && 'opacity-50 grayscale'}`}>
              <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden">
                <img src={item.image_url || 'https://via.placeholder.com/150'} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold">{item.name}</h3>
                <p className="text-gray-500 text-sm">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-2">
                {item.is_active !== false ? (
                  <>
                    {cart[item.id] > 0 && <button onClick={() => removeFromCart(item.id)} className="bg-gray-100 w-8 h-8 rounded-lg">-</button>}
                    {cart[item.id] > 0 && <span className="font-bold">{cart[item.id]}</span>}
                    <button onClick={() => addToCart(item.id)} className="bg-blue-500 text-white w-8 h-8 rounded-lg">+</button>
                  </>
                ) : <span className="text-xs text-red-500 font-bold">Стоп</span>}
              </div>
            </div>
          ))}
        </div>

        {totalSum > 0 && (
          <div className="fixed bottom-6 left-0 right-0 px-4">
            <button onClick={() => setIsCartOpen(true)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold flex justify-between px-8 items-center shadow-2xl">
              <span>🛒 Корзина</span><span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {/* Модалка оформления */}
        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-3xl p-6 w-full animate-slide-up pb-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Оформление</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="bg-gray-100 w-8 h-8 rounded-full">✕</button>
              </div>
              <div className="space-y-4">
                
                {/* Телефон с маской */}
                <div>
                  <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border p-4 rounded-xl outline-none font-medium"/>
                  {phone.replace(/\D/g, '').length > 0 && phone.replace(/\D/g, '').length < 11 && (
                    <p className="text-red-500 text-xs mt-1 ml-1">Введите номер полностью</p>
                  )}
                </div>
                
                {/* Умный адрес */}
                <div>
                  <div className="relative">
                    <textarea 
                      value={address} 
                      onChange={(e) => {
                        setAddress(e.target.value);
                        setIsAddressValid(false); // Сбрасываем готовность при вводе
                      }} 
                      onBlur={(e) => calculateByText(e.target.value)}
                      placeholder="Введите город, улицу, дом..." 
                      className={`w-full border p-4 rounded-xl h-24 resize-none transition-colors ${addressError ? 'border-red-500 bg-red-50' : 'focus:border-blue-500'}`}
                    />
                    <button onClick={getLocation} className="absolute top-2 right-2 text-blue-500 text-sm font-bold bg-white px-2 py-1 rounded shadow-sm border border-gray-100">📍 GPS</button>
                  </div>
                  {addressError && <p className="text-red-500 text-xs mt-1 font-bold">⚠️ {addressError}</p>}
                  {!addressError && !isAddressValid && address.length > 0 && !isCalculating && <p className="text-orange-500 text-xs mt-1">Подтверждаем адрес...</p>}
                </div>

                {/* Чек */}
                <div className="bg-gray-50 p-4 rounded-xl space-y-2 border border-gray-100">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Доставка {isCalculating && '(считаем...)'}:</span>
                    <span className="font-bold">{isAddressValid ? deliveryPrice : '—'} ₽</span>
                  </div>
                  <div className="flex justify-between font-black text-lg pt-2 border-t border-gray-200">
                    <span>Итого:</span>
                    <span className="text-blue-600">{isAddressValid ? totalSum + deliveryPrice : totalSum} ₽</span>
                  </div>
                </div>

                {/* Блокируемая кнопка */}
                <button 
                  onClick={sendOrder} 
                  disabled={!isReadyToOrder} 
                  className={`w-full py-4 rounded-2xl font-bold text-xl shadow-lg transition-all ${isReadyToOrder ? 'bg-green-500 text-white active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                >
                  {isCalculating ? 'РАСЧЕТ...' : 'ЗАКАЗАТЬ'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Корзина */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-3xl p-6 w-full animate-slide-up">
               <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold">Ваш заказ</h2><button onClick={() => setIsCartOpen(false)} className="bg-gray-100 w-8 h-8 rounded-full">✕</button></div>
               <div className="max-h-[40vh] overflow-y-auto space-y-4 mb-6 pr-2">
                 {cartItems.map(i => <div key={i.id} className="flex justify-between items-center font-bold"><span>{i.name} <span className="text-gray-400 font-normal">x {cart[i.id]}</span></span><span>{i.price * cart[i.id]} ₽</span></div>)}
               </div>
               <button onClick={() => {setIsCartOpen(false); setIsCheckoutOpen(true)}} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg">К оформлению за {totalSum} ₽</button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}