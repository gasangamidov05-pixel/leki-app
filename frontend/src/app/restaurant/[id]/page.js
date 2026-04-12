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
  
  // Состояния для окна оформления
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

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

  // ВОЗВРАЩАЕМ ФУНКЦИЮ GPS
  const getLocation = () => {
    if (!navigator.geolocation) {
      alert("Ваш браузер не поддерживает определение локации.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const mapLink = `https://yandex.ru/maps/?pt=${lon},${lat}&z=18&l=map`;
        setAddress(prev => prev ? `${prev}\n📍 Гео: ${mapLink}` : `📍 Гео: ${mapLink}`);
      },
      (error) => {
        alert("Не удалось получить геоданные. Возможно, доступ запрещен в настройках.");
      }
    );
  };

  const sendOrder = async () => {
    // СТРОГАЯ ЗАЩИТА ТЕЛЕФОНА
    const cleanPhone = phone.replace(/\D/g, ''); // Оставляем только цифры для проверки
    if (cleanPhone.length < 11) {
      alert("❌ Ошибка: В номере телефона должно быть минимум 11 цифр!");
      return;
    }

    if (!address.trim()) {
      alert("❌ Ошибка: Пожалуйста, укажите адрес доставки!");
      return;
    }

    const selectedItems = cartItems.map(p => ({
      name: p.name,
      count: cart[p.id],
      price: p.price
    }));

    const orderData = {
      restaurant_name: restaurant?.name,
      items: selectedItems,
      total_price: totalSum,
      status: 'new',
      user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' },
      phone: phone,      
      address: address   
    };

    try {
      const { error } = await supabase.from('orders').insert([orderData]).select();
      if (error) throw error; 

      setCart({});
      setIsCheckoutOpen(false); 
      setPhone('');
      setAddress('');

      if (window.Telegram?.WebApp && window.Telegram.WebApp.initData) {
        window.Telegram.WebApp.showPopup({
          title: "Заказ принят!",
          message: `Скоро мы свяжемся с вами. Сумма: ${totalSum} ₽`,
          buttons: [{ type: "ok" }]
        });
        window.Telegram.WebApp.close();
      } else {
        alert("✅ Заказ успешно оформлен!");
      }
    } catch (error) {
      console.error('Ошибка заказа:', error);
      if (error.message?.includes('WebAppMethodUnsupported')) {
         setCart({});
         setIsCheckoutOpen(false);
         setPhone('');
         setAddress('');
         alert("✅ Заказ успешно оформлен!");
      } else {
         alert('❌ Ошибка при отправке заказа: ' + (error.message || error));
      }
    }
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' 
    ? products 
    : products.filter(p => (p.category || 'Основное') === activeCategory)

  // ФУНКЦИЯ ДЛЯ ВВОДА ТОЛЬКО ЦИФР В ТЕЛЕФОН
  const handlePhoneInput = (e) => {
    // Удаляем все буквы, оставляем цифры, пробелы, +, скобки и дефисы
    const val = e.target.value.replace(/[^\d\+ \-\(\)]/g, '');
    setPhone(val);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <div className="max-w-md mx-auto">
        <Link href="/" className="text-blue-500 mb-4 inline-block">← Назад к списку</Link>
        <h1 className="text-3xl font-bold mb-2">{restaurant?.name || 'Загрузка...'}</h1>
        <p className="text-gray-500 mb-6">Выберите блюда</p>

        {products.length > 0 && (
          <div className="flex overflow-x-auto gap-2 mb-6 pb-2" style={{ scrollbarWidth: 'none' }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl font-medium transition-all ${
                  activeCategory === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4">
          {filteredProducts.map((item) => (
            <div key={item.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
              <div className="flex-1 pr-2">
                <h3 className="font-bold text-lg leading-tight">{item.name}</h3>
                <p className="text-gray-400 text-sm mt-1">{item.price} ₽</p>
              </div>
              <div className="flex items-center gap-3">
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
          {filteredProducts.length === 0 && <p className="text-center text-gray-400 mt-4">В этой категории пока нет блюд.</p>}
        </div>

        {totalSum > 0 && !isCartOpen && !isCheckoutOpen && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button onClick={() => setIsCartOpen(true)} className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-2xl flex justify-between px-8 items-center active:scale-95 transition-all">
              <span>🛒 Посмотреть корзину</span>
              <span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-6 pb-8 animate-slide-up max-h-[80vh] flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Корзина</h2>
                <button onClick={() => setIsCartOpen(false)} className="bg-gray-100 text-gray-500 w-8 h-8 rounded-full flex items-center justify-center font-bold">✕</button>
              </div>
              <div className="overflow-y-auto mb-6 pr-2 space-y-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex justify-between items-center">
                    <div className="flex-1">
                      <p className="font-bold">{item.name}</p>
                      <p className="text-gray-500 text-sm">{item.price} ₽ x {cart[item.id]}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => removeFromCart(item.id)} className="bg-gray-100 text-gray-600 w-8 h-8 rounded-lg flex items-center justify-center text-lg active:scale-90">-</button>
                      <span className="font-bold w-4 text-center">{cart[item.id]}</span>
                      <button onClick={() => addToCart(item.id)} className="bg-blue-100 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center text-lg active:scale-90">+</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-4 mb-6">
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>Итого к оплате:</span>
                  <span>{totalSum} ₽</span>
                </div>
              </div>
              <button 
                onClick={() => { setIsCartOpen(false); setIsCheckoutOpen(true); }}
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all text-lg"
              >
                К оформлению ({totalSum} ₽)
              </button>
            </div>
          </div>
        )}

        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-6 pb-8 animate-slide-up">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Детали доставки</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="bg-gray-100 text-gray-500 w-8 h-8 rounded-full flex items-center justify-center font-bold">✕</button>
              </div>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Номер телефона</label>
                  <input 
                    type="tel" 
                    value={phone}
                    onChange={handlePhoneInput}
                    placeholder="+7 (999) 000-00-00" 
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all"
                  />
                  <p className="text-xs text-gray-400 mt-1">Минимум 11 цифр</p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">Куда везти?</label>
                    {/* КНОПКА GPS ВЕРНУЛАСЬ СЮДА */}
                    <button 
                      onClick={getLocation} 
                      className="text-blue-500 text-sm font-bold flex items-center gap-1 active:scale-95 transition-transform"
                    >
                      📍 Поделиться геометкой
                    </button>
                  </div>
                  
                  <div className="flex gap-2 mb-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {['Махачкала', 'Каспийск', 'Дербент'].map(city => (
                      <button 
                        key={city}
                        onClick={() => setAddress(city + ", " + address)}
                        className="bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-sm font-semibold whitespace-nowrap active:scale-95 transition-all"
                      >
                        + {city}
                      </button>
                    ))}
                  </div>

                  <textarea 
                    rows={3}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Улица, дом, подъезд..." 
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-blue-500 transition-all resize-none"
                  />
                </div>
              </div>

              <button 
                onClick={sendOrder}
                className="w-full bg-green-500 text-white py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all text-lg"
              >
                Подтвердить заказ
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}