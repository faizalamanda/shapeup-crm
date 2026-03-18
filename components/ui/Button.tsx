type ButtonProps = {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  onClick?: () => void;
  className?: string;
};

export const Button = ({ children, variant = 'primary', onClick, className }: ButtonProps) => {
  const base = "px-4 py-2 rounded-md font-semibold text-sm transition-all shadow-sm active:scale-95";
  const styles = {
    primary: "bg-[#2da44e] hover:bg-[#2c974b] text-white border border-[#1b7c35]",
    secondary: "bg-[#f6f8fa] hover:bg-[#f3f4f6] text-[#24292f] border border-gray-300",
    outline: "bg-transparent hover:bg-gray-50 text-gray-600 border border-gray-300",
    danger: "bg-[#cf222e] hover:bg-[#b6020d] text-white border border-[#a40e18]",
  };

  return (
    <button onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
};