import React, { createContext, useContext, useState, ReactNode } from 'react';

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

export function usePhotoBooth() {
  const context = useContext(PhotoBoothContext);
  if (context === undefined) {
    throw new Error('usePhotoBooth must be used within a PhotoBoothProvider');
  }
  return context;
}