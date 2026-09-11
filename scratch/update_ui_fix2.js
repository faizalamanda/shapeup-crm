const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../app/onboarding/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add imports
if (!content.includes('getLocalDateRangeLimits')) {
  content = content.replace(
    `import { useUserContext } from '@/components/UserContext'`,
    `import { useUserContext } from '@/components/UserContext'\nimport { getLocalDateRangeLimits, localDateToUtcBounds } from '@/lib/localzone'`
  );
}

// 2. Replace fetchMetrics with the one using localzone and unique customers
const oldFetchRegex = /  useEffect\(\(\) => \{\n    async function fetchMetrics\(\) \{[\s\S]*?fetchMetrics\(\)\n  \}, \[dateFilter, supabase, activeBusiness\?\.id\]\)/;

const newFetch = `  useEffect(() => {
    async function fetchMetrics() {
      if (!activeBusiness?.id) return;
      setIsLoadingMetrics(true)
      try {
        const businessTimezone = activeBusiness?.timezone || 'Asia/Jakarta'
        
        // 1. Get local date range string limits (e.g. "2026-09-11")
        // Mapping our component's dateFilter to localzone keys
        let dateKey = 'today'
        if (dateFilter === 'yesterday') dateKey = 'yesterday'
        else if (dateFilter === 'last7') dateKey = 'last7' // 'last7' is not in DateRangeKey, we must handle it manually
        else if (dateFilter === 'thisMonth') dateKey = 'this-month'
        
        let startLocal, endLocal;
        if (dateKey === 'last7') {
          const now = new Date();
          const endDate = new Date(now);
          const startDate = new Date(now);
          startDate.setDate(now.getDate() - 6);
          const { formatLocalDateString } = require('@/lib/localzone');
          startLocal = formatLocalDateString(startDate, businessTimezone);
          endLocal = formatLocalDateString(endDate, businessTimezone);
        } else {
          const range = getLocalDateRangeLimits(dateKey as any, businessTimezone)
          startLocal = range.start
          endLocal = range.end
        }

        // Current period UTC bounds
        const bounds = localDateToUtcBounds(startLocal, endLocal, businessTimezone)
        
        // Calculate Previous Period
        const sDate = new Date(startLocal)
        const eDate = new Date(endLocal)
        const diffMs = eDate.getTime() - sDate.getTime()
        const prevStart = new Date(sDate.getTime() - diffMs - 24 * 60 * 60 * 1000)
        const prevEnd = new Date(sDate.getTime() - 24 * 60 * 60 * 1000)
        const { formatLocalDateString } = require('@/lib/localzone');
        const prevBounds = localDateToUtcBounds(
          formatLocalDateString(prevStart, businessTimezone),
          formatLocalDateString(prevEnd, businessTimezone),
          businessTimezone
        )

        const countedStatuses = ['shipped', 'processing', 'complete', 'completed']
        
        const [o1Res, o2Res, custNewRes, prevCustNewRes] = await Promise.all([
          // Current period orders
          supabase.from('orders')
            .select('grand_total, customer_id')
            .eq('business_id', activeBusiness.id)
            .in('status', countedStatuses)
            .gte('order_date_utc', bounds.startOfDayISO)
            .lte('order_date_utc', bounds.endOfDayISO),
            
          // Previous period orders
          supabase.from('orders')
            .select('grand_total, customer_id')
            .eq('business_id', activeBusiness.id)
            .in('status', countedStatuses)
            .gte('order_date_utc', prevBounds.startOfDayISO)
            .lte('order_date_utc', prevBounds.endOfDayISO),
            
          // New customers (created in current period)
          supabase.from('customers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', activeBusiness.id)
            .gte('created_at', bounds.startOfDayISO)
            .lte('created_at', bounds.endOfDayISO),
            
          // New customers (created in prev period)
          supabase.from('customers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', activeBusiness.id)
            .gte('created_at', prevBounds.startOfDayISO)
            .lte('created_at', prevBounds.endOfDayISO)
        ])

        const o1 = o1Res.data || []
        const o2 = o2Res.data || []

        // Calculation exactly like dashboard
        const s1 = o1.reduce((acc, o) => acc + (Number(o.grand_total) || 0), 0)
        const t1 = o1.length
        const a1 = t1 > 0 ? s1 / t1 : 0
        const c1 = new Set(o1.map(o => o.customer_id).filter(Boolean)).size // Unique active customers
        
        const s2 = o2.reduce((acc, o) => acc + (Number(o.grand_total) || 0), 0)
        const t2 = o2.length
        const a2 = t2 > 0 ? s2 / t2 : 0
        const c2 = new Set(o2.map(o => o.customer_id).filter(Boolean)).size

        const calcGrowth = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0)

        setMetrics({
          sales: s1, salesGrowth: calcGrowth(s1, s2),
          trx: t1, trxGrowth: calcGrowth(t1, t2),
          avg: a1, avgGrowth: calcGrowth(a1, a2),
          cust: c1, custGrowth: calcGrowth(c1, c2),
          newCust: custNewRes.count || 0, newCustGrowth: calcGrowth(custNewRes.count || 0, prevCustNewRes.count || 0)
        })

      } catch(e) {
        console.error('Error fetching metrics', e)
      }
      setIsLoadingMetrics(false)
    }
    fetchMetrics()
  }, [dateFilter, supabase, activeBusiness?.id])`;

content = content.replace(oldFetchRegex, newFetch);

fs.writeFileSync(filePath, content);
console.log('Fixed localzone logic and customer count!');
