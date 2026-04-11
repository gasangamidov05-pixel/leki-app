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

  // ФУНКЦИЯ ОТПРАВКИ (проверь её внимательно)
  const sendOrder = () => {
    const selectedItems = products
      .filter(p => cart[p.id] > 0)
      .map(p => ({
        name: p.name,
        count: cart[p.id],
        price: p.price
      }));

    const orderData = {
      restaurant: restaurant?.name,
      items: selectedItems,
      total: totalSum
    };

    // Если мы в Telegram
    if (window.Telegram?.WebApp && window.Telegram.WebApp.initData) {
      window.Telegram.WebApp.sendData(JSON.stringify(orderData));
    } else {
      // Если в обычном браузере — ВЫВОДИМ ОКНО
      alert(`ЗАКАЗ В ${restaurant?.name.toUpperCase()}:\n\n` + 
            selectedItems.map(i => `${i.name} x${i.count}`).join('\n') + 
            `\n\nИТОГО: ${totalSum} ₽`);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-black pb-32">
      <div className="max-w-md mx-auto">
        <Link href="/" className="text-blue-500 mb-4 inline-block">← Назад к списку</Link>
        
        <h1 className="text-3xl font-bold mb-2">{restaurant?.name || 'Загрузка...'}</h1>
        <p className="text-gray-500 mb-8">Выберите блюда</p>

        <div className="grid gap-4">
          {products.map((item) => (
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
        </div>

        {totalSum > 0 && (
          <div className="fixed bottom-6 left-0 right-0 px-4">
            <button 
              onClick={sendOrder} // ПРОВЕРЬ, ЧТО ЭТО ТУТ ЕСТЬ
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