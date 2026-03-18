"use client"
import { useState } from 'react'

export default function MarketingAutomation() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  return (
    <div className="p-12 max-w-6xl mx-auto font-sans text-[#333] antialiased">
      
      {/* HEADER - Style Basecamp: Bersih & Langsung ke Inti */}
      <header className="mb-12 border-b border-gray-200 pb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Marketing Automation</h1>
          <p className="text-gray-500 mt-2 text-lg">Skenario otomatis untuk Toko Alamanda</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-[#2da44e] hover:bg-[#2c974b] text-white px-5 py-2.5 rounded-md font-semibold text-sm shadow-sm transition-all"
        >
          New Scenario
        </button>
      </header>

      {/* LIST TABLE - Style: Card based / Clean Lines */}
      <div className="bg-white border border-gray-300 rounded-lg shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#f6f8fa] border-b border-gray-300">
                <th className="p-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Scenario Name</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Trigger</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Platform</th>
                <th className="p-4 text-sm font-semibold text-gray-600 text-right">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-blue-50/30 transition-colors cursor-pointer">
                <td className="p-4"><span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full"></span></td>
                <td className="p-4 font-bold text-[#0969da] text-md">Notifikasi Order COD (OK)</td>
                <td className="p-4 text-sm text-gray-600">Order Created</td>
                <td className="p-4 text-sm text-gray-600">YCloud</td>
                <td className="p-4 text-sm text-gray-500 text-right font-mono">842 sent</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* --- MODAL (Basecamp Style: Centered Card, Clear Inputs) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#444]/40 backdrop-blur-[2px] pt-20">
          <div className="bg-white w-full max-w-xl rounded-lg shadow-2xl border border-gray-400 overflow-hidden animate-in slide-in-from-top-4 duration-200">
            
            <div className="p-6 bg-[#f9f9f9] border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Set up new scenario</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="p-8 space-y-6">
              {/* Field Group */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Scenario Name</label>
                <input type="text" placeholder="e.g. Follow up Semarang COD" className="w-full p-2.5 border border-gray-300 rounded shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-md" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Trigger Event</label>
                  <select className="w-full p-2.5 border border-gray-300 rounded shadow-sm bg-white text-sm font-medium">
                    <option>Order Created</option>
                    <option>Order Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Platform</label>
                  <select className="w-full p-2.5 border border-gray-300 rounded shadow-sm bg-white text-sm font-medium">
                    <option>YCloud (WhatsApp)</option>
                    <option>Email</option>
                  </select>
                </div>
              </div>

              {/* Segmentation Box - Clean & Subtle */}
              <div className="p-5 bg-blue-50/50 border border-blue-100 rounded-md">
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-3">Targeting (Optional)</h4>
                <div className="grid grid-cols-2 gap-4">
                   <input type="number" placeholder="Min. Spend (Rp)" className="p-2 border border-gray-300 rounded text-sm" />
                   <input type="text" placeholder="City Filter" className="p-2 border border-gray-300 rounded text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Message Template</label>
                <textarea rows={4} placeholder="Hi {{nama}}, ..." className="w-full p-3 border border-gray-300 rounded shadow-sm text-md font-sans"></textarea>
                <p className="text-[11px] text-gray-500 mt-2 font-medium">Available tags: <span className="text-blue-600 underline cursor-pointer">{"{{nama}}"}</span>, <span className="text-blue-600 underline cursor-pointer">{"{{total}}"}</span></p>
              </div>
            </div>

            {/* Footer - Style Basecamp (Green for Go) */}
            <div className="p-6 bg-[#f9f9f9] border-t border-gray-200 flex gap-3">
              <button className="bg-[#2da44e] hover:bg-[#2c974b] text-white px-6 py-2.5 rounded shadow-sm font-bold text-sm transition-all">
                Save & Activate
              </button>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-600 hover:text-gray-900 px-4 py-2.5 font-semibold text-sm">
                Discard
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}