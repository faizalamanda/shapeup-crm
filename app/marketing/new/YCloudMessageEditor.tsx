"use client"
import type { Dispatch, SetStateAction } from 'react'
import { Card } from '@/components/ui/Card'
import {
  TEMPLATE_TAGS,
  createTemplateVar,
  type HeaderFormat,
  type TemplateVarDraft,
  type TemplateVarSource
} from './variables'

type YCloudMessageEditorProps = {
  templateName: string
  setTemplateName: Dispatch<SetStateAction<string>>
  headerFormat: HeaderFormat
  setHeaderFormat: Dispatch<SetStateAction<HeaderFormat>>
  headerVars: TemplateVarDraft[]
  setHeaderVars: Dispatch<SetStateAction<TemplateVarDraft[]>>
  headerMediaUrl: string
  setHeaderMediaUrl: Dispatch<SetStateAction<string>>
  headerFilename: string
  setHeaderFilename: Dispatch<SetStateAction<string>>
  templateVars: TemplateVarDraft[]
  setTemplateVars: Dispatch<SetStateAction<TemplateVarDraft[]>>
}

export default function YCloudMessageEditor({
  templateName,
  setTemplateName,
  headerFormat,
  setHeaderFormat,
  headerVars,
  setHeaderVars,
  headerMediaUrl,
  setHeaderMediaUrl,
  headerFilename,
  setHeaderFilename,
  templateVars,
  setTemplateVars,
}: YCloudMessageEditorProps) {
  // Helpers for Body Vars
  const addVar = () => setTemplateVars([...templateVars, createTemplateVar()])
  const updateVar = (id: number, field: keyof Pick<TemplateVarDraft, 'source' | 'value'>, val: string) => {
    setTemplateVars(
      templateVars.map((v) => {
        if (v.id !== id) return v
        if (field === 'source') {
          const nextSource = val as TemplateVarSource
          return {
            ...v,
            source: nextSource,
            value: nextSource === 'TAG' ? TEMPLATE_TAGS[0]?.key || '' : '',
          }
        }
        return { ...v, value: val }
      })
    )
  }

  // Helpers for Header Vars
  const addHeaderVar = () => setHeaderVars([...headerVars, createTemplateVar()])
  const updateHeaderVar = (id: number, field: keyof Pick<TemplateVarDraft, 'source' | 'value'>, val: string) => {
    setHeaderVars(
      headerVars.map((v) => {
        if (v.id !== id) return v
        if (field === 'source') {
          const nextSource = val as TemplateVarSource
          return {
            ...v,
            source: nextSource,
            value: nextSource === 'TAG' ? TEMPLATE_TAGS[0]?.key || '' : '',
          }
        }
        return { ...v, value: val }
      })
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
          3
        </span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">
          PENGIRIMAN PESAN (YCLOUD)
        </h3>
      </div>

      <Card>
        <div className="space-y-6">
          {/* NAMA TEMPLATE */}
          <div>
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-2 tracking-widest text-center md:text-left">
              NAMA TEMPLATE WHATSAPP
            </label>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              type="text"
              className="w-full p-3 border border-slate-300 rounded-lg font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="CONTOH: ORDER_NOTIF_ID"
            />
          </div>

          {/* PENGATURAN HEADER TEMPLATE */}
          <div className="pt-6 border-t border-slate-100 space-y-4">
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-2 tracking-widest">
                FORMAT HEADER TEMPLATE
              </label>
              <select
                value={headerFormat}
                onChange={(e) => setHeaderFormat(e.target.value as HeaderFormat)}
                className="w-full p-3 border border-slate-300 rounded-lg font-bold text-xs bg-white uppercase outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="NONE">TANPA HEADER (NONE)</option>
                <option value="TEXT">TEXT / TEKS HEADER</option>
                <option value="IMAGE">IMAGE / GAMBAR HEADER</option>
                <option value="DOCUMENT">DOCUMENT / DOKUMEN HEADER</option>
                <option value="VIDEO">VIDEO HEADER</option>
              </select>
            </div>

            {/* DYNAMIC HEADER INPUTS */}
            {headerFormat === 'TEXT' && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider">
                    VARIABEL HEADER TEKS
                  </span>
                  <button
                    type="button"
                    onClick={addHeaderVar}
                    className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded uppercase hover:bg-blue-600 transition-all"
                  >
                    + TAMBAH VARIABEL HEADER
                  </button>
                </div>
                {headerVars.length === 0 ? (
                  <p className="text-[10px] text-slate-400 font-bold uppercase italic">
                    Belum ada variabel header disetting (Gunakan jika header template berisi placeholder &#123;&#123;1&#125;&#125;).
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {headerVars.map((v, index) => (
                      <div key={v.id} className="space-y-1.5">
                        <div className="flex justify-between items-center text-[10px] font-black text-blue-600 uppercase">
                          <span>HEADER VARIABEL {"{{" + (index + 1) + "}}"}</span>
                          <button
                            type="button"
                            onClick={() => setHeaderVars(headerVars.filter((item) => item.id !== v.id))}
                            className="text-red-400 hover:text-red-600"
                          >
                            HAPUS
                          </button>
                        </div>
                        <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 shadow-sm">
                          <select
                            value={v.source}
                            onChange={(e) => updateHeaderVar(v.id, 'source', e.target.value as TemplateVarSource)}
                            className="bg-slate-50 px-2 text-[9px] font-black border-r outline-none uppercase"
                          >
                            <option value="TAG">TAG</option>
                            <option value="MANUAL">MANUAL</option>
                          </select>
                          {v.source === 'TAG' ? (
                            <select
                              value={v.value}
                              onChange={(e) => updateHeaderVar(v.id, 'value', e.target.value)}
                              className="px-3 py-2 text-[11px] font-bold outline-none flex-1 bg-white uppercase"
                            >
                              {TEMPLATE_TAGS.map((tag) => (
                                <option key={tag.key} value={tag.key}>
                                  {tag.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={v.value}
                              onChange={(e) => updateHeaderVar(v.id, 'value', e.target.value)}
                              className="px-3 py-2 text-[11px] font-bold outline-none flex-1"
                              placeholder="TULIS TEKS HEADER..."
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(headerFormat === 'IMAGE' || headerFormat === 'VIDEO') && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider">
                  URL MEDIA HEADER ({headerFormat})
                </label>
                <input
                  type="url"
                  value={headerMediaUrl}
                  onChange={(e) => setHeaderMediaUrl(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={
                    headerFormat === 'IMAGE'
                      ? 'https://domain.com/images/banner.jpg'
                      : 'https://domain.com/videos/intro.mp4'
                  }
                />
              </div>
            )}

            {headerFormat === 'DOCUMENT' && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                    URL DOKUMEN HEADER (PDF / FILE)
                  </label>
                  <input
                    type="url"
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://domain.com/files/invoice.pdf"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-700 uppercase tracking-wider mb-1">
                    NAMA FILE DOKUMEN (OPSIONAL)
                  </label>
                  <input
                    type="text"
                    value={headerFilename}
                    onChange={(e) => setHeaderFilename(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg font-bold text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Invoice_Pesanan.pdf"
                  />
                </div>
              </div>
            )}
          </div>

          {/* VARIABEL TEMPLATE BODY */}
          <div className="pt-6 border-t border-slate-100">
            <div className="flex justify-between items-center mb-4">
              <label className="text-[11px] font-black text-slate-600 uppercase tracking-widest">
                VARIABEL BODY TEMPLATE
              </label>
              <button
                type="button"
                onClick={addVar}
                className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded uppercase hover:bg-blue-600 transition-all"
              >
                + TAMBAH
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templateVars.map((v, index) => (
                <div key={v.id} className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] font-black text-blue-600 uppercase">
                    <span>VARIABEL {"{{" + (index + 1) + "}}"}</span>
                    <button
                      type="button"
                      onClick={() => setTemplateVars(templateVars.filter((item) => item.id !== v.id))}
                      className="text-red-400 hover:text-red-600"
                    >
                      HAPUS
                    </button>
                  </div>
                  <div className="flex bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 shadow-sm">
                    <select
                      value={v.source}
                      onChange={(e) => updateVar(v.id, 'source', e.target.value as TemplateVarSource)}
                      className="bg-slate-50 px-2 text-[9px] font-black border-r outline-none uppercase"
                    >
                      <option value="TAG">TAG</option>
                      <option value="MANUAL">MANUAL</option>
                    </select>
                    {v.source === 'TAG' ? (
                      <select
                        value={v.value}
                        onChange={(e) => updateVar(v.id, 'value', e.target.value)}
                        className="px-3 py-2 text-[11px] font-bold outline-none flex-1 bg-white uppercase"
                      >
                        {TEMPLATE_TAGS.map((tag) => (
                          <option key={tag.key} value={tag.key}>
                            {tag.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={v.value}
                        onChange={(e) => updateVar(v.id, 'value', e.target.value)}
                        className="px-3 py-2 text-[11px] font-bold outline-none flex-1"
                        placeholder="TULIS TEXT MANUAL..."
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}
