type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const Input = ({ label, ...props }: InputProps) => {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-bold text-gray-700 mb-2 whitespace-nowrap">
          {label}
        </label>
      )}
      <input 
        {...props}
        className="w-full p-2.5 border border-gray-300 rounded shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-[15px] font-medium text-gray-800 transition-all placeholder:text-gray-400"
      />
    </div>
  );
};

export const TextArea = ({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) => {
    return (
      <div className="w-full">
        {label && <label className="block text-sm font-bold text-gray-700 mb-2">{label}</label>}
        <textarea 
          {...props}
          className="w-full p-3 border border-gray-300 rounded shadow-sm text-[15px] font-sans outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
        />
      </div>
    );
  };