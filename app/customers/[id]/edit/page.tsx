import { CustomerForm } from '../../components/CustomerForm'

export const metadata = {
  title: 'Edit Pelanggan | ShapeUp CRM',
  description: 'Perbarui data pelanggan di ShapeUp CRM',
}

interface EditCustomerPageProps {
  params: Promise<{ id: string }>
}

export default async function EditCustomerPage({ params }: EditCustomerPageProps) {
  const { id } = await params

  return (
    <div className="py-4">
      <CustomerForm mode="edit" customerId={id} />
    </div>
  )
}
