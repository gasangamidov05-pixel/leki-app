'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

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

  // НОВОЕ: Состояния для Истории заказов
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [myOrders, setMyOrders] = useState([])

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id)
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id])

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

  const getLocation = () => {
    if (!navigator.geolocation) { alert("Браузер не поддерживает GPS"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const link = `https://yandex.ru/maps/?pt=${pos.coords.longitude},${pos.coords.latitude}&z=18&l=map`;
        setAddress(prev => prev ? `${prev}\n📍 Гео: ${link}` : `📍 Гео: ${link}`);
      },
      () => alert("Ошибка доступа к GPS. Включите геопозицию в настройках браузера.")
    );
  };

  const sendOrder = async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 11) { alert("❌ Ошибка: Номер телефона должен состоять из 11 цифр!"); return; }
    if (!address.trim()) { alert("❌ Ошибка: Укажите адрес доставки!"); return; }

    const orderData = {
      restaurant_name: restaurant?.name,
      items: cartItems.map(p => ({ name: p.name, count: cart[p.id], price: p.price })),
      total_price: totalSum,
      status: 'new',
      user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
      phone: phone,      
      address: address   
    };

    try {
      const { error } = await supabase.from('orders').insert([orderData]);
      if (error) throw error; 
      setCart({}); setIsCheckoutOpen(false); setPhone(''); setAddress('');
      if (window.Telegram?.WebApp?.initData) {
        window.Telegram.WebApp.showPopup({ title: "Заказ принят!", message: "Скоро мы свяжемся с вами!", buttons: [{ type: "ok" }] });
        window.Telegram.WebApp.close();
      } else { alert("✅ Заказ успешно оформлен!"); }
    } catch (err) { alert("Ошибка: " + err.message); }
  };

  // НОВОЕ: Функция загрузки истории заказов
  const openMyOrders = async () => {
    setIsOrdersOpen(true);
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;

    try {
      // Запрашиваем последние 20 заказов
      const { data, error } = await supabase.from('orders').select('*').order('id', { ascending: false }).limit(20);
      if (error) throw error;

      let userOrders = [];
      if (tgUser?.id) {
        // Если клиент сидит через ТГ, ищем только его заказы по ID
        userOrders = data.filter(o => {
          const uData = typeof o.user_data === 'string' ? JSON.parse(o.user_data) : o.user_data;
          return uData?.id === tgUser.id;
        });
      } else {
        // Если просто тестируем с компа в браузере, показываем последние 5
        userOrders = data.slice(0, 5);
      }
      setMyOrders(userOrders);
    } catch (err) {
      console.error("Ошибка загрузки заказов", err);
    }
  };

  // НОВОЕ: Красивые бейджики статусов
  const getStatusBadge = (status) => {
    if (status === 'new') return <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🕒 Ожидает</span>;
    if (status === 'processing' || status === 'accepted') return <span className="bg-green-100 text-green-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">🔥 Готовится</span>;
    if (status === 'cancelled') return <span className="bg-red-100 text-red-700 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">❌ Отменен</span>;
    return <span className="bg-gray-100 text-gray-500 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider">{status}</span>;
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' ? products : products.filter(p => (p.category || 'Основное') === activeCategory)

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <div className="max-w-md mx-auto">
        
        {/* НОВОЕ: Шапка с кнопкой "Мои заказы" */}
        <div className="flex justify-between items-center mb-4">
          <Link href="/" className="text-blue-500 font-bold">← Назад</Link>
          <button onClick={openMyOrders} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all">
            📜 Мои заказы
          </button>
        </div>

        <h1 className="text-3xl font-bold mb-2">{restaurant?.name || 'Загрузка...'}</h1>
        
        {/* Категории */}
        <div className="flex overflow-x-auto gap-2 mb-6 mt-4" style={{ scrollbarWidth: 'none' }}>
          {categories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-2 rounded-xl whitespace-nowrap font-bold transition-all ${activeCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-white border border-gray-200 text-gray-600'}`}>{cat}</button>
          ))}
        </div>

        {/* Товары */}
        <div className="grid gap-3">
          {filteredProducts.map((item) => (
            <div key={item.id} className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
              {item.image_url ? (
                <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                  <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🍔</span>
                </div>
              )}
              <div className="flex-1 pr-2">
                <h3 className="font-bold text-lg leading-tight mb-1">{item.name}</h3>
                <p className="text-gray-500 text-sm font-semibold">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-2">
                {cart[item.id] > 0 && (
                  <>
                    <button onClick={() => removeFromCart(item.id)} className="bg-gray-100 text-gray-600 w-10 h-10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-all">-</button>
                    <span className="font-bold text-lg w-4 text-center">{cart[item.id]}</span>
                  </>
                )}
                <button onClick={() => addToCart(item.id)} className="bg-blue-500 text-white w-10 h-10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-all">+</button>
              </div>
            </div>
          ))}
        </div>

        {/* Кнопка корзины */}
        {totalSum > 0 && !isCartOpen && !isCheckoutOpen && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button onClick={() => setIsCartOpen(true)} className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-2xl flex justify-between px-8 items-center active:scale-95 transition-all">
              <span>🛒 Корзина</span><span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {/* Модалка Корзины */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-3xl p-6 max-w-md mx-auto w-full animate-slide-up">
              <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold">Ваш заказ</h2><button onClick={() => setIsCartOpen(false)} className="bg-gray-100 text-gray-400 w-8 h-8 rounded-full">✕</button></div>
              <div className="max-h-[40vh] overflow-y-auto space-y-4 mb-6">
                {cartItems.map(item => (
                  <div key={item.id} className="flex justify-between items-center"><div className="flex-1"><p className="font-bold">{item.name}</p><p className="text-gray-500 text-sm">{item.price} ₽ x {cart[item.id]}</p></div><div className="flex items-center gap-3"><button onClick={() => removeFromCart(item.id)} className="bg-gray-100 w-8 h-8 rounded-lg">-</button><span className="font-bold">{cart[item.id]}</span><button onClick={() => addToCart(item.id)} className="bg-blue-100 text-blue-600 w-8 h-8 rounded-lg">+</button></div></div>
                ))}
              </div>
              <button onClick={() => {setIsCartOpen(false); setIsCheckoutOpen(true)}} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg shadow-lg">Оформить заказ за {totalSum} ₽</button>
            </div>
          </div>
        )}

        {/* Модалка Оформления */}
        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-3xl p-6 max-w-md mx-auto w-full animate-slide-up pb-10">
              <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-bold">Доставка</h2><button onClick={() => setIsCheckoutOpen(false)} className="bg-gray-100 text-gray-400 w-8 h-8 rounded-full">✕</button></div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Номер телефона</label>
                  <input type="tel" value={phone} onChange={handlePhoneInput} placeholder="+7 (999) 000-00-00" className="w-full border border-gray-200 p-4 rounded-xl outline-none focus:border-blue-500 bg-gray-50"/>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-bold text-gray-700">Адрес доставки</label>
                    <button onClick={getLocation} className="text-blue-500 text-sm font-bold">📍 GPS</button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-2" style={{ scrollbarWidth: 'none' }}>
                    {['Махачкала', 'Каспийск', 'Дербент'].map(c => (
                      <button key={c} onClick={() => setAddress(c + ", " + address)} className="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-xs font-bold border border-blue-100 whitespace-nowrap">+ {c}</button>
                    ))}
                  </div>
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Улица, дом, кв..." className="w-full border border-gray-200 p-4 rounded-xl outline-none focus:border-blue-500 h-24 resize-none bg-gray-50"/>
                </div>
                <button onClick={sendOrder} className="w-full bg-green-500 text-white py-4 rounded-2xl font-bold text-xl shadow-lg active:scale-95 transition-all mt-4">ПОДТВЕРДИТЬ</button>
              </div>
            </div>
          </div>
        )}

        {/* НОВОЕ: Модалка ИСТОРИИ ЗАКАЗОВ */}
        {isOrdersOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white rounded-t-[40px] p-6 max-w-md mx-auto w-full animate-slide-up pb-10 max-h-[85vh] flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black">Мои заказы</h2>
                <button onClick={() => setIsOrdersOpen(false)} className="bg-gray-100 text-gray-400 w-10 h-10 rounded-full flex items-center justify-center font-bold">✕</button>
              </div>
              
              <div className="overflow-y-auto space-y-4 pr-2">
                {myOrders.length === 0 ? (
                  <div className="text-center py-10">
                    <span className="text-5xl block mb-4">🛒</span>
                    <p className="text-gray-400 font-bold">Вы еще ничего не заказывали</p>
                  </div>
                ) : (
                  myOrders.map(o => {
                    const itemsList = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                    return (
                      <div key={o.id} className="border-2 border-gray-50 rounded-2xl p-4 shadow-sm bg-white">
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-black text-lg">Заказ #{o.id}</span>
                          {getStatusBadge(o.status)}
                        </div>
                        <p className="text-sm font-bold text-gray-800 mb-3">🏠 {o.restaurant_name}</p>
                        
                        <div className="text-xs text-gray-500 mb-4 space-y-2 border-l-2 border-gray-100 pl-3">
                          {itemsList.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span>{item.name} <span className="font-bold text-gray-400">x{item.count}</span></span>
                            </div>
                          ))}
                        </div>
                        
                        <div className="border-t-2 border-dashed border-gray-100 pt-3 flex justify-between items-center font-black">
                          <span>Итого:</span>
                          <span className="text-blue-600 text-lg">{o.total_price} ₽</span>
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