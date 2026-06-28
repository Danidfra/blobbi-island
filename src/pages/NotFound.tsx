import { useSeoMeta } from "@unhead/react";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useSeoMeta({
    title: "404 - Page Not Found",
    description: "The page you are looking for could not be found. Return to the home page to continue browsing.",
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-island-sky/55 via-island-cream to-island-sand/60 theme-transition">
      <div className="text-center blobbi-card-xl blobbi-section max-w-md mx-4">
        <div className="text-6xl mb-4">🏝️</div>
        <h1 className="text-4xl font-bold mb-4 text-island-ink">404</h1>
        <p className="text-xl blobbi-text-muted mb-4">Oops! This island doesn't exist</p>
        <a
          href="/"
          className="inline-block bg-island-purple hover:bg-island-purple/90 text-white px-6 py-2 rounded-full font-medium shadow-cozy-soft transition-all duration-200 hover:scale-105"
        >
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
