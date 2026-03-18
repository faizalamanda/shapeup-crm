"use client"
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'

export default function MarketingAutomation({ isModalOpen, setIsModalOpen }: any) {
  return (
    <div className="space-y-8">
      
      {/* TABLE LIST - Style Basecamp: Clean & High Contrast */}
      <Card>
        <div className="overflow-x-auto -m-4">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#f6f8fa] border-b border-gray-300">
                <th className="p-4 text-[12px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="p-4 text-[12px] font-bold text-gray-500 uppercase tracking-wider text-nowrap">Scenario Name</th>
                <th className="p-4 text-[12px] font-bold text-gray-500 uppercase tracking-wider text-nowrap">Trigger</th>
                <th className="p-4 text-[12px] font-bold text-gray-500 uppercase tracking-wider text-right text-nowrap">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-blue-50/40 transition-all cursor-pointer">
                <td className="p-4">
                  <span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full shadow-sm"></span>
                </td>
                <td className="p-4">
                  <p className="font-bold text-[#0969da] text-[15px] italic uppercase tracking-tight leading-tight">Notifikasi Order COD (OK)</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">YCloud (WhatsApp)</p>
                </td>
                <td className="p-4 text-[13px] text-gray-700 font-semibold tracking-tight uppercase">Order_Created</td>
                <td className="p-4 text-[13px] text-gray-500 text-right font-mono tracking-tighter tabular-nums">842 sent</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* MODAL SECTION */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#444]/40 backdrop-blur-[2px] pt-20 p-4">
          <div className="bg-white w-full max-w-xl rounded-lg shadow-2xl border border-gray-400 overflow-hidden animate-in fade-in zoom-in duration-200">
            
            <div className="p-6 bg-[#f9f9f9] border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800 tracking-tight italic uppercase">Scenario Config</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl font-light">×</button>
            </div>

            <div className="p-8 space-y-6">
              <Input label="Scenario Name" placeholder="CONTOH: FOLLOW UP COD SEMARANG" />

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider italic">Trigger Event</label>
                  <select className="w-full p-2.5 border border-gray-300 rounded shadow-sm bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
                    <option>ORDER_CREATED</option>
                    <option>ORDER_COMPLETED</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider italic">Platform</label>
                  <select className="w-full p-2.5 border border-gray-300 rounded shadow-sm bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 appearance-none">
                    <option>YCLOUD (WHATSAPP)</option>
                    <option>EMAIL (RESEND)</option>
                  </select>
                </div>
              </div>

              <TextArea label="Message Template" placeholder="Hi {{nama}}, terima kasih..." />
              
              <div className="flex gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-widest border-t border-gray-100 pt-4">
                <span className="cursor-pointer hover:underline underline-offset-4">{"{{nama}}"}</span>
                <span className="text-gray-300">|</span>
                <span className="cursor-pointer hover:underline underline-offset-4">{"{{total}}"}</span>
                <span className="text-gray-300">|</span>
                <span className="cursor-pointer hover:underline underline-offset-4">{"{{no_order}}"}</span>
              </div>
            </div>

            <div className="p-6 bg-[#f9f9f9] border-t border-gray-200 flex gap-3">
              <Button onClick={() => {}} variant="primary">Save & Activate</Button>
              <Button onClick={() => setIsModalOpen(false)} variant="outline">Cancel</Button>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}