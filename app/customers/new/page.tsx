import { CustomerForm } from '../components/CustomerForm'

export const metadata = {
  title: 'Tambah Pelanggan Baru | ShapeUp CRM',
  description: 'Tambah data pelanggan baru di ShapeUp CRM',
}

export default function NewCustomerPage() {
  return (
    <div className="py-4">
      <CustomerForm mode="create" />
    </div>
  )
}
