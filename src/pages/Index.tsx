import { useSeoMeta } from '@unhead/react';

const Index = () => {
  useSeoMeta({
    title: 'Welcome to Blobbi Island',
    description: 'A virtual pet adventure on the Nostr network. Care for your Blobbis and explore the island!',
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 theme-transition">
      <div className="text-center blobbi-card-xl blobbi-section max-w-md mx-4">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
          🏝️ Welcome to Blobbi Island
        </h1>
        <p className="text-xl blobbi-text-muted mb-6">
          Your virtual pet adventure awaits!
        </p>
        <p className="text-sm blobbi-text-muted">
          Navigate to <span className="blobbi-badge-baby">/blobbi-island</span> to start your journey.
        </p>
      </div>
    </div>
  );
};

export default Index;
