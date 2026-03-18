export const Card = ({ children, title, footer, className }: { children: React.ReactNode; title?: string; footer?: React.ReactNode; className?: string }) => {
  return (
    <div className={`bg-white border border-gray-300 rounded-lg shadow-sm overflow-hidden ${className}`}>
      {title && (
        <div className="bg-[#f6f8fa] border-b border-gray-300 p-4 font-bold text-gray-700 text-sm">
          {title}
        </div>
      )}
      <div className="p-4">{children}</div>
      {footer && <div className="bg-[#f9f9f9] border-t border-gray-200 p-4">{footer}</div>}
    </div>
  );
};