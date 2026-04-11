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
  // НОВОЕ: Состояние для открытия окна корзины
  const [isCartOpen, setIsCartOpen] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const { data: res } = await supabase.from('restaurants').select('*').eq('id', params.id).single()
      setRestaurant(res)
      const { data: prod } = await supabase.from('products').select('*').eq('restaurant_id', params.id)
      setProducts(prod || [])
    }
    fetchData()
  }, [params.id])

  const addToCart = (id) => {
    setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }))
  }

  // НОВОЕ: Функция удаления из корзины
  const removeFromCart = (id) => {
    setCart(prev => {
      const currentCount = prev[id] || 0;
      if (currentCount <= 1) {
        const newCart = { ...prev };
        delete newCart[id];
        // Если корзина опустела, закрываем окно
        if (Object.keys(newCart).length === 0) setIsCartOpen(false);
        return newCart;
      }
      return { ...prev, [id]: currentCount - 1 };
    });
  }

  const totalSum = products.reduce((sum, item) => {
    return sum + (item.price * (cart[item.id] || 0))
  }, 0)

  // Получаем список выбранных товаров для корзины
  const cartItems = products.filter(p => cart[p.id] > 0);

  const sendOrder = async () => {
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
      user_data: window.Telegram?.WebApp?.initDataUnsafe?.user || { first_name: 'Web User' }
    };

    try {
      const { data, error } = await supabase
        .from('orders')
        .insert([orderData])
        .select();

      if (error) throw error; 

      // ОЧИЩАЕМ КОРЗИНУ И ЗАКРЫВАЕМ ОКНО ПОСЛЕ ЗАКАЗА
      setCart({});
      setIsCartOpen(false);

      if (window.Telegram?.WebApp && window.Telegram.WebApp.initData) {
        window.Telegram.WebApp.showPopup({
          title: "Заказ принят!",
          message: `Ваш заказ в ${restaurant?.name} на сумму ${totalSum} ₽ оформлен.`,
          buttons: [{ type: "ok" }]
        });
        window.Telegram.WebApp.close();
      } else {
        alert("✅ Заказ успешно сохранен в базе данных!");
      }
    } catch (error) {
      console.error('Ошибка заказа:', error);
      if (error.message?.includes('WebAppMethodUnsupported')) {
         setCart({});
         setIsCartOpen(false);
         alert("✅ Заказ успешно сохранен в базе данных!");
      } else {
         alert('❌ Ошибка при отправке заказа: ' + (error.message || error));
      }
    }
  };

  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]
  const filteredProducts = activeCategory === 'Все' 
    ? products 
    : products.filter(p => (p.category || 'Основное') === activeCategory)

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
                  activeCategory === cat
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white text-gray-600 border border-gray-200'
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
              
              {/* НОВОЕ: Кнопки плюс и минус */}
              <div className="flex items-center gap-3">
                {cart[item.id] > 0 && (
                  <>
                    <button 
                      onClick={() => removeFromCart(item.id)}
                      className="bg-gray-100 text-gray-600 w-10 h-10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-all"
                    >
                      -
                    </button>
                    <span className="font-bold text-lg w-4 text-center">
                      {cart[item.id]}
                    </span>
                  </>
                )}
                <button 
                  onClick={() => addToCart(item.id)}
                  className="bg-blue-500 text-white w-10 h-10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-all"
                >
                  +
                </button>
              </div>
            </div>
          ))}
          
          {filteredProducts.length === 0 && (
            <p className="text-center text-gray-400 mt-4">В этой категории пока нет блюд.</p>
          )}
        </div>

        {/* НОВОЕ: Плавающая кнопка теперь открывает корзину, а не отправляет заказ */}
        {totalSum > 0 && !isCartOpen && (
          <div className="fixed bottom-6 left-0 right-0 px-4 z-40">
            <button 
              onClick={() => setIsCartOpen(true)}
              className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-2xl flex justify-between px-8 items-center active:scale-95 transition-all"
            >
              <span>🛒 Посмотреть корзину</span>
              <span>{totalSum} ₽</span>
            </button>
          </div>
        )}

        {/* НОВОЕ: Всплывающее окно (Модалка) Корзины */}
        {isCartOpen && (
          <div className="fixed inset-0 bg-black/60 z-50 flex flex-col justify-end">
            <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-6 pb-8 animate-slide-up max-h-[80vh] flex flex-col">
              
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Корзина</h2>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="bg-gray-100 text-gray-500 w-8 h-8 rounded-full flex items-center justify-center font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="overflow-y-auto mb-6 pr-2 space-y-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex justify-between items-center">
                    <div className="flex-1">
                      <p className="font-bold">{item.name}</p>
                      <p className="text-gray-500 text-sm">{item.price} ₽ x {cart[item.id]}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => removeFromCart(item.id)}
                        className="bg-gray-100 text-gray-600 w-8 h-8 rounded-lg flex items-center justify-center text-lg active:scale-90"
                      >-</button>
                      <span className="font-bold w-4 text-center">{cart[item.id]}</span>
                      <button 
                        onClick={() => addToCart(item.id)}
                        className="bg-blue-100 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center text-lg active:scale-90"
                      >+</button>
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
                onClick={sendOrder}
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all text-lg"
              >
                Оформить заказ
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}