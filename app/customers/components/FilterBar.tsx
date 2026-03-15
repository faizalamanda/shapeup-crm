export function FilterBar({ searchQuery, setSearchQuery, filterCategory, setFilterCategory }: any) {
  return (
    <div className="flex flex-col md:flex-row gap-4 mb-6">
      <div className="relative flex-1">
        <input 
          type="text" 
          placeholder="Cari nama atau nomor hp..." 
          className="w-full h-10 pl-10 pr-4 bg-white border border-slate-300 rounded outline-none focus:border-blue-500 text-sm font-medium transition-all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className="absolute left-3 top-2.5 opacity-30">🔍</span>
      </div>
      <select 
        className="h-10 px-4 bg-white border border-slate-300 rounded outline-none focus:border-blue-500 text-sm font-bold text-slate-600 cursor-pointer"
        value={filterCategory}
        onChange={(e) => setFilterCategory(e.target.value)}
      >
        <option value="All">Semua Kategori</option>
        <option value="VIP">VIP Only</option>
        <option value="General">General Only</option>
      </select>
    </div>
  )
}