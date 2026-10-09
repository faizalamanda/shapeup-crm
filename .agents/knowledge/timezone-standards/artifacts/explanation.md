# Database-Driven Timezone Formatting

## Core Principle
All date and time displays must respect the business's configured timezone (`businesses.timezone`) from the database, rather than defaulting to the end-user's local browser timezone. This ensures cross-device and cross-location consistency for managers viewing data from different branches.

## Input (Writing Data)
When saving transactions or generating receipts (e.g. POS checkouts, invoice creation), the exact timestamp must be captured and stored strictly in **UTC (`toISOString()`)**. 

```typescript
// POS checkout, invoice creation, etc.
const timestamp = new Date().toISOString()
```
For inputs based on dates only (like `<input type="date">` generating `"YYYY-MM-DD"`), converting it via `new Date(dateString).toISOString()` will correctly yield Midnight UTC.

## Display (Reading Data)
When reading and displaying dates in any client component, **NEVER** use native browser formatters (`.toLocaleString()`, `.toLocaleDateString()`, etc.) without explicit timezone configuration. 

**Always use the `formatDisplayDate` function from `@/lib/timeUtils` and explicitly pass the business timezone.**

### Incorrect Anti-Pattern 🚨
```tsx
// This relies purely on the browser's system clock
<div>{new Date(order_date).toLocaleString('id-ID')}</div>
```

### Correct Implementation ✅
```tsx
import { formatDisplayDate } from '@/lib/timeUtils'
import { useUserContext } from '@/components/UserContext'

export default function TransactionView() {
  const { activeBusiness } = useUserContext()
  const businessTimezone = activeBusiness?.timezone || 'Asia/Jakarta'

  return (
    // ...
    <div>{formatDisplayDate(order_date, 'datetime', businessTimezone)}</div>
  )
}
```

### Server-Side or Non-Context Components
If `useUserContext` is not available, you MUST fetch the `timezone` from the active business explicitly via the database:
```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('id, active_business_id, businesses!active_business_id(name, timezone)')
  .eq('id', user.id)
  .single()

const businessTimezone = profile.businesses?.timezone || 'Asia/Jakarta'
```
