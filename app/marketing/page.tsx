"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'

export default function AdvancedScenarioPage() {
  return (
    <div className="space-y-10">
      <PageHeader 
        title="Create Advanced Scenario" 
        description="Bangun alur otomatisasi marketing yang lebih presisi."
        action={
          <div className="flex gap-3">
            <Button variant="outline">Discard</Button>
            <Button variant="primary">Save & Run Scenario</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* KOLOM KIRI: TRIGGER & SCHEDULING */}
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">1. Trigger & Timing</h3>
            <Card>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Main Event</label>
                  <select className="w-full p-3 border border-gray-300 rounded shadow-sm font-bold text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500">
                    <option>ORDER_CREATED</option>
                    <option>ORDER_COMPLETED</option>
                    <option>CUSTOMER_REORDER</option>
                    <option>ABANDONED_CHECKOUT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Check Frequency</label>
                  <select className="w-full p-3 border border-gray-300 rounded shadow-sm font-bold text-sm bg-white outline-none">
                    <option>EVERY 15 MINUTES</option>
                    <option>HOURLY</option>
                    <option>DAILY AT SPECIFIC TIME</option>
                    <option>WEEKLY / MONTHLY</option>
                  </select>
                </div>

                <div className="p-4 bg-blue-50 rounded border border-blue-100">
                  <label className="block text-xs font-bold text-blue-700 uppercase mb-3">Time Window Logic</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold">IF AGE</span>
                    <select className="p-2 border border-gray-300 rounded font-bold text-xs bg-white">
                      <option>{">"}</option>
                      <option>{"<"}</option>
                    </select>
                    <input type="number" className="w-16 p-2 border border-gray-300 rounded font-bold text-xs" placeholder="3" />
                    <span className="text-xs font-bold">HOURS</span>
                  </div>
                  <p className="text-[10px] text-blue-500 mt-3 font-medium tracking-tight">
                    *Contoh: Kirim jika order sudah dibuat lebih dari 3 jam tapi belum bayar.
                  </p>
                </div>
              </div>
            </Card>
          </section>
        </div>

        {/* KOLOM TENGAH: ADVANCED SEGMENTATION */}
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">2. Filter Variables</h3>
            <Card>
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <span className="text-xs font-bold text-slate-600 uppercase">Variable Filters</span>
                    <button className="text-[10px] font-black text-blue-600">+ ADD FILTER</button>
                  </div>
                  
                  {/* Filter Item 1 */}
                  <div className="flex gap-2">
                    <select className="flex-1 p-2 border border-gray-200 rounded text-xs font-bold bg-slate-50">
                      <option>TOTAL_SPEND</option>
                      <option>CITY_LOCATION</option>
                      <option>PAYMENT_METHOD</option>
                      <option>PRODUCT_CATEGORY</option>
                    </select>
                    <select className="w-16 p-2 border border-gray-200 rounded text-xs font-bold">
                      <option>{">"}</option>
                      <option>{"="}</option>
                    </select>
                    <input type="text" className="w-24 p-2 border border-gray-200 rounded text-xs font-bold" placeholder="50000" />
                  </div>

                  {/* Filter Item 2 */}
                  <div className="flex gap-2">
                    <select className="flex-1 p-2 border border-gray-200 rounded text-xs font-bold bg-slate-50">
                      <option>PAYMENT_METHOD</option>
                      <option>TOTAL_SPEND</option>
                    </select>
                    <select className="w-16 p-2 border border-gray-200 rounded text-xs font-bold">
                      <option>IS</option>
                      <option>NOT</option>
                    </select>
                    <select className="w-24 p-2 border border-gray-200 rounded text-xs font-bold bg-white text-[10px]">
                      <option>COD</option>
                      <option>TRANSFER</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-100">
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Specific Date/Time</label>
                  <input type="datetime-local" className="w-full p-2.5 border border-gray-300 rounded text-sm font-bold shadow-sm" />
                </div>
              </div>
            </Card>
          </section>
        </div>

        {/* KOLOM KANAN: ACTION & CONTENT */}
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">3. Action & Message</h3>
            <Card>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Send Via</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="p-3 border-2 border-blue-600 bg-blue-50 text-blue-700 rounded-md font-bold text-[11px] uppercase">WhatsApp</button>
                    <button className="p-3 border border-gray-200 text-slate-400 rounded-md font-bold text-[11px] uppercase">Email</button>
                  </div>
                </div>

                <TextArea 
                  label="Message Content" 
                  placeholder="Halo {{nama}}, order anda {{no_order}} belum kami terima pembayarannya..." 
                />

                <div className="bg-slate-50 p-4 rounded-md">
                   <p className="text-[10px] font-black text-slate-400 uppercase mb-3">Available Tags</p>
                   <div className="flex flex-wrap gap-2">
                     {['nama', 'total', 'no_order', 'kurir', 'link_bayar'].map(t => (
                       <span key={t} className="px-2 py-1 bg-white border border-gray-200 rounded text-[9px] font-bold text-slate-600 hover:border-blue-500 cursor-pointer transition-all">
                         {"{{" + t + "}}"}
                       </span>
                     ))}
                   </div>
                </div>
              </div>
            </Card>
          </section>
        </div>

      </div>
    </div>
  )
}