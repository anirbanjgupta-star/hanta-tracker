import { useState, useEffect } from 'react';

export function useVisitCounter() {
  const [visitCount, setVisitCount] = useState(0);

  useEffect(() => {
    // Get current visit count from localStorage
    const stored = localStorage.getItem('hanta-visit-count');
    const count = parseInt(stored || '0', 10);
    
    // Increment and save
    const newCount = count + 1;
    localStorage.setItem('hanta-visit-count', newCount.toString());
    localStorage.setItem('hanta-last-visit', new Date().toISOString());
    
    setVisitCount(newCount);
  }, []);

  return { visitCount };
}
