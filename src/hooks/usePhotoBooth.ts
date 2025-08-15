import { useContext } from 'react';
import { PhotoBoothContext } from '../contexts/PhotoBoothContext';

export function usePhotoBooth() {
  const context = useContext(PhotoBoothContext);
  if (context === undefined) {
    throw new Error('usePhotoBooth must be used within a PhotoBoothProvider');
  }
  return context;
}