'use client';

import React, { useState } from 'react';
import { STAGE_COLORS } from '../helpers/kanbanUtils';

interface StageColorPickerProps {
  currentColor: string;
  onChangeColor: (color: string) => void;
}

export default function StageColorPicker({ currentColor, onChangeColor }: StageColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 shadow-xs flex items-center justify-center transition-transform hover:scale-110 focus:outline-hidden"
        style={{ backgroundColor: currentColor }}
        title="Ubah warna stage"
      >
        <span className="sr-only">Pilih warna</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 mt-2 w-48 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1">
              Pilih Warna Stage
            </div>
            <div className="grid grid-cols-5 gap-2">
              {STAGE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    onChangeColor(color);
                    setIsOpen(false);
                  }}
                  className={`w-7 h-7 rounded-full transition-all hover:scale-110 flex items-center justify-center ${
                    currentColor === color ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-800' : ''
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {currentColor === color && (
                    <svg className="w-4 h-4 text-white drop-shadow-xs" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
