"use client"

type AudienceFieldType = 'date' | 'number' | 'select' | 'text'

type AudienceFieldConfig = {
  key: string
  label: string
  type: AudienceFieldType
  column: string
  placeholder?: string
  options?: string[]
  defaultValue?: string
  schedulingColumn?: string
}

export type AudienceFilter = {
  id: number
  key: string
  op: string
  value: string
  logic?: 'AND' | 'OR'
}

type AudienceSegmentBuilderProps = {
  filters: AudienceFilter[]
  setFilters: (filters: AudienceFilter[]) => void
}

type AudienceFilterField = 'key' | 'op' | 'value' | 'logic'
export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export type ScheduleConfig = {
  frequency: ScheduleFrequency
  hour: string
  minute: string
  weekday: string
  monthDay: string
}

export type OneTimeMode = 'IMMEDIATE' | 'SPECIFIC_DATETIME'

export type OneTimeConfig = {
  mode: OneTimeMode
  date: string
  hour: string
  minute: string
}

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  frequency: 'DAILY',
  hour: '09',
  minute: '00',
  weekday: '1',
  monthDay: '1',
}

export const DEFAULT_ONE_TIME: OneTimeConfig = {
  mode: 'IMMEDIATE',
  date: '',
  hour: '09',
  minute: '00',
}

const ORDER_DATE_COLUMN = "COALESCE(o.order_date_utc AT TIME ZONE COALESCE(b.timezone, 'Asia/Jakarta'), o.order_date::timestamp)"
const BUSINESS_TIMEZONE = "COALESCE(b.timezone, 'Asia/Jakarta')"
const COMPLETED_DATE_COLUMN = `COALESCE(
  (NULLIF(o.raw_source_data->>'date_completed_gmt', '')::timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE},
  NULLIF(o.raw_source_data->>'date_completed', '')::timestamp,
  o.updated_at AT TIME ZONE ${BUSINESS_TIMEZONE}
)`

// Tambah mapping baru cukup dari sini: key UI, label, tipe input, dan kolom SQL.
const AUDIENCE_FIELDS: AudienceFieldConfig[] = [
  {
    key: 'date_order',
    label: 'ORDER: TANGGAL PESANAN',
    type: 'date',
    column: ORDER_DATE_COLUMN,
    schedulingColumn: ORDER_DATE_COLUMN,
  },
  {
    key: 'date_completed',
    label: 'COMPLETE: TANGGAL SELESAI',
    type: 'date',
    column: COMPLETED_DATE_COLUMN,
    schedulingColumn: COMPLETED_DATE_COLUMN,
  },
  {
    key: 'order_status',
    label: 'ORDER: STATUS',
    type: 'select',
    column: 'o.status',
    options: ['completed', 'processing', 'pending', 'cancelled', 'on-hold'],
    defaultValue: 'on-hold',
  },
  {
    key: 'customer_city',
    label: 'CUSTOMER: KOTA',
    type: 'text',
    column: "o.raw_source_data->'billing'->>'city'",
    placeholder: 'KOTA',
  },
  {
    key: 'total_spent',
    label: 'ORDER: TOTAL BELANJA',
    type: 'number',
    column: "(o.raw_source_data->>'total')::numeric",
    placeholder: 'RP',
  },
]

const OPERATOR_GROUPS = {
  date: [
    { id: 'equal', label: 'SAMA DENGAN' },
    { id: 'before', label: 'SEBELUM' },
    { id: 'after', label: 'SESUDAH' },
    { id: 'after_x_days', label: 'SETELAH X HARI' },
    { id: 'after_x_hours', label: 'SETELAH X JAM' },
  ],
  number: [
    { id: 'equal to', label: 'EQUAL TO' },
    { id: 'more than', label: 'MORE THAN' },
    { id: 'less than', label: 'LESS THAN' },
  ],
  select: [
    { id: 'is', label: 'IS' },
    { id: 'is not', label: 'IS NOT' },
  ],
  text: [
    { id: 'is', label: 'IS' },
    { id: 'contains', label: 'CONTAINS' },
    { id: 'is not', label: 'IS NOT' },
  ],
} satisfies Record<AudienceFieldType, { id: string; label: string }[]>

const getAudienceField = (key: string) => AUDIENCE_FIELDS.find(field => field.key === key) || AUDIENCE_FIELDS[0]

const getOps = (key: string) => OPERATOR_GROUPS[getAudienceField(key).type]

const escapeSQLValue = (value: string) => String(value ?? '').replace(/'/g, "''")

const toNumericValue = (value: string) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? String(numericValue) : '0'
}

