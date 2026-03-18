export const PageHeader = ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => {
  return (
    <header className="mb-10 border-b border-gray-200 pb-8 flex justify-between items-end">
      <div>
        {/* Judul tegak, tebal, dan bersih */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight uppercase tracking-wide">
          {title}
        </h1>
        {description && <p className="text-gray-500 mt-2 text-md font-medium">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </header>
  );
};