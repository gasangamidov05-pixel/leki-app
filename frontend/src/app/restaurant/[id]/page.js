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
  
  // НОВОЕ: Состояние для выбранной категории
  const [activeCategory, setActiveCategory] = useState('Все')

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

  const totalSum = products.reduce((sum, item) => {
    return sum + (item.price * (cart[item.id] || 0))
  }, 0)

  const sendOrder = async () => {
    const selectedItems = products
      .filter(p => cart[p.id] > 0)
      .map(p => ({
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
         alert("✅ Заказ успешно сохранен в базе данных!");
      } else {
         alert('❌ Ошибка при отправке заказа: ' + (error.message || error));
      }
    }
  };

  // НОВОЕ: Получаем список уникальных категорий из товаров
  const categories = ['Все', ...new Set(products.map(p => p.category || 'Основное'))]

  // НОВОЕ: Фильтруем товары по выбранной категории
  const filteredProducts = activeCategory === 'Все' 
    ? products 
    : products.filter(p => (p.category || 'Основное') === activeCategory)

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <div className="max-w-md mx-auto">
        <Link href="/" className="text-blue-500 mb-4 inline-block">← Назад к списку</Link>
        
        <h1 className="text-3xl font-bold mb-2">{restaurant?.name || 'Загрузка...'}</h1>
        <p className="text-gray-500 mb-6">Выберите блюда</p>

        {/* НОВОЕ: Панель категорий (Вкладки) */}
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
          {/* НОВОЕ: Выводим отфильтрованные товары, а не все подряд */}
          {filteredProducts.map((item) => (
            <div key={item.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
              <div className="flex-1">
                <h3 className="font-bold text-lg">{item.name}</h3>
                <p className="text-gray-400 text-sm">{item.price} ₽</p>
              </div>
              
              <div className="flex items-center gap-3">
                {cart[item.id] > 0 && (
                  <span className="font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                    {cart[item.id]}
                  </span>
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

        {totalSum > 0 && (
          <div className="fixed bottom-6 left-0 right-0 px-4">
            <button 
              onClick={sendOrder}
              className="max-w-md mx-auto w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-2xl flex justify-between px-8 items-center active:scale-95 transition-all"
            >
              <span>Оформить заказ</span>
              <span>{totalSum} ₽</span>
            </button>
          </div>
        )}
      </div>
    </main>
  )
}