const toPositiveNumericValue = (value: string, fallback = '0') => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 0 ? String(numericValue) : fallback
}

const clampNumber = (value: string, min: number, max: number, fallback: number) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return fallback
  return Math.min(Math.max(Math.trunc(numericValue), min), max)
}

const toPaddedTimePart = (value: string, min: number, max: number) => {
  return String(clampNumber(value, min, max, min)).padStart(2, '0')
}

const buildDefaultFilter = (): AudienceFilter => {
  const field = AUDIENCE_FIELDS.find(item => item.key === 'order_status') || AUDIENCE_FIELDS[0]

  return {
    id: Date.now(),
    key: field.key,
    op: getOps(field.key)[0].id,
    value: field.defaultValue || field.options?.[0] || '',
    logic: 'AND',
  }
}

/**
 * FUNGSI GENERATOR SQL: Menghasilkan string untuk kolom sql_filter
 */
export const generateSQLFilter = (filters: AudienceFilter[]) => {
  if (!filters || filters.length === 0) return "TRUE";

  return filters.map((f, idx) => {
    let sqlPart = "TRUE";
    const field = getAudienceField(f.key)
    const col = field.column;
    const val = escapeSQLValue(f.value);
    const numericVal = toNumericValue(f.value);
    const positiveNumericVal = toPositiveNumericValue(f.value);
    const currentBusinessTime = `(NOW() AT TIME ZONE ${BUSINESS_TIMEZONE})`;

    // Logika Operator
    switch (f.op) {
      case 'is': 
      case 'equal':
      case 'equal to':
        if (field.type === 'date') {
          sqlPart = `${col}::date = '${val}'`;
        } else if (field.type === 'number') {
          sqlPart = `${col} = ${numericVal}`;
        } else {
          sqlPart = `${col} = '${val}'`;
        }
        break;
      case 'is not': 
        sqlPart = `${col} != '${val}'`; break;
      case 'contains': 
        sqlPart = `${col} ILIKE '%${val}%'`; break;
      case 'more than': 
        sqlPart = `${col} > ${numericVal}`; break;
      case 'less than': 
        sqlPart = `${col} < ${numericVal}`; break;
      case 'after': 
        sqlPart = field.type === 'date'
          ? `${col}::date > '${val}'::date`
          : `${col} > '${val}'::timestamptz`;
        break;
      case 'before': 
        sqlPart = field.type === 'date'
          ? `${col}::date < '${val}'::date`
          : `${col} < '${val}'::timestamptz`;
        break;
      case 'after_x_days': 
        sqlPart = `${col}::date = (${currentBusinessTime} - INTERVAL '${positiveNumericVal} days')::date`;
        break;
      case 'after_x_hours': 
        // Sapu semua yang umurnya SUDAH LEBIH dari X jam
        sqlPart = `${col} <= (${currentBusinessTime} - INTERVAL '${positiveNumericVal} hours')`;
        break;
      default: sqlPart = "TRUE";
    }

    return idx === 0 ? `(${sqlPart})` : `${f.logic || 'AND'} (${sqlPart})`;
  }).join(' ');
};

/**
 * FUNGSI GENERATOR JADWAL: Menghasilkan string untuk kolom scheduling_logic
 */
export const generateScheduling = (filters: AudienceFilter[], schedule?: ScheduleConfig, oneTime?: OneTimeConfig) => {
  if (oneTime) {
    if (oneTime.mode === 'IMMEDIATE' || !oneTime.date) return "NOW()"

    const hour = toPaddedTimePart(oneTime.hour, 0, 23)
    const minute = toPaddedTimePart(oneTime.minute, 0, 59)

    return `TIMESTAMP '${oneTime.date} ${hour}:${minute}:00'`
  }

  if (schedule) {
    const hour = toPaddedTimePart(schedule.hour, 0, 23)
    const minute = toPaddedTimePart(schedule.minute, 0, 59)
    const time = `${hour}:${minute}:00`

    if (schedule.frequency === 'DAILY') {
      return `date_trunc('day', NOW() AT TIME ZONE ${BUSINESS_TIMEZONE}) + TIME '${time}'`
    }

    if (schedule.frequency === 'WEEKLY') {
      const weekday = clampNumber(schedule.weekday, 0, 6, 1)

      return `date_trunc('day', NOW() AT TIME ZONE ${BUSINESS_TIMEZONE}) + ((((${weekday} - EXTRACT(DOW FROM NOW() AT TIME ZONE ${BUSINESS_TIMEZONE})::int) + 7) % 7) * INTERVAL '1 day') + TIME '${time}'`
    }

    const monthDay = clampNumber(schedule.monthDay, 1, 31, 1)

    return `LEAST(
      date_trunc('month', NOW() AT TIME ZONE ${BUSINESS_TIMEZONE}) + INTERVAL '${monthDay - 1} days',
      date_trunc('month', NOW() AT TIME ZONE ${BUSINESS_TIMEZONE}) + INTERVAL '1 month - 1 day'
    ) + TIME '${time}'`
  }

  const timeFilter = filters.find(f => f.op === 'after_x_days' || f.op === 'after_x_hours');
  
  if (timeFilter) {
    const field = getAudienceField(timeFilter.key)
    const col = field.schedulingColumn || field.column;
    const unit = timeFilter.op === 'after_x_days' ? 'days' : 'hours';
    return `${col} + interval '${toPositiveNumericValue(timeFilter.value)} ${unit}'`;
  }

  return "NOW()";
};

