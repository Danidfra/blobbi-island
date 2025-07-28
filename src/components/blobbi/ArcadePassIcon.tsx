import React, { useState, useEffect } from 'react';

export function ArcadePassIcon() {
  const [hasPass, setHasPass] = useState(false);

  useEffect(() => {
    // Check if user has arcade pass
    const checkPass = () => {
      const pass = sessionStorage.getItem('has-arcade-pass');
      setHasPass(pass === 'true');
    };

    // Initial check
    checkPass();

    // Listen for storage changes (in case pass is purchased in another tab)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'has-arcade-pass') {
        checkPass();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Also check periodically in case sessionStorage is updated in the same tab
    const interval = setInterval(checkPass, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  if (!hasPass) {
    return null;
  }

  return (
    <div className="relative">
      <img 
        src="/assets/interactive/arcade-ticket.png" 
        alt="Arcade Pass" 
        className="w-8 h-8 sm:w-10 sm:h-10 drop-shadow-lg animate-pulse"
        title="You have an active Arcade Pass!"
      />
      {/* <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div> */}
    </div>
  );
}