import React, { createContext, useState, ReactNode } from 'react';

interface PhotoBoothContextType {
  isPhotoBoothOpen: boolean;
  setPhotoBoothOpen: (isOpen: boolean) => void;
}

const PhotoBoothContext = createContext<PhotoBoothContextType | undefined>(undefined);

export function PhotoBoothProvider({ children }: { children: ReactNode }) {
  const [isPhotoBoothOpen, setPhotoBoothOpen] = useState(false);

  return (
    <PhotoBoothContext.Provider value={{ isPhotoBoothOpen, setPhotoBoothOpen }}>
      {children}
    </PhotoBoothContext.Provider>
  );
}

export { PhotoBoothContext };