export default function AudienceSegmentBuilder({ filters, setFilters }: AudienceSegmentBuilderProps) {
  const addFilter = () => {
    setFilters([...filters, buildDefaultFilter()])
  }

  const updateFilter = (id: number, field: AudienceFilterField, val: string) => {
    setFilters(filters.map((f: AudienceFilter) => {
      if (f.id === id) {
        const updated = { ...f, [field]: val } as AudienceFilter;
        if (field === 'key') {
          const nextField = getAudienceField(val)
          updated.op = getOps(val)[0].id;
          updated.value = nextField.defaultValue || nextField.options?.[0] || '';
        }
        return updated;
      }
      return f;
    }))
  }

  return (
    <div className="space-y-4 bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-4 bg-blue-600 rounded-full"></div>
        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Kriteria Segmentasi</h4>
      </div>

      {filters.map((f: AudienceFilter, idx: number) => {
        const currentVar = getAudienceField(f.key);
        const availableOps = getOps(f.key);

        return (
          <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2">
            {idx > 0 && (
              <button 
                onClick={() => updateFilter(f.id, 'logic', f.logic === 'AND' ? 'OR' : 'AND')}
                className={`px-3 py-1 text-[10px] font-black rounded uppercase min-w-[50px] transition-all shadow-sm ${
                  f.logic === 'AND' ? 'bg-slate-900 text-white' : 'bg-blue-500 text-white'
                }`}
              >
                {f.logic}
              </button>
            )}

            <div className="flex items-center bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden flex-1 md:flex-none">
              <select 
                value={f.key} 
                onChange={(e) => updateFilter(f.id, 'key', e.target.value)} 
                className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 uppercase outline-none focus:bg-white"
              >
                {AUDIENCE_FIELDS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>

              <select 
                value={f.op} 
                onChange={(e) => updateFilter(f.id, 'op', e.target.value)} 
                className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 text-blue-600 uppercase outline-none bg-white"
              >
                {availableOps.map(op => <option key={op.id} value={op.id}>{op.label}</option>)}
              </select>

              {currentVar?.type === 'select' ? (
                <select 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                  className="px-4 py-2.5 text-[11px] font-black outline-none md:w-40 uppercase bg-white text-slate-700"
                >
                  <option value="">PILIH...</option>
                  {currentVar.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input 
                  type={f.op.includes('after_x') || currentVar?.type === 'number' ? 'number' : (currentVar?.type === 'date' ? 'date' : 'text')} 
                  value={f.value} 
                  onChange={(e) => updateFilter(f.id, 'value', e.target.value)} 
                  className="px-4 py-2.5 text-[11px] font-bold outline-none md:w-40 uppercase placeholder:text-slate-300" 
                  placeholder={f.op.includes('after_x') ? "NILAI" : (currentVar?.placeholder || "NILAI")} 
                />
              )}

              <button 
                onClick={() => setFilters(filters.filter((item: AudienceFilter) => item.id !== f.id))}
                className="px-4 py-2.5 bg-slate-50 text-slate-400 hover:text-red-600 border-l border-slate-200 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}

      <div className="pt-2">
        <button 
          onClick={addFilter} 
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-slate-300 bg-white text-[10px] font-black text-slate-500 hover:border-blue-500 hover:text-blue-600 uppercase transition-all shadow-sm"
        >
          <span className="text-sm">+</span> TAMBAH KRITERIA BARU
        </button>
      </div>
    </div>
  )
}
